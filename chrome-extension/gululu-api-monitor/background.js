const STORAGE_KEY = "gululuApiMonitorEvents";
const STATUS_KEY = "gululuApiMonitorStatus";
const MAX_EVENTS = 1000;
const MAX_BODY_CHARS = 20000;

const INTERESTING_HOSTS = [
  "agentseller.temu.com",
  "agentseller-us.temu.com",
  "agentseller-eu.temu.com",
  "seller.kuajingmaihuo.com",
  "ads.temu.com",
  "lingge.gululu.store",
];

const requestMap = new Map();

function nowIso() {
  return new Date().toISOString();
}

function isInterestingUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase();
    return INTERESTING_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function decodeRequestBody(requestBody) {
  if (!requestBody) return "";
  if (Array.isArray(requestBody.raw)) {
    const parts = [];
    for (const raw of requestBody.raw) {
      if (!raw?.bytes) continue;
      try {
        parts.push(new TextDecoder("utf-8").decode(raw.bytes));
      } catch {}
    }
    return parts.join("");
  }
  if (requestBody.formData && typeof requestBody.formData === "object") {
    try {
      return JSON.stringify(requestBody.formData);
    } catch {}
  }
  return "";
}

function sanitizeHeaders(headers = []) {
  const result = {};
  for (const item of headers || []) {
    const name = String(item.name || "").toLowerCase();
    if (!name || /^(cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token)$/i.test(name)) continue;
    if (/^(content-length|accept-encoding|connection)$/i.test(name)) continue;
    const value = String(item.value || "");
    if (!value || value.length > 1000) continue;
    result[name] = value;
  }
  return result;
}

function eventKey(event) {
  return `${event.method}:${event.url}:${stableHash(event.requestBody || "")}`;
}

async function getEvents() {
  const stored = await chrome.storage.local.get(STORAGE_KEY).catch(() => ({}));
  const events = stored?.[STORAGE_KEY];
  return Array.isArray(events) ? events : [];
}

async function saveEvent(event) {
  const events = await getEvents();
  const key = eventKey(event);
  const existingIndex = events.findIndex((item) => eventKey(item) === key);
  const nextEvent = {
    ...event,
    key,
    seenCount: existingIndex >= 0 ? Number(events[existingIndex].seenCount || 1) + 1 : 1,
    lastSeenAt: nowIso(),
  };
  if (existingIndex >= 0) {
    events[existingIndex] = {
      ...events[existingIndex],
      ...nextEvent,
      firstSeenAt: events[existingIndex].firstSeenAt || nextEvent.firstSeenAt,
    };
  } else {
    events.push(nextEvent);
  }
  await chrome.storage.local.set({
    [STORAGE_KEY]: events.slice(-MAX_EVENTS),
    [STATUS_KEY]: {
      eventCount: Math.min(events.length, MAX_EVENTS),
      lastUrl: event.url,
      updatedAt: nowIso(),
    },
  });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isInterestingUrl(details.url)) return;
    const requestBody = decodeRequestBody(details.requestBody);
    requestMap.set(details.requestId, {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      initiator: details.initiator || "",
      documentUrl: details.documentUrl || "",
      requestBody: requestBody.slice(0, MAX_BODY_CHARS),
      requestBodyHash: stableHash(requestBody),
      requestBodyClipped: requestBody.length > MAX_BODY_CHARS,
      startedAt: nowIso(),
    });
  },
  { urls: ["<all_urls>"] },
  ["requestBody"],
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isInterestingUrl(details.url)) return;
    const current = requestMap.get(details.requestId) || {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      initiator: details.initiator || "",
      documentUrl: details.documentUrl || "",
      startedAt: nowIso(),
    };
    requestMap.set(details.requestId, {
      ...current,
      requestHeaders: sanitizeHeaders(details.requestHeaders || []),
    });
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isInterestingUrl(details.url)) return;
    const current = requestMap.get(details.requestId) || {};
    requestMap.delete(details.requestId);
    saveEvent({
      ...current,
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      initiator: details.initiator || current.initiator || "",
      documentUrl: details.documentUrl || current.documentUrl || "",
      statusCode: details.statusCode,
      fromCache: Boolean(details.fromCache),
      ip: details.ip || "",
      completedAt: nowIso(),
      firstSeenAt: current.startedAt || nowIso(),
    }).catch(() => {});
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!isInterestingUrl(details.url)) return;
    const current = requestMap.get(details.requestId) || {};
    requestMap.delete(details.requestId);
    saveEvent({
      ...current,
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      initiator: details.initiator || current.initiator || "",
      documentUrl: details.documentUrl || current.documentUrl || "",
      error: details.error || "unknown",
      completedAt: nowIso(),
      firstSeenAt: current.startedAt || nowIso(),
    }).catch(() => {});
  },
  { urls: ["<all_urls>"] },
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GULULU_API_MONITOR_GET") {
    Promise.all([
      getEvents(),
      chrome.storage.local.get(STATUS_KEY).catch(() => ({})),
    ]).then(([events, status]) => {
      sendResponse({
        ok: true,
        events,
        status: status?.[STATUS_KEY] || null,
        hosts: INTERESTING_HOSTS,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  if (message?.type === "GULULU_API_MONITOR_CLEAR") {
    chrome.storage.local.set({ [STORAGE_KEY]: [], [STATUS_KEY]: { eventCount: 0, updatedAt: nowIso() } }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  return false;
});
