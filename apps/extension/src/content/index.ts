import { ContentRequestSchema, type FillResponse } from '@contextfill/shared';
import { fillApprovedFields } from './filler';
import { scanDocument, type ScanState } from './scanner';

/**
 * Content script entry. Injected on demand (activeTab / granted host) by the
 * side panel. Accepts only schema-valid messages from this extension.
 */

const VERSION = '0.1.0';
type Flagged = typeof globalThis & { __contextfillAlive?: () => boolean };
const g = globalThis as Flagged;

function alive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

if (!(g.__contextfillAlive && g.__contextfillAlive())) {
  g.__contextfillAlive = alive;
  let state: ScanState | null = null;

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    // Only our own extension pages (side panel) may talk to this script.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const parsed = ContentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      sendResponse({ ok: false, error: 'invalid_message' });
      return false;
    }
    const msg = parsed.data;
    try {
      switch (msg.type) {
        case 'CF_PING':
          sendResponse({ ok: true, version: VERSION });
          break;
        case 'CF_SCAN': {
          const { result, state: next } = scanDocument(document);
          state = next;
          sendResponse({ ok: true, result });
          break;
        }
        case 'CF_FILL': {
          const results = fillApprovedFields(state, msg.scanId, msg.origin, msg.fills, location.origin);
          const response: FillResponse = { ok: true, results };
          sendResponse(response);
          break;
        }
        case 'CF_CLEAR_HIGHLIGHTS':
          sendResponse({ ok: true });
          break;
      }
    } catch {
      sendResponse({ ok: false, error: 'content_script_error' });
    }
    return false;
  });
}
