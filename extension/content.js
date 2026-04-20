// ============================================================
//  content.js
// ============================================================

let localSamples  = [];
let localEvents   = [];
let recording     = false;
let startTime     = 0;
let globalOffset  = 0;

let screenStream   = null;
let screenRecorder = null;
let screenChunks   = [];

let lastX          = -1;   // -1 = no mouse position yet
let lastY          = -1;
let lastSampleTime = 0;
let recentSamples  = [];

let scrollAccum  = 0;
let lastScrollY  = window.scrollY;
let sampleInterval = null;

// ── Safe send ─────────────────────────────────────────────────
function safeSend(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
  } catch (_) {}
}

// ── Element chain ─────────────────────────────────────────────
// Depth 15 — React/GitHub apps nest 12+ levels before the card.
// Clamp coordinates first: elementFromPoint returns null for
// coordinates outside [0, innerWidth) × [0, innerHeight).
function getElementChain(rawX, rawY) {
  // Clamp to viewport — this is the critical fix for x > 1.0 bug.
  // When the floating window or side panel resizes the viewport AFTER
  // lastX was set, rawX can exceed window.innerWidth.
  const x = Math.max(0, Math.min(rawX, window.innerWidth  - 1));
  const y = Math.max(0, Math.min(rawY, window.innerHeight - 1));

  const el = document.elementFromPoint(x, y);
  if (!el) return [];

  const chain   = [];
  let   current = el;
  let   depth   = 0;

  while (current && current !== document.documentElement && depth < 15) {
    const rect = current.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      chain.push({
        tag:  (current.tagName || "").toUpperCase(),
        role: current.getAttribute("role") || null,
        cls:  current.className
                ? String(current.className).trim().split(/\s+/).slice(0, 6)
                : [],
        textLength: (current.innerText || "").trim().length,
        boundingBox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        }
      });
    }
    current = current.parentElement;
    depth++;
  }

  return chain;
}

// ── Sampling ──────────────────────────────────────────────────
function sample() {
  if (!recording) return;

  // Skip if we have no mouse position yet
  if (lastX < 0) return;

  const now  = performance.now();
  const time = globalOffset + (now - startTime);

  // Normalised, clamped to [0,1]
  const nx = Math.max(0, Math.min(1, lastX / window.innerWidth));
  const ny = Math.max(0, Math.min(1, lastY / window.innerHeight));

  const chain = getElementChain(lastX, lastY);

  const dt   = lastSampleTime > 0 ? now - lastSampleTime : 0;
  const prev = recentSamples.at(-1);
  const dx   = prev ? lastX - prev.rawX : 0;
  const dy   = prev ? lastY - prev.rawY : 0;
  const vel  = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

  const s = {
    time,
    x:            nx,
    y:            ny,
    rawX:         lastX,
    rawY:         lastY,
    velocity:     vel,
    elementChain: chain,
    scrollDelta:  scrollAccum
  };

  scrollAccum    = 0;
  lastSampleTime = now;

  recentSamples.push(s);
  if (recentSamples.length > 30) recentSamples.shift();

  localSamples.push(s);
  safeSend({ type: "sample", data: s });
}

// ── DOM listeners ─────────────────────────────────────────────
document.addEventListener("mousemove", (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
}, { passive: true });

document.addEventListener("scroll", () => {
  if (!recording) return;
  const y     = window.scrollY;
  scrollAccum += y - lastScrollY;
  lastScrollY  = y;
}, { passive: true });

document.addEventListener("click", (e) => {
  if (!recording) return;
  const chain = getElementChain(e.clientX, e.clientY);
  const ev = {
    type:         "click",
    time:         globalOffset + (performance.now() - startTime),
    x:            Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
    y:            Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
    elementChain: chain,
    context:      recentSamples.slice(-6)
  };
  localEvents.push(ev);
  safeSend({ type: "event", data: ev });
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  const ev = {
    type:       "keydown",
    time:       globalOffset + (performance.now() - startTime),
    keyType:    e.key.length === 1 ? "char"
              : e.key === "Enter"     ? "enter"
              : e.key === "Backspace" ? "backspace"
              : e.key === "Tab"       ? "tab"
              : "other",
    isModifier: e.ctrlKey || e.altKey || e.metaKey
  };
  localEvents.push(ev);
  safeSend({ type: "event", data: ev });
}, { passive: true });

document.addEventListener("focusin", (e) => {
  if (!recording) return;
  const chain = getElementChain(e.target.getBoundingClientRect().left + 4, e.target.getBoundingClientRect().top + 4);
  const ev = {
    type:         "focus",
    time:         globalOffset + (performance.now() - startTime),
    elementChain: chain
  };
  localEvents.push(ev);
  safeSend({ type: "event", data: ev });
}, { passive: true });

// ── Blob → data URL ───────────────────────────────────────────
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

function startSampling() {
  if (sampleInterval) clearInterval(sampleInterval);
  lastSampleTime = performance.now();
  sampleInterval = setInterval(sample, 50);
}

// ── Message listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {

  // ──────────── START ───────────────────────────────────────
  if (msg.type === "START") {
    const quality = msg.quality || { width: 1280, height: 720, bitrate: 4_000_000 };

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:     { ideal: quality.width },
          height:    { ideal: quality.height },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
    } catch (_) {
      safeSend({ type: "CONTENT_ERROR", message: "Screen capture cancelled or denied." });
      return;
    }

    if (!screenStream?.getTracks().length) {
      safeSend({ type: "CONTENT_ERROR", message: "No screen source selected." });
      return;
    }

    screenStream.getTracks()[0].onended = () => {
      if (recording) safeSend({ type: "STOP" });
    };

    localSamples  = [];
    localEvents   = [];
    screenChunks  = [];
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    globalOffset  = 0;
    lastX         = -1;
    lastY         = -1;

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9" : "video/webm";

    screenRecorder = new MediaRecorder(screenStream, {
      mimeType: mime, videoBitsPerSecond: quality.bitrate
    });
    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };
    screenRecorder.start(1000);

    startTime = performance.now();
    recording = true;
    startSampling();

    safeSend({
      type: "RECORDING_STARTED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight } }
    });
  }

  // ──────────── RESUME (after page navigation) ──────────────
  else if (msg.type === "RESUME") {
    // Pick up from where background's data left off
    globalOffset  = msg.startedAt || 0;
    localSamples  = [];
    localEvents   = [];
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    lastX         = -1;
    lastY         = -1;
    startTime     = performance.now();
    recording     = true;
    startSampling();

    safeSend({
      type: "RECORDING_RESUMED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight } }
    });
  }

  // ──────────── STOP ────────────────────────────────────────
  // IMPORTANT: do NOT bail on !recording here.
  // After navigation, this page's recording flag may be false
  // but it still needs to process the stop and generate the script.
  else if (msg.type === "STOP") {
    const wasRecording = recording;
    recording = false;

    if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }

    // Use background's accumulated data — it has everything across
    // all page loads. Fall back to local only if background sent nothing.
    const bgSamples = msg.accumulated?.samples || [];
    const bgEvents  = msg.accumulated?.events  || [];
    const bgVP      = msg.accumulated?.viewport;

    const finalSamples = bgSamples.length ? bgSamples : localSamples;
    const finalEvents  = bgEvents.length  ? bgEvents  : localEvents;
    const finalVP      = bgVP || { width: window.innerWidth, height: window.innerHeight };

    const inputData = {
      samples: finalSamples,
      events:  finalEvents,
      meta:    { viewport: finalVP }
    };

    const script      = generateScript(inputData);
    const debugReport = generateDebugReport(inputData, script);

    // Handle video — may not have a recorder if this is a resumed page
    let screenDataUrl = null;
    if (wasRecording && screenRecorder && screenRecorder.state !== "inactive") {
      await new Promise(res => { screenRecorder.onstop = res; screenRecorder.stop(); });
    }
    if (screenChunks.length) {
      screenDataUrl = await blobToDataURL(new Blob(screenChunks, { type: "video/webm" }));
    }

    safeSend({ type: "FINAL_DATA", data: { screenDataUrl, script } });
    safeSend({ type: "DEBUG_DATA", data: debugReport });

    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;

    console.log(
      `[Recorder] Done — ${finalSamples.length} samples, ${finalEvents.length} events, ${script.length} keyframes`
    );
  }
});
