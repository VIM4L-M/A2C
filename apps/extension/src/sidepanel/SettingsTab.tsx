import { RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, FieldLabel, Notice, SectionTitle, StatusRow, TextInput, type Tone } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { isAllowedBackendUrl, type AIModeSetting } from '../lib/settings';
import { ActivityTab } from './ActivityTab';
import { WorkspaceConnection } from './WorkspaceConnection';

const MODES: Array<{ id: AIModeSetting; title: string; text: string }> = [
  { id: 'auto', title: 'Auto (recommended)', text: 'Rules first, the fine-tuned specialist for unclear fields (about 1 s), Gemma 4 as the fallback and for drafts.' },
  { id: 'gemma', title: 'Gemma 4', text: 'Default. Gemma 4 understands field meanings via the A2C backend.' },
  { id: 'specialist', title: 'Fine-tuned specialist (experimental)', text: 'Tinker-trained mapping model, if your backend has one configured. Drafts still use Gemma.' },
  { id: 'mock', title: 'Mock mode', text: 'Deterministic keyword rules for offline demos. Not AI, clearly labelled.' },
];

function probeTone(configured: boolean, reachable: boolean | null): { tone: Tone; value: string } {
  if (!configured) return { tone: 'neutral', value: 'Not set up' };
  if (reachable === true) return { tone: 'ok', value: 'Connected' };
  if (reachable === false) return { tone: 'danger', value: 'Offline' };
  return { tone: 'neutral', value: 'Unchecked' };
}

export function SettingsTab() {
  const { settings, updateSettings, health, refreshHealth } = useApp();
  const [url, setUrl] = useState(settings.backendUrl);
  const [token, setToken] = useState(settings.authToken);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void refreshHealth(true);
    // Run a real check once when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const normalized = url.trim().replace(/\/+$/, '');
    if (!isAllowedBackendUrl(`${normalized}/`)) {
      setError('Use http://127.0.0.1:<port>, http://localhost:<port> or https://<name>.onrender.com');
      return;
    }
    setError(null);
    await updateSettings({ backendUrl: normalized, authToken: token.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-col gap-3">
      <WorkspaceConnection />
      <Card>
        <SectionTitle>AI engine</SectionTitle>
        <div className="flex flex-col gap-2">
          {MODES.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-2 border-2 border-line p-2.5 has-[:checked]:border-ink">
              <input type="radio" name="mode" className="mt-1" checked={settings.aiMode === m.id} onChange={() => void updateSettings({ aiMode: m.id })} />
              <span>
                <span className="font-pixel text-[14px]">{m.title}</span>
                <span className="block text-xs text-muted">{m.text}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>Backend</SectionTitle>
        <div className="flex flex-col gap-2.5">
          <div>
            <FieldLabel htmlFor="backend-url" hint="local server or Render">
              Backend URL
            </FieldLabel>
            <TextInput id="backend-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="backend-token" hint="needed for a deployed backend">
              Access token
            </FieldLabel>
            <TextInput id="backend-token" type="password" autoComplete="off" value={token} placeholder="a2c_..." onChange={(e) => setToken(e.target.value)} />
            <p className="mt-1 text-[11px] text-muted">Stored in chrome.storage.local (not encrypted). Create one with npm run token -- &lt;userId&gt;.</p>
          </div>
          {error ? <div className="text-xs text-danger">{error}</div> : null}
          <div className="flex gap-2">
            <Button variant="primary" icon={Save} onClick={save}>
              {saved ? 'Saved' : 'Save'}
            </Button>
            <Button icon={RefreshCw} loading={health.state === 'checking'} onClick={() => void refreshHealth(true)}>
              Test connection
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle action={settings.aiMode === 'mock' ? <Badge tone="warn">Mock mode on</Badge> : null}>Connection status</SectionTitle>
        {health.state === 'checking' ? (
          <div className="font-pixel text-muted">Checking...</div>
        ) : health.state === 'unreachable' ? (
          <Notice tone="danger" title="Backend not reachable">
            {health.message}
          </Notice>
        ) : health.state === 'unauthorized' ? (
          <Notice tone="danger" title="Access token rejected">
            Paste a valid token above.
          </Notice>
        ) : (
          <div>
            <StatusRow label="Backend" tone="ok" value="Connected" detail={`${settings.backendUrl} · user ${health.data.user}`} />
            <StatusRow label="Authentication" tone={health.data.authRequired ? 'ok' : 'warn'} value={health.data.authRequired ? 'Token' : 'Local mode'} />
            <StatusRow
              label="Gemma 4"
              {...probeTone(health.data.gemma.configured, health.data.gemma.reachable)}
              detail={health.data.gemma.model ?? 'GEMMA_BASE_URL / GEMMA_MODEL not set'}
            />
            <StatusRow label="Backboard memory" {...probeTone(health.data.backboard.configured, health.data.backboard.reachable)} detail={health.data.backboard.configured ? 'Cloud memory available (opt-in in Privacy)' : 'BACKBOARD_API_KEY not set: local memory only'} />
            <StatusRow
              label="Fine-tuned specialist"
              {...probeTone(health.data.specialist.configured, health.data.specialist.reachable)}
              detail={health.data.specialist.model ?? 'Experimental. See training/tinker'}
            />
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Activity</SectionTitle>
        <ActivityTab />
      </Card>
    </div>
  );
}
