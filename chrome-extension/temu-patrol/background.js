const BRIDGE_BASE = "http://127.0.0.1:18731";
const BRIDGE_HEADER = "temu-patrol-v1";
const FLUSH_INTERVAL_MS = 10000;
const MAX_EVENTS_PER_STORE = 80;
const MAX_EVENT_RESPONSE_CHARS = 120000;
const MAX_TEMPLATE_BODY_CHARS = 20000;
const MAX_LEARNED_TEMPLATES = 120;
const BACKGROUND_REQUEST_DELAY_MS = 800;
const DAILY_COLLECTION_HOUR = 9;
const DAILY_COLLECTION_MINUTE = 0;
const TEMPLATE_STORAGE_KEY = "temuPatrolApiTemplates";
const BACKGROUND_STATUS_KEY = "temuPatrolBackgroundStatus";
const DAILY_COLLECTION_ALARM = "temu-patrol-daily-collection";
const PATROL_PAGE_DWELL_MS = 12000;
const PATROL_NAV_TIMEOUT_MS = 45000;
const DEFAULT_SELLER_BASE_URL = "https://agentseller.temu.com";

try {
  importScripts("api-dictionary.js");
} catch {}

const buffers = new Map();
const stores = new Map();
let flushTimer = null;
let backgroundCollectionRunning = false;

const STORE_ID_KEYS = ["id", "storeId", "mallId", "shopId", "merchantId"];
const LEARNABLE_CATEGORIES = new Set(["商品资料", "销量", "退货", "快递取消", "补货", "活动", "违规", "流量"]);
const SENSITIVE_HEADER_PATTERN = /^(?:cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token)$/i;
const PATROL_PAGES = [
  { key: "dashboard", label: "首页概览", path: "/" },
  { key: "products", label: "商品资料", path: "/goods/list" },
  { key: "goodsData", label: "商品数据", path: "/newon/goods-data" },
  { key: "sales", label: "销量履约", path: "/stock/fully-mgt/sale-manage/main" },
  { key: "soldout", label: "售罄补货", path: "/stock/fully-mgt/sale-manage/board/sku-sale-out" },
  { key: "urgentOrders", label: "紧急备货", path: "/stock/fully-mgt/order-manage-urgency" },
  { key: "returns", label: "退货售后", path: "/main/aftersales/information" },
  { key: "activity", label: "活动数据", path: "/main/act/data-full" },
  { key: "marketing", label: "营销活动", path: "/activity/marketing-activity" },
  { key: "traffic", label: "流量分析", path: "/main/flux-analysis-full" },
  { key: "checkup", label: "体检中心", path: "/goods/checkup-center" },
  { key: "quality", label: "质量看板", path: "/main/quality/dashboard" },
];

function nowIso() {
  return new Date().toISOString();
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeStoreNameText(value) {
  return normalizeText(value)
    .replace(/[>›].*$/, "")
    .replace(/\s*(?:\u5207\u6362\u5e97\u94fa|\u5e97\u94fa\u5207\u6362|\u5207\u6362)\s*$/u, "")
    .replace(/\s*(?:Switch Store|Switch)\s*$/i, "")
    .trim();
}

const NON_STORE_NAME_PATTERNS = [
  /^(?:\u5fd8\u8bb0\u5bc6\u7801|\u627e\u56de\u5bc6\u7801|\u767b\u5f55|\u767b\u9304|\u6ce8\u518c|\u9a8c\u8bc1\u7801|Forgot Password|Reset Password|Login|Log In|Sign In|Register|Verification Code)$/i,
  /^(?:\u521b\u5efa\u65b0\u5e97\u94fa.*|\u5408\u89c4\u767b\u8bb0(?:\u53ca)?\u9a8c\u8bc1.*|0\u5143\u5f00\u5e97|\u514d\u8d39\u5f00\u5e97|\u6211\u8981\u5f00\u5e97|\u7acb\u5373\u5f00\u5e97|\u53bb\u5f00\u5e97)$/u,
  /^(?:\u9690\u79c1\u653f\u7b56|\u9690\u79c1\u6761\u6b3e|\u7528\u6237\u534f\u8bae|\u670d\u52a1\u6761\u6b3e|\u6cd5\u5f8b\u58f0\u660e|\u5173\u4e8e\u6211\u4eec|\u8054\u7cfb\u6211\u4eec)$/u,
  /^(0元开店|免费开店|我要开店|立即开店|去开店|未识别店铺|采集快照)$/i,
  /(开店|入驻|注册|登录|退出|刷新|通知|日志|设置|账号|业务|数据|管理|全部|搜索|验证码)/i,
  /(店铺控制台|采集|巡店|帮助|教程|下载|升级|活动报名)/i,
  /(隐私政策|隐私条款|用户协议|服务条款|法律声明|Privacy Policy|Cookie Policy|Terms of Use|Terms & Conditions|Legal Notice|About Us|Contact Us)/i,
];

function isLikelyStoreName(value) {
  const text = normalizeStoreNameText(value);
  if (text.length < 3 || text.length > 80) return false;
  if (/^temu_ext_[a-f0-9]+$/i.test(text)) return false;
  if (/^acct[_:-]/i.test(text)) return false;
  if (/^\+?\d[\d\s*()-]{3,}$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return false;
  if (NON_STORE_NAME_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return true;
}

function normalizeStore(store = {}) {
  const rawName = normalizeStoreNameText(store.name || store.storeName || store.mallName || store.shopName || "");
  const name = isLikelyStoreName(rawName) ? rawName : "";
  const id = normalizeText(store.id || store.storeId || store.mallId || store.shopId || store.merchantId || "");
  if (!name) {
    return {
      id,
      name: "",
      accountId: "",
      source: store.source || "unknown",
      confidence: Number(store.confidence) || 0,
      url: store.url || "",
      detectedAt: store.detectedAt || nowIso(),
    };
  }
  const key = id || name;
  return {
    id,
    name,
    accountId: `temu_ext_${stableHash(key)}`,
    source: store.source || "unknown",
    confidence: Number(store.confidence) || 0,
    url: store.url || "",
    detectedAt: store.detectedAt || nowIso(),
  };
}

function storeKey(store = {}) {
  const normalized = normalizeStore(store);
  return normalized.accountId;
}

function categoryFromUrl(url) {
  const dictionaryEntry = typeof findTemuApiDictionaryEntry === "function"
    ? findTemuApiDictionaryEntry(url)
    : null;
  if (dictionaryEntry?.category) return dictionaryEntry.category;
  const text = String(url || "").toLowerCase();
  if (/product|goods|skc|spu|sku|listing|manage/.test(text)) return "商品资料";
  if (/sale|sales|performance|traffic|flow|analytics|analysis|metric/.test(text)) return "销量";
  if (/refund|return|after.?sale|salesreturn|returnorder|reverse/.test(text)) return "退货";
  if (/cancel|delivery|shipping|ship|fulfill|urgent|logistic|express/.test(text)) return "快递取消";
  if (/stock|inventory|soldout|replenish|warehouse|sku/.test(text)) return "补货";
  if (/activity|marketing|campaign|promotion|coupon|ads?/.test(text)) return "活动";
  if (/govern|violation|compliance|quality|penalty|checkup|qc|appeal|qualification/.test(text)) return "违规";
  return "接口响应";
}

function dataKeyFromEvent(event = {}) {
  const category = categoryFromUrl(event.url);
  const dictionaryEntry = typeof findTemuApiDictionaryEntry === "function"
    ? findTemuApiDictionaryEntry(event.url)
    : null;
  let pathKey = "unknown";
  try {
    const parsed = new URL(String(event.url || ""));
    pathKey = parsed.pathname
      .replace(/\/+/g, "/")
      .replace(/[^a-zA-Z0-9/_-]/g, "")
      .split("/")
      .filter(Boolean)
      .slice(-3)
      .join("_") || parsed.hostname.replace(/[^a-zA-Z0-9_-]/g, "_");
  } catch {}
  const prefixByCategory = {
    "商品资料": "temu_ext_product",
    "销量": "temu_ext_sales",
    "退货": "temu_ext_return",
    "快递取消": "temu_ext_delivery",
    "补货": "temu_ext_stock",
    "活动": "temu_ext_activity",
    "违规": "temu_ext_violation",
    "流量": "temu_ext_flow",
    "资金": "temu_ext_fund",
    "类目": "temu_ext_category",
    "接口响应": "temu_ext_api",
  };
  const prefix = dictionaryEntry?.dataKeyPrefix || prefixByCategory[category] || "temu_ext_api";
  return `${prefix}_${pathKey}`.slice(0, 160);
}

function compactResponse(value) {
  if (value === null || value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= MAX_EVENT_RESPONSE_CHARS) return value;
    return {
      clipped: true,
      preview: text.slice(0, MAX_EVENT_RESPONSE_CHARS),
    };
  } catch {
    return String(value).slice(0, MAX_EVENT_RESPONSE_CHARS);
  }
}

function normalizeEvent(event = {}) {
  if (!event.url) return null;
  const category = categoryFromUrl(event.url);
  const dictionaryEntry = typeof findTemuApiDictionaryEntry === "function"
    ? findTemuApiDictionaryEntry(event.url)
    : null;
  return {
    dataKey: dataKeyFromEvent(event),
    category,
    apiDictionaryId: dictionaryEntry?.id || "",
    apiDictionaryLabel: dictionaryEntry?.label || "",
    apiCaptureMode: dictionaryEntry?.captureMode || "",
    transport: event.transport || "unknown",
    url: String(event.url || ""),
    method: String(event.method || "GET").toUpperCase(),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : null,
    ok: event.ok === undefined ? null : Boolean(event.ok),
    elapsedMs: Number.isFinite(Number(event.elapsedMs)) ? Number(event.elapsedMs) : null,
    contentType: event.contentType || "",
    response: compactResponse(event.response),
    responsePreview: String(event.responsePreview || "").slice(0, 20000),
    capturedAt: event.capturedAt || nowIso(),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeaderName(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeRequestHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = normalizeHeaderName(key);
    if (!name || SENSITIVE_HEADER_PATTERN.test(name)) continue;
    if (/^(?:host|origin|referer|content-length|accept-encoding|connection)$/i.test(name)) continue;
    const text = String(value || "");
    if (!text || text.length > 1000) continue;
    result[name] = text;
  }
  return result;
}

function normalizeRequestBody(value) {
  const text = String(value || "");
  if (!text || text.length > MAX_TEMPLATE_BODY_CHARS) return "";
  return text;
}

function templateKeyFor(event = {}) {
  const method = String(event.method || "GET").toUpperCase();
  const bodyHash = stableHash(normalizeRequestBody(event.requestBody || ""));
  let urlKey = String(event.url || "");
  try {
    const parsed = new URL(urlKey);
    parsed.searchParams.sort?.();
    urlKey = parsed.href;
  } catch {}
  return `${method}:${urlKey}:${bodyHash}`;
}

function templateFromEvent(store, event = {}) {
  const normalizedStore = normalizeStore(store || {});
  const normalizedEvent = normalizeEvent(event);
  if (!normalizedStore.name || !normalizedEvent) return null;
  if (!LEARNABLE_CATEGORIES.has(normalizedEvent.category)) return null;
  if (normalizedEvent.apiCaptureMode === "observe-only" || normalizedEvent.apiCaptureMode === "capture-only") return null;
  if (!/^https:\/\/(?:agentseller(?:-[a-z]+)?\.temu\.com|seller\.kuajingmaihuo\.com)\//i.test(normalizedEvent.url)) return null;
  const method = String(normalizedEvent.method || "GET").toUpperCase();
  if (!/^(GET|POST)$/i.test(method)) return null;
  return {
    key: templateKeyFor(event),
    accountId: normalizedStore.accountId,
    store: normalizedStore,
    dataKey: normalizedEvent.dataKey,
    category: normalizedEvent.category,
    url: normalizedEvent.url,
    method,
    body: normalizeRequestBody(event.requestBody || ""),
    headers: sanitizeRequestHeaders(event.requestHeaders || {}),
    learnedAt: nowIso(),
    lastCapturedAt: normalizedEvent.capturedAt || nowIso(),
    successCount: 0,
    failCount: 0,
  };
}

async function getStoredTemplates() {
  const stored = await chrome.storage.local.get(TEMPLATE_STORAGE_KEY).catch(() => ({}));
  const templates = stored?.[TEMPLATE_STORAGE_KEY];
  return Array.isArray(templates) ? templates.filter((item) => item && item.key && item.url) : [];
}

async function saveStoredTemplates(templates) {
  await chrome.storage.local.set({
    [TEMPLATE_STORAGE_KEY]: templates.slice(-MAX_LEARNED_TEMPLATES),
  });
}

async function learnTemplateFromEvent(store, event) {
  const template = templateFromEvent(store, event);
  if (!template) return;
  const templates = await getStoredTemplates();
  const existingIndex = templates.findIndex((item) => item.key === template.key);
  if (existingIndex >= 0) {
    templates[existingIndex] = {
      ...templates[existingIndex],
      ...template,
      learnedAt: templates[existingIndex].learnedAt || template.learnedAt,
      lastCapturedAt: template.lastCapturedAt,
      successCount: Number(templates[existingIndex].successCount || 0),
      failCount: Number(templates[existingIndex].failCount || 0),
    };
  } else {
    templates.push(template);
  }
  await saveStoredTemplates(templates);
}

function headersForTemplate(template) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    ...sanitizeRequestHeaders(template.headers || {}),
  };
  if (template.method !== "GET" && template.body && !headers["content-type"]) {
    headers["content-type"] = "application/json;charset=UTF-8";
  }
  return headers;
}

async function readBackgroundResponse(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (!/json|text|javascript|x-www-form-urlencoded/i.test(contentType)) {
    return {
      contentType,
      response: null,
      responsePreview: `[skipped ${contentType || "binary"}]`,
    };
  }
  const text = await response.text();
  const clipped = text.length > MAX_EVENT_RESPONSE_CHARS;
  const bodyText = clipped ? text.slice(0, MAX_EVENT_RESPONSE_CHARS) : text;
  if (/json/i.test(contentType)) {
    try {
      return {
        contentType,
        response: JSON.parse(bodyText),
        responsePreview: clipped ? bodyText.slice(0, 2000) : "",
        clipped,
      };
    } catch {}
  }
  return {
    contentType,
    response: null,
    responsePreview: bodyText,
    clipped,
  };
}

async function runTemplateRequest(template) {
  const startedAt = Date.now();
  const init = {
    method: template.method || "GET",
    credentials: "include",
    headers: headersForTemplate(template),
    cache: "no-store",
  };
  if (init.method !== "GET" && template.body) init.body = template.body;
  const response = await fetch(template.url, init);
  const body = await readBackgroundResponse(response.clone());
  return {
    transport: "background-fetch",
    url: template.url,
    method: init.method,
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - startedAt,
    ...body,
    capturedAt: nowIso(),
  };
}

async function setBackgroundStatus(patch) {
  const previous = await chrome.storage.local.get(BACKGROUND_STATUS_KEY).catch(() => ({}));
  await chrome.storage.local.set({
    [BACKGROUND_STATUS_KEY]: {
      ...(previous?.[BACKGROUND_STATUS_KEY] || {}),
      ...patch,
      updatedAt: nowIso(),
    },
  });
}

async function collectInBackground(reason = "manual", options = {}) {
  const ownsLock = !options.skipLock;
  if (ownsLock && backgroundCollectionRunning) {
    return { ok: false, skipped: true, reason: "running" };
  }
  if (ownsLock) backgroundCollectionRunning = true;
  const startedAt = nowIso();
  const templates = await getStoredTemplates();
  let successCount = 0;
  let failCount = 0;
  const failures = [];
  await setBackgroundStatus({
    running: true,
    reason,
    startedAt,
    templateCount: templates.length,
    successCount: 0,
    failCount: 0,
    failures: [],
  });
  try {
    for (const template of templates) {
      try {
        const event = await runTemplateRequest(template);
        handleApiEvent(template.store || {}, event);
        if (event.ok) successCount += 1;
        else {
          failCount += 1;
          failures.push({ url: template.url, status: event.status, category: template.category });
        }
        await delay(BACKGROUND_REQUEST_DELAY_MS);
      } catch (error) {
        failCount += 1;
        failures.push({
          url: template.url,
          category: template.category,
          error: error?.message || String(error),
        });
      }
      await setBackgroundStatus({
        running: true,
        reason,
        startedAt,
        templateCount: templates.length,
        successCount,
        failCount,
        failures: failures.slice(-10),
      });
    }
    await flushAll();
    await setBackgroundStatus({
      running: false,
      reason,
      startedAt,
      finishedAt: nowIso(),
      templateCount: templates.length,
      successCount,
      failCount,
      failures: failures.slice(-10),
    });
    return { ok: true, templateCount: templates.length, successCount, failCount };
  } finally {
    if (ownsLock) backgroundCollectionRunning = false;
  }
}

function nextDailyCollectionDelayMinutes(now = new Date()) {
  const next = new Date(now);
  next.setHours(DAILY_COLLECTION_HOUR, DAILY_COLLECTION_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60000));
}

function scheduleDailyCollectionAlarm() {
  chrome.alarms.create(DAILY_COLLECTION_ALARM, {
    delayInMinutes: nextDailyCollectionDelayMinutes(),
    periodInMinutes: 24 * 60,
  });
}

function isTemuSellerPageUrl(url) {
  return /^https:\/\/(?:agentseller(?:-[a-z]+)?\.temu\.com|seller\.kuajingmaihuo\.com)\//i.test(String(url || ""));
}

function sellerBaseFromUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (isTemuSellerPageUrl(parsed.href)) return `${parsed.protocol}//${parsed.hostname}`;
  } catch {}
  return DEFAULT_SELLER_BASE_URL;
}

async function getPreferredSellerBaseUrl() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const current = tabs.find((tab) => isTemuSellerPageUrl(tab.url));
  return sellerBaseFromUrl(current?.url);
}

function patrolUrl(baseUrl, page) {
  if (/^https?:\/\//i.test(page.path)) return page.path;
  return `${baseUrl}${page.path || "/"}`;
}

async function waitForTabLoad(tabId, timeoutMs = PATROL_NAV_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openOrReusePatrolTab(url) {
  const stored = await chrome.storage.local.get("temuPatrolTabId").catch(() => ({}));
  const storedTabId = Number(stored?.temuPatrolTabId || 0);
  if (storedTabId) {
    const existing = await chrome.tabs.get(storedTabId).catch(() => null);
    if (existing) {
      await chrome.tabs.update(storedTabId, { url, active: false }).catch(() => null);
      return storedTabId;
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await chrome.storage.local.set({ temuPatrolTabId: tab.id });
  return tab.id;
}

async function runPagePatrol(reason = "manual") {
  const baseUrl = await getPreferredSellerBaseUrl();
  const startedAt = nowIso();
  let tabId = null;
  await setBackgroundStatus({
    running: true,
    mode: "page-patrol",
    reason,
    startedAt,
    pageCount: PATROL_PAGES.length,
    currentPage: "",
  });

  for (let index = 0; index < PATROL_PAGES.length; index += 1) {
    const page = PATROL_PAGES[index];
    const url = patrolUrl(baseUrl, page);
    await setBackgroundStatus({
      running: true,
      mode: "page-patrol",
      reason,
      startedAt,
      pageCount: PATROL_PAGES.length,
      currentPage: page.label,
      currentUrl: url,
      pageIndex: index + 1,
    });
    tabId = await openOrReusePatrolTab(url);
    await waitForTabLoad(tabId);
    await delay(PATROL_PAGE_DWELL_MS);
  }

  await flushAll();
  await setBackgroundStatus({
    running: false,
    mode: "page-patrol",
    reason,
    startedAt,
    finishedAt: nowIso(),
    pageCount: PATROL_PAGES.length,
    currentPage: "",
  });
  return { ok: true, mode: "page-patrol", pageCount: PATROL_PAGES.length, tabId };
}

async function runExtensionCollection(reason = "manual") {
  if (backgroundCollectionRunning) {
    return { ok: false, skipped: true, reason: "running" };
  }
  backgroundCollectionRunning = true;
  try {
    const patrolResult = await runPagePatrol(reason);
    const templateResult = await collectInBackground(`${reason}:template-replay`, { skipLock: true }).catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }));
    return {
      ok: patrolResult.ok !== false,
      patrol: patrolResult,
      templateReplay: templateResult,
    };
  } finally {
    backgroundCollectionRunning = false;
  }
}

function groupSources(events = []) {
  const groups = new Map();
  for (const event of events) {
    const key = event.dataKey;
    if (!groups.has(key)) {
      groups.set(key, {
        dataKey: key,
        taskKey: key,
        label: event.category,
        category: event.category,
        events: [],
      });
    }
    groups.get(key).events.push(event);
  }
  return Array.from(groups.values()).map((group) => ({
    dataKey: group.dataKey,
    taskKey: group.taskKey,
    label: group.label,
    category: group.category,
    recordCount: group.events.length,
    payload: {
      source: "temu-chrome-extension",
      category: group.category,
      events: group.events,
    },
  }));
}

function categoryCounts(events = []) {
  return events.reduce((acc, event) => {
    acc[event.category] = (acc[event.category] || 0) + 1;
    return acc;
  }, {});
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAll().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

async function postBridge(path, payload) {
  const response = await fetch(`${BRIDGE_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Temu-Extension-Bridge": BRIDGE_HEADER,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `ERP bridge returned ${response.status}`);
  }
  return result;
}

async function flushStore(key) {
  const events = buffers.get(key) || [];
  if (!events.length) return null;
  const store = stores.get(key) || normalizeStore({});
  if (!store.name) return null;
  const batch = events.splice(0, events.length);
  const collectedAt = batch.map((event) => event.capturedAt).sort().pop() || nowIso();
  const sources = groupSources(batch);
  try {
    const result = await postBridge("/api/temu-extension/store-collection/snapshot", {
      extensionVersion: chrome.runtime.getManifest().version,
      accountId: store.accountId,
      storeName: store.name,
      store,
      collectedAt,
      clientSnapshotId: `${store.accountId}:${collectedAt}:ext:${stableHash(JSON.stringify(categoryCounts(batch)))}`,
      diagnostics: {
        source: "temu-chrome-extension",
        eventCount: batch.length,
        categories: categoryCounts(batch),
        storeDetected: Boolean(store.name || store.id),
      },
      summary: {
        apiEventCount: batch.length,
        categories: categoryCounts(batch),
      },
      manifest: {
        source: "temu-chrome-extension",
        bridgeBase: BRIDGE_BASE,
        flushedAt: nowIso(),
      },
      sources,
    });
    await chrome.storage.local.set({
      temuPatrolLastUpload: {
        ok: true,
        store,
        eventCount: batch.length,
        snapshotId: result.snapshot?.id || null,
        uploadedAt: nowIso(),
      },
    });
    return result;
  } catch (error) {
    buffers.set(key, batch.concat(buffers.get(key) || []).slice(-MAX_EVENTS_PER_STORE * 2));
    await chrome.storage.local.set({
      temuPatrolLastUpload: {
        ok: false,
        store,
        error: error?.message || String(error),
        eventCount: batch.length,
        failedAt: nowIso(),
      },
    });
    return null;
  }
}

async function flushAll() {
  for (const key of Array.from(buffers.keys())) {
    await flushStore(key);
  }
}

async function handleStoreDetected(store) {
  const normalized = normalizeStore(store);
  if (!normalized.name) return;
  const key = normalized.accountId;
  stores.set(key, normalized);
  await postBridge("/api/temu-extension/store", {
    accountId: normalized.accountId,
    storeName: normalized.name,
    store: normalized,
  }).catch(() => {});
}

function handleApiEvent(store, event) {
  const normalizedStore = normalizeStore(store || {});
  if (!normalizedStore.name) return;
  const key = normalizedStore.accountId;
  const normalizedEvent = normalizeEvent(event);
  if (!normalizedEvent) return;
  learnTemplateFromEvent(normalizedStore, event).catch(() => {});
  stores.set(key, normalizedStore);
  const next = buffers.get(key) || [];
  next.push(normalizedEvent);
  buffers.set(key, next.slice(-MAX_EVENTS_PER_STORE));
  if (next.length >= 25) {
    flushStore(key).catch(() => {});
  } else {
    scheduleFlush();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TEMU_PATROL_STORE_DETECTED") {
    handleStoreDetected(message.store || {}).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  if (message?.type === "TEMU_PATROL_API_EVENT") {
    handleApiEvent(message.store || {}, message.event || {});
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "TEMU_PATROL_FLUSH") {
    flushAll().then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  if (message?.type === "TEMU_PATROL_START_BACKGROUND_COLLECTION") {
    runExtensionCollection(message.reason || "manual").then((result) => sendResponse(result)).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  if (message?.type === "TEMU_PATROL_STATUS") {
    Promise.all([
      getStoredTemplates(),
      chrome.storage.local.get([BACKGROUND_STATUS_KEY, "temuPatrolLastUpload"]).catch(() => ({})),
    ]).then(([templates, stored]) => {
      sendResponse({
        ok: true,
        templateCount: templates.length,
        templates: templates.map((item) => ({
          key: item.key,
          storeName: item.store?.name || "",
          category: item.category,
          method: item.method,
          url: item.url,
          learnedAt: item.learnedAt,
          lastCapturedAt: item.lastCapturedAt,
        })),
        backgroundStatus: stored?.[BACKGROUND_STATUS_KEY] || null,
        lastUpload: stored?.temuPatrolLastUpload || null,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  if (message?.type === "TEMU_PATROL_CLEAR_TEMPLATES") {
    chrome.storage.local.set({ [TEMPLATE_STORAGE_KEY]: [] }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
  return false;
});

chrome.alarms.create("temu-patrol-flush", { periodInMinutes: 1 });
scheduleDailyCollectionAlarm();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "temu-patrol-flush") flushAll().catch(() => {});
  if (alarm.name === DAILY_COLLECTION_ALARM) runExtensionCollection("daily-09:00").catch(() => {});
});
