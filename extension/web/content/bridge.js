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
  const ALLOWED_HOST_RE = /(^|\.)agentseller(-eu|-us)?\.temu\.com$|^seller\.kuajingmaihuo\.com$|(^|\.)erp321\.com$|(^|\.)jushuitan\.com$|(^|\.)scm121\.com$|(^|\.)pftk\.temu\.com$|^pftk-cn\.kuajingmaihuo\.com$|^thtk-us\.seller\.temu\.com$/i;

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
    if (!msg || msg.type !== "GET_PAGE_STATS") return;
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
})();
