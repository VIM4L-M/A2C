import { describe, expect, it } from 'vitest';
import { checkHealth, GemmaProvider, InferenceError, mapWithFallback, MockProvider } from '../apps/extension/src/services/ai';

const request = {
  fields: [{ id: 'f_provider1', label: 'Developer Repository', type: 'url' as const, options: [] }],
  availableMemoryKeys: [{ key: 'github_url', description: 'Public developer profile URL', hasValue: true }],
};

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AI providers', () => {
  it('only accepts a local proxy URL', () => {
    expect(() => new GemmaProvider('https://api.example.com')).toThrow(InferenceError);
    expect(() => new GemmaProvider('http://127.0.0.1:8787')).not.toThrow();
  });

  it('falls back to rules (not labelled Gemma) when the proxy is down', async () => {
    const down = new GemmaProvider('http://127.0.0.1:8787', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(down.mapFields(request)).rejects.toMatchObject({ code: 'proxy_unreachable' });
    const out = await mapWithFallback(down, request);
    expect(out.source).toBe('rules');
    expect(out.error).toMatch(/not reachable/);
    expect(out.raw).toMatchObject({ mappings: [{ fieldId: 'f_provider1', memoryKey: 'github_url' }] });
  });

  it('surfaces "not configured" from the proxy', async () => {
    const p = new GemmaProvider('http://127.0.0.1:8787', json(503, { error: 'not_configured', message: 'x' }));
    await expect(p.mapFields(request)).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('rejects invalid responses from the proxy', async () => {
    const p = new GemmaProvider('http://127.0.0.1:8787', json(200, { mappings: [{ fieldId: 'f_provider1', action: 'click', confidence: 1 }] }));
    await expect(p.mapFields(request)).rejects.toMatchObject({ code: 'invalid_model_output' });
  });

  it('uses Gemma output when valid', async () => {
    const p = new GemmaProvider(
      'http://127.0.0.1:8787',
      json(200, { mappings: [{ fieldId: 'f_provider1', action: 'use_memory', memoryKey: 'github_url', transform: 'none', confidence: 0.97, reason: 'repo' }] }),
    );
    expect((await mapWithFallback(p, request)).source).toBe('gemma');
  });

  it('mock provider is deterministic and labelled mock', async () => {
    const m = new MockProvider();
    const out = await mapWithFallback(m, request);
    expect(out.source).toBe('mock');
    const d = await m.draftAnswer({ fieldId: 'f_provider1', question: 'Why join?', maxLength: 300, facts: [{ key: 'college', label: 'College', value: 'Example Institute' }] });
    expect(d.draft).toContain('Example Institute');
    expect(d.draft).not.toMatch(/\b(19|20)\d\d\b/); // no invented dates
  });

  it('health check distinguishes unreachable / not configured / ok', async () => {
    expect((await checkHealth('http://127.0.0.1:8787', false, async () => Promise.reject(new Error('x')))).status).toBe('unreachable');
    expect((await checkHealth('http://127.0.0.1:8787', false, json(200, { ok: true, configured: false, model: null }))).status).toBe('not_configured');
    expect(await checkHealth('http://127.0.0.1:8787', false, json(200, { ok: true, configured: true, model: 'google/gemma-4-E4B-it' }))).toMatchObject({
      status: 'ok',
      model: 'google/gemma-4-E4B-it',
    });
  });
});
