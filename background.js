let recording = false;

let samples = [];
let events = [];
let mutations = [];
let initialDOM = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // START
  if (msg.type === "START") {
    recording = true;

    samples = [];
    events = [];
    mutations = [];
    initialDOM = [];

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0].id;

      // inject content script
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      }, () => {

        chrome.tabs.sendMessage(tabId, { type: "START" });
      });
    });
  }

  // STOP
  else if (msg.type === "STOP") {
    recording = false;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0].id;

      chrome.tabs.sendMessage(tabId, { type: "STOP" }, () => {});
    });

    const data = { samples, events, mutations, initialDOM };

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

  // DATA
  else if (msg.type === "sample" && recording) samples.push(msg.data);
  else if (msg.type === "event" && recording) events.push(msg.data);
  else if (msg.type === "mutation" && recording) mutations.push(msg.data);
  else if (msg.type === "initialDOM" && recording) initialDOM = msg.data;

  // VIDEO
  else if (msg.type === "DOWNLOAD_VIDEO") {
    chrome.downloads.download({
      url: msg.data,
      filename: "screen.webm",
      saveAs: true
    });
  }
});