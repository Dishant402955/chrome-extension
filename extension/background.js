// ============================================================
//  background.js
// ============================================================

let recording        = false;
let recordingTab     = null;
let recordingQuality = null;
let keepAliveId      = null;

// Accumulate ALL data across page navigations in background.
// Content scripts die on navigation; background does not.
let allSamples = [];
let allEvents  = [];
let viewport   = null;

// Floating panel window
let panelWinId = null;
let panelPort  = null;

// ── Open / focus floating panel on toolbar click ─────────────
chrome.action.onClicked.addListener((tab) => {
  if (panelWinId !== null) {
    // Already open — just focus it
    chrome.windows.update(panelWinId, { focused: true }, () => {
      if (chrome.runtime.lastError) {
        // Window was closed externally — recreate
        panelWinId = null;
        openPanel();
      }
    });
  } else {
    openPanel();
  }
});

function openPanel() {
  chrome.windows.create({
    url:    "panel.html",
    type:   "popup",       // floating draggable window, not attached to browser
    width:  300,
    height: 400,
    focused: true
  }, (win) => {
    panelWinId = win.id;
  });
}

// Track when the panel window is closed
chrome.windows.onRemoved.addListener((winId) => {
  if (winId === panelWinId) {
    panelWinId = null;
    panelPort  = null;
    // If recording was active when panel closed, keep recording
    // (user can reopen panel to stop)
  }
});

// ── Panel port (long-lived, survives multiple messages) ───────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recorder-panel") return;
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
});

function notifyPanel(msg) {
  if (!panelPort) return;
  try { panelPort.postMessage(msg); } catch (_) {}
}

// ── Keep MV3 service worker alive during recording ────────────
function startKeepAlive() {
  if (keepAliveId) return;
  keepAliveId = setInterval(() => {
    chrome.storage.session.set({ _ka: Date.now() }, () => {
      void chrome.runtime.lastError;
    });
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
// When the recording tab navigates, the old content script dies.
// We send RESUME to the new one so data collection continues.
// We retry a few times because 'complete' can fire before
// content scripts are actually ready.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!recording || tabId !== recordingTab) return;
  if (changeInfo.status !== "complete") return;

  const resumeMsg = {
    type:      "RESUME",
    quality:   recordingQuality,
    startedAt: allSamples.length
      ? allSamples[allSamples.length - 1].time
      : 0
  };

  // Try immediately, then retry after 500ms and 1500ms
  // in case content scripts weren't ready yet
  [300, 800, 1800].forEach(delay => {
    setTimeout(() => {
      if (!recording || recordingTab !== tabId) return;
      sendToTab(tabId, resumeMsg);
    }, delay);
  });
});

// ── Download helper ───────────────────────────────────────────
function downloadJson(obj, filename, saveAs = false) {
  const blob   = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({ url: reader.result, filename, saveAs });
  };
  reader.readAsDataURL(blob);
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  // ── START ────────────────────────────────────────────────
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

  // ── STOP ─────────────────────────────────────────────────
  else if (msg.type === "STOP") {
    recording = false;
    stopKeepAlive();

    if (recordingTab) {
      // Send full accumulated data with STOP so content.js can
      // generate the script even if its local data is incomplete
      sendToTab(recordingTab, {
        type:        "STOP",
        accumulated: { samples: allSamples, events: allEvents, viewport }
      });
    }
  }

  // ── Content script confirmed start ───────────────────────
  else if (msg.type === "RECORDING_STARTED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
    notifyPanel({ type: "RECORDING_STARTED" });
  }

  // ── Content script resumed after navigation ───────────────
  else if (msg.type === "RECORDING_RESUMED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
  }

  // ── Sample accumulation ───────────────────────────────────
  else if (msg.type === "sample" && recording) {
    allSamples.push(msg.data);
    if (allSamples.length % 20 === 0) {
      notifyPanel({ type: "TICK", count: allSamples.length });
    }
  }

  // ── Event accumulation ────────────────────────────────────
  else if (msg.type === "event" && recording) {
    allEvents.push(msg.data);
  }

  // ── Final data (video + script from content.js) ───────────
  else if (msg.type === "FINAL_DATA") {
    recordingTab = null;
    const { screenDataUrl, script } = msg.data;

    // script.json — editor output, ask where to save
    downloadJson(script, "script.json", true);

    if (screenDataUrl) {
      chrome.downloads.download({
        url:      screenDataUrl,
        filename: "screen.webm",
        saveAs:   true
      });
    }

    notifyPanel({ type: "RECORDING_DONE" });
  }

  // ── Debug data ────────────────────────────────────────────
  else if (msg.type === "DEBUG_DATA") {
    // Auto-saved, no dialog
    downloadJson(msg.data, "debug.json", false);
  }

  // ── Error ─────────────────────────────────────────────────
  else if (msg.type === "CONTENT_ERROR") {
    recording = false;
    stopKeepAlive();
    recordingTab = null;
    notifyPanel({ type: "ERROR", message: msg.message });
  }
});
