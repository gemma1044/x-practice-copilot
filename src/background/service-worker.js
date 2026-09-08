const CONTEXT_KEY = "xpc_current_context";
const MODE_KEY = "xpc_current_mode";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "XPC_OPEN_PANEL") return undefined;

  const tabId = sender.tab?.id;
  const storageWrite = chrome.storage.local.set({
    [CONTEXT_KEY]: message.context,
    [MODE_KEY]: message.action
  });
  const panelOpen = tabId ? chrome.sidePanel.open({ tabId }) : Promise.resolve();

  Promise.all([storageWrite, panelOpen])
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
