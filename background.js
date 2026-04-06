let recording = false;

let samples = [];
let events = [];
let mutations = [];
let initialDOM = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // START RECORDING
  if (msg.type === "START") {
    recording = true;
    samples = [];
    events = [];

    console.log("Recording started");

    // notify all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "START" }, () => {
          if (chrome.runtime.lastError) {
            // ignore tabs without content script
          }
        });
      });
    });
  }

  // STOP RECORDING
  else if (msg.type === "STOP") {
    recording = false;

    console.log("Recording stopped");
    console.log("Samples:", samples.length);
    console.log("Events:", events.length);

    // notify all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "STOP" }, () => {
          if (chrome.runtime.lastError) {
            // ignore tabs without content script
          }
        });
      });
    });

    const data = { samples, events, mutations, initialDOM };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });

    // ✅ FIX for MV3 (NO createObjectURL)
    const reader = new FileReader();

    reader.onload = function () {
      chrome.downloads.download({
        url: reader.result,
        filename: "recording.json",
        saveAs: true,
      });
    };

    reader.readAsDataURL(blob);
    if (screenRecorder) {
      screenRecorder.stop();

      screenRecorder.onstop = () => {
        const screenBlob = new Blob(screenChunks, {
          type: "video/webm",
        });

        const reader = new FileReader();

        reader.onload = function () {
          chrome.downloads.download({
            url: reader.result,
            filename: "screen.webm",
            saveAs: true,
          });
        };

        reader.readAsDataURL(screenBlob);
      };

      // stop tracks
      screenStream.getTracks().forEach((track) => track.stop());
    }
  }

  // SAMPLE DATA
  else if (msg.type === "sample") {
    if (recording) {
      samples.push(msg.data);
    }
  }

  // EVENT DATA
  else if (msg.type === "event") {
    if (recording) {
      events.push(msg.data);
    }
  }

  //Download
  else if (msg.type === "DOWNLOAD_VIDEO") {
    chrome.downloads.download({
      url: msg.data,
      filename: "screen.webm",
      saveAs: true,
    });
  }

  //mutation
  else if (msg.type === "mutation") {
    if (recording) {
      mutations.push(msg.data);
    }
  }

  // initial DOM capture
  else if (msg.type === "initialDOM") {
    if (recording) {
      initialDOM = msg.data;
    }
  }
});
