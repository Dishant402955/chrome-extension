// ============================================================
//  background.js
// ============================================================

let recording        = false;
let recordingTab     = null;
let recordingQuality = null;
let keepAliveId      = null;
let panelPort        = null;

// Accumulate ALL data across page navigations
let allSamples = [];
let allEvents  = [];
let viewport   = null;

// ── Open side panel ──────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Panel port ───────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recorder-panel") return;
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
});

function notifyPanel(msg) {
  if (!panelPort) return;
  try { panelPort.postMessage(msg); } catch (_) {}
}

// ── Keep-alive ───────────────────────────────────────────────
function startKeepAlive() {
  if (keepAliveId) return;
  keepAliveId = setInterval(() => {
    chrome.storage.session.set({ _ka: Date.now() }, () => { void chrome.runtime.lastError; });
  }, 20_000);
}
function stopKeepAlive() {
  clearInterval(keepAliveId);
  keepAliveId = null;
}

function sendToTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError; });
}

// ── Re-inject on navigation ───────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!recording || tabId !== recordingTab) return;
  if (changeInfo.status === "complete") {
    setTimeout(() => {
      sendToTab(tabId, {
        type:      "RESUME",
        quality:   recordingQuality,
        startedAt: allSamples.length ? allSamples[allSamples.length - 1].time : 0,
        viewport
      });
    }, 250);
  }
});

// ── Download helper ───────────────────────────────────────────
function downloadJson(obj, filename) {
  const blob   = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({ url: reader.result, filename, saveAs: false });
  };
  reader.readAsDataURL(blob);
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === "START") {
    const { tabId, quality } = msg;
    recording        = true;
    recordingTab     = tabId;
    recordingQuality = quality;
    allSamples       = [];
    allEvents        = [];
    viewport         = null;
    startKeepAlive();
    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        notifyPanel({ type: "ERROR", message: "Could not switch to tab." });
        return;
      }
      sendToTab(tabId, { type: "START", quality });
    });
  }

  else if (msg.type === "STOP") {
    recording = false;
    stopKeepAlive();
    if (recordingTab) {
      sendToTab(recordingTab, {
        type:        "STOP",
        accumulated: { samples: allSamples, events: allEvents, viewport }
      });
    }
  }

  else if (msg.type === "RECORDING_STARTED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
    notifyPanel({ type: "RECORDING_STARTED" });
  }

  else if (msg.type === "RECORDING_RESUMED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
  }

  else if (msg.type === "sample" && recording) {
    allSamples.push(msg.data);
    if (allSamples.length % 20 === 0) {
      notifyPanel({ type: "TICK", count: allSamples.length });
    }
  }

  else if (msg.type === "event" && recording) {
    allEvents.push(msg.data);
  }

  else if (msg.type === "FINAL_DATA") {
    recordingTab = null;
    const { screenDataUrl, script } = msg.data;

    // script.json — the editor-facing output
    downloadJson(script, "script.json");

    // screen.webm
    if (screenDataUrl) {
      chrome.downloads.download({ url: screenDataUrl, filename: "screen.webm", saveAs: true });
    }

    notifyPanel({ type: "RECORDING_DONE" });
  }

  else if (msg.type === "DEBUG_DATA") {
    // debug.json — automatically saved alongside script.json, no save dialog
    downloadJson(msg.data, "debug.json");
  }

  else if (msg.type === "CONTENT_ERROR") {
    recording = false;
    stopKeepAlive();
    recordingTab = null;
    notifyPanel({ type: "ERROR", message: msg.message });
  }
});
