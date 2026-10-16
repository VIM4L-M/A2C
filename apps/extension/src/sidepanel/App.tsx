import { Activity, Brain, FileText, Shield, Wand2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge, cx } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { ActivityTab } from './ActivityTab';
import { AutofillTab } from './AutofillTab';
import { DocumentsTab } from './DocumentsTab';
import { MemoryTab } from './MemoryTab';
import { Onboarding } from './Onboarding';
import { PrivacyTab } from './PrivacyTab';

type TabId = 'autofill' | 'memory' | 'documents' | 'privacy' | 'activity';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'autofill', label: 'Autofill', icon: Wand2 },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'documents', label: 'Docs', icon: FileText },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'activity', label: 'Activity', icon: Activity },
];

function EngineBadge() {
  const { settings, health } = useApp();
  if (settings.aiMode === 'mock') return <Badge tone="warn">MOCK MODE</Badge>;
  if (health.status === 'ok') return <Badge tone="ok">Gemma 4</Badge>;
  if (health.status === 'checking') return <Badge>Checking AI</Badge>;
  return <Badge tone="danger">Gemma not connected</Badge>;
}

export function App() {
  const { ready, settings } = useApp();
  const [tab, setTab] = useState<TabId>('autofill');

  if (!ready) return <div className="p-4 text-muted">Loading...</div>;
  if (!settings.onboarded) return <Onboarding />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-ink">C</div>
            <div>
              <div className="text-[14px] font-semibold leading-tight">ContextFill AI</div>
              <div className="text-[11px] leading-tight text-muted">Your context. Any form. One click.</div>
            </div>
          </div>
          <EngineBadge />
        </div>
        <nav className="flex gap-0.5 px-2 pb-1.5" aria-label="Sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={cx(
                'flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] transition-colors',
                tab === id ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--cf-line)]' : 'text-muted hover:text-ink',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 p-3">
        {/* Keep Autofill mounted so a scan survives tab switches. */}
        <div hidden={tab !== 'autofill'}>
          <AutofillTab />
        </div>
        {tab === 'memory' ? <MemoryTab /> : null}
        <div hidden={tab !== 'documents'}>
          <DocumentsTab />
        </div>
        {tab === 'privacy' ? <PrivacyTab /> : null}
        {tab === 'activity' ? <ActivityTab /> : null}
      </main>
    </div>
  );
}
