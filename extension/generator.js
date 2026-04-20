// ============================================================
//  generator.js — Script Generator v5
//
//  Input  (fixed):
//    { samples[], events[], meta:{ viewport:{width,height} } }
//  Output (fixed):
//    [{ t:[startSec,endSec], zoom:{x,y,scale}, webcam:{x,y,w,h} }]
// ============================================================

const BUCKET_MS = 50; // matches content.js setInterval

// ── Velocity thresholds (normalised px/ms) ────────────────────
const V_STABLE = 0.04;
const V_FAST   = 0.18;

// ── Scale range ───────────────────────────────────────────────
const SCALE_MIN = 1.00;
const SCALE_MAX = 1.75;

// Card target fill: card should occupy this fraction of the
// visible frame on the TIGHTER axis.
const CARD_FILL = 0.82;

// ── Scale table (state → scale when NO card found) ───────────
// These are intentionally meaningful — never less than 1.3x
// for focused states, so the viewer always gets a real zoom.
const SCALE_BY_STATE = {
  clicking:   1.65,
  typing:     1.60,
  focusing:   1.55,
  reading:    1.45,
  navigating: 1.40,
  idle:       1.35,
  scrolling:  1.00,
  moving:     1.00,
};

// ── Camera blend ─────────────────────────────────────────────
// 0.80 = camera reaches 80% of the distance to target per keyframe.
// High value means decisive movement, not mushy drift.
const BLEND = 0.80;

// ── Dedup: only collapse truly identical holds ────────────────
const DEDUP_POS   = 0.010;
const DEDUP_SCALE = 0.020;

// ── Segment break: Y-grid fallback ───────────────────────────
// When card detection fails, divide the viewport into Y-bands.
// Moving from one band to another → new segment.
// 8 bands = each band is 12.5% of viewport height.
const Y_GRID_BANDS = 8;

// ─── Helpers ─────────────────────────────────────────────────
function clamp(v, lo = 0.05, hi = 0.95) {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
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

// ── State classifier ─────────────────────────────────────────
function classifyState(f) {
  if (f.hasClick)                           return "clicking";
  if (f.hasKey)                             return "typing";
  if (f.hasFocus && f.avgV < V_STABLE)      return "focusing";
  if (f.isScrolling)                        return "scrolling";
  if (f.avgV >= V_FAST)                     return "moving";
  if (f.avgV < V_STABLE && f.dominantChain) return "reading";
  if (f.avgV < V_STABLE)                    return "idle";
  return "moving";
}

function stateCategory(state) {
  if (state === "clicking" || state === "typing" || state === "focusing") return "interacting";
  if (state === "scrolling" || state === "moving")                        return "moving";
  return "scanning";
}

// ── Card finder ───────────────────────────────────────────────
//
// WHAT IS A CARD:
//   An element whose parent is significantly (≥ PARENT_RATIO) larger.
//   This identifies natural content containers: repo rows, cards,
//   panels, modals, sidebar items — anything visually distinct.
//
// ALGORITHM:
//   Walk chain[0..n] (from cursor element upward).
//   At each step compare el.area vs parent.area.
//   The first element where parent is PARENT_RATIO× larger = the card.
//
// THRESHOLDS:
//   - Minimum card area: 0.5% of screen (avoids tiny decorative elements)
//   - Maximum card area: 90% of screen (avoids the page body)
//   - PARENT_RATIO: 1.6× — tuned for typical layout hierarchies
//
// FALLBACK (Pass 2):
//   If no parent-jump found (e.g. flat HTML structure), take the
//   first element in a 3%–70% size range.

const PARENT_RATIO    = 1.60;
const MIN_CARD_FRAC   = 0.005;  // 0.5% of screen
const MAX_CARD_FRAC   = 0.90;   // 90% of screen

function findCard(chain, viewport) {
  if (!chain?.length) return null;
  const screen = viewport.width * viewport.height;

  // Pass 1: natural parent-size jump
  for (let i = 0; i < chain.length; i++) {
    const box = chain[i].boundingBox;
    if (!box || box.w <= 0 || box.h <= 0) continue;

    const elArea   = box.w * box.h;
    const elFrac   = elArea / screen;

    if (elFrac < MIN_CARD_FRAC) continue;  // too tiny
    if (elFrac > MAX_CARD_FRAC) continue;  // this IS the page

    const parentBox = chain[i + 1]?.boundingBox;

    if (!parentBox || parentBox.w <= 0 || parentBox.h <= 0) {
      // No valid parent → this element is the card boundary
      return box;
    }

    const parentFrac = (parentBox.w * parentBox.h) / screen;

    if (parentFrac > MAX_CARD_FRAC) {
      // Parent is the page → current element IS the card
      return box;
    }

    if ((parentBox.w * parentBox.h) >= elArea * PARENT_RATIO) {
      // Parent is significantly larger → found the boundary
      return box;
    }
  }

  // Pass 2: size-range fallback
  for (const el of chain) {
    const box = el.boundingBox;
    if (!box || box.w <= 0 || box.h <= 0) continue;
    const frac = (box.w * box.h) / screen;
    if (frac >= 0.03 && frac < 0.65) return box;
  }

  return null;
}

// ── Scale from card geometry ──────────────────────────────────
function scaleFromCard(card, viewport) {
  if (!card) return null;
  const sw = (viewport.width  * CARD_FILL) / card.w;
  const sh = (viewport.height * CARD_FILL) / card.h;
  return Math.min(Math.max(Math.min(sw, sh), SCALE_MIN), SCALE_MAX);
}

function cardCenter(card, viewport) {
  if (!card) return null;
  return {
    x: (card.x + card.w / 2) / viewport.width,
    y: (card.y + card.h / 2) / viewport.height
  };
}

function layoutBias(cx, cy, card, viewport) {
  if (!card) return { x: cx, y: cy };
  let x = cx, y = cy;
  if (card.x < viewport.width  * 0.18) x += 0.03;
  if (card.x + card.w > viewport.width  * 0.82) x -= 0.03;
  if (card.y < viewport.height * 0.10) y += 0.04;
  return { x: clamp(x), y: clamp(y) };
}

// ── Compute zoom target ───────────────────────────────────────
function computeTarget(state, avgX, avgY, chain, viewport) {
  // Moving / scrolling: always zoom out for context
  if (state === "scrolling" || state === "moving") {
    return { cx: clamp(avgX), cy: clamp(avgY), scale: SCALE_BY_STATE[state], card: null };
  }

  const card  = findCard(chain, viewport);
  const cc    = cardCenter(card, viewport);

  let scale, cx, cy;

  if (card && cc) {
    scale = scaleFromCard(card, viewport);
    // 35% cursor, 65% card center — card dominates
    cx = lerp(cc.x, avgX, 0.35);
    cy = lerp(cc.y, avgY, 0.35);
    ;({ x: cx, y: cy } = layoutBias(cx, cy, card, viewport));
  } else {
    // No card found: use cursor position with state-appropriate scale
    scale = SCALE_BY_STATE[state] ?? 1.40;
    cx    = avgX;
    cy    = avgY;
  }

  ;({ x: cx, y: cy } = clampCenter(cx, cy, scale));

  return { cx: clamp(cx), cy: clamp(cy), scale, card };
}

// ── Card identity check ───────────────────────────────────────
// Cards are the "same" only if their centers are within
// CARD_MOVE_FRACTION of the SMALLER card's own size.
// List items (~40px tall): threshold=22px → adjacent rows break.
// Full content panel (~400px tall): threshold=220px → no break.
const CARD_MOVE_FRAC = 0.50;

function cardChanged(cardA, cardB) {
  if (!cardA && !cardB) return false;
  if (!cardA || !cardB) return true;

  const tolW = Math.min(cardA.w, cardB.w) * CARD_MOVE_FRAC;
  const tolH = Math.min(cardA.h, cardB.h) * CARD_MOVE_FRAC;

  const dCx = Math.abs((cardA.x + cardA.w / 2) - (cardB.x + cardB.w / 2));
  const dCy = Math.abs((cardA.y + cardA.h / 2) - (cardB.y + cardB.h / 2));

  return dCx > tolW || dCy > tolH;
}

// ── Y-grid fallback break ─────────────────────────────────────
// When findCard returns null for both current and previous segment,
// we can still detect movement by checking which Y-band the cursor
// is in. Moving from band 2 to band 4 → new segment.
function yBand(normalizedY) {
  return Math.floor(normalizedY * Y_GRID_BANDS);
}

// ── PHASE 1 — Bucketize ───────────────────────────────────────
function bucketize(data) {
  const samples = data.samples || [];
  const events  = data.events  || [];
  if (!samples.length && !events.length) return [];

  let maxTime = 0;
  for (const s of samples) if ((s.time || 0) > maxTime) maxTime = s.time;
  for (const e of events)  if ((e.time || 0) > maxTime) maxTime = e.time;
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

// ── PHASE 2 — Extract features ────────────────────────────────
function extractFeatures(buckets) {
  return buckets.map(b => {
    const s = b.samples;
    const n = s.length;

    const avgX = n ? s.reduce((a, x) => a + x.x, 0) / n : 0.5;
    const avgY = n ? s.reduce((a, x) => a + x.y, 0) / n : 0.5;
    const avgV = n ? s.reduce((a, x) => a + (x.velocity || 0), 0) / n : 0;

    const totalScroll = n ? s.reduce((a, x) => a + (x.scrollDelta || 0), 0) : 0;
    const isScrolling = Math.abs(totalScroll) > 30 && avgV >= V_STABLE;

    // Dominant chain — most-frequent across samples
    let dominantChain = null;
    if (n) {
      const freq = new Map();
      for (const x of s) {
        if (!x.elementChain?.length) continue;
        const key = JSON.stringify(x.elementChain);
        freq.set(key, (freq.get(key) || 0) + 1);
      }
      if (freq.size) {
        let best = null, bestN = 0;
        for (const [k, c] of freq) {
          if (c > bestN) { best = k; bestN = c; }
        }
        dominantChain = JSON.parse(best);
      }
    }

    // Override with more precise event chains
    const focusEv = b.events.find(e => e.type === "focus");
    const clickEv = b.events.find(e => e.type === "click");
    if (focusEv?.elementChain?.length) dominantChain = focusEv.elementChain;
    if (clickEv?.elementChain?.length) dominantChain = clickEv.elementChain;

    const hasClick = b.events.some(e => e.type === "click");
    const hasKey   = b.events.some(e => e.type === "keydown");
    const hasFocus = b.events.some(e => e.type === "focus");

    return {
      tStart: b.tStart,
      tEnd:   b.tEnd,
      avgX, avgY, avgV,
      isScrolling,
      hasClick, hasKey, hasFocus,
      dominantChain,
      samples: b.samples,
      events:  b.events
    };
  });
}

// ── PHASE 3 — Create segments ─────────────────────────────────
//
// Break criteria (in priority order):
//
//  1. Interaction event (click / focus) — always break
//     Gives each interaction its own dedicated keyframe.
//
//  2. State category change
//     interacting / scanning / moving are fundamentally different
//     zoom levels; they always need separate keyframes.
//
//  3. Card identity change (PRIMARY spatial break)
//     Uses card-relative threshold so list items break per row.
//     Requires findCard to return a non-null box.
//
//  4. Y-grid band change (FALLBACK spatial break)
//     When findCard returns null for both current and previous,
//     the viewport is divided into Y_GRID_BANDS rows.
//     Moving from one row to another triggers a break.
//     This guarantees spatial segments even on flat-DOM pages.
//
// No time-based cap. Segment length = however long the user
// stays in the same area.

function createSegments(features, viewport) {
  const segs = [];
  let cur    = null;
  let curCard = null;   // card for current segment (stored separately for break detection)

  function startSeg(f, state, card) {
    curCard = card;
    return {
      tStart:   f.tStart,
      tEnd:     f.tEnd,
      state,
      card,
      hasClick: f.hasClick,
      hasKey:   f.hasKey,
      hasFocus: f.hasFocus,
      isScrolling: f.isScrolling,
      dominantChain: f.dominantChain,
      samples:  [...f.samples],
      events:   [...f.events],
      _sx: f.avgX, _sy: f.avgY, _sv: f.avgV, _n: 1
    };
  }

  function flush() {
    if (!cur) return;
    const durMs = cur.tEnd - cur.tStart;
    if (durMs >= 150) {
      cur.avgX = cur._sx / cur._n;
      cur.avgY = cur._sy / cur._n;
      cur.avgV = cur._sv / cur._n;
      delete cur._sx; delete cur._sy; delete cur._sv; delete cur._n;
      segs.push(cur);
    }
    cur = null;
    curCard = null;
  }

  for (const f of features) {
    const state = classifyState(f);
    const card  = findCard(f.dominantChain, viewport);

    if (!cur) {
      cur = startSeg(f, state, card);
      continue;
    }

    // ── Break conditions ──────────────────────────────────
    const interactionEvent = f.hasClick || f.hasFocus;
    const categoryChanged  = stateCategory(state) !== stateCategory(cur.state);

    // Card-based spatial break
    const cardBreak = cardChanged(curCard, card);

    // Y-grid fallback: when BOTH cards are null, use Y-band position
    const yGridBreak = (!curCard && !card)
      && (yBand(f.avgY) !== yBand(cur._sy / cur._n));

    const shouldBreak = interactionEvent || categoryChanged || cardBreak || yGridBreak;

    if (shouldBreak) {
      flush();
      cur = startSeg(f, state, card);
    } else {
      cur.tEnd       = f.tEnd;
      cur._sx       += f.avgX;
      cur._sy       += f.avgY;
      cur._sv       += f.avgV;
      cur._n        += 1;

      // Upgrade state/chain on interaction within segment
      if (f.hasClick || f.hasFocus) {
        cur.state         = state;
        cur.dominantChain = f.dominantChain || cur.dominantChain;
        if (card) { cur.card = card; curCard = card; }
      }

      cur.hasClick    = cur.hasClick    || f.hasClick;
      cur.hasKey      = cur.hasKey      || f.hasKey;
      cur.hasFocus    = cur.hasFocus    || f.hasFocus;
      cur.isScrolling = cur.isScrolling || f.isScrolling;
      cur.samples     = cur.samples.concat(f.samples);
      cur.events      = cur.events.concat(f.events);
    }
  }

  flush();
  return segs;
}

// ── PHASE 4 — Build timeline ──────────────────────────────────
function buildTimeline(segments, viewport) {
  const DEFAULT = { x: 0.5, y: 0.5, scale: 1.0 };
  let prev      = { ...DEFAULT };
  const out     = [];

  for (const seg of segments) {
    if (seg.tEnd - seg.tStart < 250) continue;

    const chain =
      seg.events.find(e => e.type === "click")?.elementChain ||
      seg.events.find(e => e.type === "focus")?.elementChain ||
      seg.dominantChain ||
      seg.samples[0]?.elementChain;

    const target = computeTarget(seg.state, seg.avgX, seg.avgY, chain, viewport);

    const zoom = {
      x:     lerp(prev.x,     target.cx,    BLEND),
      y:     lerp(prev.y,     target.cy,    BLEND),
      scale: lerp(prev.scale, target.scale, BLEND)
    };

    prev = zoom;
    out.push({
      t:      [seg.tStart / 1000, seg.tEnd / 1000],
      zoom,
      webcam: webcamPos(zoom.x, zoom.y)
    });
  }

  return out;
}

// ── PHASE 5 — Dedup identical holds ──────────────────────────
function dedup(timeline) {
  if (!timeline.length) return [];
  const out  = [{ ...timeline[0], t: [...timeline[0].t] }];
  const last = () => out[out.length - 1];

  for (let i = 1; i < timeline.length; i++) {
    const cur    = timeline[i];
    const dPos   = Math.abs(last().zoom.x     - cur.zoom.x) + Math.abs(last().zoom.y - cur.zoom.y);
    const dScale = Math.abs(last().zoom.scale - cur.zoom.scale);
    if (dPos < DEDUP_POS && dScale < DEDUP_SCALE) {
      last().t[1] = cur.t[1];
    } else {
      out.push({ ...cur, t: [...cur.t] });
    }
  }
  return out;
}

// ── Fallback ─────────────────────────────────────────────────
function fallback(data) {
  let dur = 1000;
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
  const viewport = data.meta?.viewport || { width: 1920, height: 1080 };
  if (!data.samples?.length && !data.events?.length) return fallback(data);

  const buckets  = bucketize(data);
  const features = extractFeatures(buckets);
  const segments = createSegments(features, viewport);
  if (!segments.length) return fallback(data);

  const raw   = buildTimeline(segments, viewport);
  if (!raw.length) return fallback(data);

  const final = dedup(raw);
  return final.length ? final : fallback(data);
}

// ── Debug report ──────────────────────────────────────────────
// Runs the same pipeline and captures intermediate state at each
// phase. Downloaded as debug.json so you can inspect exactly
// what the generator saw and decided.
function generateDebugReport(data, script) {
  const viewport = data.meta?.viewport || { width: 1920, height: 1080 };
  const samples  = data.samples || [];
  const events   = data.events  || [];

  // Re-run pipeline with diagnostics captured
  const buckets  = bucketize(data);
  const features = extractFeatures(buckets);
  const segments = createSegments(features, viewport);

  // Per-segment diagnostics
  const segDiag = segments.map(seg => {
    const chain =
      seg.events.find(e => e.type === "click")?.elementChain ||
      seg.events.find(e => e.type === "focus")?.elementChain ||
      seg.dominantChain ||
      seg.samples[0]?.elementChain;

    const card   = findCard(chain, viewport);
    const target = computeTarget(seg.state, seg.avgX, seg.avgY, chain, viewport);

    // Summarise the element chain (don't dump full chain — too verbose)
    const chainSummary = (chain || []).slice(0, 6).map(el => ({
      tag:  el.tag,
      box:  el.boundingBox,
      area: el.boundingBox
        ? `${Math.round((el.boundingBox.w * el.boundingBox.h) / (viewport.width * viewport.height) * 100)}%`
        : null
    }));

    return {
      duration:     `${((seg.tEnd - seg.tStart) / 1000).toFixed(2)}s`,
      t:            [seg.tStart / 1000, seg.tEnd / 1000],
      state:        seg.state,
      category:     stateCategory(seg.state),
      sampleCount:  seg.samples.length,
      eventCount:   seg.events.length,
      avgX:         +seg.avgX.toFixed(3),
      avgY:         +seg.avgY.toFixed(3),
      avgV:         +seg.avgV.toFixed(4),
      flags:        {
        hasClick:   seg.hasClick,
        hasKey:     seg.hasKey,
        hasFocus:   seg.hasFocus,
        isScrolling: seg.isScrolling
      },
      cardFound:    card !== null,
      card:         card ? {
        x: card.x, y: card.y, w: card.w, h: card.h,
        areaFrac: `${Math.round((card.w * card.h) / (viewport.width * viewport.height) * 100)}%`
      } : null,
      computedTarget: {
        cx:    +target.cx.toFixed(3),
        cy:    +target.cy.toFixed(3),
        scale: +target.scale.toFixed(3)
      },
      chainDepth:   (chain || []).length,
      chainSummary
    };
  });

  // Sample of raw data (first 5 samples with full chains, for DOM inspection)
  const sampleProbe = samples.slice(0, 5).map(s => ({
    time:          s.time,
    x:             s.x,
    y:             s.y,
    velocity:      s.velocity,
    chainDepth:    (s.elementChain || []).length,
    chain:         (s.elementChain || []).map(el => ({
      tag:  el.tag,
      cls:  el.cls,
      box:  el.boundingBox,
      area: el.boundingBox
        ? `${Math.round((el.boundingBox.w * el.boundingBox.h) / (viewport.width * viewport.height) * 100)}%`
        : null
    }))
  }));

  // Velocity histogram (shows distribution of cursor speeds)
  const velBuckets = [0, 0, 0, 0, 0]; // [<0.02, 0.02-0.05, 0.05-0.10, 0.10-0.20, >0.20]
  for (const s of samples) {
    const v = s.velocity || 0;
    if      (v < 0.02) velBuckets[0]++;
    else if (v < 0.05) velBuckets[1]++;
    else if (v < 0.10) velBuckets[2]++;
    else if (v < 0.20) velBuckets[3]++;
    else               velBuckets[4]++;
  }

  return {
    _description: "Recorder debug output. Use this to diagnose segment/zoom issues.",
    meta: {
      viewport,
      sampleCount:  samples.length,
      eventCount:   events.length,
      durationSec:  samples.length
        ? +((samples[samples.length - 1].time - samples[0].time) / 1000).toFixed(2)
        : 0
    },
    velocityDistribution: {
      "< 0.02 (still)":    velBuckets[0],
      "0.02–0.05 (slow)":  velBuckets[1],
      "0.05–0.10 (medium)": velBuckets[2],
      "0.10–0.20 (fast)":  velBuckets[3],
      "> 0.20 (very fast)": velBuckets[4]
    },
    eventSummary: events.map(e => ({ type: e.type, time: e.time })),
    segmentCount: segments.length,
    segments:     segDiag,
    scriptKeyframes: script.length,
    script,
    sampleProbe
  };
}
