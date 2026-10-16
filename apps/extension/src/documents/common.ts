import { classifyField, humanizeKey, normalizeText, sanitizeLabel, type FieldKind, type ScanResult, type ScannedField } from '@contextfill/shared';

/**
 * Documents reuse the website pipeline: their placeholders / AcroForm fields
 * become ScannedFields, are classified locally, and only sanitized names go
 * to the mapping engine. Document bodies never leave the browser.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ORIGIN = 'local-document';

export interface DocFieldRaw {
  /** Exact placeholder text or AcroForm field name, used locally to write values. */
  name: string;
  kind: FieldKind | 'unsupported';
  options: string[];
  hasExistingValue: boolean;
  maxLength?: number;
}

export interface DocScan {
  scan: ScanResult;
  idToName: Map<string, string>;
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}

export function toDocScan(raw: DocFieldRaw[]): DocScan {
  const idToName = new Map<string, string>();
  const fields: ScannedField[] = [];
  let unsupported = 0;
  for (const f of raw.slice(0, 300)) {
    const label = sanitizeLabel(humanizeKey(f.name.replace(/[[\].]+/g, ' ')), 120) || '(unnamed field)';
    const cls = classifyField({ kind: f.kind, name: f.name, label, optionLabels: f.options });
    if (f.kind === 'unsupported' && cls.risk !== 'red') {
      unsupported += 1;
    }
    const id = randomId('f');
    idToName.set(id, f.name);
    const red = cls.risk === 'red';
    fields.push({
      id,
      kind: f.kind === 'unsupported' ? 'text' : f.kind,
      label,
      hint: red ? '' : normalizeText(f.name).slice(0, 120),
      section: '',
      autocomplete: '',
      required: false,
      multiple: false,
      maxLength: f.maxLength,
      options: red ? [] : f.options.slice(0, 100).map((o) => ({ value: o, label: sanitizeLabel(o, 200) })),
      hasExistingValue: red ? false : f.hasExistingValue,
      risk: f.kind === 'unsupported' && !red ? 'gray' : cls.risk,
      riskReason: f.kind === 'unsupported' && !red ? 'Unsupported document field type' : cls.reason,
      rule: f.kind === 'unsupported' && !red ? 'unsupported_input' : cls.rule,
    });
  }
  return {
    scan: { scanId: randomId('s'), origin: DOCUMENT_ORIGIN, fields, stats: { ignoredHiddenOrDisabled: 0, unsupported, truncated: raw.length > 300 } },
    idToName,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function completedName(original: string): string {
  const dot = original.lastIndexOf('.');
  const base = dot > 0 ? original.slice(0, dot) : original;
  const ext = dot > 0 ? original.slice(dot) : '';
  return `${base.replace(/[^\w.-]+/g, '_').slice(0, 80)}-completed${ext}`;
}
