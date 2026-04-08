let recording = false;

let samples = [];
let events = [];
let initialDOM = [];
let viewport = null;

chrome.runtime.onMessage.addListener((msg, sender) => {

  if (msg.type === "START") {
    recording = true;

    samples = [];
    events = [];
    initialDOM = [];
    viewport = null;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }, () => {

        chrome.tabs.sendMessage(tab.id, { type: "START" }, () => {
          if (chrome.runtime.lastError) return;
        });

      });
    });
  }

  else if (msg.type === "STOP") {
    recording = false;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.tabs.sendMessage(tab.id, { type: "STOP" }, () => {
        if (chrome.runtime.lastError) return;
      });
    });

    const data = {
      meta: { viewport },
      samples,
      events,
      initialDOM
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });

    const reader = new FileReader();

    reader.onload = function () {
      chrome.downloads.download({
        url: reader.result,
        filename: "recording.json",
        saveAs: true
      });
    };

    reader.readAsDataURL(blob);
  }

  else if (msg.type === "INIT") {
    if (!recording) return;
    viewport = msg.data.viewport;
    initialDOM = msg.data.initialDOM;
  }

  else if (msg.type === "sample" && recording) {
    samples.push(msg.data);
  }

  else if (msg.type === "event" && recording) {
    events.push(msg.data);
  }

  else if (msg.type === "DOWNLOAD_VIDEO") {
    chrome.downloads.download({
      url: msg.data,
      filename: "screen.webm",
      saveAs: true
    });
  }
});