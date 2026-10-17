import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, Card, FieldLabel, Notice, SelectInput, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { PROFILE_TYPES } from '../lib/account';
import { chromeKV } from '../lib/storage';
import { BRIDGE_KEY, CandidatesSchema, PENDING_KEY, WORKSPACE_ORIGIN } from '../lib/workspaceBridge';

type Candidates = ReturnType<typeof CandidatesSchema.parse>;

export function Onboarding() {
  const { checkFact, commitFact, updateSettings } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<Candidates | null>(null);
  const [opened, setOpened] = useState(false);

  // After the website sends the account, it waits here for one confirmation.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      const parsed = CandidatesSchema.safeParse(await chromeKV.get(PENDING_KEY));
      if (live) setAccount(parsed.success ? parsed.data : null);
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const saveFacts = async (drafts: Array<{ key: string; label?: string; value: string }>) => {
    const checks = drafts.map((d) => checkFact({ key: d.key, label: d.label, value: d.value, source: 'onboarding' }));
    const invalid = checks.find((c) => !c.ok);
    if (invalid && !invalid.ok) throw new Error(invalid.error);
    for (const c of checks) if (c.ok) await commitFact(c.fact);
  };

  const connect = async () => {
    setError('');
    // Clicking this button is the consent: the website may offer exactly these three standard facts, nothing else.
    await chromeKV.set(BRIDGE_KEY, { enabled: true, shareActivity: false, keys: ['preferred_name', 'email', 'profile_type'] });
    await chrome.tabs.create({ url: `${WORKSPACE_ORIGIN}/workspace/workspace.html#account?ext=${chrome.runtime.id}` });
    setOpened(true);
  };

  const confirmAccount = async () => {
    if (!account) return;
    setBusy(true);
    setError('');
    try {
      await saveFacts(account);
      await chromeKV.remove(PENDING_KEY);
      await updateSettings({ onboarded: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the account. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const discardAccount = async () => {
    await chromeKV.remove(PENDING_KEY);
    setAccount(null);
  };

  const finishManual = async () => {
    setBusy(true);
    setError('');
    try {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email or leave it blank.');
      await saveFacts(
        [
          { key: 'preferred_name', value: name },
          { key: 'email', value: email },
          { key: 'profile_type', value: profile },
        ].filter((d) => d.value.trim()),
      );
      await updateSettings({ onboarded: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save setup. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const accountName = account?.find((f) => f.key === 'preferred_name')?.value.split(/\s+/)[0];

  return (
    <div className="flex min-h-full flex-col justify-center gap-6 p-5">
      <div>
        <div className="app-brand">A2C_</div>
        <p className="mt-2 text-xs text-muted">A little context. Less repetition.</p>
      </div>
      <Card>
        <div className="mb-3 text-xs text-muted">ONE QUICK STEP · ALL DETAILS OPTIONAL</div>
        <h1 className="font-pixel text-3xl">{accountName ? `Hello, ${accountName}.` : 'Hello.'}</h1>
        {account ? (
          <>
            <p className="my-3 text-xs text-muted">Your website account is ready. Check the details, then confirm. Nothing is saved until you do.</p>
            <ul className="mb-3 divide-y divide-line border border-line">
              {account.map((f) => (
                <li key={f.key} className="flex justify-between gap-3 px-3 py-2 text-xs">
                  <span className="text-muted">{f.label}</span>
                  <span className="break-all text-right">{f.value}</span>
                </li>
              ))}
            </ul>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <div className="flex flex-col gap-2">
              <Button variant="primary" loading={busy} onClick={() => void confirmAccount()}>
                Confirm and continue
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void discardAccount()}>
                Not these details
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="my-3 text-xs text-muted">Create your account on the A2C website, then connect it here. The extension keeps working the same way if you skip this.</p>
            <div className="flex flex-col gap-2">
              <Button variant="primary" icon={ExternalLink} onClick={() => void connect()}>
                Create or connect website account
              </Button>
              {opened ? <Notice tone="neutral">The workspace opened in a new tab. Create your account there and this panel updates by itself.</Notice> : null}
              <Button variant="ghost" disabled={busy} onClick={() => void updateSettings({ onboarded: true })}>
                Skip for now
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted">Opening the workspace lets that one local page offer your name, email and profile type. You confirm them here before they are saved.</p>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted">Enter details here instead</summary>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void finishManual();
                }}
              >
                <div>
                  <FieldLabel htmlFor="ob-name">Preferred name (optional)</FieldLabel>
                  <TextInput id="ob-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <FieldLabel htmlFor="ob-email">Email (optional)</FieldLabel>
                  <TextInput id="ob-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <FieldLabel htmlFor="ob-profile">Profile type (optional)</FieldLabel>
                  <SelectInput id="ob-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
                    <option value="">Choose later</option>
                    {PROFILE_TYPES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </SelectInput>
                </div>
                {error ? <Notice tone="danger">{error}</Notice> : null}
                <Button type="submit" loading={busy}>
                  Start using A2C
                </Button>
              </form>
            </details>
          </>
        )}
      </Card>
    </div>
  );
}
