// ============================================================
// Service Worker 入口
// ============================================================
// MV3 SW 会被 Chrome 回收，所有持久状态走 chrome.storage.local 或 IndexedDB
// 周期任务用 chrome.alarms（setInterval 不可靠）
// ============================================================

import {
  URL_WHITELIST,
  URL_BLACKLIST,
  URL_DISCOVERY_ALLOWLIST,
  DISCOVERY_MAX_BODY_CHARS,
  EVENT_NAME,
  BYPASS_SYMBOL_KEY,
} from "./hook-config.js";
import { enqueue, queueDepth, flush } from "./ingest-queue.js";

const ALARM_FLUSH = "temu-monitor.flush";
const ALARM_COLLECT = "temu-monitor.collect";
const STATS_KEY = "temu_monitor_stats";
const MALLS_KEY = "temu_monitor_malls";
const COLLECTOR_STATE_KEY = "temu_monitor_collector_state";
const COLLECTOR_WINDOW_KEY = "temu_monitor_collector_window";
const COLLECTOR_QUERY = "__temu_monitor_collector=1";
const COLLECTOR_ALARM_MINUTES = 2;
const COLLECTOR_BATCH_SIZE = 4;
const LOCAL_ERP_ENDPOINT = "http://127.0.0.1:8799";
const LOCAL_ERP_EXTENSION_TOKEN = "temu-jst-extension-v1";
const FEISHU_SUPPLIER_TABLE_URL = "https://mcn24onb5t1o.feishu.cn/base/RLy7bndc4aCXhtsx4yAcr2d8nSg?table=tbl0UhZRpR0niDSt&view=vew5Spjz7c";

const COLLECTOR_TARGETS = [
  { key: "products", url: "https://agentseller.temu.com/goods/list" },
  { key: "sales", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main" },
  { key: "orders", url: "https://agentseller.temu.com/stock/fully-mgt/order-manage" },
  { key: "urgent_orders", url: "https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency" },
  { key: "traffic_goods", url: "https://agentseller.temu.com/main/flux-analysis-full" },
  { key: "traffic_mall", url: "https://agentseller.temu.com/main/mall-flux-analysis-full" },
  { key: "flow_price", url: "https://agentseller.temu.com/newon/compete-manager" },
  { key: "activity_data", url: "https://agentseller.temu.com/main/act/data-full" },
  { key: "marketing_activity", url: "https://agentseller.temu.com/activity/marketing-activity" },
  { key: "chance_goods", url: "https://agentseller.temu.com/activity/marketing-activity/chance-goods" },
  { key: "bidding", url: "https://agentseller.temu.com/newon/invite-bids/list" },
  { key: "price_adjust", url: "https://agentseller.temu.com/main/adjust-price-manage/order-price" },
  { key: "high_price", url: "https://agentseller.temu.com/main/adjust-price-manage/high-price" },
  { key: "inbound_exception", url: "https://agentseller.temu.com/scp/purchase/board/supplier/exception" },
  { key: "after_sales", url: "https://agentseller.temu.com/main/aftersales/information" },
  { key: "sales_return", url: "https://agentseller.temu.com/activity/sales-return" },
  { key: "soldout", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/board/sku-sale-out" },
  { key: "receive_abnormal", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/board/receive-abnormal" },
  { key: "delivery_assessment", url: "https://agentseller.temu.com/wms/deliver-examine-board" },
  { key: "quality_dashboard", url: "https://agentseller.temu.com/main/quality/dashboard" },
  { key: "goods_checkup", url: "https://agentseller.temu.com/goods/checkup-center" },
  { key: "product_select", url: "https://agentseller.temu.com/newon/product-select" },
];

ensureRuntimeDefaults().catch((e) => console.warn("[sw] bootstrap skipped:", e?.message || e));

// ---------- 启动期初始化 ----------
chrome.runtime.onInstalled.addListener(async () => {
  await ensureRuntimeDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureRuntimeDefaults();
});

async function ensureRuntimeDefaults() {
  chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 0.5 });
  chrome.alarms.create(ALARM_COLLECT, { periodInMinutes: COLLECTOR_ALARM_MINUTES });
  const cur = await getStorage(["device_id", COLLECTOR_STATE_KEY]);
  const patch = {};
  if (!cur.device_id) patch.device_id = crypto.randomUUID();
  if (!cur[COLLECTOR_STATE_KEY]) {
    patch[COLLECTOR_STATE_KEY] = {
      enabled: true,
      index: 0,
      updated_at: Date.now(),
      reason: "auto_default",
    };
  }
  if (Object.keys(patch).length) await setStorage(patch);
  await tryAutoConfigure();
  const collectorState = patch[COLLECTOR_STATE_KEY] || cur[COLLECTOR_STATE_KEY];
  if (collectorState?.enabled !== false) {
    await runCollectorStep().catch((e) => console.warn("[sw] collector bootstrap err", e?.message || e));
  }
}

// 装好扩展自动连生产 cloud（默认 https://erp.temu.chat/cloud）
// 仅当 storage 还没配置时尝试；失败静默（如需指向其它环境，用户在 options 页手动填）
async function tryAutoConfigure() {
  const cur = await getStorage(["cloud_endpoint", "auth_token"]);
  if (cur.cloud_endpoint && cur.auth_token) return;
  if (await configureLocalErpIfAvailable()) return;
  const defaultEndpoint = "https://erp.temu.chat/cloud";
  try {
    const resp = await fetch(defaultEndpoint + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cjl20020421" }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data?.token) return;
    await setStorage({ cloud_endpoint: defaultEndpoint, auth_token: data.token });
    console.log(`[sw] auto-configured to ${defaultEndpoint}`);
  } catch (e) {
    console.warn("[sw] auto-configure skipped:", e?.message || e);
  }
}

async function configureLocalErpIfAvailable() {
  try {
    const resp = await fetch(LOCAL_ERP_ENDPOINT + "/api/ingest/v1/health", {
      method: "GET",
      headers: { Authorization: `Bearer ${LOCAL_ERP_EXTENSION_TOKEN}` },
    });
    if (!resp.ok) return false;
    await setStorage({ cloud_endpoint: LOCAL_ERP_ENDPOINT, auth_token: LOCAL_ERP_EXTENSION_TOKEN });
    console.log(`[sw] configured local ERP ${LOCAL_ERP_ENDPOINT}`);
    return true;
  } catch {
    return false;
  }
}

// ---------- 周期上报 ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_COLLECT) {
    await runCollectorStep().catch((e) => console.warn("[sw] collector err", e));
    return;
  }
  if (alarm.name !== ALARM_FLUSH) return;
  // 未配置兜底：onInstalled 阶段 fetch 偶尔失败（network stack 没准备好），
  // 这里 30s 一次重试，配置成功后立即心跳上来
  const cfgNow = await getStorage(["cloud_endpoint", "auth_token"]);
  if (!cfgNow.cloud_endpoint || !cfgNow.auth_token) {
    await tryAutoConfigure();
  }
  const result = await flush();
  await bumpStats({
    last_flush_at: Date.now(),
    last_flush_result: result,
    last_flush_sent: (result.sent || 0),
  });
  // 顺便心跳到 cloud 做远程诊断
  sendHeartbeat().catch((e) => console.warn("[sw] heartbeat err", e));
});

// 在任意 Temu tab 上抓 page world stats（供心跳用）
async function probePageStats() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://agentseller.temu.com/*",
        "https://agentseller-eu.temu.com/*",
        "https://agentseller-us.temu.com/*",
        "https://seller.kuajingmaihuo.com/*",
      ],
    });
    if (!tabs.length) return null;
    const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    return await new Promise((resolve) => {
      let settled = false;
      try {
        chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_STATS" }, (resp) => {
          if (settled) return;
          settled = true;
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp ? { ...resp, tabId: tab.id, tabUrl: tab.url } : null);
        });
      } catch {
        settled = true;
        resolve(null);
      }
      setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 2500);
    });
  } catch {
    return null;
  }
}

const RELOAD_VERSION_KEY = "last_reload_version";
const RECONFIG_VERSION_KEY = "last_reconfig_version";

async function sendHeartbeat() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", "device_id", STATS_KEY, COLLECTOR_STATE_KEY, RELOAD_VERSION_KEY, RECONFIG_VERSION_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return;
  const stats = cfg[STATS_KEY] || {};
  const collector = cfg[COLLECTOR_STATE_KEY] || {};
  const depth = await queueDepth();
  const probe = await probePageStats();
  const payload = {
    captured_count: stats.captured_count || 0,
    total_sent: stats.total_sent || 0,
    queue_depth: depth,
    last_capture_url: probe?.stats?.lastCaptureUrl || null,
    last_capture_at: probe?.stats?.lastCaptureAt || stats.last_capture_at || null,
    last_flush_at: stats.last_flush_at || null,
    last_flush_ok: stats.last_flush_result ? (stats.last_flush_result.ok ? 1 : 0) : null,
    last_flush_reason: stats.last_flush_result?.reason || null,
    hook_xhr_alive: probe?.healthy ? 1 : (probe ? 0 : null),
    hook_perf_seen: probe?.stats?.perfSeen || 0,
    page_url: probe?.pageUrl || null,
    collector_enabled: collector.enabled === false ? 0 : 1,
    collector_index: Number.isFinite(Number(collector.index)) ? Number(collector.index) : null,
    collector_last_target_key: collector.last_target_key || null,
    collector_last_target_url: collector.last_target_url || null,
    collector_last_targets: Array.isArray(collector.last_targets) ? collector.last_targets : [],
    collector_updated_at: Number(collector.updated_at) || null,
    last_reload_version: cfg[RELOAD_VERSION_KEY] || 0,
    last_reconfig_version: cfg[RECONFIG_VERSION_KEY] || 0,
    ts: Date.now(),
  };
  try {
    const resp = await fetch(cfg.cloud_endpoint.replace(/\/$/, "") + "/api/ingest/v1/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.auth_token}`,
        "X-Device-Id": cfg.device_id || "",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return;
    const json = await resp.json().catch(() => null);
    if (!json) return;

    // 1. 处理 reconfig：cloud 让我们改 cloud_endpoint / auth_token（不需要 reload，下次心跳走新 cloud）
    if (json.reconfig && json.reconfig_version > (cfg[RECONFIG_VERSION_KEY] || 0)) {
      const newCfg = {};
      if (json.reconfig.cloud_endpoint) newCfg.cloud_endpoint = json.reconfig.cloud_endpoint;
      if (json.reconfig.auth_token) newCfg.auth_token = json.reconfig.auth_token;
      newCfg[RECONFIG_VERSION_KEY] = json.reconfig_version;
      await setStorage(newCfg);
      console.log("[sw] cloud reconfigured to " + json.reconfig.cloud_endpoint + " version=" + json.reconfig_version);
    }

    // 2. 处理 reload
    if (json.needs_reload && json.reload_version > (cfg[RELOAD_VERSION_KEY] || 0)) {
      await setStorage({ [RELOAD_VERSION_KEY]: json.reload_version });
      console.log("[sw] cloud requested reload, version=" + json.reload_version);
      try { chrome.runtime.reload(); } catch (e) { console.warn("[sw] reload failed", e); }
    }
  } catch {}
}

// ---------- 处理 content script 上行 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "GET_HOOK_CONFIG") {
    sendResponse({
      URL_WHITELIST,
      URL_BLACKLIST,
      URL_DISCOVERY_ALLOWLIST,
      DISCOVERY_MAX_BODY_CHARS,
      EVENT_NAME,
      BYPASS_SYMBOL_KEY,
    });
    return true;
  }

  if (msg.type === "CAPTURED" && msg.payload) {
    handleCaptured(msg.payload, sender).catch((e) => console.warn("[sw] captured err", e));
    return false; // 不需要响应
  }

  if (msg.type === "QUERY_STATUS") {
    Promise.all([queueDepth(), getStorage([STATS_KEY, "cloud_endpoint", "auth_token", MALLS_KEY, COLLECTOR_STATE_KEY])])
      .then(([depth, cfg]) => {
        sendResponse({
          queueDepth: depth,
          stats: cfg[STATS_KEY] || {},
          malls: cfg[MALLS_KEY] || [],
          collector: cfg[COLLECTOR_STATE_KEY] || { enabled: false },
          configured: !!(cfg.cloud_endpoint && cfg.auth_token),
        });
      })
      .catch(() => sendResponse({ queueDepth: -1, stats: {}, configured: false }));
    return true; // async
  }

  if (msg.type === "FETCHSCRIPT") {
    fetchRemoteHook()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ success: false, error: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "FLUSH_NOW") {
    flush()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }

  if (msg.type === "START_COLLECTOR") {
    startCollector()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "STOP_COLLECTOR") {
    stopCollector()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "OPEN_FEISHU_SUPPLIER_TABLE") {
    openFeishuSupplierTable()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "SYNC_FEISHU_SUPPLIERS") {
    syncFeishuSuppliers()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "FEISHU_SUPPLIERS_CAPTURED" && msg.payload) {
    handleFeishuSuppliersCaptured(msg.payload, sender)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }
});

async function openFeishuSupplierTable() {
  const tabs = await chrome.tabs.query({ url: ["https://*.feishu.cn/base/*"] });
  const matched = tabs.find((tab) => tab?.url && tab.url.includes("/base/RLy7bndc4aCXhtsx4yAcr2d8nSg"));
  if (matched?.id) {
    await chrome.tabs.update(matched.id, { active: true, url: FEISHU_SUPPLIER_TABLE_URL });
    if (matched.windowId) await chrome.windows.update(matched.windowId, { focused: true });
    return { ok: true, opened: false, tabId: matched.id };
  }
  const tab = await chrome.tabs.create({ url: FEISHU_SUPPLIER_TABLE_URL, active: true });
  return { ok: true, opened: true, tabId: tab?.id || null };
}

async function syncFeishuSuppliers() {
  if (!(await configureLocalErpIfAvailable())) await tryAutoConfigure();
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/feishu\.cn\/base\//i.test(tab.url)) {
    const opened = await openFeishuSupplierTable();
    return { ok: true, opened: true, reason: "已打开飞书表，请登录后再次点击同步", ...opened };
  }
  const response = await sendMessageToTab(tab.id, {
    type: "COLLECT_FEISHU_SUPPLIERS",
    maxSteps: 50,
    delayMs: 300,
  });
  await flush();
  return {
    ok: Boolean(response?.ok),
    rows: response?.rows || 0,
    sourceUrl: response?.sourceUrl || tab.url,
    flushRequested: true,
    reason: response?.reason || null,
  };
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) return resolve({ ok: false, reason: "缺少当前标签页" });
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message || "页面脚本未就绪，请刷新飞书页" });
        return;
      }
      resolve(response || { ok: false, reason: "页面没有返回数据" });
    });
  });
}

async function handleFeishuSuppliersCaptured(payload, sender) {
  const enriched = {
    kind: "feishu-supplier-table",
    url: payload.sourceUrl || sender?.tab?.url || FEISHU_SUPPLIER_TABLE_URL,
    method: "EXTENSION",
    status: 200,
    ts: Date.now(),
    site: "feishu",
    page: "/base/RLy7bndc4aCXhtsx4yAcr2d8nSg",
    body: {
      source: "feishu_supplier_table",
      sourceUrl: payload.sourceUrl || sender?.tab?.url || FEISHU_SUPPLIER_TABLE_URL,
      table: payload.table || "tbl0UhZRpR0niDSt",
      view: payload.view || "vew5Spjz7c",
      rows: Array.isArray(payload.rows) ? payload.rows : [],
    },
    tab_id: sender?.tab?.id,
    tab_url: sender?.tab?.url || payload.sourceUrl || "",
    captured_at: Date.now(),
  };
  await enqueue(enriched);
  await bumpStats({ captured_count_delta: 1 });
  return { ok: true, rows: enriched.body.rows.length };
}

async function startCollector() {
  const now = Date.now();
  const state = {
    enabled: true,
    index: 0,
    last_started_at: now,
    last_step_at: 0,
    last_target_key: "",
    last_target_url: "",
    last_targets: [],
    updated_at: now,
  };
  await setStorage({ [COLLECTOR_STATE_KEY]: state });
  chrome.alarms.create(ALARM_COLLECT, { periodInMinutes: COLLECTOR_ALARM_MINUTES });
  await runCollectorStep(true);
  return { ok: true };
}

async function stopCollector() {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  const now = Date.now();
  await setStorage({ [COLLECTOR_STATE_KEY]: { ...(cfg[COLLECTOR_STATE_KEY] || {}), enabled: false, stopped_at: now, updated_at: now } });
  const windowId = cfg[COLLECTOR_WINDOW_KEY];
  if (windowId) {
    try { await chrome.windows.remove(windowId); } catch {}
  }
  await setStorage({ [COLLECTOR_WINDOW_KEY]: null });
  sendHeartbeat().catch((e) => console.warn("[sw] collector stop heartbeat err", e?.message || e));
  return { ok: true };
}

async function runCollectorStep(force = false) {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  const state = cfg[COLLECTOR_STATE_KEY] || {};
  if (!state.enabled && !force) return { ok: false, reason: "collector_disabled" };
  const index = Number.isFinite(Number(state.index)) ? Number(state.index) : 0;
  const batchSize = Math.min(COLLECTOR_BATCH_SIZE, COLLECTOR_TARGETS.length);
  const targets = Array.from({ length: batchSize }, (_, offset) => COLLECTOR_TARGETS[(index + offset) % COLLECTOR_TARGETS.length]);
  const targetUrls = targets.map((target) => markCollectorUrl(target.url));
  let windowId = cfg[COLLECTOR_WINDOW_KEY] || null;
  let tabs = [];
  if (windowId) {
    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      tabs = Array.isArray(win?.tabs) ? win.tabs : [];
    } catch {
      windowId = null;
    }
  }
  if (!windowId || !tabs.length) {
    const win = await chrome.windows.create({
      url: targetUrls[0],
      type: "popup",
      focused: false,
      width: 360,
      height: 300,
      left: 0,
      top: 0,
    });
    windowId = win.id;
    tabs = Array.isArray(win?.tabs) ? win.tabs : [];
  }
  for (let i = 0; i < targetUrls.length; i++) {
    const tab = tabs[i];
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: targetUrls[i], active: i === 0 });
    } else if (windowId) {
      const created = await chrome.tabs.create({ windowId, url: targetUrls[i], active: i === 0 });
      tabs[i] = created;
    }
  }
  const extraTabs = tabs.slice(targetUrls.length).map((tab) => tab?.id).filter(Boolean);
  for (const tabId of extraTabs) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
  const nextState = {
    ...state,
    enabled: true,
    index: (index + batchSize) % COLLECTOR_TARGETS.length,
    last_step_at: Date.now(),
    last_target_key: targets.map((target) => target.key).join(","),
    last_target_url: targetUrls[0],
    last_targets: targets.map((target, i) => ({ ...target, url: targetUrls[i] })),
    updated_at: Date.now(),
    last_error: null,
  };
  await setStorage({ [COLLECTOR_STATE_KEY]: nextState, [COLLECTOR_WINDOW_KEY]: windowId });
  sendHeartbeat().catch((e) => console.warn("[sw] collector heartbeat err", e?.message || e));
  return { ok: true, targets: nextState.last_targets };
}

function markCollectorUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(COLLECTOR_QUERY.split("=")[0], COLLECTOR_QUERY.split("=")[1]);
    return parsed.toString();
  } catch {
    const sep = String(url || "").includes("?") ? "&" : "?";
    return String(url || "") + sep + COLLECTOR_QUERY;
  }
}

async function handleCaptured(payload, sender) {
  // 注入店铺/账号上下文：从发送 tab 推断（mall_id 等需要从 cookie 或 userInfo 响应里拿，
  // userInfo 响应命中后记住店铺，后续同站点单店事件自动带上 mall_id）
  const knownMalls = (await getStorage([MALLS_KEY]))[MALLS_KEY] || [];
  const parsedMalls = collectMallInfos(payload);
  const matchedMall = parsedMalls[0] || inferMallFromKnownMalls(knownMalls, payload?.site);
  const enriched = {
    ...payload,
    mall_id: payload?.mall_id || payload?.mallId || matchedMall?.mallId || null,
    mall_name: payload?.mall_name || payload?.mallName || matchedMall?.mallName || null,
    tab_id: sender?.tab?.id,
    tab_url: sender?.tab?.url,
    captured_at: Date.now(),
  };
  if (parsedMalls.length) await rememberMalls(parsedMalls);
  await enqueue(enriched);
  await bumpStats({ captured_count_delta: 1 });
}

async function fetchRemoteHook() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", "device_id"]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) {
    return { success: false, error: "未配置云端" };
  }
  const base = cfg.cloud_endpoint.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${cfg.auth_token}`,
    "X-Device-Id": cfg.device_id || "",
  };
  const [configResp, scriptResp] = await Promise.all([
    fetch(base + "/api/hook/v1/config", { headers }),
    fetch(base + "/api/hook/v1/inject.js", { headers }),
  ]);
  if (!configResp.ok) return { success: false, error: `config HTTP ${configResp.status}` };
  if (!scriptResp.ok) return { success: false, error: `hook HTTP ${scriptResp.status}` };
  return {
    success: true,
    config: await configResp.json(),
    scriptContent: await scriptResp.text(),
  };
}

// ---------- 工具：storage / 累计统计 ----------
function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v || {})));
}
function setStorage(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function collectMallInfos(payload) {
  const body = payload?.body || safeParseJson(payload?.bodyText);
  const out = [];
  const seen = new Set();
  const stack = [body];
  let steps = 0;
  while (stack.length && steps < 8000) {
    steps++;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    const rawMallId = node.mallId ?? node.mall_id ?? node.mallSupplierId ?? node.supplierId;
    if (rawMallId != null && rawMallId !== "") {
      const mallId = String(rawMallId).trim();
      if (mallId && !seen.has(mallId)) {
        seen.add(mallId);
        out.push({
          mallId,
          mallName: node.mallName || node.mall_name || node.shopName || node.storeName || node.supplierName || null,
          site: node.site || node.siteId || node.siteName || payload?.site || null,
          lastSeen: Date.now(),
        });
      }
    }
    for (const key of Object.keys(node)) stack.push(node[key]);
  }
  return out;
}

function safeParseJson(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

function inferMallFromKnownMalls(malls, site) {
  if (!Array.isArray(malls) || !site) return null;
  const sameSite = malls.filter((m) => m?.site === site);
  if (!sameSite.length) return null;
  return sameSite.sort((a, b) => Number(b?.lastSeen || 0) - Number(a?.lastSeen || 0))[0] || null;
}

async function rememberMalls(malls) {
  const cur = (await getStorage([MALLS_KEY]))[MALLS_KEY] || [];
  const map = new Map();
  for (const item of Array.isArray(cur) ? cur : []) {
    if (!item?.mallId) continue;
    map.set(`${item.site || ""}|${item.mallId}`, item);
  }
  for (const item of malls) {
    if (!item?.mallId) continue;
    const key = `${item.site || ""}|${item.mallId}`;
    map.set(key, { ...(map.get(key) || {}), ...item, lastSeen: Date.now() });
  }
  const next = Array.from(map.values())
    .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
    .slice(0, 50);
  await setStorage({ [MALLS_KEY]: next });
}

async function bumpStats(patch) {
  const cur = (await getStorage([STATS_KEY]))[STATS_KEY] || {
    captured_count: 0,
    last_capture_at: 0,
    last_flush_at: 0,
    last_flush_result: null,
  };
  if (patch.captured_count_delta) {
    cur.captured_count = (cur.captured_count || 0) + patch.captured_count_delta;
    cur.last_capture_at = Date.now();
  }
  if (patch.last_flush_at) cur.last_flush_at = patch.last_flush_at;
  if (patch.last_flush_result) cur.last_flush_result = patch.last_flush_result;
  if (typeof patch.last_flush_sent === "number") {
    cur.total_sent = (cur.total_sent || 0) + patch.last_flush_sent;
  }
  await setStorage({ [STATS_KEY]: cur });
}
