import { detectSecretValue, type MemoryFact, type Proposal } from '@a2c/shared';
import { useApp } from '../hooks/useApp';
import { resolveForField } from '../hooks/useProposals';
import { ProposalRow, type SaveCheck } from './ProposalRow';

interface Props {
  proposals: Proposal[];
  update: (fieldId: string, patch: Partial<Proposal>) => void;
  refreshForKey: (key: string, facts: MemoryFact[], lockedKeys: Set<string>) => void;
  domain: string;
  provenance: 'form_approved' | 'document_approved';
}

/** Facts that may be offered for drafting: standard, usable, not contact details. */
function draftable(facts: MemoryFact[]): MemoryFact[] {
  return facts.filter((f) => f.sensitivity === 'standard' && f.permission !== 'never' && f.category !== 'contact' && f.value.trim());
}

export function ProposalList({ proposals, update, refreshForKey, domain, provenance }: Props) {
  const { facts, checkFact, commitFact, lockedKeys, provider, vaultState } = useApp();
  const draftFacts = draftable(facts);

  const saveCheck = (p: Proposal, value: string): SaveCheck => {
    const check = checkFact({ key: p.missingKey ?? '', label: p.missingLabel, value, source: provenance, domain });
    if (!check.ok) return check;
    const isPrivate = check.fact.sensitivity === 'private';
    if (isPrivate && vaultState !== 'unlocked') {
      return { ok: false, error: 'This is private information: create or unlock your vault in Privacy first, or choose "Use once".' };
    }
    return { ok: true, needsExtraConfirm: check.needsExtraConfirm, isPrivate };
  };

  const saveCommit = async (p: Proposal, value: string): Promise<string | null> => {
    const check = checkFact({ key: p.missingKey ?? '', label: p.missingLabel, value, source: provenance, domain });
    if (!check.ok) return check.error;
    try {
      await commitFact(check.fact);
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save';
    }
    const resolved = resolveForField({ ...p, transform: 'none' }, value);
    update(p.fieldId, {
      value: resolved.value,
      memoryKey: check.fact.key,
      status: 'review',
      approved: !resolved.error,
      source: 'user',
      note: resolved.error ?? `Saved to memory as "${check.fact.label}"`,
    });
    refreshForKey(check.fact.key, [...facts.filter((f) => f.key !== check.fact.key), check.fact], lockedKeys);
    return null;
  };

  return (
    <ul className="flex flex-col gap-2">
      {proposals.map((p) => (
        <ProposalRow
          key={p.fieldId}
          p={p}
          providerKind={provider.kind}
          draftFacts={draftFacts}
          onUpdate={(patch) => update(p.fieldId, patch)}
          onUseOnce={(value) => {
            const resolved = typeof value === 'string' ? resolveForField({ ...p, transform: 'none' }, value) : { value };
            update(p.fieldId, {
              value: resolved.value,
              status: 'review',
              approved: !('error' in resolved && resolved.error),
              source: 'user',
              note: ('error' in resolved && resolved.error) || 'Provided by you for this form only (not saved)',
            });
          }}
          onSaveCheck={(v) => saveCheck(p, v)}
          onSaveCommit={(v) => saveCommit(p, v)}
          onDraft={async (keys) => {
            const selected = draftFacts.filter((f) => keys.includes(f.key));
            const res = await provider.draftAnswer({
              fieldId: p.fieldId,
              question: p.field.label.slice(0, 300),
              maxLength: Math.min(4000, Math.max(50, p.field.maxLength ?? 800)),
              facts: selected.map((f) => ({ key: f.key, label: f.label.slice(0, 80), value: f.value.slice(0, 1000) })),
            });
            if (detectSecretValue(res.draft).secret) throw new Error('Draft contained secret-like text and was discarded');
            const missing = res.missingFacts.length ? ` Missing: ${res.missingFacts.join('; ')}.` : '';
            update(p.fieldId, {
              value: res.draft,
              status: 'review',
              approved: false,
              source: provider.kind === 'gemma' ? 'gemma' : 'mock',
              note: `${provider.kind === 'gemma' ? 'Gemma 4 draft' : 'MOCK template draft (not AI)'}: review and edit before approving.${missing}`,
            });
          }}
        />
      ))}
    </ul>
  );
}
