import { catalogEntry, validateFormat, type MemoryFact, type Proposal } from '@a2c/shared';
import { Bookmark, Cloud, Crosshair, Lock, PenLine, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge, Button, Checkbox, cx, SelectInput, StatusPill, TextArea, TextInput } from './ui';

export type SaveCheck = { ok: false; error: string } | { ok: true; needsExtraConfirm: boolean; isPrivate: boolean };

export interface ProposalRowProps {
  p: Proposal;
  providerKind: 'gemma' | 'specialist' | 'mock';
  draftFacts: MemoryFact[];
  onUpdate: (patch: Partial<Proposal>) => void;
  onDraft?: (keys: string[]) => Promise<void>;
  onUseOnce: (value: string | string[]) => void;
  onSaveCheck: (value: string) => SaveCheck;
  onSaveCommit: (value: string) => Promise<string | null>;
  /** Present only when cloud memory is enabled. Read-only lookup. */
  onCloudSearch?: () => Promise<Array<{ id: string; text: string; value: string }>>;
  /** Scroll to and flash this field on the page. */
  onLocate?: () => void;
}

const SOURCE_LABEL = { gemma: 'Gemma 4', specialist: 'Specialist', mock: 'Mock', rules: 'Instant rules', user: 'You' } as const;

function ValueEditor({ p, onChange, id }: { p: Proposal; onChange: (v: string | string[]) => void; id: string }) {
  const { field } = p;
  if (field.kind === 'select' || field.kind === 'radio') {
    return (
      <SelectInput id={id} value={typeof p.value === 'string' ? p.value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an option</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label || o.value}
          </option>
        ))}
      </SelectInput>
    );
  }
  if (field.kind === 'checkbox') {
    const selected = new Set(Array.isArray(p.value) ? p.value : []);
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {field.options.map((o) => (
          <Checkbox
            key={o.value}
            checked={selected.has(o.value)}
            label={o.label || o.value}
            onChange={(on) => {
              const next = new Set(selected);
              if (on) next.add(o.value);
              else next.delete(o.value);
              onChange([...next]);
            }}
          />
        ))}
      </div>
    );
  }
  const text = typeof p.value === 'string' ? p.value : '';
  if (field.kind === 'textarea')
    return (
      <div>
        <TextArea id={id} value={text} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />
        <div className={cx('mt-0.5 text-right text-[11px]', field.maxLength && text.length > field.maxLength ? 'text-danger' : 'text-muted')}>
          {text.length}
          {field.maxLength ? ` / ${field.maxLength}` : ''} characters
        </div>
      </div>
    );
  return (
    <TextInput
      id={id}
      type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
      value={text}
      maxLength={field.maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DraftPanel({ facts, providerKind, onDraft }: { facts: MemoryFact[]; providerKind: 'gemma' | 'specialist' | 'mock'; onDraft: (keys: string[]) => Promise<void> }) {
  const [selected, setSelected] = useState(() => new Set(facts.filter((f) => f.permission === 'auto').map((f) => f.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-2 p-2.5">
      <div className="text-xs font-medium">Facts that will be shared to write this draft</div>
      <div className="mt-0.5 text-[11px] text-muted">
        {providerKind !== 'mock' ? 'Sent to your A2C backend for Gemma 4, only for this draft. Private and secret facts are never included.' : 'MOCK MODE: a local template, not AI. Nothing is sent anywhere.'}
      </div>
      {facts.length === 0 ? (
        <div className="mt-2 text-xs text-muted">No shareable facts in memory yet.</div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
          {facts.map((f) => (
            <Checkbox
              key={f.key}
              checked={selected.has(f.key)}
              label={f.label}
              onChange={(on) => {
                const next = new Set(selected);
                if (on) next.add(f.key);
                else next.delete(f.key);
                setSelected(next);
              }}
            />
          ))}
        </div>
      )}
      {error ? <div className="mt-2 text-xs text-danger">{error}</div> : null}
      <Button
        className="mt-2.5"
        size="sm"
        variant="primary"
        icon={Sparkles}
        loading={busy}
        disabled={selected.size === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onDraft([...selected]);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Draft failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {providerKind !== 'mock' ? 'Draft with Gemma 4' : 'Draft (mock template)'}
      </Button>
    </div>
  );
}

function MissingPanel({ p, onUseOnce, onSaveCheck, onSaveCommit, onCloudSearch }: Pick<ProposalRowProps, 'p' | 'onUseOnce' | 'onSaveCheck' | 'onSaveCommit' | 'onCloudSearch'>) {
  const id = useId();
  const [value, setValue] = useState('');
  const [cloudHits, setCloudHits] = useState<Array<{ id: string; text: string; value: string }> | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ isPrivate: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasOptions = p.field.kind === 'select' || p.field.kind === 'radio';
  const label = p.missingLabel ?? p.field.label;

  const validate = (): boolean => {
    if (!value.trim()) {
      setError('Enter a value first');
      return false;
    }
    if (!hasOptions && p.field.kind !== 'checkbox') {
      const e = validateFormat(p.field.kind, value);
      if (e) {
        setError(e);
        return false;
      }
    }
    setError(null);
    return true;
  };

  const commit = async () => {
    setBusy(true);
    const err = await onSaveCommit(value);
    setBusy(false);
    if (err) setError(err);
    setConfirm(null);
  };

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-2 p-2.5">
      <label htmlFor={id} className="text-xs font-medium">
        Missing information: {label}
      </label>
      {p.note ? <div className="mt-0.5 text-[11px] text-muted">{p.note}</div> : null}
      <div className="mt-1.5">
        {hasOptions ? (
          <SelectInput id={id} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Choose an option</option>
            {p.field.options.map((o) => (
              <option key={o.value} value={o.label || o.value}>
                {o.label || o.value}
              </option>
            ))}
          </SelectInput>
        ) : (
          <TextInput
            id={id}
            value={value}
            placeholder={p.field.kind === 'checkbox' ? 'Comma separated' : `Your ${label.toLowerCase()}`}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
        )}
      </div>
      {onCloudSearch && !hasOptions ? (
        <div className="mt-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={Cloud}
            loading={cloudBusy}
            onClick={async () => {
              setCloudBusy(true);
              try {
                setCloudHits(await onCloudSearch());
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Cloud memory unavailable');
              } finally {
                setCloudBusy(false);
              }
            }}
          >
            Search cloud memory
          </Button>
          {cloudHits ? (
            cloudHits.length === 0 ? (
              <div className="text-[11px] text-muted">No matching cloud memory.</div>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {cloudHits.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="w-full border-2 border-line bg-surface px-2 py-1 text-left text-[12px] hover:border-ink" onClick={() => setValue(h.value)}>
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
      {error ? <div className="mt-1.5 text-xs text-danger">{error}</div> : null}
      {confirm ? (
        <div className="mt-2 rounded-md bg-warn-soft p-2 text-xs">
          <div className="font-medium text-ink">Save sensitive information?</div>
          <div className="mt-0.5 text-ink/80">
            {confirm.isPrivate ? 'This will be stored encrypted in your vault and will always ask before use.' : 'This is personal information. It will be stored locally and ask before use.'}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={commit}>
              Confirm save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={PenLine}
            onClick={() => {
              if (!validate()) return;
              if (p.field.kind === 'checkbox') onUseOnce(value);
              else if (hasOptions) onUseOnce(p.field.options.find((o) => (o.label || o.value) === value)?.value ?? '');
              else onUseOnce(value);
            }}
          >
            Use once
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={Bookmark}
            loading={busy}
            onClick={async () => {
              if (!validate()) return;
              const check = onSaveCheck(value);
              if (!check.ok) {
                setError(check.error);
                return;
              }
              if (check.needsExtraConfirm) {
                setConfirm({ isPrivate: check.isPrivate });
                return;
              }
              await commit();
            }}
          >
            Save to memory
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProposalRow({ p, providerKind, draftFacts, onUpdate, onDraft, onUseOnce, onSaveCheck, onSaveCommit, onCloudSearch, onLocate }: ProposalRowProps) {
  const id = useId();
  const editable = p.status === 'ready' || p.status === 'review';
  const memLabel = p.memoryKey ? (catalogEntry(p.memoryKey)?.label ?? p.memoryKey) : null;
  const needsDraft = p.action === 'draft' && editable && (typeof p.value === 'string' ? !p.value.trim() : true);
  const canApprove = editable && (Array.isArray(p.value) ? p.value.length > 0 : p.value.trim() !== '') && (!p.field.hasExistingValue || p.allowOverwrite);

  return (
    <li
      className={cx(
        'rounded-xl border bg-surface p-3',
        p.status === 'blocked' ? 'border-danger/30' : p.status === 'completed' ? 'border-ok/40' : p.status === 'failed' ? 'border-danger/40' : 'border-line',
      )}
    >
      <div className="flex items-start gap-2.5">
        {editable ? (
          <input
            type="checkbox"
            aria-label={`Approve ${p.field.label}`}
            className="mt-0.5 size-4 shrink-0 accent-[var(--cf-accent)]"
            checked={p.approved}
            disabled={!canApprove}
            onChange={(e) => onUpdate({ approved: e.target.checked })}
          />
        ) : (
          <span className="mt-0.5 size-4 shrink-0" aria-hidden>
            {p.status === 'blocked' || p.status === 'unsupported' ? <Lock className="size-4 text-muted" /> : null}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <label htmlFor={id} className="min-w-0 truncate text-[13px] font-medium" title={p.field.label}>
              {p.field.label}
              {p.field.required ? <span className="ml-0.5 text-danger">*</span> : null}
            </label>
            <span className="flex shrink-0 items-center gap-1">
              {onLocate ? (
                <button type="button" className="p-0.5 text-muted hover:text-ink" title="Show this field on the page" aria-label={`Show ${p.field.label} on the page`} onClick={onLocate}>
                  <Crosshair className="size-3.5" aria-hidden />
                </button>
              ) : null}
              <StatusPill status={p.status} />
            </span>
          </div>

          {p.status === 'blocked' ? (
            <div className="mt-1 text-xs text-muted">
              {p.field.riskReason || p.reason}. {p.note ?? 'Not read, stored or sent to AI.'}
            </div>
          ) : null}
          {p.status === 'unsupported' ? <div className="mt-1 text-xs text-muted">{p.field.riskReason}. Complete this yourself.</div> : null}
          {(p.status === 'completed' || p.status === 'failed' || p.status === 'skipped') && p.note ? (
            <div className={cx('mt-1 text-xs', p.status === 'failed' ? 'text-danger' : 'text-muted')}>{p.note}</div>
          ) : null}

          {editable ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                {memLabel ? <Badge tone="accent">Memory: {memLabel}</Badge> : null}
                {p.action === 'draft' ? <Badge tone="warn">Draft - review required</Badge> : null}
                <span>
                  {SOURCE_LABEL[p.source]}
                  {p.source !== 'user' && p.confidence ? ` · ${Math.round(p.confidence * 100)}%` : ''}
                </span>
                {p.field.risk === 'amber' ? <Badge tone="warn">{p.field.riskReason}</Badge> : null}
              </div>
              {needsDraft && onDraft ? (
                <DraftPanel facts={draftFacts} providerKind={providerKind} onDraft={onDraft} />
              ) : (
                <div className="mt-2">
                  <ValueEditor id={id} p={p} onChange={(v) => onUpdate({ value: v, source: 'user' })} />
                </div>
              )}
              {p.note ? <div className="mt-1.5 text-[11px] text-warn">{p.note}</div> : null}
              {p.field.hasExistingValue ? (
                <div className="mt-1.5">
                  <Checkbox checked={p.allowOverwrite} label="Replace the value already on the page" onChange={(v) => onUpdate({ allowOverwrite: v, approved: v ? p.approved : false })} />
                </div>
              ) : null}
            </>
          ) : null}

          {p.status === 'missing' ? <MissingPanel p={p} onUseOnce={onUseOnce} onSaveCheck={onSaveCheck} onSaveCommit={onSaveCommit} onCloudSearch={onCloudSearch} /> : null}
        </div>
      </div>
    </li>
  );
}
