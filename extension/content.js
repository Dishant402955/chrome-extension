let recording = false;
let startTime = 0;

// streams
let screenStream = null;
let webcamStream = null;

// recorders
let screenRecorder = null;
let webcamRecorder = null;

let screenChunks = [];
let webcamChunks = [];

// mouse
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
      }
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

// ---------------- EVENTS ----------------
document.addEventListener("mousemove", (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
});

document.addEventListener("click", (e) => {
  if (!recording) return;

  const time = performance.now() - startTime;

  chrome.runtime.sendMessage({
    type: "event",
    data: {
      type: "click",
      time,
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
      elementChain: getElementChain(
        document.elementFromPoint(e.clientX, e.clientY)
      ),
      context: [...recentSamples]
    }
  });
});

// ---------------- HELPER ----------------
function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ---------------- START / STOP ----------------
chrome.runtime.onMessage.addListener(async (msg) => {

  if (msg.type === "START") {

    recording = false;

    // get streams
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // safety check
    if (!webcamStream || webcamStream.getTracks().length === 0) {
      console.error("Webcam stream is empty");
    }

    screenChunks = [];
    webcamChunks = [];

    screenRecorder = new MediaRecorder(screenStream);
    webcamRecorder = new MediaRecorder(webcamStream);

    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };

    webcamRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) webcamChunks.push(e.data);
    };

    // 🔥 force chunk emission
    screenRecorder.start(1000);
    webcamRecorder.start(1000);

    startTime = performance.now();

    chrome.runtime.sendMessage({
      type: "INIT",
      data: {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }
    });

    recording = true;
    console.log("Recording started (screen + webcam)");
  }

  if (msg.type === "STOP") {

    recording = false;

    // wait for BOTH recorders
    const stopPromises = [];

    stopPromises.push(new Promise(res => {
      screenRecorder.onstop = res;
    }));

    stopPromises.push(new Promise(res => {
      webcamRecorder.onstop = res;
    }));

    screenRecorder.stop();
    webcamRecorder.stop();

    await Promise.all(stopPromises);

    // now safe to build blobs
    const screenBlob = new Blob(screenChunks, { type: "video/webm" });
    const webcamBlob = new Blob(webcamChunks, { type: "video/webm" });

    const screenDataUrl = await blobToDataURL(screenBlob);
    const webcamDataUrl = await blobToDataURL(webcamBlob);

    const script = []; // still placeholder

    chrome.runtime.sendMessage({
      type: "FINAL_DATA",
      data: {
        screenDataUrl,
        webcamDataUrl,
        script
      }
    });

    // 🔥 CRITICAL: stop ALL tracks → fixes webcam staying ON
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
    }

    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
    }

    console.log("Recording fully stopped");
  }
});