import { catalogEntry, type MemoryFact, type ScannedField, type ScanResult } from '@a2c/shared';

let n = 0;
export function fid(): string {
  n += 1;
  return `f_test${String(n).padStart(4, '0')}`;
}

export function field(partial: Partial<ScannedField> & { label: string }): ScannedField {
  return {
    id: fid(),
    kind: 'text',
    hint: '',
    section: '',
    placeholder: '',
    autocomplete: '',
    required: false,
    multiple: false,
    options: [],
    hasExistingValue: false,
    risk: 'green',
    riskReason: 'General profile information',
    rule: 'general',
    ...partial,
  };
}

export function scanOf(fields: ScannedField[]): ScanResult {
  return { scanId: 's_testscan', origin: 'https://forms.example.test', fields, stats: { ignoredHiddenOrDisabled: 0, unsupported: 0, truncated: false } };
}

export function fact(key: string, value: string, overrides: Partial<MemoryFact> = {}): MemoryFact {
  const e = catalogEntry(key);
  return {
    key,
    label: e?.label ?? key,
    value,
    category: e?.category ?? 'other',
    permission: e?.defaultPermission ?? 'auto',
    sensitivity: e?.sensitivity ?? 'standard',
    allowedSites: [],
    provenance: { source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

export const DEMO_FACTS: MemoryFact[] = [
  fact('full_name', 'Alex Example'),
  fact('email', 'alex@example.com'),
  fact('college', 'Example Institute of Technology'),
  fact('degree', 'B.Tech'),
  fact('skills', 'Python, React, TypeScript'),
  fact('github_url', 'https://github.com/example'),
  fact('portfolio_url', 'https://example.dev'),
];
