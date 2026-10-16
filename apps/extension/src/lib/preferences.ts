import { catalogEntry, type MemoryFact, type Proposal } from '@a2c/shared';
import type { Settings } from './settings';

export function proposalCategory(p: Proposal, facts: MemoryFact[]) {
  const key = p.memoryKey ?? p.missingKey ?? '';
  return facts.find((f) => f.key === key)?.category ?? catalogEntry(key)?.category ?? 'other';
}

/** Re-evaluated at review and fill time so revocation invalidates existing approvals. */
export function applyPreferences(proposals: Proposal[], facts: MemoryFact[], settings: Settings, origin: string): Proposal[] {
  return proposals.map((p) => {
    if (p.field.risk === 'red' || p.field.risk === 'gray' || ['completed', 'failed', 'skipped'].includes(p.status)) return p;
    const category = proposalCategory(p, facts);
    const rule = settings.siteRules.find((r) => r.origin === origin && r.category === category);
    const fact = facts.find((f) => f.key === p.memoryKey);
    if (settings.disabledCategories.includes(category) || rule?.decision === 'deny' || fact?.permission === 'never' || fact?.verified === false) {
      return { ...p, approved: false, status: 'skipped', note: 'Disabled by your autofill preferences' };
    }
    // A saved grant only approves unchanged, validated memory candidates, never drafts or edits.
    if (rule?.decision === 'allow' && p.status === 'review' && p.source !== 'user' && p.action === 'use_memory' && !p.note && !p.field.hasExistingValue && p.confidence >= 0.75) {
      return { ...p, approved: true, approvalRequired: false, status: 'ready' };
    }
    return p;
  });
}
