import { MEMORY_CATALOG, catalogEntry } from '../memory/catalog';
import type { AIField, FieldMapping, FieldMappingRequest, FieldMappingResponse, MemoryKeyDescriptor } from '../schemas';
import { normalizeText } from '../security/normalize';

/**
 * Deterministic semantic matcher. Powers MOCK MODE and the rule-based
 * fallback when Gemma is unavailable. It only ever outputs declarative
 * mappings in the same schema the model must follow.
 */

const NAME_QUALIFIERS =
  /\b(team|project|company|organization|organisation|college|school|university|institute|institution|father|mother|parent|guardian|spouse|emergency|reference|referee|manager|business|event|file|user|display|product|brand|pet|street|bank|card|account)\b/;

const FREE_TEXT_RE =
  /\b(why|tell us|describe|explain|motivation|cover letter|statement of purpose|about yourself|what makes you|what would you|how would you|essay|share (a|an|your)|in (\d+ )?words)\b/;

const BRAND_KEYS: Array<[RegExp, string]> = [
  [/\bgit ?hub\b/, 'github_url'],
  [/\blinked ?in\b/, 'linkedin_url'],
];

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

interface Candidate {
  key: string;
  score: number;
  inLabel: boolean;
  phrase: string;
}

function bestCatalogMatch(label: string, hint: string, allowed: Set<string>): Candidate | undefined {
  let best: Candidate | undefined;
  for (const entry of MEMORY_CATALOG) {
    if (!allowed.has(entry.key)) continue;
    for (const syn of entry.synonyms) {
      if (syn === 'name') continue; // handled separately (too generic)
      const inLabel = containsPhrase(label, syn);
      const inHint = !inLabel && containsPhrase(hint, syn);
      if (!inLabel && !inHint) continue;
      const score = syn.split(' ').length * 10 + syn.length + (inLabel ? 5 : 0);
      if (!best || score > best.score) best = { key: entry.key, score, inLabel, phrase: syn };
    }
  }
  return best;
}

function mapping(
  fieldId: string,
  action: FieldMapping['action'],
  memoryKey: string | null,
  confidence: number,
  reason: string,
  transform: FieldMapping['transform'] = 'none',
): FieldMapping {
  return { fieldId, action, memoryKey, transform, confidence, reason };
}

export function matchField(field: AIField, keys: MemoryKeyDescriptor[]): FieldMapping {
  const allowed = new Set(keys.map((k) => k.key));
  const label = normalizeText(field.label);
  const hint = normalizeText(field.hint);
  const both = `${label} ${hint}`.trim();

  // Split-name fields resolve from full_name locally.
  if (allowed.has('full_name')) {
    if (/\b(first|given|fore) ?name\b/.test(both)) return mapping(field.id, 'use_memory', 'full_name', 0.9, 'First name from full name', 'first_name');
    if (/\b(last|family|sur) ?name\b|\bsurname\b/.test(both)) return mapping(field.id, 'use_memory', 'full_name', 0.9, 'Last name from full name', 'last_name');
  }

  for (const [re, key] of BRAND_KEYS) {
    if (allowed.has(key) && re.test(both)) return mapping(field.id, 'use_memory', key, 0.95, `Mentions ${key.replace('_url', '')}`);
  }

  const best = bestCatalogMatch(label, hint, allowed);

  // Open-ended prompts are drafted (with consent), unless they clearly ask for a stored fact.
  const isFreeText = field.type === 'textarea' || FREE_TEXT_RE.test(label);
  if (isFreeText && (!best || best.key === 'bio' || FREE_TEXT_RE.test(label))) {
    return mapping(field.id, 'draft', null, 0.7, 'Open-ended question; needs a reviewed draft');
  }

  if (best) {
    const words = best.phrase.split(' ').length;
    const confidence = best.inLabel ? (words >= 2 ? 0.93 : 0.86) : 0.74;
    const entry = catalogEntry(best.key);
    return mapping(field.id, 'use_memory', best.key, confidence, `Label matches "${best.phrase}" (${entry?.label ?? best.key})`);
  }

  // Custom (user-defined) keys: match on their key words.
  for (const k of keys) {
    if (catalogEntry(k.key)) continue;
    const phrase = normalizeText(k.key);
    if (phrase && containsPhrase(label, phrase)) return mapping(field.id, 'use_memory', k.key, 0.8, `Label matches custom fact "${phrase}"`);
  }

  // Generic "Name" with no qualifier means the person.
  if (allowed.has('full_name') && /\bname\b/.test(label) && !NAME_QUALIFIERS.test(label)) {
    return mapping(field.id, 'use_memory', 'full_name', 0.82, 'Generic name field');
  }

  if (field.type === 'email' && allowed.has('email')) return mapping(field.id, 'use_memory', 'email', 0.8, 'Email input type');
  if (field.type === 'tel' && allowed.has('phone')) return mapping(field.id, 'use_memory', 'phone', 0.78, 'Telephone input type');

  return mapping(field.id, 'ask_user', null, 0.2, 'No matching memory attribute');
}

export function deterministicMap(request: FieldMappingRequest): FieldMappingResponse {
  return { mappings: request.fields.map((f) => matchField(f, request.availableMemoryKeys)) };
}
