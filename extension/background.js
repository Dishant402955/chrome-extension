let recording = false;

let samples = [];
let events = [];
let viewport = null;

chrome.runtime.onMessage.addListener((msg, sender) => {

  if (msg.type === "START") {
    recording = true;

    samples = [];
    events = [];
    viewport = null;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.tabs.sendMessage(tab.id, { type: "START" }, () => {});
    });
  }

  else if (msg.type === "STOP") {
    recording = false;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.tabs.sendMessage(tab.id, { type: "STOP" }, () => {});
    });
  }

  else if (msg.type === "INIT") {
    viewport = msg.data.viewport;
  }

  else if (msg.type === "sample" && recording) {
    samples.push(msg.data);
  }

  else if (msg.type === "event" && recording) {
    events.push(msg.data);
  }

  else if (msg.type === "FINAL_DATA") {

    const { screenDataUrl, webcamDataUrl, script } = msg.data;

    // ---- SCRIPT ----
    const scriptBlob = new Blob([JSON.stringify(script, null, 2)], {
      type: "application/json"
    });

    const reader = new FileReader();
    reader.onload = function () {
      chrome.downloads.download({
        url: reader.result,
        filename: "script.json",
        saveAs: true
      });
    };
    reader.readAsDataURL(scriptBlob);

    // ---- SCREEN ----
    chrome.downloads.download({
      url: screenDataUrl,
      filename: "screen.webm",
      saveAs: true
    });

    // ---- WEBCAM ----
    chrome.downloads.download({
      url: webcamDataUrl,
      filename: "webcam.webm",
      saveAs: true
    });
  }
});