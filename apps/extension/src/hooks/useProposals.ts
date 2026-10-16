import {
  applyTransform,
  buildMappingRequest,
  buildProposals,
  deterministicMap,
  type FieldMappingRequest,
  detectSecretValue,
  matchOption,
  splitList,
  validateFormat,
  type FillInstruction,
  type MappingSource,
  type MemoryFact,
  type Proposal,
  type ScanResult,
} from '@a2c/shared';
import { useCallback, useRef, useState } from 'react';
import { mapWithFallback, type AIProvider, type MappingOutcome } from '../services/ai';

/**
 * Shared review-list state for websites and documents:
 * scan -> local classification -> (Gemma | mock | rules) -> policy -> proposals.
 */

export interface MappingInfo {
  source: MappingSource;
  error?: string;
  issues: string[];
  aiFieldCount: number;
  /** Exactly what was (or would have been) sent to the AI: labels and key names only. */
  request: FieldMappingRequest | null;
  cached: boolean;
  /** Fields matched instantly by rules and therefore not sent to the model. */
  ruleMatched: number;
}

/** Session-only cache: rescanning the same form does not wait for the model again. */
const CACHE = new Map<string, MappingOutcome>();
const CACHE_MAX = 30;
const HYBRID_MIN_CONFIDENCE = 0.86;

function cacheKey(kind: string, request: FieldMappingRequest): string {
  // Field ids are random per scan; key on what the model actually sees.
  return `${kind}:${JSON.stringify({ ...request, fields: request.fields.map((f) => ({ ...f, id: '' })) })}`;
}

function remapIds(outcome: MappingOutcome, from: FieldMappingRequest, to: FieldMappingRequest): MappingOutcome {
  const map = new Map(from.fields.map((f, i) => [f.id, to.fields[i]?.id]));
  const raw = outcome.raw as { mappings?: Array<{ fieldId: string }> };
  return { ...outcome, raw: { mappings: (raw.mappings ?? []).map((m) => ({ ...m, fieldId: map.get(m.fieldId) ?? m.fieldId })) } };
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
  const skipRef = useRef<(() => void) | null>(null);

  /** Users report slow AI as a top frustration: let them switch to instant rules mid-request. */
  const skipAI = useCallback(() => skipRef.current?.(), []);

  const run = useCallback(
    async (scan: ScanResult, facts: MemoryFact[], lockedKeys: Set<string>, provider: AIProvider, domain: string) => {
      const fullRequest = buildMappingRequest(scan, facts, lockedKeys);
      const offeredKeys = new Set(fullRequest?.availableMemoryKeys.map((k) => k.key) ?? []);
      let cached = false;
      let outcome: MappingOutcome;
      // Hybrid mapping: obvious fields are matched instantly by rules; only unclear ones go to the
      // model. On CPU this turns multi-minute scans into seconds, and sends less page data.
      const ruleMap = fullRequest ? deterministicMap(fullRequest) : { mappings: [] };
      const confident = new Set(
        provider.kind === 'mock' ? [] : ruleMap.mappings.filter((m) => m.action === 'use_memory' && m.confidence >= HYBRID_MIN_CONFIDENCE).map((m) => m.fieldId),
      );
      const request = fullRequest && fullRequest.fields.some((f) => !confident.has(f.id)) ? { ...fullRequest, fields: fullRequest.fields.filter((f) => !confident.has(f.id)) } : null;
      if (!fullRequest) outcome = { raw: { mappings: [] }, source: provider.kind === 'mock' ? 'mock' : 'rules' };
      else if (provider.kind === 'mock') outcome = await mapWithFallback(provider, fullRequest);
      else if (!request) outcome = { raw: { mappings: [] }, source: provider.kind };
      else {
        const key = cacheKey(provider.kind, request);
        const hit = CACHE.get(key) as (MappingOutcome & { request: FieldMappingRequest }) | undefined;
        if (hit) {
          outcome = remapIds(hit, hit.request, request);
          cached = true;
        } else {
          const skipped = new Promise<MappingOutcome>((resolve) => {
            skipRef.current = () => resolve({ raw: deterministicMap(request), source: 'rules', error: 'You switched to instant rules while the AI was working.' });
          });
          outcome = await Promise.race([mapWithFallback(provider, request), skipped]);
          skipRef.current = null;
          if (outcome.source === 'gemma' || outcome.source === 'specialist') {
            if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
            CACHE.set(key, { ...outcome, request } as MappingOutcome);
          }
        }
      }
      // Merge: rule matches for confident fields, model (or fallback) output for the rest.
      const modelMappings = ((outcome.raw as { mappings?: Array<{ fieldId: string }> }).mappings ?? []).filter((m) => !confident.has(m.fieldId));
      const merged = confident.size ? { mappings: [...ruleMap.mappings.filter((m) => confident.has(m.fieldId)), ...modelMappings] } : outcome.raw;
      const factMap = new Map(facts.map((f) => [f.key, f]));
      const result = buildProposals(merged, { scan, facts: factMap, lockedKeys, offeredKeys, domain, source: outcome.source });
      const proposals = result.proposals.map((p) => (confident.has(p.fieldId) && p.source !== 'user' ? { ...p, source: 'rules' as const } : p));
      last.current = { raw: merged, scan, offeredKeys, domain, source: outcome.source };
      setProposals(proposals);
      setInfo({ source: outcome.source, error: outcome.error, issues: result.issues, aiFieldCount: request?.fields.length ?? 0, request, cached, ruleMatched: confident.size });
      return proposals;
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

  return { proposals, setProposals, info, run, update, refreshForKey, reset, skipAI };
}
