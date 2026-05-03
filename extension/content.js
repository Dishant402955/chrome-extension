// ============================================================
//  content.js
//
//  Two independent roles — a tab gets one or both:
//
//  START_RECORD → call getDisplayMedia, run MediaRecorder
//                 do NOT collect interaction samples
//
//  START_LOG    → collect mouse/click/scroll/key samples
//                 do NOT touch any media streams
//
//  This separation means the tab that records the screen is
//  always the same tab the user picked in the picker, because
//  background only sends START_LOG after detecting which tab
//  became active post-picker (via chrome.tabs.onActivated).
// ============================================================

// ── Recording state ───────────────────────────────────────────
let screenStream   = null;
let webcamStream   = null;
let screenRecorder = null;
let webcamRecorder = null;
let screenChunks   = [];
let webcamChunks   = [];
let hasWebcam      = false;

// ── Logging state ─────────────────────────────────────────────
let logging        = false;
let logStartTime   = 0;
let globalOffset   = 0;
let lastX          = -1;
let lastY          = -1;
let lastSampleTime = 0;
let recentSamples  = [];
let scrollAccum    = 0;
let lastScrollY    = window.scrollY;
let sampleInterval = null;

// ── Safe send ─────────────────────────────────────────────────
function safeSend(msg) {
  try { chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; }); }
  catch (_) {}
}

// ── Element chain ─────────────────────────────────────────────
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
        boundingBox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
    cur = cur.parentElement;
    depth++;
  }
  return chain;
}

// ── Sample loop ───────────────────────────────────────────────
function sample() {
  if (!logging || lastX < 0) return;

  const now  = performance.now();
  const time = globalOffset + (now - logStartTime);

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

function startSampling() {
  if (sampleInterval) clearInterval(sampleInterval);
  lastSampleTime = performance.now();
  sampleInterval = setInterval(sample, 50);
}

function stopSampling() {
  if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }
}

// ── DOM listeners (always attached, guarded by logging flag) ──
document.addEventListener("mousemove", (e) => { lastX = e.clientX; lastY = e.clientY; }, { passive: true });

document.addEventListener("scroll", () => {
  if (!logging) return;
  const y = window.scrollY; scrollAccum += y - lastScrollY; lastScrollY = y;
}, { passive: true });

document.addEventListener("click", (e) => {
  if (!logging) return;
  safeSend({ type: "event", data: {
    type: "click",
    time: globalOffset + (performance.now() - logStartTime),
    x:    Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
    y:    Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
    elementChain: getElementChain(e.clientX, e.clientY)
  }});
});

document.addEventListener("keydown", (e) => {
  if (!logging) return;
  safeSend({ type: "event", data: {
    type:       "keydown",
    time:       globalOffset + (performance.now() - logStartTime),
    keyType:    e.key.length === 1 ? "char" : e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : e.key === "Tab" ? "tab" : "other",
    isModifier: e.ctrlKey || e.altKey || e.metaKey
  }});
}, { passive: true });

document.addEventListener("focusin", (e) => {
  if (!logging) return;
  const r = e.target.getBoundingClientRect();
  safeSend({ type: "event", data: {
    type: "focus",
    time: globalOffset + (performance.now() - logStartTime),
    elementChain: getElementChain(r.left + 4, r.top + 4)
  }});
}, { passive: true });

// ── Blob helper ───────────────────────────────────────────────
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

// ── Message listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {

  // ──────────── START_RECORD ────────────────────────────────
  // This tab handles screen + webcam capture only.
  // Interaction logging is handled by a different tab (START_LOG).
  if (msg.type === "START_RECORD") {
    const quality = msg.quality || { width: 1280, height: 720, bitrate: 4_000_000 };

    // getDisplayMedia — user picks which tab/window to capture.
    // Background listens for chrome.tabs.onActivated to detect
    // which tab the user picked, then sends START_LOG to it.
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: 30 } },
        audio: false
      });
    } catch (err) {
      safeSend({ type: "CONTENT_ERROR", message: "Screen capture cancelled or denied." });
      return;
    }

    if (!stream?.getTracks().length) {
      safeSend({ type: "CONTENT_ERROR", message: "No screen source selected." });
      return;
    }

    screenStream = stream;
    screenChunks = [];
    webcamChunks = [];

    // Optional webcam
    hasWebcam = false;
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      hasWebcam    = true;
    } catch (_) { webcamStream = null; }

    screenStream.getTracks()[0].onended = () => { safeSend({ type: "CONTENT_ERROR", message: "Screen share ended." }); };

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";

    screenRecorder = new MediaRecorder(screenStream, { mimeType: mime, videoBitsPerSecond: quality.bitrate });
    screenRecorder.ondataavailable = (e) => { if (e.data.size > 0) screenChunks.push(e.data); };
    screenRecorder.start(1000);

    if (hasWebcam) {
      webcamRecorder = new MediaRecorder(webcamStream, { mimeType: mime });
      webcamRecorder.ondataavailable = (e) => { if (e.data.size > 0) webcamChunks.push(e.data); };
      webcamRecorder.start(1000);
    }

    safeSend({
      type: "RECORDING_STARTED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight }, hasWebcam }
    });
  }

  // ──────────── START_LOG ───────────────────────────────────
  // This tab handles interaction logging only.
  // Called by background after it detects which tab was picked
  // in the getDisplayMedia picker (via onActivated).
  else if (msg.type === "START_LOG") {
    globalOffset   = 0;
    lastX          = -1;
    lastY          = -1;
    recentSamples  = [];
    scrollAccum    = 0;
    lastScrollY    = window.scrollY;
    logStartTime   = performance.now();
    logging        = true;
    startSampling();
    // Tell background our viewport (for script generation)
    safeSend({ type: "RECORDING_RESUMED", data: { viewport: { width: window.innerWidth, height: window.innerHeight } } });
  }

  // ──────────── RESUME_LOG (after navigation) ───────────────
  else if (msg.type === "RESUME_LOG") {
    globalOffset  = msg.startedAt || 0;
    lastX         = -1;
    lastY         = -1;
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    logStartTime  = performance.now();
    logging       = true;
    startSampling();
    safeSend({ type: "RECORDING_RESUMED", data: { viewport: { width: window.innerWidth, height: window.innerHeight } } });
  }

  // ──────────── STOP_LOG ────────────────────────────────────
  else if (msg.type === "STOP_LOG") {
    logging = false;
    stopSampling();
    // samples already sent to background in real-time — nothing to flush
  }

  // ──────────── STOP_RECORD ────────────────────────────────
  else if (msg.type === "STOP_RECORD") {
    // Stop recorders
    if (screenRecorder && screenRecorder.state !== "inactive") {
      await new Promise(res => { screenRecorder.onstop = res; screenRecorder.stop(); });
    }
    if (hasWebcam && webcamRecorder && webcamRecorder.state !== "inactive") {
      await new Promise(res => { webcamRecorder.onstop = res; webcamRecorder.stop(); });
    }

    const screenDataUrl = screenChunks.length
      ? await blobToDataURL(new Blob(screenChunks, { type: "video/webm" }))
      : null;
    const webcamDataUrl = webcamChunks.length
      ? await blobToDataURL(new Blob(webcamChunks, { type: "video/webm" }))
      : null;

    // Release tracks
    screenStream?.getTracks().forEach(t => t.stop());
    webcamStream?.getTracks().forEach(t => t.stop());
    screenStream = null; webcamStream = null;

    // Use background's accumulated data as the log
    const bgSamples = msg.accumulated?.samples || [];
    const bgEvents  = msg.accumulated?.events  || [];
    const bgVP      = msg.accumulated?.viewport;

    safeSend({
      type: "FINAL_DATA",
      data: {
        screenDataUrl,
        webcamDataUrl,
        hasWebcam,
        log: {
          viewport:    bgVP || { width: window.innerWidth, height: window.innerHeight },
          sampleCount: bgSamples.length,
          eventCount:  bgEvents.length,
          durationMs:  bgSamples.length > 1 ? bgSamples[bgSamples.length - 1].time - bgSamples[0].time : 0,
          samples:     bgSamples,
          events:      bgEvents
        }
      }
    });
  }
});
