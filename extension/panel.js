const QUALITIES = [
  { id:"hi",  label:"HIGH", desc:"1080p·8M",  width:1920, height:1080, bitrate:8_000_000 },
  { id:"med", label:"MED",  desc:"720p·4M",   width:1280, height:720,  bitrate:4_000_000 },
  { id:"lo",  label:"LOW",  desc:"480p·2M",   width:854,  height:480,  bitrate:2_000_000 },
];

let selectedTab = null, selectedQ = "med";
let isRecording = false;
let timerRef = null, timerStart = 0;
let tabs = [];

const dot       = document.getElementById("dot");
const tabList   = document.getElementById("tabList");
const qualList  = document.getElementById("qualList");
const btnStart  = document.getElementById("btnStart");
const btnStop   = document.getElementById("btnStop");
const statusEl  = document.getElementById("statusEl");
const timerEl   = document.getElementById("timerEl");
const statsEl   = document.getElementById("stats");
const stTab     = document.getElementById("stTab");
const stSamples = document.getElementById("stSamples");
const stWebcam  = document.getElementById("stWebcam");
const btnRefresh = document.getElementById("btnRefresh");

const port = chrome.runtime.connect({ name: "recorder-panel" });
port.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") onStarted(msg.hasWebcam);
  if (msg.type === "RECORDING_DONE")    onDone(msg.sampleCount, msg.hasWebcam);
  if (msg.type === "ERROR")             onError(msg.message);
  if (msg.type === "TICK") { stSamples.textContent = msg.count; }
});

function bgSend(msg) { chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; }); }

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

function renderQualities() {
  qualList.innerHTML = "";
  for (const q of QUALITIES) {
    const el = document.createElement("div");
    el.className = "qual" + (q.id === selectedQ ? " sel" : "");
    el.innerHTML = `<div class="qual-name">${q.label}</div><div class="qual-desc">${q.desc}</div>`;
    el.addEventListener("click", () => { if (isRecording) return; selectedQ = q.id; renderQualities(); });
    qualList.appendChild(el);
  }
}

function startTimer() {
  timerStart = Date.now();
  timerRef = setInterval(() => {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    timerEl.textContent = `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  }, 500);
}
function stopTimer() { clearInterval(timerRef); timerRef = null; timerEl.textContent = ""; }

function setStatus(t, c) { statusEl.textContent = t; statusEl.className = "status" + (c ? " "+c : ""); }
function lock(v) { tabList.style.opacity = v ? ".35" : "1"; qualList.style.opacity = v ? ".35" : "1"; btnRefresh.disabled = v; }

function onStarted(hasWebcam) {
  isRecording = true;
  btnStart.style.display = "none"; btnStop.style.display = ""; btnStop.disabled = false;
  dot.classList.add("live"); setStatus("● RECORDING", "live"); lock(true);
  const tab = tabs.find(t => t.id === selectedTab);
  stTab.textContent     = (tab?.title || "—").slice(0, 22);
  stSamples.textContent = "0";
  stWebcam.textContent  = hasWebcam ? "YES" : "NO (skipped)";
  statsEl.classList.add("show");
  startTimer();
  setTimeout(() => {
    chrome.windows.getCurrent((win) => { if (win) chrome.windows.update(win.id, { state: "minimized" }); });
  }, 700);
}

function onDone(count, hasWebcam) {
  isRecording = false;
  btnStop.style.display = "none"; btnStart.style.display = ""; btnStart.disabled = false;
  dot.classList.remove("live");
  setStatus(`SAVED — ${count ?? "?"} samples`, "done");
  lock(false); statsEl.classList.remove("show"); stopTimer();
  setTimeout(() => { if (!isRecording) setStatus("READY", ""); }, 4000);
}

function onError(msg) {
  isRecording = false;
  btnStop.style.display = "none"; btnStart.style.display = ""; btnStart.disabled = false;
  dot.classList.remove("live"); setStatus("ERR: " + (msg||"").slice(0,28), "err");
  lock(false); statsEl.classList.remove("show"); stopTimer();
}

btnStart.addEventListener("click", () => {
  if (!selectedTab) { setStatus("SELECT A TAB", "err"); return; }
  const q = QUALITIES.find(x => x.id === selectedQ) || QUALITIES[1];
  btnStart.disabled = true; setStatus("STARTING…", "");
  bgSend({ type: "START", tabId: selectedTab, quality: { width: q.width, height: q.height, bitrate: q.bitrate } });
});

btnStop.addEventListener("click", () => { btnStop.disabled = true; setStatus("SAVING…", ""); bgSend({ type: "STOP" }); });
btnRefresh.addEventListener("click", () => { if (!isRecording) loadTabs(); });

loadTabs(); renderQualities(); setStatus("READY", "");
