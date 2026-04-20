// ============================================================
//  generator.js — Script Generator v7 ("dumb" edition)
//
//  Concept:
//    For every sample: look at what element is under the cursor,
//    use that element's size to pick a scale, use its center
//    (blended with cursor) as the frame center.
//    Group consecutive identical-ish targets into one keyframe.
//    No state machines. No segment breaks. No complex heuristics.
//
//  Output format (fixed forever):
//    [{ t:[startSec,endSec], zoom:{x,y,scale}, webcam:{x,y,w,h} }]
// ============================================================

// ── Tuning ────────────────────────────────────────────────────
const FILL       = 0.82;   // element fills this fraction of the zoomed frame
const SCALE_MAX  = 1.75;
const SCALE_MIN  = 1.00;

// Element must be at least this fraction of screen to be usable
// (filters out tiny icons/bullets/decorators)
const MIN_FRAC   = 0.005;  // 0.5%

// Element must be less than this fraction of screen
// (filters out full-page scroll containers)
const MAX_FRAC   = 0.72;

// Dedup: a new keyframe is only emitted when the zoom target
// changes by more than these amounts from the current keyframe.
const DEDUP_POS   = 0.025;  // normalised coords (manhattan)
const DEDUP_SCALE = 0.05;

// Minimum keyframe duration to keep
const MIN_KF_SEC  = 0.25;

// ── Helpers ───────────────────────────────────────────────────
function clamp(v, lo = 0.05, hi = 0.95) {
  return Math.max(lo, Math.min(hi, v));
}

function clampCenter(cx, cy, scale) {
  const half = 0.5 / scale;
  return {
    x: clamp(cx, half, 1 - half),
    y: clamp(cy, half, 1 - half)
  };
}

function webcamPos(cx, cy) {
  return {
    x: cx < 0.5 ? 0.78 : 0.00,
    y: cy < 0.5 ? 0.78 : 0.00,
    w: 0.22, h: 0.22
  };
}

// ── Core: element under cursor → zoom target ──────────────────
//
// Element selection — walk the chain from chain[0] (the innermost
// element the cursor is directly over) upward.
//
// Pick the FIRST element that is:
//   • at least MIN_FRAC of screen area  (not a tiny decoration)
//   • less than MAX_FRAC of screen area (not the page scroll container)
//
// This naturally selects:
//   • An image the cursor is hovering over directly
//   • A button or list item
//   • A card/panel if the cursor is over its background
//
// Scale is derived so that element fills FILL of the visible frame
// on its tightest axis. Capped at SCALE_MAX/MIN.
//
// Center blends: 80% element center, 20% cursor position.
// The cursor bias makes the frame feel "pulled toward" where the
// user is actually looking, while the element anchor prevents drift.

function pointToZoom(point, vp) {
  const chain  = point.elementChain || [];
  const screen = vp.width * vp.height;

  let box = null;

  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const frac = (b.w * b.h) / screen;
    if (frac >= MIN_FRAC && frac < MAX_FRAC) {
      box = b;
      break;
    }
  }

  let scale, cx, cy;

  if (box) {
    // Fit element into FILL of visible frame on the tighter axis
    const sw = (vp.width  * FILL) / box.w;
    const sh = (vp.height * FILL) / box.h;
    scale = Math.min(Math.max(Math.min(sw, sh), SCALE_MIN), SCALE_MAX);

    // Element center in normalised coords
    const ecx = (box.x + box.w / 2) / vp.width;
    const ecy = (box.y + box.h / 2) / vp.height;

    // Blend: 80% element center, 20% cursor
    // Cursor nudge keeps the frame pointed at where the user looks,
    // element anchor keeps it stable when cursor drifts slightly.
    cx = ecx * 0.80 + (point.x || 0.5) * 0.20;
    cy = ecy * 0.80 + (point.y || 0.5) * 0.20;

    // Layout edge bias: nudge away from fixed chrome (sidebars, navbars)
    if (box.x < vp.width  * 0.18) cx += 0.03;
    if (box.x + box.w > vp.width  * 0.82) cx -= 0.03;
    if (box.y < vp.height * 0.10) cy += 0.04;

  } else {
    // No usable element found: follow cursor with a moderate fixed zoom.
    // This happens when the cursor is over a giant scroll container
    // or when no chain data is available.
    scale = 1.40;
    cx    = point.x || 0.5;
    cy    = point.y || 0.5;
  }

  // Clamp center so the zoomed frame never shows black edges
  ;({ x: cx, y: cy } = clampCenter(cx, cy, scale));

  return { cx: clamp(cx), cy: clamp(cy), scale };
}

// ── Build sorted timeline of all data points ──────────────────
// Merges samples and interaction events into one time-sorted list.
// Events (clicks, focus) carry element chains and get a slight
// scale boost so interactions visibly zoom in.

function buildPoints(samples, events) {
  const pts = samples.map(s => ({
    time:         s.time,
    x:            s.x,
    y:            s.y,
    elementChain: s.elementChain,
    isEvent:      false,
    boost:        1.0
  }));

  for (const e of events) {
    if (e.type !== "click" && e.type !== "focus") continue;
    pts.push({
      time:         e.time,
      x:            e.x || 0.5,
      y:            e.y || 0.5,
      elementChain: e.elementChain || [],
      isEvent:      true,
      boost:        e.type === "click" ? 1.08 : 1.04  // small nudge upward
    });
  }

  pts.sort((a, b) => a.time - b.time);
  return pts;
}

// ── Collapse targets into keyframes ──────────────────────────
//
// Each data point produces a zoom target.
// We emit a new keyframe only when the target moves MORE than
// DEDUP thresholds from the CURRENT keyframe's zoom.
// Otherwise we extend the current keyframe's end time.
//
// This collapses "the cursor was hovering over the same image
// for 39 seconds" into ONE keyframe — not 40.
// And "cursor moved to a different card" into a new keyframe.

function collapse(targets, endSec) {
  if (!targets.length) return [];

  const kfs    = [];
  let   anchor = targets[0];   // zoom values for current keyframe
  let   tStart = targets[0].timeSec;

  function emit(tEnd) {
    if (tEnd - tStart < MIN_KF_SEC) return;
    kfs.push({
      t:      [tStart, tEnd],
      zoom:   { x: anchor.cx, y: anchor.cy, scale: anchor.scale },
      webcam: webcamPos(anchor.cx, anchor.cy)
    });
  }

  for (let i = 1; i < targets.length; i++) {
    const t    = targets[i];
    const dPos   = Math.abs(anchor.cx - t.cx) + Math.abs(anchor.cy - t.cy);
    const dScale = Math.abs(anchor.scale - t.scale);

    if (dPos > DEDUP_POS || dScale > DEDUP_SCALE) {
      // Target has moved meaningfully → close current, start new
      emit(t.timeSec);
      tStart = t.timeSec;
      anchor = t;
    }
    // else: extend current keyframe silently
  }

  // Close final keyframe
  emit(endSec);
  return kfs;
}

// ── Fallback for empty / invalid recordings ───────────────────
function fallback(data) {
  let dur = 1;
  for (const s of data.samples || []) if ((s.time || 0) > dur) dur = s.time;
  for (const e of data.events  || []) if ((e.time || 0) > dur) dur = e.time;
  return [{
    t:      [0, dur / 1000],
    zoom:   { x: 0.5, y: 0.5, scale: 1 },
    webcam: { x: 0.78, y: 0.78, w: 0.22, h: 0.22 }
  }];
}

// ── Entry point ───────────────────────────────────────────────
function generateScript(data) {
  const vp      = data.meta?.viewport || { width: 1920, height: 1080 };
  const samples = data.samples || [];
  const events  = data.events  || [];

  if (!samples.length && !events.length) return fallback(data);

  const endSec = Math.max(
    samples.length ? samples[samples.length - 1].time / 1000 : 0,
    events.length  ? events[events.length  - 1].time / 1000 : 0,
    1
  );

  const pts = buildPoints(samples, events);
  if (!pts.length) return fallback(data);

  // Compute zoom target for each data point
  const targets = pts.map(p => {
    const { cx, cy, scale } = pointToZoom(p, vp);
    return {
      timeSec: p.time / 1000,
      cx,
      cy,
      // Apply event boost AFTER clamping, re-clamp afterward
      scale: Math.min(scale * p.boost, SCALE_MAX)
    };
  });

  // Add a 1.0x default keyframe at the start if data starts late
  const firstTime = targets[0].timeSec;
  const kfs       = [];

  if (firstTime > 0.5) {
    kfs.push({
      t:      [0, firstTime],
      zoom:   { x: 0.5, y: 0.5, scale: 1.0 },
      webcam: { x: 0.78, y: 0.78, w: 0.22, h: 0.22 }
    });
  }

  kfs.push(...collapse(targets, endSec));

  return kfs.length ? kfs : fallback(data);
}

// ── Debug report ──────────────────────────────────────────────
function generateDebugReport(data, script) {
  const vp      = data.meta?.viewport || { width: 1920, height: 1080 };
  const samples = data.samples || [];
  const events  = data.events  || [];
  const screen  = vp.width * vp.height;

  const pts     = buildPoints(samples, events);
  const targets = pts.map(p => {
    const { cx, cy, scale } = pointToZoom(p, vp);
    const chain = p.elementChain || [];

    // What element was picked?
    let picked = null;
    for (const el of chain) {
      const b = el.boundingBox;
      if (!b || b.w <= 0 || b.h <= 0) continue;
      const frac = (b.w * b.h) / screen;
      if (frac >= MIN_FRAC && frac < MAX_FRAC) { picked = { tag: el.tag, frac: `${Math.round(frac*100)}%`, box: b }; break; }
    }

    return {
      timeSec:   +(p.time / 1000).toFixed(2),
      isEvent:   p.isEvent,
      cursorX:   +(p.x || 0).toFixed(3),
      cursorY:   +(p.y || 0).toFixed(3),
      chainDepth: chain.length,
      elementPicked: picked,
      computed:  { cx: +cx.toFixed(3), cy: +cy.toFixed(3), scale: +scale.toFixed(3) }
    };
  });

  // Velocity histogram
  const velH = [0,0,0,0,0];
  for (const s of samples) {
    const v = s.velocity || 0;
    if      (v < 0.02) velH[0]++;
    else if (v < 0.05) velH[1]++;
    else if (v < 0.10) velH[2]++;
    else if (v < 0.20) velH[3]++;
    else               velH[4]++;
  }

  const withChains = samples.filter(s => s.elementChain?.length > 0).length;

  return {
    _version: "v7-dumb",
    meta: {
      viewport:      vp,
      sampleCount:   samples.length,
      eventCount:    events.length,
      samplesWithChain: withChains,
      durationSec:   samples.length
        ? +((samples[samples.length-1].time - samples[0].time)/1000).toFixed(2) : 0,
      expectedSamples: samples.length
        ? Math.round((samples[samples.length-1].time - samples[0].time) / 50) : 0,
      sampleRate: samples.length && samples.length > 1
        ? `1 per ${Math.round((samples[samples.length-1].time - samples[0].time) / (samples.length-1))}ms (expected 50ms)`
        : "n/a"
    },
    DIAGNOSIS: {
      timerThrottled: samples.length > 1
        ? ((samples[samples.length-1].time - samples[0].time) / (samples.length-1)) > 200
          ? "YES — Chrome throttled the interval. Recording tab was in background. Panel now auto-minimizes on start to fix this."
          : "NO — timer ran at normal speed"
        : "unknown",
      noChains: withChains === 0
        ? "ALL samples have empty chains — cursor was outside viewport. Check that recording tab was focused."
        : `OK — ${withChains}/${samples.length} samples have chains`,
      keyframesProduced: script.length
    },
    velocityDistribution: {
      "< 0.02 (still)":     velH[0],
      "0.02–0.05 (slow)":   velH[1],
      "0.05–0.10 (medium)": velH[2],
      "0.10–0.20 (fast)":   velH[3],
      "> 0.20 (very fast)": velH[4]
    },
    perPointTargets: targets.slice(0, 30),  // first 30 points
    scriptKeyframes: script.length,
    script
  };
}
