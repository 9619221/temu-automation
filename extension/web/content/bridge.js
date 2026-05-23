// ============================================================
// Content script bridge —— isolated world，document_start
// ============================================================
// 1. 读取构建期生成的 __TEMU_MONITOR_BUILD_CONFIG__（_config.generated.js 注入）
// 2. 注入 page world hook（hook.js 走 web_accessible_resources）
// 3. 转发 page world 上行的 CustomEvent → service worker
// 4. 接 SW 的 GET_PAGE_STATS 探针，回报 page world 健康度
// ============================================================

(function () {
  // 构建期常量。如果缺，用兜底（最小化保证 hook 仍能跑）
  const WHITELIST_PAYLOAD = (typeof window !== "undefined" && window.__TEMU_MONITOR_BUILD_CONFIG__) || {
    URL_WHITELIST: [],
    URL_BLACKLIST: ["/api/phantom/", "/api/server/_stm", "/pmm/api/pmm/", "/b/th"],
    EVENT_NAME: "temu-monitor.captured",
    BYPASS_SYMBOL_KEY: "temu-monitor.fetch.bypass",
  };
  const EVENT_NAME = WHITELIST_PAYLOAD.EVENT_NAME || "temu-monitor.captured";
  const ALLOWED_HOST_RE = /(^|\.)agentseller(-eu|-us)?\.temu\.com$|^seller\.kuajingmaihuo\.com$|(^|\.)erp321\.com$|(^|\.)jushuitan\.com$|(^|\.)scm121\.com$|(^|\.)feishu\.cn$|(^|\.)pftk\.temu\.com$|^pftk-cn\.kuajingmaihuo\.com$|^thtk-us\.seller\.temu\.com$/i;

  if (!ALLOWED_HOST_RE.test(location.hostname)) {
    return;
  }

  // ---------- 1. 注入 page world hook ----------
  // 不用 inline script（page CSP 通常拦），改用 chrome-extension URL + dataset 传配置：
  // hook.js 启动时读 document.currentScript.dataset.cfgB64 拿白名单
  function injectHook() {
    try {
      const cfgB64 = btoa(unescape(encodeURIComponent(JSON.stringify(WHITELIST_PAYLOAD))));
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("web/page/hook.js");
      s.dataset.temuMonitor = "local";
      s.dataset.cfgB64 = cfgB64;
      s.onload = () => s.remove();
      s.onerror = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn("[temu-monitor] injectHook failed:", e);
    }
  }

  injectHook();

  // ---------- 2. 异步从 SW 拉远端版本（可选） ----------
  try {
    chrome.runtime.sendMessage({ type: "FETCHSCRIPT" }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (!resp || !resp.success || !resp.scriptContent) return;
      try {
        if (resp.config) {
          const cfgScript = document.createElement("script");
          cfgScript.textContent = `window.__temuMonitorConfig = ${JSON.stringify(resp.config)};`;
          cfgScript.dataset.temuMonitor = "config-remote";
          (document.head || document.documentElement).appendChild(cfgScript);
          cfgScript.remove();
        }
        const blob = new Blob([resp.scriptContent], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const s = document.createElement("script");
        s.src = url;
        s.dataset.temuMonitor = "remote";
        s.onload = () => { URL.revokeObjectURL(url); s.remove(); };
        s.onerror = () => { URL.revokeObjectURL(url); s.remove(); };
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {
        console.warn("[temu-monitor] remote inject failed:", e);
      }
    });
  } catch (e) {
    // chrome.runtime 不可用（极端情况），忽略
  }

  // ---------- 3. 监听 page world 上行 CustomEvent ----------
  window.addEventListener(EVENT_NAME, (ev) => {
    const payload = ev && ev.detail;
    if (!payload) return;
    if (payload.bodyText && payload.bodyText.length > 1_000_000) {
      payload.bodyText = null;
      payload.bodyTruncated = true;
    }
    try {
      chrome.runtime.sendMessage({ type: "CAPTURED", payload }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
  });

  // ---------- 4. SW 探针：拉 page world stats ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "COLLECT_FEISHU_SUPPLIERS") {
      collectFeishuSupplierRows(msg || {})
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, reason: String(error?.message || error).slice(0, 200) }));
      return true;
    }
    if (msg.type !== "GET_PAGE_STATS") return;
    let settled = false;
    try {
      const probeId = "p" + Date.now() + Math.random().toString(36).slice(2, 8);
      const ackEvent = "temu-monitor.stats.ack";
      const onAck = (ev) => {
        if (!ev || !ev.detail || ev.detail.probeId !== probeId) return;
        window.removeEventListener(ackEvent, onAck);
        if (settled) return;
        settled = true;
        sendResponse({ ok: true, ...ev.detail });
      };
      window.addEventListener(ackEvent, onAck);

      const s = document.createElement("script");
      s.textContent = `
        (function() {
          try {
            window.dispatchEvent(new CustomEvent(${JSON.stringify(ackEvent)}, {
              detail: {
                probeId: ${JSON.stringify(probeId)},
                stats: window.__temuMonitorStats || null,
                healthy: window.__temuMonitor && window.__temuMonitor.healthy ? window.__temuMonitor.healthy() : null,
                ver: window.__temuMonitor && window.__temuMonitor.version || null,
                xhrName: XMLHttpRequest.name || "(noname)",
                pageUrl: location.href
              }
            }));
          } catch(e) {
            window.dispatchEvent(new CustomEvent(${JSON.stringify(ackEvent)}, {
              detail: { probeId: ${JSON.stringify(probeId)}, error: String(e).slice(0,200) }
            }));
          }
        })();
      `;
      s.dataset.temuMonitor = "probe";
      (document.head || document.documentElement).appendChild(s);
      s.remove();

      setTimeout(() => {
        window.removeEventListener(ackEvent, onAck);
        if (settled) return;
        settled = true;
        try { sendResponse({ ok: false, reason: "probe_timeout" }); } catch {}
      }, 2000);
      return true; // async
    } catch (e) {
      if (!settled) {
        settled = true;
        sendResponse({ ok: false, reason: String(e).slice(0, 200) });
      }
    }
  });

  async function collectFeishuSupplierRows(options) {
    if (!/(^|\.)feishu\.cn$/i.test(location.hostname) || !/\/base\//i.test(location.pathname)) {
      return { ok: false, reason: "当前页面不是飞书 Base" };
    }
    const maxSteps = Math.max(2, Math.min(80, Number(options.maxSteps) || 30));
    const delayMs = Math.max(150, Math.min(1200, Number(options.delayMs) || 350));
    const scroller = findMainScrollContainer();
    const snapshots = [];
    let lastTop = -1;
    for (let step = 0; step < maxSteps; step += 1) {
      snapshots.push(...readVisibleTableRows());
      if (!scroller) break;
      const currentTop = Math.round(scroller.scrollTop || 0);
      const nextTop = Math.min(scroller.scrollHeight || 0, currentTop + Math.max(260, Math.round((scroller.clientHeight || window.innerHeight || 600) * 0.85)));
      if (nextTop === currentTop || currentTop === lastTop) break;
      lastTop = currentTop;
      scroller.scrollTop = nextTop;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const rows = dedupeRows(snapshots);
    if (rows.length) {
      try {
        chrome.runtime.sendMessage({
          type: "FEISHU_SUPPLIERS_CAPTURED",
          payload: {
            source: "feishu_supplier_table",
            sourceUrl: location.href,
            table: new URLSearchParams(location.search).get("table") || "",
            view: new URLSearchParams(location.search).get("view") || "",
            rows,
            capturedAt: Date.now(),
          },
        }, () => { void chrome.runtime.lastError; });
      } catch {}
    }
    return { ok: true, rows: rows.length, sourceUrl: location.href };
  }

  function findMainScrollContainer() {
    const candidates = Array.from(document.querySelectorAll("div, main, section"))
      .filter((el) => {
        const style = getComputedStyle(el);
        const overflow = `${style.overflowY} ${style.overflow}`;
        return /(auto|scroll)/i.test(overflow) && el.scrollHeight > el.clientHeight + 120;
      })
      .sort((a, b) => (b.clientHeight * b.clientWidth) - (a.clientHeight * a.clientWidth));
    return candidates[0] || document.scrollingElement || document.documentElement;
  }

  function readVisibleTableRows() {
    const rows = [];
    const looseHeaders = Array.from(document.querySelectorAll('[role="columnheader"], th'))
      .map((cell) => normalizeVisibleText(cell.innerText || cell.textContent || ""))
      .filter(Boolean);
    if (looseHeaders.length >= 2) rows.push({ __visibleCells: looseHeaders });
    const tableRows = Array.from(document.querySelectorAll('[role="row"], tr'));
    for (const row of tableRows) {
      const cells = Array.from(row.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"], th, td'));
      if (cells.length < 2) continue;
      const texts = cells.map((cell) => normalizeVisibleText(cell.innerText || cell.textContent || "")).filter(Boolean);
      if (texts.length < 2) continue;
      rows.push({ __visibleCells: texts });
    }
    return rows;
  }

  function normalizeVisibleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function dedupeRows(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }
})();
