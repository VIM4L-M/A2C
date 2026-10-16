/**
 * Small key-value abstraction over chrome.storage.local so that memory and
 * vault logic can be unit-tested with an in-memory store.
 * NOTE: chrome.storage.local is NOT encrypted. Private facts go through the vault.
 */
export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export const chromeKV: KV = {
  async get<T>(key: string) {
    const out = await chrome.storage.local.get(key);
    return out[key] as T | undefined;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

export function memoryKV(initial: Record<string, unknown> = {}): KV & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    async get<T>(key: string) {
      return (key in data ? structuredClone(data[key]) : undefined) as T | undefined;
    },
    async set(key, value) {
      data[key] = structuredClone(value);
    },
    async remove(key) {
      delete data[key];
    },
  };
}

export function defaultKV(): KV {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chromeKV : memoryKV();
}

export const STORAGE_KEYS = {
  memory: 'cf_memory_v1',
  vault: 'cf_vault_v1',
  settings: 'cf_settings_v1',
  activity: 'cf_activity_v1',
} as const;
