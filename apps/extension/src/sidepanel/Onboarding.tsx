import { useState } from 'react';
import { Button, Card, FieldLabel, Notice, SelectInput, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';

export function Onboarding() {
  const { checkFact, commitFact, updateSettings } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true); setError('');
    try {
      const drafts = [['preferred_name', name], ['email', email], ['profile_type', profile]]
        .filter(([, value]) => value?.trim()).map(([key, value]) => checkFact({ key: key!, value: value!, source: 'onboarding' }));
      const invalid = drafts.find((c) => !c.ok);
      if (invalid && !invalid.ok) throw new Error(invalid.error);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email or leave it blank.');
      for (const c of drafts) if (c.ok) await commitFact(c.fact);
      await updateSettings({ onboarded: true });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save setup. Try again.'); }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-full flex-col gap-3 p-3"><Card>
    <h1 className="font-pixel text-lg">Welcome to A2C</h1>
    <p className="my-3 text-xs text-muted">Start with a few details, or skip them. Add education, documents and privacy preferences later in Memory and Privacy.</p>
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void finish(); }}>
      <div><FieldLabel htmlFor="ob-name">Preferred name (optional)</FieldLabel><TextInput id="ob-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
      <div><FieldLabel htmlFor="ob-email">Email (optional)</FieldLabel><TextInput id="ob-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><FieldLabel htmlFor="ob-profile">Profile type (optional)</FieldLabel><SelectInput id="ob-profile" value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">Choose later</option><option>Student</option><option>Job seeker</option><option>Professional</option></SelectInput></div>
      <p className="text-xs text-muted">Saving these details lets A2C suggest them. You review each fill and submit forms yourself. Email requires approval.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button type="submit" variant="primary" loading={busy}>Start using A2C</Button>
    </form>
  </Card></div>;
}
