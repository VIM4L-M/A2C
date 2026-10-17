import { catalogEntry } from '@a2c/shared';
import { Activity as ActivityIcon, ArrowRight, Brain, CheckCircle2, Circle, ScanLine, Shield } from 'lucide-react';
import { Badge, Button, Card, EmptyState, SectionTitle, Stat } from '../components/ui';
import { useApp } from '../hooks/useApp';

export type HomeTarget = 'autofill' | 'memory' | 'privacy';

/** Profile facts that make most forms fillable. Shown as a checklist, never invented. */
const ESSENTIALS = ['full_name', 'email', 'college', 'degree', 'graduation_year', 'skills', 'github_url'] as const;

/** Estimated seconds a person needs to type one field by hand. A stated assumption, not a measurement. */
export const SECONDS_PER_FIELD = 6;

export function formatSaved(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

const EVENT_LABEL = { scan: 'Scanned a form', fill: 'Filled a form', document: 'Completed a template', memory_saved: 'Saved a fact' } as const;

export function HomeTab({ onGo }: { onGo: (target: HomeTarget) => void }) {
  const { facts, factMap, activity, settings } = useApp();
  const name = factMap.get('preferred_name')?.value || factMap.get('full_name')?.value || '';
  const have = ESSENTIALS.filter((k) => Boolean(factMap.get(k)?.value));
  const pct = Math.round((have.length / ESSENTIALS.length) * 100);
  const saved = activity.fieldsFilled * SECONDS_PER_FIELD;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="text-[11px] tracking-wide text-muted uppercase">Welcome back</div>
        <h1 className="font-pixel mt-1 text-2xl leading-tight">{name ? `Hello, ${name.split(' ')[0]}.` : 'Hello, you.'}</h1>
        <p className="mt-1 text-xs text-muted">Open a form, press Scan Form, review, fill. You always submit it yourself.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" icon={ScanLine} onClick={() => onGo('autofill')}>
            Scan this form
          </Button>
          <Button icon={Brain} onClick={() => onGo('memory')}>
            Add context
          </Button>
        </div>
      </Card>

      <section aria-label="Your usage">
        <SectionTitle>Your usage</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Forms scanned" value={activity.scans} />
          <Stat label="Fields filled" value={activity.fieldsFilled} tone="ok" />
          <Stat label="Fields blocked" value={activity.fieldsBlocked} tone="danger" />
          <Stat label="Facts saved" value={facts.length} tone="accent" />
          <Stat label="Templates" value={activity.documentsCompleted} />
          <Stat label="Typing saved" value={formatSaved(saved)} tone="ok" />
        </div>
        <p className="mt-1.5 text-[11px] text-muted">Counts come from this browser only. Typing saved is an estimate at {SECONDS_PER_FIELD} s per field.</p>
      </section>

      <Card>
        <SectionTitle action={<Badge tone={pct === 100 ? 'ok' : 'accent'}>{pct}%</Badge>}>Profile checklist</SectionTitle>
        <div className="h-2 w-full border-2 border-ink bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {ESSENTIALS.map((key) => {
            const ok = have.includes(key);
            const Icon = ok ? CheckCircle2 : Circle;
            return (
              <li key={key} className={`flex items-center gap-1.5 text-xs ${ok ? 'text-ink' : 'text-muted'}`}>
                <Icon className={`size-3.5 ${ok ? 'text-ok' : ''}`} aria-hidden />
                {catalogEntry(key)?.label ?? key}
              </li>
            );
          })}
        </ul>
        {pct < 100 ? (
          <Button className="mt-3" size="sm" icon={ArrowRight} onClick={() => onGo('memory')}>
            Fill the gaps
          </Button>
        ) : null}
      </Card>

      <Card>
        <SectionTitle action={<Badge tone={settings.cloudMemory ? 'accent' : 'neutral'}>{settings.cloudMemory ? 'Cloud on' : 'Local only'}</Badge>}>Privacy at a glance</SectionTitle>
        <ul className="list-disc space-y-1 pl-4 text-xs text-ink/85">
          <li>Passwords, one-time codes and card data are never read or filled.</li>
          <li>Sensitive fields ask first; permissions are per website and revocable.</li>
          <li>Nothing is learned from pages unless you press Save.</li>
        </ul>
        <Button className="mt-3" size="sm" icon={Shield} onClick={() => onGo('privacy')}>
          Review permissions
        </Button>
      </Card>

      <Card>
        <SectionTitle>Recent activity</SectionTitle>
        {activity.recent.length === 0 ? (
          <EmptyState icon={ActivityIcon} title="Nothing yet">
            Scan a form to start. Only counts and times are kept, never values.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {activity.recent.slice(0, 6).map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span>{EVENT_LABEL[e.type]}</span>
                <span className="text-muted tabular-nums">
                  {e.type === 'fill' ? `${e.filled} filled · ` : ''}
                  {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
