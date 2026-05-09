// Page world hook v0.3.2 —— 简单 fetch wrap（不防卸载，让 Temu 后续 wrap 我们包到内层）
// 链路：业务 → Temu wrap (anti-content) → 我们 wrap (clone body) → 真原生 → 网络
// 关键差异 vs v0.3.0：不用 defineProperty + setter no-op，避免阻止 Temu wrap 导致大量 401

(function injectHook(config) {
  if (window.__temuMonitorInstalled) return;
  window.__temuMonitorInstalled = true;

  const {
    URL_WHITELIST = [],
    URL_BLACKLIST = [],
    EVENT_NAME = "temu-monitor.captured",
    BYPASS_SYMBOL_KEY = "temu-monitor.fetch.bypass",
  } = config || {};

  const stats = {
    xhrSendTotal: 0,
    xhrCaptureHit: 0,
    xhrEmitted: 0,
    perfSeen: 0,
    lastCaptureUrl: "",
    lastCaptureAt: 0,
    bypassHit: 0,
  };
  window.__temuMonitorStats = stats;

  const whitelistRe = URL_WHITELIST.length
    ? new RegExp(URL_WHITELIST.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))
    : null;
  const blacklistRe = URL_BLACKLIST.length
    ? new RegExp(URL_BLACKLIST.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))
    : null;

  function shouldCapture(url) {
    if (!url || typeof url !== "string") return false;
    if (blacklistRe && blacklistRe.test(url)) return false;
    if (!whitelistRe) return false;
    return whitelistRe.test(url);
  }
  function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
  function emit(payload) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
      stats.xhrEmitted++;
      stats.lastCaptureUrl = String(payload?.url || "").slice(0, 200);
      stats.lastCaptureAt = payload?.ts || Date.now();
    } catch {}
  }
  function inferMallSite() {
    const m = location.host.match(/agentseller(-eu|-us)?\.temu\.com|seller\.kuajingmaihuo\.com/);
    if (!m) return location.host;
    if (m[1] === "-eu") return "agentseller-eu";
    if (m[1] === "-us") return "agentseller-us";
    if (m[0].includes("kuajing")) return "kuajingmaihuo";
    return "agentseller";
  }

  // -------------------- XHR wrap (passthrough fetch) --------------------
  const OrigXHR = window.XMLHttpRequest;
  function TrackedXHR() {
    const xhr = new OrigXHR();
    let _url = "", _method = "GET", _bypass = false;
    const _ts = Date.now();
    const origOpen = xhr.open;
    xhr.open = function (method, url) {
      _url = url; _method = (method || "GET").toUpperCase();
      return origOpen.apply(this, arguments);
    };
    const origSetHdr = xhr.setRequestHeader;
    xhr.setRequestHeader = function (name) {
      if (name === BYPASS_SYMBOL_KEY) { _bypass = true; stats.bypassHit++; return; }
      return origSetHdr.apply(this, arguments);
    };
    const origSend = xhr.send;
    xhr.send = function () {
      stats.xhrSendTotal++;
      if (!_bypass && shouldCapture(_url)) {
        stats.xhrCaptureHit++;
        xhr.addEventListener("readystatechange", function () {
          if (xhr.readyState !== 4) return;
          try {
            const text = xhr.responseText || "";
            emit({
              kind: "xhr", url: _url, method: _method, status: xhr.status, ts: _ts,
              site: inferMallSite(), page: location.pathname,
              body: safeJson(text),
              bodyText: text.length > 200000 ? null : text,
              bodySize: text.length,
            });
          } catch {}
        });
      }
      return origSend.apply(this, arguments);
    };
    return xhr;
  }
  TrackedXHR.prototype = OrigXHR.prototype;
  for (const k of ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"]) {
    try { TrackedXHR[k] = OrigXHR[k]; } catch {}
  }
  try { window.XMLHttpRequest = TrackedXHR; } catch {}

  let reinstallCount = 0;
  function tryReinstall() {
    if (reinstallCount > 4) return;
    reinstallCount++;
    if (window.XMLHttpRequest !== TrackedXHR) {
      try { window.XMLHttpRequest = TrackedXHR; } catch {}
    }
  }
  setTimeout(tryReinstall, 200);
  setTimeout(tryReinstall, 800);
  setTimeout(tryReinstall, 2000);
  setTimeout(tryReinstall, 5000);

  // -------------------- PerformanceObserver --------------------
  const performanceSeen = new Set();
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.entryType !== "resource") continue;
        if (e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest") continue;
        if (!shouldCapture(e.name)) continue;
        const key = e.name + "|" + Math.round(e.startTime);
        if (performanceSeen.has(key)) continue;
        performanceSeen.add(key);
        stats.perfSeen++;
        if (performanceSeen.size > 5000) {
          const it = performanceSeen.values();
          for (let i = 0; i < 1000; i++) performanceSeen.delete(it.next().value);
        }
        emit({
          kind: "perf",
          url: e.name,
          method: (e.initiatorType === "xmlhttprequest") ? "?" : "GET",
          status: e.responseStatus || 0,
          ts: Math.round(e.startTime),
          site: inferMallSite(),
          page: location.pathname,
          body: null, bodyText: null,
          bodySize: e.transferSize || 0,
          duration: Math.round(e.duration || 0),
        });
      }
    });
    po.observe({ type: "resource", buffered: true });
  } catch {}

  window.__temuMonitor = {
    version: "0.2.2",
    site: inferMallSite(),
    healthy: () => window.XMLHttpRequest === TrackedXHR,
    stats,
    note: "fetch passthrough (no hook); XHR wrapped; perf observer fallback (no body)",
  };
})(
  (function () {
    try {
      const ds = document.currentScript && document.currentScript.dataset;
      if (ds && ds.cfgB64) {
        return JSON.parse(decodeURIComponent(escape(atob(ds.cfgB64))));
      }
    } catch {}
    return window.__temuMonitorConfig || {};
  })()
);
