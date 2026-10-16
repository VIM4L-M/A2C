import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app';
import { parseUsers, sha256 } from '../apps/server/src/auth';
import { createBackboardClient, type BackboardClient } from '../apps/server/src/backboardClient';
import { configProblems, loadConfig, type ProxyConfig } from '../apps/server/src/config';
import { createChatClient, type GemmaClient } from '../apps/server/src/gemmaClient';

process.env.NODE_ENV = 'test';
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const TOKENS = { alice: 'a2c_alice_token_123456', bob: 'a2c_bob_token_654321' };
const USERS = `alice:${sha256(TOKENS.alice).toString('hex')},bob:${sha256(TOKENS.bob).toString('hex')}`;
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

const stubGemma: GemmaClient = { configured: false, model: null, chat: async () => '{}', listModels: async () => ({ reachable: false, models: [] }) };

/** In-memory fake of the Backboard REST API, recording every call. */
function fakeBackboard() {
  const calls: Array<{ method: string; path: string; key: string | null; body: unknown }> = [];
  const assistants: Array<{ assistant_id: string; name: string }> = [];
  const memories = new Map<string, Array<{ id: string; content: string; metadata: Record<string, string> }>>();
  let n = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', path: path + u.search, key: new Headers(init?.headers).get('x-api-key'), body });
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (path === '/assistants' && init?.method === 'GET') return ok(assistants.filter((a) => !u.searchParams.get('name') || a.name === u.searchParams.get('name')));
    if (path === '/assistants' && init?.method === 'POST') {
      const a = { assistant_id: `asst_${++n}`, name: body.name };
      assistants.push(a);
      return ok(a);
    }
    const m = path.match(/^\/assistants\/([^/]+)\/memories(?:\/(search|[^/]+))?$/);
    if (m) {
      const list = memories.get(m[1]!) ?? [];
      memories.set(m[1]!, list);
      if (m[2] === 'search') return ok({ memories: list.filter((x) => x.content.toLowerCase().includes(String(body.query).toLowerCase().split(' ')[0]!)).map((x) => ({ ...x, score: 0.9 })) });
      if (m[2] && init?.method === 'DELETE') {
        memories.set(m[1]!, list.filter((x) => x.id !== m[2]));
        return ok({ ok: true });
      }
      if (init?.method === 'POST') {
        const item = { id: `mem_${++n}`, content: body.content, metadata: body.metadata };
        list.push(item);
        return ok({ memory_id: item.id });
      }
      return ok({ memories: list, total_count: list.length });
    }
    return ok({ detail: 'Not Found' }, 404);
  }) as unknown as typeof fetch;
  return { calls, assistants, memories, client: createBackboardClient({ apiKey: 'bb_test_key', baseUrl: 'https://app.backboard.io/api' }, fetchImpl) };
}

async function start(env: Record<string, string>, deps: { gemma?: GemmaClient; backboard?: BackboardClient; specialist?: GemmaClient } = {}) {
  const config: ProxyConfig = { ...loadConfig({ ...env }), host: '127.0.0.1' };
  const tmp = createApp(config, deps.gemma ?? stubGemma, deps).listen(0, '127.0.0.1');
  await new Promise((r) => tmp.once('listening', r));
  config.port = (tmp.address() as AddressInfo).port;
  tmp.close();
  server = createApp(config, deps.gemma ?? stubGemma, deps).listen(config.port, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  return `http://127.0.0.1:${config.port}`;
}

const call = (url: string, method: string, token?: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { Origin: EXT, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('Render / production startup guard', () => {
  it('refuses a public bind without users and an extension origin', () => {
    const c = loadConfig({ NODE_ENV: 'production', PORT: '10000' });
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(10000);
    expect(configProblems(c)).toHaveLength(2);
    const ok = loadConfig({ NODE_ENV: 'production', A2C_USERS: USERS, ALLOWED_EXTENSION_ORIGIN: EXT });
    expect(configProblems(ok)).toEqual([]);
    expect(configProblems(loadConfig({}))).toEqual([]); // localhost development
  });

  it('rejects malformed user entries', () => {
    expect(() => parseUsers('alice:nothex')).toThrow();
    expect(parseUsers(USERS).map((u) => u.id)).toEqual(['alice', 'bob']);
  });
});

describe('authentication', () => {
  it('requires a valid bearer token when users are configured', async () => {
    const url = await start({ A2C_USERS: USERS, ALLOWED_EXTENSION_ORIGIN: EXT });
    expect((await call(`${url}/api/health`, 'GET')).status).toBe(200);
    expect((await call(`${url}/api/status`, 'GET')).status).toBe(401);
    expect((await call(`${url}/api/status`, 'GET', 'a2c_wrong')).status).toBe(401);
    const res = await call(`${url}/api/status`, 'GET', TOKENS.alice);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: 'alice', authRequired: true, gemma: { configured: false }, backboard: { configured: false } });
  });

  it('allows the Authorization header in CORS preflight', async () => {
    const url = await start({ A2C_USERS: USERS, ALLOWED_EXTENSION_ORIGIN: EXT });
    const pre = await fetch(`${url}/api/map`, { method: 'OPTIONS', headers: { Origin: EXT, 'Access-Control-Request-Headers': 'authorization,content-type' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
  });
});

describe('Backboard cloud memory', () => {
  it('isolates users with one assistant each and authenticates with X-API-Key', async () => {
    const bb = fakeBackboard();
    const url = await start({ A2C_USERS: USERS, ALLOWED_EXTENSION_ORIGIN: EXT }, { backboard: bb.client });
    expect((await call(`${url}/api/memory`, 'POST', TOKENS.alice, { key: 'college', label: 'College', value: 'Example Institute' })).status).toBe(201);
    expect((await call(`${url}/api/memory`, 'POST', TOKENS.bob, { key: 'skills', label: 'Skills', value: 'Go' })).status).toBe(201);
    expect(bb.assistants.map((a) => a.name)).toEqual(['a2c-memory-alice', 'a2c-memory-bob']);
    const aliceList = await (await call(`${url}/api/memory`, 'GET', TOKENS.alice)).json();
    expect(aliceList.memories).toHaveLength(1);
    expect(aliceList.memories[0]).toMatchObject({ key: 'college', content: 'College (college): Example Institute' });
    expect(bb.calls.every((c) => c.key === 'bb_test_key')).toBe(true);
  });

  it('search is read-only and delete only touches the caller assistant', async () => {
    const bb = fakeBackboard();
    const url = await start({ A2C_USERS: USERS, ALLOWED_EXTENSION_ORIGIN: EXT }, { backboard: bb.client });
    await call(`${url}/api/memory`, 'POST', TOKENS.alice, { key: 'college', label: 'College', value: 'Example Institute' });
    const before = bb.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/memories')).length;
    const found = await (await call(`${url}/api/memory/search`, 'POST', TOKENS.alice, { query: 'college name', limit: 3 })).json();
    expect(found.memories).toHaveLength(1);
    expect(bb.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/memories')).length).toBe(before);
    expect(bb.calls.some((c) => c.path.endsWith('/memories/search'))).toBe(true);
    // Bob cannot see or delete Alice's memory: his requests go to his own assistant.
    const bobFound = await (await call(`${url}/api/memory/search`, 'POST', TOKENS.bob, { query: 'college', limit: 3 })).json();
    expect(bobFound.memories).toHaveLength(0);
    await call(`${url}/api/memory/${found.memories[0].id}`, 'DELETE', TOKENS.bob);
    expect((await (await call(`${url}/api/memory`, 'GET', TOKENS.alice)).json()).memories).toHaveLength(1);
  });

  it('never accepts secrets, credentials or private facts', async () => {
    const bb = fakeBackboard();
    const url = await start({}, { backboard: bb.client });
    for (const body of [
      { key: 'password', label: 'Password', value: 'hunter22' },
      { key: 'nickname', label: 'Nickname', value: '4111 1111 1111 1111' },
      { key: 'phone', label: 'Phone', value: '+1 555 0100' },
      { key: 'date_of_birth', label: 'Date of birth', value: '2000-01-01' },
    ]) {
      expect((await call(`${url}/api/memory`, 'POST', undefined, body)).status).toBe(400);
    }
    expect(bb.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/memories'))).toHaveLength(0);
  });

  it('falls back cleanly when Backboard is not configured or down', async () => {
    const url = await start({});
    expect((await call(`${url}/api/memory`, 'GET')).status).toBe(503);
    const down = createBackboardClient({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9' });
    const url2 = (server?.close(), await start({}, { backboard: down }));
    const res = await call(`${url2}/api/memory/search`, 'POST', undefined, { query: 'x', limit: 1 });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('backboard_unavailable');
  });
});

describe('fine-tuned specialist and retries', () => {
  it('maps through the specialist engine with the shared prompt format', async () => {
    const prompts: string[] = [];
    const specialist: GemmaClient = {
      configured: true,
      model: 'tinker-specialist',
      chat: async (messages) => {
        prompts.push(messages[0]!.content);
        return messages[0]!.content.includes('Developer Repository') ? ' github_url\n' : ' password_value';
      },
      listModels: async () => ({ reachable: true, models: [] }),
    };
    const url = await start({}, { specialist });
    const res = await call(`${url}/api/map?engine=specialist`, 'POST', undefined, {
      fields: [
        { id: 'f_spec00001', label: 'Developer Repository', type: 'url', options: [] },
        { id: 'f_spec00002', label: 'Team name', type: 'text', options: [] },
      ],
      availableMemoryKeys: [{ key: 'github_url', description: 'GitHub', hasValue: true }],
    });
    const data = await res.json();
    expect(data.mappings).toEqual([
      expect.objectContaining({ fieldId: 'f_spec00001', action: 'use_memory', memoryKey: 'github_url' }),
      expect.objectContaining({ fieldId: 'f_spec00002', action: 'ask_user', memoryKey: null }),
    ]);
    expect(prompts[0]).toMatch(/^Map the web form field to one memory key\./);
  });

  it('retries a 5xx once, then succeeds', async () => {
    let calls = 0;
    const client = createChatClient(
      { label: 'Gemma', baseUrl: 'http://x/v1', model: 'm', apiKey: null, jsonResponseFormat: false, mergeSystemPrompt: false, timeoutMs: 1000, maxTokens: 10, maxRetries: 1 },
      (async () => {
        calls += 1;
        return calls === 1 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    expect(await client.chat([{ role: 'user', content: 'hi' }])).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    const client = createChatClient(
      { label: 'Gemma', baseUrl: 'http://x/v1', model: 'm', apiKey: null, jsonResponseFormat: false, mergeSystemPrompt: false, timeoutMs: 1000, maxTokens: 10, maxRetries: 2 },
      (async () => {
        calls += 1;
        return new Response('bad', { status: 404 });
      }) as unknown as typeof fetch,
    );
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ code: 'upstream_error' });
    expect(calls).toBe(1);
  });
});
