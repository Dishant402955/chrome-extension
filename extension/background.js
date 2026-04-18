// ============================================================
//  background.js
// ============================================================

let recording    = false;
let recordingTab = null;
let keepAliveId  = null;

// Long-lived port to the side panel (more reliable than sendMessage)
let panelPort = null;

// ── Open side panel when toolbar icon is clicked ─────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Side panel port ──────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recorder-panel") return;

  panelPort = port;

  port.onDisconnect.addListener(() => {
    panelPort = null;
  });
});

function notifyPanel(msg) {
  if (!panelPort) return;
  try { panelPort.postMessage(msg); } catch (_) {}
}

// ── Keep MV3 service worker alive during recording ───────────
function startKeepAlive() {
  if (keepAliveId) return;
  keepAliveId = setInterval(() => {
    chrome.storage.session.set({ _ka: Date.now() }, () => {
      void chrome.runtime.lastError;
    });
  }, 20_000);
}

function stopKeepAlive() {
  if (!keepAliveId) return;
  clearInterval(keepAliveId);
  keepAliveId = null;
}

// ── Safe tab messenger ────────────────────────────────────────
function sendToTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg, () => {
    void chrome.runtime.lastError;
  });
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  // ── START: side panel sends tabId + quality ──────────────
  if (msg.type === "START") {
    const { tabId, quality } = msg;
    recording    = true;
    recordingTab = tabId;
    startKeepAlive();

    // Switch to target tab, then tell content script to start
    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        notifyPanel({ type: "ERROR", message: "Could not switch to tab." });
        return;
      }
      sendToTab(tabId, { type: "START", quality });
    });
  }

  // ── STOP ─────────────────────────────────────────────────
  else if (msg.type === "STOP") {
    recording = false;
    stopKeepAlive();
    if (recordingTab) sendToTab(recordingTab, { type: "STOP" });
  }

  // ── Content script confirmed recording started ────────────
  else if (msg.type === "RECORDING_STARTED") {
    notifyPanel({ type: "RECORDING_STARTED" });
  }

  // ── Sample / event collection ─────────────────────────────
  else if (msg.type === "sample" && recording) {
    // Stored in content script; background just counts for status
    notifyPanel({ type: "TICK" });
  }

  else if (msg.type === "event" && recording) {
    // pass
  }

  // ── Recording finished ────────────────────────────────────
  else if (msg.type === "FINAL_DATA") {
    recordingTab = null;
    const { screenDataUrl, script } = msg.data;

    // script.json
    const blob = new Blob(
      [JSON.stringify(script, null, 2)],
      { type: "application/json" }
    );
    const reader = new FileReader();
    reader.onload = () => {
      chrome.downloads.download({
        url: reader.result,
        filename: "script.json",
        saveAs: true
      });
    };
    reader.readAsDataURL(blob);

    // screen.webm
    chrome.downloads.download({
      url: screenDataUrl,
      filename: "screen.webm",
      saveAs: true
    });

    notifyPanel({ type: "RECORDING_DONE" });
  }

  // ── Error relay from content script ──────────────────────
  else if (msg.type === "CONTENT_ERROR") {
    recording = false;
    stopKeepAlive();
    recordingTab = null;
    notifyPanel({ type: "ERROR", message: msg.message });
  }
});
