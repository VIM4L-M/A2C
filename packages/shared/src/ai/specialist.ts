import { MEMORY_CATALOG } from '../memory/catalog';
import type { AIField, FieldMapping } from '../schemas';
import { sanitizeLabel } from '../security/normalize';

/**
 * Prompt format for the optional fine-tuned "mapping specialist" trained with
 * Tinker (see training/tinker). The Python dataset generator uses the exact
 * same template; tests/specialist.test.ts keeps both in sync.
 *
 * The specialist only outputs ONE label: a memory key, "ask_user" or "skip".
 * Like Gemma, it never sees memory values and cannot override the
 * deterministic security policy.
 */

export const SPECIALIST_KEYS: string[] = MEMORY_CATALOG.map((e) => e.key);
export const SPECIALIST_EXTRA_LABELS = ['ask_user', 'skip'] as const;

export function buildSpecialistPrompt(field: { label: string; type: string; options?: string[] }): string {
  const options = (field.options ?? []).slice(0, 12).map((o) => sanitizeLabel(o, 40));
  return [
    'Map the web form field to one memory key.',
    `Keys: ${[...SPECIALIST_KEYS, ...SPECIALIST_EXTRA_LABELS].join(', ')}`,
    `Field label: ${sanitizeLabel(field.label, 160)}`,
    `Field type: ${field.type}`,
    ...(options.length ? [`Options: ${options.join(' | ')}`] : []),
    'Key:',
  ].join('\n');
}

/** Parse the specialist's single-label answer. Anything unexpected becomes ask_user. */
export function parseSpecialistOutput(text: string, allowedKeys: Set<string>): string {
  // First recognised label among the first few words (models sometimes add "Key:" or markdown).
  for (const token of (text.toLowerCase().match(/[a-z_]+/g) ?? []).slice(0, 5)) {
    if (token === 'ask_user' || token === 'skip' || allowedKeys.has(token)) return token;
  }
  return 'ask_user';
}

export function specialistMapping(field: AIField, label: string): FieldMapping {
  if (label === 'skip') return { fieldId: field.id, action: 'skip', memoryKey: null, transform: 'none', confidence: 0.8, reason: 'Specialist: skip' };
  if (label === 'ask_user') {
    return { fieldId: field.id, action: 'ask_user', memoryKey: null, transform: 'none', confidence: 0.3, reason: 'Specialist: no matching key' };
  }
  return { fieldId: field.id, action: 'use_memory', memoryKey: label, transform: 'none', confidence: 0.8, reason: 'Fine-tuned specialist mapping' };
}
