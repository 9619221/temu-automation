// ============================================================
// Service Worker 入口
// ============================================================
// MV3 SW 会被 Chrome 回收，所有持久状态走 chrome.storage.local 或 IndexedDB
// 周期任务用 chrome.alarms（setInterval 不可靠）
// ============================================================

import { URL_WHITELIST, URL_BLACKLIST, EVENT_NAME, BYPASS_SYMBOL_KEY } from "./hook-config.js";
import { enqueue, queueDepth, flush } from "./ingest-queue.js";

const ALARM_FLUSH = "temu-monitor.flush";
const ALARM_COLLECT = "temu-monitor.collect";
const STATS_KEY = "temu_monitor_stats";
const MALLS_KEY = "temu_monitor_malls";
const COLLECTOR_STATE_KEY = "temu_monitor_collector_state";
const COLLECTOR_WINDOW_KEY = "temu_monitor_collector_window";
const COLLECTOR_QUERY = "__temu_monitor_collector=1";

const COLLECTOR_TARGETS = [
  { key: "sales", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main" },
  { key: "traffic_goods", url: "https://agentseller.temu.com/main/flux-analysis-full" },
  { key: "traffic_mall", url: "https://agentseller.temu.com/main/mall-flux-analysis-full" },
  { key: "activity_data", url: "https://agentseller.temu.com/main/act/data-full" },
  { key: "marketing_activity", url: "https://agentseller.temu.com/activity/marketing-activity" },
  { key: "chance_goods", url: "https://agentseller.temu.com/activity/marketing-activity/chance-goods" },
  { key: "bidding", url: "https://agentseller.temu.com/newon/invite-bids/list" },
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
  chrome.alarms.create(ALARM_COLLECT, { periodInMinutes: 5 });
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
  const cfg = await getStorage(["cloud_endpoint", "auth_token", "device_id", STATS_KEY, RELOAD_VERSION_KEY, RECONFIG_VERSION_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return;
  const stats = cfg[STATS_KEY] || {};
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
});

async function startCollector() {
  const state = {
    enabled: true,
    index: 0,
    last_started_at: Date.now(),
    last_step_at: 0,
    last_target_key: "",
    last_target_url: "",
  };
  await setStorage({ [COLLECTOR_STATE_KEY]: state });
  chrome.alarms.create(ALARM_COLLECT, { periodInMinutes: 5 });
  await runCollectorStep(true);
  return { ok: true };
}

async function stopCollector() {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  await setStorage({ [COLLECTOR_STATE_KEY]: { ...(cfg[COLLECTOR_STATE_KEY] || {}), enabled: false, stopped_at: Date.now() } });
  const windowId = cfg[COLLECTOR_WINDOW_KEY];
  if (windowId) {
    try { await chrome.windows.remove(windowId); } catch {}
  }
  await setStorage({ [COLLECTOR_WINDOW_KEY]: null });
  return { ok: true };
}

async function runCollectorStep(force = false) {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  const state = cfg[COLLECTOR_STATE_KEY] || {};
  if (!state.enabled && !force) return { ok: false, reason: "collector_disabled" };
  const index = Number.isFinite(Number(state.index)) ? Number(state.index) : 0;
  const target = COLLECTOR_TARGETS[index % COLLECTOR_TARGETS.length];
  const targetUrl = markCollectorUrl(target.url);
  let windowId = cfg[COLLECTOR_WINDOW_KEY] || null;
  let tabId = null;
  if (windowId) {
    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      tabId = win?.tabs?.[0]?.id || null;
    } catch {
      windowId = null;
    }
  }
  if (!windowId || !tabId) {
    const win = await chrome.windows.create({
      url: targetUrl,
      type: "popup",
      focused: false,
      width: 360,
      height: 300,
      left: 0,
      top: 0,
    });
    windowId = win.id;
    tabId = win.tabs?.[0]?.id || null;
  } else {
    await chrome.tabs.update(tabId, { url: targetUrl, active: true });
  }
  const nextState = {
    ...state,
    enabled: true,
    index: (index + 1) % COLLECTOR_TARGETS.length,
    last_step_at: Date.now(),
    last_target_key: target.key,
    last_target_url: targetUrl,
  };
  await setStorage({ [COLLECTOR_STATE_KEY]: nextState, [COLLECTOR_WINDOW_KEY]: windowId });
  return { ok: true, target: { ...target, url: targetUrl } };
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
