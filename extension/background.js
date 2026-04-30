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

// ── Panel ─────────────────────────────────────────────────────
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
    { url: "panel.html", type: "popup", width: 300, height: 380, focused: true },
    (win) => { panelWinId = win.id; }
  );
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === panelWinId) { panelWinId = null; panelPort = null; }
});

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

// ── Re-inject after navigation ────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!recording || tabId !== recordingTab) return;
  if (changeInfo.status !== "complete") return;

  const resumeMsg = {
    type: "RESUME",
    startedAt: allSamples.length ? allSamples[allSamples.length - 1].time : 0
  };

  [300, 900, 2000].forEach(d => setTimeout(() => {
    if (!recording || recordingTab !== tabId) return;
    sendToTab(tabId, resumeMsg);
  }, d));
});

// ── Download helpers ──────────────────────────────────────────
function downloadDataUrl(dataUrl, filename, saveAs = false) {
  chrome.downloads.download({ url: dataUrl, filename, saveAs });
}

function downloadJson(obj, filename, saveAs = false) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const r    = new FileReader();
  r.onload   = () => chrome.downloads.download({ url: r.result, filename, saveAs });
  r.readAsDataURL(blob);
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {

  // ───────── START ─────────
  if (msg.type === "START") {
    const { tabId, quality } = msg;

    recording        = true;
    recordingTab     = tabId;
    recordingQuality = quality;
    allSamples       = [];
    allEvents        = [];
    viewport         = null;

    startKeepAlive();

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        notifyPanel({ type: "ERROR", message: "Invalid tab." });
        return;
      }

      chrome.windows.update(tab.windowId, { focused: true }, () => {
        chrome.tabs.update(tabId, { active: true }, () => {

          setTimeout(() => {
            sendToTab(tabId, {
              type: "START",
              quality
            });
          }, 200);

        });
      });
    });
  }

  // 🔥 CRITICAL FIX — switch to actual captured tab
  else if (msg.type === "SWITCH_TO_THIS_TAB") {
    if (sender.tab && sender.tab.id) {
      recordingTab = sender.tab.id;
    }
  }

  // ───────── STOP ─────────
  else if (msg.type === "STOP") {
    recording = false;
    stopKeepAlive();

    if (recordingTab) {
      sendToTab(recordingTab, {
        type: "STOP",
        accumulated: { samples: allSamples, events: allEvents, viewport }
      });
    }
  }

  // ───────── STARTED ─────────
  else if (msg.type === "RECORDING_STARTED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;

    notifyPanel({ type: "RECORDING_STARTED", hasWebcam: msg.data?.hasWebcam });

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

  // ───────── RESUME ─────────
  else if (msg.type === "RECORDING_RESUMED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
  }

  // ───────── SAMPLE ─────────
  else if (msg.type === "sample" && recording) {
    allSamples.push(msg.data);

    if (allSamples.length % 20 === 0) {
      notifyPanel({ type: "TICK", count: allSamples.length });
    }
  }

  // ───────── EVENT ─────────
  else if (msg.type === "event" && recording) {
    allEvents.push(msg.data);
  }

  // ───────── FINAL ─────────
  else if (msg.type === "FINAL_DATA") {
    recordingTab = null;

    const { screenDataUrl, webcamDataUrl, hasWebcam, log } = msg.data;

    if (screenDataUrl) downloadDataUrl(screenDataUrl, "screen.webm", true);
    if (webcamDataUrl) downloadDataUrl(webcamDataUrl, "webcam.webm", false);

    downloadJson(log, `log_${Date.now()}.json`, true);

    notifyPanel({
      type: "RECORDING_DONE",
      sampleCount: log.sampleCount,
      hasWebcam
    });

    if (panelWinId) {
      chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }

  // ───────── ERROR ─────────
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