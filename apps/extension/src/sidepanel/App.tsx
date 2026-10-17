import { Brain, FileText, Home, Settings as SettingsIcon, Shield, Wand2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge, cx, type Tone } from '../components/ui';
import { useApp, type HealthState } from '../hooks/useApp';
import { AutofillTab } from './AutofillTab';
import { DocumentsTab } from './DocumentsTab';
import { HomeTab } from './HomeTab';
import { MemoryTab } from './MemoryTab';
import { Onboarding } from './Onboarding';
import { PrivacyTab } from './PrivacyTab';
import { SettingsTab } from './SettingsTab';

type TabId = 'home' | 'autofill' | 'memory' | 'templates' | 'privacy' | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'autofill', label: 'Autofill', icon: Wand2 },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

/** Connection label, shown as "connected" only after a successful status check. */
export function engineLabel(mode: 'auto' | 'gemma' | 'specialist' | 'mock', health: HealthState): { tone: Tone; text: string } {
  if (mode === 'mock') return { tone: 'warn', text: 'Mock mode' };
  if (health.state === 'checking') return { tone: 'neutral', text: 'Checking' };
  if (health.state === 'unauthorized') return { tone: 'danger', text: 'Token rejected' };
  if (health.state === 'unreachable') return { tone: 'danger', text: 'Backend offline' };
  if (mode === 'auto') {
    const s = health.data.specialist;
    const g = health.data.gemma;
    if (s.configured && s.reachable === true) return { tone: 'ok', text: 'Auto: specialist + Gemma 4' };
    if (g.configured && g.reachable === true) return { tone: 'ok', text: 'Auto: Gemma 4' };
    if (!s.configured && !g.configured) return { tone: 'warn', text: 'AI not set up' };
    return { tone: g.reachable === false ? 'danger' : 'neutral', text: g.reachable === false ? 'AI offline' : 'AI unchecked' };
  }
  const target = mode === 'specialist' ? health.data.specialist : health.data.gemma;
  const name = mode === 'specialist' ? 'Specialist' : 'Gemma 4';
  if (!target.configured) return { tone: 'warn', text: `${name} not set up` };
  if (target.reachable === true) return { tone: 'ok', text: `${name} connected` };
  if (target.reachable === false) return { tone: 'danger', text: `${name} offline` };
  return { tone: 'neutral', text: `${name} unchecked` };
}

export function App() {
  const { ready, settings, health, facts } = useApp();
  const [tab, setTab] = useState<TabId>('home');

  if (!ready) return <div className="font-pixel p-4 text-muted">Loading...</div>;
  if (!settings.onboarded) return <Onboarding />;
  const engine = engineLabel(settings.aiMode, health);

  return (
    <div className="flex min-h-full flex-col">
      <header className="app-header sticky top-0 z-10 border-b border-line">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="app-brand" aria-label="A2C">A2C_</div>
            <div>
              <div className="text-[11px] leading-tight text-muted">Your memory.<br />Your permission.</div>
            </div>
          </div>
          <Badge tone={engine.tone}>{engine.text}</Badge>
        </div>
        <nav className="flex gap-1 px-2 pb-2" aria-label="Sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={cx(
                'flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-md border px-0.5 py-1 text-[11px]',
                tab === id ? 'border-line bg-surface-2 text-ink' : 'border-transparent text-muted hover:text-ink hover:bg-surface',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 p-3">
        {/* Keep Autofill and Templates mounted so their state survives tab switches. */}
        <div hidden={tab !== 'autofill'}>
          <AutofillTab />
          <button type="button" onClick={() => setTab('memory')} className="mt-4 flex w-full items-center justify-between gap-3 rounded-md border border-line bg-surface p-3 text-left">
            <span><span className="block text-sm font-semibold">{facts.length ? 'Your profile' : 'Build your profile'}</span><span className="text-xs text-muted">{facts.length} saved facts · Review and edit in Memory</span></span>
            <Brain className="size-5 text-muted" aria-hidden />
          </button>
        </div>
        {tab === 'home' ? <HomeTab onGo={setTab} /> : null}
        {tab === 'memory' ? <MemoryTab /> : null}
        <div hidden={tab !== 'templates'}>
          <DocumentsTab />
        </div>
        {tab === 'privacy' ? <PrivacyTab /> : null}
        {tab === 'settings' ? <SettingsTab /> : null}
      </main>
    </div>
  );
}
