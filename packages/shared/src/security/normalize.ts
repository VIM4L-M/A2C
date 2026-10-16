/** Turn identifiers like "applicant_githubURL" into "applicant github url". */
export function normalizeText(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(new RegExp(String.fromCharCode(0x2019), 'g'), '')
    .replace(/[^a-z0-9@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// C0/C1 controls, zero-width characters, line/paragraph separators and bidi overrides.
const range = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const CONTROL_CHARS = new RegExp(`[${[range(0x00, 0x1f), range(0x7f, 0x9f), range(0x200b, 0x200f), range(0x2028, 0x202e), range(0x2060, 0x206f)].join('')}]`, 'g');

const ELLIPSIS = String.fromCharCode(0x2026);

/** Collapse whitespace, drop control/bidi characters and bound length. Used on page text. */
export function sanitizeLabel(input: string | undefined | null, max = 160): string {
  if (!input) return '';
  const cleaned = input.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}${ELLIPSIS}` : cleaned;
}

export function humanizeKey(key: string): string {
  const text = normalizeText(key);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function slugifyKey(label: string): string {
  const slug = normalizeText(label).replace(/ /g, '_').replace(/^[^a-z]+/, '').slice(0, 48);
  return slug || 'custom_fact';
}
