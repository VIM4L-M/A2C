import { summarize, type ScanResult } from '@a2c/shared';
import { Eye, Gauge, Globe, KeyRound, RefreshCw, ScanLine, ShieldCheck, Undo2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProposalList } from '../components/ProposalList';
import { Button, Card, EmptyState, Notice, SectionTitle, Stat } from '../components/ui';
import { useApp } from '../hooks/useApp';
import { toFillInstructions, useProposals } from '../hooks/useProposals';
import { fillTab, getActiveTab, locateOnPage, parseTabUrl, requestSitePermission, requestWebPermission, scanTab, TabError, undoFill, type ActiveTab } from '../services/tabs';

type Phase = 'idle' | 'scanning' | 'mapping' | 'review' | 'filling';

const UNKNOWN_SITE = 'unknown-site';
const HIDDEN_SITE = 'This tab (address shown after scan)';

export function AutofillTab() {
  const app = useApp();
  const { proposals, info, run, update, refreshForKey, reset, setProposals, skipAI } = useProposals();
  const [elapsed, setElapsed] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [undoMsg, setUndoMsg] = useState<string | null>(null);
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
        setCurrentDomain(parsed?.domain ?? (tab && !tab.url ? HIDDEN_SITE : null));
        // Chrome hides addresses of sites A2C cannot access; then only the tab id can be compared.
        const moved = tab?.id !== scanTabInfo?.id || (tab?.url && scanTabInfo?.url && tab.url !== scanTabInfo.url);
        if (scanTabInfo && moved) setStale(true);
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

  // Elapsed timer while the model works (local CPU inference can take a minute).
  useEffect(() => {
    if (phase !== 'mapping') return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const doScan = useCallback(async () => {
    setError(null);
    setFillSummary(null);
    setCanUndo(false);
    setUndoMsg(null);
    setNeedsPermission(null);
    setStale(false);
    setPhase('scanning');
    reset();
    try {
      const tab = await getActiveTab();
      const result = await scanTab(tab.id);
      // The content script reports the real origin, even when Chrome hid the URL from us.
      const domain = new URL(result.origin).hostname;
      setScanTabInfo({ ...tab, origin: result.origin, domain });
      setCurrentDomain(domain);
      setScan(result);
      setPhase('mapping');
      const ps = await run(result, app.facts, app.lockedKeys, app.provider, domain);
      await app.record({ type: 'scan', blocked: ps.filter((p) => p.status === 'blocked').length });
      setPhase('review');
    } catch (e) {
      if (e instanceof TabError && e.code === 'needs_permission') {
        try {
          setNeedsPermission((await getActiveTab()).origin ?? UNKNOWN_SITE);
        } catch {
          setError(e.message);
        }
      } else setError(e instanceof Error ? e.message : 'Scan failed');
      setPhase('idle');
    }
  }, [app, reset, run]);

  const grant = async () => {
    if (!needsPermission) return;
    // Called directly from the click handler (user gesture).
    const ok = needsPermission === UNKNOWN_SITE ? await requestWebPermission() : await requestSitePermission(needsPermission);
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
      if (tab.id !== scanTabInfo.id || (tab.origin !== null && tab.origin !== scan.origin)) {
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
      setCanUndo(counts.filled > 0);
      setUndoMsg(null);
      await app.record({ type: 'fill', ...counts });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fill failed');
    } finally {
      setPhase('review');
    }
  };

  const doUndo = async () => {
    if (!scan || !scanTabInfo) return;
    try {
      const res = await undoFill(scanTabInfo.id, scan.scanId);
      setProposals((ps) => ps.map((p) => (p.status === 'completed' ? { ...p, status: 'review', note: 'Undone: the previous value was restored' } : p)));
      setCanUndo(false);
      setFillSummary(null);
      setUndoMsg(`Restored ${res.restored} field${res.restored === 1 ? '' : 's'}.${res.notUndoable ? ` ${res.notUndoable} custom choice widget(s) must be changed by hand.` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed');
    }
  };

  const locate = (fieldId: string) => {
    if (scan && scanTabInfo) void locateOnPage(scanTabInfo.id, scan.scanId, fieldId);
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
              <span className="truncate">{currentDomain ?? 'Browser page (open a website)'}</span>
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

      {needsPermission && needsPermission !== UNKNOWN_SITE ? (
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
      {needsPermission === UNKNOWN_SITE ? (
        <Notice
          tone="accent"
          icon={KeyRound}
          title="A2C needs access to this page"
          action={
            <Button size="sm" variant="primary" onClick={grant}>
              Allow A2C to read forms on websites
            </Button>
          }
        >
          Chrome hides the address of this tab until you allow it. Quickest one-time option: click the A2C icon in the toolbar (or press Alt+Shift+F) while this
          form is open, then press Scan Form again. Or allow website access below; A2C still reads a page only when you click Scan or Fill, and you can revoke it in
          Chrome's extension settings.
        </Notice>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {phase === 'mapping' && app.provider.kind !== 'mock' ? (
        <Notice
          tone="accent"
          icon={Gauge}
          title={`${app.provider.kind === 'specialist' ? 'Specialist' : 'Gemma 4'} is reading the form... ${elapsed}s`}
          action={
            <Button size="sm" onClick={skipAI}>
              Use instant rules instead
            </Button>
          }
        >
          Local AI on a CPU can take up to a minute. Rescanning the same form later is instant (cached for this session).
        </Notice>
      ) : null}
      {undoMsg ? <Notice tone="ok">{undoMsg}</Notice> : null}
      {stale && scan ? (
        <Notice tone="warn" title="Page changed since the scan" action={<Button size="sm" icon={RefreshCw} onClick={doScan}>Rescan</Button>}>
          Values will not be filled into a different page.
        </Notice>
      ) : null}

      {info ? (
        info.source === 'gemma' || info.source === 'specialist' ? (
          <Notice tone="ok" icon={Wand2} title={info.aiFieldCount === 0 ? 'Matched instantly by rules (no AI needed)' : info.source === 'gemma' ? 'Mapped by Gemma 4' : 'Mapped by fine-tuned specialist'}>
            {info.aiFieldCount ? `${info.aiFieldCount} unclear field${info.aiFieldCount === 1 ? '' : 's'} sent to the model` : 'No field needed the model'}{info.ruleMatched ? `; ${info.ruleMatched} obvious field${info.ruleMatched === 1 ? '' : 's'} matched instantly by rules` : ''}. Only labels and memory key names leave your browser, never values.
          </Notice>
        ) : info.source === 'mock' ? (
          <Notice tone="warn" title="MOCK MODE">
            Deterministic keyword matching, not AI. Switch engines in Settings.
          </Notice>
        ) : (
          <Notice tone="warn" title="AI unavailable: rule-based fallback">
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

      {info?.request ? (
        <details className="border-2 border-line bg-surface px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold">
            <Eye className="mr-1 inline size-3.5 text-accent" aria-hidden />
            {info.source === 'mock' ? 'What would be sent to the AI (mock mode sent nothing)' : `Exactly what was sent to the AI${info.cached ? ' (reused from cache, nothing new sent)' : ''}`}
          </summary>
          <p className="mt-1.5 text-muted">Field labels, types, options and the names of your memory keys. No values, no page HTML, no blocked fields.</p>
          <pre className="mt-1.5 max-h-60 overflow-auto bg-surface-2 p-2 text-[11px] leading-snug whitespace-pre-wrap">{JSON.stringify(info.request, null, 1).slice(0, 6000)}</pre>
        </details>
      ) : null}

      {fillSummary ? (
        <Card className={fillSummary.failed ? 'border-danger' : ''}>
          <SectionTitle>Completion summary</SectionTitle>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Detected" value={stats.detected} />
            <Stat label="Filled" value={fillSummary.filled} tone="ok" />
            <Stat label="Skipped" value={fillSummary.skipped} />
            <Stat label="Blocked" value={stats.blocked} tone="danger" />
            <Stat label="Needs you" value={proposals.filter((p) => p.status === 'missing' || p.status === 'unsupported' || ((p.status === 'review' || p.status === 'ready') && !p.approved)).length} tone="warn" />
            <Stat label="Failed" value={fillSummary.failed} tone={fillSummary.failed ? 'danger' : undefined} />
          </div>
          <p className="mt-2 text-xs text-muted">Review the page and submit it yourself. A2C never submits forms.</p>
          {canUndo ? (
            <Button className="mt-2" size="sm" icon={Undo2} onClick={doUndo}>
              Undo this fill
            </Button>
          ) : null}
        </Card>
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
        <ProposalList proposals={proposals} update={update} refreshForKey={refreshForKey} domain={scanTabInfo?.domain ?? ''} provenance="form_approved" onLocate={locate} />
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
