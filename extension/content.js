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

let lastX          = 0;
let lastY          = 0;
let lastSampleTime = performance.now();
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
// Depth 15: GitHub / React / Material UI apps can have 12+ nesting
// levels before reaching the meaningful layout card.
// The generator uses this chain to find the "card" boundary,
// so shallow chains mean card detection always fails.
function getElementChain(el) {
  if (!el) return [];
  const chain   = [];
  let   current = el;
  let   depth   = 0;

  while (current && current !== document.documentElement && depth < 15) {
    const rect = current.getBoundingClientRect();

    // Include element even if off-screen — generator handles that.
    // Only skip truly invisible (0×0) elements.
    if (rect.width > 0 || rect.height > 0) {
      chain.push({
        tag:  (current.tagName || "").toUpperCase(),
        role: current.getAttribute("role") || null,
        // className as array of tokens (easier to read in debug)
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

  const now  = performance.now();
  const time = globalOffset + (now - startTime);

  const el    = document.elementFromPoint(lastX, lastY);
  const chain = getElementChain(el);

  const dt   = now - lastSampleTime;
  const prev = recentSamples.at(-1);
  const dx   = lastX - (prev?.rawX ?? lastX);
  const dy   = lastY - (prev?.rawY ?? lastY);
  const vel  = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

  const s = {
    time,
    x:            lastX / window.innerWidth,
    y:            lastY / window.innerHeight,
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
  const chain = getElementChain(document.elementFromPoint(e.clientX, e.clientY));
  const ev = {
    type:         "click",
    time:         globalOffset + (performance.now() - startTime),
    x:            e.clientX / window.innerWidth,
    y:            e.clientY / window.innerHeight,
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
  const chain = getElementChain(e.target);
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
        video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: 30 } },
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
    globalOffset  = msg.startedAt || 0;
    localSamples  = [];
    localEvents   = [];
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    startTime     = performance.now();
    recording     = true;
    startSampling();
    safeSend({
      type: "RECORDING_RESUMED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight } }
    });
  }

  // ──────────── STOP ────────────────────────────────────────
  else if (msg.type === "STOP") {
    if (!recording) return;

    recording = false;
    if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }

    // Use background's accumulated data (survives navigation)
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

    // Generate script
    const script = generateScript(inputData);

    // Generate debug report (separate function in generator.js)
    const debugReport = generateDebugReport(inputData, script);

    // Get video
    let screenDataUrl = null;
    if (screenRecorder && screenRecorder.state !== "inactive") {
      await new Promise(res => { screenRecorder.onstop = res; screenRecorder.stop(); });
    }
    if (screenChunks.length) {
      screenDataUrl = await blobToDataURL(new Blob(screenChunks, { type: "video/webm" }));
    }

    safeSend({ type: "FINAL_DATA",  data: { screenDataUrl, script } });
    safeSend({ type: "DEBUG_DATA",  data: debugReport });

    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;

    console.log(`[Recorder] Done — ${finalSamples.length} samples, ${finalEvents.length} events, ${script.length} keyframes`);
  }
});
