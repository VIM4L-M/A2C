import { catalogEntry, MEMORY_CATALOG } from '../memory/catalog';
import {
  FieldMappingResponseSchema,
  MEMORY_KEY_RE,
  type AIField,
  type FieldMapping,
  type FieldMappingRequest,
  type FieldOption,
  type MappingAction,
  type MemoryKeyDescriptor,
  type ScanResult,
  type ScannedField,
  type Transform,
} from '../schemas';
import { detectSecretValue } from '../security/secretDetector';
import { humanizeKey, normalizeText, slugifyKey } from '../security/normalize';
import type { FillStatus, MappingSource, MemoryFact } from '../types';

/**
 * The policy layer sits between the model and the DOM. Model output is only a
 * suggestion: every mapping is re-validated against the latest scan, the
 * user's memory, permissions and the local risk classification.
 */

export const MIN_CONFIDENCE = 0.5;
export const AUTO_APPROVE_CONFIDENCE = 0.75;

export interface Proposal {
  fieldId: string;
  field: ScannedField;
  status: FillStatus;
  action: MappingAction | null;
  memoryKey: string | null;
  transform: Transform;
  /** string for text/select/radio, string[] for checkbox groups. */
  value: string | string[];
  confidence: number;
  reason: string;
  source: MappingSource;
  approvalRequired: boolean;
  approved: boolean;
  allowOverwrite: boolean;
  /** For status "missing": which fact to ask for. */
  missingKey?: string;
  missingLabel?: string;
  note?: string;
}

export interface PolicyContext {
  scan: ScanResult;
  /** Only facts currently available (vault unlocked for private ones). */
  facts: Map<string, MemoryFact>;
  /** Private keys that exist but are locked in the vault. */
  lockedKeys?: Set<string>;
  /** Exactly the keys that were offered to the model. */
  offeredKeys: Set<string>;
  domain: string;
  source: MappingSource;
}

export interface PolicyResult {
  proposals: Proposal[];
  issues: string[];
}

// ---------------------------------------------------------------------------
// Request building: what the model may see
// ---------------------------------------------------------------------------

export function isAIEligible(field: ScannedField): boolean {
  return field.risk === 'green' || field.risk === 'amber';
}

export function toAIField(field: ScannedField): AIField {
  return {
    id: field.id,
    label: field.label,
    type: field.kind,
    hint: field.hint,
    section: field.section,
    required: field.required,
    options: field.options.map((o) => o.label || o.value).slice(0, 100),
  };
}

/** Keys + descriptions only. Values never leave the extension for mapping. */
export function buildMemoryKeyDescriptors(facts: MemoryFact[], lockedKeys: Set<string> = new Set()): MemoryKeyDescriptor[] {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const out: MemoryKeyDescriptor[] = [];
  for (const entry of MEMORY_CATALOG) {
    const fact = byKey.get(entry.key);
    if (fact?.permission === 'never') continue;
    out.push({ key: entry.key, description: entry.description, hasValue: Boolean(fact?.value) || lockedKeys.has(entry.key) });
  }
  for (const fact of facts) {
    if (catalogEntry(fact.key) || fact.permission === 'never' || !MEMORY_KEY_RE.test(fact.key)) continue;
    out.push({ key: fact.key, description: `User-defined: ${fact.label}`.slice(0, 160), hasValue: Boolean(fact.value) });
  }
  return out;
}

export function buildMappingRequest(scan: ScanResult, facts: MemoryFact[], lockedKeys?: Set<string>): FieldMappingRequest | null {
  const fields = scan.fields.filter(isAIEligible).map(toAIField);
  if (fields.length === 0) return null;
  return { fields, availableMemoryKeys: buildMemoryKeyDescriptors(facts, lockedKeys) };
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

export function applyTransform(value: string, transform: Transform): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (transform === 'first_name') return parts[0] ?? '';
  if (transform === 'last_name') return parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return value.trim();
}

function squash(s: string): string {
  return normalizeText(s).replace(/ /g, '');
}

/** Match a memory value to one of the page's real options. */
export function matchOption(value: string, options: FieldOption[]): FieldOption | undefined {
  const v = normalizeText(value);
  const vs = squash(value);
  if (!v) return undefined;
  const exact = options.find((o) => normalizeText(o.value) === v || normalizeText(o.label) === v || squash(o.label) === vs);
  if (exact) return exact;
  const contains = options.filter((o) => {
    const l = normalizeText(o.label);
    const ls = squash(o.label);
    return (l && (` ${l} `.includes(` ${v} `) || ` ${v} `.includes(` ${l} `))) || (vs.length >= 3 && ls.includes(vs));
  });
  if (contains.length === 1) return contains[0];
  return undefined;
}

export function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validateFormat(kind: ScannedField['kind'], value: string): string | null {
  const v = value.trim();
  if (!v) return 'Empty value';
  switch (kind) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Not a valid email address';
    case 'url':
      try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'URL must start with http(s)://';
      } catch {
        return 'Not a valid URL';
      }
    case 'number':
      return /^-?\d+(\.\d+)?$/.test(v) ? null : 'Not a number';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Date must be YYYY-MM-DD';
    case 'tel':
      return /^[+()\d\s.-]{5,20}$/.test(v) ? null : 'Not a valid phone number';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Validation + proposal building
// ---------------------------------------------------------------------------

function base(field: ScannedField, source: MappingSource): Proposal {
  return {
    fieldId: field.id,
    field,
    status: 'missing',
    action: null,
    memoryKey: null,
    transform: 'none',
    value: field.kind === 'checkbox' ? [] : '',
    confidence: 0,
    reason: '',
    source,
    approvalRequired: true,
    approved: false,
    allowOverwrite: false,
  };
}

function missing(p: Proposal, key: string | null, note?: string): Proposal {
  const k = key && MEMORY_KEY_RE.test(key) ? key : slugifyKey(p.field.label);
  return {
    ...p,
    status: 'missing',
    missingKey: k,
    missingLabel: catalogEntry(k)?.label ?? (p.field.label || humanizeKey(k)),
    note,
  };
}

/**
 * Validate raw model output and produce the review list. Unknown input is
 * treated as untrusted: it is parsed with a strict schema, unknown field ids
 * and hallucinated memory keys are rejected, and blocked fields stay blocked.
 */
export function buildProposals(raw: unknown, ctx: PolicyContext): PolicyResult {
  const issues: string[] = [];
  const parsed = FieldMappingResponseSchema.safeParse(raw);
  const mappings: FieldMapping[] = parsed.success ? parsed.data.mappings : [];
  if (!parsed.success) issues.push('AI response failed schema validation and was discarded');

  const fieldsById = new Map(ctx.scan.fields.map((f) => [f.id, f]));
  const byField = new Map<string, FieldMapping>();
  for (const m of mappings) {
    if (!fieldsById.has(m.fieldId)) {
      issues.push(`Rejected mapping for unknown field id "${m.fieldId.slice(0, 40)}"`);
      continue;
    }
    if (byField.has(m.fieldId)) {
      issues.push(`Ignored duplicate mapping for ${m.fieldId}`);
      continue;
    }
    byField.set(m.fieldId, m);
  }

  const proposals = ctx.scan.fields.map((field) => {
    const p = base(field, ctx.source);
    const m = byField.get(field.id);

    if (field.risk === 'red') {
      if (m && m.action !== 'skip') issues.push(`Ignored AI suggestion for blocked field ${field.id}`);
      return { ...p, status: 'blocked' as const, reason: field.riskReason, note: 'Left to you and your browser password manager' };
    }
    if (field.risk === 'gray') {
      if (m && m.action !== 'skip') issues.push(`Ignored AI suggestion for manual-only field ${field.id}`);
      return { ...p, status: 'unsupported' as const, reason: field.riskReason, note: 'Manual only' };
    }
    if (!m) return missing(p, null, 'No suggestion');

    const withMeta = { ...p, action: m.action, confidence: m.confidence, reason: m.reason.slice(0, 200), transform: m.transform };

    if (m.action === 'skip') return { ...withMeta, status: 'skipped' as const, note: 'AI suggested skipping' };

    if (m.action === 'draft') {
      if (field.kind !== 'textarea' && field.kind !== 'text') {
        issues.push(`Rejected draft action for non-text field ${field.id}`);
        return missing(withMeta, null);
      }
      return { ...withMeta, status: 'review' as const, note: 'Open-ended: generate a draft and review it' };
    }

    const key = m.memoryKey;
    if (m.action === 'ask_user' || !key) {
      return missing(withMeta, key && ctx.offeredKeys.has(key) ? key : null, 'AI could not match this to memory');
    }

    // use_memory
    if (!ctx.offeredKeys.has(key)) {
      issues.push(`Rejected unknown memory key "${key.slice(0, 48)}" for ${field.id}`);
      return missing(withMeta, null, 'Suggested memory key does not exist');
    }
    if (m.confidence < MIN_CONFIDENCE) return missing(withMeta, key, 'Low-confidence match');

    const withKey = { ...withMeta, memoryKey: key };
    const fact = ctx.facts.get(key);
    if (!fact || !fact.value.trim()) {
      const locked = ctx.lockedKeys?.has(key);
      return missing(withKey, key, locked ? 'Stored in your locked vault: unlock to use' : undefined);
    }
    if (fact.permission === 'never') return { ...withKey, status: 'skipped' as const, note: 'Memory fact is set to never be used' };

    const resolved = applyTransform(fact.value, m.transform);
    if (!resolved) return missing(withKey, key, 'Could not derive value from memory');
    if (detectSecretValue(resolved).secret) {
      return { ...withKey, status: 'blocked' as const, note: 'Stored value looks like a secret; not filled' };
    }

    let value: string | string[] = resolved;
    let note: string | undefined;
    let needsReview = false;

    if (field.kind === 'select' || field.kind === 'radio') {
      const opt = matchOption(resolved, field.options);
      if (!opt) {
        value = '';
        needsReview = true;
        note = `No option matches "${resolved.slice(0, 40)}": pick one`;
      } else value = opt.value;
    } else if (field.kind === 'checkbox') {
      const picks = splitList(resolved)
        .map((item) => matchOption(item, field.options)?.value)
        .filter((v): v is string => Boolean(v));
      value = [...new Set(picks)];
      if (value.length === 0) {
        needsReview = true;
        note = 'No options match your memory';
      }
    } else {
      const formatError = validateFormat(field.kind, resolved);
      if (formatError) {
        needsReview = true;
        note = formatError;
      }
      if (field.maxLength && resolved.length > field.maxLength) {
        needsReview = true;
        note = `Longer than the field allows (${field.maxLength})`;
      }
    }

    const siteAllowed = fact.allowedSites.includes(ctx.domain);
    const approvalRequired =
      needsReview ||
      field.hasExistingValue ||
      m.confidence < AUTO_APPROVE_CONFIDENCE ||
      fact.permission === 'ask' ||
      fact.sensitivity === 'private' ||
      (field.risk === 'amber' && !siteAllowed);
    // Explicit site allowlisting lifts the "ask" requirement for that domain only.
    const finalApproval = approvalRequired && !(siteAllowed && !needsReview && !field.hasExistingValue && m.confidence >= AUTO_APPROVE_CONFIDENCE);

    return {
      ...withKey,
      value,
      status: finalApproval ? ('review' as const) : ('ready' as const),
      approvalRequired: finalApproval,
      approved: !finalApproval,
      note: note ?? (field.hasExistingValue ? 'Field already has a value: tick "replace" to overwrite' : undefined),
    };
  });

  return { proposals, issues };
}

export function summarize(proposals: Proposal[]) {
  const count = (s: FillStatus) => proposals.filter((p) => p.status === s).length;
  return {
    detected: proposals.length,
    ready: count('ready'),
    review: count('review'),
    missing: count('missing'),
    blocked: count('blocked'),
    manual: count('unsupported'),
  };
}
