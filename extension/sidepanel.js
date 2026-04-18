// ============================================================
//  sidepanel.js
// ============================================================

// ── Quality presets ───────────────────────────────────────────
const QUALITIES = [
  { id: "high",   label: "HIGH",   desc: "1080p · 8 Mbps",  width: 1920, height: 1080, bitrate: 8_000_000 },
  { id: "medium", label: "MED",    desc: "720p  · 4 Mbps",  width: 1280, height: 720,  bitrate: 4_000_000 },
  { id: "low",    label: "LOW",    desc: "480p  · 2 Mbps",  width: 854,  height: 480,  bitrate: 2_000_000 },
];

// ── State ─────────────────────────────────────────────────────
let selectedTabId  = null;
let selectedQualId = "medium";
let isRecording    = false;
let timerInterval  = null;
let timerStart     = 0;
let tabs           = [];

// ── DOM refs ──────────────────────────────────────────────────
const logo        = document.getElementById("logo");
const tabList     = document.getElementById("tabList");
const qualList    = document.getElementById("qualityList");
const btnStart    = document.getElementById("btnStart");
const btnStop     = document.getElementById("btnStop");
const statusText  = document.getElementById("statusText");
const timerEl     = document.getElementById("timer");
const recInfo     = document.getElementById("recInfo");
const riTab       = document.getElementById("riTab");
const riQuality   = document.getElementById("riQuality");
const btnRefresh  = document.getElementById("btnRefresh");

// ── Long-lived port to background ────────────────────────────
const port = chrome.runtime.connect({ name: "recorder-panel" });

port.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") onRecordingStarted();
  if (msg.type === "RECORDING_DONE")    onRecordingDone();
  if (msg.type === "ERROR")             onError(msg.message);
});

port.onDisconnect.addListener(() => {
  // Service worker restarted — just update status
  setStatus("RECONNECTING…", "");
});

// ── Background send ───────────────────────────────────────────
function bgSend(msg) {
  chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
}

// ── Tab list ──────────────────────────────────────────────────
function loadTabs() {
  tabList.innerHTML = '<div class="tab-empty">Loading…</div>';

  chrome.tabs.query({}, (allTabs) => {
    // Only tabs with http/https (content scripts can run there)
    tabs = allTabs.filter(t =>
      t.url && (t.url.startsWith("http://") || t.url.startsWith("https://"))
    );

    if (!tabs.length) {
      tabList.innerHTML = '<div class="tab-empty">No capturable tabs found.</div>';
      return;
    }

    // Auto-select first if nothing selected yet
    if (!selectedTabId || !tabs.find(t => t.id === selectedTabId)) {
      selectedTabId = tabs[0].id;
    }

    renderTabs();
  });
}

function renderTabs() {
  tabList.innerHTML = "";

  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className = "tab-item" + (tab.id === selectedTabId ? " selected" : "");
    item.dataset.id = tab.id;

    const indicator = document.createElement("div");
    indicator.className = "tab-indicator";

    let favEl;
    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      favEl = document.createElement("img");
      favEl.className = "tab-fav";
      favEl.src = tab.favIconUrl;
      favEl.onerror = () => {
        favEl.style.display = "none";
      };
    } else {
      favEl = document.createElement("div");
      favEl.className = "tab-fav-placeholder";
      favEl.textContent = "□";
    }

    const info = document.createElement("div");
    info.className = "tab-info";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title || "(untitled)";

    const url = document.createElement("div");
    url.className = "tab-url";
    try {
      const u = new URL(tab.url || "");
      url.textContent = u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch (_) {
      url.textContent = tab.url || "";
    }

    info.appendChild(title);
    info.appendChild(url);

    item.appendChild(indicator);
    item.appendChild(favEl);
    item.appendChild(info);

    item.addEventListener("click", () => {
      if (isRecording) return;
      selectedTabId = tab.id;
      renderTabs();
    });

    tabList.appendChild(item);
  }
}

// ── Quality list ──────────────────────────────────────────────
function renderQualities() {
  qualList.innerHTML = "";

  for (const q of QUALITIES) {
    const item = document.createElement("div");
    item.className = "q-item" + (q.id === selectedQualId ? " selected" : "");
    item.dataset.id = q.id;

    const dot  = document.createElement("div");  dot.className  = "q-dot";
    const name = document.createElement("span"); name.className = "q-name"; name.textContent = q.label;
    const desc = document.createElement("span"); desc.className = "q-desc"; desc.textContent = q.desc;

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(desc);

    item.addEventListener("click", () => {
      if (isRecording) return;
      selectedQualId = q.id;
      renderQualities();
    });

    qualList.appendChild(item);
  }
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() {
  timerStart = Date.now();
  timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - timerStart) / 1000);
    const mm  = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss  = String(sec % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
  }, 500);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerEl.textContent = "";
}

// ── UI state transitions ──────────────────────────────────────
function setStatus(text, cls) {
  statusText.textContent = text;
  statusText.className = "status-text" + (cls ? " " + cls : "");
}

function setControlsDisabled(disabled) {
  // Disable tab/quality selection visually
  tabList.style.opacity  = disabled ? "0.4" : "1";
  qualList.style.opacity = disabled ? "0.4" : "1";
  btnRefresh.disabled    = disabled;
}

function onRecordingStarted() {
  isRecording = true;

  btnStart.style.display = "none";
  btnStop.style.display  = "";
  btnStop.disabled       = false;

  logo.classList.add("live");
  setStatus("● LIVE", "live");
  setControlsDisabled(true);

  // Show recording info panel
  const qual = QUALITIES.find(q => q.id === selectedQualId);
  const tab  = tabs.find(t => t.id === selectedTabId);
  riTab.textContent     = tab ? (tab.title || tab.url || "Unknown").slice(0, 30) : "—";
  riQuality.textContent = qual ? qual.desc : "—";
  recInfo.classList.add("visible");

  startTimer();
}

function onRecordingDone() {
  isRecording = false;

  btnStop.style.display  = "none";
  btnStop.disabled       = false;
  btnStart.style.display = "";
  btnStart.disabled      = false;

  logo.classList.remove("live");
  setStatus("SAVED ✓", "done");
  setControlsDisabled(false);
  recInfo.classList.remove("visible");
  stopTimer();

  // Reset status after 3s
  setTimeout(() => { if (!isRecording) setStatus("READY", ""); }, 3000);
}

function onError(message) {
  isRecording = false;

  btnStop.style.display  = "none";
  btnStart.style.display = "";
  btnStart.disabled      = false;

  logo.classList.remove("live");
  setStatus("ERR: " + (message || "unknown"), "error");
  setControlsDisabled(false);
  recInfo.classList.remove("visible");
  stopTimer();
}

// ── Button handlers ───────────────────────────────────────────
btnStart.addEventListener("click", () => {
  if (!selectedTabId) {
    setStatus("SELECT A TAB FIRST", "error");
    return;
  }

  const qual = QUALITIES.find(q => q.id === selectedQualId) || QUALITIES[1];

  btnStart.disabled = true;
  setStatus("STARTING…", "");

  bgSend({
    type:    "START",
    tabId:   selectedTabId,
    quality: { width: qual.width, height: qual.height, bitrate: qual.bitrate }
  });
});

btnStop.addEventListener("click", () => {
  btnStop.disabled = true;
  setStatus("STOPPING…", "");
  bgSend({ type: "STOP" });
});

btnRefresh.addEventListener("click", () => {
  if (!isRecording) loadTabs();
});

// ── Boot ──────────────────────────────────────────────────────
loadTabs();
renderQualities();
setStatus("READY", "");
