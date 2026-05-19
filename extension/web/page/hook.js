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
    fetchSendTotal: 0,
    fetchCaptureHit: 0,
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
  // 仅采集逆向必需的请求头，绝不采 cookie / authorization / token，避免凭据外泄
  const REQ_HEADER_ALLOW = ["anti-content", "content-type", "mallid", "x-requested-with"];
  function pickReqHeaders(getter) {
    const out = {};
    try {
      for (const name of REQ_HEADER_ALLOW) {
        const v = getter(name);
        if (v) out[name] = String(v).slice(0, 4000);
      }
    } catch {}
    return out;
  }
  function reqBodyStr(body) {
    try {
      if (body == null) return null;
      if (typeof body === "string") return body.length > 60000 ? body.slice(0, 60000) + "...[TRUNC]" : body;
      return "[non-string body]";
    } catch { return null; }
  }
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
    const _reqHeaders = {};
    let _reqBody = null;
    const _ts = Date.now();
    const origOpen = xhr.open;
    xhr.open = function (method, url) {
      _url = url; _method = (method || "GET").toUpperCase();
      return origOpen.apply(this, arguments);
    };
    const origSetHdr = xhr.setRequestHeader;
    xhr.setRequestHeader = function (name, value) {
      if (name === BYPASS_SYMBOL_KEY) { _bypass = true; stats.bypassHit++; return; }
      try {
        if (name && REQ_HEADER_ALLOW.indexOf(String(name).toLowerCase()) >= 0) {
          _reqHeaders[String(name).toLowerCase()] = String(value).slice(0, 4000);
        }
      } catch {}
      return origSetHdr.apply(this, arguments);
    };
    const origSend = xhr.send;
    xhr.send = function (body) {
      stats.xhrSendTotal++;
      if (!_bypass && shouldCapture(_url)) {
        stats.xhrCaptureHit++;
        try { _reqBody = reqBodyStr(body); } catch {}
        xhr.addEventListener("readystatechange", function () {
          if (xhr.readyState !== 4) return;
          try {
            const text = xhr.responseText || "";
            emit({
              kind: "xhr", url: _url, method: _method, status: xhr.status, ts: _ts,
              site: inferMallSite(), page: location.pathname,
              reqBody: _reqBody,
              reqHeaders: _reqHeaders,
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

  // -------------------- fetch wrap --------------------
  // 设计：只「窃听」response — 用 resp.clone() 读 body，不动 request、不动 response，
  // Temu 自家的 anti-content / 签名 wrap 仍在我们外层，不会触发 401（v0.3.0 那次的根因
  // 是 defineProperty 阻止了 Temu re-wrap，本次不做这件事）。
  // bypass：业务自己用扩展上下文 fetch 时，在 init 上挂 [Symbol.for(BYPASS_SYMBOL_KEY)]=true。
  const BYPASS_SYM = Symbol.for(BYPASS_SYMBOL_KEY);
  const OrigFetch = window.fetch;
  function TrackedFetch(input, init) {
    if (init && init[BYPASS_SYM]) { stats.bypassHit++; return OrigFetch.apply(this, arguments); }
    let url = "";
    try { url = typeof input === "string" ? input : (input && input.url) || ""; } catch {}
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    stats.fetchSendTotal++;
    if (!shouldCapture(url)) return OrigFetch.apply(this, arguments);
    stats.fetchCaptureHit++;
    const ts = Date.now();
    const reqBody = reqBodyStr(init && init.body);
    const hdrSrc = (init && init.headers) || (input && input.headers) || null;
    const reqHeaders = pickReqHeaders((n) => {
      try {
        if (!hdrSrc) return null;
        if (typeof hdrSrc.get === "function") return hdrSrc.get(n);
        const lk = Object.keys(hdrSrc).find((k) => k.toLowerCase() === n.toLowerCase());
        return lk ? hdrSrc[lk] : null;
      } catch { return null; }
    });
    const promise = OrigFetch.apply(this, arguments);
    return promise.then((resp) => {
      try {
        const cloned = resp.clone();
        cloned.text().then((text) => {
          try {
            emit({
              kind: "fetch", url, method, status: resp.status, ts,
              site: inferMallSite(), page: location.pathname,
              reqBody,
              reqHeaders,
              body: safeJson(text),
              bodyText: text.length > 200000 ? null : text,
              bodySize: text.length,
            });
          } catch {}
        }).catch(() => {});
      } catch {}
      return resp;
    });
  }
  try { window.fetch = TrackedFetch; } catch {}

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
    version: "0.3.3",
    site: inferMallSite(),
    healthy: () => window.XMLHttpRequest === TrackedXHR && window.fetch === TrackedFetch,
    stats,
    note: "XHR + fetch wrapped; v0.3.3 增白名单内请求体+anti-content/content-type 头采集(不采凭据); fetch 用 resp.clone() 不消耗原 stream; perf observer 兜底",
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
