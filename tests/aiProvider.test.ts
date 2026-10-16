import { describe, expect, it } from 'vitest';
import { isAllowedBackendUrl } from '../apps/extension/src/lib/settings';
import { checkHealth, checkStatus, GemmaProvider, InferenceError, mapWithFallback, MockProvider } from '../apps/extension/src/services/ai';
import { canSyncToCloud, cloudValue } from '../apps/extension/src/services/cloud';
import { fact } from './helpers';

const request = {
  fields: [{ id: 'f_provider1', label: 'Developer Repository', type: 'url' as const, options: [] }],
  availableMemoryKeys: [{ key: 'github_url', description: 'Public developer profile URL', hasValue: true }],
};

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const LOCAL = 'http://127.0.0.1:8787';

describe('AI providers', () => {
  it('only accepts the local backend or an https Render backend', () => {
    expect(() => new GemmaProvider('https://api.example.com')).toThrow(InferenceError);
    expect(() => new GemmaProvider('http://evil.onrender.com')).toThrow(InferenceError);
    expect(() => new GemmaProvider(LOCAL)).not.toThrow();
    expect(isAllowedBackendUrl('https://a2c-backend.onrender.com/')).toBe(true);
    expect(isAllowedBackendUrl('https://a2c.onrender.com.evil.com/')).toBe(false);
    expect(isAllowedBackendUrl('http://localhost:8787/')).toBe(true);
  });

  it('sends the access token as a Bearer header', async () => {
    let auth: string | null = null;
    const p = new GemmaProvider(LOCAL, {
      token: 'a2c_secret',
      fetchImpl: async (_url, init) => {
        auth = new Headers(init?.headers).get('authorization');
        return new Response(JSON.stringify({ mappings: [] }), { status: 200 });
      },
    });
    await p.mapFields(request);
    expect(auth).toBe('Bearer a2c_secret');
  });

  it('falls back to rules (not labelled Gemma) when the backend is down', async () => {
    const down = new GemmaProvider(LOCAL, {
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(down.mapFields(request)).rejects.toMatchObject({ code: 'proxy_unreachable' });
    const out = await mapWithFallback(down, request);
    expect(out.source).toBe('rules');
    expect(out.error).toMatch(/not reachable/);
    expect(out.raw).toMatchObject({ mappings: [{ fieldId: 'f_provider1', memoryKey: 'github_url' }] });
  });

  it('surfaces missing model credentials / configuration', async () => {
    const p = new GemmaProvider(LOCAL, { fetchImpl: json(503, { error: 'not_configured', message: 'x' }) });
    await expect(p.mapFields(request)).rejects.toMatchObject({ code: 'not_configured' });
    const q = new GemmaProvider(LOCAL, { fetchImpl: json(401, { error: 'unauthorized' }) });
    await expect(q.mapFields(request)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects invalid responses from the backend', async () => {
    const p = new GemmaProvider(LOCAL, { fetchImpl: json(200, { mappings: [{ fieldId: 'f_provider1', action: 'click', confidence: 1 }] }) });
    await expect(p.mapFields(request)).rejects.toMatchObject({ code: 'invalid_model_output' });
  });

  it('uses Gemma or specialist output when valid', async () => {
    const ok = json(200, { mappings: [{ fieldId: 'f_provider1', action: 'use_memory', memoryKey: 'github_url', transform: 'none', confidence: 0.97, reason: 'repo' }] });
    expect((await mapWithFallback(new GemmaProvider(LOCAL, { fetchImpl: ok }), request)).source).toBe('gemma');
    let url = '';
    const spec = new GemmaProvider(LOCAL, {
      engine: 'specialist',
      fetchImpl: async (u) => {
        url = String(u);
        return ok();
      },
    });
    expect((await mapWithFallback(spec, request)).source).toBe('specialist');
    expect(url).toContain('engine=specialist');
  });

  it('mock provider is deterministic and labelled mock', async () => {
    const m = new MockProvider();
    const out = await mapWithFallback(m, request);
    expect(out.source).toBe('mock');
    const d = await m.draftAnswer({ fieldId: 'f_provider1', question: 'Why join?', maxLength: 300, facts: [{ key: 'college', label: 'College', value: 'Example Institute' }] });
    expect(d.draft).toContain('Example Institute');
    expect(d.draft).not.toMatch(/\b(19|20)\d\d\b/); // no invented dates
  });

  it('health and status checks never report success without a real response', async () => {
    expect((await checkHealth(LOCAL, async () => Promise.reject(new Error('x')))).status).toBe('unreachable');
    expect((await checkHealth(LOCAL, json(200, { ok: true, configured: false, model: null }))).status).toBe('not_configured');
    expect(await checkHealth(LOCAL, json(200, { ok: true, configured: true, model: 'google/gemma-4-E4B-it' }))).toMatchObject({ status: 'ok' });
    expect((await checkStatus(LOCAL, '', true, async () => Promise.reject(new Error('down')))).state).toBe('unreachable');
    expect((await checkStatus(LOCAL, 'bad', true, json(401, { error: 'unauthorized' }))).state).toBe('unauthorized');
    const status = {
      ok: true,
      user: 'local',
      authRequired: false,
      gemma: { configured: true, model: 'hf.co/google/gemma-4-E4B-it-qat-q4_0-gguf', reachable: true, models: [] },
      specialist: { configured: false, model: null, reachable: null },
      backboard: { configured: false, reachable: null },
    };
    expect(await checkStatus(LOCAL, '', true, json(200, status))).toMatchObject({ state: 'ok', data: { gemma: { reachable: true } } });
  });
});

describe('cloud memory client rules', () => {
  it('only standard, non-contact, usable facts may be synced', () => {
    expect(canSyncToCloud(fact('college', 'Example Institute'))).toBe(true);
    expect(canSyncToCloud(fact('email', 'a@example.com'))).toBe(false);
    expect(canSyncToCloud(fact('phone', '+1 555', { sensitivity: 'private' }))).toBe(false);
    expect(canSyncToCloud(fact('skills', 'Go', { permission: 'never' }))).toBe(false);
    expect(cloudValue({ id: '1', content: 'College (college): Example Institute' })).toBe('Example Institute');
  });
});
