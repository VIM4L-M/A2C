import { z } from 'zod';
import { STORAGE_KEYS, type KV } from './storage';

/**
 * Activity log: counts only. No values, labels, domains, documents or
 * submissions are recorded.
 */

const EventSchema = z.object({
  type: z.enum(['scan', 'fill', 'document', 'memory_saved']),
  at: z.string(),
  filled: z.number().int().nonnegative().default(0),
  skipped: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  blocked: z.number().int().nonnegative().default(0),
});

export const ActivitySchema = z.object({
  scans: z.number().int().nonnegative().default(0),
  fieldsFilled: z.number().int().nonnegative().default(0),
  fieldsSkipped: z.number().int().nonnegative().default(0),
  fieldsFailed: z.number().int().nonnegative().default(0),
  fieldsBlocked: z.number().int().nonnegative().default(0),
  documentsCompleted: z.number().int().nonnegative().default(0),
  factsSaved: z.number().int().nonnegative().default(0),
  recent: z.array(EventSchema).default([]),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityEvent = z.input<typeof EventSchema>;

export const EMPTY_ACTIVITY: Activity = ActivitySchema.parse({});

export async function loadActivity(kv: KV): Promise<Activity> {
  const parsed = ActivitySchema.safeParse((await kv.get(STORAGE_KEYS.activity)) ?? {});
  return parsed.success ? parsed.data : EMPTY_ACTIVITY;
}

export async function recordActivity(kv: KV, event: Omit<ActivityEvent, 'at'>): Promise<Activity> {
  const a = await loadActivity(kv);
  const e = EventSchema.parse({ ...event, at: new Date().toISOString() });
  const next: Activity = {
    ...a,
    scans: a.scans + (e.type === 'scan' ? 1 : 0),
    fieldsFilled: a.fieldsFilled + e.filled,
    fieldsSkipped: a.fieldsSkipped + e.skipped,
    fieldsFailed: a.fieldsFailed + e.failed,
    fieldsBlocked: a.fieldsBlocked + e.blocked,
    documentsCompleted: a.documentsCompleted + (e.type === 'document' ? 1 : 0),
    factsSaved: a.factsSaved + (e.type === 'memory_saved' ? 1 : 0),
    recent: [e, ...a.recent].slice(0, 25),
  };
  await kv.set(STORAGE_KEYS.activity, next);
  return next;
}

export async function clearActivity(kv: KV): Promise<void> {
  await kv.remove(STORAGE_KEYS.activity);
}
