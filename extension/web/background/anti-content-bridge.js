chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-anti-content") {
    try {
      const value = getAntiContent();
      sendResponse({ ok: true, value });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
    return true;
  }
});
