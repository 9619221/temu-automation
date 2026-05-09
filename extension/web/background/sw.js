// ============================================================
// Service Worker 入口
// ============================================================
// MV3 SW 会被 Chrome 回收，所有持久状态走 chrome.storage.local 或 IndexedDB
// 周期任务用 chrome.alarms（setInterval 不可靠）
// ============================================================

import { URL_WHITELIST, URL_BLACKLIST, EVENT_NAME, BYPASS_SYMBOL_KEY } from "./hook-config.js";
import { enqueue, queueDepth, flush } from "./ingest-queue.js";

const ALARM_FLUSH = "temu-monitor.flush";
const STATS_KEY = "temu_monitor_stats";

// ---------- 启动期初始化 ----------
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 0.5 }); // 30s
  const { device_id } = await getStorage(["device_id"]);
  if (!device_id) {
    await setStorage({ device_id: crypto.randomUUID() });
  }
  await tryAutoConfigure();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 0.5 });
  await tryAutoConfigure();
});

// 装好扩展自动连本地 cloud（dev 默认 localhost:8788 + admin/changeme123）
// 仅当 storage 还没配置时尝试；失败静默（生产部署改密码 / 改 endpoint 后用户在 options 页手动填）
async function tryAutoConfigure() {
  const cur = await getStorage(["cloud_endpoint", "auth_token"]);
  if (cur.cloud_endpoint && cur.auth_token) return;
  const defaultEndpoint = "http://localhost:8788";
  try {
    const resp = await fetch(defaultEndpoint + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "changeme123" }),
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
    Promise.all([queueDepth(), getStorage([STATS_KEY, "cloud_endpoint", "auth_token"])])
      .then(([depth, cfg]) => {
        sendResponse({
          queueDepth: depth,
          stats: cfg[STATS_KEY] || {},
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
});

async function handleCaptured(payload, sender) {
  // 注入店铺/账号上下文：从发送 tab 推断（mall_id 等需要从 cookie 或 userInfo 响应里拿，
  // M1 简单做：把 sender.tab.id / 域名 / 路径附上，云端再做归属推断）
  const enriched = {
    ...payload,
    tab_id: sender?.tab?.id,
    tab_url: sender?.tab?.url,
    captured_at: Date.now(),
  };
  await enqueue(enriched);
  await bumpStats({ captured_count_delta: 1 });
}

// ---------- 工具：storage / 累计统计 ----------
function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v || {})));
}
function setStorage(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
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
