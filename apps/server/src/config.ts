import { parseUsers, type UserRecord } from './auth';

/**
 * Server configuration from environment variables. Nothing here is guessed:
 * GEMMA_BASE_URL and GEMMA_MODEL must match what your inference server
 * actually exposes (see README "Connecting Gemma 4").
 */
export interface ChatTarget {
  label: string;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  /** Send OpenAI-style response_format {type:"json_object"} (retried without on 400). */
  jsonResponseFormat: boolean;
  /** Fold the system prompt into the first user turn. */
  mergeSystemPrompt: boolean;
  timeoutMs: number;
  maxTokens: number;
  /** Extra attempts after a timeout / 5xx / network failure. */
  maxRetries: number;
}

export interface ProxyConfig {
  host: string;
  port: number;
  production: boolean;
  gemmaBaseUrl: string | null;
  gemmaModel: string | null;
  gemmaApiKey: string | null;
  jsonResponseFormat: boolean;
  mergeSystemPrompt: boolean;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  /** Exact chrome-extension://<id> origins. Empty = any chrome-extension:// origin (local development only). */
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  /** Authenticated users. Empty = local single-user development mode (loopback only). */
  users: UserRecord[];
  backboardApiKey: string | null;
  backboardBaseUrl: string;
  specialistBaseUrl: string | null;
  specialistModel: string | null;
  specialistApiKey: string | null;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function int(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const url = (v: string | undefined) => v?.trim().replace(/\/+$/, '') || null;
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const production = env.NODE_ENV === 'production' || Boolean(env.RENDER);
  return {
    // Render (and other PaaS) require binding to 0.0.0.0 and set PORT.
    host: env.HOST?.trim() || (production ? '0.0.0.0' : '127.0.0.1'),
    port: int(env.PORT, 8787, 1, 65535),
    production,
    gemmaBaseUrl: url(env.GEMMA_BASE_URL),
    gemmaModel: env.GEMMA_MODEL?.trim() || null,
    gemmaApiKey: env.GEMMA_API_KEY?.trim() || null,
    jsonResponseFormat: bool(env.GEMMA_JSON_MODE, true),
    mergeSystemPrompt: bool(env.GEMMA_MERGE_SYSTEM_PROMPT, false),
    timeoutMs: int(env.GEMMA_TIMEOUT_MS, 90_000, 1_000, 600_000),
    maxTokens: int(env.GEMMA_MAX_TOKENS, 2048, 64, 8192),
    maxRetries: int(env.GEMMA_MAX_RETRIES, 1, 0, 3),
    allowedOrigins: [...new Set([...list(env.ALLOWED_EXTENSION_ORIGIN), ...list(env.ALLOWED_ORIGINS)])],
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 60, 1, 10_000),
    users: parseUsers(env.A2C_USERS),
    backboardApiKey: env.BACKBOARD_API_KEY?.trim() || null,
    backboardBaseUrl: url(env.BACKBOARD_BASE_URL) ?? 'https://app.backboard.io/api',
    specialistBaseUrl: url(env.SPECIALIST_BASE_URL),
    specialistModel: env.SPECIALIST_MODEL?.trim() || null,
    specialistApiKey: env.SPECIALIST_API_KEY?.trim() || null,
  };
}

export function gemmaTarget(c: ProxyConfig): ChatTarget {
  return {
    label: 'Gemma',
    baseUrl: c.gemmaBaseUrl,
    model: c.gemmaModel,
    apiKey: c.gemmaApiKey,
    jsonResponseFormat: c.jsonResponseFormat,
    mergeSystemPrompt: c.mergeSystemPrompt,
    timeoutMs: c.timeoutMs,
    maxTokens: c.maxTokens,
    maxRetries: c.maxRetries,
  };
}

export function specialistTarget(c: ProxyConfig): ChatTarget {
  return {
    label: 'Specialist',
    baseUrl: c.specialistBaseUrl,
    model: c.specialistModel,
    apiKey: c.specialistApiKey,
    jsonResponseFormat: false,
    mergeSystemPrompt: false,
    timeoutMs: Math.min(c.timeoutMs, 60_000),
    maxTokens: 12,
    maxRetries: c.maxRetries,
  };
}

export function isConfigured(c: ProxyConfig): boolean {
  return Boolean(c.gemmaBaseUrl && c.gemmaModel);
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** Startup guard: never expose an unauthenticated server beyond localhost. */
export function configProblems(c: ProxyConfig): string[] {
  const problems: string[] = [];
  if (!isLoopback(c.host)) {
    if (c.users.length === 0) problems.push('A2C_USERS must be set when the server is not bound to localhost (run: npm run token -- <userId>).');
    if (c.allowedOrigins.length === 0) problems.push('ALLOWED_EXTENSION_ORIGIN must be set to chrome-extension://<your extension id> for a public server.');
  }
  return problems;
}
