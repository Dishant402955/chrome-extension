// ============================================================
//  panel.js — Floating recorder panel
// ============================================================

const QUALITIES = [
  { id:"hi",  label:"HIGH", desc:"1080p·8M",  width:1920, height:1080, bitrate:8_000_000 },
  { id:"med", label:"MED",  desc:"720p·4M",   width:1280, height:720,  bitrate:4_000_000 },
  { id:"lo",  label:"LOW",  desc:"480p·2M",   width:854,  height:480,  bitrate:2_000_000 },
];

let selectedTab  = null;
let selectedQ    = "med";
let isRecording  = false;
let timerRef     = null;
let timerStart   = 0;
let sampleCount  = 0;
let tabs         = [];

// ── DOM refs ──────────────────────────────────────────────────
const dot        = document.getElementById("dot");
const tabList    = document.getElementById("tabList");
const qualList   = document.getElementById("qualList");
const btnStart   = document.getElementById("btnStart");
const btnStop    = document.getElementById("btnStop");
const statusEl   = document.getElementById("statusEl");
const timerEl    = document.getElementById("timerEl");
const recInfo    = document.getElementById("recInfo");
const riTab      = document.getElementById("riTab");
const riQ        = document.getElementById("riQ");
const riSamples  = document.getElementById("riSamples");
const btnRefresh = document.getElementById("btnRefresh");

// ── Port ──────────────────────────────────────────────────────
const port = chrome.runtime.connect({ name: "recorder-panel" });

port.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") onStarted();
  if (msg.type === "RECORDING_DONE")    onDone();
  if (msg.type === "ERROR")             onError(msg.message);
  if (msg.type === "TICK") {
    sampleCount = msg.count || sampleCount + 1;
    riSamples.textContent = sampleCount;
  }
});

function bgSend(msg) {
  chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
}

// ── Tab list ──────────────────────────────────────────────────
function loadTabs() {
  tabList.innerHTML = '<div class="tab-empty">Loading…</div>';
  chrome.tabs.query({}, (all) => {
    tabs = all.filter(t => t.url?.startsWith("http://") || t.url?.startsWith("https://"));
    if (!tabs.length) {
      tabList.innerHTML = '<div class="tab-empty">No capturable tabs.</div>';
      return;
    }
    if (!selectedTab || !tabs.find(t => t.id === selectedTab)) {
      selectedTab = tabs[0].id;
    }
    renderTabs();
  });
}

function renderTabs() {
  tabList.innerHTML = "";
  for (const t of tabs) {
    const item = document.createElement("div");
    item.className = "tab" + (t.id === selectedTab ? " sel" : "");

    const bar = document.createElement("div"); bar.className = "tab-bar";

    let fav;
    if (t.favIconUrl && !t.favIconUrl.startsWith("chrome://")) {
      fav = document.createElement("img");
      fav.className = "tab-fav"; fav.src = t.favIconUrl;
      fav.onerror = () => { fav.style.display = "none"; };
    } else {
      fav = document.createElement("div");
      fav.className = "tab-fav-ph"; fav.textContent = "□";
    }

    const info = document.createElement("div"); info.className = "tab-info";
    const name = document.createElement("div"); name.className = "tab-name";
    name.textContent = t.title || "(untitled)";
    const url = document.createElement("div"); url.className = "tab-url";
    try {
      const u = new URL(t.url || "");
      url.textContent = u.hostname;
    } catch (_) { url.textContent = t.url || ""; }

    info.append(name, url);
    item.append(bar, fav, info);
    item.addEventListener("click", () => {
      if (isRecording) return;
      selectedTab = t.id;
      renderTabs();
    });
    tabList.appendChild(item);
  }
}

// ── Quality ───────────────────────────────────────────────────
function renderQualities() {
  qualList.innerHTML = "";
  for (const q of QUALITIES) {
    const el = document.createElement("div");
    el.className = "qual" + (q.id === selectedQ ? " sel" : "");
    el.innerHTML = `<div class="qual-name">${q.label}</div><div class="qual-desc">${q.desc}</div>`;
    el.addEventListener("click", () => {
      if (isRecording) return;
      selectedQ = q.id;
      renderQualities();
    });
    qualList.appendChild(el);
  }
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() {
  timerStart = Date.now();
  timerRef = setInterval(() => {
    const s  = Math.floor((Date.now() - timerStart) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
  }, 500);
}
function stopTimer() {
  clearInterval(timerRef); timerRef = null;
  timerEl.textContent = "";
}

// ── State transitions ─────────────────────────────────────────
function setStatus(txt, cls) {
  statusEl.textContent = txt;
  statusEl.className   = "status" + (cls ? " " + cls : "");
}
function lockControls(locked) {
  tabList.style.opacity  = locked ? ".35" : "1";
  qualList.style.opacity = locked ? ".35" : "1";
  btnRefresh.disabled    = locked;
}

function onStarted() {
  isRecording = true;
  sampleCount = 0;
  btnStart.style.display = "none";
  btnStop.style.display  = "";
  btnStop.disabled       = false;
  dot.classList.add("live");
  setStatus("● LIVE", "live");
  lockControls(true);

  const q   = QUALITIES.find(x => x.id === selectedQ);
  const tab = tabs.find(t => t.id === selectedTab);
  riTab.textContent = (tab?.title || tab?.url || "—").slice(0, 28);
  riQ.textContent   = q?.desc || "—";
  riSamples.textContent = "0";
  recInfo.classList.add("show");

  startTimer();
}

function onDone() {
  isRecording = false;
  btnStop.style.display  = "none";
  btnStart.style.display = "";
  btnStart.disabled      = false;
  dot.classList.remove("live");
  setStatus("SAVED ✓", "done");
  lockControls(false);
  recInfo.classList.remove("show");
  stopTimer();
  setTimeout(() => { if (!isRecording) setStatus("READY", ""); }, 3000);
}

function onError(msg) {
  isRecording = false;
  btnStop.style.display  = "none";
  btnStart.style.display = "";
  btnStart.disabled      = false;
  dot.classList.remove("live");
  setStatus("ERR: " + (msg || "unknown").slice(0, 30), "err");
  lockControls(false);
  recInfo.classList.remove("show");
  stopTimer();
}

// ── Buttons ───────────────────────────────────────────────────
btnStart.addEventListener("click", () => {
  if (!selectedTab) { setStatus("SELECT A TAB", "err"); return; }
  const q = QUALITIES.find(x => x.id === selectedQ) || QUALITIES[1];
  btnStart.disabled = true;
  setStatus("STARTING…", "");
  bgSend({ type: "START", tabId: selectedTab, quality: { width: q.width, height: q.height, bitrate: q.bitrate } });
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
