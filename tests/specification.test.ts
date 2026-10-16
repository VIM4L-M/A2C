import { describe, expect, it } from 'vitest';
import { buildProposals, buildMemoryKeyDescriptors } from '@a2c/shared';
import { parseContext, readProfileText } from '../apps/extension/src/memory/import';
import { applyPreferences } from '../apps/extension/src/lib/preferences';
import { SettingsSchema } from '../apps/extension/src/lib/settings';
import { prepareFact } from '../apps/extension/src/memory/facts';
import { fact, field, scanOf } from './helpers';

describe('reviewed context imports', () => {
  it('extracts common prose and labelled resume facts without inventing other facts', () => {
    const result = parseContext('I study at Example University. My skills include Python, React.\nDegree: B.Tech\nI might graduate someday.', 'notes');
    expect(result.candidates.map((r) => r.key)).toEqual(['college', 'skills', 'degree']);
    expect(result.candidates[0]?.source).toBe('notes_approved');
  });
  it('validates pasted JSON and rejects unsafe values, credentials and duplicates', () => {
    const result = parseContext(JSON.stringify({ facts: [
      { key: 'skills', value: 'React' }, { key: 'password', value: 'hunter2' },
      { key: 'skills', value: 'Python' }, { key: 'college', value: 'unknown' },
    ], unknowns: ['graduation year'] }), 'chatgpt');
    expect(result.candidates).toEqual([{ key: 'skills', value: 'React', source: 'chatgpt_approved' }]);
    expect(result.rejected).toBe(3);
    expect(() => parseContext('{"facts":[{"key":"skills","value":{},"verified":true}]}', 'chatgpt')).toThrow();
    expect(() => parseContext('x'.repeat(100001), 'notes')).toThrow();
  });
  it('rejects binary and oversized profile files', async () => {
    await expect(readProfileText(new File([new Uint8Array([0, 1, 2])], 'resume.txt'))).rejects.toThrow();
    await expect(readProfileText(new File(['x'.repeat(100001)], 'resume.txt'))).rejects.toThrow();
    await expect(readProfileText(new File(['Skills: React'], 'resume.txt'))).resolves.toBe('Skills: React');
  });
  it('records confirmation and the most recent correction source', () => {
    const result = prepareFact({ key: 'skills', value: 'TypeScript', source: 'chatgpt_approved' }, fact('skills', 'React'));
    expect(result.ok && result.fact.verified).toBe(true);
    expect(result.ok && result.fact.provenance.source).toBe('chatgpt_approved');
    expect(buildMemoryKeyDescriptors([fact('skills', 'Unconfirmed', { verified: false })]).some((k) => k.key === 'skills')).toBe(false);
  });
});

describe('category and exact-origin permissions', () => {
  const email = field({ label: 'Email', risk: 'amber', kind: 'email' });
  const facts = [fact('email', 'alex@example.com')];
  const proposals = buildProposals({ mappings: [{ fieldId: email.id, action: 'use_memory', memoryKey: 'email', transform: 'none', confidence: 0.99, reason: 'Email' }] }, {
    scan: scanOf([email]), facts: new Map(facts.map((f) => [f.key, f])), offeredKeys: new Set(['email']), domain: 'forms.example.test', source: 'rules',
  }).proposals;
  const origin = 'https://forms.example.test';
  const settings = SettingsSchema.parse({ siteRules: [{ origin, category: 'contact', decision: 'allow', updatedAt: '2026-10-16' }] });
  it('allows only the granted scheme, host and port; revocation restores review', () => {
    expect(applyPreferences(proposals, facts, settings, origin)[0]?.approved).toBe(true);
    for (const other of ['http://forms.example.test', 'https://forms.example.test:8443', 'https://other.example']) {
      expect(applyPreferences(proposals, facts, settings, other)[0]?.approved).toBe(false);
    }
    expect(applyPreferences(proposals, facts, SettingsSchema.parse({}), origin)[0]?.approved).toBe(false);
  });
  it('category disabled, saved denial, and never-use facts override approvals', () => {
    const approved = proposals.map((p) => ({ ...p, approved: true }));
    expect(applyPreferences(approved, facts, { ...settings, disabledCategories: ['contact'] }, origin)[0]?.status).toBe('skipped');
    expect(applyPreferences(approved, facts, { ...settings, siteRules: settings.siteRules.map((r) => ({ ...r, decision: 'deny' })) }, origin)[0]?.approved).toBe(false);
    expect(applyPreferences(approved, [fact('email', 'alex@example.com', { permission: 'never' })], settings, origin)[0]?.approved).toBe(false);
  });
  it('does not approve edits, drafts, overwrite requests or blocked fields', () => {
    for (const patch of [{ source: 'user' as const }, { action: 'draft' as const }, { note: 'Invalid format' }, { field: { ...email, hasExistingValue: true } }, { field: { ...email, risk: 'red' as const } }]) {
      expect(applyPreferences(proposals.map((p) => ({ ...p, ...patch })), facts, settings, origin)[0]?.approved).toBe(false);
    }
  });
  it('rejects path-scoped or invalid saved origins', () => {
    expect(SettingsSchema.safeParse({ siteRules: [{ ...settings.siteRules[0], origin: `${origin}/path` }] }).success).toBe(false);
  });
});
