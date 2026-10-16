import { catalogEntry, MEMORY_CATALOG, MEMORY_KEY_RE, slugifyKey, type MemoryCategory, type MemoryFact, type MemoryPermission } from '@a2c/shared';
import { Brain, Eye, EyeOff, Lock, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, FieldLabel, Notice, SectionTitle, SelectInput, TextArea, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  identity: 'Identity',
  contact: 'Contact',
  education: 'Education',
  work: 'Work',
  links: 'Public links',
  skills: 'Skills',
  other: 'Other',
};

const PERMISSION_LABEL: Record<MemoryPermission, string> = {
  auto: 'Use automatically',
  ask: 'Ask every time',
  never: 'Never use',
};

function provenanceText(f: MemoryFact): string {
  const when = new Date(f.provenance.updatedAt).toLocaleDateString();
  switch (f.provenance.source) {
    case 'form_approved':
      return `Saved from a form${f.provenance.domain ? ` on ${f.provenance.domain}` : ''} · ${when}`;
    case 'document_approved':
      return `Saved from a document · ${when}`;
    case 'onboarding':
      return `Added during setup · ${when}`;
    default:
      return `Added manually · ${when}`;
  }
}

function FactEditor({ initial, onDone }: { initial?: MemoryFact; onDone: () => void }) {
  const { checkFact, commitFact, factMap, vaultState } = useApp();
  const [choice, setChoice] = useState(initial?.key ?? MEMORY_CATALOG.find((e) => !factMap.has(e.key))?.key ?? '__custom');
  const [customLabel, setCustomLabel] = useState(initial && !catalogEntry(initial.key) ? initial.label : '');
  const [value, setValue] = useState(initial?.value ?? '');
  const [permission, setPermission] = useState<MemoryPermission | ''>(initial?.permission ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const isCustom = choice === '__custom';
  const key = isCustom ? slugifyKey(customLabel) : choice;
  const label = isCustom ? customLabel.trim() : (catalogEntry(choice)?.label ?? choice);

  const save = async (confirmed: boolean) => {
    setError(null);
    if (isCustom && (!customLabel.trim() || !MEMORY_KEY_RE.test(key))) return setError('Give the fact a name');
    if (isCustom && !initial && catalogEntry(key)) return setError('That name matches a built-in fact; pick it from the list instead');
    const check = checkFact({ key, label, value, permission: permission || undefined, source: initial?.provenance.source ?? 'manual' });
    if (!check.ok) return setError(check.error);
    if (check.fact.sensitivity === 'private' && vaultState !== 'unlocked') {
      return setError('This is private information and must be stored in your encrypted vault. Create or unlock the vault in Privacy.');
    }
    if (check.needsExtraConfirm && !confirmed) return setConfirm(true);
    setBusy(true);
    try {
      await commitFact(check.fact);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const entry = catalogEntry(choice);
  return (
    <Card className="border-accent/40">
      <div className="flex flex-col gap-2.5">
        {!initial ? (
          <div>
            <FieldLabel htmlFor="fact-key">Fact</FieldLabel>
            <SelectInput id="fact-key" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {MEMORY_CATALOG.filter((e) => !factMap.has(e.key)).map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                  {e.sensitivity === 'private' ? ' (private)' : ''}
                </option>
              ))}
              <option value="__custom">Custom fact...</option>
            </SelectInput>
          </div>
        ) : (
          <div className="text-[13px] font-medium">{initial.label}</div>
        )}
        {isCustom && !initial ? (
          <div>
            <FieldLabel htmlFor="fact-label" hint="e.g. Hackathon team role">
              Name
            </FieldLabel>
            <TextInput id="fact-label" value={customLabel} maxLength={60} onChange={(e) => setCustomLabel(e.target.value)} />
          </div>
        ) : null}
        <div>
          <FieldLabel htmlFor="fact-value" hint={entry?.list ? 'comma separated' : undefined}>
            Value
          </FieldLabel>
          {choice === 'bio' ? (
            <TextArea id="fact-value" value={value} maxLength={2000} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <TextInput id="fact-value" value={value} maxLength={2000} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
          )}
        </div>
        <div>
          <FieldLabel htmlFor="fact-perm">Permission</FieldLabel>
          <SelectInput id="fact-perm" value={permission} onChange={(e) => setPermission(e.target.value as MemoryPermission | '')}>
            <option value="">Default ({entry ? PERMISSION_LABEL[entry.defaultPermission] : 'based on sensitivity'})</option>
            {(Object.keys(PERMISSION_LABEL) as MemoryPermission[]).map((p) => (
              <option key={p} value={p}>
                {PERMISSION_LABEL[p]}
              </option>
            ))}
          </SelectInput>
        </div>
        {error ? <div className="text-xs text-danger">{error}</div> : null}
        {confirm ? (
          <Notice tone="warn" title="This is sensitive information" action={<div className="flex gap-2"><Button size="sm" variant="primary" loading={busy} onClick={() => save(true)}>Confirm save</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></div>}>
            It will need your approval every time it is used on a form.
          </Notice>
        ) : (
          <div className="flex gap-2">
            <Button variant="primary" icon={Save} loading={busy} onClick={() => save(false)}>
              Save to Memory
            </Button>
            <Button variant="ghost" icon={X} onClick={onDone}>
              Cancel
            </Button>
          </div>
        )}
        <p className="text-[11px] text-muted">Passwords, one-time codes, card numbers and API keys are refused and never stored.</p>
      </div>
    </Card>
  );
}

function FactCard({ f }: { f: MemoryFact }) {
  const { setPermission, deleteFact, setSiteAllowed } = useApp();
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (editing) return <FactEditor initial={f} onDone={() => setEditing(false)} />;
  const masked = f.sensitivity === 'private' && !reveal;
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            {f.label}
            {f.sensitivity === 'private' ? (
              <Badge tone="warn" icon={Lock}>
                Private
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 break-words text-[12.5px] text-ink/85">{masked ? '••••••••' : f.value}</div>
          <div className="mt-1 text-[11px] text-muted">{provenanceText(f)}</div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          {f.sensitivity === 'private' ? (
            <Button size="sm" variant="ghost" aria-label={reveal ? 'Hide value' : 'Show value'} icon={reveal ? EyeOff : Eye} onClick={() => setReveal(!reveal)} />
          ) : null}
          <Button size="sm" variant="ghost" aria-label="Edit" icon={Pencil} onClick={() => setEditing(true)} />
          <Button size="sm" variant="ghost" aria-label="Delete" icon={Trash2} onClick={() => setConfirmDelete(true)} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <SelectInput aria-label={`Permission for ${f.label}`} className="h-7 w-auto text-xs" value={f.permission} onChange={(e) => void setPermission(f.key, e.target.value as MemoryPermission)}>
          {(Object.keys(PERMISSION_LABEL) as MemoryPermission[]).map((p) => (
            <option key={p} value={p}>
              {PERMISSION_LABEL[p]}
            </option>
          ))}
        </SelectInput>
      </div>
      {f.allowedSites.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {f.allowedSites.map((d) => (
            <button key={d} type="button" className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]" onClick={() => void setSiteAllowed(f.key, d, false)}>
              Auto on {d} <X className="size-3" aria-label="remove" />
            </button>
          ))}
        </div>
      ) : null}
      {confirmDelete ? (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span>Delete this fact?</span>
          <Button size="sm" variant="danger" onClick={() => void deleteFact(f.key)}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Keep
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function MemoryTab() {
  const { facts, vaultState } = useApp();
  const [adding, setAdding] = useState(false);
  const groups = new Map<MemoryCategory, MemoryFact[]>();
  for (const f of [...facts].sort((a, b) => a.label.localeCompare(b.label))) {
    groups.set(f.category, [...(groups.get(f.category) ?? []), f]);
  }
  return (
    <div className="flex flex-col gap-3">
      {vaultState === 'locked' ? (
        <Notice tone="accent" icon={Lock} title="Vault locked">
          Private facts are hidden and unusable until you unlock the vault in Privacy.
        </Notice>
      ) : null}
      {adding ? (
        <FactEditor onDone={() => setAdding(false)} />
      ) : (
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
          Add a fact
        </Button>
      )}
      {facts.length === 0 && !adding ? (
        <EmptyState icon={Brain} title="Your memory is empty">
          Add the details you are happy to reuse. Nothing is learned from websites unless you choose Save to memory.
        </EmptyState>
      ) : null}
      {[...groups.entries()].map(([cat, list]) => (
        <section key={cat}>
          <SectionTitle>{CATEGORY_LABEL[cat]}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {list.map((f) => (
              <FactCard key={f.key} f={f} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
