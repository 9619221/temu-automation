// Page world hook v0.3.2 —— 简单 fetch wrap（不防卸载，让 Temu 后续 wrap 我们包到内层）
// 链路：业务 → Temu wrap (anti-content) → 我们 wrap (clone body) → 真原生 → 网络
// 关键差异 vs v0.3.0：不用 defineProperty + setter no-op，避免阻止 Temu wrap 导致大量 401

(function injectHook(config) {
  if (window.__temuMonitorInstalled) {
    try {
      if (!window.__temuMonitorSalesAutoPageSupplemental) {
        window.__temuMonitorSalesAutoPageSupplemental = true;
        const eventName = config?.EVENT_NAME || "temu-monitor.captured";
        const bypassSymbolKey = config?.BYPASS_SYMBOL_KEY || "temu-monitor.fetch.bypass";
        const bypassSym = Symbol.for(bypassSymbolKey);
        const safeJsonAuto = (text) => { try { return JSON.parse(text); } catch { return null; } };
        const siteAuto = () => {
          const m = location.host.match(/agentseller(-eu|-us)?\.temu\.com|seller\.kuajingmaihuo\.com/);
          if (!m) return location.host;
          if (m[1] === "-eu") return "agentseller-eu";
          if (m[1] === "-us") return "agentseller-us";
          if (m[0].includes("kuajing")) return "kuajingmaihuo";
          return "agentseller";
        };
        const emitAuto = (payload) => {
          window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
          if (window.__temuMonitorStats) {
            window.__temuMonitorStats.lastCaptureUrl = String(payload?.url || "").slice(0, 200);
            window.__temuMonitorStats.lastCaptureAt = payload?.ts || Date.now();
          }
        };
        const bodyTextAuto = (body) => {
          if (body == null) return null;
          if (typeof body === "string") return body;
          try { if (body instanceof URLSearchParams) return body.toString(); } catch {}
          return null;
        };
        const parseReqAuto = (text) => {
          if (!text || typeof text !== "string") return null;
          const trimmed = text.trim();
          if (trimmed[0] === "{" || trimmed[0] === "[") return safeJsonAuto(trimmed);
          try {
            const params = new URLSearchParams(trimmed);
            const data = params.get("data") || params.get("param") || params.get("params");
            return data ? safeJsonAuto(data) : null;
          } catch { return null; }
        };
        const findNumAuto = (root, names) => {
          const wanted = new Set(names.map((name) => String(name).toLowerCase()));
          const stack = [root];
          let steps = 0;
          while (stack.length && steps < 2000) {
            steps++;
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            if (Array.isArray(node)) { for (const item of node) stack.push(item); continue; }
            for (const key of Object.keys(node)) {
              if (wanted.has(key.toLowerCase())) {
                const value = Number(node[key]);
                if (Number.isFinite(value) && value > 0) return value;
              }
              if (node[key] && typeof node[key] === "object") stack.push(node[key]);
            }
          }
          return null;
        };
        const setNumAuto = (root, names, nextValue) => {
          const wanted = new Set(names.map((name) => String(name).toLowerCase()));
          const stack = [root];
          let steps = 0;
          while (stack.length && steps < 2000) {
            steps++;
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            if (Array.isArray(node)) { for (const item of node) stack.push(item); continue; }
            for (const key of Object.keys(node)) {
              if (wanted.has(key.toLowerCase())) { node[key] = nextValue; return true; }
              if (node[key] && typeof node[key] === "object") stack.push(node[key]);
            }
          }
          return false;
        };
        const buildBodyAuto = (originalText, pageNo, pageSize) => {
          const parsed = parseReqAuto(originalText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
          const next = JSON.parse(JSON.stringify(parsed));
          const pageNames = ["pageNo", "pageNum", "pageNumber", "currentPage", "pageIndex", "page"];
          const sizeNames = ["pageSize", "size", "limit", "pageLimit"];
          if (!setNumAuto(next, pageNames, pageNo)) next.pageNo = pageNo;
          if (!setNumAuto(next, sizeNames, pageSize)) next.pageSize = pageSize;
          const trimmed = String(originalText || "").trim();
          if (trimmed[0] === "{" || trimmed[0] === "[") return JSON.stringify(next);
          try {
            const params = new URLSearchParams(originalText);
            const key = params.has("data") ? "data" : params.has("param") ? "param" : params.has("params") ? "params" : "";
            if (!key) return JSON.stringify(next);
            params.set(key, JSON.stringify(next));
            return params.toString();
          } catch { return JSON.stringify(next); }
        };
        const isCollectorAuto = () => {
          try {
            if (new URLSearchParams(location.search).get("__temu_monitor_collector") === "1") return true;
          } catch {}
          return (window.outerWidth > 0 && window.outerWidth <= 380 && window.outerHeight > 0 && window.outerHeight <= 340);
        };
        const clickPagerAuto = (el) => {
          try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); } catch {}
          try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 })); } catch {}
          try { el.click(); return true; } catch { return false; }
        };
        const findNextPagerAuto = () => {
          const items = Array.from(document.querySelectorAll('[class*="PGT_next"]'));
          return items.find((el) => {
            const cls = String(el.className || "");
            const disabled = /disabled|Disable|forbid/i.test(cls) || el.getAttribute("aria-disabled") === "true";
            return !disabled;
          }) || null;
        };
        const maybeClickSalesPagesAuto = (total, pageSize) => {
          try {
            if (!isCollectorAuto()) return;
            const size = Math.max(1, Number(pageSize) || 10);
            const pageCount = Math.min(50, Math.ceil((Number(total) || 0) / size));
            if (pageCount <= 1 || window.__temuMonitorSalesPagerClicking) return;
            const key = [location.pathname, total, size].join("|");
            const seen = window.__temuMonitorSalesPagerSeen || (window.__temuMonitorSalesPagerSeen = {});
            if (seen[key]) return;
            seen[key] = Date.now();
            window.__temuMonitorSalesPagerClicking = true;
            let clicks = 0;
            let misses = 0;
            const finish = () => { window.__temuMonitorSalesPagerClicking = false; };
            const step = () => {
              if (clicks >= pageCount - 1) return finish();
              const next = findNextPagerAuto();
              if (!next) {
                misses++;
                if (misses > 8) return finish();
                setTimeout(step, 1000);
                return;
              }
              misses = 0;
              if (!clickPagerAuto(next)) return finish();
              clicks++;
              setTimeout(step, 3500);
            };
            setTimeout(step, 1800);
          } catch {}
        };
        const seenAuto = new Set();
        const baseFetchAuto = window.fetch;
        window.fetch = function (input, init) {
          if (init && init[bypassSym]) return baseFetchAuto.apply(this, arguments);
          const url = typeof input === "string" ? input : (input && input.url) || "";
          const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
          const requestBody = init && Object.prototype.hasOwnProperty.call(init, "body") ? bodyTextAuto(init.body) : null;
          const promise = baseFetchAuto.apply(this, arguments);
          if (!/\/mms\/venom\/api\/supplier\/sales\/management\/listOverall/.test(String(url || ""))) return promise;
          return promise.then((resp) => {
            try {
              resp.clone().text().then((text) => {
                const body = safeJsonAuto(text);
                const result = body?.result;
                const rows = Array.isArray(result?.subOrderList) ? result.subOrderList : Array.isArray(result?.list) ? result.list : [];
                const total = Number(result?.total || result?.totalCount || result?.totalSize || 0);
                if (rows.length && Number.isFinite(total) && total > rows.length) {
                  maybeClickSalesPagesAuto(total, rows.length || 10);
                }
                if (!requestBody || !rows.length || !Number.isFinite(total) || total <= rows.length) return;
                const req = parseReqAuto(requestBody);
                const pageSize = Math.max(1, Math.min(100, findNumAuto(req, ["pageSize", "size", "limit", "pageLimit"]) || rows.length || 10));
                const pageNo = Math.max(1, findNumAuto(req, ["pageNo", "pageNum", "pageNumber", "currentPage", "pageIndex", "page"]) || 1);
                const pageCount = Math.min(50, Math.ceil(total / pageSize));
                const seenKey = String(url) + "|" + requestBody.slice(0, 500) + "|" + total;
                if (pageNo >= pageCount || seenAuto.has(seenKey)) return;
                seenAuto.add(seenKey);
                (async () => {
                  for (let nextPage = pageNo + 1; nextPage <= pageCount; nextPage++) {
                    const nextBody = buildBodyAuto(requestBody, nextPage, pageSize);
                    if (!nextBody) break;
                    const nextInit = { ...(init || {}), method, body: nextBody };
                    nextInit[bypassSym] = true;
                    const nextResp = await baseFetchAuto.call(window, url, nextInit);
                    const nextText = await nextResp.clone().text();
                    emitAuto({
                      kind: "fetch-auto-page", url, method, status: nextResp.status, ts: Date.now(),
                      site: siteAuto(), page: location.pathname,
                      body: safeJsonAuto(nextText),
                      bodyText: nextText.length > 200000 ? null : nextText,
                      bodySize: nextText.length,
                      autoPage: nextPage,
                      autoPageSize: pageSize,
                      autoPageTotal: total,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 250));
                  }
                })().catch(() => {});
              }).catch(() => {});
            } catch {}
            return resp;
          });
        };
      }
      const known = new Set(Array.isArray(window.__temuMonitorWhitelist) ? window.__temuMonitorWhitelist : []);
      const extraWhitelist = (Array.isArray(config?.URL_WHITELIST) ? config.URL_WHITELIST : [])
        .filter((item) => /querySkuSalesNumber/.test(String(item || "")) && !known.has(item));
      if (!window.__temuMonitorSkuTrendSupplemental && extraWhitelist.length > 0) {
        window.__temuMonitorSkuTrendSupplemental = true;
        const eventName = config?.EVENT_NAME || "temu-monitor.captured";
        const bypassSymbolKey = config?.BYPASS_SYMBOL_KEY || "temu-monitor.fetch.bypass";
        const extraRe = new RegExp(extraWhitelist.map((s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
        const safeJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
        const site = () => {
          const m = location.host.match(/agentseller(-eu|-us)?\.temu\.com|seller\.kuajingmaihuo\.com/);
          if (!m) return location.host;
          if (m[1] === "-eu") return "agentseller-eu";
          if (m[1] === "-us") return "agentseller-us";
          if (m[0].includes("kuajing")) return "kuajingmaihuo";
          return "agentseller";
        };
        const emit = (payload) => {
          window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
          if (window.__temuMonitorStats) {
            window.__temuMonitorStats.lastCaptureUrl = String(payload?.url || "").slice(0, 200);
            window.__temuMonitorStats.lastCaptureAt = payload?.ts || Date.now();
          }
        };
        const shouldCaptureExtra = (url) => url && extraRe.test(String(url));

        const BaseXHR = window.XMLHttpRequest;
        function SupplementalXHR() {
          const xhr = new BaseXHR();
          let _url = "", _method = "GET", _bypass = false;
          const _ts = Date.now();
          const origOpen = xhr.open;
          xhr.open = function (method, url) {
            _url = url; _method = (method || "GET").toUpperCase();
            return origOpen.apply(this, arguments);
          };
          const origSetHdr = xhr.setRequestHeader;
          xhr.setRequestHeader = function (name) {
            if (name === bypassSymbolKey) { _bypass = true; return; }
            return origSetHdr.apply(this, arguments);
          };
          const origSend = xhr.send;
          xhr.send = function () {
            if (!_bypass && shouldCaptureExtra(_url)) {
              xhr.addEventListener("readystatechange", function () {
                if (xhr.readyState !== 4) return;
                const text = xhr.responseText || "";
                emit({
                  kind: "xhr", url: _url, method: _method, status: xhr.status, ts: _ts,
                  site: site(), page: location.pathname,
                  body: safeJson(text),
                  bodyText: text.length > 200000 ? null : text,
                  bodySize: text.length,
                });
              });
            }
            return origSend.apply(this, arguments);
          };
          return xhr;
        }
        window.XMLHttpRequest = SupplementalXHR;

        const BaseFetch = window.fetch;
        window.fetch = function (input, init) {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          const bypass = init && init[Symbol.for(bypassSymbolKey)];
          const method = (init && init.method) || (input && input.method) || "GET";
          const ts = Date.now();
          return BaseFetch.apply(this, arguments).then((resp) => {
            if (!bypass && shouldCaptureExtra(url)) {
              resp.clone().text().then((text) => {
                emit({
                  kind: "fetch", url, method: String(method).toUpperCase(), status: resp.status, ts,
                  site: site(), page: location.pathname,
                  body: safeJson(text),
                  bodyText: text.length > 200000 ? null : text,
                  bodySize: text.length,
                });
              }).catch(() => {});
            }
            return resp;
          });
        };

        window.__temuMonitorSkuTrendSupplementalInfo = { extraWhitelist, installedAt: Date.now() };
      }
    } catch {}
    return;
  }
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
  window.__temuMonitorWhitelist = URL_WHITELIST.slice();
  function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
  function bodyToText(body) {
    if (body == null) return null;
    if (typeof body === "string") return body;
    try {
      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
    } catch {}
    try {
      if (typeof Blob !== "undefined" && body instanceof Blob) return null;
    } catch {}
    try {
      if (typeof FormData !== "undefined" && body instanceof FormData) return null;
    } catch {}
    try {
      if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return null;
    } catch {}
    return null;
  }
  function fetchRequestBodyText(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, "body")) return bodyToText(init.body);
    try {
      if (input && typeof input !== "string" && input.bodyUsed === false && input.method && input.method !== "GET") {
        return null;
      }
    } catch {}
    return null;
  }
  function parseRequestBody(text) {
    if (!text || typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed[0] === "{" || trimmed[0] === "[") return safeJson(trimmed);
    try {
      const params = new URLSearchParams(trimmed);
      const data = params.get("data") || params.get("param") || params.get("params");
      return data ? safeJson(data) : null;
    } catch {
      return null;
    }
  }
  function findNumberDeep(root, names) {
    const wanted = new Set(names.map((name) => String(name).toLowerCase()));
    const stack = [root];
    let steps = 0;
    while (stack.length && steps < 2000) {
      steps++;
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      for (const key of Object.keys(node)) {
        if (wanted.has(key.toLowerCase())) {
          const value = Number(node[key]);
          if (Number.isFinite(value) && value > 0) return value;
        }
        const value = node[key];
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return null;
  }
  function setNumberDeep(root, names, nextValue) {
    const wanted = new Set(names.map((name) => String(name).toLowerCase()));
    const stack = [root];
    let steps = 0;
    while (stack.length && steps < 2000) {
      steps++;
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      for (const key of Object.keys(node)) {
        if (wanted.has(key.toLowerCase())) {
          node[key] = nextValue;
          return true;
        }
        const value = node[key];
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return false;
  }
  function buildNextPageBody(originalText, pageNo, pageSize) {
    const parsed = parseRequestBody(originalText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const next = JSON.parse(JSON.stringify(parsed));
    const pageNames = ["pageNo", "pageNum", "pageNumber", "currentPage", "pageIndex", "page"];
    const sizeNames = ["pageSize", "size", "limit", "pageLimit"];
    if (!setNumberDeep(next, pageNames, pageNo)) next.pageNo = pageNo;
    if (!setNumberDeep(next, sizeNames, pageSize)) next.pageSize = pageSize;
    const trimmed = String(originalText || "").trim();
    if (trimmed[0] === "{" || trimmed[0] === "[") return JSON.stringify(next);
    try {
      const params = new URLSearchParams(originalText);
      const key = params.has("data") ? "data" : params.has("param") ? "param" : params.has("params") ? "params" : "";
      if (!key) return JSON.stringify(next);
      params.set(key, JSON.stringify(next));
      return params.toString();
    } catch {
      return JSON.stringify(next);
    }
  }
  function getPageInfoFromRequest(originalText, fallbackSize) {
    const parsed = parseRequestBody(originalText);
    const pageNames = ["pageNo", "pageNum", "pageNumber", "currentPage", "pageIndex", "page"];
    const sizeNames = ["pageSize", "size", "limit", "pageLimit"];
    return {
      pageNo: findNumberDeep(parsed, pageNames) || 1,
      pageSize: findNumberDeep(parsed, sizeNames) || fallbackSize || 10,
    };
  }
  function isCollectorPage() {
    try {
      if (new URLSearchParams(location.search).get("__temu_monitor_collector") === "1") return true;
    } catch {}
    return (window.outerWidth > 0 && window.outerWidth <= 380 && window.outerHeight > 0 && window.outerHeight <= 340);
  }
  function clickPagerElement(el) {
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 })); } catch {}
    try { el.click(); return true; } catch { return false; }
  }
  function findNextSalesPager() {
    const items = Array.from(document.querySelectorAll('[class*="PGT_next"]'));
    return items.find((el) => {
      const cls = String(el.className || "");
      const disabled = /disabled|Disable|forbid/i.test(cls) || el.getAttribute("aria-disabled") === "true";
      return !disabled;
    }) || null;
  }
  function maybeClickSalesPagination(total, pageSize) {
    try {
      if (!isCollectorPage()) return;
      const size = Math.max(1, Number(pageSize) || 10);
      const pageCount = Math.min(50, Math.ceil((Number(total) || 0) / size));
      if (pageCount <= 1 || window.__temuMonitorSalesPagerClicking) return;
      const key = [location.pathname, total, size].join("|");
      const seen = window.__temuMonitorSalesPagerSeen || (window.__temuMonitorSalesPagerSeen = {});
      if (seen[key]) return;
      seen[key] = Date.now();
      window.__temuMonitorSalesPagerClicking = true;
      let clicks = 0;
      let misses = 0;
      const finish = () => { window.__temuMonitorSalesPagerClicking = false; };
      const step = () => {
        if (clicks >= pageCount - 1) return finish();
        const next = findNextSalesPager();
        if (!next) {
          misses++;
          if (misses > 8) return finish();
          setTimeout(step, 1000);
          return;
        }
        misses = 0;
        if (!clickPagerElement(next)) return finish();
        clicks++;
        setTimeout(step, 3500);
      };
      setTimeout(step, 1800);
    } catch {}
  }
  const autoPageSeen = new Set();
  function maybeAutoPaginate(url, method, input, init, requestBodyText, responseBody) {
    try {
      if (!/\/mms\/venom\/api\/supplier\/sales\/management\/listOverall/.test(String(url || ""))) return;
      const result = responseBody && responseBody.result;
      const rows = Array.isArray(result?.subOrderList) ? result.subOrderList : Array.isArray(result?.list) ? result.list : [];
      const total = Number(result?.total || result?.totalCount || result?.totalSize || 0);
      if (rows.length && Number.isFinite(total) && total > rows.length) {
        maybeClickSalesPagination(total, rows.length || 10);
      }
      if (!requestBodyText || !rows.length || !Number.isFinite(total) || total <= rows.length) return;
      const pageInfo = getPageInfoFromRequest(requestBodyText, rows.length);
      const pageSize = Math.max(1, Math.min(100, Number(pageInfo.pageSize) || rows.length || 10));
      const pageNo = Math.max(1, Number(pageInfo.pageNo) || 1);
      const pageCount = Math.min(50, Math.ceil(total / pageSize));
      if (pageNo >= pageCount) return;
      const seenKey = String(url) + "|" + String(requestBodyText).slice(0, 500) + "|" + total;
      if (autoPageSeen.has(seenKey)) return;
      autoPageSeen.add(seenKey);
      const run = async () => {
        for (let nextPage = pageNo + 1; nextPage <= pageCount; nextPage++) {
          const nextBody = buildNextPageBody(requestBodyText, nextPage, pageSize);
          if (!nextBody) break;
          const nextInit = { ...(init || {}) };
          nextInit.method = method || nextInit.method || "POST";
          nextInit.body = nextBody;
          nextInit[BYPASS_SYM] = true;
          const resp = await OrigFetch.call(window, url, nextInit);
          const text = await resp.clone().text();
          emit({
            kind: "fetch-auto-page", url, method: String(nextInit.method || "POST").toUpperCase(), status: resp.status, ts: Date.now(),
            site: inferMallSite(), page: location.pathname,
            body: safeJson(text),
            bodyText: text.length > 200000 ? null : text,
            bodySize: text.length,
            autoPage: nextPage,
            autoPageSize: pageSize,
            autoPageTotal: total,
          });
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      };
      run().catch(() => {});
    } catch {}
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
    let _requestBodyText = null;
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
    xhr.send = function (body) {
      _requestBodyText = bodyToText(body);
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
              requestBodyText: _requestBodyText,
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
    const requestBodyText = fetchRequestBodyText(input, init);
    const promise = OrigFetch.apply(this, arguments);
    return promise.then((resp) => {
      try {
        const cloned = resp.clone();
        cloned.text().then((text) => {
          try {
            const parsedBody = safeJson(text);
            emit({
              kind: "fetch", url, method, status: resp.status, ts,
              site: inferMallSite(), page: location.pathname,
              body: parsedBody,
              bodyText: text.length > 200000 ? null : text,
              bodySize: text.length,
              requestBodyText,
            });
            maybeAutoPaginate(url, method, input, init, requestBodyText, parsedBody);
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
    version: "0.3.0",
    site: inferMallSite(),
    healthy: () => window.XMLHttpRequest === TrackedXHR && window.fetch === TrackedFetch,
    stats,
    note: "XHR + fetch wrapped; fetch 用 resp.clone() 不消耗原 stream; perf observer 兜底",
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
