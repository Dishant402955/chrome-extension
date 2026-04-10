function bucketize (data) {
  const size = 100;

  const samples = data.samples || [];
  const events = data.events || [];

  const maxTime = Math.max(
    ...samples.map(s => s.time || 0),
    ...events.map(e => e.time || 0),
    0
  );

  const buckets = [];

  for (let t = 0; t <= maxTime; t += size) {
    buckets.push({
      tStart: t,
      tEnd: t + size,
      samples: [],
      events: []
    });
  }

  function fill(arr, key) {
    arr.forEach(x => {
      if (x.time == null) return;
      const i = Math.floor(x.time / size);
      if (buckets[i]) buckets[i][key].push(x);
    });
  }

  fill(samples, "samples");
  fill(events, "events");

  return buckets;
};

function extractFeatures(buckets) {
  return buckets.map(b => {
    const s = b.samples;

    let avgX = 0, avgY = 0, avgV = 0;

    if (s.length) {
      avgX = s.reduce((a, x) => a + x.x, 0) / s.length;
      avgY = s.reduce((a, x) => a + x.y, 0) / s.length;
      avgV = s.reduce((a, x) => a + x.velocity, 0) / s.length;
    }

    // ✅ dominant chain (not element anymore)
    let dominantChain = null;

    if (s.length) {
      const map = {};

      s.forEach(x => {
        const key = JSON.stringify(x.elementChain);
        map[key] = (map[key] || 0) + 1;
      });

      const best = Object.entries(map).sort((a, b) => b[1] - a[1])[0];
      dominantChain = best ? JSON.parse(best[0]) : null;
    }

    return {
      tStart: b.tStart,
      tEnd: b.tEnd,
      avgX,
      avgY,
      avgV,
      hasClick: b.events.some(e => e.type === "click"),
      hasKey: b.events.some(e => e.type === "keydown"),
      cursorCenter: { x: avgX, y: avgY },
      dominantChain,
      samples: b.samples,
      events: b.events
    };
  });
};

function classifyStates (features) {
  return features.map(f => {
    let state = "idle";

    if (f.hasClick || f.hasKey) state = "interaction";
    else if (f.avgV < 0.05 && f.dominantChain) state = "focus";
    else if (f.avgV >= 0.05) state = "moving";

    return { ...f, state };
  });
};

function createSegments(states) {
  const segs = [];
  let cur = null;

  states.forEach(s => {
    if (!cur) {
      cur = { ...s };
      return;
    }

    if (s.state === cur.state) {
      cur.tEnd = s.tEnd;

      cur.avgX = (cur.avgX + s.avgX) / 2;
      cur.avgY = (cur.avgY + s.avgY) / 2;
      cur.avgV = (cur.avgV + s.avgV) / 2;

      // merge samples/events
      cur.samples = [...(cur.samples || []), ...(s.samples || [])];
      cur.events = [...(cur.events || []), ...(s.events || [])];

    } else {
      if (cur.tEnd - cur.tStart >= 250) {
        segs.push(cur);
      }
      cur = { ...s };
    }
  });

  if (cur && cur.tEnd - cur.tStart >= 250) {
    segs.push(cur);
  }

  return segs;
};

const DEFAULT = { x: 0.5, y: 0.5, scale: 1 };

function clamp(v, min = 0.05, max = 0.95) {
  return Math.max(min, Math.min(max, v));
}

// ---------------- PICK CONTAINER ----------------
function pickContainer(chain, viewport) {
  if (!chain || !chain.length) return null;

  const screen = viewport.width * viewport.height;

  for (let el of chain) {
    const box = el.boundingBox;
    if (!box) continue;

    const ratio = (box.w * box.h) / screen;

    if (ratio > 0.05 && ratio < 0.6) return box;
  }

  return chain[0]?.boundingBox || null;
}

function expandBox(box, viewport) {
  if (!box) return box;

  const minWidth = viewport.width * 0.35;
  const minHeight = viewport.height * 0.25;

  let w = Math.max(box.w, minWidth);
  let h = Math.max(box.h, minHeight);

  let cx = box.x + box.w / 2;
  let cy = box.y + box.h / 2;

  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h
  };
}
// ---------------- CENTER ----------------
function getCenter(box, viewport) {
  if (!box) return null;

  return {
    x: (box.x + box.w / 2) / viewport.width,
    y: (box.y + box.h / 2) / viewport.height
  };
}

function clampCenterForScale(center, scale) {
  if (!center) return center;

  const half = 1 / scale / 2;

  // 🔥 allow overshoot (black edges allowed)
  const min = -half * 0.3;
  const max = 1 + half * 0.3;

  return {
    x: Math.max(min, Math.min(max, center.x)),
    y: Math.max(min, Math.min(max, center.y))
  };
}

// ---------------- FIX SIDEBAR OFFSET ----------------
function adjustForLayoutBias(center, box, viewport) {
  if (!box) return center;

  const leftBias = box.x < viewport.width * 0.25;
  const rightBias = box.x + box.w > viewport.width * 0.75;

  let x = center.x;

  if (leftBias) x += 0.05;
  if (rightBias) x -= 0.05;

  return {
    x: clamp(x),
    y: clamp(center.y)
  };
}

// ---------------- SCALE ----------------
function getScale(seg, box, viewport) {
  const fast = seg.avgV > 0.15;
  const stable = seg.avgV < 0.05;

  if (seg.hasClick) return 1.6;
  if (seg.hasKey) return 1.5;
  if (fast) return 1;

  if (stable) {
    if (!box) return 1.2;

    const ratio = (box.w * box.h) / (viewport.width * viewport.height);
    let scale = 1 / Math.sqrt(ratio);

    const aspect = box.w / box.h;
    if (aspect < 0.6) {
      scale = Math.min(scale, 1.3);
    }

    return Math.min(Math.max(scale, 1.2), 1.8);
  }

  return 1.1;
}


function blend(cursor, dom) {
  if (!dom) return cursor;

  return {
    x: cursor.x * 0.75 + dom.x * 0.25,
    y: cursor.y * 0.75 + dom.y * 0.25
  };
}

// ---------------- STABILITY CHECK ----------------
function isSimilar(a, b) {
  return (
    Math.abs(a.x - b.x) < 0.025 &&
    Math.abs(a.y - b.y) < 0.025 &&
    Math.abs(a.scale - b.scale) < 0.08
  );
}

// ---------------- SMOOTH ----------------
function smooth(prev, next, f = 0.3) {
  return {
    x: prev.x * (1 - f) + next.x * f,
    y: prev.y * (1 - f) + next.y * f,
    scale: prev.scale * (1 - f) + next.scale * f
  };
}

function applyRules (segments, viewport) {
  let prev = { ...DEFAULT };
  const output = [];

  for (let seg of segments) {

    // ignore micro segments
    if (seg.tEnd - seg.tStart < 400) continue;

    const chain =
      seg.events?.[0]?.elementChain ||
      seg.dominantChain ||
      seg.samples?.[0]?.elementChain;

    let box = pickContainer(chain, viewport);
box = expandBox(box, viewport);

    const domCenter = getCenter(box, viewport);
    const cursor = seg.cursorCenter || DEFAULT;

    // 🔥 compute center
    let center = domCenter ? blend(cursor, domCenter):DEFAULT;
    center = adjustForLayoutBias(center, box, viewport);

    let scale = getScale(seg, box || {}, viewport);

    // 🔥 MAIN FIX: constrain center based on zoom
    center = clampCenterForScale(center, scale);

    let zoom = {
      x: clamp(center.x),
      y: clamp(center.y),
      scale
    };

    // stabilize
    if (isSimilar(prev, zoom)) {
      zoom = prev;
    } else {
      zoom = smooth(prev, zoom, 0.3);
    }

    prev = zoom;

    output.push({
      t: [seg.tStart / 1000, seg.tEnd / 1000],
      zoom
    });
  }

  return output;
};

function dist(a, b) {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y)
  );
}

function scaleDiff(a, b) {
  return Math.abs(a.scale - b.scale);
}

function smoothTimeline(timeline) {
  if (!timeline.length) return [];

  const result = [];

  let anchor = timeline[0]; // 🔥 current stable zoom

  for (let i = 0; i < timeline.length; i++) {
    const curr = timeline[i];

    const move = dist(anchor.zoom, curr.zoom);
    const scaleChange = scaleDiff(anchor.zoom, curr.zoom);

    const BIG_MOVE = 0.12;      // position threshold
    const BIG_SCALE = 0.25;     // scale threshold

    const shouldSwitch =
      move > BIG_MOVE || scaleChange > BIG_SCALE;

    if (shouldSwitch) {
      // 🔥 commit previous anchor
      result.push(anchor);

      // 🔥 switch anchor
      anchor = { ...curr };
    } else {
      // 🔥 extend current anchor
      anchor.t[1] = curr.t[1];
    }
  }

  result.push(anchor);

  return result;
};

function generateScript(data) {
  const viewport = data.meta?.viewport || { width: 1920, height: 1080 };

  const buckets = bucketize(data);
  const features = extractFeatures(buckets);
  const states = classifyStates(features);
  const segments = createSegments(states);
  const timeline = applyRules(segments, viewport);
  const smooth = smoothTimeline(timeline);

  return smooth;
}
