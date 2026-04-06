let recording = false;

let screenRecorder = null;
let screenChunks = [];
let screenStream = null;

console.log("Content script loaded");
let lastX = 0;
let lastY = 0;
let lastTime = performance.now();

let recentSamples = [];

function getElementData(el) {
  if (!el) return null;

  const rect = el.getBoundingClientRect();

  return {
    tag: el.tagName,
    textLength: (el.innerText || "").length,
    boundingBox: {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    },
  };
}

function sample() {
  if (!recording) return;

  if (recording) {
    console.log("Sampling...", lastX, lastY);
  }

  const t = performance.now();

  const x = lastX / window.innerWidth;
  const y = lastY / window.innerHeight;

  const el = document.elementFromPoint(lastX, lastY);
  const element = getElementData(el);

  const dt = t - lastTime;
  const dx = lastX - (recentSamples.at(-1)?.rawX || lastX);
  const dy = lastY - (recentSamples.at(-1)?.rawY || lastY);

  const velocity = Math.sqrt(dx * dx + dy * dy) / (dt || 1);

  const sample = {
    time: t,
    x,
    y,
    rawX: lastX,
    rawY: lastY,
    velocity,
    element,
  };

  recentSamples.push(sample);

  // keep last ~1 sec
  if (recentSamples.length > 20) {
    recentSamples.shift();
  }

  chrome.runtime.sendMessage({ type: "sample", data: sample });

  lastTime = t;
}

setInterval(sample, 50);

document.addEventListener("mousemove", (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
});

document.addEventListener("click", (e) => {
  if (!recording) return;

  const el = document.elementFromPoint(e.clientX, e.clientY);

  chrome.runtime.sendMessage({
    type: "event",
    data: {
      type: "click",
      time: performance.now(),
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
      time: performance.now(),
      context: [...recentSamples],
    },
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "START") {
    recording = false;
    navigator.mediaDevices
      .getDisplayMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        screenStream = stream;
        screenChunks = [];

        screenRecorder = new MediaRecorder(stream);

        screenRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            screenChunks.push(e.data);
          }
        };

        screenRecorder.start();
        recording = true;
        console.log("Screen recording started");
      })
      .catch((err) => {
        console.error("Screen capture failed:", err);
      });
    console.log("Recording ON");
  }

  if (msg.type === "STOP") {
    recording = false;
    if (screenRecorder) {
      screenRecorder.stop();

      screenRecorder.onstop = () => {
        const blob = new Blob(screenChunks, {
          type: "video/webm",
        });

        const reader = new FileReader();

        reader.onload = function () {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_VIDEO",
            data: reader.result,
          });
        };

        reader.readAsDataURL(blob);
      };

      screenStream.getTracks().forEach((track) => track.stop());
    }
    console.log("Recording OFF");
  }
});
