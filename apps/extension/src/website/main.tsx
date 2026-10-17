import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, BookOpen, FileInput, LayoutDashboard, Settings, Shield, UserCheck, UserRound } from 'lucide-react';
import { AppProvider, useApp } from '../hooks/useApp';
import type { KV } from '../lib/storage';
import { ActivityTab } from '../sidepanel/ActivityTab';
import { MemoryTab } from '../sidepanel/MemoryTab';
import { ContextImport } from '../sidepanel/ContextImport';
import { PrivacyTab } from '../sidepanel/PrivacyTab';
import { Card, SectionTitle } from '../components/ui';
import '../styles/index.css';
import './website.css';
import { Connection, ConnectedActivity } from './Connection';
import { AccountPage, loadAccount } from './Account';
import { firstName } from '../lib/account';
import { ActivitySchema } from '../lib/activity';
import { SECONDS_PER_FIELD, formatSaved } from '../sidepanel/HomeTab';

// Website-owned storage: never impersonate or silently read extension storage.
const websiteKV: KV = {
  async get<T>(key: string) { const value = localStorage.getItem(`a2c_web_${key}`); return value ? JSON.parse(value) as T : undefined; },
  async set(key, value) { localStorage.setItem(`a2c_web_${key}`, JSON.stringify(value)); },
  async remove(key) { localStorage.removeItem(`a2c_web_${key}`); },
};
const pages = [
  { id: 'account', title: 'Account', icon: UserCheck, subtitle: 'Create your account here, then connect the extension to it.' },
  { id: 'dashboard', title: 'Overview', icon: LayoutDashboard, subtitle: 'A little less repetition. A little more room to think.' },
  { id: 'walkthrough', title: 'Getting started', icon: BookOpen, subtitle: 'Four small steps. You stay in control at every one.' },
  { id: 'profile', title: 'Your profile', icon: UserRound, subtitle: 'The facts you choose to reuse. Nothing invented.' },
  { id: 'imports', title: 'Imports & answers', icon: FileInput, subtitle: 'Turn your context into facts you can review.' },
  { id: 'privacy', title: 'Privacy', icon: Shield, subtitle: 'Your information. Your boundaries.' },
  { id: 'settings', title: 'Settings', icon: Settings, subtitle: 'Know what is connected and where your data lives.' },
] as const;
function route() { const id = location.hash.slice(1).split('?')[0]; return id || (loadAccount() ? 'dashboard' : 'account'); }

/** Big usage tiles. Real numbers only: from the extension snapshot when connected, otherwise an honest dash. */
function StatTiles() {
  const { facts } = useApp();
  let snap: ReturnType<typeof ActivitySchema.parse> | null = null;
  try { const p = ActivitySchema.safeParse(JSON.parse(sessionStorage.getItem('a2c_shared_activity') ?? 'null')); snap = p.success ? p.data : null; } catch { snap = null; }
  const tiles: Array<[string, string | number, string]> = [
    ['Fields filled', snap ? snap.fieldsFilled : '—', snap ? 'Across every form you used A2C on' : 'Connect the extension in Settings'],
    ['Forms scanned', snap ? snap.scans : '—', snap ? 'Each scan is your explicit click' : 'Shown after a snapshot refresh'],
    ['Typing saved', snap ? formatSaved(snap.fieldsFilled * SECONDS_PER_FIELD) : '—', `Estimate at ${SECONDS_PER_FIELD} s per field`],
    ['Fields blocked', snap ? snap.fieldsBlocked : '—', 'Passwords, codes and card data'],
    ['Confirmed facts', facts.filter(f => f.verified !== false).length, 'Saved in this website workspace'],
  ];
  return <section aria-label="Usage at a glance" className="web-hero-stats">{tiles.map(([label, value, note]) => <div key={label} className="web-tile"><p className="web-kicker">{label}</p><p className="web-tile-value">{value}</p><p className="web-tile-note">{note}</p></div>)}</section>;
}
function Dashboard() {
  const { facts, activity } = useApp();
  const account = loadAccount();
  return <>{account ? <Card><p className="web-kicker">WELCOME BACK</p><p className="font-pixel text-4xl">Hello, {firstName(account.name)}.</p></Card> : <Card><p className="text-muted">You have no account yet. <a className="web-link" href="#account">Create one</a> to connect the extension.</p></Card>}<StatTiles /><ConnectedActivity /><div className="web-metrics">{[['Confirmed facts', facts.filter(f => f.verified !== false).length], ['Profile updates', activity.recent.filter(e => e.type === 'memory_saved').length], ['Extension activity', 'Explicit refresh']].map(([label, value]) => <Card key={label}><p className="web-kicker">{label}</p><div className="web-metric">{value}</div><p className="text-xs text-muted">{label === 'Profile updates' ? 'In the recent activity window' : label === 'Extension activity' ? 'View the shared snapshot above' : 'Saved in this website workspace'}</p></Card>)}</div><div className="web-columns"><Card><SectionTitle>Your next step</SectionTitle><h2 className="font-pixel text-3xl">Make A2C yours.</h2><p className="my-4 text-muted">Add your profile, review imported facts, then use the extension to fill forms with permission.</p><a className="web-cta" href="#walkthrough">Start the walkthrough <ArrowUpRight size={16}/></a></Card><Card><SectionTitle>Built around your choices</SectionTitle><ul className="web-checklist"><li>Review every imported fact</li><li>Keep credentials out of memory</li><li>Separate fill, save and sharing consent</li><li>Submit website forms yourself</li></ul></Card></div><Card><SectionTitle>Workspace activity</SectionTitle><ActivityTab /></Card></>;
}
function Walkthrough() {
  return <div className="web-guide">{[
    ['01', 'Install the extension', 'Build the unpacked Chrome extension and open it from the toolbar. This website is your companion workspace.', '../landing.html#download', 'Installation guide'],
    ['02', 'Add your context', 'Start with a few profile facts. Resume uploads and longer context are optional.', '#profile', 'Open your profile'],
    ['03', 'Review your boundaries', 'Choose categories and inspect permissions. Passwords and security credentials always stay manual.', '#privacy', 'Review privacy'],
    ['04', 'Try a fictional form', 'Use the extension to scan, review and insert. Transfer selected profile facts through Settings, then confirm them in the extension.', '../registration.html', 'Open practice form'],
  ].map(([number,title,text,href,label]) => <Card key={number}><div className="web-step">{number}</div><h2 className="font-pixel text-2xl">{title}</h2><p className="my-3 text-muted">{text}</p><a className="web-link" href={href}>{label} →</a></Card>)}</div>;
}
function Imports() {
  const { facts } = useApp();
  const saved = facts.filter(f => f.provenance.source === 'form_approved');
  return <><ContextImport allowLocalModel={false} /><Card><SectionTitle>Saved answers</SectionTitle>{saved.length ? <ul>{saved.map(f => <li key={f.key}>{f.label}: {f.sensitivity === 'private' ? 'Private — manage in Profile' : f.value}</li>)}</ul> : <p className="text-muted">No page answers saved here. Saving a page answer requires selecting and reviewing it in the extension, then a separate save action. Share selected saved answers in extension Settings, then review and save them through this website’s Settings.</p>}<a className="web-link" href="#profile">Manage confirmed facts →</a></Card></>;
}
function WebsiteSettings() {
  return <><Connection /><Card><SectionTitle>Storage and connection boundaries</SectionTitle><p className="text-sm text-muted">Facts are kept separately in this website and the extension. Transfers require per-fact confirmation. Activity is an explicitly refreshed snapshot. Revoke access in extension Settings; existing website copies remain until deleted here. Private vault data, fill permissions and backend credentials are never synchronized. Cloud accounts and cross-device synchronization are not enabled.</p><a className="web-link" href="#privacy">Manage website-local data →</a></Card></>;
}

function Website() {
  const [current, setCurrent] = useState(route);
  const { ready } = useApp();
  const [acct, setAcct] = useState(loadAccount);
  useEffect(() => { const change = () => { setCurrent(route()); window.scrollTo(0,0); }; window.addEventListener('hashchange',change); return () => window.removeEventListener('hashchange',change); }, []);
  const page = pages.find(p => p.id === current);
  useEffect(() => { document.title = `${page?.title ?? 'Page not found'} · A2C`; document.getElementById('page-title')?.focus(); }, [current, page]);
  return <div className="web-shell"><a className="web-skip" href="#web-content" onClick={e => { e.preventDefault(); document.getElementById('web-content')?.focus(); }}>Skip to content</a><aside className="web-sidebar"><a className="app-brand" href="../landing.html">A2C_</a><p className="web-kicker">{acct ? `SIGNED IN AS ${firstName(acct.name).toUpperCase()}` : 'YOUR PERSONAL WORKSPACE'}</p><nav aria-label="Workspace pages">{pages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={current === p.id ? 'page' : undefined}><p.icon size={18}/>{p.title}</a>)}</nav><div className="web-sidebar-note"><Shield size={18}/><p>Local to this browser.<br/>Always on your terms.</p></div><a className="web-link" href="../landing.html">Back to website ↗</a></aside><main tabIndex={-1} id="web-content" className="web-main"><div className="web-topline"><span>WORKSPACE / {page?.title.toUpperCase() ?? 'NOT FOUND'}</span><a href="#settings">Manage extension connection</a></div><header className="web-page-heading"><h1 id="page-title" tabIndex={-1}>{page?.title ?? 'Page not found'}</h1><p>{page?.subtitle ?? 'Choose a page from the navigation.'}</p></header><div className="web-boundary">Local workspace · Connect in Settings to transfer confirmed facts and refresh real extension activity. Transfers never grant permission to fill.</div><div className="web-content">{!ready ? <p role="status">Loading your workspace…</p> : current === 'account' ? <AccountPage onChange={() => setAcct(loadAccount())}/> : current === 'dashboard' ? <Dashboard/> : current === 'walkthrough' ? <Walkthrough/> : current === 'profile' ? <MemoryTab showImport={false}/> : current === 'imports' ? <Imports/> : current === 'privacy' ? <PrivacyTab showCloud={false}/> : current === 'settings' ? <WebsiteSettings/> : <a href="#dashboard">Return to overview</a>}</div></main></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider kv={websiteKV}><Website/></AppProvider></StrictMode>);
