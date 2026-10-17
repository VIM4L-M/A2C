import { workspaceMessage } from '../lib/workspaceBridge';
import { chromeKV } from '../lib/storage';
/**
 * Background service worker. Deliberately small: it only wires the toolbar
 * action to the side panel. All scanning/filling is initiated from the side
 * panel by an explicit user click; nothing runs in the background on pages.
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

// Exact local workspace only, with a separate user-controlled sharing grant.
chrome.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  if (sender.id || (sender.frameId !== undefined && sender.frameId !== 0)) { sendResponse({ ok: false, error: 'sender_denied' }); return false; }
  void workspaceMessage(msg, sender.url, chromeKV).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'connection_failed' }));
  return true;
});
