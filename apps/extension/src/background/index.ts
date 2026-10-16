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

// The extension does not accept messages from web pages or other extensions.
chrome.runtime.onMessageExternal?.addListener((_msg, _sender, sendResponse) => {
  sendResponse({ ok: false });
});
