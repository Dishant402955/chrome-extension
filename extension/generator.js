// ============================================================
//  generator.js — Smart Script Generator v2
//
//  Input:  { samples[], events[], meta: { viewport: {w,h} } }
//  Output: [{ t:[startSec, endSec], zoom:{x,y,scale}, webcam:{x,y,w,h} }]
//
//  Output format is FIXED — never changes.
// ============================================================

// ── Tuning constants ──────────────────────────────────────────
const BUCKET_MS         = 50;    // must match content.js sample interval
const MIN_SEG_MS        = 200;   // drop segments shorter than this
const MIN_KF_MS         = 350;   // drop keyframes shorter than this
const MAX_SEG_MS        = 4000;  // force a segment break after this duration
const ZOOM_LOCK_MS      = 1600;  // hold zoom after click/typing interaction
const MIN_ZOOM_GAP_MS   = 600;   // minimum real-time gap between zoom changes
const BLEND_F           = 0.40;  // lerp factor toward new zoom target
const CURSOR_DOM_RATIO  = 0.70;  // cursor weight vs DOM center (0=dom, 1=cursor)

// Velocity thresholds (normalised px / ms)
const V_STABLE = 0.04;
const V_FAST   = 0.18;
const V_SCROLL = 0.08;  // min velocity AND mostly-Y → classify as scroll

// ── Element type map ──────────────────────────────────────────
const TAG_TYPE = {
  input: "input", textarea: "input", select: "input",
  button: "interactive", a: "interactive",
  nav: "nav", menu: "nav", header: "nav",
  code: "code", pre: "code",
  main: "content", article: "content", section: "content", p: "content",
  form: "form", fieldset: "form",
  table: "table", thead: "table", tbody: "table",
  tr: "table", td: "table", th: "table",
  ul: "list", ol: "list", li: "list",
  img: "media", video: "media", canvas: "media", svg: "media",
  dialog: "modal", aside: "modal",
};

function classifyElement(chain) {
  if (!chain?.length) return "unknown";
  for (const el of chain) {
    const t = (el.tag || "").toLowerCase();
    if (TAG_TYPE[t]) return TAG_TYPE[t];
  }
  const first = chain[0];
  if (first?.textLength > 300) return "content";
  if (first?.textLength > 0 && first?.textLength < 80) return "label";
  return "generic";
}

// ── Scale lookup table ────────────────────────────────────────
// Axes: elementType × state
// States (index): clicking=0, typing=1, focusing=2, reading=3,
//                 navigating=4, scrolling=5, moving=6, idle=7
const SCALE_TABLE = {
//              click  type  focus  read   nav    scroll move   idle
  input:       [1.80,  1.75, 1.65,  1.40,  1.20,  1.00,  1.00,  1.20],
  interactive: [1.65,  1.50, 1.50,  1.30,  1.25,  1.00,  1.00,  1.15],
  nav:         [1.40,  1.30, 1.30,  1.20,  1.25,  1.00,  1.00,  1.10],
  code:        [1.65,  1.70, 1.60,  1.50,  1.20,  1.00,  1.00,  1.30],
  content:     [1.40,  1.30, 1.30,  1.25,  1.15,  1.00,  1.00,  1.10],
  form:        [1.60,  1.70, 1.60,  1.40,  1.20,  1.00,  1.00,  1.20],
  table:       [1.50,  1.40, 1.40,  1.35,  1.20,  1.00,  1.00,  1.15],
  list:        [1.45,  1.35, 1.35,  1.25,  1.20,  1.00,  1.00,  1.10],
  media:       [1.40,  1.30, 1.35,  1.30,  1.15,  1.00,  1.00,  1.10],
  modal:       [1.70,  1.60, 1.65,  1.50,  1.25,  1.00,  1.00,  1.25],
  label:       [1.55,  1.45, 1.45,  1.30,  1.20,  1.00,  1.00,  1.15],
  generic:     [1.55,  1.50, 1.45,  1.30,  1.20,  1.00,  1.00,  1.15],
  unknown:     [1.50,  1.45, 1.40,  1.25,  1.15,  1.00,  1.00,  1.10],
};
const STATE_IDX = {
  clicking:0, typing:1, focusing:2, reading:3,
  navigating:4, scrolling:5, moving:6, idle:7
};

function lookupScale(elementType, state) {
  const row = SCALE_TABLE[elementType] || SCALE_TABLE.unknown;
  return row[STATE_IDX[state] ?? STATE_IDX.idle];
}

// ── Helpers ───────────────────────────────────────────────────
function clamp(v, lo = 0.05, hi = 0.95) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Clamp center so the zoomed frame never shows a black border
function clampForScale(cx, cy, scale) {
  const half = 0.5 / scale;
  return {
    x: clamp(cx, half, 1 - half),
    y: clamp(cy, half, 1 - half)
  };
}

// ── PHASE 1 — Bucketize ───────────────────────────────────────
function bucketize(data) {
  const samples = data.samples || [];
  const events  = data.events  || [];

  if (!samples.length && !events.length) return [];

  const maxTime = Math.max(
    ...samples.map(s => s.time || 0),
    ...events.map(e => e.time || 0),
    0
  );

  if (maxTime <= 0) return [];

  const count   = Math.ceil(maxTime / BUCKET_MS) + 1;
  const buckets = Array.from({ length: count }, (_, i) => ({
    tStart: i * BUCKET_MS,
    tEnd:  (i + 1) * BUCKET_MS,
    samples: [],
    events:  []
  }));

  for (const s of samples) {
    const i = Math.floor((s.time || 0) / BUCKET_MS);
    if (buckets[i]) buckets[i].samples.push(s);
  }

  for (const e of events) {
    const i = Math.floor((e.time || 0) / BUCKET_MS);
    if (buckets[i]) buckets[i].events.push(e);
  }

  return buckets;
}

// ── PHASE 2 — Feature extraction ─────────────────────────────
function extractFeatures(buckets) {
  return buckets.map(b => {
    const s = b.samples;
    const n = s.length;

    const avgX = n ? s.reduce((a, x) => a + x.x, 0) / n : 0.5;
    const avgY = n ? s.reduce((a, x) => a + x.y, 0) / n : 0.5;
    const avgV = n ? s.reduce((a, x) => a + (x.velocity || 0), 0) / n : 0;

    // Scroll detection: net Y movement is large relative to X
    const totalScrollDelta = n
      ? s.reduce((a, x) => a + (x.scrollDelta || 0), 0)
      : 0;
    const isScrolling = Math.abs(totalScrollDelta) > 50 && avgV >= V_SCROLL;

    // Dominant element chain — most frequent across samples
    let dominantChain = null;
    let elementType   = "unknown";

    if (n) {
      const freq = new Map();
      for (const x of s) {
        if (!x.elementChain?.length) continue;
        const key = JSON.stringify(x.elementChain);
        freq.set(key, (freq.get(key) || 0) + 1);
      }
      if (freq.size) {
        let best = null, bestCount = 0;
        for (const [k, c] of freq) {
          if (c > bestCount) { best = k; bestCount = c; }
        }
        dominantChain = JSON.parse(best);
        elementType   = classifyElement(dominantChain);
      }
    }

    // Event flags
    const hasClick = b.events.some(e => e.type === "click");
    const hasKey   = b.events.some(e => e.type === "keydown");
    const hasFocus = b.events.some(e => e.type === "focus");

    // If focus event arrived, it gives a precise element chain
    const focusEv = hasFocus && b.events.find(e => e.type === "focus");
    if (focusEv?.elementChain?.length) {
      dominantChain = focusEv.elementChain;
      elementType   = focusEv.elementType || classifyElement(focusEv.elementChain);
    }

    // Click event chain is most accurate for interaction moments
    const clickEv = hasClick && b.events.find(e => e.type === "click");
    if (clickEv?.elementChain?.length) {
      dominantChain = clickEv.elementChain;
      elementType   = clickEv.elementType || classifyElement(clickEv.elementChain);
    }

    return {
      tStart: b.tStart,
      tEnd:   b.tEnd,
      avgX, avgY, avgV,
      isScrolling,
      totalScrollDelta,
      hasClick, hasKey, hasFocus,
      elementType,
      dominantChain,
      samples: b.samples,
      events:  b.events
    };
  });
}

// ── PHASE 3 — State classification ───────────────────────────
// Priority order (highest first):
//   clicking → typing → focusing → scrolling →
//   reading → navigating → moving → idle
function classifyState(f) {
  if (f.hasClick)                            return "clicking";
  if (f.hasKey)                              return "typing";
  if (f.hasFocus && f.avgV < V_STABLE)       return "focusing";
  if (f.isScrolling)                         return "scrolling";
  if (f.avgV < V_STABLE && f.dominantChain)  return "reading";
  if (f.avgV < V_STABLE)                     return "idle";
  if (f.elementType === "nav")               return "navigating";
  if (f.avgV >= V_FAST)                      return "moving";
  return "moving";
}

function classifyStates(features) {
  return features.map(f => ({ ...f, state: classifyState(f) }));
}

// ── PHASE 4 — Segment creation ────────────────────────────────
// Merges consecutive same-state buckets.
// Uses proper running sums to avoid drift.
// Forces a break after MAX_SEG_MS even if state doesn't change.
function createSegments(states) {
  const segs = [];
  let cur    = null;

  function flush() {
    if (!cur) return;
    if (cur.tEnd - cur.tStart >= MIN_SEG_MS) {
      cur.avgX = cur._sx / cur._n;
      cur.avgY = cur._sy / cur._n;
      cur.avgV = cur._sv / cur._n;
      delete cur._sx; delete cur._sy; delete cur._sv; delete cur._n;
      segs.push(cur);
    }
    cur = null;
  }

  for (const s of states) {
    const sameState = cur && s.state === cur.state;
    const tooLong   = cur && (s.tEnd - cur.tStart) > MAX_SEG_MS;

    if (!cur) {
      cur = { ...s, _sx: s.avgX, _sy: s.avgY, _sv: s.avgV, _n: 1 };
      continue;
    }

    if (sameState && !tooLong) {
      cur.tEnd      = s.tEnd;
      cur._sx      += s.avgX;
      cur._sy      += s.avgY;
      cur._sv      += s.avgV;
      cur._n       += 1;
      cur.hasClick  = cur.hasClick  || s.hasClick;
      cur.hasKey    = cur.hasKey    || s.hasKey;
      cur.hasFocus  = cur.hasFocus  || s.hasFocus;
      cur.isScrolling = cur.isScrolling || s.isScrolling;
      cur.samples   = cur.samples.concat(s.samples);
      cur.events    = cur.events.concat(s.events);

      // Prefer the chain from click/focus events when they appear in merged buckets
      if (s.hasClick || s.hasFocus) {
        cur.elementType   = s.elementType;
        cur.dominantChain = s.dominantChain;
      }
    } else {
      flush();
      cur = { ...s, _sx: s.avgX, _sy: s.avgY, _sv: s.avgV, _n: 1 };
    }
  }

  flush();
  return segs;
}

// ── PHASE 5 — Bounding box utilities ─────────────────────────

// Pick the best container box from an element chain.
// Two passes: first prefers small/modal-sized boxes (interaction targets),
// then falls back to mid-sized layout containers.
function pickContainer(chain, viewport) {
  if (!chain?.length) return null;
  const screen = viewport.width * viewport.height;

  // Pass 1: tight interaction target (4%–35% of screen)
  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const r = (b.w * b.h) / screen;
    if (r > 0.04 && r < 0.35) return b;
  }

  // Pass 2: broader layout container (up to 65%)
  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const r = (b.w * b.h) / screen;
    if (r > 0.04 && r < 0.65) return b;
  }

  return chain[0]?.boundingBox || null;
}

// Ensure the box is never tinier than a comfortable minimum view area
function expandBox(box, viewport) {
  if (!box) return null;
  const w  = Math.max(box.w, viewport.width  * 0.28);
  const h  = Math.max(box.h, viewport.height * 0.20);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function boxCenter(box, viewport) {
  if (!box) return null;
  return {
    x: (box.x + box.w / 2) / viewport.width,
    y: (box.y + box.h / 2) / viewport.height
  };
}

// Nudge center to compensate for common layout biases
// (sidebar on left, top navbar, right panel)
function adjustLayoutBias(cx, cy, box, viewport) {
  if (!box) return { x: cx, y: cy };
  const leftBias  = box.x < viewport.width * 0.20;
  const rightBias = box.x + box.w > viewport.width * 0.80;
  const topBias   = box.y < viewport.height * 0.12;

  let x = cx;
  let y = cy;
  if (leftBias)  x += 0.04;
  if (rightBias) x -= 0.04;
  if (topBias)   y += 0.04;

  return { x: clamp(x), y: clamp(y) };
}

// ── PHASE 6 — Build timeline ──────────────────────────────────
const DEFAULT_ZOOM = { x: 0.5, y: 0.5, scale: 1.0 };

// Webcam overlay: always in the corner opposite to the current action
function webcamPos(cx, cy) {
  const left = cx < 0.5;
  const top  = cy < 0.5;
  return {
    x: left ? 0.78 : 0.00,
    y: top  ? 0.78 : 0.00,
    w: 0.22,
    h: 0.22
  };
}

function buildTimeline(segments, viewport) {
  let prev      = { ...DEFAULT_ZOOM };
  let lockUntil = 0;   // ms timestamp — do not change zoom before this
  const output  = [];

  for (const seg of segments) {
    const dur = seg.tEnd - seg.tStart;
    if (dur < MIN_KF_MS) continue;

    // ── Resolve element chain ──────────────────────────────
    const chain =
      seg.events.find(e => e.type === "click")?.elementChain  ||
      seg.events.find(e => e.type === "focus")?.elementChain  ||
      seg.dominantChain                                        ||
      seg.samples[0]?.elementChain;

    let box = pickContainer(chain, viewport);
    box     = expandBox(box, viewport);

    const domCenter = boxCenter(box, viewport);
    const cursor    = { x: seg.avgX, y: seg.avgY };

    // ── Blend cursor + DOM center ──────────────────────────
    let cx = domCenter
      ? lerp(domCenter.x, cursor.x, CURSOR_DOM_RATIO)
      : cursor.x;
    let cy = domCenter
      ? lerp(domCenter.y, cursor.y, CURSOR_DOM_RATIO)
      : cursor.y;

    ;({ x: cx, y: cy } = adjustLayoutBias(cx, cy, box, viewport));

    const scale = lookupScale(seg.elementType, seg.state);

    // Clamp so we never show black edges
    ;({ x: cx, y: cy } = clampForScale(cx, cy, scale));

    // ── Zoom lock window ───────────────────────────────────
    // After a click or typing, hold the current zoom for ZOOM_LOCK_MS
    // so the viewer can see what happened before the camera moves again.
    const isInteraction = seg.state === "clicking" || seg.state === "typing";

    if (seg.tStart < lockUntil && !isInteraction) {
      // Still inside lock window — emit but hold previous zoom
      output.push({
        t:      [seg.tStart / 1000, seg.tEnd / 1000],
        zoom:   { ...prev },
        webcam: webcamPos(prev.x, prev.y)
      });
      continue;
    }

    // ── Stability: don't move for tiny deltas ──────────────
    const newZoom = { x: clamp(cx), y: clamp(cy), scale };
    const dPos    = Math.abs(prev.x - newZoom.x) + Math.abs(prev.y - newZoom.y);
    const dScale  = Math.abs(prev.scale - newZoom.scale);

    let zoom;
    if (dPos < 0.02 && dScale < 0.06) {
      zoom = { ...prev }; // hold
    } else {
      zoom = {
        x:     lerp(prev.x,     newZoom.x,     BLEND_F),
        y:     lerp(prev.y,     newZoom.y,     BLEND_F),
        scale: lerp(prev.scale, newZoom.scale, BLEND_F)
      };
    }

    if (isInteraction) lockUntil = seg.tEnd + ZOOM_LOCK_MS;

    prev = zoom;
    output.push({
      t:      [seg.tStart / 1000, seg.tEnd / 1000],
      zoom,
      webcam: webcamPos(zoom.x, zoom.y)
    });
  }

  return output;
}

// ── PHASE 7 — Consolidate micro-jitter ───────────────────────
// Merges adjacent keyframes that don't differ meaningfully,
// avoiding epileptic zoom changes.
function consolidate(timeline) {
  if (!timeline.length) return [];

  const BIG_POS   = 0.10;
  const BIG_SCALE = 0.18;

  const result = [];
  let anchor   = { ...timeline[0], t: [...timeline[0].t] };

  for (let i = 1; i < timeline.length; i++) {
    const cur    = timeline[i];
    const dPos   = Math.abs(anchor.zoom.x - cur.zoom.x) + Math.abs(anchor.zoom.y - cur.zoom.y);
    const dScale = Math.abs(anchor.zoom.scale - cur.zoom.scale);

    if (dPos > BIG_POS || dScale > BIG_SCALE) {
      result.push(anchor);
      anchor = { ...cur, t: [...cur.t] };
    } else {
      anchor.t[1] = cur.t[1]; // extend hold
    }
  }

  result.push(anchor);
  return result;
}

// ── PHASE 8 — Rate-limit zoom changes ────────────────────────
// Enforces a minimum real-time gap between actual zoom switches
// to prevent motion sickness from rapid-fire cuts.
function rateLimit(timeline) {
  if (!timeline.length) return [];

  const out  = [{ ...timeline[0], t: [...timeline[0].t] }];
  let lastMs = timeline[0].t[0] * 1000;

  for (let i = 1; i < timeline.length; i++) {
    const cur   = timeline[i];
    const curMs = cur.t[0] * 1000;

    if (curMs - lastMs < MIN_ZOOM_GAP_MS) {
      // Too soon — extend previous keyframe
      out[out.length - 1].t[1] = cur.t[1];
    } else {
      out.push({ ...cur, t: [...cur.t] });
      lastMs = curMs;
    }
  }

  return out;
}

// ── Edge case fallback ────────────────────────────────────────
function fallback(data) {
  const dur = Math.max(
    ...(data.samples || []).map(s => s.time || 0),
    ...(data.events  || []).map(e => e.time || 0),
    1000
  ) / 1000;

  return [{
    t:      [0, dur],
    zoom:   { x: 0.5, y: 0.5, scale: 1 },
    webcam: { x: 0.78, y: 0.78, w: 0.22, h: 0.22 }
  }];
}

// ── Public entry point ────────────────────────────────────────
function generateScript(data) {
  const viewport = data.meta?.viewport || { width: 1920, height: 1080 };

  // Edge case: no data at all
  if (!data.samples?.length && !data.events?.length) return fallback(data);

  const buckets  = bucketize(data);
  const features = extractFeatures(buckets);
  const states   = classifyStates(features);
  const segments = createSegments(states);

  // Edge case: recording too short to produce meaningful segments
  if (!segments.length) return fallback(data);

  const raw    = buildTimeline(segments, viewport);

  // Edge case: no keyframes survived (all segments were micro-segments)
  if (!raw.length) return fallback(data);

  const merged  = consolidate(raw);
  const limited = rateLimit(merged);

  return limited.length ? limited : fallback(data);
}
