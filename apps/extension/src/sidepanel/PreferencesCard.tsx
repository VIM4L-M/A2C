import { useState } from 'react';
import type { MemoryCategory, Proposal } from '@a2c/shared';
import { Button, Card, Checkbox, SectionTitle } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { proposalCategory } from '../lib/preferences';

const categories: MemoryCategory[] = ['identity', 'contact', 'education', 'work', 'links', 'skills', 'other'];

export function PreferencesCard() {
  const { settings, updateSettings } = useApp();
  return <Card><SectionTitle>Autofill preferences</SectionTitle>
    <p className="mb-2 text-xs text-muted">Disable a category to prevent filling it on every site. Contact details request approval unless you remember a site decision.</p>
    <div className="flex flex-col gap-2">{categories.map((category) => <Checkbox key={category} label={category} checked={!settings.disabledCategories.includes(category)} onChange={(on) => void updateSettings({ disabledCategories: on ? settings.disabledCategories.filter((c) => c !== category) : [...settings.disabledCategories, category] })} />)}</div>
    <p className="my-3 text-xs">Always manual: passwords, one-time codes, CAPTCHA, signatures and security credentials. These protections cannot be disabled.</p>
    <SectionTitle>Saved website permissions</SectionTitle>
    {!settings.siteRules.length ? <p className="text-xs text-muted">No saved decisions. Choose them in the form review.</p> : null}
    {settings.siteRules.map((r) => <div key={`${r.origin}:${r.category}`} className="my-2 text-xs break-all">{r.origin} · {r.category} · {r.decision}
      <Button size="sm" onClick={() => void updateSettings({ siteRules: settings.siteRules.filter((x) => x !== r) })}>Revoke</Button>
    </div>)}
  </Card>;
}

export function SiteApproval({ proposals, origin, approve }: { proposals: Proposal[]; origin: string; approve: (ids: string[]) => void }) {
  const { facts, settings, updateSettings } = useApp();
  const [error, setError] = useState('');
  const pending = proposals.filter((p) => p.status === 'review' && !p.approved && p.action === 'use_memory' && !p.field.hasExistingValue && !p.note && p.source !== 'user');
  const groups = [...new Set(pending.map((p) => proposalCategory(p, facts)))];
  const save = async (category: MemoryCategory, decision: 'allow' | 'deny') => {
    try {
      await updateSettings({ siteRules: [...settings.siteRules.filter((r) => r.origin !== origin || r.category !== category), { origin, category, decision, updatedAt: new Date().toISOString() }] });
      setError('');
    } catch { setError('Could not save this permission. Try again.'); }
  };
  if (!groups.length) return null;
  return <Card><SectionTitle>Permissions for this website</SectionTitle><p className="text-xs break-all">{origin}. These choices permit filling only; saving and sharing remain separate.</p>
    {groups.map((category) => <div key={category} className="my-3 text-xs"><strong>{category}</strong><div className="mt-1 flex flex-wrap gap-1">
      <Button size="sm" onClick={() => approve(pending.filter((p) => proposalCategory(p, facts) === category).map((p) => p.fieldId))}>Allow once</Button>
      <Button size="sm" onClick={() => void save(category, 'allow')}>Remember for this site</Button>
      <Button size="sm" onClick={() => void save(category, 'deny')}>Do not allow</Button>
    </div></div>)}{error ? <p role="alert">{error}</p> : null}
  </Card>;
}
