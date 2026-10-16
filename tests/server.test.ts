import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app';
import { loadConfig, type ProxyConfig } from '../apps/server/src/config';
import { createGemmaClient, type GemmaClient } from '../apps/server/src/gemmaClient';

process.env.NODE_ENV = 'test';
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function start(config: Partial<ProxyConfig>, client?: GemmaClient) {
  const base = { ...loadConfig({}), ...config };
  const app = createApp(base, client ?? createGemmaClient(base));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  const port = (server!.address() as AddressInfo).port;
  // Host guard expects the configured port.
  base.port = port;
  const app2 = createApp(base, client ?? createGemmaClient(base));
  server.close();
  server = app2.listen(port, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  return `http://127.0.0.1:${port}`;
}

const mapBody = {
  fields: [
    { id: 'f_server001', label: 'Developer Repository', type: 'url', options: [] },
    { id: 'f_server002', label: 'Educational Institution', type: 'text', options: [] },
  ],
  availableMemoryKeys: [
    { key: 'github_url', description: 'Public developer profile URL', hasValue: true },
    { key: 'college', description: 'Current educational institution', hasValue: true },
  ],
};

const post = (url: string, body: unknown, origin = EXT) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

const fakeClient = (reply: string): GemmaClient => ({ chat: async () => reply, listModels: async () => ({ reachable: true, models: [] }) });

describe('Gemma proxy', () => {
  it('reports configuration honestly', async () => {
    const url = await start({});
    const h = await (await fetch(`${url}/api/health`)).json();
    expect(h).toMatchObject({ ok: true, configured: false, model: null });
    expect((await post(`${url}/api/map`, mapBody)).status).toBe(503);
  });

  it('rejects web page origins and missing origins', async () => {
    const url = await start({ gemmaBaseUrl: 'http://127.0.0.1:1', gemmaModel: 'test-model' });
    expect((await post(`${url}/api/map`, mapBody, 'https://evil.example')).status).toBe(403);
    const noOrigin = await fetch(`${url}/api/map`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mapBody) });
    expect(noOrigin.status).toBe(403);
  });

  it('honours an explicit extension allowlist', async () => {
    const url = await start({ allowedOrigins: ['chrome-extension://pppppppppppppppppppppppppppppppp'] }, fakeClient('{}'));
    expect((await post(`${url}/api/map`, mapBody)).status).toBe(403);
  });

  it('validates requests and limits payload size', async () => {
    const url = await start({ gemmaBaseUrl: 'http://127.0.0.1:1', gemmaModel: 'm' }, fakeClient('{}'));
    expect((await post(`${url}/api/map`, { fields: [{ id: 'bad', label: 'x', type: 'text' }], availableMemoryKeys: [] })).status).toBe(400);
    expect((await post(`${url}/api/map`, { blob: 'x'.repeat(100_000) })).status).toBe(413);
  });

  it('returns validated mappings and strips hallucinated keys / unknown fields', async () => {
    const reply = JSON.stringify({
      mappings: [
        { fieldId: 'f_server001', action: 'use_memory', memoryKey: 'github_url', confidence: 0.97, reason: 'repo' },
        { fieldId: 'f_server002', action: 'use_memory', memoryKey: 'ssn', confidence: 0.9, reason: 'x' },
        { fieldId: 'f_injected0', action: 'use_memory', memoryKey: 'college', confidence: 0.9, reason: 'x' },
      ],
    });
    const url = await start({ gemmaBaseUrl: 'http://127.0.0.1:1', gemmaModel: 'm' }, fakeClient('```json\n' + reply + '\n```'));
    const res = await post(`${url}/api/map`, mapBody);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(EXT);
    const data = await res.json();
    expect(data.mappings).toHaveLength(2);
    expect(data.mappings[0]).toMatchObject({ memoryKey: 'github_url' });
    expect(data.mappings[1]).toMatchObject({ action: 'ask_user', memoryKey: null });
  });

  it('rejects model output with forbidden shapes', async () => {
    const reply = JSON.stringify({ mappings: [{ fieldId: 'f_server001', action: 'use_memory', memoryKey: 'github_url', confidence: 1, reason: '', selector: '#pw' }] });
    const url = await start({ gemmaBaseUrl: 'http://127.0.0.1:1', gemmaModel: 'm' }, fakeClient(reply));
    expect((await post(`${url}/api/map`, mapBody)).status).toBe(502);
  });

  it('reports an unreachable inference endpoint as unavailable', async () => {
    const url = await start({ gemmaBaseUrl: 'http://127.0.0.1:9/v1', gemmaModel: 'google/gemma-4-E4B-it', timeoutMs: 3000 });
    const res = await post(`${url}/api/map`, mapBody);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('unavailable');
  });

  it('discards drafts containing secrets', async () => {
    const url = await start({ gemmaBaseUrl: 'http://127.0.0.1:1', gemmaModel: 'm' }, fakeClient(JSON.stringify({ draft: 'My key is sk-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWx', usedKeys: [], missingFacts: [] })));
    const res = await post(`${url}/api/draft`, { fieldId: 'f_server001', question: 'Why?', maxLength: 300, facts: [] });
    expect(res.status).toBe(502);
  });

  it('speaks the OpenAI-compatible protocol and retries without response_format', async () => {
    const { createServer } = await import('node:http');
    const seen: Array<{ auth?: string; body: Record<string, unknown> }> = [];
    const upstream = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = JSON.parse(data);
        seen.push({ auth: req.headers.authorization, body });
        if (body.response_format) {
          res.writeHead(400).end('{"error":"response_format unsupported"}');
          return;
        }
        const content = JSON.stringify({ mappings: [{ fieldId: 'f_server001', action: 'use_memory', memoryKey: 'github_url', transform: 'none', confidence: 0.9, reason: 'repo' }] });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const upPort = (upstream.address() as AddressInfo).port;
    try {
      const url = await start({ gemmaBaseUrl: `http://127.0.0.1:${upPort}/v1`, gemmaModel: 'google/gemma-4-E4B-it', gemmaApiKey: 'test-key' });
      const res = await post(`${url}/api/map`, mapBody);
      expect(res.status).toBe(200);
      expect((await res.json()).mappings[0].memoryKey).toBe('github_url');
      expect(seen).toHaveLength(2);
      expect(seen[0]!.body).toMatchObject({ model: 'google/gemma-4-E4B-it', temperature: 0, response_format: { type: 'json_object' } });
      expect(seen[1]!.body.response_format).toBeUndefined();
      expect(seen[0]!.auth).toBe('Bearer test-key');
      // Only labels/keys travel upstream, wrapped as untrusted data.
      const user = (seen[1]!.body.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'user')!.content;
      expect(user).toContain('<untrusted_form_data>');
    } finally {
      upstream.close();
    }
  });

  it('rejects non-loopback Host headers (DNS rebinding)', async () => {
    const url = await start({});
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const u = new URL(`${url}/api/health`);
      request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect(status).toBe(421);
  });
});
