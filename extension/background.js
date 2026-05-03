// ============================================================
//  background.js
//
//  Flow:
//    1. User clicks Start in panel.
//    2. Background finds the active normal-window tab → recorderTab.
//    3. Sends START_RECORD to recorderTab. Content script calls
//       getDisplayMedia (picker opens, no pre-selection forced).
//    4. User picks a tab in the picker → Chrome makes that tab active.
//    5. chrome.tabs.onActivated fires → background captures loggerTab.
//    6. Background sends START_LOG to loggerTab's content script.
//    7. Screen recording happens on recorderTab, interaction
//       logs come from loggerTab. Both are the same tab the user
//       chose in the picker — always in sync.
//
//  Edge case: user picks the SAME tab the recorder is on.
//    onActivated won't fire (already active). A 2s fallback
//    sends START_LOG to recorderTab instead.
// ============================================================

let recording      = false;
let recorderTabId  = null;   // tab whose content script records screen
let loggerTabId    = null;   // tab whose content script collects logs
let recordingQuality = null;
let keepAliveId    = null;
let panelWinId     = null;
let panelPort      = null;

// Set to true between START_RECORD sent and RECORDING_STARTED received.
// onActivated uses this to know the picker just resolved.
let awaitingPickerTab = false;
let pickerFallbackTimer = null;

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
    { url: "panel.html", type: "popup", width: 300, height: 320, focused: true },
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

// ── Detect which tab the picker selected ──────────────────────
// When the getDisplayMedia picker closes and the user has picked
// a tab, Chrome makes that tab the active tab in its window.
// We listen for this activation event to identify loggerTab.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (!awaitingPickerTab) return;
  // Ignore the panel window's own tab activations
  if (panelWinId !== null && windowId === panelWinId) return;
  // Ignore if it's the recorder tab re-activating itself
  // (can happen briefly; wait for a DIFFERENT tab or same tab as fallback)

  clearTimeout(pickerFallbackTimer);
  awaitingPickerTab = false;
  startLoggingOn(tabId);
});

function startLoggingOn(tabId) {
  loggerTabId = tabId;
  sendToTab(tabId, { type: "START_LOG" });
  notifyPanel({ type: "LOGGING_STARTED", tabId });
}

// ── Re-inject after navigation on logger tab ──────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!recording || tabId !== loggerTabId) return;
  if (changeInfo.status !== "complete") return;
  const resumeMsg = {
    type:      "RESUME_LOG",
    startedAt: allSamples.length ? allSamples[allSamples.length - 1].time : 0
  };
  [400, 1000, 2200].forEach(d => setTimeout(() => {
    if (!recording || loggerTabId !== tabId) return;
    sendToTab(tabId, resumeMsg);
  }, d));
});

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

  // ── START (from panel) ────────────────────────────────────
  if (msg.type === "START") {
    const { quality } = msg;
    recordingQuality = quality;
    allSamples       = [];
    allEvents        = [];
    viewport         = null;
    recorderTabId    = null;
    loggerTabId      = null;
    recording        = true;
    startKeepAlive();

    // Find the active tab in the main browser window (not the panel popup)
    chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
      const tab = tabs.find(t => t.url?.startsWith("http://") || t.url?.startsWith("https://"));
      if (!tab) {
        notifyPanel({ type: "ERROR", message: "No active web tab found. Open a website first." });
        recording = false; stopKeepAlive(); return;
      }

      recorderTabId = tab.id;

      // Prime the picker-detection listener BEFORE sending START_RECORD.
      // onActivated will fire when the user picks a tab in the picker.
      awaitingPickerTab = true;

      // Fallback: if onActivated never fires (user picked the same tab
      // that's already active, so no activation event), start logging
      // on the recorder tab itself after 2.5s.
      pickerFallbackTimer = setTimeout(() => {
        if (!awaitingPickerTab) return;
        awaitingPickerTab = false;
        startLoggingOn(recorderTabId);
      }, 2500);

      sendToTab(recorderTabId, { type: "START_RECORD", quality });
    });
  }

  // ── STOP (from panel) ─────────────────────────────────────
  else if (msg.type === "STOP") {
    recording = false;
    stopKeepAlive();
    clearTimeout(pickerFallbackTimer);
    awaitingPickerTab = false;

    // Stop logger first (no more samples needed)
    if (loggerTabId) sendToTab(loggerTabId, { type: "STOP_LOG" });

    // Stop recorder — it will send FINAL_DATA with the video
    if (recorderTabId) {
      sendToTab(recorderTabId, {
        type:        "STOP_RECORD",
        accumulated: { samples: allSamples, events: allEvents, viewport }
      });
    }
  }

  // ── Recorder ready (getDisplayMedia succeeded) ─────────────
  else if (msg.type === "RECORDING_STARTED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
    notifyPanel({ type: "RECORDING_STARTED" });

    // Focus the recorder tab's window so its timer doesn't throttle.
    // Minimize panel after a moment.
    chrome.tabs.get(recorderTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
        setTimeout(() => {
          if (panelWinId) chrome.windows.update(panelWinId, { state: "minimized" }, () => { void chrome.runtime.lastError; });
        }, 300);
      });
    });
  }

  // ── Logger tab resumed after navigation ────────────────────
  else if (msg.type === "RECORDING_RESUMED") {
    if (msg.data?.viewport) viewport = msg.data.viewport;
  }

  // ── Samples (from logger tab) ─────────────────────────────
  else if (msg.type === "sample" && recording) {
    allSamples.push(msg.data);
    if (allSamples.length % 20 === 0) notifyPanel({ type: "TICK", count: allSamples.length });
  }

  // ── Events (from logger tab) ──────────────────────────────
  else if (msg.type === "event" && recording) {
    allEvents.push(msg.data);
  }

  // ── Final video + log from recorder tab ───────────────────
  else if (msg.type === "FINAL_DATA") {
    recorderTabId = null;
    loggerTabId   = null;
    const { screenDataUrl, webcamDataUrl, hasWebcam, log } = msg.data;

    if (screenDataUrl) downloadDataUrl(screenDataUrl, "screen.webm", true);
    if (webcamDataUrl) downloadDataUrl(webcamDataUrl, "webcam.webm", false);
    downloadJson(log, `log_${Date.now()}.json`, true);

    notifyPanel({ type: "RECORDING_DONE", sampleCount: log.sampleCount });
    if (panelWinId) chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => { void chrome.runtime.lastError; });
  }

  else if (msg.type === "CONTENT_ERROR") {
    recording = false; stopKeepAlive();
    clearTimeout(pickerFallbackTimer); awaitingPickerTab = false;
    recorderTabId = null; loggerTabId = null;
    notifyPanel({ type: "ERROR", message: msg.message });
    if (panelWinId) chrome.windows.update(panelWinId, { state: "normal", focused: true }, () => { void chrome.runtime.lastError; });
  }
});
