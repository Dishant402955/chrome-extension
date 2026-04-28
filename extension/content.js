// ============================================================
//  content.js — interaction logger only, zero recording
// ============================================================

let recording      = false;
let startTime      = 0;
let globalOffset   = 0;   // ms carried over from previous pages

let lastX          = -1;
let lastY          = -1;
let lastSampleTime = 0;
let recentSamples  = [];
let scrollAccum    = 0;
let lastScrollY    = window.scrollY;
let sampleInterval = null;

// ── Safe send ─────────────────────────────────────────────────
function safeSend(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
  } catch (_) {}
}

// ── Element chain (depth 15, clamped coords) ──────────────────
function getElementChain(rawX, rawY) {
  const x  = Math.max(0, Math.min(rawX, window.innerWidth  - 1));
  const y  = Math.max(0, Math.min(rawY, window.innerHeight - 1));
  const el = document.elementFromPoint(x, y);
  if (!el) return [];

  const chain   = [];
  let   current = el;
  let   depth   = 0;

  while (current && current !== document.documentElement && depth < 15) {
    const r = current.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      chain.push({
        tag: current.tagName.toUpperCase(),
        boundingBox: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height)
        }
      });
    }
    current = current.parentElement;
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

  const dt  = lastSampleTime > 0 ? now - lastSampleTime : 0;
  const prev = recentSamples.at(-1);
  const dx  = prev ? lastX - prev.rawX : 0;
  const dy  = prev ? lastY - prev.rawY : 0;
  const vel = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

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
  safeSend({
    type: "event",
    data: {
      type:         "click",
      time:         globalOffset + (performance.now() - startTime),
      x:            Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
      y:            Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
      rawX:         e.clientX,
      rawY:         e.clientY,
      elementChain: getElementChain(e.clientX, e.clientY)
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  safeSend({
    type: "event",
    data: {
      type:       "keydown",
      time:       globalOffset + (performance.now() - startTime),
      keyType:    e.key.length === 1 ? "char"
                : e.key === "Enter"     ? "enter"
                : e.key === "Backspace" ? "backspace"
                : e.key === "Tab"       ? "tab"
                : "other",
      isModifier: e.ctrlKey || e.altKey || e.metaKey
    }
  });
}, { passive: true });

document.addEventListener("focusin", (e) => {
  if (!recording) return;
  const r = e.target.getBoundingClientRect();
  safeSend({
    type: "event",
    data: {
      type:         "focus",
      time:         globalOffset + (performance.now() - startTime),
      elementChain: getElementChain(r.left + 4, r.top + 4)
    }
  });
}, { passive: true });

// ── Start / stop ──────────────────────────────────────────────
function startSampling() {
  if (sampleInterval) clearInterval(sampleInterval);
  lastSampleTime = performance.now();
  sampleInterval = setInterval(sample, 50);
}

chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === "START") {
    globalOffset  = 0;
    lastX         = -1;
    lastY         = -1;
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;
    startTime     = performance.now();
    recording     = true;
    startSampling();
    safeSend({
      type: "RECORDING_STARTED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight } }
    });
  }

  else if (msg.type === "RESUME") {
    globalOffset  = msg.startedAt || 0;
    lastX         = -1;
    lastY         = -1;
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

  else if (msg.type === "STOP") {
    recording = false;
    if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }
    safeSend({ type: "STOPPED" });
  }
});
