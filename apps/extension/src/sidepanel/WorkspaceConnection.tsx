import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useApp } from '../hooks/useApp';
import { chromeKV } from '../lib/storage';
import { BRIDGE_KEY, PENDING_KEY, GrantSchema, CandidatesSchema, WORKSPACE_ORIGIN } from '../lib/workspaceBridge';
import { Button, Card, Checkbox, Notice, SectionTitle } from '../components/ui';

export function WorkspaceConnection() {
  const app = useApp();
  const [grant, setGrant] = useState<z.infer<typeof GrantSchema>>({ enabled: false, shareActivity: false, keys: [] });
  const [pending, setPending] = useState<z.infer<typeof CandidatesSchema>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { const g = GrantSchema.safeParse(await chromeKV.get(BRIDGE_KEY)); if(g.success) setGrant(g.data); const p = CandidatesSchema.safeParse(await chromeKV.get(PENDING_KEY)); setPending(p.success ? p.data : []); setSelected([]); };
  useEffect(() => { void load(); }, []);
  const eligible = app.facts.filter(f => f.sensitivity === 'standard' && f.verified !== false && f.permission !== 'never' && !app.settings.disabledCategories.includes(f.category));
  async function saveGrant() { await chromeKV.set(BRIDGE_KEY, GrantSchema.parse(grant)); if (!grant.enabled) await chromeKV.remove(PENDING_KEY); setMessage(grant.enabled ? 'Sharing choices saved. Refresh the website connection.' : 'Connection revoked. Copies already saved on the website remain there.'); await load(); }
  async function accept() {
    setBusy(true); setMessage('');
    try {
      for (const candidate of pending.filter(f => selected.includes(f.key))) {
        const existing = app.factMap.get(candidate.key);
        const check = app.checkFact({ ...candidate, source: 'manual' });
        if (!check.ok || check.fact.sensitivity !== 'standard' || existing?.permission === 'never' || (check.ok && app.settings.disabledCategories.includes(check.fact.category))) throw Error('A fact is no longer eligible. Review your privacy choices.');
        await app.commitFact(check.fact);
      }
      await chromeKV.remove(PENDING_KEY); await load(); setMessage('Selected facts saved. Unselected suggestions discarded.');
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  return <Card><SectionTitle>Website workspace connection</SectionTitle><p className="mb-3 text-xs text-muted">Only {WORKSPACE_ORIGIN}/workspace/workspace.html. This shares selected facts with that website; it does not grant fill or cloud permission. Private facts and access tokens never cross this connection.</p><p className="mb-3 break-all text-xs">Extension ID: <code>{chrome.runtime.id}</code></p><div className="flex flex-col gap-3"><Checkbox label="Allow this local website to connect" checked={grant.enabled} onChange={enabled => setGrant({...grant,enabled})}/><Checkbox label="Share real activity counts and timestamps" checked={grant.shareActivity} onChange={shareActivity => setGrant({...grant,shareActivity})}/><p className="text-xs text-muted">Choose each fact the website may read. Saving a copy there requires another confirmation.</p>{eligible.map(f=><Checkbox key={f.key} label={`Share ${f.label}: ${f.value}`} checked={grant.keys.includes(f.key)} onChange={v=>setGrant({...grant,keys:v?[...grant.keys,f.key]:grant.keys.filter(k=>k!==f.key)})}/>)}<Button onClick={()=>void saveGrant()}>Save connection choices</Button><Button onClick={()=>void load()}>Check for website suggestions</Button>{pending.length ? <><p className="text-xs">Website suggestions — confirm each accurate fact before saving. Existing values will be replaced.</p>{pending.map(f=><Checkbox key={f.key} label={`Confirm ${f.key}: ${f.value}`} checked={selected.includes(f.key)} onChange={v=>setSelected(v?[...selected,f.key]:selected.filter(k=>k!==f.key))}/>)}<Button disabled={!selected.length} loading={busy} onClick={()=>void accept()}>Save confirmed website facts</Button><Button onClick={async()=>{await chromeKV.remove(PENDING_KEY);await load();}}>Discard suggestions</Button></>:null}{message?<Notice>{message}</Notice>:null}</div></Card>;
}
