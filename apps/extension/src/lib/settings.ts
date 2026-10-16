import { z } from 'zod';
import { STORAGE_KEYS, type KV } from './storage';

export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

/**
 * Allowed backends: the local server (http on 127.0.0.1 / localhost) or an
 * HTTPS deployment on Render (*.onrender.com). Must match manifest CSP connect-src.
 * Provider API keys live on the backend, never in the extension.
 */
export function isAllowedBackendUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return false;
    if (u.protocol === 'http:') return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    return u.protocol === 'https:' && /^[a-z0-9-]+\.onrender\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** @deprecated kept for older imports */
export const isLocalProxyUrl = isAllowedBackendUrl;

export const AIModeSchema = z.enum(['gemma', 'specialist', 'mock']);
export type AIModeSetting = z.infer<typeof AIModeSchema>;

export const SettingsSchema = z.object({
  aiMode: AIModeSchema.default('gemma'),
  backendUrl: z.string().refine(isAllowedBackendUrl).default(DEFAULT_BACKEND_URL),
  /** Per-user access token for a deployed backend. Stored in chrome.storage.local (not encrypted). */
  authToken: z.string().max(200).default(''),
  /** Opt-in Backboard cloud memory. */
  cloudMemory: z.boolean().default(false),
  onboarded: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { aiMode: 'gemma', backendUrl: DEFAULT_BACKEND_URL, authToken: '', cloudMemory: false, onboarded: false };

export async function loadSettings(kv: KV): Promise<Settings> {
  const raw = ((await kv.get(STORAGE_KEYS.settings)) ?? {}) as Record<string, unknown>;
  // Migrate the earlier "proxyUrl" field.
  if (raw.proxyUrl && !raw.backendUrl) raw.backendUrl = raw.proxyUrl;
  delete raw.proxyUrl;
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(kv: KV, settings: Settings): Promise<void> {
  await kv.set(STORAGE_KEYS.settings, SettingsSchema.parse(settings));
}
