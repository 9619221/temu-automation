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
        const fulfillmentTabSweepSeenAuto = new Set();
        const endpointAuto = (url) => {
          const text = String(url || "");
          if (/\/mms\/venom\/api\/supplier\/sales\/management\/listOverall/.test(text)) return { key: "sales" };
          if (/\/purchase\/manager\/querySubOrderList/.test(text)) return { key: "stock_order" };
          if (/deliverGoods\/platform\/pageQuerySubPurchaseOrder|deliverGoods\/management\/pageQueryDeliveryBatch/.test(text)) return { key: "shipping_desk" };
          if (/deliverGoods\/management\/pageQueryDeliveryOrders/.test(text)) return { key: "shipping_list" };
          return null;
        };
        const compactTextAuto = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const tabClickableAuto = (el) => {
          try {
            return el.closest('button,[role="tab"],[role="button"],a,[class*="tab"],[class*="Tab"],[class*="radio"],[class*="Radio"]') || el;
          } catch { return el; }
        };
        const findFulfillmentTabsAuto = () => {
          const labelRe = /^(全部|待处理|待接单|待发货|待送货|待创建|待确认|待揽收|待取货|待入库|待到仓|已接单|已发货|已送货|已创建|已确认|已揽收|已入库|异常|超期|逾期|今日|普通|加急|可发货|不可发货)(\s*\d+)?$/;
          const excludeRe = /搜索|查询|清空|重置|导出|下载|打印|设置|生成|创建发货单|删除|刷新|同步|问题|地址|权限/;
          const seen = new Set();
          const candidates = [];
          for (const node of Array.from(document.querySelectorAll('[role="tab"], button, a, span, div'))) {
            const text = compactTextAuto(node.innerText || node.textContent);
            if (!text || text.length > 24 || !labelRe.test(text) || excludeRe.test(text)) continue;
            const clickable = tabClickableAuto(node);
            if (!clickable || seen.has(clickable)) continue;
            const cls = String(clickable.className || "");
            if (/disabled|disable|forbid/i.test(cls) || clickable.getAttribute?.("aria-disabled") === "true") continue;
            const rect = clickable.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) continue;
            seen.add(clickable);
            candidates.push(clickable);
          }
          return candidates.slice(0, 30);
        };
        const maybeSweepFulfillmentTabsAuto = (endpointKey) => {
          try {
            if (endpointKey === "sales") return;
            if (!isCollectorAuto()) return;
            if (!/\/stock\/fully-mgt\/order-manage|\/main\/order-manager\/shipping-desk|\/main\/order-manager\/shipping-list/i.test(location.pathname)) return;
            if (window.__temuMonitorFulfillmentTabSweeping) return;
            const seenKey = `${location.pathname}|${endpointKey}`;
            if (fulfillmentTabSweepSeenAuto.has(seenKey)) return;
            const tabs = findFulfillmentTabsAuto();
            if (tabs.length <= 1) return;
            fulfillmentTabSweepSeenAuto.add(seenKey);
            window.__temuMonitorFulfillmentTabSweeping = true;
            let index = 0;
            const finish = () => { window.__temuMonitorFulfillmentTabSweeping = false; };
            const step = () => {
              if (index >= tabs.length) return finish();
              clickPagerAuto(tabs[index++]);
              setTimeout(step, 3500);
            };
            setTimeout(step, 1800);
          } catch {}
        };
        const firstRowsAuto = (body) => {
          const root = body?.result ?? body?.data ?? body;
          const data = body?.data;
          const result = body?.result;
          const candidates = [
            result?.pageItems, result?.dataList, result?.list, result?.items, result?.records, result?.rows,
            result?.subOrderList, result?.subPurchaseOrderList, result?.purchaseOrderList,
            result?.deliveryBatchList, result?.deliveryBatchVOList, result?.deliveryOrderList, result?.deliveryOrderVOList,
            data?.pageItems, data?.dataList, data?.list, data?.items, data?.records, data?.rows,
            data?.subOrderList, data?.subPurchaseOrderList, data?.purchaseOrderList,
            data?.deliveryBatchList, data?.deliveryBatchVOList, data?.deliveryOrderList, data?.deliveryOrderVOList,
            root?.pageItems, root?.dataList, root?.list, root?.items, root?.records, root?.rows,
            root?.subOrderList, root?.subPurchaseOrderList, root?.purchaseOrderList,
            root?.deliveryBatchList, root?.deliveryBatchVOList, root?.deliveryOrderList, root?.deliveryOrderVOList,
          ];
          return candidates.find((value) => Array.isArray(value) && value.length) || [];
        };
        const requestBodyAutoAsync = (input, init) => {
          const immediate = init && Object.prototype.hasOwnProperty.call(init, "body") ? bodyTextAuto(init.body) : null;
          if (immediate) return Promise.resolve(immediate);
          try {
            if (input && typeof input !== "string" && typeof input.clone === "function") {
              const reqMethod = String(input.method || "GET").toUpperCase();
              if (reqMethod !== "GET" && reqMethod !== "HEAD" && input.bodyUsed === false) {
                return input.clone().text().catch(() => null);
              }
            }
          } catch {}
          return Promise.resolve(null);
        };
        const seenAuto = new Set();
        const baseFetchAuto = window.fetch;
        window.fetch = function (input, init) {
          if (init && init[bypassSym]) return baseFetchAuto.apply(this, arguments);
          const url = typeof input === "string" ? input : (input && input.url) || "";
          const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
          const endpoint = endpointAuto(url);
          const requestBodyPromise = requestBodyAutoAsync(input, init);
          const promise = baseFetchAuto.apply(this, arguments);
          if (!endpoint) return promise;
          return promise.then((resp) => {
            try {
              resp.clone().text().then(async (text) => {
                const requestBody = await requestBodyPromise;
                const body = safeJsonAuto(text);
                const rows = firstRowsAuto(body);
                const total = Number(findNumAuto(body?.result ?? body?.data ?? body, ["total", "totalCount", "totalSize", "totalNum", "totalRecords", "recordCount", "count"]) || 0);
                emitAuto({
                  kind: "fetch", url, method, status: resp.status, ts: Date.now(),
                  site: siteAuto(), page: location.pathname,
                  body,
                  bodyText: text.length > 200000 ? null : text,
                  requestBodyText: requestBody,
                  bodySize: text.length,
                });
                maybeSweepFulfillmentTabsAuto(endpoint.key);
                if (endpoint.key === "sales" && rows.length && Number.isFinite(total) && total > rows.length) {
                  maybeClickSalesPagesAuto(total, rows.length || 10);
                }
                if (!requestBody || !rows.length || !Number.isFinite(total) || total <= rows.length) return;
                const req = parseReqAuto(requestBody);
                const pageSize = Math.max(1, Math.min(100, findNumAuto(req, ["pageSize", "size", "limit", "pageLimit"]) || rows.length || 10));
                const pageNo = Math.max(1, findNumAuto(req, ["pageNo", "pageNum", "pageNumber", "currentPage", "pageIndex", "page"]) || 1);
                const pageCount = Math.min(endpoint.key === "sales" ? 50 : 120, Math.ceil(total / pageSize));
                const seenKey = endpoint.key + "|" + String(url) + "|" + requestBody.slice(0, 500) + "|" + total;
                if (pageNo >= pageCount || seenAuto.has(seenKey)) return;
                seenAuto.add(seenKey);
                (async () => {
                  for (let nextPage = pageNo + 1; nextPage <= pageCount; nextPage++) {
                    const nextBody = buildBodyAuto(requestBody, nextPage, pageSize);
                    if (!nextBody) break;
                    const nextInit = { ...(init || {}), method, body: nextBody };
                    try {
                      if (!nextInit.headers && input && typeof input !== "string" && input.headers) nextInit.headers = new Headers(input.headers);
                      for (const key of ["credentials", "mode", "cache", "redirect", "referrer", "referrerPolicy"]) {
                        if (nextInit[key] == null && input && typeof input !== "string" && input[key] != null) nextInit[key] = input[key];
                      }
                    } catch {}
                    nextInit[bypassSym] = true;
                    const nextResp = await baseFetchAuto.call(window, url, nextInit);
                    const nextText = await nextResp.clone().text();
                    emitAuto({
                      kind: "fetch-auto-page", url, method, status: nextResp.status, ts: Date.now(),
                      site: siteAuto(), page: location.pathname,
                      body: safeJsonAuto(nextText),
                      bodyText: nextText.length > 200000 ? null : nextText,
                      requestBodyText: nextBody,
                      bodySize: nextText.length,
                      autoPage: nextPage,
                      autoPageSize: pageSize,
                      autoPageTotal: total,
                      autoPageSource: endpoint.key,
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
    URL_DISCOVERY_ALLOWLIST = [],
    DISCOVERY_MAX_BODY_CHARS = 60000,
    EVENT_NAME = "temu-monitor.captured",
    BYPASS_SYMBOL_KEY = "temu-monitor.fetch.bypass",
  } = config || {};

  const stats = {
    xhrSendTotal: 0,
    xhrCaptureHit: 0,
    xhrDiscoveryHit: 0,
    xhrEmitted: 0,
    fetchSendTotal: 0,
    fetchCaptureHit: 0,
    fetchDiscoveryHit: 0,
    perfSeen: 0,
    perfDiscoverySeen: 0,
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
  const discoveryRe = URL_DISCOVERY_ALLOWLIST.length
    ? new RegExp(URL_DISCOVERY_ALLOWLIST.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))
    : null;

  function shouldCapture(url) {
    if (!url || typeof url !== "string") return false;
    if (blacklistRe && blacklistRe.test(url)) return false;
    if (!whitelistRe) return false;
    return whitelistRe.test(url);
  }
  function isTemuSellerHost() {
    return /(^|\.)agentseller(-eu|-us)?\.temu\.com$|^seller\.kuajingmaihuo\.com$/i.test(location.hostname);
  }
  function shouldDiscover(url) {
    if (!isTemuSellerHost()) return false;
    if (!url || typeof url !== "string") return false;
    if (blacklistRe && blacklistRe.test(url)) return false;
    if (whitelistRe && whitelistRe.test(url)) return false;
    return Boolean(discoveryRe && discoveryRe.test(url));
  }
  function buildCapturedPayload(base, text, requestBodyText, discovery) {
    const maxChars = Math.max(1000, Number(DISCOVERY_MAX_BODY_CHARS) || 60000);
    const keepBody = !discovery || String(text || "").length <= maxChars;
    const bodyText = keepBody ? text : null;
    return {
      ...base,
      body: keepBody ? safeJson(text) : null,
      bodyText,
      bodyTruncated: !keepBody,
      bodySize: String(text || "").length,
      requestBodyText,
    };
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
    return null;
  }
  function fetchRequestBodyTextAsync(input, init) {
    const immediate = fetchRequestBodyText(input, init);
    if (immediate) return Promise.resolve(immediate);
    try {
      if (input && typeof input !== "string" && typeof input.clone === "function") {
        const method = String(input.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD" && input.bodyUsed === false) {
          return input.clone().text().catch(() => null);
        }
      }
    } catch {}
    return Promise.resolve(null);
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
  const AUTO_PAGE_ENDPOINTS = [
    { key: "sales", re: /\/mms\/venom\/api\/supplier\/sales\/management\/listOverall/ },
    { key: "stock_order", re: /\/purchase\/manager\/querySubOrderList/ },
    { key: "shipping_desk", re: /deliverGoods\/platform\/pageQuerySubPurchaseOrder|deliverGoods\/management\/pageQueryDeliveryBatch/ },
    { key: "shipping_list", re: /deliverGoods\/management\/pageQueryDeliveryOrders/ },
  ];
  const autoPageSeen = new Set();
  const fulfillmentTabSweepSeen = new Set();
  const FULFILLMENT_TAB_PATH_RE = /\/stock\/fully-mgt\/order-manage|\/main\/order-manager\/shipping-desk|\/main\/order-manager\/shipping-list/i;
  const FULFILLMENT_TAB_LABEL_RE = /^(全部|待处理|待接单|待发货|待送货|待创建|待确认|待揽收|待取货|待入库|待到仓|已接单|已发货|已送货|已创建|已确认|已揽收|已入库|异常|超期|逾期|今日|普通|加急|可发货|不可发货)(\s*\d+)?$/;
  const FULFILLMENT_TAB_EXCLUDE_RE = /搜索|查询|清空|重置|导出|下载|打印|设置|生成|创建发货单|删除|刷新|同步|问题|地址|权限/;

  function autoPageEndpoint(url) {
    return AUTO_PAGE_ENDPOINTS.find((item) => item.re.test(String(url || ""))) || null;
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function tabClickableFor(el) {
    try {
      return el.closest('button,[role="tab"],[role="button"],a,[class*="tab"],[class*="Tab"],[class*="radio"],[class*="Radio"]') || el;
    } catch {
      return el;
    }
  }

  function findFulfillmentTabCandidates() {
    const nodes = Array.from(document.querySelectorAll('[role="tab"], button, a, span, div'));
    const seen = new Set();
    const candidates = [];
    for (const node of nodes) {
      const text = compactText(node.innerText || node.textContent);
      if (!text || text.length > 24) continue;
      if (!FULFILLMENT_TAB_LABEL_RE.test(text)) continue;
      if (FULFILLMENT_TAB_EXCLUDE_RE.test(text)) continue;
      const clickable = tabClickableFor(node);
      if (!clickable || seen.has(clickable)) continue;
      const cls = String(clickable.className || "");
      if (/disabled|disable|forbid/i.test(cls) || clickable.getAttribute?.("aria-disabled") === "true") continue;
      const rect = clickable.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      seen.add(clickable);
      candidates.push({ el: clickable, text });
    }
    return candidates.slice(0, 30);
  }

  function maybeSweepFulfillmentTabs(endpointKey) {
    try {
      if (endpointKey === "sales") return;
      if (!isCollectorPage()) return;
      if (!FULFILLMENT_TAB_PATH_RE.test(location.pathname)) return;
      if (window.__temuMonitorFulfillmentTabSweeping) return;
      const seenKey = `${location.pathname}|${endpointKey}`;
      if (fulfillmentTabSweepSeen.has(seenKey)) return;
      const candidates = findFulfillmentTabCandidates();
      if (candidates.length <= 1) return;
      fulfillmentTabSweepSeen.add(seenKey);
      window.__temuMonitorFulfillmentTabSweeping = true;
      let index = 0;
      const finish = () => { window.__temuMonitorFulfillmentTabSweeping = false; };
      const step = () => {
        if (index >= candidates.length) return finish();
        const candidate = candidates[index++];
        try { clickPagerElement(candidate.el); } catch {}
        setTimeout(step, 3500);
      };
      setTimeout(step, 1800);
    } catch {}
  }

  function firstArrayValue(candidates) {
    for (const value of candidates) {
      if (Array.isArray(value) && value.length) return value;
    }
    return [];
  }

  function rowsFromPagedResponse(url, responseBody) {
    const root = responseBody?.result ?? responseBody?.data ?? responseBody;
    const data = responseBody?.data;
    const result = responseBody?.result;
    const rows = firstArrayValue([
      result?.pageItems,
      result?.dataList,
      result?.list,
      result?.items,
      result?.records,
      result?.rows,
      result?.subOrderList,
      result?.subPurchaseOrderList,
      result?.purchaseOrderList,
      result?.deliveryBatchList,
      result?.deliveryBatchVOList,
      result?.deliveryOrderList,
      result?.deliveryOrderVOList,
      result?.page?.records,
      result?.page?.rows,
      data?.pageItems,
      data?.dataList,
      data?.list,
      data?.items,
      data?.records,
      data?.rows,
      data?.subOrderList,
      data?.subPurchaseOrderList,
      data?.purchaseOrderList,
      data?.deliveryBatchList,
      data?.deliveryBatchVOList,
      data?.deliveryOrderList,
      data?.deliveryOrderVOList,
      data?.page?.records,
      data?.page?.rows,
      root?.pageItems,
      root?.dataList,
      root?.list,
      root?.items,
      root?.records,
      root?.rows,
      root?.subOrderList,
      root?.subPurchaseOrderList,
      root?.purchaseOrderList,
      root?.deliveryBatchList,
      root?.deliveryBatchVOList,
      root?.deliveryOrderList,
      root?.deliveryOrderVOList,
      root?.page?.records,
      root?.page?.rows,
    ]);
    if (rows.length) return rows;
    if (!autoPageEndpoint(url)) return [];
    const stack = [root];
    const seen = new Set();
    let steps = 0;
    while (stack.length && steps < 800) {
      steps++;
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (Array.isArray(node)) {
        if (node.some((item) => item && typeof item === "object" && !Array.isArray(item))) return node;
        continue;
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return [];
  }

  function totalFromPagedResponse(responseBody) {
    const root = responseBody?.result ?? responseBody?.data ?? responseBody;
    return findNumberDeep(root, [
      "total",
      "totalCount",
      "totalSize",
      "totalNum",
      "totalRecords",
      "recordCount",
      "count",
    ]);
  }

  function maybeAutoPaginate(url, method, input, init, requestBodyText, responseBody) {
    try {
      const endpoint = autoPageEndpoint(url);
      if (!endpoint) return;
      maybeSweepFulfillmentTabs(endpoint.key);
      const rows = rowsFromPagedResponse(url, responseBody);
      const total = Number(totalFromPagedResponse(responseBody) || 0);
      if (endpoint.key === "sales" && rows.length && Number.isFinite(total) && total > rows.length) {
        maybeClickSalesPagination(total, rows.length || 10);
      }
      if (!requestBodyText || !rows.length || !Number.isFinite(total) || total <= rows.length) return;
      const pageInfo = getPageInfoFromRequest(requestBodyText, rows.length);
      const pageSize = Math.max(1, Math.min(100, Number(pageInfo.pageSize) || rows.length || 10));
      const pageNo = Math.max(1, Number(pageInfo.pageNo) || 1);
      const pageCount = Math.min(endpoint.key === "sales" ? 50 : 120, Math.ceil(total / pageSize));
      if (pageNo >= pageCount) return;
      const seenKey = endpoint.key + "|" + String(url) + "|" + String(requestBodyText).slice(0, 500) + "|" + total;
      if (autoPageSeen.has(seenKey)) return;
      autoPageSeen.add(seenKey);
      const run = async () => {
        for (let nextPage = pageNo + 1; nextPage <= pageCount; nextPage++) {
          const nextBody = buildNextPageBody(requestBodyText, nextPage, pageSize);
          if (!nextBody) break;
          const nextInit = { ...(init || {}) };
          try {
            if (!nextInit.headers && input && typeof input !== "string" && input.headers) {
              nextInit.headers = new Headers(input.headers);
            }
            for (const key of ["credentials", "mode", "cache", "redirect", "referrer", "referrerPolicy"]) {
              if (nextInit[key] == null && input && typeof input !== "string" && input[key] != null) {
                nextInit[key] = input[key];
              }
            }
          } catch {}
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
            requestBodyText: nextBody,
            bodySize: text.length,
            autoPage: nextPage,
            autoPageSize: pageSize,
            autoPageTotal: total,
            autoPageSource: endpoint.key,
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
      const captureMode = !_bypass && shouldCapture(_url) ? "capture" : (!_bypass && shouldDiscover(_url) ? "discovery" : "");
      if (captureMode) {
        if (captureMode === "capture") stats.xhrCaptureHit++;
        else stats.xhrDiscoveryHit++;
        xhr.addEventListener("readystatechange", function () {
          if (xhr.readyState !== 4) return;
          try {
            const text = xhr.responseText || "";
            if (shouldActivityLibraryCollectFromUrl(_url)) {
              scheduleActivityLibraryCollect(extractSkcIdsFromSource(safeJson(text)));
            }
            emit(buildCapturedPayload({
              kind: captureMode === "discovery" ? "xhr-discovery" : "xhr",
              url: _url, method: _method, status: xhr.status, ts: _ts,
              site: inferMallSite(), page: location.pathname,
            }, text, _requestBodyText, captureMode === "discovery"));
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
    const captureMode = shouldCapture(url) ? "capture" : (shouldDiscover(url) ? "discovery" : "");
    if (!captureMode) return OrigFetch.apply(this, arguments);
    if (captureMode === "capture") stats.fetchCaptureHit++;
    else stats.fetchDiscoveryHit++;
    const ts = Date.now();
    const requestBodyTextPromise = fetchRequestBodyTextAsync(input, init);
    const promise = OrigFetch.apply(this, arguments);
    return promise.then((resp) => {
      try {
        const cloned = resp.clone();
        cloned.text().then(async (text) => {
          try {
            const requestBodyText = await requestBodyTextPromise;
            const parsedBody = captureMode === "capture" ? safeJson(text) : null;
            if (captureMode === "capture" && shouldActivityLibraryCollectFromUrl(url)) {
              scheduleActivityLibraryCollect(extractSkcIdsFromSource(parsedBody));
            }
            emit(buildCapturedPayload({
              kind: captureMode === "discovery" ? "fetch-discovery" : "fetch",
              url, method, status: resp.status, ts,
              site: inferMallSite(), page: location.pathname,
            }, text, requestBodyText, captureMode === "discovery"));
            if (captureMode === "capture") maybeAutoPaginate(url, method, input, init, requestBodyText, parsedBody);
          } catch {}
        }).catch(() => {});
      } catch {}
      return resp;
    });
  }
  try { window.fetch = TrackedFetch; } catch {}

  // Active activity library collector. It mirrors the reference plugin:
  // collect current SKC ids, call marketing/enroll/list, and emit the response
  // through the same capture pipeline so the cloud parser builds the activity library.
  const ACTIVE_ACTIVITY_ENDPOINT = "/api/kiana/gamblers/marketing/enroll/list";
  const ACTIVE_ACTIVITY_BATCH_SIZE = 50;
  const ACTIVE_ACTIVITY_TTL_MS = 5 * 60 * 1000;
  const activeActivitySeen = window.__temuMonitorActivityLibrarySeen || (window.__temuMonitorActivityLibrarySeen = new Map());
  let activeActivityTimer = 0;
  let activeActivitySeedIds = new Set();

  function getCookieValue(names) {
    const wanted = Array.isArray(names) ? names : [names];
    const parts = String(document.cookie || "").split(/;\s*/);
    for (const name of wanted) {
      const prefix = String(name || "") + "=";
      const found = parts.find((part) => part.startsWith(prefix));
      if (found) {
        try { return decodeURIComponent(found.slice(prefix.length)); } catch { return found.slice(prefix.length); }
      }
    }
    return "";
  }

  function activityMallId() {
    return getCookieValue(["mallid", "mallId", "mall_id", "mallSupplierId", "supplierId"]);
  }

  function normalizeSkcId(value) {
    const text = String(value == null ? "" : value).trim();
    return /^\d{5,}$/.test(text) ? text : "";
  }

  function addSkcIdsFromText(text, out) {
    const source = String(text || "");
    if (!source) return;
    const labeled = /(?:productSkcId|productSKCId|goodsSkcId|skcId|SKC|skc)\s*(?:ID|id)?\s*[:：=]?\s*["']?(\d{5,})/g;
    let match;
    while ((match = labeled.exec(source))) {
      const id = normalizeSkcId(match[1]);
      if (id) out.add(id);
      if (out.size >= 200) return;
    }
  }

  function extractSkcIdsFromSource(root) {
    const out = new Set();
    const stack = [root];
    let steps = 0;
    while (stack.length && steps < 8000 && out.size < 200) {
      steps++;
      const node = stack.pop();
      if (node == null) continue;
      if (typeof node === "string" || typeof node === "number") {
        addSkcIdsFromText(node, out);
        continue;
      }
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      if (typeof node !== "object") continue;
      for (const [key, value] of Object.entries(node)) {
        if (/skc/i.test(key)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              const id = normalizeSkcId(item);
              if (id) out.add(id);
            }
          } else {
            const id = normalizeSkcId(value);
            if (id) out.add(id);
          }
        }
        if (typeof value === "string" || typeof value === "number") addSkcIdsFromText(value, out);
        else if (value && typeof value === "object") stack.push(value);
      }
    }
    return Array.from(out);
  }

  function collectVisibleSkcIds() {
    const out = new Set();
    try {
      const nodes = Array.from(document.querySelectorAll("[data-row-key], tr, [role='row'], td, [class*='skc'], [class*='sku']"));
      for (const node of nodes.slice(0, 1800)) {
        addSkcIdsFromText(node && node.textContent, out);
        if (out.size >= 200) break;
      }
      if (out.size === 0 && document.body) {
        addSkcIdsFromText(String(document.body.innerText || "").slice(0, 300000), out);
      }
    } catch {}
    return Array.from(out);
  }

  function shouldActivityLibraryCollectFromUrl(url) {
    const text = String(url || "");
    if (!text || /\/api\/kiana\/gamblers\/marketing\/enroll\/list/i.test(text)) return false;
    return /sale-manage|sales\/management|fully-mgt|goods\/list|product\/skc\/|pageQuery|skuQuantity/i.test(text);
  }

  function scheduleActivityLibraryCollect(seedIds) {
    if (!isTemuSellerHost()) return;
    const ids = Array.isArray(seedIds) ? seedIds : [];
    for (const id of ids) {
      const normalized = normalizeSkcId(id);
      if (normalized) activeActivitySeedIds.add(normalized);
    }
    if (activeActivityTimer) clearTimeout(activeActivityTimer);
    activeActivityTimer = setTimeout(() => {
      activeActivityTimer = 0;
      runActivityLibraryCollect().catch(() => {});
    }, 900);
  }

  async function runActivityLibraryCollect() {
    if (!isTemuSellerHost() || !OrigFetch) return;
    const mallId = activityMallId();
    const ids = Array.from(new Set([...activeActivitySeedIds, ...collectVisibleSkcIds()])).filter(normalizeSkcId).sort();
    activeActivitySeedIds = new Set();
    if (!ids.length) return;
    const now = Date.now();
    for (const [key, seenAt] of Array.from(activeActivitySeen.entries())) {
      if (!seenAt || now - Number(seenAt) > ACTIVE_ACTIVITY_TTL_MS) activeActivitySeen.delete(key);
    }
    const url = `${location.origin}${ACTIVE_ACTIVITY_ENDPOINT}`;
    for (let start = 0; start < ids.length; start += ACTIVE_ACTIVITY_BATCH_SIZE) {
      const batch = ids.slice(start, start + ACTIVE_ACTIVITY_BATCH_SIZE);
      const seenKey = `${mallId || ""}|${batch.join(",")}`;
      const seenAt = Number(activeActivitySeen.get(seenKey) || 0);
      if (seenAt && now - seenAt < ACTIVE_ACTIVITY_TTL_MS) continue;
      activeActivitySeen.set(seenKey, now);
      const requestBody = JSON.stringify({
        pageNo: 1,
        pageSize: 50,
        productSkcIds: batch,
        sessionStatusTag: 4,
      });
      const headers = { "Content-Type": "application/json" };
      if (mallId) headers.mallid = mallId;
      try {
        const init = {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: requestBody,
        };
        init[BYPASS_SYM] = true;
        const resp = await OrigFetch.call(window, url, init);
        const text = await resp.clone().text();
        emit({
          kind: "fetch-active-activity-library",
          url,
          method: "POST",
          status: resp.status,
          ts: Date.now(),
          site: inferMallSite(),
          page: location.pathname,
          mall_id: mallId || null,
          body: safeJson(text),
          bodyText: text.length > 200000 ? null : text,
          requestBodyText: requestBody,
          bodySize: text.length,
          activeSource: "marketing_enroll_list",
          activeSkcCount: batch.length,
        });
        stats.activeActivityFetchTotal = (stats.activeActivityFetchTotal || 0) + 1;
      } catch {
        activeActivitySeen.delete(seenKey);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  setTimeout(() => scheduleActivityLibraryCollect([]), 2500);
  setTimeout(() => scheduleActivityLibraryCollect([]), 8000);
  try {
    const mo = new MutationObserver(() => scheduleActivityLibraryCollect([]));
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch {}

  // -------------------- PerformanceObserver --------------------
  const performanceSeen = new Set();
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.entryType !== "resource") continue;
        if (e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest") continue;
        const captureMode = shouldCapture(e.name) ? "capture" : (shouldDiscover(e.name) ? "discovery" : "");
        if (!captureMode) continue;
        const key = e.name + "|" + Math.round(e.startTime);
        if (performanceSeen.has(key)) continue;
        performanceSeen.add(key);
        if (captureMode === "capture") stats.perfSeen++;
        else stats.perfDiscoverySeen++;
        if (performanceSeen.size > 5000) {
          const it = performanceSeen.values();
          for (let i = 0; i < 1000; i++) performanceSeen.delete(it.next().value);
        }
        emit({
          kind: captureMode === "discovery" ? "perf-discovery" : "perf",
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
    version: "0.3.1",
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
