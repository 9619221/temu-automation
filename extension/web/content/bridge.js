// ============================================================
// Content script bridge —— isolated world，document_start
// ============================================================
// 1. 读取构建期生成的 __TEMU_MONITOR_BUILD_CONFIG__（_config.generated.js 注入）
// 2. 转发 page world 上行的 CustomEvent → service worker
// 3. 接 SW 的 GET_PAGE_STATS 探针，回报 page world 健康度
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
      const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
      const serviceWorkerPath = manifest && manifest.background && manifest.background.service_worker;
      const hookPath = serviceWorkerPath === "background/sw.js" ? "page/hook.js" : "web/page/hook.js";
      s.src = chrome.runtime.getURL(hookPath);
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

  // ---------- 2. 监听 page world 上行 CustomEvent ----------
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
    if (msg.type === "ENROLL_SUBMIT" && msg.task) {
      // SW 下发报名任务 → 转 page world hook 用登录态+anti-content 发 submit → 结果回传 SW
      let settled = false;
      const reqId = "e" + Date.now() + Math.random().toString(36).slice(2, 8);
      const resultEvent = "temu-monitor.enroll-result";
      const onResult = (ev) => {
        if (!ev || !ev.detail || ev.detail.reqId !== reqId) return;
        window.removeEventListener(resultEvent, onResult);
        if (settled) return;
        settled = true;
        sendResponse(ev.detail);
      };
      window.addEventListener(resultEvent, onResult);
      try {
        window.dispatchEvent(new CustomEvent("temu-monitor.enroll-request", { detail: { reqId, body: msg.task.body } }));
      } catch (e) {
        if (!settled) { settled = true; sendResponse({ ok: false, error: String(e).slice(0, 200) }); }
        return true;
      }
      setTimeout(() => {
        window.removeEventListener(resultEvent, onResult);
        if (settled) return;
        settled = true;
        try { sendResponse({ ok: false, error: "enroll_page_timeout" }); } catch {}
      }, 30000);
      return true; // async
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
    const apiRows = await collectFeishuRowsFromApi().catch((error) => ({
      ok: false,
      reason: String(error?.message || error).slice(0, 200),
      rows: [],
    }));
    if (apiRows.ok && apiRows.rows.length) {
      await sendFeishuSupplierChunks(apiRows.rows, {
        sourceUrl: location.href,
        table: apiRows.table || "",
        view: apiRows.view || "",
        mode: "api",
      });
      return { ok: true, rows: apiRows.rows.length, sourceUrl: location.href, mode: "api" };
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
      await sendFeishuSupplierChunks(rows, {
        sourceUrl: location.href,
        table: new URLSearchParams(location.search).get("table") || "",
        view: new URLSearchParams(location.search).get("view") || "",
        mode: "dom",
      });
    }
    return { ok: true, rows: rows.length, sourceUrl: location.href, mode: "dom", reason: apiRows.reason || null };
  }

  async function collectFeishuRowsFromApi() {
    const tokenMatch = location.pathname.match(/\/base\/([^/?#]+)/i);
    const token = tokenMatch?.[1];
    if (!token) return { ok: false, rows: [], reason: "missing_token" };
    const base = `${location.origin}/space/api/bitable/${token}`;
    const tablesResp = await fetch(`${base}/tablesv3/`, { credentials: "include" });
    if (!tablesResp.ok) return { ok: false, rows: [], reason: `tablesv3_${tablesResp.status}` };
    const tablesBody = await tablesResp.json();
    const tableEntries = Object.entries(tablesBody?.data || {});
    const allRows = [];
    for (const [tableId, encoded] of tableEntries) {
      const tableMeta = await decodeFeishuEncodedJson(encoded).catch(() => null);
      if (!tableMeta?.meta) continue;
      const viewId = Array.isArray(tableMeta.views) ? tableMeta.views[0] : Object.keys(tableMeta.viewMap || {})[0];
      const fieldMap = buildFeishuFieldNameMap(tableMeta.fieldMap || {});
      const total = Math.max(0, Number(tableMeta.meta.recordsNum || 0));
      const rev = Number(tableMeta.meta.rev || 0);
      const pageSize = 200;
      for (let offset = 0; offset < total; offset += pageSize) {
        const url = new URL(`${base}/records`);
        url.searchParams.set("tableId", tableId);
        url.searchParams.set("viewId", viewId || "");
        url.searchParams.set("tableRev", String(rev));
        url.searchParams.set("depRev", "{}");
        url.searchParams.set("viewLazyLoad", "true");
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(pageSize));
        url.searchParams.set("tableID", tableId);
        url.searchParams.set("viewID", viewId || "");
        url.searchParams.set("removeFmlExtra", "true");
        const resp = await fetch(url.toString(), { credentials: "include" });
        if (!resp.ok) continue;
        const body = await resp.json().catch(() => null);
        const decoded = await decodeFeishuRecordsBody(body).catch(() => null);
        const pageRows = normalizeFeishuRecordRows(decoded, fieldMap, tableId, viewId);
        allRows.push(...pageRows);
      }
    }
    return {
      ok: allRows.length > 0,
      rows: dedupeRows(allRows),
      table: tableEntries.map(([tableId]) => tableId).join(","),
      view: "",
    };
  }

  async function decodeFeishuRecordsBody(body) {
    const data = body?.data || body;
    if (!data) return null;
    if (typeof data.records === "string") return decodeFeishuEncodedJson(data.records);
    if (Array.isArray(data.records) || data.recordMap || data.recordsMap) return data;
    return data;
  }

  async function decodeFeishuEncodedJson(encoded) {
    if (!encoded || typeof encoded !== "string") return null;
    const text = await ungzipBase64(encoded);
    return JSON.parse(text);
  }

  async function ungzipBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (!("DecompressionStream" in window)) throw new Error("browser_missing_gzip_decoder");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  function buildFeishuFieldNameMap(fieldMap) {
    const out = {};
    for (const [fieldId, meta] of Object.entries(fieldMap || {})) {
      out[fieldId] = meta?.name || fieldId;
    }
    return out;
  }

  function normalizeFeishuRecordRows(decoded, fieldMap, tableId, viewId) {
    const records = extractFeishuRecordArray(decoded);
    return records.map((record) => {
      const cells = record?.fields || record?.fieldMap || record?.cells || record?.data || record || {};
      const row = {
        __tableId: tableId,
        __viewId: viewId || "",
        __recordId: record?.id || record?.recordId || record?.record_id || "",
      };
      for (const [key, value] of Object.entries(cells)) {
        if (!key || key.startsWith("__")) continue;
        if (!fieldMap[key] && !/^fld/i.test(key)) continue;
        row[fieldMap[key] || key] = stringifyFeishuCell(value);
      }
      return row;
    }).filter((row) => Object.keys(row).some((key) => !key.startsWith("__") && row[key]));
  }

  function extractFeishuRecordArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value.records)) return value.records;
    if (Array.isArray(value.recordList)) return value.recordList;
    if (Array.isArray(value.data)) return value.data;
    const map = value.recordMap || value.recordsMap || value.record_map || null;
    if (map && typeof map === "object") return Object.values(map);
    return [];
  }

  function stringifyFeishuCell(value) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(stringifyFeishuCell).filter(Boolean).join(" ");
    if (typeof value === "object") {
      const direct = value.text || value.name || value.title || value.url || value.link || value.tmp_url || value.file_token || value.token;
      if (direct) return String(direct);
      return Object.values(value).map(stringifyFeishuCell).filter(Boolean).join(" ");
    }
    return "";
  }

  function sendFeishuSupplierChunks(rows, meta) {
    const chunks = [];
    for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));
    return Promise.all(chunks.map((chunk, index) => new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          type: "FEISHU_SUPPLIERS_CAPTURED",
          payload: {
            source: "feishu_supplier_table",
            sourceUrl: meta.sourceUrl,
            table: meta.table || "",
            view: meta.view || "",
            mode: meta.mode || "",
            chunkIndex: index,
            chunkCount: chunks.length,
            rows: chunk,
            capturedAt: Date.now(),
          },
        }, () => {
          void chrome.runtime.lastError;
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    })));
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
