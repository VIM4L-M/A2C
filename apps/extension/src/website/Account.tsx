import { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { ACCOUNT_STORAGE_KEY, AccountSchema, EXTENSION_ID_PATTERN, PROFILE_TYPES, accountFacts, firstName, parseExtensionId, type Account } from '../lib/account';
import { Button, Card, FieldLabel, Notice, SectionTitle, SelectInput, TextInput } from '../components/ui';

export function loadAccount(): Account | null {
  try {
    const parsed = AccountSchema.safeParse(JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Remember the extension id from the address (`#account?ext=...`) so nobody has to paste it. */
function rememberExtensionId(): string {
  const fromAddress = parseExtensionId(location.hash);
  if (fromAddress) localStorage.setItem('a2c_extension_id', fromAddress);
  const stored = localStorage.getItem('a2c_extension_id') ?? '';
  return EXTENSION_ID_PATTERN.test(stored) ? stored : '';
}

export function AccountPage({ onChange }: { onChange: () => void }) {
  const { checkFact, commitFact } = useApp();
  const [account, setAccount] = useState<Account | null>(loadAccount);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState('');
  const [extensionId, setExtensionId] = useState(rememberExtensionId);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(a: Account, id: string) {
    if (!EXTENSION_ID_PATTERN.test(id)) throw new Error('Open this page from the extension (its Connect button) or paste the extension ID from its Settings.');
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('Open this workspace in the same Chrome profile as the installed A2C extension, then reload.');
    localStorage.setItem('a2c_extension_id', id);
    const result = (await chrome.runtime.sendMessage(id, { type: 'propose', facts: accountFacts(a) })) as { ok?: boolean; error?: string };
    if (!result?.ok) throw new Error(result?.error ?? 'The extension did not accept the account.');
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const parsed = AccountSchema.safeParse({ name, email, profile });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
    setBusy(true);
    try {
      // The website keeps its own copy as ordinary facts, so the Profile page shows them too.
      for (const f of accountFacts(parsed.data)) {
        const check = checkFact({ key: f.key, label: f.label, value: f.value, source: 'onboarding' });
        if (check.ok) await commitFact(check.fact);
      }
      localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(parsed.data));
      setAccount(parsed.data);
      onChange();
      if (extensionId) {
        try {
          await send(parsed.data, extensionId);
          setStatus({ tone: 'ok', text: 'Sent to your extension. Open the A2C panel and confirm it there.' });
        } catch (err) {
          setStatus({ tone: 'warn', text: err instanceof Error ? err.message : 'Could not reach the extension.' });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!account) return;
    setBusy(true);
    setStatus(null);
    try {
      await send(account, extensionId);
      setStatus({ tone: 'ok', text: 'Sent to your extension. Open the A2C panel and confirm it there.' });
    } catch (err) {
      setStatus({ tone: 'warn', text: err instanceof Error ? err.message : 'Could not reach the extension.' });
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    setAccount(null);
    setStatus(null);
    onChange();
  }

  if (!account) {
    return (
      <Card>
        <SectionTitle>Create your account</SectionTitle>
        <p className="mb-5 text-muted">Your account lives in this browser. There is no password and nothing is sent to a server. After you create it, the A2C extension can connect and ask you to confirm these details.</p>
        <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => void create(e)}>
          <div>
            <FieldLabel htmlFor="acct-name">Your name</FieldLabel>
            <TextInput id="acct-name" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="acct-email">Email</FieldLabel>
            <TextInput id="acct-email" type="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="acct-profile">Profile type (optional)</FieldLabel>
            <SelectInput id="acct-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">Choose later</option>
              {PROFILE_TYPES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </SelectInput>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" variant="primary" loading={busy}>
            Create account
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <SectionTitle>Signed in</SectionTitle>
        <p className="font-pixel text-3xl">Hello, {firstName(account.name)}.</p>
        <p className="mt-2 text-muted">
          {account.email}
          {account.profile ? ` · ${account.profile}` : ''}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={signOut}>Remove account from this browser</Button>
        </div>
      </Card>
      <Card>
        <SectionTitle>Connect your Chrome extension</SectionTitle>
        <p className="mb-4 text-muted">Your name, email and profile type are sent to the extension as suggestions. You confirm them in the extension before anything is saved. Passwords, private facts and website permissions never cross this connection.</p>
        <FieldLabel htmlFor="acct-ext">Extension ID</FieldLabel>
        <TextInput id="acct-ext" value={extensionId} maxLength={32} onChange={(e) => setExtensionId(e.target.value.trim())} />
        <p className="mt-2 text-sm text-muted">Filled automatically when you arrive from the extension's Connect button.</p>
        <div className="mt-4">
          <Button variant="primary" loading={busy} onClick={() => void connect()}>
            Send my account to the extension
          </Button>
        </div>
        {status ? (
          <div className="mt-4">
            <Notice tone={status.tone}>{status.text}</Notice>
          </div>
        ) : null}
      </Card>
    </>
  );
}
