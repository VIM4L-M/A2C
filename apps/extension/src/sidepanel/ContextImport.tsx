import { useState } from 'react';
import { Button, Card, Checkbox, Notice, SectionTitle, SelectInput, TextArea, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { CHATGPT_IMPORT_PROMPT, parseContext, readProfileText } from '../memory/import';
import type { FactDraft } from '../memory/facts';
import { ContextExtractionResponseSchema, groundedExtraction, safeExtractionText } from '@a2c/shared';
import { BackendClient } from '../services/ai';

export function ContextImport({ allowLocalModel = true }: { allowLocalModel?: boolean }) {
  const { checkFact, commitFact, vaultState, factMap, settings } = useApp();
  const [mode, setMode] = useState<'notes' | 'document' | 'chatgpt'>('notes');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<FactDraft[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = () => { setRows([]); setSelected(new Set()); setMessage(''); };
  const extractLocal = async () => {
    reset(); setBusy(true);
    try {
      const backend = new URL(settings.backendUrl);
      if (backend.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(backend.hostname)) throw new Error('Choose a local backend in Settings. Raw context cannot be sent to Render.');
      if (text.length > 12000 || !safeExtractionText(text)) throw new Error('Use at most 12,000 characters without credentials or secrets.');
      setMessage('Reading with local Gemma. This can take several minutes; nothing will be saved automatically.');
      const raw = await new BackendClient(settings.backendUrl, { token: settings.authToken }).request('POST', '/api/extract', { text });
      const result = groundedExtraction(ContextExtractionResponseSchema.parse(raw), text);
      const candidates = result.facts.map(f => ({ key: f.key, value: f.value, source: mode === 'document' ? 'document_approved' as const : 'notes_approved' as const })).filter(f => checkFact(f).ok);
      setRows(candidates);
      setMessage(`${candidates.length} source-grounded candidates found. Check each fact against the text before saving; AI can misinterpret it.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Local extraction failed.'); }
    finally { setBusy(false); }
  };
  const preview = () => {
    reset();
    try {
      const result = parseContext(text, mode); setRows(result.candidates);
      setMessage(`${result.candidates.length} candidates found; ${result.rejected} unsafe, duplicate or unknown entries excluded. Nothing saved yet.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not parse this text.'); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const checks = rows.filter((r) => selected.has(r.key)).map((r) => checkFact(r));
      for (const c of checks) {
        if (!c.ok) throw new Error(c.error);
        if (c.fact.sensitivity === 'private' && vaultState !== 'unlocked') throw new Error('Unlock your vault in Privacy before saving selected private details.');
      }
      for (const c of checks) if (c.ok) { await commitFact(c.fact); setRows((previous) => previous.filter((r) => r.key !== c.fact.key)); }
      setSelected(new Set()); setText(''); setMessage(`Saved ${checks.length} confirmed facts. Source text discarded.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return <Card><SectionTitle>Add context</SectionTitle>
    <SelectInput aria-label="Context source" disabled={busy} value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setText(''); reset(); }}>
      <option value="notes">Free-form context</option><option value="document">Resume / profile file</option><option value="chatgpt">Import from ChatGPT</option>
    </SelectInput>
    <p className="my-2 text-xs text-muted">Processed locally. Review and tick each accurate fact before saving. Ticking a private fact also confirms storing it in your unlocked vault. Existing facts will be replaced only when selected.</p>
    {mode === 'chatgpt' ? <><TextArea aria-label="Prompt to copy into ChatGPT" readOnly value={CHATGPT_IMPORT_PROMPT} /><Button size="sm" onClick={() => void navigator.clipboard.writeText(CHATGPT_IMPORT_PROMPT).then(() => setMessage('Prompt copied. Review the ChatGPT reply before pasting it here.')).catch(() => setMessage('Select and copy the prompt above.'))}>Copy prompt</Button><p className="my-2 text-xs">A2C has no access to your ChatGPT account or conversation history.</p></> : <p className="my-2 text-xs">Supports labelled lines such as “Skills: Python, React” and short sentences such as “I study at Example University.” Unrecognized prose is omitted; add those facts manually.</p>}
    {mode === 'document' ? <><input aria-label="Upload resume" disabled={busy} type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; reset(); setText(''); setBusy(true); try { setText(await readProfileText(file)); } catch (error) { setText(''); setMessage(error instanceof Error ? error.message : 'Cannot read this file.'); } finally { setBusy(false); e.target.value = ''; } }} /><p className="my-2 text-xs text-muted">Processed on this device: UTF-8 text up to 100 KB, or a selectable-text PDF up to 5 MB and 20 pages. Scans need OCR. Review extracted text before selecting facts.</p></> : null}
    <TextArea aria-label="Context to review" disabled={busy} value={text} maxLength={100000} onChange={(e) => { setText(e.target.value); reset(); }} />
    <Button className="mt-2" onClick={preview} disabled={!text.trim() || busy}>Extract candidates</Button>
    {mode !== 'chatgpt' && allowLocalModel ? <><Button className="mt-2 ml-2" disabled={!text.trim() || busy} onClick={() => void extractLocal()}>Extract with local Gemma</Button><p className="my-2 text-xs text-muted">For prose, this sends the text only to your local backend and local model. Hosted extraction is disabled. Maximum 12,000 characters; every candidate still needs confirmation.</p></> : null}
    {message ? <Notice>{message}</Notice> : null}
    {rows.map((row) => <div key={row.key} className="my-3"><Checkbox label={`${row.key}${factMap.has(row.key) ? ' (replaces saved value)' : ''}: I confirm this fact and agree to save it`} checked={selected.has(row.key)} onChange={(on) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(row.key); else next.delete(row.key); return next; })} /><TextInput aria-label={`Value for ${row.key}`} value={row.value} maxLength={2000} onChange={(e) => { setRows((prev) => prev.map((r) => r.key === row.key ? { ...r, value: e.target.value } : r)); setSelected((prev) => { const next = new Set(prev); next.delete(row.key); return next; }); }} /></div>)}
    {rows.length ? <Button variant="primary" disabled={!selected.size} loading={busy} onClick={() => void save()}>Save confirmed facts</Button> : null}
  </Card>;
}
