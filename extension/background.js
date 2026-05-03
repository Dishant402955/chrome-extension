// ============================================================
//  background.js
// ============================================================

let recording      = false;
let recorderTabId  = null;
let recordingQuality = null;
let keepAliveId    = null;
let panelWinId     = null;
let panelPort      = null;

let allSamples = [];
let allEvents  = [];
let viewport   = null;

// NEW: fallback timer for STOP reliability
let stopFallbackTimer = null;

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
    { url: "panel.html", type: "popup", width: 420, height: 520, focused: true }, // UPDATED SIZE
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
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError; });
}

// ── Downloads ─────────────────────────────────────────────────
function downloadDataUrl(dataUrl, filename, saveAs = false) {
  chrome.downloads.download({ url: dataUrl, filename, saveAs });
}
function downloadJson(obj, filename, saveAs = false) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const r = new FileReader();
  r.onload = () => chrome.downloads.download({ url: r.result, filename, saveAs });
  r.readAsDataURL(blob);
}

// ── Message hub ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {

  // ── START ────────────────────────────────────────────────
  if (msg.type === "START") {
    const { quality } = msg;

    recordingQuality = quality;
    allSamples       = [];
    allEvents        = [];
    viewport         = null;
    recorderTabId    = null;
    recording        = true;

    startKeepAlive();

    chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
      const tab = tabs.find(t => t.url?.startsWith("http://") || t.url?.startsWith("https://"));
      if (!tab) {
        notifyPanel({ type: "ERROR", message: "No active web tab found. Open a website first." });
        recording = false;
        stopKeepAlive();
        return;
      }

      recorderTabId = tab.id;

      chrome.windows.update(tab.windowId, { focused: true }, () => {
        chrome.tabs.update(tab.id, { active: true }, () => {
          setTimeout(() => {
            sendToTab(recorderTabId, { type: "START", quality });
          }, 200);
        });
      });
    });
  }

  // ── STOP ────────────────────────────────────────────────
  else if (msg.type === "STOP") {

    stopKeepAlive();

    if (recorderTabId) {
      sendToTab(recorderTabId, {
        type:        "STOP",
        accumulated: { samples: allSamples, events: allEvents, viewport }
      });

      // NEW: fallback if FINAL_DATA never arrives
      clearTimeout(stopFallbackTimer);
      stopFallbackTimer = setTimeout(() => {
        recording = false;
        recorderTabId = null;

        notifyPanel({
          type: "ERROR",
          message: "Recording stopped but no data received."
        });

        if (panelWinId) {
          chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
            void chrome.runtime.lastError;
          });
        }
      }, 8000); // 8 sec fallback
    }
  }

  // ── Recording started ───────────────────────────────────
  else if (msg.type === "RECORDING_STARTED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;

    notifyPanel({
      type: "RECORDING_STARTED",
      hasWebcam: msg.data?.hasWebcam
    });

    chrome.tabs.get(recorderTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
        setTimeout(() => {
          if (panelWinId) {
            chrome.windows.update(panelWinId, { state: "minimized" }, () => {
              void chrome.runtime.lastError;
            });
          }
        }, 300);
      });
    });
  }

  else if (msg.type === "RECORDING_RESUMED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
  }

  // ── Samples ─────────────────────────────────────────────
  else if (msg.type === "sample" && recording) {
    allSamples.push(msg.data);
    if (allSamples.length % 20 === 0) {
      notifyPanel({ type: "TICK", count: allSamples.length });
    }
  }

  // ── Events ──────────────────────────────────────────────
  else if (msg.type === "event" && recording) {
    allEvents.push(msg.data);
  }

  // ── Final data ──────────────────────────────────────────
  else if (msg.type === "FINAL_DATA") {

    clearTimeout(stopFallbackTimer);

    recording = false;
    recorderTabId = null;

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

  else if (msg.type === "CONTENT_ERROR") {
    clearTimeout(stopFallbackTimer);

    recording = false;
    stopKeepAlive();
    recorderTabId = null;

    notifyPanel({ type: "ERROR", message: msg.message });

    if (panelWinId) {
      chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }
});