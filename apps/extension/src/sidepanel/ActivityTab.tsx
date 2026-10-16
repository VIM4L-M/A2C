import { Activity as ActivityIcon } from 'lucide-react';
import { Card, EmptyState, SectionTitle, Stat } from '../components/ui';
import { useApp } from '../hooks/useApp';

const EVENT_LABEL = { scan: 'Scanned a form', fill: 'Filled a form', document: 'Completed a document', memory_saved: 'Saved a fact' } as const;

export function ActivityTab() {
  const { activity } = useApp();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Fields filled" value={activity.fieldsFilled} tone="ok" />
        <Stat label="Blocked" value={activity.fieldsBlocked} tone="danger" />
        <Stat label="Scans" value={activity.scans} />
        <Stat label="Skipped" value={activity.fieldsSkipped} />
        <Stat label="Failed" value={activity.fieldsFailed} />
        <Stat label="Documents" value={activity.documentsCompleted} tone="accent" />
      </div>
      <Card>
        <SectionTitle>Recent</SectionTitle>
        {activity.recent.length === 0 ? (
          <EmptyState icon={ActivityIcon} title="No activity yet" />
        ) : (
          <ul className="divide-y divide-line">
            {activity.recent.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span>{EVENT_LABEL[e.type]}</span>
                <span className="text-muted tabular-nums">
                  {e.type === 'fill' ? `${e.filled} filled · ${e.skipped} skipped · ${e.failed} failed · ` : ''}
                  {e.type === 'scan' && e.blocked ? `${e.blocked} blocked · ` : ''}
                  {new Date(e.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[11px] text-muted">Only counts and times are kept. Values, labels, websites, documents and submissions are never logged.</p>
    </div>
  );
}
