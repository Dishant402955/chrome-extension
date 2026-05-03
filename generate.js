// ============================================================
//  generate.js — reads log.json, outputs script.json
//  Usage: node generate.js log_xxx.json [out.json]
//  Output: { "timeline": [{ "t":[s,e], "zoom":{x,y,scale}, "webcam":{x,y,w,h} }] }
// ============================================================
"use strict";
const fs = require("fs");

// ── CLI ───────────────────────────────────────────────────────
const inputPath  = process.argv[2];
const outputPath = process.argv[3] || inputPath.replace(/\.json$/, "_script.json");
if (!inputPath) { console.error("Usage: node generate.js <log.json> [out.json]"); process.exit(1); }

const log = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const vp  = log.viewport || { width: 1920, height: 1080 };

// ── CONSTANTS (all at top so no TDZ errors) ───────────────────

// Element selection: two-pass
// Pass 1 "content zone": prefer elements 3%–30% of screen area
// Pass 2 "wide fallback": accept 1%–60%
// Skip tiny (<1%) — always hit SCALE_MAX with wrong center
// Skip huge (>60%) — layout wrapper, not content
const ELEM_PREFER_MIN  = 0.030;
const ELEM_PREFER_MAX  = 0.300;
const ELEM_FALLBACK_MIN = 0.010;
const ELEM_FALLBACK_MAX = 0.600;

// Scale
const FILL       = 0.80;  // element fills 80% of zoomed visible frame
const SCALE_MAX  = 2.20;  // cap — 2.5x caused too many edge-clamp issues
const SCALE_MIN  = 1.00;
const CLICK_BOOST = 1.10; // interaction events get a slight scale bump
const FOCUS_BOOST = 1.05;

// Camera center: blend element center + cursor
const EL_WEIGHT  = 0.65;
const CU_WEIGHT  = 0.35;

// Stabilizer zone thresholds
// ZONE_POS = 0.12 normalised (= ~184px on 1536px viewport)
// Generous on purpose: browsing a nav sidebar (items ~32px apart)
// should stay in one zone, not trigger per-item transitions
const ZONE_POS   = 0.12;
const ZONE_SCALE = 0.18;
const DWELL_N    = 8;     // ~400ms at 50ms/sample before committing new zone

// Collapse: tolerance for "identical" consecutive stabilized values
const COLLAPSE_POS   = 0.005;
const COLLAPSE_SCALE = 0.010;

// Keyframe merge (time-weighted centroid)
// Adjacent keyframes within MERGE_POS+MERGE_SCALE get merged.
// Merged value = time-weighted centroid of x, y, scale.
const MERGE_POS   = 0.10;
const MERGE_SCALE = 0.15;

// Minimum keyframe duration to keep
const MIN_KF_SEC = 0.40;

// ── RUN ───────────────────────────────────────────────────────
console.log(`\n[generate] Input:    ${inputPath}`);
console.log(`[generate] Samples:  ${log.samples?.length ?? 0}`);
console.log(`[generate] Events:   ${log.events?.length  ?? 0}`);
console.log(`[generate] Duration: ${((log.durationMs || 0) / 1000).toFixed(2)}s`);
console.log(`[generate] Viewport: ${vp.width}×${vp.height}\n`);

const result = generateScript(log);
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(`[generate] Keyframes: ${result.timeline.length}`);
console.log(`[generate] Output:    ${outputPath}\n`);
result.timeline.forEach((kf, i) => {
  console.log(
    `  [${String(i).padStart(2)}] ${kf.t[0].toFixed(2)}s–${kf.t[1].toFixed(2)}s  ` +
    `zoom(${kf.zoom.x.toFixed(3)}, ${kf.zoom.y.toFixed(3)}, ${kf.zoom.scale.toFixed(3)}x)`
  );
});

// ── ALGORITHM ────────────────────────────────────────────────

function generateScript(log) {
  const samples = log.samples || [];
  const events  = log.events  || [];

  if (!samples.length && !events.length) return { timeline: [fallbackKf(0, 1)] };

  const endSec = (log.durationMs || 0) / 1000
    || (samples.length ? samples[samples.length - 1].time / 1000 : 1);

  const points  = buildPoints(samples, events);
  const raw     = points.map(p => ({ timeSec: p.time / 1000, ...pointToZoom(p) }));
  const stable  = stabilize(raw);
  const kfs     = collapse(stable, endSec);
  const merged  = mergeClose(kfs);

  const timeline = [];
  if (merged.length && merged[0].t[0] > 0.4) timeline.push(fallbackKf(0, merged[0].t[0]));
  timeline.push(...merged);

  return timeline.length ? { timeline } : { timeline: [fallbackKf(0, endSec)] };
}

function buildPoints(samples, events) {
  const pts = samples.map(s => ({
    time: s.time, x: s.x, y: s.y,
    elementChain: s.elementChain || [],
    isClick: false, isFocus: false
  }));
  for (const e of events) {
    if (e.type !== "click" && e.type !== "focus") continue;
    pts.push({ time: e.time, x: e.x || 0.5, y: e.y || 0.5,
      elementChain: e.elementChain || [],
      isClick: e.type === "click", isFocus: e.type === "focus" });
  }
  pts.sort((a, b) => a.time - b.time);
  return pts;
}

// Pick best bounding box from element chain
// Pass 1: content zone (3–30%), Pass 2: wide fallback (1–60%)
function pickElement(chain) {
  const screen = vp.width * vp.height;
  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const frac = (b.w * b.h) / screen;
    if (frac >= ELEM_PREFER_MIN && frac < ELEM_PREFER_MAX) return b;
  }
  for (const el of chain) {
    const b = el.boundingBox;
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const frac = (b.w * b.h) / screen;
    if (frac >= ELEM_FALLBACK_MIN && frac < ELEM_FALLBACK_MAX) return b;
  }
  return null;
}

function pointToZoom(point) {
  const box = pickElement(point.elementChain || []);
  let scale, cx, cy;

  if (box) {
    const sw = (vp.width  * FILL) / box.w;
    const sh = (vp.height * FILL) / box.h;
    scale = Math.min(Math.max(Math.min(sw, sh), SCALE_MIN), SCALE_MAX);

    const ecx = (box.x + box.w / 2) / vp.width;
    const ecy = (box.y + box.h / 2) / vp.height;
    cx = ecx * EL_WEIGHT + (point.x || 0.5) * CU_WEIGHT;
    cy = ecy * EL_WEIGHT + (point.y || 0.5) * CU_WEIGHT;

    // Nudge away from fixed chrome
    if (box.x < vp.width  * 0.18) cx += 0.025;
    if (box.x + box.w > vp.width  * 0.82) cx -= 0.025;
    if (box.y < vp.height * 0.10) cy += 0.035;
  } else {
    scale = 1.40;
    cx    = point.x || 0.5;
    cy    = point.y || 0.5;
  }

  if (point.isClick) scale = Math.min(scale * CLICK_BOOST, SCALE_MAX);
  if (point.isFocus) scale = Math.min(scale * FOCUS_BOOST, SCALE_MAX);

  const cc = clampCenter(cx, cy, scale);
  return { cx: cc.x, cy: cc.y, scale };
}

function stabilize(targets) {
  if (!targets.length) return [];

  const out  = [];
  let locked = { cx: targets[0].cx, cy: targets[0].cy, scale: targets[0].scale };
  let buffer = [];

  const inZone = (t, z) =>
    Math.abs(t.cx - z.cx) + Math.abs(t.cy - z.cy) <= ZONE_POS
    && Math.abs(t.scale - z.scale) <= ZONE_SCALE;

  const centroid = (arr) => ({
    cx:    arr.reduce((s, t) => s + t.cx,    0) / arr.length,
    cy:    arr.reduce((s, t) => s + t.cy,    0) / arr.length,
    scale: arr.reduce((s, t) => s + t.scale, 0) / arr.length
  });

  const coherent = (arr) => { const c = centroid(arr); return arr.every(t => inZone(t, c)); };

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
          buffer.shift();
          out.push({ timeSec: t.timeSec, ...locked });
        }
      } else {
        out.push({ timeSec: t.timeSec, ...locked });
      }
    }
  }
  return out;
}

function collapse(stable, endSec) {
  if (!stable.length) return [];
  const kfs  = [];
  let anchor = stable[0];
  let tStart = stable[0].timeSec;

  const emit = (tEnd) => {
    if (tEnd - tStart < MIN_KF_SEC) return;
    kfs.push({
      t:      [r(tStart), r(tEnd)],
      zoom:   { x: r(anchor.cx), y: r(anchor.cy), scale: r(anchor.scale) },
      webcam: webcamPos(anchor.cx, anchor.cy)
    });
  };

  for (let i = 1; i < stable.length; i++) {
    const t   = stable[i];
    const dP  = Math.abs(anchor.cx - t.cx) + Math.abs(anchor.cy - t.cy);
    const dS  = Math.abs(anchor.scale - t.scale);
    if (dP > COLLAPSE_POS || dS > COLLAPSE_SCALE) {
      emit(t.timeSec); tStart = t.timeSec; anchor = t;
    }
  }
  emit(endSec);
  return kfs;
}

// Time-weighted centroid merge — runs repeatedly until stable
function mergeClose(kfs) {
  if (kfs.length < 2) return kfs;
  let result = kfs, changed = true;

  while (changed) {
    changed = false;
    const next = [];
    let i = 0;
    while (i < result.length) {
      if (i + 1 >= result.length) { next.push(result[i++]); continue; }
      const a = result[i], b = result[i + 1];
      const dP = Math.abs(a.zoom.x - b.zoom.x) + Math.abs(a.zoom.y - b.zoom.y);
      const dS = Math.abs(a.zoom.scale - b.zoom.scale);
      if (dP <= MERGE_POS && dS <= MERGE_SCALE) {
        const dA = a.t[1] - a.t[0], dB = b.t[1] - b.t[0], tot = dA + dB;
        const mx = (a.zoom.x     * dA + b.zoom.x     * dB) / tot;
        const my = (a.zoom.y     * dA + b.zoom.y     * dB) / tot;
        const ms = (a.zoom.scale * dA + b.zoom.scale * dB) / tot;
        next.push({ t: [a.t[0], b.t[1]], zoom: { x: r(mx), y: r(my), scale: r(ms) }, webcam: webcamPos(mx, my) });
        changed = true; i += 2;
      } else { next.push(result[i++]); }
    }
    result = next;
  }
  return result;
}

function webcamPos(cx, cy) {
  return { x: cx < 0.5 ? 0.75 : 0.03, y: cy < 0.5 ? 0.72 : 0.03, w: 0.22, h: 0.22 };
}

function clamp(v, lo = 0.05, hi = 0.95) { return Math.max(lo, Math.min(hi, v)); }

function clampCenter(cx, cy, scale) {
  const half = 0.5 / scale;
  return { x: clamp(cx, half, 1 - half), y: clamp(cy, half, 1 - half) };
}

function r(v) { return parseFloat(v.toFixed(4)); }

function fallbackKf(tStart, tEnd) {
  return { t: [r(tStart), r(tEnd)], zoom: { x: 0.5, y: 0.5, scale: 1.0 }, webcam: webcamPos(0.5, 0.5) };
}