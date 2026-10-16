import { Cpu, KeyRound, Lock, RefreshCw, Shield, Trash2, Unlock } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, FieldLabel, Notice, SectionTitle, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { isLocalProxyUrl } from '../lib/settings';
import { checkPassphrase } from '../memory/vault';

function EngineCard() {
  const { settings, updateSettings, health, refreshHealth } = useApp();
  const [url, setUrl] = useState(settings.proxyUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  return (
    <Card>
      <SectionTitle action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void refreshHealth(true)}>Test</Button>}>AI engine</SectionTitle>
      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5">
          <input type="radio" name="mode" className="mt-0.5 accent-[var(--cf-accent)]" checked={settings.aiMode === 'gemma'} onChange={() => void updateSettings({ aiMode: 'gemma' })} />
          <span>
            <span className="font-medium">Gemma 4 via local proxy</span>
            <span className="block text-xs text-muted">Real model inference through the A2C proxy on this computer.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5">
          <input type="radio" name="mode" className="mt-0.5 accent-[var(--cf-accent)]" checked={settings.aiMode === 'mock'} onChange={() => void updateSettings({ aiMode: 'mock' })} />
          <span>
            <span className="font-medium">Mock mode</span>
            <span className="block text-xs text-muted">Deterministic keyword rules for offline demos. Not AI, clearly labelled.</span>
          </span>
        </label>
        <div>
          <FieldLabel htmlFor="proxy-url">Proxy URL</FieldLabel>
          <div className="flex gap-2">
            <TextInput id="proxy-url" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button
              onClick={async () => {
                const normalized = url.trim().replace(/\/+$/, '') + '/';
                if (!isLocalProxyUrl(normalized)) return setUrlError('Must be http://127.0.0.1:<port> or http://localhost:<port>');
                setUrlError(null);
                await updateSettings({ proxyUrl: normalized.replace(/\/$/, '') });
              }}
            >
              Save
            </Button>
          </div>
          {urlError ? <div className="mt-1 text-xs text-danger">{urlError}</div> : null}
        </div>
        <div className="rounded-lg bg-surface-2 p-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <Cpu className="size-3.5" aria-hidden /> Status
          </div>
          <div className="mt-1">
            {settings.aiMode === 'mock' ? (
              <Badge tone="warn">MOCK MODE: no AI in use</Badge>
            ) : health.status === 'checking' ? (
              'Checking...'
            ) : health.status === 'ok' ? (
              <>
                <Badge tone="ok">Real Gemma configured</Badge>
                <div className="mt-1 break-all text-muted">Model: {health.model}</div>
                {health.upstreamReachable === false ? <div className="mt-1 text-danger">Proxy is up, but the Gemma server did not answer.</div> : null}
              </>
            ) : health.status === 'not_configured' ? (
              <Badge tone="warn">Proxy running, Gemma not configured (set GEMMA_BASE_URL and GEMMA_MODEL)</Badge>
            ) : (
              <Badge tone="danger">Proxy not reachable: run npm run start:server</Badge>
            )}
          </div>
          <div className="mt-1.5 text-muted">Endpoint: {settings.proxyUrl}</div>
        </div>
      </div>
    </Card>
  );
}

function VaultCard() {
  const { vaultState, createVault, unlockVault, lockVault } = useApp();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPass('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle
        action={
          vaultState === 'unlocked' ? (
            <Badge tone="ok" icon={Unlock}>
              Unlocked
            </Badge>
          ) : vaultState === 'locked' ? (
            <Badge tone="neutral" icon={Lock}>
              Locked
            </Badge>
          ) : (
            <Badge>Not set up</Badge>
          )
        }
      >
        Private vault
      </SectionTitle>
      <p className="text-xs text-muted">
        Private facts (phone, city, date of birth, grades...) are encrypted with AES-GCM using a key derived from your passphrase (PBKDF2-SHA-256, 600,000 iterations,
        random salt). The passphrase is never stored. If you forget it, the vault cannot be recovered.
      </p>
      {vaultState === 'unlocked' ? (
        <Button className="mt-3" icon={Lock} onClick={lockVault}>
          Lock vault
        </Button>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (vaultState === 'none') {
              const weak = checkPassphrase(pass);
              if (weak) return setError(weak);
              if (pass !== confirm) return setError('Passphrases do not match');
              void act(() => createVault(pass));
            } else void act(() => unlockVault(pass));
          }}
        >
          <TextInput type="password" autoComplete={vaultState === 'none' ? 'new-password' : 'current-password'} placeholder="Vault passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
          {vaultState === 'none' ? <TextInput type="password" autoComplete="new-password" placeholder="Confirm passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} /> : null}
          {error ? <div className="text-xs text-danger">{error}</div> : null}
          <Button type="submit" variant="primary" icon={KeyRound} loading={busy}>
            {vaultState === 'none' ? 'Create vault' : 'Unlock'}
          </Button>
        </form>
      )}
      <p className="mt-2 text-[11px] text-muted">The vault locks automatically when the side panel closes. Decrypted facts only exist in the side panel's memory while unlocked.</p>
    </Card>
  );
}

function CategoriesCard() {
  const rows: Array<[string, 'ok' | 'warn' | 'danger' | 'neutral', string]> = [
    ['Green', 'ok', 'General approved info (name, education, public links, skills). Pre-approved if the fact is set to "Use automatically".'],
    ['Amber', 'warn', 'Phone, email, address, birth date, grades, salary, IDs, demographic or medical data, essays. Always needs your tick.'],
    ['Red', 'danger', 'Passwords, OTPs, CVV, card and bank numbers, API keys, recovery codes. Never read, stored, sent or filled.'],
    ['Gray', 'neutral', 'Unknown, CAPTCHA, signatures, legal consent, instruction-like labels, unsupported inputs. Manual only.'],
  ];
  return (
    <Card>
      <SectionTitle>Field categories</SectionTitle>
      <ul className="flex flex-col gap-2">
        {rows.map(([name, tone, text]) => (
          <li key={name} className="flex gap-2 text-xs">
            <Badge tone={tone} className="w-14 justify-center">
              {name}
            </Badge>
            <span className="text-ink/80">{text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DataCard() {
  const { clearMemory, clearActivity } = useApp();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card>
      <SectionTitle>Your data</SectionTitle>
      {confirm ? (
        <Notice
          tone="danger"
          title="Delete all memory, including the vault?"
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={() => void clearMemory().then(() => setConfirm(false))}>
                Delete everything
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          }
        >
          This cannot be undone.
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>
            Clear all memory
          </Button>
          <Button icon={Trash2} onClick={() => void clearActivity()}>
            Clear activity
          </Button>
        </div>
      )}
    </Card>
  );
}

function LimitsCard() {
  return (
    <Card>
      <SectionTitle>Honest limitations</SectionTitle>
      <ul className="list-disc space-y-1 pl-4 text-xs text-ink/80">
        <li>Standard (non-private) facts are stored in chrome.storage.local, which is not encrypted. Anyone with access to your browser profile can read them.</li>
        <li>The vault protects data at rest only. While unlocked, malware or a compromised browser could read it.</li>
        <li>Field labels, option labels and memory key names are sent to the Gemma proxy. Memory values are not, except facts you tick for a draft.</li>
        <li>The local proxy is unauthenticated. It only accepts the extension's origin, but other programs on this computer can still call it.</li>
        <li>Classification is rule-based and conservative but not perfect. Always review before submitting.</li>
        <li>Forms inside iframes and closed shadow roots are not scanned.</li>
      </ul>
    </Card>
  );
}

export function PrivacyTab() {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="accent" icon={Shield} title="What goes to the AI">
        Only field labels, types, option labels and the names of your memory keys. Values are resolved on your device. A2C never submits forms.
      </Notice>
      <EngineCard />
      <VaultCard />
      <CategoriesCard />
      <DataCard />
      <LimitsCard />
    </div>
  );
}
