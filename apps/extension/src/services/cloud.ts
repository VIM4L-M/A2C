import type { MemoryFact } from '@a2c/shared';
import { z } from 'zod';
import { BackendClient, type BackendOptions } from './ai';

/**
 * Opt-in Backboard cloud memory, via the authenticated A2C backend. Only
 * standard (non-private) facts can be saved, and only on an explicit click.
 * Local memory keeps working when the cloud is off or unavailable.
 */

const MemorySchema = z.object({ id: z.string(), content: z.string(), key: z.string().optional(), score: z.number().optional() });
const ListSchema = z.object({ memories: z.array(MemorySchema) });
export type CloudMemory = z.infer<typeof MemorySchema>;

/** Cloud memories are stored as "<label> (<key>): <value>". */
export function cloudValue(m: CloudMemory): string {
  const idx = m.content.indexOf('): ');
  return idx >= 0 ? m.content.slice(idx + 3) : m.content;
}

export function canSyncToCloud(f: MemoryFact): boolean {
  return f.sensitivity === 'standard' && f.permission !== 'never' && f.category !== 'contact';
}

export class CloudMemoryClient {
  private readonly backend: BackendClient;

  constructor(backendUrl: string, opts: BackendOptions = {}) {
    this.backend = new BackendClient(backendUrl, { timeoutMs: 20_000, ...opts });
  }

  async list(): Promise<CloudMemory[]> {
    return ListSchema.parse(await this.backend.request('GET', '/api/memory')).memories;
  }

  async save(f: MemoryFact): Promise<void> {
    if (!canSyncToCloud(f)) throw new Error('Private, contact or "never" facts stay local');
    await this.backend.request('POST', '/api/memory', { key: f.key, label: f.label, value: f.value });
  }

  /** Read-only retrieval. */
  async search(query: string, limit = 5): Promise<CloudMemory[]> {
    return ListSchema.parse(await this.backend.request('POST', '/api/memory/search', { query: query.slice(0, 200), limit })).memories;
  }

  async remove(id: string): Promise<void> {
    await this.backend.request('DELETE', `/api/memory/${encodeURIComponent(id)}`);
  }
}
