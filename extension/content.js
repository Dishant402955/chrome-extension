// ============================================================
//  content.js — Screen recorder + data collector
//  No webcam. Quality settings come from START message.
// ============================================================

let localSamples  = [];
let localEvents   = [];
let recording     = false;
let startTime     = 0;

let screenStream   = null;
let screenRecorder = null;
let screenChunks   = [];

// Mouse state
let lastX          = 0;
let lastY          = 0;
let lastSampleTime = performance.now();
let recentSamples  = [];

// Scroll accumulator (reset each sample tick)
let scrollAccum   = 0;
let lastScrollY   = window.scrollY;

// Sample interval handle
let sampleInterval = null;

// ── Safe send ─────────────────────────────────────────────────
function safeSend(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
  } catch (_) {}
}

// ── Element type (mirrors generator logic) ────────────────────
const TAG_TYPE_MAP = {
  input: "input", textarea: "input", select: "input",
  button: "interactive", a: "interactive",
  nav: "nav", menu: "nav", header: "nav",
  code: "code", pre: "code",
  main: "content", article: "content", section: "content", p: "content",
  form: "form", fieldset: "form",
  table: "table", thead: "table", tbody: "table", tr: "table", td: "table", th: "table",
  ul: "list", ol: "list", li: "list",
  img: "media", video: "media", canvas: "media", svg: "media",
  dialog: "modal", aside: "modal",
};

function getElementType(chain) {
  if (!chain?.length) return "unknown";
  for (const el of chain) {
    const tag = (el.tag || "").toLowerCase();
    if (TAG_TYPE_MAP[tag]) return TAG_TYPE_MAP[tag];
  }
  const first = chain[0];
  if (first?.textLength > 300) return "content";
  if (first?.textLength > 0 && first?.textLength < 80) return "label";
  return "generic";
}

// ── Element chain ─────────────────────────────────────────────
function getElementChain(el) {
  if (!el) return [];
  const chain = [];
  let current = el;
  let depth   = 0;

  while (current && depth < 5) {
    const rect = current.getBoundingClientRect();
    chain.push({
      tag:        current.tagName,
      textLength: (current.innerText || "").trim().length,
      boundingBox: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    });
    current = current.parentElement;
    depth++;
  }

  return chain;
}

// ── Sampling ──────────────────────────────────────────────────
function sample() {
  if (!recording) return;

  const now  = performance.now();
  const time = now - startTime;

  const x = lastX / window.innerWidth;
  const y = lastY / window.innerHeight;

  const el    = document.elementFromPoint(lastX, lastY);
  const chain = getElementChain(el);
  const etype = getElementType(chain);

  const dt   = now - lastSampleTime;
  const prev = recentSamples.at(-1);
  const dx   = lastX - (prev?.rawX ?? lastX);
  const dy   = lastY - (prev?.rawY ?? lastY);

  const velocity = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

  const s = {
    time,
    x,
    y,
    rawX:        lastX,
    rawY:        lastY,
    velocity,
    elementType: etype,
    elementChain: chain,
    scrollDelta: scrollAccum   // accumulated scroll since last sample
  };

  // Reset scroll accumulator
  scrollAccum = 0;

  recentSamples.push(s);
  if (recentSamples.length > 20) recentSamples.shift();

  localSamples.push(s);
  safeSend({ type: "sample", data: s });

  lastSampleTime = now;
}

// ── DOM event listeners ───────────────────────────────────────
document.addEventListener("mousemove", (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
}, { passive: true });

document.addEventListener("scroll", () => {
  if (!recording) return;
  const currentY = window.scrollY;
  scrollAccum   += currentY - lastScrollY;
  lastScrollY    = currentY;
}, { passive: true });

document.addEventListener("click", (e) => {
  if (!recording) return;

  const chain = getElementChain(document.elementFromPoint(e.clientX, e.clientY));

  const eventData = {
    type:         "click",
    time:         performance.now() - startTime,
    x:            e.clientX / window.innerWidth,
    y:            e.clientY / window.innerHeight,
    elementChain: chain,
    elementType:  getElementType(chain),
    context:      [...recentSamples]
  };

  localEvents.push(eventData);
  safeSend({ type: "event", data: eventData });
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;

  const eventData = {
    type:      "keydown",
    time:      performance.now() - startTime,
    // Mask actual characters — only care about key category
    keyType:   e.key.length === 1 ? "char"
             : e.key === "Enter" ? "enter"
             : e.key === "Backspace" ? "backspace"
             : e.key === "Tab" ? "tab"
             : "other",
    isModifier: e.ctrlKey || e.altKey || e.metaKey
  };

  localEvents.push(eventData);
  safeSend({ type: "event", data: eventData });
}, { passive: true });

document.addEventListener("focusin", (e) => {
  if (!recording) return;

  const chain = getElementChain(e.target);

  const eventData = {
    type:         "focus",
    time:         performance.now() - startTime,
    elementChain: chain,
    elementType:  getElementType(chain)
  };

  localEvents.push(eventData);
  safeSend({ type: "event", data: eventData });
}, { passive: true });

// ── Blob → data URL ───────────────────────────────────────────
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

// ── START / STOP ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {

  // ────────────────────── START ──────────────────────────────
  if (msg.type === "START") {
    const quality = msg.quality || { width: 1280, height: 720, bitrate: 4_000_000 };

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:     { ideal: quality.width  },
          height:    { ideal: quality.height },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
    } catch (err) {
      safeSend({ type: "CONTENT_ERROR", message: "Screen capture cancelled or denied." });
      return;
    }

    // If user closed the picker without choosing, getDisplayMedia resolves with
    // an empty stream or ends immediately — guard against it.
    if (!screenStream || screenStream.getTracks().length === 0) {
      safeSend({ type: "CONTENT_ERROR", message: "No screen source selected." });
      return;
    }

    // Handle the user stopping the share via browser UI
    screenStream.getTracks()[0].onended = () => {
      if (recording) safeSend({ type: "STOP" });
    };

    // Reset state
    localSamples  = [];
    localEvents   = [];
    screenChunks  = [];
    recentSamples = [];
    scrollAccum   = 0;
    lastScrollY   = window.scrollY;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    screenRecorder = new MediaRecorder(screenStream, {
      mimeType,
      videoBitsPerSecond: quality.bitrate
    });

    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };

    screenRecorder.start(1000);

    startTime      = performance.now();
    lastSampleTime = startTime;
    recording      = true;

    // Start sample loop
    if (sampleInterval) clearInterval(sampleInterval);
    sampleInterval = setInterval(sample, 50);

    safeSend({
      type: "RECORDING_STARTED",
      data: { viewport: { width: window.innerWidth, height: window.innerHeight } }
    });

    console.log("[Recorder] Started —", mimeType, quality);
  }

  // ────────────────────── STOP ───────────────────────────────
  if (msg.type === "STOP") {
    if (!recording) return;

    recording = false;

    // Stop sample loop immediately
    if (sampleInterval) { clearInterval(sampleInterval); sampleInterval = null; }

    // Wait for recorder to finish flushing
    await new Promise(res => {
      screenRecorder.onstop = res;
      screenRecorder.stop();
    });

    const screenBlob    = new Blob(screenChunks, { type: "video/webm" });
    const screenDataUrl = await blobToDataURL(screenBlob);

    const script = generateScript({
      samples: localSamples,
      events:  localEvents,
      meta:    { viewport: { width: window.innerWidth, height: window.innerHeight } }
    });

    safeSend({
      type: "FINAL_DATA",
      data: { screenDataUrl, script }
    });

    // Release screen capture
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;

    console.log(
      `[Recorder] Stopped — ${localSamples.length} samples, ${localEvents.length} events`
    );
  }
});
