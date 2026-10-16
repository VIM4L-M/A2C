import { Brain, FileText, Settings as SettingsIcon, Shield, Wand2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge, cx, type Tone } from '../components/ui';
import { useApp, type HealthState } from '../hooks/useApp';
import { AutofillTab } from './AutofillTab';
import { DocumentsTab } from './DocumentsTab';
import { MemoryTab } from './MemoryTab';
import { Onboarding } from './Onboarding';
import { PrivacyTab } from './PrivacyTab';
import { SettingsTab } from './SettingsTab';

type TabId = 'autofill' | 'memory' | 'templates' | 'privacy' | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'autofill', label: 'Autofill', icon: Wand2 },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

/** Connection label, shown as "connected" only after a successful status check. */
export function engineLabel(mode: 'gemma' | 'specialist' | 'mock', health: HealthState): { tone: Tone; text: string } {
  if (mode === 'mock') return { tone: 'warn', text: 'Mock mode' };
  if (health.state === 'checking') return { tone: 'neutral', text: 'Checking' };
  if (health.state === 'unauthorized') return { tone: 'danger', text: 'Token rejected' };
  if (health.state === 'unreachable') return { tone: 'danger', text: 'Backend offline' };
  const target = mode === 'specialist' ? health.data.specialist : health.data.gemma;
  const name = mode === 'specialist' ? 'Specialist' : 'Gemma 4';
  if (!target.configured) return { tone: 'warn', text: `${name} not set up` };
  if (target.reachable === true) return { tone: 'ok', text: `${name} connected` };
  if (target.reachable === false) return { tone: 'danger', text: `${name} offline` };
  return { tone: 'neutral', text: `${name} unchecked` };
}

export function App() {
  const { ready, settings, health } = useApp();
  const [tab, setTab] = useState<TabId>('autofill');

  if (!ready) return <div className="font-pixel p-4 text-muted">Loading...</div>;
  if (!settings.onboarded) return <Onboarding />;
  const engine = engineLabel(settings.aiMode, health);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b-2 border-ink bg-bg">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="font-pixel grid h-8 place-items-center border-2 border-ink bg-accent px-1.5 text-[15px] text-accent-ink shadow-[2px_2px_0_0_var(--cf-ink)]">A2C</div>
            <div>
              <div className="font-pixel text-[15px] leading-tight">AI to Completion</div>
              <div className="text-[11px] leading-tight text-muted">Your memory. Any form. Automatically completed.</div>
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
                'font-pixel flex flex-1 flex-col items-center gap-0.5 border-2 px-0.5 py-1 text-[11px]',
                tab === id ? 'border-ink bg-surface text-ink shadow-[2px_2px_0_0_var(--cf-ink)]' : 'border-transparent text-muted hover:text-ink',
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
        </div>
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
