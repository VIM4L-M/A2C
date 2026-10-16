import { MEMORY_CATALOG, type MemoryFact, type MemoryPermission } from '@a2c/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearActivity as clearActivityStore, EMPTY_ACTIVITY, loadActivity, recordActivity, type Activity, type ActivityEvent } from '../lib/activity';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../lib/settings';
import { defaultKV, type KV } from '../lib/storage';
import { prepareFact, type FactCheck, type FactDraft } from '../memory/facts';
import { MemoryStore } from '../memory/store';
import { checkHealth, GemmaProvider, MockProvider, type AIProvider, type ProxyHealth } from '../services/ai';

export type HealthState = ProxyHealth | { status: 'checking' };

interface AppContextValue {
  ready: boolean;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  facts: MemoryFact[];
  factMap: Map<string, MemoryFact>;
  vaultState: 'none' | 'locked' | 'unlocked';
  lockedKeys: Set<string>;
  checkFact: (draft: FactDraft) => FactCheck;
  commitFact: (fact: MemoryFact) => Promise<void>;
  deleteFact: (key: string) => Promise<void>;
  setPermission: (key: string, permission: MemoryPermission) => Promise<void>;
  setSiteAllowed: (key: string, domain: string, allowed: boolean) => Promise<void>;
  createVault: (passphrase: string) => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  lockVault: () => void;
  clearMemory: () => Promise<void>;
  health: HealthState;
  refreshHealth: (probe?: boolean) => Promise<void>;
  provider: AIProvider;
  activity: Activity;
  record: (event: Omit<ActivityEvent, 'at'>) => Promise<void>;
  clearActivity: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children, kv = defaultKV() }: { children: ReactNode; kv?: KV }) {
  const storeRef = useRef(new MemoryStore(kv));
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [vaultState, setVaultState] = useState<'none' | 'locked' | 'unlocked'>('none');
  const [health, setHealth] = useState<HealthState>({ status: 'checking' });
  const [activity, setActivity] = useState<Activity>(EMPTY_ACTIVITY);

  const sync = useCallback(() => {
    setFacts(storeRef.current.facts());
    setVaultState(storeRef.current.vaultState);
  }, []);

  useEffect(() => {
    void (async () => {
      await storeRef.current.load();
      setSettings(await loadSettings(kv));
      setActivity(await loadActivity(kv));
      sync();
      setReady(true);
    })();
  }, [kv, sync]);

  const refreshHealth = useCallback(
    async (probe = false) => {
      setHealth({ status: 'checking' });
      setHealth(await checkHealth(settings.proxyUrl, probe));
    },
    [settings.proxyUrl],
  );

  useEffect(() => {
    if (ready) void refreshHealth();
  }, [ready, refreshHealth]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      await saveSettings(kv, next);
      setSettings(next);
    },
    [kv, settings],
  );

  const factMap = useMemo(() => new Map(facts.map((f) => [f.key, f])), [facts]);

  const lockedKeys = useMemo(
    () => (vaultState === 'locked' ? new Set(MEMORY_CATALOG.filter((e) => e.sensitivity === 'private').map((e) => e.key)) : new Set<string>()),
    [vaultState],
  );

  const checkFact = useCallback((draft: FactDraft) => prepareFact(draft, factMap.get(draft.key.trim())), [factMap]);

  const record = useCallback(
    async (event: Omit<ActivityEvent, 'at'>) => {
      setActivity(await recordActivity(kv, event));
    },
    [kv],
  );

  const commitFact = useCallback(
    async (fact: MemoryFact) => {
      await storeRef.current.upsert(fact);
      sync();
      await record({ type: 'memory_saved' });
    },
    [sync, record],
  );

  const patchFact = useCallback(
    async (key: string, patch: (f: MemoryFact) => MemoryFact) => {
      const f = storeRef.current.facts().find((x) => x.key === key);
      if (!f) return;
      await storeRef.current.upsert(patch(f));
      sync();
    },
    [sync],
  );

  const value: AppContextValue = {
    ready,
    settings,
    updateSettings,
    facts,
    factMap,
    vaultState,
    lockedKeys,
    checkFact,
    commitFact,
    deleteFact: async (key) => {
      await storeRef.current.remove(key);
      sync();
    },
    setPermission: (key, permission) => patchFact(key, (f) => ({ ...f, permission, provenance: { ...f.provenance, updatedAt: new Date().toISOString() } })),
    setSiteAllowed: (key, domain, allowed) =>
      patchFact(key, (f) => ({
        ...f,
        allowedSites: allowed ? [...new Set([...f.allowedSites, domain])] : f.allowedSites.filter((d) => d !== domain),
      })),
    createVault: async (p) => {
      await storeRef.current.createVault(p);
      sync();
    },
    unlockVault: async (p) => {
      await storeRef.current.unlock(p);
      sync();
    },
    lockVault: () => {
      storeRef.current.lock();
      sync();
    },
    clearMemory: async () => {
      await storeRef.current.clearAll();
      sync();
    },
    health,
    refreshHealth,
    provider: useMemo(() => (settings.aiMode === 'mock' ? new MockProvider() : new GemmaProvider(settings.proxyUrl)), [settings.aiMode, settings.proxyUrl]),
    activity,
    record,
    clearActivity: async () => {
      await clearActivityStore(kv);
      setActivity(EMPTY_ACTIVITY);
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
