import {
  FillResponseSchema,
  PingResponseSchema,
  ScanResultSchema,
  type ContentRequest,
  type FillInstruction,
  type FillResponse,
  type ScanResult,
  type UndoResponse,
  UndoResponseSchema,
} from '@a2c/shared';
import { z } from 'zod';

/**
 * Side panel <-> content script bridge. The content script is injected on
 * demand into the active tab only, using activeTab or a per-site host
 * permission that the user grants explicitly.
 */

export class TabError extends Error {
  constructor(
    message: string,
    readonly code: 'no_tab' | 'unsupported_page' | 'needs_permission' | 'inject_failed' | 'bad_response',
  ) {
    super(message);
    this.name = 'TabError';
  }
}

export interface ActiveTab {
  id: number;
  /** null when Chrome hides the address (A2C has no access to this site yet). */
  url: string | null;
  origin: string | null;
  domain: string | null;
}

const RESTRICTED_URL = /^(chrome|edge|brave|about|chrome-extension|devtools|view-source|chrome-search):/i;

/** Browser-internal pages that no extension may script. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (RESTRICTED_URL.test(url)) return true;
  try {
    const host = new URL(url).hostname;
    return host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && url.includes('/webstore'));
  } catch {
    return true;
  }
}

export function parseTabUrl(url: string | undefined): { origin: string; domain: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isRestrictedUrl(url)) return null;
    return { origin: u.origin, domain: u.hostname };
  } catch {
    return null;
  }
}

export async function getActiveTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new TabError('No active tab', 'no_tab');
  // Without access to a site Chrome hides tab.url. That is NOT a browser page: try to scan anyway.
  if (isRestrictedUrl(tab.url)) throw new TabError('This is a browser page (settings, extensions, Web Store) and cannot be scanned. Open a website form.', 'unsupported_page');
  const parsed = parseTabUrl(tab.url);
  if (tab.url && !parsed) throw new TabError('Only web pages (http/https) can be scanned.', 'unsupported_page');
  return { id: tab.id, url: tab.url ?? null, origin: parsed?.origin ?? null, domain: parsed?.domain ?? null };
}

export function originPattern(origin: string): string {
  return `${origin}/*`;
}

export async function hasSitePermission(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(origin)] });
  } catch {
    return false;
  }
}

/** Must be called from a user gesture (button click). Grants access to this one site only. */
export async function requestSitePermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(origin)] });
}

/** Fallback when Chrome hides the tab address: optional access to web pages, still used only on Scan/Fill. */
export async function requestWebPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
}

async function send<T>(tabId: number, msg: ContentRequest, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new TabError('Unexpected response from page script', 'bad_response');
  return parsed.data;
}

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await send(tabId, { type: 'CF_PING' }, PingResponseSchema);
    return;
  } catch {
    // not injected yet
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/chrome:\/\/|extensions gallery|chrome-extension:|cannot be scripted/i.test(message)) {
      throw new TabError('This is a browser page and cannot be scanned. Open a website form.', 'unsupported_page');
    }
    if (/permission|Cannot access/i.test(message)) {
      throw new TabError('A2C needs your permission to read form fields on this site.', 'needs_permission');
    }
    throw new TabError(`Could not attach to the page: ${message.slice(0, 120)}`, 'inject_failed');
  }
  await send(tabId, { type: 'CF_PING' }, PingResponseSchema);
}

const ScanResponseSchema = z.object({ ok: z.literal(true), result: ScanResultSchema });

export async function scanTab(tabId: number): Promise<ScanResult> {
  await ensureContentScript(tabId);
  const res = await send(tabId, { type: 'CF_SCAN' }, ScanResponseSchema);
  return res.result;
}

export async function fillTab(tabId: number, scanId: string, origin: string, fills: FillInstruction[]): Promise<FillResponse> {
  await ensureContentScript(tabId);
  return send(tabId, { type: 'CF_FILL', scanId, origin, fills }, FillResponseSchema);
}

export async function undoFill(tabId: number, scanId: string): Promise<UndoResponse> {
  await ensureContentScript(tabId);
  return send(tabId, { type: 'CF_UNDO', scanId }, UndoResponseSchema);
}

export async function locateOnPage(tabId: number, scanId: string, fieldId: string): Promise<boolean> {
  try {
    const res = await send(tabId, { type: 'CF_LOCATE', scanId, fieldId }, z.object({ ok: z.boolean() }));
    return res.ok;
  } catch {
    return false;
  }
}
