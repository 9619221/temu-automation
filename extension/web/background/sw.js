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
const ALARM_ENROLL = "temu-monitor.enroll"; // 轮询云端待报名任务
const STATS_KEY = "temu_monitor_stats";
const MALLS_KEY = "temu_monitor_malls";
const COLLECTOR_STATE_KEY = "temu_monitor_collector_state";
const COLLECTOR_WINDOW_KEY = "temu_monitor_collector_window";
const COLLECTOR_QUERY = "__temu_monitor_collector=1";
const COLLECTOR_BOOT_VERSION_KEY = "temu_monitor_collector_boot_version";
const COLLECTOR_BOOT_VERSION = "20260601_return_pages";
const COLLECTOR_ALARM_MINUTES = 2;
const COLLECTOR_BATCH_SIZE = 4;
const COLLECTOR_WINDOW_WIDTH = 360;
const COLLECTOR_WINDOW_HEIGHT = 300;
const HK_CLOUD_ENDPOINT = "https://erp.temu.chat/cloud";
const ACTIVITY_LIBRARY_ENDPOINT = "/api/kiana/gamblers/marketing/enroll/list";
const ACTIVITY_LIBRARY_STATE_KEY = "temu_monitor_activity_library_state";
const ACTIVITY_LIBRARY_BATCH_SIZE = 50;
const ACTIVITY_LIBRARY_TARGET_LIMIT = 200;
const ACTIVITY_LIBRARY_MAX_BATCHES_PER_RUN = 8;
const ACTIVITY_LIBRARY_RUN_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVITY_LIBRARY_SEEN_TTL_MS = 6 * 60 * 60 * 1000;
// JIT(全托管建议关闭) + VMI(普通备货单) 主动调度：替代桌面端 worker.mjs urgentOrders Playwright 任务。
// 云端 /v1/jit-vmi-targets 给本租户近 30 天活跃 mall，SW 对每个 mall 调两个 venom 接口。
const JIT_VMI_STATE_KEY = "temu_monitor_jit_vmi_state";
const JIT_VMI_TARGET_LIMIT = 50;
const JIT_VMI_MAX_CALLS_PER_RUN = 16;
const JIT_VMI_RUN_INTERVAL_MS = 30 * 60 * 1000;
const JIT_VMI_PROBES = [
  {
    kind: "fetch-active-jit-suggest-close",
    path: "/mms/venom/api/supplier/sales/management/querySuggestCloseJitSkc",
    body: { pageNo: 1, pageSize: 100 },
  },
  {
    kind: "fetch-active-vmi-suborder",
    path: "/mms/venom/api/supplier/purchase/manager/querySubOrderList",
    body: { pageNo: 1, pageSize: 100 },
  },
];
// 流量分析主动直采：SW 对"当前登录店"直接 fetch flow/analysis/goods/list（实测不需 anti-content，
// 但 mallid 必须=当前登录店，跨店 403）。多店覆盖靠多开（每实例一店）。parser parseProductFlowGoods 自动落 temu_product_flow_snapshot。
const FLOW_STATE_KEY = "temu_monitor_flow_state";
const FLOW_RUN_INTERVAL_MS = 30 * 60 * 1000; // 每店每 30 分钟一轮（避 429）
const FLOW_PAGE_SIZE = 100;
const FLOW_MAX_PAGES = 12;
const FLOW_PAGE_DELAY_MS = 500;
const FEISHU_SUPPLIER_TABLE_URL = "https://mcn24onb5t1o.feishu.cn/base/RLy7bndc4aCXhtsx4yAcr2d8nSg?table=tbl0UhZRpR0niDSt&view=vew5Spjz7c";
const FEISHU_SUPPLIER_ONCE_KEY = "temu_monitor_feishu_supplier_once";

const COLLECTOR_TARGETS = [
  { key: "products", url: "https://agentseller.temu.com/goods/list" },
  { key: "sales", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main" },
  { key: "orders", url: "https://agentseller.temu.com/stock/fully-mgt/order-manage" },
  { key: "urgent_orders", url: "https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency" },
  { key: "stock_orders", url: "https://seller.kuajingmaihuo.com/stock/fully-mgt/order-manage" },
  { key: "shipping_desk", url: "https://seller.kuajingmaihuo.com/main/order-manager/shipping-desk" },
  { key: "shipping_list", url: "https://seller.kuajingmaihuo.com/main/order-manager/shipping-list" },
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
  chrome.alarms.create(ALARM_ENROLL, { periodInMinutes: 1 });
  await clearAlarm(ALARM_COLLECT);
  const cur = await getStorage(["device_id", COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY, COLLECTOR_BOOT_VERSION_KEY]);
  const patch = {};
  if (!cur.device_id) patch.device_id = crypto.randomUUID();
  if (!cur[COLLECTOR_STATE_KEY]) {
    patch[COLLECTOR_STATE_KEY] = {
      enabled: false,
      index: 0,
      updated_at: Date.now(),
      reason: "passive_capture_only",
    };
    patch[COLLECTOR_WINDOW_KEY] = null;
    patch[COLLECTOR_BOOT_VERSION_KEY] = COLLECTOR_BOOT_VERSION;
  } else if (cur[COLLECTOR_BOOT_VERSION_KEY] !== COLLECTOR_BOOT_VERSION) {
    patch[COLLECTOR_STATE_KEY] = {
      ...cur[COLLECTOR_STATE_KEY],
      enabled: false,
      updated_at: Date.now(),
      reason: "passive_capture_only",
    };
    patch[COLLECTOR_WINDOW_KEY] = null;
    patch[COLLECTOR_BOOT_VERSION_KEY] = COLLECTOR_BOOT_VERSION;
  }
  if (Object.keys(patch).length) await setStorage(patch);
  await tryAutoConfigure();
  if (cur[COLLECTOR_WINDOW_KEY]) {
    try { await chrome.windows.remove(cur[COLLECTOR_WINDOW_KEY]); } catch {}
  }
  await cleanupStrayCollectorTabs(null).catch((e) => console.warn("[sw] collector cleanup err", e?.message || e));
  await disableFeishuSupplierAutoImport("bootstrap").catch((e) => console.warn("[sw] feishu auto disable err", e?.message || e));
}

// Keep the extension on the HK cloud endpoint; old local/custom endpoints are replaced on startup.
async function tryAutoConfigure() {
  const cur = await getStorage(["cloud_endpoint", "auth_token"]);
  if (cur.cloud_endpoint === HK_CLOUD_ENDPOINT && cur.auth_token) return;
  const defaultEndpoint = HK_CLOUD_ENDPOINT;
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
    await clearAlarm(ALARM_COLLECT);
    await cleanupStrayCollectorTabs(null).catch((e) => console.warn("[sw] collector cleanup err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_ENROLL) {
    await pollEnrollTasks().catch((e) => console.warn("[sw] enroll poll err", e?.message || e));
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
  collectActivityLibraryFromTargets().catch((e) => console.warn("[sw] activity library collect err", e?.message || e));
  collectJitVmiFromTargets().catch((e) => console.warn("[sw] jit/vmi collect err", e?.message || e));
  collectFlowForCurrentMall().catch((e) => console.warn("[sw] flow collect err", e?.message || e));
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
      if (json.reconfig.cloud_endpoint) newCfg.cloud_endpoint = HK_CLOUD_ENDPOINT;
      if (json.reconfig.auth_token) newCfg.auth_token = json.reconfig.auth_token;
      newCfg[RECONFIG_VERSION_KEY] = json.reconfig_version;
      await setStorage(newCfg);
      console.log("[sw] cloud reconfigured to " + HK_CLOUD_ENDPOINT + " version=" + json.reconfig_version);
    }

    // 2. 处理 reload
    if (json.needs_reload && json.reload_version > (cfg[RELOAD_VERSION_KEY] || 0)) {
      await setStorage({ [RELOAD_VERSION_KEY]: json.reload_version });
      console.log("[sw] cloud requested reload, version=" + json.reload_version);
      try { chrome.runtime.reload(); } catch (e) { console.warn("[sw] reload failed", e); }
    }
    await disableFeishuSupplierAutoImport("heartbeat").catch((e) => console.warn("[sw] feishu auto disable err", e?.message || e));
  } catch {}
}

// ---------- 处理 content script 上行 ----------
function activityLibraryOriginForSite(site) {
  const value = String(site || "").toLowerCase();
  if (value.includes("agentseller-us")) return "https://agentseller-us.temu.com";
  if (value.includes("agentseller-eu")) return "https://agentseller-eu.temu.com";
  if (value.includes("kuajingmaihuo") || value === "seller") return "https://seller.kuajingmaihuo.com";
  return "https://agentseller.temu.com";
}

function normalizeActivitySkcIds(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value == null ? "" : value).trim();
    if (!/^\d{5,}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function pruneActivitySeen(seen, now) {
  const next = {};
  const source = seen && typeof seen === "object" ? seen : {};
  for (const [key, value] of Object.entries(source)) {
    const ts = Number(value || 0);
    if (ts && now - ts < ACTIVITY_LIBRARY_SEEN_TTL_MS) next[key] = ts;
  }
  return next;
}

async function collectActivityLibraryFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", ACTIVITY_LIBRARY_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[ACTIVITY_LIBRARY_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < ACTIVITY_LIBRARY_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  const seen = pruneActivitySeen(state.seen, now);
  await setStorage({
    [ACTIVITY_LIBRARY_STATE_KEY]: {
      ...state,
      seen,
      last_run_at: now,
    },
  });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/activity-targets?limit=${ACTIVITY_LIBRARY_TARGET_LIMIT}`;
  const targetResp = await fetch(targetUrl, {
    headers: { Authorization: `Bearer ${cfg.auth_token}` },
  });
  if (!targetResp.ok) return { ok: false, reason: `targets_http_${targetResp.status}` };
  const targetData = await targetResp.json().catch(() => null);
  const targets = Array.isArray(targetData?.targets) ? targetData.targets : [];
  let batchCount = 0;
  let enqueuedCount = 0;
  for (const target of targets) {
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    const ids = normalizeActivitySkcIds(target?.skc_ids || target?.skcIds);
    if (!ids.length) continue;
    const origin = activityLibraryOriginForSite(target?.site);
    const url = `${origin}${ACTIVITY_LIBRARY_ENDPOINT}`;
    for (let start = 0; start < ids.length; start += ACTIVITY_LIBRARY_BATCH_SIZE) {
      if (batchCount >= ACTIVITY_LIBRARY_MAX_BATCHES_PER_RUN) break;
      const batch = ids.slice(start, start + ACTIVITY_LIBRARY_BATCH_SIZE);
      const seenKey = `${origin}|${mallId}|${batch.join(",")}`;
      if (seen[seenKey] && now - Number(seen[seenKey]) < ACTIVITY_LIBRARY_SEEN_TTL_MS) continue;
      const requestBody = JSON.stringify({
        pageNo: 1,
        pageSize: 50,
        productSkcIds: batch,
        sessionStatusTag: 4,
      });
      batchCount++;
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            mallid: mallId,
          },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object") {
          await enqueue({
            kind: "fetch-active-activity-library",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: target?.site || "agentseller",
            page: "background/activity-library",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "marketing_enroll_list_background",
            activeSkcCount: batch.length,
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        }
        seen[seenKey] = Date.now();
      } catch {
        delete seen[seenKey];
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (batchCount >= ACTIVITY_LIBRARY_MAX_BATCHES_PER_RUN) break;
  }
  await setStorage({
    [ACTIVITY_LIBRARY_STATE_KEY]: {
      ...state,
      seen: pruneActivitySeen(seen, Date.now()),
      last_run_at: now,
      last_success_at: Date.now(),
      last_batch_count: batchCount,
      last_enqueued_count: enqueuedCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, batchCount, enqueuedCount };
}

// ---------- 流量分析主动直采（采当前登录店，铺开 temu_product_flow_snapshot） ----------
// 用 scripting 在 agentseller 标签页取当前 mallid（manifest 无 cookies 权限，借 scripting）
async function getCurrentAgentSellerMall() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://agentseller.temu.com/*", "https://agentseller-us.temu.com/*", "https://agentseller-eu.temu.com/*"],
    });
    if (!tabs.length) return null;
    const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.cookie.match(/mallid=([^;]+)/i)?.[1] || ""),
    });
    const mallId = String(res?.result || "").trim();
    if (!mallId) return null;
    let origin = "https://agentseller.temu.com";
    try { origin = new URL(tab.url).origin; } catch {}
    return { mallId, origin };
  } catch {
    return null;
  }
}

// 轮询云端待报名任务,按当前店分发到登录态 agentseller tab(page world 发 submit),结果回传云端
async function pollEnrollTasks() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token"]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return;
  const cur = await getCurrentAgentSellerMall();
  if (!cur) return; // 没有登录态 agentseller tab,跳过
  const base = cfg.cloud_endpoint.replace(/\/$/, "");
  let tasks = [];
  try {
    const resp = await fetch(`${base}/api/ingest/v1/enroll-tasks?mall_id=${encodeURIComponent(cur.mallId)}`, {
      headers: { Authorization: `Bearer ${cfg.auth_token}` },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  } catch { return; }
  if (!tasks.length) return;
  const tabs = await chrome.tabs.query({
    url: ["https://agentseller.temu.com/*", "https://agentseller-us.temu.com/*", "https://agentseller-eu.temu.com/*"],
  });
  const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) return;
  for (const task of tasks) {
    const body = {
      activityType: task.activity_type,
      activityThematicId: Number(task.activity_thematic_id),
      productList: task.product_list,
    };
    const result = await new Promise((resolve) => {
      let done = false;
      try {
        chrome.tabs.sendMessage(tab.id, { type: "ENROLL_SUBMIT", task: { body } }, (resp) => {
          if (done) return; done = true;
          if (chrome.runtime.lastError) { resolve({ ok: false, error: String(chrome.runtime.lastError.message || "") }); return; }
          resolve(resp || { ok: false, error: "no_resp" });
        });
      } catch (e) { resolve({ ok: false, error: String(e?.message || e) }); }
      setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: "sw_dispatch_timeout" }); } }, 35000);
    });
    try {
      await fetch(`${base}/api/ingest/v1/enroll-tasks/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.auth_token}` },
        body: JSON.stringify({ task_id: task.task_id, status: result.ok ? "done" : "failed", result }),
      });
    } catch { /* 下轮重试由云端 status 控制 */ }
  }
}

async function collectFlowForCurrentMall() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", FLOW_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[FLOW_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < FLOW_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  const cur = await getCurrentAgentSellerMall();
  if (!cur) return { ok: false, reason: "no_agentseller_tab_or_mallid" };
  await setStorage({ [FLOW_STATE_KEY]: { ...state, last_run_at: now } });

  const url = `${cur.origin}/api/seller/full/flow/analysis/goods/list`;
  let enqueuedCount = 0;
  for (let page = 1; page <= FLOW_MAX_PAGES; page++) {
    const requestBody = JSON.stringify({ pageNum: page, pageSize: FLOW_PAGE_SIZE, dayDimension: 1 });
    try {
      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", mallid: cur.mallId },
        body: requestBody,
      });
      const text = await resp.text();
      const body = safeParseJson(text);
      if (!resp.ok || !body || typeof body !== "object") break;
      await enqueue({
        kind: "fetch-active-flow",
        url,
        method: "POST",
        status: resp.status,
        ts: Date.now(),
        site: "agentseller",
        page: "background/flow-analysis",
        mall_id: cur.mallId,
        body,
        bodyText: text.length > 200000 ? null : text,
        requestBodyText: requestBody,
        bodySize: text.length,
        activeSource: "flow_analysis_background",
      });
      await bumpStats({ captured_count_delta: 1 });
      enqueuedCount++;
      const list = body?.result?.list || body?.result?.pageItems || [];
      if (!Array.isArray(list) || list.length < FLOW_PAGE_SIZE) break; // 末页
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, FLOW_PAGE_DELAY_MS));
  }
  await setStorage({
    [FLOW_STATE_KEY]: { ...state, last_run_at: now, last_success_at: Date.now(), last_enqueued: enqueuedCount, last_mall: cur.mallId },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, enqueuedCount, mall: cur.mallId };
}

// ---------- JIT/VMI 主动调度（替代桌面端 urgentOrders Playwright 任务） ----------
async function collectJitVmiFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", JIT_VMI_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[JIT_VMI_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < JIT_VMI_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({
    [JIT_VMI_STATE_KEY]: {
      ...state,
      last_run_at: now,
    },
  });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/jit-vmi-targets?limit=${JIT_VMI_TARGET_LIMIT}`;
  let targets = [];
  try {
    const resp = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${cfg.auth_token}` },
    });
    if (!resp.ok) return { ok: false, reason: `targets_http_${resp.status}` };
    const data = await resp.json().catch(() => null);
    targets = Array.isArray(data?.targets) ? data.targets : [];
  } catch (error) {
    return { ok: false, reason: `targets_err_${String(error?.message || error).slice(0, 40)}` };
  }

  let callCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;
  for (const target of targets) {
    if (callCount >= JIT_VMI_MAX_CALLS_PER_RUN) break;
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    const origin = activityLibraryOriginForSite(target?.site);
    for (const probe of JIT_VMI_PROBES) {
      if (callCount >= JIT_VMI_MAX_CALLS_PER_RUN) break;
      callCount++;
      const url = `${origin}${probe.path}`;
      const requestBody = JSON.stringify(probe.body);
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            mallid: mallId,
          },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object") {
          await enqueue({
            kind: probe.kind,
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: target?.site || "agentseller",
            page: "background/jit-vmi",
            mall_id: mallId,
            mall_name: target?.mall_name || null,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "jit_vmi_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  await setStorage({
    [JIT_VMI_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
      last_target_count: targets.length,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, targetCount: targets.length };
}

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
  await tryAutoConfigure();
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

async function runFeishuSupplierImportOnce(reason = "auto") {
  const cfg = await getStorage([FEISHU_SUPPLIER_ONCE_KEY]);
  const state = cfg[FEISHU_SUPPLIER_ONCE_KEY] || {};
  const now = Date.now();
  if (state.done) return { ok: true, skipped: "done", rows: state.rows || 0 };
  if (state.runningAt && now - Number(state.runningAt) < 180000) {
    return { ok: true, skipped: "running" };
  }
  await setStorage({
    [FEISHU_SUPPLIER_ONCE_KEY]: {
      ...state,
      runningAt: now,
      reason,
      attempts: Number(state.attempts || 0) + 1,
      updatedAt: now,
    },
  });
  try {
    await tryAutoConfigure();
    const tab = await openFeishuSupplierTabForCapture();
    await waitForTabComplete(tab.id, 90000);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await sendMessageToTab(tab.id, {
      type: "COLLECT_FEISHU_SUPPLIERS",
      mode: "api",
      maxSteps: 160,
      delayMs: 250,
    });
    await flush();
    const rows = Number(response?.rows || 0);
    const ok = Boolean(response?.ok && rows > 0);
    await setStorage({
      [FEISHU_SUPPLIER_ONCE_KEY]: {
        done: ok,
        runningAt: 0,
        rows,
        reason,
        error: ok ? null : (response?.reason || "no_rows"),
        updatedAt: Date.now(),
      },
    });
    return { ok, rows, reason: response?.reason || null };
  } catch (error) {
    await setStorage({
      [FEISHU_SUPPLIER_ONCE_KEY]: {
        ...state,
        done: false,
        runningAt: 0,
        error: String(error?.message || error).slice(0, 200),
        updatedAt: Date.now(),
      },
    });
    throw error;
  }
}

async function disableFeishuSupplierAutoImport(reason = "auto_disabled") {
  const cfg = await getStorage([FEISHU_SUPPLIER_ONCE_KEY]);
  const state = cfg[FEISHU_SUPPLIER_ONCE_KEY] || {};
  if (state.auto_disabled) {
    return { ok: true, skipped: "auto_disabled" };
  }
  await setStorage({
    [FEISHU_SUPPLIER_ONCE_KEY]: {
      ...state,
      runningAt: 0,
      auto_disabled: true,
      reason,
      updatedAt: Date.now(),
    },
  });
  return { ok: true, disabled: true };
}

async function openFeishuSupplierTabForCapture() {
  const tabs = await chrome.tabs.query({ url: ["https://*.feishu.cn/base/*"] });
  const matched = tabs.find((tab) => tab?.url && tab.url.includes("/base/RLy7bndc4aCXhtsx4yAcr2d8nSg"));
  if (matched?.id) {
    await chrome.tabs.update(matched.id, { url: FEISHU_SUPPLIER_TABLE_URL, active: false });
    return matched;
  }
  return chrome.tabs.create({ url: FEISHU_SUPPLIER_TABLE_URL, active: false });
}

function waitForTabComplete(tabId, timeoutMs = 60000) {
  return new Promise((resolve) => {
    if (!tabId) return resolve(false);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(false);
    }, timeoutMs);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(true);
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === "complete") finish();
    });
  });
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
  await clearAlarm(ALARM_COLLECT);
  await cleanupStrayCollectorTabs(null).catch(() => {});
  await setStorage({
    [COLLECTOR_STATE_KEY]: {
      enabled: false,
      index: 0,
      last_started_at: now,
      last_step_at: 0,
      last_target_key: "",
      last_target_url: "",
      last_targets: [],
      updated_at: now,
      reason: "passive_capture_only",
    },
    [COLLECTOR_WINDOW_KEY]: null,
  });
  sendHeartbeat().catch((e) => console.warn("[sw] collector passive heartbeat err", e?.message || e));
  return { ok: false, reason: "后台自动开页采集已关闭，仅在已打开的 Temu 页面被动采集" };
}

async function stopCollector() {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  const now = Date.now();
  await clearAlarm(ALARM_COLLECT);
  await setStorage({ [COLLECTOR_STATE_KEY]: { ...(cfg[COLLECTOR_STATE_KEY] || {}), enabled: false, stopped_at: now, updated_at: now } });
  const windowId = cfg[COLLECTOR_WINDOW_KEY];
  if (windowId) {
    try { await chrome.windows.remove(windowId); } catch {}
  }
  await setStorage({ [COLLECTOR_WINDOW_KEY]: null });
  await cleanupStrayCollectorTabs(null).catch(() => {});
  sendHeartbeat().catch((e) => console.warn("[sw] collector stop heartbeat err", e?.message || e));
  return { ok: true };
}

async function runCollectorStep(force = false) {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  if (cfg[COLLECTOR_WINDOW_KEY]) {
    try { await chrome.windows.remove(cfg[COLLECTOR_WINDOW_KEY]); } catch {}
  }
  await clearAlarm(ALARM_COLLECT);
  await cleanupStrayCollectorTabs(null).catch(() => {});
  await setStorage({
    [COLLECTOR_STATE_KEY]: {
      ...(cfg[COLLECTOR_STATE_KEY] || {}),
      enabled: false,
      updated_at: Date.now(),
      reason: "passive_capture_only",
    },
    [COLLECTOR_WINDOW_KEY]: null,
  });
  return { ok: false, reason: "passive_capture_only" };
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

function isCollectorTaggedUrl(url) {
  try {
    return new URL(String(url || "")).searchParams.get(COLLECTOR_QUERY.split("=")[0]) === COLLECTOR_QUERY.split("=")[1];
  } catch {
    return String(url || "").includes(COLLECTOR_QUERY);
  }
}

function isManagedCollectorWindow(win) {
  if (!win || win.type !== "popup") return false;
  const tabs = Array.isArray(win.tabs) ? win.tabs : [];
  return tabs.some((tab) => isCollectorTaggedUrl(tab?.url));
}

async function cleanupStrayCollectorTabs(collectorWindowId) {
  const allTabs = await chrome.tabs.query({
    url: [
      "https://agentseller.temu.com/*",
      "https://agentseller-us.temu.com/*",
      "https://agentseller-eu.temu.com/*",
      "https://seller.kuajingmaihuo.com/*",
    ],
  });
  const strayTabs = (Array.isArray(allTabs) ? allTabs : [])
    .filter((tab) => tab?.id && tab.windowId !== collectorWindowId && isCollectorTaggedUrl(tab.url));
  for (const tab of strayTabs) {
    try { await chrome.tabs.remove(tab.id); } catch {}
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

// ---------- 工具：storage / 累计统计 ----------
function clearAlarm(name) {
  return new Promise((resolve) => {
    try {
      chrome.alarms.clear(name, () => {
        void chrome.runtime.lastError;
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

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
