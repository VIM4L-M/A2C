import { slugifyKey, type Proposal, type ScanResult } from '@a2c/shared';
import { useState } from 'react';
import { Button, Card, Checkbox, SectionTitle, SelectInput, TextArea } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { getActiveTab, readSelectedField } from '../services/tabs';

export function SavePageAnswer({ proposals, scan, tabId }: { proposals: Proposal[]; scan: ScanResult; tabId: number }) {
  const { checkFact, commitFact, vaultState } = useApp();
  const [fieldId, setFieldId] = useState('');
  const [value, setValue] = useState('');
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const eligible = proposals.filter((p) => p.field.risk !== 'red' && p.field.risk !== 'gray' && p.action !== 'draft');
  const selected = eligible.find((p) => p.fieldId === fieldId);
  const read = async () => {
    setBusy(true); setValue(''); setConsent(false);
    try {
      const tab = await getActiveTab();
      if (tab.id !== tabId || (tab.origin && tab.origin !== scan.origin)) throw new Error('Return to the scanned page or scan again.');
      const answer = await readSelectedField(tabId, scan.scanId, scan.origin, fieldId);
      if (!answer) throw new Error('This answer is empty, unsupported, changed or unsafe to save.');
      setValue(answer); setMessage('Review the answer and explicitly confirm saving it.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not read this answer.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!selected || !consent) return;
    setBusy(true);
    try {
      const check = checkFact({ key: selected.memoryKey ?? selected.missingKey ?? slugifyKey(selected.field.label), label: selected.missingLabel ?? selected.field.label, value, source: 'form_approved', domain: scan.origin });
      if (!check.ok) throw new Error(check.error);
      if (check.fact.sensitivity === 'private' && vaultState !== 'unlocked') throw new Error('Unlock your vault in Privacy to save private details.');
      await commitFact(check.fact); setValue(''); setConsent(false); setMessage('Saved for future forms.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return <Card><SectionTitle>Save an answer for future forms</SectionTitle>
    <p className="mb-2 text-xs text-muted">After completing or correcting the page, choose one reusable answer. A2C reads only that selected field when you click Review answer.</p>
    <SelectInput aria-label="Answer to save" value={fieldId} onChange={(e) => { setFieldId(e.target.value); setValue(''); setConsent(false); setMessage(''); }}><option value="">Choose a field</option>{eligible.map((p) => <option key={p.fieldId} value={p.fieldId}>{p.field.label}</option>)}</SelectInput>
    <Button className="my-2" disabled={!selected} loading={busy} onClick={() => void read()}>Review answer from page</Button>
    {value ? <><TextArea aria-label="Reviewed answer" value={value} maxLength={2000} onChange={(e) => { setValue(e.target.value); setConsent(false); }} /><Checkbox checked={consent} label="This is accurate and reusable. Save it, replacing the previous fact if present; private details go in my vault." onChange={setConsent} /><Button className="mt-2" disabled={!consent} loading={busy} onClick={() => void save()}>Save for future</Button></> : null}
    {message ? <p role="status" className="mt-2 text-xs">{message}</p> : null}
  </Card>;
}
