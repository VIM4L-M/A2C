/**
 * Proxy configuration from environment variables. Nothing here is guessed:
 * GEMMA_BASE_URL and GEMMA_MODEL must match what your inference server
 * actually exposes (see README "Connecting Gemma 4").
 */
export interface ProxyConfig {
  host: string;
  port: number;
  gemmaBaseUrl: string | null;
  gemmaModel: string | null;
  gemmaApiKey: string | null;
  /** Send OpenAI-style response_format {type:"json_object"} (retried without on 400). */
  jsonResponseFormat: boolean;
  /** Fold the system prompt into the first user turn. */
  mergeSystemPrompt: boolean;
  timeoutMs: number;
  maxTokens: number;
  /** Exact chrome-extension://<id> origins. Empty = any chrome-extension:// origin (development). */
  allowedOrigins: string[];
  rateLimitPerMinute: number;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function int(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const baseUrl = env.GEMMA_BASE_URL?.trim().replace(/\/+$/, '') || null;
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: int(env.PORT, 8787, 1, 65535),
    gemmaBaseUrl: baseUrl,
    gemmaModel: env.GEMMA_MODEL?.trim() || null,
    gemmaApiKey: env.GEMMA_API_KEY?.trim() || null,
    jsonResponseFormat: bool(env.GEMMA_JSON_MODE, true),
    mergeSystemPrompt: bool(env.GEMMA_MERGE_SYSTEM_PROMPT, false),
    timeoutMs: int(env.GEMMA_TIMEOUT_MS, 90_000, 1_000, 600_000),
    maxTokens: int(env.GEMMA_MAX_TOKENS, 2048, 64, 8192),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 60, 1, 10_000),
  };
}

export function isConfigured(c: ProxyConfig): boolean {
  return Boolean(c.gemmaBaseUrl && c.gemmaModel);
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
