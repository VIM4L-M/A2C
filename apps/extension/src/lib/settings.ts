import { z } from 'zod';
import { STORAGE_KEYS, type KV } from './storage';

export const DEFAULT_PROXY_URL = 'http://127.0.0.1:8787';

/** Proxy must be on this machine: the API key lives there, never in the extension. */
export function isLocalProxyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && !u.username && !u.password && u.pathname === '/';
  } catch {
    return false;
  }
}

export const SettingsSchema = z.object({
  aiMode: z.enum(['gemma', 'mock']).default('gemma'),
  proxyUrl: z.string().refine(isLocalProxyUrl).default(DEFAULT_PROXY_URL),
  onboarded: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { aiMode: 'gemma', proxyUrl: DEFAULT_PROXY_URL, onboarded: false };

export async function loadSettings(kv: KV): Promise<Settings> {
  const parsed = SettingsSchema.safeParse((await kv.get(STORAGE_KEYS.settings)) ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(kv: KV, settings: Settings): Promise<void> {
  await kv.set(STORAGE_KEYS.settings, SettingsSchema.parse(settings));
}
