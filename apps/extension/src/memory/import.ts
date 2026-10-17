import { MEMORY_CATALOG, normalizeText, type ProvenanceSource } from '@a2c/shared';
import { z } from 'zod';
import { prepareFact, type FactDraft } from './facts';

const CandidateSchema = z.strictObject({ key: z.string().max(48), value: z.string().min(1).max(2000) });
const ImportSchema = z.strictObject({ facts: z.array(CandidateSchema).max(100), unknowns: z.array(z.string().max(200)).max(100).optional() });
export const CHATGPT_IMPORT_PROMPT = `Summarize only facts I have explicitly confirmed about my education, skills, projects, work history and career preferences. Do not invent missing information. Exclude passwords, OTPs, tokens, financial details and other secrets. Return JSON only: {"facts":[{"key":"college","value":"..."}],"unknowns":["..."]}. Use these keys when applicable: ${MEMORY_CATALOG.map((c) => c.key).join(', ')}. For other reusable facts use lowercase underscore keys. Values must be strings. Leave unknown facts out of facts. I will review and confirm every fact before importing it into A2C.`;

/** Local extraction only. Candidates are never stored until individually confirmed. */
export function parseContext(text: string, mode: 'notes' | 'chatgpt' | 'document'): { candidates: FactDraft[]; rejected: number } {
  if (text.length > 100_000) throw new Error('Use at most 100,000 characters.');
  const source: ProvenanceSource = mode === 'chatgpt' ? 'chatgpt_approved' : mode === 'document' ? 'document_approved' : 'notes_approved';
  let raw: Array<{ key: string; value: string }> = [];
  if (mode === 'chatgpt') {
    let decoded: unknown;
    try { decoded = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new Error('Paste the JSON reply containing facts and optional unknowns.'); }
    const parsed = ImportSchema.safeParse(decoded);
    if (!parsed.success) throw new Error('Expected up to 100 facts with string key/value pairs and optional unknowns.');
    raw = parsed.data.facts;
  } else {
    // Common prose and labelled resume lines. Unrecognized text stays out of memory.
    const patterns: Array<[string, RegExp]> = [
      ['full_name', /^(?:my name is|i am named)\s+(.+)$/i],
      ['college', /^(?:i study at|i attend|i graduated from)\s+(.+)$/i],
      ['skills', /^(?:my skills (?:are|include)|i am skilled in|i know)\s+(.+)$/i],
      ['current_role', /^(?:i work as|my role is)\s+(.+)$/i],
    ];
    for (const line of text.split(/[\r\n]+|(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean)) {
      const labelled = /^([^:]{1,80}):\s*(.+)$/.exec(line);
      if (labelled) {
        const label = normalizeText(labelled[1]!);
        const entry = MEMORY_CATALOG.find((c) => normalizeText(c.key) === label || normalizeText(c.label) === label || c.synonyms.includes(label));
        if (entry) raw.push({ key: entry.key, value: labelled[2]! });
      } else {
        for (const [key, pattern] of patterns) {
          const match = pattern.exec(line);
          if (match) { raw.push({ key, value: match[1]!.replace(/[.!]$/, '') }); break; }
        }
      }
    }
  }
  const candidates: FactDraft[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const item of raw.slice(0, 100)) {
    const draft: FactDraft = { ...item, source };
    if (seen.has(item.key) || !prepareFact(draft).ok || /^(unknown|not known|n\/a|null)$/i.test(item.value.trim())) { rejected++; continue; }
    seen.add(item.key); candidates.push(draft);
  }
  return { candidates, rejected };
}

export async function readProfileText(file: File): Promise<string> {
  if (file.size > 5_000_000) throw new Error('Resume files must be smaller than 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    const { readPdfText } = await import('./pdfText');
    return readPdfText(bytes);
  }
  if (file.size > 100_000) throw new Error('Text profiles must be smaller than 100 KB.');
  if (bytes.includes(0)) throw new Error('Choose a plain UTF-8 text file or a text-based PDF.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Choose a plain UTF-8 text file.'); }
}
