import {
  applyTransform,
  buildMappingRequest,
  buildProposals,
  detectSecretValue,
  matchOption,
  splitList,
  validateFormat,
  type FillInstruction,
  type MappingSource,
  type MemoryFact,
  type Proposal,
  type ScanResult,
} from '@contextfill/shared';
import { useCallback, useRef, useState } from 'react';
import { mapWithFallback, type AIProvider } from '../services/ai';

/**
 * Shared review-list state for websites and documents:
 * scan -> local classification -> (Gemma | mock | rules) -> policy -> proposals.
 */

export interface MappingInfo {
  source: MappingSource;
  error?: string;
  issues: string[];
  aiFieldCount: number;
}

interface LastRun {
  raw: unknown;
  scan: ScanResult;
  offeredKeys: Set<string>;
  domain: string;
  source: MappingSource;
}

export function hasFillValue(p: Proposal): boolean {
  return Array.isArray(p.value) ? p.value.length > 0 : p.value.trim() !== '';
}

export function isFillable(p: Proposal): boolean {
  return (p.status === 'ready' || p.status === 'review') && p.approved && hasFillValue(p) && p.field.risk !== 'red' && p.field.risk !== 'gray';
}

/** Final local gate before values leave the side panel for the page. */
export function toFillInstructions(proposals: Proposal[]): FillInstruction[] {
  return proposals.filter(isFillable).flatMap((p) => {
    const values = Array.isArray(p.value) ? p.value : [p.value];
    if (values.some((v) => detectSecretValue(v).secret)) return [];
    if (p.field.hasExistingValue && !p.allowOverwrite) return [];
    return [{ fieldId: p.fieldId, value: p.value, allowOverwrite: p.allowOverwrite }];
  });
}

/** Resolve a fact value into the shape a field needs (option value / list / text). */
export function resolveForField(p: Proposal, raw: string): { value: string | string[]; error?: string } {
  const v = applyTransform(raw, p.transform);
  if (p.field.kind === 'select' || p.field.kind === 'radio') {
    const opt = matchOption(v, p.field.options);
    return opt ? { value: opt.value } : { value: '', error: 'No matching option: pick one' };
  }
  if (p.field.kind === 'checkbox') {
    const picks = splitList(v)
      .map((i) => matchOption(i, p.field.options)?.value)
      .filter((x): x is string => Boolean(x));
    return picks.length ? { value: [...new Set(picks)] } : { value: [], error: 'No matching options' };
  }
  const err = validateFormat(p.field.kind, v);
  return err ? { value: v, error: err } : { value: v };
}

export function useProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [info, setInfo] = useState<MappingInfo | null>(null);
  const last = useRef<LastRun | null>(null);

  const run = useCallback(
    async (scan: ScanResult, facts: MemoryFact[], lockedKeys: Set<string>, provider: AIProvider, domain: string) => {
      const request = buildMappingRequest(scan, facts, lockedKeys);
      const offeredKeys = new Set(request?.availableMemoryKeys.map((k) => k.key) ?? []);
      const outcome = request ? await mapWithFallback(provider, request) : { raw: { mappings: [] }, source: provider.kind === 'mock' ? ('mock' as const) : ('rules' as const) };
      const factMap = new Map(facts.map((f) => [f.key, f]));
      const result = buildProposals(outcome.raw, { scan, facts: factMap, lockedKeys, offeredKeys, domain, source: outcome.source });
      last.current = { raw: outcome.raw, scan, offeredKeys, domain, source: outcome.source };
      setProposals(result.proposals);
      setInfo({ source: outcome.source, error: 'error' in outcome ? outcome.error : undefined, issues: result.issues, aiFieldCount: request?.fields.length ?? 0 });
      return result.proposals;
    },
    [],
  );

  const update = useCallback((fieldId: string, patch: Partial<Proposal>) => {
    setProposals((ps) => ps.map((p) => (p.fieldId === fieldId ? { ...p, ...patch } : p)));
  }, []);

  /** After a new fact is saved, refresh other fields that were waiting for that key. */
  const refreshForKey = useCallback((key: string, facts: MemoryFact[], lockedKeys: Set<string>) => {
    const l = last.current;
    if (!l) return;
    const factMap = new Map(facts.map((f) => [f.key, f]));
    const fresh = buildProposals(l.raw, { scan: l.scan, facts: factMap, lockedKeys, offeredKeys: l.offeredKeys, domain: l.domain, source: l.source });
    const byId = new Map(fresh.proposals.map((p) => [p.fieldId, p]));
    setProposals((ps) => ps.map((p) => (p.status === 'missing' && p.missingKey === key && byId.get(p.fieldId)?.status !== 'missing' ? byId.get(p.fieldId)! : p)));
  }, []);

  const reset = useCallback(() => {
    setProposals([]);
    setInfo(null);
    last.current = null;
  }, []);

  return { proposals, setProposals, info, run, update, refreshForKey, reset };
}
