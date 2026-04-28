// ============================================================
//  panel.js
// ============================================================

let selectedTab = null;
let isRecording = false;
let timerRef    = null;
let timerStart  = 0;
let sampleCount = 0;
let eventCount  = 0;
let tabs        = [];

const dot       = document.getElementById("dot");
const tabList   = document.getElementById("tabList");
const btnStart  = document.getElementById("btnStart");
const btnStop   = document.getElementById("btnStop");
const statusEl  = document.getElementById("statusEl");
const timerEl   = document.getElementById("timerEl");
const statsEl   = document.getElementById("stats");
const stTab     = document.getElementById("stTab");
const stSamples = document.getElementById("stSamples");
const stEvents  = document.getElementById("stEvents");
const btnRefresh = document.getElementById("btnRefresh");
const hint      = document.getElementById("hint");

const port = chrome.runtime.connect({ name: "recorder-panel" });

port.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") onStarted();
  if (msg.type === "RECORDING_DONE")    onDone(msg.sampleCount);
  if (msg.type === "ERROR")             onError(msg.message);
  if (msg.type === "TICK") {
    sampleCount = msg.count || sampleCount + 1;
    stSamples.textContent = sampleCount;
  }
});

function bgSend(msg) {
  chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
}

// ── Tabs ──────────────────────────────────────────────────────
function loadTabs() {
  tabList.innerHTML = '<div class="tab-empty">Loading…</div>';
  chrome.tabs.query({}, (all) => {
    tabs = all.filter(t => t.url?.startsWith("http://") || t.url?.startsWith("https://"));
    if (!tabs.length) { tabList.innerHTML = '<div class="tab-empty">No capturable tabs.</div>'; return; }
    if (!selectedTab || !tabs.find(t => t.id === selectedTab)) selectedTab = tabs[0].id;
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
      fav = document.createElement("img"); fav.className = "tab-fav"; fav.src = t.favIconUrl;
      fav.onerror = () => fav.style.display = "none";
    } else {
      fav = document.createElement("div"); fav.className = "tab-fav-ph"; fav.textContent = "□";
    }
    const info = document.createElement("div"); info.className = "tab-info";
    const name = document.createElement("div"); name.className = "tab-name"; name.textContent = t.title || "(untitled)";
    const url  = document.createElement("div"); url.className  = "tab-url";
    try { url.textContent = new URL(t.url || "").hostname; } catch (_) { url.textContent = t.url || ""; }

    info.append(name, url); item.append(bar, fav, info);
    item.addEventListener("click", () => { if (isRecording) return; selectedTab = t.id; renderTabs(); });
    tabList.appendChild(item);
  }
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() {
  timerStart = Date.now();
  timerRef = setInterval(() => {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    timerEl.textContent = `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  }, 500);
}
function stopTimer() { clearInterval(timerRef); timerRef = null; timerEl.textContent = ""; }

function setStatus(t, c) { statusEl.textContent = t; statusEl.className = "status" + (c ? " "+c : ""); }

function onStarted() {
  isRecording = true; sampleCount = 0; eventCount = 0;
  btnStart.style.display = "none";
  btnStop.style.display  = "";
  btnStop.disabled       = false;
  dot.classList.add("live");
  setStatus("● LOGGING", "live");
  tabList.style.opacity = ".35";
  btnRefresh.disabled   = true;
  hint.style.display    = "none";

  const tab = tabs.find(t => t.id === selectedTab);
  stTab.textContent     = (tab?.title || "—").slice(0, 22);
  stSamples.textContent = "0";
  stEvents.textContent  = "0";
  statsEl.classList.add("show");

  startTimer();

  // Self-minimize so the recording tab stays focused (prevents timer throttle)
  setTimeout(() => {
    chrome.windows.getCurrent((win) => {
      if (win) chrome.windows.update(win.id, { state: "minimized" });
    });
  }, 700);
}

function onDone(count) {
  isRecording = false;
  btnStop.style.display  = "none";
  btnStart.style.display = "";
  btnStart.disabled      = false;
  dot.classList.remove("live");
  setStatus(`SAVED — ${count ?? sampleCount} samples`, "done");
  tabList.style.opacity = "1";
  btnRefresh.disabled   = false;
  statsEl.classList.remove("show");
  hint.style.display    = "";
  stopTimer();
  setTimeout(() => { if (!isRecording) setStatus("READY", ""); }, 4000);
}

function onError(msg) {
  isRecording = false;
  btnStop.style.display  = "none";
  btnStart.style.display = "";
  btnStart.disabled      = false;
  dot.classList.remove("live");
  setStatus("ERR: " + (msg || "").slice(0, 28), "err");
  tabList.style.opacity = "1";
  btnRefresh.disabled   = false;
  statsEl.classList.remove("show");
  hint.style.display    = "";
  stopTimer();
}

btnStart.addEventListener("click", () => {
  if (!selectedTab) { setStatus("SELECT A TAB", "err"); return; }
  btnStart.disabled = true;
  setStatus("STARTING…", "");
  bgSend({ type: "START", tabId: selectedTab });
});

btnStop.addEventListener("click", () => {
  btnStop.disabled = true;
  setStatus("SAVING…", "");
  bgSend({ type: "STOP" });
});

btnRefresh.addEventListener("click", () => { if (!isRecording) loadTabs(); });

loadTabs();
setStatus("READY", "");
