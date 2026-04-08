let recording = false;

let screenRecorder = null;
let screenChunks = [];
let screenStream = null;

let startTime = 0;

let lastX = 0;
let lastY = 0;
let lastTime = performance.now();

let recentSamples = [];

// SAMPLE LOOP
function sample() {
  if (!recording) return;

  const t = performance.now();

  const el = document.elementFromPoint(lastX, lastY);

  const prev = recentSamples[recentSamples.length - 1];

  const dx = lastX - (prev ? prev.rawX : lastX);
  const dy = lastY - (prev ? prev.rawY : lastY);
  const dt = t - lastTime;

  const velocity = Math.sqrt(dx * dx + dy * dy) / (dt || 1);

  const sample = {
    time: t - startTime,
    x: lastX / window.innerWidth,
    y: lastY / window.innerHeight,
    rawX: lastX,
    rawY: lastY,
    velocity,
    element: getElementData(el),
  };

  recentSamples.push(sample);
  if (recentSamples.length > 20) recentSamples.shift();

  chrome.runtime.sendMessage({ type: "sample", data: sample });

  lastTime = t;
}

setInterval(sample, 50);

// MOUSE
document.addEventListener("mousemove", (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
});

// EVENTS
document.addEventListener("click", (e) => {
  if (!recording) return;

  const el = document.elementFromPoint(e.clientX, e.clientY);

  chrome.runtime.sendMessage({
    type: "event",
    data: {
      type: "click",
      time: performance.now() - startTime,
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
      element: getElementData(el),
      context: [...recentSamples],
    },
  });
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;

  chrome.runtime.sendMessage({
    type: "event",
    data: {
      type: "keydown",
      key: e.key,
      time: performance.now() - startTime,
      context: [...recentSamples],
    },
  });
});

// START / STOP
chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === "START") {
    recording = false;

    navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    }).then((stream) => {

      screenStream = stream;
      screenChunks = [];

      screenRecorder = new MediaRecorder(stream);

      screenRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) screenChunks.push(e.data);
      };

      screenRecorder.start();

startTime = performance.now();

const viewport = {
  width: window.innerWidth,
  height: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio
};

chrome.runtime.sendMessage({
  type: "initialDOM",
  data: {
    elements: captureInitialDOM(),
    viewport
  }
});

      recording = true;

    }).catch(err => {
      console.error(err);
    });
  }

  if (msg.type === "STOP") {
    recording = false;

    if (screenRecorder) {
      screenRecorder.stop();

      screenRecorder.onstop = () => {
        const blob = new Blob(screenChunks, { type: "video/webm" });

        const reader = new FileReader();

        reader.onload = function () {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_VIDEO",
            data: reader.result
          });
        };

        reader.readAsDataURL(blob);
      };

      screenStream.getTracks().forEach(t => t.stop());
    }
  }
});

// MUTATIONS
const observer = new MutationObserver((mutations) => {
  if (!recording) return;

  mutations.forEach((m) => {

    if (m.type === "attributes") return;

    const el = m.target;
    if (!el || !el.getBoundingClientRect) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    chrome.runtime.sendMessage({
      type: "mutation",
      data: {
        time: performance.now() - startTime,
        type: m.type,
        element: {
          tag: el.tagName,
          textLength: (el.innerText || "").length,
          boundingBox: {
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
          }
        }
      }
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

// HELPERS
function getElementData(el) {
  if (!el) return null;

  const r = el.getBoundingClientRect();

  return {
    tag: el.tagName,
    textLength: (el.innerText || "").length,
    boundingBox: {
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height
    }
  };
}

function captureInitialDOM() {
  const out = [];

  document.querySelectorAll("*").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;

    out.push({
      tag: el.tagName,
      textLength: (el.innerText || "").trim().length,
      boundingBox: {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height
      }
    });
  });

  return out;
}