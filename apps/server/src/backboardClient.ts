/**
 * Backboard.io REST client (https://app.backboard.io/api, header X-API-Key).
 *
 * Isolation: Backboard memories are scoped to an assistant. A2C creates ONE
 * assistant per authenticated user, named "a2c-memory-<userId>", and never
 * shares an assistant between users. Retrieval uses the memory search
 * endpoint (read-only); writes happen only on an explicit Save request.
 *
 * Endpoints used (from docs.backboard.io):
 *   GET    /assistants?name=<exact>            list assistants by exact name
 *   POST   /assistants {name, system_prompt}   create assistant
 *   GET    /assistants/{id}/memories           list memories
 *   POST   /assistants/{id}/memories           add memory {content, metadata}
 *   POST   /assistants/{id}/memories/search    search {query, limit}
 *   DELETE /assistants/{id}/memories/{mid}     delete memory
 */

export class BackboardError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'unavailable' | 'upstream_error' | 'bad_response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BackboardError';
  }
}

export interface CloudMemory {
  id: string;
  content: string;
  key?: string;
  score?: number;
}

export interface BackboardClient {
  configured: boolean;
  ping(): Promise<boolean>;
  assistantFor(userId: string): Promise<string>;
  list(userId: string): Promise<CloudMemory[]>;
  add(userId: string, content: string, metadata: Record<string, string>): Promise<{ id: string | null }>;
  search(userId: string, query: string, limit: number): Promise<CloudMemory[]>;
  remove(userId: string, memoryId: string): Promise<void>;
}

type FetchLike = typeof fetch;

function toMemory(raw: unknown): CloudMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = m.id ?? m.memory_id;
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof m.content !== 'string') return null;
  const meta = (m.metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(id),
    content: m.content.slice(0, 2000),
    key: typeof meta.a2c_key === 'string' ? meta.a2c_key : undefined,
    score: typeof m.score === 'number' ? m.score : undefined,
  };
}

export function createBackboardClient(opts: { apiKey: string | null; baseUrl: string; timeoutMs?: number }, fetchImpl: FetchLike = fetch): BackboardClient {
  const assistantCache = new Map<string, string>();

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!opts.apiKey) throw new BackboardError('BACKBOARD_API_KEY is not configured', 'not_configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await fetchImpl(`${opts.baseUrl}${path}`, {
        method,
        headers: { 'X-API-Key': opts.apiKey, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new BackboardError('Backboard is unreachable', 'unavailable');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new BackboardError(`Backboard responded with HTTP ${res.status}`, res.status >= 500 ? 'unavailable' : 'upstream_error', res.status);
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function assistantFor(userId: string): Promise<string> {
    const cached = assistantCache.get(userId);
    if (cached) return cached;
    const name = `a2c-memory-${userId}`;
    const found = await call('GET', `/assistants?name=${encodeURIComponent(name)}&limit=2`);
    const list = Array.isArray(found) ? found : [];
    const exact = list.find((a) => (a as { name?: string }).name === name) as { assistant_id?: string } | undefined;
    let id = exact?.assistant_id;
    if (!id) {
      const created = (await call('POST', '/assistants', {
        name,
        system_prompt: 'A2C memory store for a single user. Holds only facts the user explicitly approved for cloud memory.',
      })) as { assistant_id?: string } | null;
      id = created?.assistant_id;
    }
    if (!id) throw new BackboardError('Backboard did not return an assistant id', 'bad_response');
    assistantCache.set(userId, id);
    return id;
  }

  const listFrom = (data: unknown): CloudMemory[] => {
    const arr = Array.isArray((data as { memories?: unknown })?.memories) ? (data as { memories: unknown[] }).memories : [];
    return arr.map(toMemory).filter((m): m is CloudMemory => m !== null);
  };

  return {
    configured: Boolean(opts.apiKey),
    async ping() {
      try {
        await call('GET', '/assistants?limit=1');
        return true;
      } catch {
        return false;
      }
    },
    assistantFor,
    async list(userId) {
      const id = await assistantFor(userId);
      return listFrom(await call('GET', `/assistants/${encodeURIComponent(id)}/memories?page=1&page_size=100`));
    },
    async add(userId, content, metadata) {
      const id = await assistantFor(userId);
      const out = (await call('POST', `/assistants/${encodeURIComponent(id)}/memories`, { content, metadata })) as { memory_id?: unknown; id?: unknown } | null;
      const mid = out?.memory_id ?? out?.id;
      return { id: typeof mid === 'string' || typeof mid === 'number' ? String(mid) : null };
    },
    async search(userId, query, limit) {
      const id = await assistantFor(userId);
      return listFrom(await call('POST', `/assistants/${encodeURIComponent(id)}/memories/search`, { query, limit }));
    },
    async remove(userId, memoryId) {
      const id = await assistantFor(userId);
      await call('DELETE', `/assistants/${encodeURIComponent(id)}/memories/${encodeURIComponent(memoryId)}`);
    },
  };
}
