import { useState } from 'react';
import { Button, Card, Checkbox, Notice, SectionTitle, SelectInput, TextArea, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { CHATGPT_IMPORT_PROMPT, parseContext, readProfileText } from '../memory/import';
import type { FactDraft } from '../memory/facts';

export function ContextImport() {
  const { checkFact, commitFact, vaultState, factMap } = useApp();
  const [mode, setMode] = useState<'notes' | 'document' | 'chatgpt'>('notes');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<FactDraft[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = () => { setRows([]); setSelected(new Set()); setMessage(''); };
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
    <SelectInput aria-label="Context source" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setText(''); reset(); }}>
      <option value="notes">Free-form context</option><option value="document">Resume / profile text</option><option value="chatgpt">Import from ChatGPT</option>
    </SelectInput>
    <p className="my-2 text-xs text-muted">Processed locally. Review and tick each accurate fact before saving. Ticking a private fact also confirms storing it in your unlocked vault. Existing facts will be replaced only when selected.</p>
    {mode === 'chatgpt' ? <><TextArea aria-label="Prompt to copy into ChatGPT" readOnly value={CHATGPT_IMPORT_PROMPT} /><Button size="sm" onClick={() => void navigator.clipboard.writeText(CHATGPT_IMPORT_PROMPT).then(() => setMessage('Prompt copied. Review the ChatGPT reply before pasting it here.')).catch(() => setMessage('Select and copy the prompt above.'))}>Copy prompt</Button><p className="my-2 text-xs">A2C has no access to your ChatGPT account or conversation history.</p></> : <p className="my-2 text-xs">Supports labelled lines such as “Skills: Python, React” and short sentences such as “I study at Example University.” Unrecognized prose is omitted; add those facts manually.</p>}
    {mode === 'document' ? <><input aria-label="Upload plain text resume" type="file" accept=".txt,text/plain" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; reset(); try { setText(await readProfileText(file)); } catch (error) { setText(''); setMessage(error instanceof Error ? error.message : 'Cannot read this file.'); } e.target.value = ''; }} /><p className="my-2 text-xs text-muted">Plain UTF-8 text, up to 100 KB. Export a PDF resume to text first; PDF resume parsing is deferred.</p></> : null}
    <TextArea aria-label="Context to review" value={text} maxLength={100000} onChange={(e) => { setText(e.target.value); reset(); }} />
    <Button className="mt-2" onClick={preview} disabled={!text.trim() || busy}>Extract candidates</Button>
    {message ? <Notice>{message}</Notice> : null}
    {rows.map((row) => <div key={row.key} className="my-3"><Checkbox label={`${row.key}${factMap.has(row.key) ? ' (replaces saved value)' : ''}: I confirm this fact and agree to save it`} checked={selected.has(row.key)} onChange={(on) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(row.key); else next.delete(row.key); return next; })} /><TextInput aria-label={`Value for ${row.key}`} value={row.value} maxLength={2000} onChange={(e) => { setRows((prev) => prev.map((r) => r.key === row.key ? { ...r, value: e.target.value } : r)); setSelected((prev) => { const next = new Set(prev); next.delete(row.key); return next; }); }} /></div>)}
    {rows.length ? <Button variant="primary" disabled={!selected.size} loading={busy} onClick={() => void save()}>Save confirmed facts</Button> : null}
  </Card>;
}
