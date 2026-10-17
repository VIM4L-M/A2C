import { Cloud, KeyRound, Lock, Shield, Trash2, Unlock } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Notice, SectionTitle, TextInput } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { checkPassphrase } from '../memory/vault';
import { PreferencesCard } from './PreferencesCard';

function CategoriesCard() {
  const rows: Array<[string, 'ok' | 'warn' | 'danger' | 'neutral', string]> = [
    ['Green', 'ok', 'Approved general info (name, education, public links, skills). Pre-ticked when the fact is an "Automatic candidate".'],
    ['Amber', 'warn', 'Contact and private details request approval unless you remember an eligible site decision. Drafts, edits and overwrites still need review.'],
    ['Red', 'danger', 'Passwords, OTPs, CVV, card and bank numbers, tokens, private keys, recovery codes. Never read, stored, sent or filled.'],
    ['Gray', 'neutral', 'Unknown, CAPTCHA, signatures, legal declarations, instruction-like labels, unsupported controls. You fill these.'],
  ];
  return (
    <Card>
      <SectionTitle>Autofill policies</SectionTitle>
      <ul className="flex flex-col gap-2">
        {rows.map(([name, tone, text]) => (
          <li key={name} className="flex gap-2 text-xs">
            <Badge tone={tone} className="w-16 justify-center">
              {name}
            </Badge>
            <span className="text-ink/85">{text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CloudCard() {
  const { settings, updateSettings, cloud, health } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const backboardReady = health.state === 'ok' && health.data.backboard.configured;

  const deleteAll = async () => {
    if (!cloud) return;
    setBusy(true);
    setMsg(null);
    try {
      const all = await cloud.list();
      for (const m of all) await cloud.remove(m.id);
      setMsg(`Deleted ${all.length} cloud memor${all.length === 1 ? 'y' : 'ies'}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not delete cloud memories');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Card>
      <SectionTitle action={<Badge tone={settings.cloudMemory ? 'accent' : 'neutral'}>{settings.cloudMemory ? 'On' : 'Off'}</Badge>}>Cloud memory (Backboard)</SectionTitle>
      <p className="text-xs text-ink/85">
        Off by default. When on, you can choose individual non-sensitive facts (education, skills, public links) to save to your own Backboard memory, so they follow you
        across devices. Private facts, contact details, credentials and documents never go to the cloud. Local memory keeps working if the cloud is down.
      </p>
      <div className="mt-2.5">
        <Checkbox checked={settings.cloudMemory} label="I agree to use cloud memory for facts I explicitly save" onChange={(v) => void updateSettings({ cloudMemory: v })} />
      </div>
      {settings.cloudMemory && !backboardReady ? (
        <div className="mt-2 text-xs text-warn">The backend does not report Backboard as configured (Settings → Test connection).</div>
      ) : null}
      {settings.cloudMemory ? (
        confirm ? (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span>Delete every cloud memory?</span>
            <Button size="sm" variant="danger" loading={busy} onClick={deleteAll}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button className="mt-3" variant="danger" icon={Cloud} onClick={() => setConfirm(true)}>
            Delete all cloud memories
          </Button>
        )
      ) : null}
      {msg ? <div className="mt-2 text-xs">{msg}</div> : null}
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
      <p className="text-xs text-ink/85">
        Private facts (phone, city, birth date, grades) are encrypted with AES-GCM, using a key derived from your passphrase (PBKDF2-SHA-256, 600,000 iterations, random salt).
        The passphrase is never stored. Forget it and the vault cannot be recovered.
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
      <p className="mt-2 text-[11px] text-muted">The vault locks when the side panel closes. Decrypted facts exist only in the side panel's memory while unlocked.</p>
    </Card>
  );
}

function DataCard() {
  const { clearMemory, clearActivity } = useApp();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card>
      <SectionTitle>Clear local data</SectionTitle>
      {confirm ? (
        <Notice
          tone="danger"
          title="Delete all local memory, including the vault?"
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
          This cannot be undone. Cloud memories are deleted separately above.
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>
            Clear local memory
          </Button>
          <Button icon={Trash2} onClick={() => void clearActivity()}>
            Clear activity
          </Button>
        </div>
      )}
    </Card>
  );
}

function StorageCard() {
  return (
    <Card>
      <SectionTitle>Storage security</SectionTitle>
      <ul className="list-disc space-y-1 pl-4 text-xs text-ink/85">
        <li>Standard facts and settings (including the backend token) are in chrome.storage.local, which is NOT encrypted.</li>
        <li>Private facts are only stored inside the encrypted vault. While unlocked, malware with access to your browser could read them.</li>
        <li>Field labels, option labels and memory key names go to the backend for Gemma. Values do not, except facts you tick for a draft.</li>
        <li>Cloud memory holds only facts you explicitly save, in a Backboard assistant used only for your account.</li>
        <li>Classification is rule-based and conservative but not perfect. Always review before submitting. A2C never submits.</li>
        <li>Iframes and closed shadow roots are not scanned.</li>
      </ul>
    </Card>
  );
}

export function PrivacyTab({ showCloud = true }: { showCloud?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="accent" icon={Shield} title="What leaves your browser">
        Only field labels, types, option labels and memory key names, sent to your A2C backend for Gemma. Your values are resolved on this device.
      </Notice>
      <CategoriesCard />
      <PreferencesCard />
      {showCloud ? <CloudCard /> : null}
      <VaultCard />
      <StorageCard />
      <DataCard />
    </div>
  );
}
