// ============================================================
//  background.js — log accumulator only
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

// ── Panel window ──────────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  if (panelWinId !== null) {
    chrome.windows.update(panelWinId, { focused: true, state: "normal" }, () => {
      if (chrome.runtime.lastError) { panelWinId = null; openPanel(); }
    });
  } else {
    openPanel();
  }
});

function openPanel() {
  chrome.windows.create(
    { url: "panel.html", type: "popup", width: 280, height: 340, focused: true },
    (win) => { panelWinId = win.id; }
  );
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === panelWinId) { panelWinId = null; panelPort = null; }
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
    startedAt: allSamples.length ? allSamples[allSamples.length - 1].time : 0
  };
  [300, 900, 2000].forEach(d => setTimeout(() => {
    if (!recording || recordingTab !== tabId) return;
    sendToTab(tabId, resumeMsg);
  }, d));
});

// ── Download log.json ─────────────────────────────────────────
function downloadLog() {
  const log = {
    viewport,
    recordedAt:   new Date().toISOString(),
    sampleCount:  allSamples.length,
    eventCount:   allEvents.length,
    durationMs:   allSamples.length > 1
      ? allSamples[allSamples.length - 1].time - allSamples[0].time
      : 0,
    samples: allSamples,
    events:  allEvents
  };

  const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
  const r    = new FileReader();
  r.onload   = () => chrome.downloads.download({
    url:      r.result,
    filename: `log_${Date.now()}.json`,
    saveAs:   true
  });
  r.readAsDataURL(blob);
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  // ── START ────────────────────────────────────────────────
  if (msg.type === "START") {
    const { tabId } = msg;
    recording    = true;
    recordingTab = tabId;
    allSamples   = [];
    allEvents    = [];
    viewport     = null;
    startKeepAlive();

    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        notifyPanel({ type: "ERROR", message: "Could not switch to tab." });
        return;
      }
      sendToTab(tabId, { type: "START" });
    });
  }

  // ── STOP ─────────────────────────────────────────────────
  else if (msg.type === "STOP") {
    recording = false;
    stopKeepAlive();
    if (recordingTab) sendToTab(recordingTab, { type: "STOP" });
  }

  // ── Content script ready ──────────────────────────────────
  else if (msg.type === "RECORDING_STARTED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
    notifyPanel({ type: "RECORDING_STARTED" });

    // Focus the recording tab window, then minimize panel
    // so Chrome doesn't throttle timers in the background tab
    const tabId = recordingTab;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
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

  // ── Data ─────────────────────────────────────────────────
  else if (msg.type === "sample" && recording) {
    allSamples.push(msg.data);
    if (allSamples.length % 20 === 0) {
      notifyPanel({ type: "TICK", count: allSamples.length });
    }
  }

  else if (msg.type === "event" && recording) {
    allEvents.push(msg.data);
  }

  // ── Content script confirmed stop → download log ──────────
  else if (msg.type === "STOPPED") {
    recordingTab = null;
    downloadLog();
    notifyPanel({ type: "RECORDING_DONE", sampleCount: allSamples.length });

    // Restore panel
    if (panelWinId) {
      chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }

  else if (msg.type === "CONTENT_ERROR") {
    recording = false;
    stopKeepAlive();
    recordingTab = null;
    notifyPanel({ type: "ERROR", message: msg.message });
    if (panelWinId) {
      chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }
});
