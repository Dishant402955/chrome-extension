#!/usr/bin/env node
// ============================================================
//  generate.js — reads log.json, outputs script.json
//
//  Usage:
//    node generate.js log.json
//    node generate.js log.json out.json
//
//  Output format (fixed):
//  {
//    "timeline": [
//      { "t": [startSec, endSec], "zoom": { "x", "y", "scale" }, "webcam": { "x","y","w","h" } }
//    ]
//  }
// ============================================================

const fs   = require("fs");
const path = require("path");

const inputPath  = process.argv[2];
const outputPath = process.argv[3] || inputPath.replace(/\.json$/, "_script.json");

if (!inputPath) {
  console.error("Usage: node generate.js <log.json> [output.json]");
  process.exit(1);
}

const log = JSON.parse(fs.readFileSync(inputPath, "utf8"));

console.log(`\n[generate] Input:    ${inputPath}`);
console.log(`[generate] Samples:  ${log.samples?.length ?? 0}`);
console.log(`[generate] Events:   ${log.events?.length  ?? 0}`);
console.log(`[generate] Duration: ${((log.durationMs || 0) / 1000).toFixed(1)}s`);
console.log(`[generate] Viewport: ${log.viewport?.width}×${log.viewport?.height}\n`);

const result = generateScript(log);

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`[generate] Keyframes: ${result.timeline.length}`);
console.log(`[generate] Output:    ${outputPath}\n`);

result.timeline.forEach((kf, i) => {
  console.log(
    `  [${String(i).padStart(2)}] ${kf.t[0].toFixed(2)}s – ${kf.t[1].toFixed(2)}s  ` +
    `zoom(${kf.zoom.x.toFixed(2)}, ${kf.zoom.y.toFixed(2)}, ${kf.zoom.scale.toFixed(2)}x)`
  );
});

// ============================================================
//  ALGORITHM
// ============================================================

function generateScript(log) {
  const vp      = log.viewport || { width: 1920, height: 1080 };
  const samples = log.samples  || [];
  const events  = log.events   || [];

  if (!samples.length && !events.length) {
    return { timeline: [fallbackKf(0, 1, vp)] };
  }

  // 1. Merge samples + click/focus events into one sorted timeline
  const points = buildPoints(samples, events);

  // 2. Per-point: compute raw zoom target
  const raw = points.map(p => ({
    timeSec:  p.time / 1000,
    isClick:  p.isClick,
    isFocus:  p.isFocus,
    ...pointToZoom(p, vp)
  }));

  // 3. Stabilize — dwell-based zone locking kills jitter
  const stable = stabilize(raw);

  // 4. Collapse into keyframes
  const kfs = collapse(stable, vp);

  // 5. Prepend default frame if data starts late
  const timeline = [];
  if (kfs.length && kfs[0].t[0] > 0.4) {
    timeline.push(fallbackKf(0, kfs[0].t[0], vp));
  }
  timeline.push(...kfs);

  if (!timeline.length) {
    const dur = samples.length ? samples[samples.length - 1].time / 1000 : 1;
    return { timeline: [fallbackKf(0, dur, vp)] };
  }

  return { timeline };
}

// ── Build sorted point list ───────────────────────────────────
function buildPoints(samples, events) {
  const pts = samples.map(s => ({
    time:         s.time,
    x:            s.x,
    y:            s.y,
    elementChain: s.elementChain || [],
    isClick:      false,
    isFocus:      false
  }));

  for (const e of events) {
    if (e.type !== "click" && e.type !== "focus") continue;
    pts.push({
      time:         e.time,
      x:            e.x || 0.5,
      y:            e.y || 0.5,
      elementChain: e.elementChain || [],
      isClick:      e.type === "click",
      isFocus:      e.type === "focus"
    });
  }

  pts.sort((a, b) => a.time - b.time);
  return pts;
}

// ── Element → zoom target ─────────────────────────────────────
//
// Walk the chain from innermost element upward.
// Pick the FIRST element whose area is between MIN_FRAC and MAX_FRAC.
//
// Scale formula:
//   We want the element to fill FILL (85%) of the zoomed visible frame.
//   visible_w = viewport.w / scale  →  scale = viewport.w * FILL / el.w
//   Take min(scale_by_width, scale_by_height) → fits on both axes.
//   Cap: SCALE_MAX (2.5x) for maximum aggression.
//
// Center: 75% element center + 25% cursor
//   Element anchor keeps frame stable; cursor pull keeps it pointed
//   at what the user is actually looking at.

const FILL      = 0.85;
const SCALE_MAX = 2.50;   // aggressive
const SCALE_MIN = 1.00;
const MIN_FRAC  = 0.003;  // 0.3% — pick up small buttons too
const MAX_FRAC  = 0.70;   // 70% — ignore full-page containers

function pointToZoom(point, vp) {
  const chain  = point.elementChain || [];
  const screen = vp.width * vp.height;

  let box = null;
  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const frac = (b.w * b.h) / screen;
    if (frac >= MIN_FRAC && frac < MAX_FRAC) { box = b; break; }
  }

  let scale, cx, cy;

  if (box) {
    const sw = (vp.width  * FILL) / box.w;
    const sh = (vp.height * FILL) / box.h;
    scale = Math.min(Math.max(Math.min(sw, sh), SCALE_MIN), SCALE_MAX);

    const ecx = (box.x + box.w / 2) / vp.width;
    const ecy = (box.y + box.h / 2) / vp.height;

    cx = ecx * 0.75 + (point.x || 0.5) * 0.25;
    cy = ecy * 0.75 + (point.y || 0.5) * 0.25;

    // Edge nudge: pull away from fixed nav/sidebar chrome
    if (box.x < vp.width  * 0.18) cx += 0.03;
    if (box.x + box.w > vp.width  * 0.82) cx -= 0.03;
    if (box.y < vp.height * 0.10) cy += 0.04;
  } else {
    // No valid element — cursor follow with moderate zoom
    scale = 1.50;
    cx    = point.x || 0.5;
    cy    = point.y || 0.5;
  }

  // Clicks: +15% zoom boost (they're the most important moments)
  // Focus:  +8%  zoom boost
  if (point.isClick) scale = Math.min(scale * 1.15, SCALE_MAX);
  if (point.isFocus) scale = Math.min(scale * 1.08, SCALE_MAX);

  const c = clampCenter(cx, cy, scale, vp);
  return { cx: c.x, cy: c.y, scale };
}

// ── Stabilizer ────────────────────────────────────────────────
//
// State: LOCKED or BUFFERING
//
// LOCKED:
//   Emit the locked zoom for every sample that stays within
//   ZONE_POS (manhattan) and ZONE_SCALE of the locked values.
//   Any sample outside → enter BUFFERING.
//
// BUFFERING:
//   Collect consecutive out-of-zone samples.
//   After DWELL_N samples that are mutually coherent (centroid check),
//   commit the centroid as the new LOCKED zone.
//   While buffering → keep emitting old locked zoom (camera holds still).
//   If buffer loses coherence → drop oldest, keep trying.
//
// DWELL_N = 10 samples = ~500ms at 50ms/sample
// This means the camera only commits to a new position after
// the cursor settles there for half a second.

const DWELL_N    = 10;
const ZONE_POS   = 0.07;  // manhattan distance threshold
const ZONE_SCALE = 0.12;  // scale threshold

function stabilize(targets) {
  if (!targets.length) return [];

  const out    = [];
  let locked   = { cx: targets[0].cx, cy: targets[0].cy, scale: targets[0].scale };
  let buffer   = [];

  const inZone = (t, z) =>
    Math.abs(t.cx - z.cx) + Math.abs(t.cy - z.cy) <= ZONE_POS &&
    Math.abs(t.scale - z.scale) <= ZONE_SCALE;

  const centroid = (arr) => ({
    cx:    arr.reduce((s, t) => s + t.cx, 0) / arr.length,
    cy:    arr.reduce((s, t) => s + t.cy, 0) / arr.length,
    scale: arr.reduce((s, t) => s + t.scale, 0) / arr.length
  });

  const coherent = (arr) => {
    const c = centroid(arr);
    return arr.every(t => inZone(t, c));
  };

  for (const t of targets) {
    if (inZone(t, locked)) {
      buffer = [];
      out.push({ timeSec: t.timeSec, ...locked });
    } else {
      buffer.push(t);

      if (buffer.length >= DWELL_N) {
        if (coherent(buffer)) {
          locked = centroid(buffer);
          buffer = [];
          out.push({ timeSec: t.timeSec, ...locked });
        } else {
          buffer.shift(); // slide window
          out.push({ timeSec: t.timeSec, ...locked }); // hold
        }
      } else {
        out.push({ timeSec: t.timeSec, ...locked }); // hold while buffering
      }
    }
  }

  return out;
}

// ── Collapse into keyframes ───────────────────────────────────
//
// After stabilization, consecutive identical values collapse
// into one keyframe. A new keyframe only emits when the
// stabilized values actually change (= a zone commit happened).

const KF_POS   = 0.008;
const KF_SCALE = 0.015;
const MIN_KF   = 0.25;    // seconds

function collapse(stable, vp) {
  if (!stable.length) return [];

  const kfs    = [];
  let anchor   = stable[0];
  let tStart   = stable[0].timeSec;
  const endSec = stable[stable.length - 1].timeSec;

  const emit = (tEnd) => {
    if (tEnd - tStart < MIN_KF) return;
    const zoom   = { x: round(anchor.cx), y: round(anchor.cy), scale: round(anchor.scale) };
    const webcam = webcamPos(anchor.cx, anchor.cy);
    kfs.push({
      t:      [round(tStart), round(tEnd)],
      zoom,
      webcam
    });
  };

  for (let i = 1; i < stable.length; i++) {
    const t    = stable[i];
    const dPos   = Math.abs(anchor.cx - t.cx) + Math.abs(anchor.cy - t.cy);
    const dScale = Math.abs(anchor.scale - t.scale);

    if (dPos > KF_POS || dScale > KF_SCALE) {
      emit(t.timeSec);
      tStart = t.timeSec;
      anchor = t;
    }
  }

  emit(endSec);
  return kfs;
}

// ── Webcam position ───────────────────────────────────────────
// Always in the corner opposite to where the zoom is pointing.
// This avoids the webcam bubble covering the area of interest.
function webcamPos(cx, cy) {
  const left = cx < 0.5;
  const top  = cy < 0.5;
  return {
    x: left ? 0.75 : 0.03,
    y: top  ? 0.72 : 0.03,
    w: 0.22,
    h: 0.22
  };
}

// ── Helpers ───────────────────────────────────────────────────
function clamp(v, lo = 0.05, hi = 0.95) {
  return Math.max(lo, Math.min(hi, v));
}

function clampCenter(cx, cy, scale, vp) {
  // Keep the zoomed window fully inside [0,1] — no black edges
  const halfX = (0.5 / scale);
  const halfY = (0.5 / scale);
  return {
    x: clamp(cx, halfX, 1 - halfX),
    y: clamp(cy, halfY, 1 - halfY)
  };
}

function round(v) { return parseFloat(v.toFixed(4)); }

function fallbackKf(tStart, tEnd, vp) {
  return {
    t:      [round(tStart), round(tEnd)],
    zoom:   { x: 0.5, y: 0.5, scale: 1.0 },
    webcam: webcamPos(0.5, 0.5)
  };
}
