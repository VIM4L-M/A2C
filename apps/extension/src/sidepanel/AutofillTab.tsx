import { summarize, type ScanResult } from '@a2c/shared';
import { Globe, KeyRound, RefreshCw, ScanLine, ShieldCheck, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProposalList } from '../components/ProposalList';
import { Button, Card, EmptyState, Notice, Stat } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { toFillInstructions, useProposals } from '../hooks/useProposals';
import { fillTab, getActiveTab, parseTabUrl, requestSitePermission, scanTab, TabError, type ActiveTab } from '../services/tabs';

type Phase = 'idle' | 'scanning' | 'mapping' | 'review' | 'filling';

export function AutofillTab() {
  const app = useApp();
  const { proposals, info, run, update, refreshForKey, reset, setProposals } = useProposals();
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const [scanTabInfo, setScanTabInfo] = useState<ActiveTab | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fillSummary, setFillSummary] = useState<{ filled: number; skipped: number; failed: number } | null>(null);

  // Track the active tab so the domain is visible and a stale scan is detected.
  useEffect(() => {
    const refresh = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const parsed = parseTabUrl(tab?.url);
        setCurrentDomain(parsed?.domain ?? null);
        if (scanTabInfo && (tab?.id !== scanTabInfo.id || parsed?.origin !== scanTabInfo.origin || tab?.url !== scanTabInfo.url)) setStale(true);
      } catch {
        setCurrentDomain(null);
      }
    };
    void refresh();
    const onActivated = () => void refresh();
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.url || change.status === 'complete') void refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [scanTabInfo]);

  const doScan = useCallback(async () => {
    setError(null);
    setFillSummary(null);
    setNeedsPermission(null);
    setStale(false);
    setPhase('scanning');
    reset();
    try {
      const tab = await getActiveTab();
      const result = await scanTab(tab.id);
      setScanTabInfo(tab);
      setScan(result);
      setPhase('mapping');
      const ps = await run(result, app.facts, app.lockedKeys, app.provider, tab.domain);
      await app.record({ type: 'scan', blocked: ps.filter((p) => p.status === 'blocked').length });
      setPhase('review');
    } catch (e) {
      if (e instanceof TabError && e.code === 'needs_permission') {
        try {
          setNeedsPermission((await getActiveTab()).origin);
        } catch {
          setError(e.message);
        }
      } else setError(e instanceof Error ? e.message : 'Scan failed');
      setPhase('idle');
    }
  }, [app, reset, run]);

  const grant = async () => {
    if (!needsPermission) return;
    // Called directly from the click handler (user gesture). Grants this one site.
    const ok = await requestSitePermission(needsPermission);
    if (ok) await doScan();
    else setError('Permission was not granted. A2C cannot read this page.');
  };

  const doFill = async () => {
    if (!scan || !scanTabInfo) return;
    setError(null);
    const fills = toFillInstructions(proposals);
    if (fills.length === 0) {
      setError('No approved fields with values to fill.');
      return;
    }
    setPhase('filling');
    try {
      const tab = await getActiveTab();
      if (tab.id !== scanTabInfo.id || tab.origin !== scan.origin) {
        setStale(true);
        throw new Error('The page or tab changed since the scan. Rescan before filling.');
      }
      const res = await fillTab(tab.id, scan.scanId, scan.origin, fills);
      if (!res.ok) throw new Error(res.error ?? 'The page script refused the request');
      const byId = new Map(res.results.map((r) => [r.fieldId, r]));
      setProposals((ps) =>
        ps.map((p) => {
          const r = byId.get(p.fieldId);
          if (!r) return p;
          if (r.status === 'filled') return { ...p, status: 'completed', note: 'Filled on the page' };
          if (r.status === 'skipped') return { ...p, status: 'skipped', note: r.reason };
          return { ...p, status: 'failed', note: r.reason };
        }),
      );
      const counts = {
        filled: res.results.filter((r) => r.status === 'filled').length,
        skipped: res.results.filter((r) => r.status === 'skipped').length,
        failed: res.results.filter((r) => r.status === 'failed').length,
      };
      setFillSummary(counts);
      await app.record({ type: 'fill', ...counts });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fill failed');
    } finally {
      setPhase('review');
    }
  };

  const stats = summarize(proposals);
  const fillCount = toFillInstructions(proposals).length;
  const busy = phase === 'scanning' || phase === 'mapping' || phase === 'filling';

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-muted">Current site</div>
            <div className="flex items-center gap-1.5 truncate font-medium">
              <Globe className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{currentDomain ?? 'No scannable page'}</span>
            </div>
          </div>
          <Button variant="primary" icon={ScanLine} loading={phase === 'scanning' || phase === 'mapping'} disabled={busy} onClick={doScan}>
            {phase === 'mapping' ? (app.provider.kind === 'gemma' ? 'Asking Gemma...' : 'Matching...') : 'Scan Form'}
          </Button>
        </div>
        {scan ? (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <Stat label="Detected" value={stats.detected} />
            <Stat label="Ready" value={stats.ready} tone="ok" />
            <Stat label="Approval" value={stats.review + stats.missing} tone="warn" />
            <Stat label="Blocked" value={stats.blocked} tone="danger" />
          </div>
        ) : null}
      </Card>

      {needsPermission ? (
        <Notice
          tone="accent"
          icon={KeyRound}
          title="Allow A2C on this site?"
          action={
            <Button size="sm" variant="primary" onClick={grant}>
              Allow on {new URL(needsPermission).host}
            </Button>
          }
        >
          Access is limited to this site, used only when you click Scan or Fill. You can revoke it in Chrome's extension settings.
        </Notice>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {stale && scan ? (
        <Notice tone="warn" title="Page changed since the scan" action={<Button size="sm" icon={RefreshCw} onClick={doScan}>Rescan</Button>}>
          Values will not be filled into a different page.
        </Notice>
      ) : null}

      {info ? (
        info.source === 'gemma' ? (
          <Notice tone="ok" icon={Wand2} title="Mapped by Gemma 4">
            {info.aiFieldCount} field descriptions and memory key names were sent to your local proxy. No memory values were sent.
          </Notice>
        ) : info.source === 'mock' ? (
          <Notice tone="warn" title="MOCK MODE">
            Deterministic keyword matching, not AI. Switch to Gemma 4 in Privacy.
          </Notice>
        ) : (
          <Notice tone="warn" title="Gemma unavailable: rule-based fallback">
            {info.error} Showing deterministic matches (not AI).
          </Notice>
        )
      ) : null}
      {info && info.issues.length > 0 ? (
        <details className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            <ShieldCheck className="mr-1 inline size-3.5 text-accent" aria-hidden />
            {info.issues.length} AI suggestion{info.issues.length === 1 ? '' : 's'} rejected by policy
          </summary>
          <ul className="mt-1.5 list-disc pl-4 text-muted">
            {info.issues.map((i, n) => (
              <li key={n}>{i}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {fillSummary ? (
        <Notice tone={fillSummary.failed ? 'warn' : 'ok'} title={`Filled ${fillSummary.filled} field${fillSummary.filled === 1 ? '' : 's'}`}>
          {fillSummary.skipped} skipped, {fillSummary.failed} failed. Review the page and submit it yourself. A2C never submits forms.
        </Notice>
      ) : null}

      {scan && proposals.length === 0 && phase === 'review' ? (
        <EmptyState icon={ScanLine} title="No fillable fields found">
          {scan.stats.ignoredHiddenOrDisabled} hidden/disabled and {scan.stats.unsupported} unsupported fields were ignored. Fields inside iframes are not scanned.
        </EmptyState>
      ) : null}
      {!scan && phase === 'idle' && !error && !needsPermission ? (
        <EmptyState icon={ScanLine} title="Open a form and click Scan Form">
          Fields are classified on your device first. Passwords, codes and card data are blocked before anything reaches the AI.
        </EmptyState>
      ) : null}

      {proposals.length > 0 ? (
        <ProposalList proposals={proposals} update={update} refreshForKey={refreshForKey} domain={scanTabInfo?.domain ?? ''} provenance="form_approved" />
      ) : null}

      {proposals.length > 0 ? (
        <div className="sticky bottom-0 -mx-3 flex gap-2 border-t border-line bg-bg/95 px-3 py-2.5 backdrop-blur">
          <Button className="flex-1" variant="primary" icon={Wand2} loading={phase === 'filling'} disabled={busy || fillCount === 0 || stale} onClick={doFill}>
            Fill {fillCount} approved field{fillCount === 1 ? '' : 's'}
          </Button>
          <Button icon={RefreshCw} disabled={busy} onClick={doScan}>
            Rescan
          </Button>
        </div>
      ) : null}
    </div>
  );
}
