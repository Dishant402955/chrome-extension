// ============================================================
//  content.js
//
//  Single-tab design. This content script handles BOTH:
//    - Screen recording (getDisplayMedia with preferCurrentTab)
//    - Interaction logging (mousemove samples + DOM events)
//
//  Both start at the same performance.now() anchor so log
//  timestamps are perfectly aligned with video timestamps.
//  No two-tab complexity, no timer throttle risk.
// ============================================================

let recording      = false;
let recStartTime   = 0;       // performance.now() when recorder.start() fires

let screenStream   = null;
let webcamStream   = null;
let screenRecorder = null;
let webcamRecorder = null;
let screenChunks   = [];
let webcamChunks   = [];
let hasWebcam      = false;

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

// ── Time helper ───────────────────────────────────────────────
// All times are relative to recStartTime so they match video time exactly.
function now() {
  return performance.now() - recStartTime;
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

  const t     = now();
  const chain = getElementChain(lastX, lastY);
  const dt    = lastSampleTime > 0 ? performance.now() - (recStartTime + lastSampleTime) : 0;
  const prev  = recentSamples.at(-1);
  const dx    = prev ? lastX - prev.rawX : 0;
  const dy    = prev ? lastY - prev.rawY : 0;
  const vel   = dt > 0 ? Math.sqrt(dx*dx + dy*dy) / dt : 0;

  const s = {
    time:         t,
    x:            Math.max(0, Math.min(1, lastX / window.innerWidth)),
    y:            Math.max(0, Math.min(1, lastY / window.innerHeight)),
    rawX:         lastX,
    rawY:         lastY,
    velocity:     vel,
    scrollDelta:  scrollAccum,
    elementChain: chain
  };

  scrollAccum    = 0;
  lastSampleTime = t;

  recentSamples.push(s);
  if (recentSamples.length > 20) recentSamples.shift();

  safeSend({ type: "sample", data: s });
}

// ── DOM listeners ─────────────────────────────────────────────
document.addEventListener("mousemove", (e) => {
  lastX = e.clientX; lastY = e.clientY;
}, { passive: true });

document.addEventListener("scroll", () => {
  if (!recording) return;
  const y = window.scrollY; scrollAccum += y - lastScrollY; lastScrollY = y;
}, { passive: true });

document.addEventListener("click", (e) => {
  if (!recording) return;
  safeSend({ type: "event", data: {
    type: "click", time: now(),
    x: Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
    y: Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
    elementChain: getElementChain(e.clientX, e.clientY)
  }});
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  safeSend({ type: "event", data: {
    type: "keydown", time: now(),
    keyType: e.key.length === 1 ? "char" : e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : e.key === "Tab" ? "tab" : "other",
    isModifier: e.ctrlKey || e.altKey || e.metaKey
  }});
}, { passive: true });

document.addEventListener("focusin", (e) => {
  if (!recording) return;
  const r = e.target.getBoundingClientRect();
  safeSend({ type: "event", data: {
    type: "focus", time: now(),
    elementChain: getElementChain(r.left + 4, r.top + 4)
  }});
}, { passive: true });

// ── Blob helper ───────────────────────────────────────────────
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

// ── Message listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {

  // ────────── START ─────────────────────────────────────────
  if (msg.type === "START") {
    const quality = msg.quality || { width: 1280, height: 720, bitrate: 4_000_000 };

    // preferCurrentTab: shows "Share this tab?" instead of the full
    // system picker. The user just clicks Share — no tab selection needed.
    // This guarantees recording and logging are always on the same tab.
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:        { ideal: quality.width },
          height:       { ideal: quality.height },
          frameRate:    { ideal: 30 },
          displaySurface: "browser"   // prefer tab capture surface
        },
        audio:          false,
        preferCurrentTab: true        // Chrome 94+ — show "Share this tab?"
      });
    } catch (err) {
      safeSend({ type: "CONTENT_ERROR", message: "Screen capture cancelled or denied." });
      return;
    }

    if (!stream?.getTracks().length) {
      safeSend({ type: "CONTENT_ERROR", message: "No screen source selected." });
      return;
    }

    // ── Anchor all timestamps to this exact moment ─────────
    // recStartTime is set NOW — after picker resolves, before
    // recorder.start(). Every sample and event time is
    // `performance.now() - recStartTime`, so t=0 = first frame
    // of the video. Perfect alignment guaranteed.
    recStartTime = performance.now();

    screenStream = stream;
    screenChunks = [];
    webcamChunks = [];

    // Optional webcam
    hasWebcam = false;
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      hasWebcam    = true;
    } catch (_) { webcamStream = null; }

    // If the user ends sharing via the browser UI indicator
    screenStream.getTracks()[0].onended = () => {
      if (recording) safeSend({ type: "CONTENT_ERROR", message: "Screen share ended." });
    };

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9" : "video/webm";

    screenRecorder = new MediaRecorder(screenStream, { mimeType: mime, videoBitsPerSecond: quality.bitrate });
    screenRecorder.ondataavailable = (e) => { if (e.data.size > 0) screenChunks.push(e.data); };
    screenRecorder.start(1000);

    if (hasWebcam) {
      webcamRecorder = new MediaRecorder(webcamStream, { mimeType: mime });
      webcamRecorder.ondataavailable = (e) => { if (e.data.size > 0) webcamChunks.push(e.data); };
      webcamRecorder.start(1000);
    }

    // ── Start logging at the same anchor ──────────────────
    lastX         = -1;
    lastY         = -1;
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    lastSampleTime = 0;
    recording     = true;

    if (sampleInterval) clearInterval(sampleInterval);
    sampleInterval = setInterval(sample, 50);

    safeSend({
      type: "RECORDING_STARTED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight }, hasWebcam }
    });
  }

  // ────────── STOP ─────────────────────────────────────────
  else if (msg.type === "STOP") {
    if (!recording) return;
    recording = false;

    if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }

    // Stop recorders
    if (screenRecorder && screenRecorder.state !== "inactive") {
      await new Promise(res => { screenRecorder.onstop = res; screenRecorder.stop(); });
    }
    if (hasWebcam && webcamRecorder && webcamRecorder.state !== "inactive") {
      await new Promise(res => { webcamRecorder.onstop = res; webcamRecorder.stop(); });
    }

    const screenDataUrl = screenChunks.length
      ? await blobToDataURL(new Blob(screenChunks, { type: "video/webm" })) : null;
    const webcamDataUrl = webcamChunks.length
      ? await blobToDataURL(new Blob(webcamChunks, { type: "video/webm" })) : null;

    screenStream?.getTracks().forEach(t => t.stop());
    webcamStream?.getTracks().forEach(t => t.stop());
    screenStream = null; webcamStream = null;

    // Use background's accumulated data — it has all samples
    // sent via safeSend during recording (reliable store)
    const bgSamples = msg.accumulated?.samples || [];
    const bgEvents  = msg.accumulated?.events  || [];

    // durationMs = time of last sample.
    // Since samples start at t≈0 and stop when recording stops,
    // this is a faithful measure of actual recording duration.
    const lastTime = bgSamples.length ? bgSamples[bgSamples.length - 1].time : 0;

    safeSend({
      type: "FINAL_DATA",
      data: {
        screenDataUrl,
        webcamDataUrl,
        hasWebcam,
        log: {
          viewport:    { width: window.innerWidth, height: window.innerHeight },
          sampleCount: bgSamples.length,
          eventCount:  bgEvents.length,
          durationMs:  lastTime,
          samples:     bgSamples,
          events:      bgEvents
        }
      }
    });
  }
});