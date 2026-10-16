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
import { isAllowedBackendUrl } from '../lib/settings';

/**
 * AI provider interface. GemmaProvider talks to the A2C backend (local or
 * Render), which holds the Gemma endpoint and API keys. engine "specialist"
 * asks the backend for the optional Tinker-fine-tuned mapping model instead.
 * MockProvider is deterministic and always labelled MOCK MODE in the UI.
 * All providers return declarative mappings only; the policy engine decides.
 */
export interface AIProvider {
  readonly kind: 'gemma' | 'specialist' | 'mock';
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

export interface BackendOptions {
  token?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Authenticated JSON calls to the A2C backend. */
export class BackendClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    readonly baseUrl: string,
    private readonly opts: BackendOptions = {},
  ) {
    if (!isAllowedBackendUrl(baseUrl)) throw new InferenceError('Backend must be http://127.0.0.1:<port>, http://localhost:<port> or https://<name>.onrender.com', 'bad_backend_url');
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  async request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = this.opts.timeoutMs ?? 300_000): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new InferenceError('Request to the A2C backend timed out', 'timeout');
      throw new InferenceError('A2C backend is not reachable. Start it with "npm run start:server" or check Settings.', 'proxy_unreachable');
    } finally {
      clearTimeout(timer);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new InferenceError(`Backend returned HTTP ${res.status} without JSON`, 'bad_response');
    }
    if (!res.ok) {
      const e = ErrorBodySchema.safeParse(data);
      const code = e.success ? e.data.error : `http_${res.status}`;
      const message =
        code === 'not_configured'
          ? 'Gemma is not configured on the backend (set GEMMA_BASE_URL and GEMMA_MODEL).'
          : code === 'unauthorized'
            ? 'The backend rejected your access token (Settings).'
            : e.success && e.data.message
              ? e.data.message
              : `Backend error (${code})`;
      throw new InferenceError(message, code);
    }
    return data;
  }
}

export class GemmaProvider implements AIProvider {
  readonly kind: 'gemma' | 'specialist';
  private readonly backend: BackendClient;

  constructor(backendUrl: string, opts: BackendOptions & { engine?: 'gemma' | 'specialist' } = {}) {
    this.backend = new BackendClient(backendUrl, opts);
    this.kind = opts.engine ?? 'gemma';
  }

  async mapFields(request: FieldMappingRequest): Promise<FieldMappingResponse> {
    const body = FieldMappingRequestSchema.parse(request);
    const data = await this.backend.request('POST', this.kind === 'specialist' ? '/api/map?engine=specialist' : '/api/map', body);
    const parsed = FieldMappingResponseSchema.safeParse(data);
    if (!parsed.success) throw new InferenceError('Model mapping response failed validation', 'invalid_model_output');
    return parsed.data;
  }

  async draftAnswer(request: DraftRequest): Promise<DraftResponse> {
    // Drafts always use Gemma 4.
    const body = DraftRequestSchema.parse(request);
    const data = await this.backend.request('POST', '/api/draft', body);
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
 * Map with the model, falling back to the deterministic rules when inference
 * is unavailable. The fallback is reported as "rules", never as the model.
 */
export async function mapWithFallback(provider: AIProvider, request: FieldMappingRequest): Promise<MappingOutcome> {
  if (provider.kind === 'mock') return { raw: await provider.mapFields(request), source: 'mock' };
  try {
    return { raw: await provider.mapFields(request), source: provider.kind };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model request failed';
    return { raw: deterministicMap(request), source: 'rules', error: message };
  }
}

// ---------------------------------------------------------------------------
// Health / status
// ---------------------------------------------------------------------------

export const HealthSchema = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  model: z.string().nullable(),
});

export type ProxyHealth =
  | { status: 'ok'; model: string }
  | { status: 'not_configured' }
  | { status: 'unreachable'; message: string };

export async function checkHealth(backendUrl: string, fetchImpl: FetchLike = (...a) => fetch(...a)): Promise<ProxyHealth> {
  if (!isAllowedBackendUrl(backendUrl)) return { status: 'unreachable', message: 'Backend URL not allowed' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    const res = await fetchImpl(new URL('/api/health', backendUrl).toString(), { signal: controller.signal });
    clearTimeout(timer);
    const parsed = HealthSchema.safeParse(await res.json());
    if (!parsed.success) return { status: 'unreachable', message: 'Unexpected health response' };
    if (!parsed.data.configured || !parsed.data.model) return { status: 'not_configured' };
    return { status: 'ok', model: parsed.data.model };
  } catch {
    return { status: 'unreachable', message: 'Backend not running' };
  }
}

const StatusSchema = z.object({
  ok: z.boolean(),
  user: z.string(),
  authRequired: z.boolean(),
  gemma: z.object({ configured: z.boolean(), model: z.string().nullable(), reachable: z.boolean().nullable(), models: z.array(z.string()).default([]) }),
  specialist: z.object({ configured: z.boolean(), model: z.string().nullable(), reachable: z.boolean().nullable() }),
  backboard: z.object({ configured: z.boolean(), reachable: z.boolean().nullable() }),
});

export type BackendStatus = { state: 'ok'; data: z.infer<typeof StatusSchema> } | { state: 'unauthorized' } | { state: 'unreachable'; message: string };

/** Real connection check used by Settings. Nothing is shown as connected without it. */
export async function checkStatus(backendUrl: string, token: string, probe: boolean, fetchImpl?: FetchLike): Promise<BackendStatus> {
  try {
    const client = new BackendClient(backendUrl, { token, fetchImpl, timeoutMs: probe ? 15_000 : 6_000 });
    const parsed = StatusSchema.safeParse(await client.request('GET', `/api/status${probe ? '?probe=1' : ''}`));
    if (!parsed.success) return { state: 'unreachable', message: 'Unexpected status response' };
    return { state: 'ok', data: parsed.data };
  } catch (err) {
    if (err instanceof InferenceError && err.code === 'unauthorized') return { state: 'unauthorized' };
    return { state: 'unreachable', message: err instanceof Error ? err.message : 'Backend not reachable' };
  }
}
