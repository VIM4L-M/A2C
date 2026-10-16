import {
  deterministicMap,
  DraftRequestSchema,
  DraftResponseSchema,
  FieldMappingRequestSchema,
  FieldMappingResponseSchema,
  mockDraft,
  type DraftRequest,
  type DraftResponse,
  type FieldMappingRequest,
  type FieldMappingResponse,
  type MappingSource,
} from '@a2c/shared';
import { z } from 'zod';
import { isLocalProxyUrl } from '../lib/settings';

/**
 * AI provider interface. GemmaProvider talks to the local proxy (which holds
 * the Gemma endpoint + API key). MockProvider is deterministic and is always
 * labelled MOCK MODE in the UI. Both return declarative mappings only.
 */
export interface AIProvider {
  readonly kind: 'gemma' | 'mock';
  mapFields(request: FieldMappingRequest): Promise<FieldMappingResponse>;
  draftAnswer(request: DraftRequest): Promise<DraftResponse>;
}

export class InferenceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}

const ErrorBodySchema = z.object({ error: z.string().max(60), message: z.string().max(300).optional() });

type FetchLike = typeof fetch;

export class GemmaProvider implements AIProvider {
  readonly kind = 'gemma' as const;

  constructor(
    private readonly proxyUrl: string,
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
    private readonly timeoutMs = 120_000,
  ) {
    if (!isLocalProxyUrl(proxyUrl)) throw new InferenceError('Proxy URL must be http://127.0.0.1:<port> or http://localhost:<port>', 'bad_proxy_url');
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.proxyUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new InferenceError('Gemma request timed out', 'timeout');
      throw new InferenceError('Local Gemma proxy is not reachable. Start it with "npm run start:server".', 'proxy_unreachable');
    } finally {
      clearTimeout(timer);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new InferenceError(`Proxy returned HTTP ${res.status} without JSON`, 'bad_response');
    }
    if (!res.ok) {
      const e = ErrorBodySchema.safeParse(data);
      const code = e.success ? e.data.error : `http_${res.status}`;
      const message =
        code === 'not_configured'
          ? 'Gemma is not configured on the proxy (set GEMMA_BASE_URL and GEMMA_MODEL).'
          : e.success && e.data.message
            ? e.data.message
            : `Proxy error (${code})`;
      throw new InferenceError(message, code);
    }
    return data;
  }

  async mapFields(request: FieldMappingRequest): Promise<FieldMappingResponse> {
    const body = FieldMappingRequestSchema.parse(request);
    const data = await this.post('/api/map', body);
    const parsed = FieldMappingResponseSchema.safeParse(data);
    if (!parsed.success) throw new InferenceError('Gemma mapping response failed validation', 'invalid_model_output');
    return parsed.data;
  }

  async draftAnswer(request: DraftRequest): Promise<DraftResponse> {
    const body = DraftRequestSchema.parse(request);
    const data = await this.post('/api/draft', body);
    const parsed = DraftResponseSchema.safeParse(data);
    if (!parsed.success) throw new InferenceError('Gemma draft response failed validation', 'invalid_model_output');
    return parsed.data;
  }
}

export class MockProvider implements AIProvider {
  readonly kind = 'mock' as const;

  async mapFields(request: FieldMappingRequest): Promise<FieldMappingResponse> {
    return deterministicMap(FieldMappingRequestSchema.parse(request));
  }

  async draftAnswer(request: DraftRequest): Promise<DraftResponse> {
    return mockDraft(DraftRequestSchema.parse(request));
  }
}

export interface MappingOutcome {
  raw: unknown;
  source: MappingSource;
  error?: string;
}

/**
 * Map with Gemma, falling back to the deterministic rules when inference is
 * unavailable. The fallback is reported as "rules", never as Gemma.
 */
export async function mapWithFallback(provider: AIProvider, request: FieldMappingRequest): Promise<MappingOutcome> {
  if (provider.kind === 'mock') return { raw: await provider.mapFields(request), source: 'mock' };
  try {
    return { raw: await provider.mapFields(request), source: 'gemma' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemma request failed';
    return { raw: deterministicMap(request), source: 'rules', error: message };
  }
}

export const HealthSchema = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  model: z.string().nullable(),
  upstreamHost: z.string().nullable().optional(),
  upstream: z.object({ reachable: z.boolean(), models: z.array(z.string()) }).nullable().optional(),
});

export type ProxyHealth =
  | { status: 'ok'; model: string; upstreamReachable?: boolean; models?: string[] }
  | { status: 'not_configured' }
  | { status: 'unreachable'; message: string };

export async function checkHealth(proxyUrl: string, probe = false, fetchImpl: FetchLike = (...a) => fetch(...a)): Promise<ProxyHealth> {
  if (!isLocalProxyUrl(proxyUrl)) return { status: 'unreachable', message: 'Proxy URL must be local' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    const res = await fetchImpl(new URL(`/api/health${probe ? '?probe=1' : ''}`, proxyUrl).toString(), { signal: controller.signal });
    clearTimeout(timer);
    const parsed = HealthSchema.safeParse(await res.json());
    if (!parsed.success) return { status: 'unreachable', message: 'Unexpected health response' };
    if (!parsed.data.configured || !parsed.data.model) return { status: 'not_configured' };
    return {
      status: 'ok',
      model: parsed.data.model,
      upstreamReachable: parsed.data.upstream?.reachable,
      models: parsed.data.upstream?.models,
    };
  } catch {
    return { status: 'unreachable', message: 'Proxy not running' };
  }
}
