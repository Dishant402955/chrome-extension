// ============================================================
//  content.js — interaction logger + screen/webcam recorder
// ============================================================

let recording      = false;
let startTime      = 0;
let globalOffset   = 0;

let lastX          = -1;
let lastY          = -1;
let lastSampleTime = 0;
let recentSamples  = [];
let scrollAccum    = 0;
let lastScrollY    = window.scrollY;
let sampleInterval = null;

// recording
let screenStream   = null;
let webcamStream   = null;
let screenRecorder = null;
let webcamRecorder = null;
let screenChunks   = [];
let webcamChunks   = [];
let hasWebcam      = false;

function safeSend(msg) {
  try { chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; }); }
  catch (_) {}
}

// ── Element chain (depth 15, clamped) ─────────────────────────
function getElementChain(rawX, rawY) {
  const x  = Math.max(0, Math.min(rawX, window.innerWidth  - 1));
  const y  = Math.max(0, Math.min(rawY, window.innerHeight - 1));
  const el = document.elementFromPoint(x, y);
  if (!el) return [];

  const chain = [];
  let cur = el, depth = 0;
  while (cur && cur !== document.documentElement && depth < 15) {
    const r = cur.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      chain.push({
        tag: cur.tagName.toUpperCase(),
        boundingBox: {
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height)
        }
      });
    }
    cur = cur.parentElement;
    depth++;
  }
  return chain;
}

// ── Sample loop ───────────────────────────────────────────────
function sample() {
  if (!recording || lastX < 0) return;

  const now  = performance.now();
  const time = globalOffset + (now - startTime);

  const chain = getElementChain(lastX, lastY);
  const dt    = lastSampleTime > 0 ? now - lastSampleTime : 0;
  const prev  = recentSamples.at(-1);
  const dx    = prev ? lastX - prev.rawX : 0;
  const dy    = prev ? lastY - prev.rawY : 0;
  const vel   = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

  const s = {
    time,
    x:            Math.max(0, Math.min(1, lastX / window.innerWidth)),
    y:            Math.max(0, Math.min(1, lastY / window.innerHeight)),
    rawX:         lastX,
    rawY:         lastY,
    velocity:     vel,
    scrollDelta:  scrollAccum,
    elementChain: chain
  };

  scrollAccum    = 0;
  lastSampleTime = now;
  recentSamples.push(s);
  if (recentSamples.length > 20) recentSamples.shift();

  safeSend({ type: "sample", data: s });
}

// ── DOM listeners ─────────────────────────────────────────────
document.addEventListener("mousemove", (e) => { lastX = e.clientX; lastY = e.clientY; }, { passive: true });

document.addEventListener("scroll", () => {
  if (!recording) return;
  const y = window.scrollY;
  scrollAccum += y - lastScrollY;
  lastScrollY  = y;
}, { passive: true });

document.addEventListener("click", (e) => {
  if (!recording) return;
  safeSend({ type: "event", data: {
    type: "click",
    time: globalOffset + (performance.now() - startTime),
    x:    Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
    y:    Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
    elementChain: getElementChain(e.clientX, e.clientY)
  }});
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  safeSend({ type: "event", data: {
    type:       "keydown",
    time:       globalOffset + (performance.now() - startTime),
    keyType:    e.key.length === 1 ? "char" : e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : e.key === "Tab" ? "tab" : "other",
    isModifier: e.ctrlKey || e.altKey || e.metaKey
  }});
}, { passive: true });

document.addEventListener("focusin", (e) => {
  if (!recording) return;
  const r = e.target.getBoundingClientRect();
  safeSend({ type: "event", data: {
    type: "focus",
    time: globalOffset + (performance.now() - startTime),
    elementChain: getElementChain(r.left + 4, r.top + 4)
  }});
}, { passive: true });

// ── Helpers ───────────────────────────────────────────────────
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

function startSampling() {
  if (sampleInterval) clearInterval(sampleInterval);
  lastSampleTime = performance.now();
  sampleInterval = setInterval(sample, 50);
}

function stopSampling() {
  if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }
}

// ── Message listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {

  // ──────────── START ───────────────────────────────────────
  if (msg.type === "START") {
    const quality = msg.quality || { width: 1280, height: 720, bitrate: 4_000_000 };

    // Screen capture
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: 30 } },
        audio: false
      });
    } catch (_) {
      safeSend({ type: "CONTENT_ERROR", message: "Screen capture cancelled." });
      return;
    }

    if (!screenStream?.getTracks().length) {
      safeSend({ type: "CONTENT_ERROR", message: "No screen source selected." });
      return;
    }

    // Webcam — optional, silently skipped if not available
    hasWebcam = false;
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      hasWebcam    = true;
    } catch (_) {
      webcamStream = null;
    }

    // Stop if user closes the share picker via browser UI
    screenStream.getTracks()[0].onended = () => { if (recording) safeSend({ type: "STOP" }); };

    // Reset state
    globalOffset  = 0;
    lastX = -1; lastY = -1;
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    screenChunks  = [];
    webcamChunks  = [];

    // Screen recorder
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";

    screenRecorder = new MediaRecorder(screenStream, { mimeType: mime, videoBitsPerSecond: quality.bitrate });
    screenRecorder.ondataavailable = (e) => { if (e.data.size > 0) screenChunks.push(e.data); };
    screenRecorder.start(1000);

    // Webcam recorder
    if (hasWebcam) {
      webcamRecorder = new MediaRecorder(webcamStream, { mimeType: mime });
      webcamRecorder.ondataavailable = (e) => { if (e.data.size > 0) webcamChunks.push(e.data); };
      webcamRecorder.start(1000);
    }

    startTime = performance.now();
    recording = true;
    startSampling();

    safeSend({
      type: "RECORDING_STARTED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight }, hasWebcam }
    });
  }

  // ──────────── RESUME (after page navigation) ──────────────
  else if (msg.type === "RESUME") {
    // Can't resume screen capture after navigation — just resume data collection
    globalOffset  = msg.startedAt || 0;
    lastX = -1; lastY = -1;
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    startTime     = performance.now();
    recording     = true;
    startSampling();
    safeSend({ type: "RECORDING_RESUMED", data: { viewport: { width: window.innerWidth, height: window.innerHeight } } });
  }

  // ──────────── STOP ────────────────────────────────────────
  else if (msg.type === "STOP") {
    const wasRecording = recording;
    recording = false;
    stopSampling();

    // Use background's accumulated data (cross-navigation)
    const bgSamples = msg.accumulated?.samples || [];
    const bgEvents  = msg.accumulated?.events  || [];
    const bgVP      = msg.accumulated?.viewport;
    const finalVP   = bgVP || { width: window.innerWidth, height: window.innerHeight };

    // Stop recorders
    let screenDataUrl = null;
    let webcamDataUrl = null;

    if (wasRecording && screenRecorder && screenRecorder.state !== "inactive") {
      await new Promise(res => { screenRecorder.onstop = res; screenRecorder.stop(); });
    }
    if (wasRecording && hasWebcam && webcamRecorder && webcamRecorder.state !== "inactive") {
      await new Promise(res => { webcamRecorder.onstop = res; webcamRecorder.stop(); });
    }

    if (screenChunks.length) {
      screenDataUrl = await blobToDataURL(new Blob(screenChunks, { type: "video/webm" }));
    }
    if (webcamChunks.length) {
      webcamDataUrl = await blobToDataURL(new Blob(webcamChunks, { type: "video/webm" }));
    }

    // Release tracks
    screenStream?.getTracks().forEach(t => t.stop());
    webcamStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    webcamStream = null;

    safeSend({
      type: "FINAL_DATA",
      data: {
        screenDataUrl,
        webcamDataUrl,
        hasWebcam,
        log: {
          viewport:    finalVP,
          sampleCount: (bgSamples.length || msg.accumulated?.samples?.length || 0),
          eventCount:  (bgEvents.length  || msg.accumulated?.events?.length  || 0),
          durationMs:  bgSamples.length > 1 ? bgSamples[bgSamples.length - 1].time - bgSamples[0].time : 0,
          samples:     bgSamples,
          events:      bgEvents
        }
      }
    });
  }
});
