import {
  catalogEntry,
  classifyMemoryKey,
  detectSecretValue,
  looksLikeOneTimeCode,
  MEMORY_KEY_RE,
  sanitizeLabel,
  type MemoryCategory,
  type MemoryFact,
  type MemoryPermission,
  type ProvenanceSource,
} from '@contextfill/shared';
import { z } from 'zod';

export const MemoryFactSchema = z.object({
  key: z.string().regex(MEMORY_KEY_RE),
  label: z.string().min(1).max(80),
  value: z.string().max(2000),
  category: z.enum(['identity', 'contact', 'education', 'work', 'links', 'skills', 'other']),
  permission: z.enum(['auto', 'ask', 'never']),
  sensitivity: z.enum(['standard', 'private']),
  allowedSites: z.array(z.string().max(253)).max(100).default([]),
  provenance: z.object({
    source: z.enum(['manual', 'onboarding', 'form_approved', 'document_approved']),
    domain: z.string().max(253).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const FactListSchema = z.array(MemoryFactSchema).max(500);

export interface FactDraft {
  key: string;
  label?: string;
  value: string;
  permission?: MemoryPermission;
  category?: MemoryCategory;
  source: ProvenanceSource;
  domain?: string;
}

export type FactCheck =
  | { ok: true; fact: MemoryFact; needsExtraConfirm: boolean }
  | { ok: false; error: string };

/**
 * Validate a fact BEFORE it is written. Credentials and secret-like values are
 * refused regardless of what the label says; amber (sensitive) facts become
 * private and require extra confirmation.
 */
export function prepareFact(draft: FactDraft, existing?: MemoryFact, now = new Date()): FactCheck {
  const key = draft.key.trim();
  if (!MEMORY_KEY_RE.test(key)) return { ok: false, error: 'Key must be lowercase letters, digits and underscores' };
  const entry = catalogEntry(key);
  const label = sanitizeLabel(draft.label || entry?.label || key, 80);
  const value = draft.value.trim();
  if (!value) return { ok: false, error: 'Value is empty' };
  if (value.length > 2000) return { ok: false, error: 'Value is too long (max 2000 characters)' };

  const cls = classifyMemoryKey(key, label);
  if (cls.risk === 'red') {
    return { ok: false, error: `${cls.reason}: credentials and secrets are never stored. Use your browser's password manager.` };
  }
  const secret = detectSecretValue(value);
  if (secret.secret) return { ok: false, error: `${secret.reason}: secret-like values are never stored.` };
  if (looksLikeOneTimeCode(value, `${key} ${label}`)) return { ok: false, error: 'Looks like a one-time code: not stored.' };

  // Catalog keys carry a reviewed sensitivity; custom keys that classify as amber become private.
  const sensitivity = entry ? entry.sensitivity : cls.risk === 'amber' ? 'private' : 'standard';
  const iso = now.toISOString();
  const fact: MemoryFact = {
    key,
    label,
    value,
    category: draft.category ?? entry?.category ?? existing?.category ?? 'other',
    permission: draft.permission ?? existing?.permission ?? entry?.defaultPermission ?? (sensitivity === 'private' ? 'ask' : 'auto'),
    sensitivity,
    allowedSites: existing?.allowedSites ?? [],
    provenance: {
      source: existing?.provenance.source ?? draft.source,
      domain: existing?.provenance.domain ?? draft.domain,
      createdAt: existing?.provenance.createdAt ?? iso,
      updatedAt: iso,
    },
  };
  return { ok: true, fact, needsExtraConfirm: sensitivity === 'private' || cls.risk === 'amber' };
}

/** Example values for demos only. Clearly fake; never real user data. */
export const DEMO_PROFILE: Array<{ key: string; value: string }> = [
  { key: 'full_name', value: 'Alex Example' },
  { key: 'email', value: 'alex@example.com' },
  { key: 'college', value: 'Example Institute of Technology' },
  { key: 'degree', value: 'B.Tech' },
  { key: 'major', value: 'Computer Science' },
  { key: 'skills', value: 'Python, React, TypeScript' },
  { key: 'github_url', value: 'https://github.com/example' },
  { key: 'portfolio_url', value: 'https://example.dev' },
  { key: 'country', value: 'India' },
];
