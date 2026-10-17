import { z } from 'zod';
import { ActivitySchema, loadActivity } from './activity';
import { loadSettings } from './settings';
import { type KV, STORAGE_KEYS } from './storage';
import { FactListSchema, prepareFact } from '../memory/facts';

export const WORKSPACE_ORIGIN = 'http://127.0.0.1:5174';
export const BRIDGE_KEY = 'a2c_workspace_grant';
export const PENDING_KEY = 'a2c_workspace_pending';
export const GrantSchema = z.object({ enabled: z.boolean(), shareActivity: z.boolean(), keys: z.array(z.string().max(80)).max(100) });
export const CandidateSchema = z.object({ key: z.string().max(80), label: z.string().max(80), value: z.string().max(2000) }).strict();
export const CandidatesSchema = z.array(CandidateSchema).min(1).max(30);
const RequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot') }).strict(),
  z.object({ type: z.literal('propose'), facts: CandidatesSchema }).strict(),
]);
export const SnapshotSchema = z.object({ ok: z.literal(true), facts: FactListSchema, activity: ActivitySchema.nullable() });
export function trustedWorkspace(url?: string): boolean {
  try { const u = new URL(url ?? ''); return u.origin === WORKSPACE_ORIGIN && u.pathname === '/workspace/workspace.html' && !u.username && !u.password; } catch { return false; }
}
export async function workspaceMessage(raw: unknown, senderUrl: string | undefined, kv: KV): Promise<unknown> {
  if (!trustedWorkspace(senderUrl)) return { ok: false, error: 'origin_denied' };
  const request = RequestSchema.safeParse(raw);
  if (!request.success) return { ok: false, error: 'invalid_request' };
  const grant = GrantSchema.safeParse(await kv.get(BRIDGE_KEY));
  if (!grant.success || !grant.data.enabled) return { ok: false, error: 'Enable the local workspace connection in extension Settings first.' };
  const settings = await loadSettings(kv);
  const parsed = FactListSchema.safeParse(await kv.get(STORAGE_KEYS.memory) ?? []);
  const stored = parsed.success ? parsed.data : [];
  if (request.data.type === 'snapshot') {
    const facts = stored.filter(f => {
      const check = prepareFact({ key: f.key, label: f.label, value: f.value, source: 'manual' });
      return check.ok && check.fact.sensitivity === 'standard' && f.sensitivity === 'standard' && f.verified !== false && f.permission !== 'never' && !settings.disabledCategories.includes(f.category) && grant.data.keys.includes(f.key);
    });
    return { ok: true, facts: facts.map(f => ({ ...f, allowedSites: [], provenance: { ...f.provenance, domain: undefined } })), activity: grant.data.shareActivity ? await loadActivity(kv) : null };
  }
  if (await kv.get(PENDING_KEY)) return { ok: false, error: 'A batch is already waiting for review in extension Settings.' };
  for (const draft of request.data.facts) {
    const existing = stored.find(f => f.key === draft.key);
    const check = prepareFact({ ...draft, source: 'manual' }, existing);
    if (!check.ok || check.fact.sensitivity !== 'standard' || existing?.permission === 'never' || settings.disabledCategories.includes(check.fact.category)) return { ok: false, error: 'Private, denied, disabled or invalid facts cannot be transferred.' };
  }
  // A separate per-fact confirmation in extension Settings is required to save.
  await kv.set(PENDING_KEY, request.data.facts);
  return { ok: true, pending: request.data.facts.length };
}
