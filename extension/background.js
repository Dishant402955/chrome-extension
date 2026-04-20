// ============================================================
//  background.js
// ============================================================

let recording        = false;
let recordingTab     = null;
let recordingQuality = null;
let keepAliveId      = null;
let panelWinId       = null;
let panelPort        = null;

let allSamples = [];
let allEvents  = [];
let viewport   = null;

// ── Open / restore floating panel ─────────────────────────────
chrome.action.onClicked.addListener(() => {
  if (panelWinId !== null) {
    chrome.windows.update(panelWinId, { focused: true, state: "normal" }, () => {
      if (chrome.runtime.lastError) {
        panelWinId = null;
        openPanel();
      }
    });
  } else {
    openPanel();
  }
});

function openPanel() {
  chrome.windows.create(
    { url: "panel.html", type: "popup", width: 300, height: 400, focused: true },
    (win) => { panelWinId = win.id; }
  );
}

chrome.windows.onRemoved.addListener((winId) => {
  if (winId === panelWinId) { panelWinId = null; panelPort = null; }
});

// ── Panel port ────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recorder-panel") return;
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
});

function notifyPanel(msg) {
  if (!panelPort) return;
  try { panelPort.postMessage(msg); } catch (_) {}
}

// ── Keep-alive ────────────────────────────────────────────────
function startKeepAlive() {
  if (keepAliveId) return;
  keepAliveId = setInterval(() => {
    chrome.storage.session.set({ _ka: Date.now() }, () => { void chrome.runtime.lastError; });
  }, 20_000);
}
function stopKeepAlive() { clearInterval(keepAliveId); keepAliveId = null; }

function sendToTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError; });
}

// ── Re-inject on navigation ───────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!recording || tabId !== recordingTab) return;
  if (changeInfo.status !== "complete") return;

  const resumeMsg = {
    type:      "RESUME",
    quality:   recordingQuality,
    startedAt: allSamples.length ? allSamples[allSamples.length - 1].time : 0
  };

  [300, 900, 2000].forEach(d => setTimeout(() => {
    if (!recording || recordingTab !== tabId) return;
    sendToTab(tabId, resumeMsg);
  }, d));
});

// ── Download helper ───────────────────────────────────────────
function downloadJson(obj, filename, saveAs = false) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const r    = new FileReader();
  r.onload   = () => chrome.downloads.download({ url: r.result, filename, saveAs });
  r.readAsDataURL(blob);
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === "START") {
    const { tabId, quality } = msg;
    recording = true; recordingTab = tabId; recordingQuality = quality;
    allSamples = []; allEvents = []; viewport = null;
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

    // ── THE TIMER THROTTLING FIX ────────────────────────────
    // Chrome throttles setInterval in background (hidden) tabs.
    // With our floating panel window open, the recording tab goes
    // to the background → timers slow from 50ms to 1000ms.
    //
    // Fix: focus the recording tab's window so it becomes
    // the foreground page, then minimize the panel.
    // Panel can be restored any time via the extension icon.
    const tabId = recordingTab;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      // Bring recording tab's window to front
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
        // Minimize panel after a short delay so it doesn't steal focus back
        setTimeout(() => {
          if (panelWinId) {
            chrome.windows.update(panelWinId, { state: "minimized" }, () => {
              void chrome.runtime.lastError;
            });
          }
        }, 200);
      });
    });
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
    downloadJson(script, "script.json", true);
    if (screenDataUrl) {
      chrome.downloads.download({ url: screenDataUrl, filename: "screen.webm", saveAs: true });
    }
    notifyPanel({ type: "RECORDING_DONE" });

    // Restore panel after recording finishes
    if (panelWinId) {
      chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }

  else if (msg.type === "DEBUG_DATA") {
    downloadJson(msg.data, "debug.json", false);
  }

  else if (msg.type === "CONTENT_ERROR") {
    recording = false; stopKeepAlive(); recordingTab = null;
    notifyPanel({ type: "ERROR", message: msg.message });
    if (panelWinId) {
      chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }
});
