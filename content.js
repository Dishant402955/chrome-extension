let recording = false;
let startTime = 0;

let screenRecorder = null;
let screenChunks = [];
let screenStream = null;

let lastX = 0;
let lastY = 0;
let lastTime = performance.now();

let recentSamples = [];

// ---------------- ELEMENT CHAIN ----------------
function getElementChain(el) {
  const chain = [];
  let current = el;
  let depth = 0;

  while (current && depth < 5) {
    const rect = current.getBoundingClientRect();

    chain.push({
      tag: current.tagName,
      textLength: (current.innerText || "").length,
      boundingBox: {
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height
      },
      clickable:
        current.tagName === "BUTTON" ||
        current.tagName === "A" ||
        current.onclick != null
    });

    current = current.parentElement;
    depth++;
  }

  return chain;
}

// ---------------- SAMPLE ----------------
function sample() {
  if (!recording) return;

  const now = performance.now();
  const time = now - startTime;

  if (time < 0) return;

  const x = lastX / window.innerWidth;
  const y = lastY / window.innerHeight;

  const el = document.elementFromPoint(lastX, lastY);
  const chain = getElementChain(el);

  const dt = now - lastTime;
  const dx = lastX - (recentSamples.at(-1)?.rawX || lastX);
  const dy = lastY - (recentSamples.at(-1)?.rawY || lastY);

  const velocity = Math.sqrt(dx * dx + dy * dy) / (dt || 1);

  const s = {
    time,
    x,
    y,
    rawX: lastX,
    rawY: lastY,
    velocity,
    elementChain: chain
  };

  recentSamples.push(s);
  if (recentSamples.length > 20) recentSamples.shift();

  chrome.runtime.sendMessage({ type: "sample", data: s });

  lastTime = now;
}

setInterval(sample, 50);

// ---------------- MOUSE ----------------
document.addEventListener("mousemove", (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
});

// ---------------- EVENTS ----------------
document.addEventListener("click", (e) => {
  if (!recording) return;

  const time = performance.now() - startTime;
  const chain = getElementChain(
    document.elementFromPoint(e.clientX, e.clientY)
  );

  chrome.runtime.sendMessage({
    type: "event",
    data: {
      type: "click",
      time,
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
      elementChain: chain,
      context: [...recentSamples]
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;

  const time = performance.now() - startTime;

  chrome.runtime.sendMessage({
    type: "event",
    data: {
      type: "keydown",
      key: e.key,
      time,
      context: [...recentSamples]
    }
  });
});

// ---------------- START ----------------
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

      chrome.runtime.sendMessage({
        type: "INIT",
        data: {
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight
          },
          initialDOM: [] // no longer needed heavy DOM
        }
      });

      recording = true;
      console.log("Recording started (with DOM chain)");
    });
  }

  if (msg.type === "STOP") {
    recording = false;

    if (screenRecorder) {
      screenRecorder.stop();

      screenRecorder.onstop = () => {
        const blob = new Blob(screenChunks, {
          type: "video/webm"
        });

        const reader = new FileReader();

        reader.onload = function () {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_VIDEO",
            data: reader.result
          });
        };

        reader.readAsDataURL(blob);
      };

      screenStream.getTracks().forEach((t) => t.stop());
    }
  }
});