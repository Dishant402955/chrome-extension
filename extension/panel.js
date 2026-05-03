const QUALITIES = [
  { id:"hi",  label:"HIGH", desc:"1080p·8M",  width:1920, height:1080, bitrate:8_000_000 },
  { id:"med", label:"MED",  desc:"720p·4M",   width:1280, height:720,  bitrate:4_000_000 },
  { id:"lo",  label:"LOW",  desc:"480p·2M",   width:854,  height:480,  bitrate:2_000_000 },
];

let stopTimeout = null;

let selectedQ   = "med";
let isRecording = false;
let timerRef    = null;
let timerStart  = 0;

const dot       = document.getElementById("dot");
const qualList  = document.getElementById("qualList");
const btnStart  = document.getElementById("btnStart");
const btnStop   = document.getElementById("btnStop");
const statusEl  = document.getElementById("statusEl");
const timerEl   = document.getElementById("timerEl");
const statsEl   = document.getElementById("stats");
const stSamples = document.getElementById("stSamples");
const stWebcam  = document.getElementById("stWebcam");

const port = chrome.runtime.connect({ name: "recorder-panel" });
port.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STARTED") onStarted(msg.hasWebcam);
  if (msg.type === "LOGGING_STARTED")   setStatus("● REC + LOGGING", "live");
  if (msg.type === "RECORDING_DONE")    onDone(msg.sampleCount);
  if (msg.type === "ERROR")             onError(msg.message);
  if (msg.type === "TICK")              stSamples.textContent = msg.count;
});

function bgSend(msg) { chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; }); }

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

function onStarted(hasWebcam) {
  isRecording = true;
  btnStart.style.display = "none"; btnStop.style.display = ""; btnStop.disabled = false;
  dot.classList.add("live");
  // Show "waiting for tab selection" until LOGGING_STARTED
  setStatus("● PICK A TAB IN PICKER…", "live");
  qualList.style.opacity = ".35";
  stSamples.textContent  = "0";
  stWebcam.textContent   = hasWebcam ? "YES" : "NO (no camera)";
  statsEl.classList.add("show");
  startTimer();
  setTimeout(() => {
    chrome.windows.getCurrent((win) => { if (win) chrome.windows.update(win.id, { state: "minimized" }); });
  }, 800);
}

function onDone(count) {
  isRecording = false;
  btnStop.style.display = "none"; btnStart.style.display = ""; btnStart.disabled = false;
  dot.classList.remove("live");
  setStatus(`SAVED — ${count ?? "?"} samples`, "done");
  qualList.style.opacity = "1"; statsEl.classList.remove("show"); stopTimer();
  setTimeout(() => { if (!isRecording) setStatus("READY", ""); }, 4000);
}

function onError(msg) {
  isRecording = false;
  btnStop.style.display = "none"; btnStart.style.display = ""; btnStart.disabled = false;
  dot.classList.remove("live"); setStatus("ERR: " + (msg||"").slice(0,30), "err");
  qualList.style.opacity = "1"; statsEl.classList.remove("show"); stopTimer();
}

btnStart.addEventListener("click", () => {
  const q = QUALITIES.find(x => x.id === selectedQ) || QUALITIES[1];
  btnStart.disabled = true; setStatus("STARTING…", "");
  bgSend({ type: "START", quality: { width: q.width, height: q.height, bitrate: q.bitrate } });
});

btnStop.addEventListener("click", () => {
  btnStop.disabled = true;
  setStatus("SAVING…", "");

  bgSend({ type: "STOP" });

  clearTimeout(stopTimeout);
  stopTimeout = setTimeout(() => {
    if (isRecording) {
      onError("Timeout — no response");
    }
  }, 9000);
});

renderQualities();
setStatus("READY", "");
