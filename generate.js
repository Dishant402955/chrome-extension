#!/usr/bin/env node
// ============================================================
//  generate.js — reads a log.json, outputs script.json
//
//  Usage:
//    node generate.js log.json
//    node generate.js log.json output.json   (custom output path)
//
//  Output format (fixed):
//    [{ t:[startSec,endSec], zoom:{x,y,scale}, webcam:{x,y,w,h} }]
// ============================================================

const fs   = require("fs");
const path = require("path");

const FILL      = 0.82;
const SCALE_MAX = 1.75;
const SCALE_MIN = 1.00;
const MIN_FRAC  = 0.005;  // 0.5% of screen area
const MAX_FRAC  = 0.72;   // 72% of screen area

const DWELL_N     = 12;    // samples to confirm a new zone (~600ms)
const ZONE_POS    = 0.06;  // max manhattan dist to count as "same zone"
const ZONE_SCALE  = 0.10;  // max scale diff to count as "same zone"

const KF_POS   = 0.008;  // very tight — stabilizer already did the work
const KF_SCALE = 0.015;
const MIN_KF   = 0.25;   // seconds

// ── CLI ───────────────────────────────────────────────────────
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
console.log(`[generate] Duration: ${(log.durationMs / 1000).toFixed(1)}s`);
console.log(`[generate] Viewport: ${log.viewport?.width}×${log.viewport?.height}\n`);

const script = generateScript(log);

fs.writeFileSync(outputPath, JSON.stringify(script, null, 2));
console.log(`[generate] Keyframes: ${script.length}`);
console.log(`[generate] Output:    ${outputPath}\n`);
script.forEach((kf, i) => {
  console.log(
    `  [${i}] ${kf.t[0].toFixed(2)}s–${kf.t[1].toFixed(2)}s  ` +
    `zoom x=${kf.zoom.x.toFixed(3)} y=${kf.zoom.y.toFixed(3)} s=${kf.zoom.scale.toFixed(3)}`
  );
});

// ============================================================
//  CORE ALGORITHM
// ============================================================

function generateScript(log) {
  const vp      = log.viewport || { width: 1920, height: 1080 };
  const samples = log.samples  || [];
  const events  = log.events   || [];

  if (!samples.length && !events.length) {
    console.warn("[generate] No data — returning fallback");
    return fallback(1);
  }

  // ── 1. Merge samples + interaction events into one timeline ─
  const points = mergeTimeline(samples, events);

  // ── 2. Per-point: compute raw zoom target from element chain ─
  const rawTargets = points.map(p => ({
    timeSec: p.time / 1000,
    ...pointToZoom(p, vp),
    isClick: p.isClick || false,
    isFocus: p.isFocus || false
  }));

  // ── 3. Stabilize: suppress jitter, commit to zones ──────────
  const stable = stabilize(rawTargets);

  // ── 4. Collapse into keyframes ───────────────────────────────
  const kfs = collapse(stable);

  // ── 5. Prepend a default frame if data starts late ───────────
  const result = [];
  if (kfs.length && kfs[0].t[0] > 0.5) {
    result.push({ t: [0, kfs[0].t[0]], zoom: { x: 0.5, y: 0.5, scale: 1 }, webcam: webcamPos(0.5, 0.5) });
  }
  result.push(...kfs);

  return result.length ? result : fallback(
    samples.length ? samples[samples.length - 1].time / 1000 : 1
  );
}

// ── Merge samples + events, sorted by time ───────────────────
// Events (click, focus) give precise element chains for interaction
// moments. They're injected into the timeline at their exact time.
function mergeTimeline(samples, events) {
  const pts = samples.map(s => ({
    time:         s.time,
    x:            s.x,
    y:            s.y,
    elementChain: s.elementChain || [],
    isClick:      false,
    isFocus:      false
  }));

  for (const e of events) {
    if (e.type === "click" || e.type === "focus") {
      pts.push({
        time:         e.time,
        x:            e.x || 0.5,
        y:            e.y || 0.5,
        elementChain: e.elementChain || [],
        isClick:      e.type === "click",
        isFocus:      e.type === "focus"
      });
    }
  }

  pts.sort((a, b) => a.time - b.time);
  return pts;
}

// ── Element → zoom target ─────────────────────────────────────
//
// Walk the element chain from the innermost element (chain[0]) upward.
// Pick the FIRST element whose screen area is between MIN_FRAC and MAX_FRAC.
//
// MIN_FRAC (0.5%) — filters out tiny icons, bullets, text spans
// MAX_FRAC (72%)  — filters out full-page scroll containers
//
// Scale: fit the picked element to fill FILL (82%) of the zoomed
// frame on its tighter axis.
//   sw = viewport.w * FILL / element.w  →  how much to zoom to fill width
//   sh = viewport.h * FILL / element.h  →  how much to zoom to fill height
//   scale = min(sw, sh)  →  the tighter axis determines zoom
//
// Center: 80% element center + 20% cursor.
// Element anchor prevents drift; cursor nudge keeps it attentive.
//
// If no valid element found: cursor-follow at 1.4× zoom.


function pointToZoom(point, vp) {
  const chain  = point.elementChain || [];
  const screen = vp.width * vp.height;

  let box = null;
  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const frac = (b.w * b.h) / screen;
    if (frac >= SCALE_MIN && frac < SCALE_MAX) { box = b; break; }
  }

  let scale, cx, cy;

  if (box) {
    const sw = (vp.width  * FILL) / box.w;
    const sh = (vp.height * FILL) / box.h;
    scale = Math.min(Math.max(Math.min(sw, sh), SCALE_MIN), SCALE_MAX);

    const ecx = (box.x + box.w / 2) / vp.width;
    const ecy = (box.y + box.h / 2) / vp.height;

    cx = ecx * 0.80 + (point.x || 0.5) * 0.20;
    cy = ecy * 0.80 + (point.y || 0.5) * 0.20;

    // Nudge away from known fixed chrome
    if (box.x < vp.width  * 0.18) cx += 0.03;
    if (box.x + box.w > vp.width  * 0.82) cx -= 0.03;
    if (box.y < vp.height * 0.10) cy += 0.04;
  } else {
    scale = 1.40;
    cx    = point.x || 0.5;
    cy    = point.y || 0.5;
  }

  // Clicks and focus events get a small scale boost (max +10%)
  // so interactions visually stand out
  if (point.isClick) scale = Math.min(scale * 1.08, SCALE_MAX);
  if (point.isFocus) scale = Math.min(scale * 1.04, SCALE_MAX);

  const clamped = clampCenter(cx, cy, scale);
  return { cx: clamp(clamped.x), cy: clamp(clamped.y), scale };
}

// ── Stabilizer ────────────────────────────────────────────────
//
// Problem: cursor hovering near an element boundary causes rapid
// alternation between two zoom targets → shaking hand effect.
//
// Solution: dwell-based zone locking.
//
//   DWELL_N = 12 consecutive samples (~600ms at 50ms/sample)
//   ZONE_POS   = how close two targets must be to count as "same zone"
//   ZONE_SCALE = same, for scale axis
//
// State machine:
//   LOCKED  — we have a confirmed zoom zone; emit it for every sample
//              that stays within ZONE_POS/SCALE of the locked values.
//              If a sample drifts outside, start BUFFERING.
//
//   BUFFERING — collecting samples to see if the new position is stable.
//               If DWELL_N consecutive samples stay within ZONE_* of
//               each other → commit the centroid as the new LOCKED zone.
//               If any sample breaks coherence → reset buffer.
//               While buffering, emit the OLD locked zoom (hold steady).
//
// This means the camera only moves when the user has genuinely
// settled into a new area for ~600ms. Short hovers and jitter
// at element boundaries are completely invisible in the output.


function stabilize(targets) {
  if (!targets.length) return [];

  // Output: each item is { timeSec, cx, cy, scale } with stabilized values
  const out = [];

  // Locked zone (what we're currently showing)
  let locked = { cx: targets[0].cx, cy: targets[0].cy, scale: targets[0].scale };

  // Buffer of consecutive out-of-zone samples
  let buffer = [];

  function inZone(t, zone) {
    const dPos   = Math.abs(t.cx - zone.cx) + Math.abs(t.cy - zone.cy);
    const dScale = Math.abs(t.scale - zone.scale);
    return dPos <= ZONE_POS && dScale <= ZONE_SCALE;
  }

  function centroid(arr) {
    const n  = arr.length;
    const cx = arr.reduce((s, t) => s + t.cx, 0) / n;
    const cy = arr.reduce((s, t) => s + t.cy, 0) / n;
    const sc = arr.reduce((s, t) => s + t.scale, 0) / n;
    return { cx, cy, scale: sc };
  }

  // Check if all items in buffer are coherent with each other
  // (not just with the first item — avoids slow drift accumulation)
  function bufferIsCoherent(buf) {
    const c = centroid(buf);
    return buf.every(t => inZone(t, c));
  }

  for (const t of targets) {
    if (inZone(t, locked)) {
      // Still in current zone — hold locked values, reset buffer
      buffer = [];
      out.push({ timeSec: t.timeSec, cx: locked.cx, cy: locked.cy, scale: locked.scale });
    } else {
      // Outside current zone — start/continue buffering
      buffer.push(t);

      if (buffer.length >= DWELL_N && bufferIsCoherent(buffer)) {
        // Confirmed new zone — commit
        locked = centroid(buffer);
        buffer = [];
        out.push({ timeSec: t.timeSec, cx: locked.cx, cy: locked.cy, scale: locked.scale });
      } else if (buffer.length >= DWELL_N && !bufferIsCoherent(buffer)) {
        // Buffer is incoherent (cursor is wandering, not settling)
        // Drop oldest sample and keep trying
        buffer.shift();
        // Emit locked (hold steady while user wanders)
        out.push({ timeSec: t.timeSec, cx: locked.cx, cy: locked.cy, scale: locked.scale });
      } else {
        // Still accumulating — emit locked (hold steady)
        out.push({ timeSec: t.timeSec, cx: locked.cx, cy: locked.cy, scale: locked.scale });
      }
    }
  }

  return out;
}

// ── Collapse into keyframes ───────────────────────────────────
//
// After stabilization, consecutive identical (or very similar)
// values are collapsed into a single keyframe.
// A new keyframe is emitted only when the stabilized values
// actually change — which now only happens on genuine zone commits.


function collapse(stable) {
  if (!stable.length) return [];

  const kfs    = [];
  let anchor   = stable[0];
  let tStart   = stable[0].timeSec;
  const endSec = stable[stable.length - 1].timeSec;

  function emit(tEnd) {
    if (tEnd - tStart < MIN_KF) return;
    kfs.push({
      t:      [parseFloat(tStart.toFixed(3)), parseFloat(tEnd.toFixed(3))],
      zoom:   {
        x:     parseFloat(anchor.cx.toFixed(4)),
        y:     parseFloat(anchor.cy.toFixed(4)),
        scale: parseFloat(anchor.scale.toFixed(4))
      },
      webcam: webcamPos(anchor.cx, anchor.cy)
    });
  }

  for (let i = 1; i < stable.length; i++) {
    const t      = stable[i];
    const dPos   = Math.abs(anchor.cx - t.cx) + Math.abs(anchor.cy - t.cy);
    const dScale = Math.abs(anchor.scale - t.scale);

    if (dPos > KF_POS || dScale > KF_SCALE) {
      emit(t.timeSec);
      tStart = t.timeSec;
      anchor = t;
    }
    // else extend current keyframe silently
  }

  emit(endSec);
  return kfs;
}

// ── Helpers ───────────────────────────────────────────────────
function clamp(v, lo = 0.05, hi = 0.95) {
  return Math.max(lo, Math.min(hi, v));
}

function clampCenter(cx, cy, scale) {
  const half = 0.5 / scale;
  return { x: clamp(cx, half, 1 - half), y: clamp(cy, half, 1 - half) };
}

function webcamPos(cx, cy) {
  return {
    x: cx < 0.5 ? 0.78 : 0.00,
    y: cy < 0.5 ? 0.78 : 0.00,
    w: 0.22, h: 0.22
  };
}

function fallback(durSec) {
  return [{
    t:      [0, durSec],
    zoom:   { x: 0.5, y: 0.5, scale: 1 },
    webcam: { x: 0.78, y: 0.78, w: 0.22, h: 0.22 }
  }];
}
