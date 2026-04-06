document.getElementById("start").onclick = () => {
  chrome.runtime.sendMessage({ type: "START" });
};

document.getElementById("stop").onclick = () => {
  chrome.runtime.sendMessage({ type: "STOP" });
};
