const PAGE_EVENT_SOURCE = "temu-patrol-page-hook";
const PAGE_EVENT_TYPE = "TEMU_PATROL_API_EVENT";
const STORE_UPDATE_INTERVAL_MS = 3000;

let latestStore = null;
let lastStoreSignature = "";

const STORE_NAME_KEYS = ["storeName", "shopName", "mallName", "merchantName", "sellerName"];
const STORE_ID_KEYS = ["storeId", "shopId", "mallId", "merchantId", "sellerId"];
const STORE_CONTEXT_KEYS = /store|shop|mall|merchant|seller|店铺|店鋪|商家|卖家|賣家/i;
const AUTH_PAGE_TEXT = /登录|注册|忘记密码|找回密码|验证码|sign\s*in|log\s*in|forgot\s*password|reset\s*password/i;

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

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hasStoreContextKey(value = {}) {
  return Object.keys(value).some((key) => STORE_CONTEXT_KEYS.test(key));
}

function isAuthPage() {
  const url = String(window.location.href || "");
  if (/login|signin|register|password|forgot|reset|auth/i.test(url)) return true;
  const bodyText = normalizeText(document.body?.innerText || "").slice(0, 2000);
  return AUTH_PAGE_TEXT.test(bodyText) && !/seller|merchant|店铺|店鋪|商品|订单|訂單/i.test(bodyText);
}

function findStoreInObject(value, depth = 0, context = { hasStoreContext: false, keyHint: "" }) {
  if (!value || typeof value !== "object" || depth > 3) return null;
  const currentHasStoreContext = hasStoreContextKey(value);
  const nextContext = {
    hasStoreContext: context.hasStoreContext || currentHasStoreContext,
    keyHint: context.keyHint || "",
  };
  const idKeys = STORE_ID_KEYS.concat("id");
  const explicitNameKey = STORE_NAME_KEYS.find((key) => typeof value[key] === "string" && isLikelyStoreName(value[key]));
  const nameKey = explicitNameKey || "";
  if (nameKey) {
    const idKey = idKeys.find((key) => value[key] !== undefined && value[key] !== null);
    return {
      name: normalizeStoreNameText(value[nameKey]),
      id: idKey ? normalizeText(value[idKey]) : "",
      source: "object",
      confidence: 0.78,
    };
  }
  const genericName = typeof value.name === "string" && isLikelyStoreName(value.name)
    ? normalizeStoreNameText(value.name)
    : "";
  const genericIdKey = idKeys.find((key) => value[key] !== undefined && value[key] !== null);
  const keyHintLooksLikeStore = STORE_CONTEXT_KEYS.test(context.keyHint || "");
  if (genericName && genericIdKey && (currentHasStoreContext || keyHintLooksLikeStore)) {
    return {
      name: genericName,
      id: normalizeText(value[genericIdKey]),
      source: "object",
      confidence: 0.72,
    };
  }
  for (const [childKey, child] of Object.entries(value)) {
    const childContext = {
      hasStoreContext: nextContext.hasStoreContext,
      keyHint: STORE_CONTEXT_KEYS.test(childKey) ? childKey : nextContext.keyHint,
    };
    const found = findStoreInObject(child, depth + 1, childContext);
    if (found) return found;
  }
  return null;
}

function detectStoreFromStorage(storage) {
  const candidates = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) || "";
    if (!/(store|shop|mall|merchant|seller|店铺)/i.test(key)) continue;
    const raw = storage.getItem(key);
    if (!raw || raw.length > 50000) continue;
    const parsed = safeJsonParse(raw);
    const found = parsed ? findStoreInObject(parsed) : null;
    if (found) candidates.push({ ...found, source: `storage:${key}`, confidence: 0.82 });
    const textMatch = raw.match(/(?:店铺|storeName|shopName|mallName|merchantName)["'\s:：=]+([^"',，。\n\r]{2,60})/i);
    if (textMatch && isLikelyStoreName(textMatch[1])) {
      candidates.push({
        name: normalizeStoreNameText(textMatch[1]),
        id: "",
        source: `storage:${key}`,
        confidence: 0.55,
      });
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function detectStoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("storeId") || params.get("mallId") || params.get("shopId") || params.get("merchantId");
  if (!id) return null;
  return {
    name: "",
    id: normalizeText(id),
    source: "url",
    confidence: 0.45,
  };
}

function detectStoreFromDom() {
  if (isAuthPage()) return null;
  const selectors = [
    "[data-testid*='store' i]",
    "[data-testid*='shop' i]",
    "[data-testid*='merchant' i]",
    "[aria-label*='店铺']",
    "[aria-label*='店鋪']",
    "[title*='店铺']",
    "[title*='店鋪']",
  ];
  const texts = [];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const text = normalizeText(node.textContent || node.getAttribute("title") || node.getAttribute("aria-label"));
      if (text && text.length <= 120) texts.push(text);
      if (texts.length > 30) break;
    }
    if (texts.length > 30) break;
  }
  const pageText = texts.join(" | ");
  const patterns = [
    /当前店铺[:：\s]+([^|]{2,60})/,
    /店铺名称[:：\s]+([^|]{2,60})/,
    /当前店鋪[:：\s]+([^|]{2,60})/,
    /店鋪名稱[:：\s]+([^|]{2,60})/,
    /店铺[:：\s]+([^|]{2,60})/,
    /店鋪[:：\s]+([^|]{2,60})/,
    /Current\s+Store[:\s]+([^|]{2,60})/i,
    /Store\s+Name[:\s]+([^|]{2,60})/i,
  ];
  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    const name = match ? normalizeStoreNameText(match[1]) : "";
    if (isLikelyStoreName(name)) {
      return {
        name,
        id: "",
        source: "dom",
        confidence: 0.62,
      };
    }
  }
  return null;
}

function detectCurrentStore() {
  if (isAuthPage()) return null;
  const candidates = [
    detectStoreFromStorage(window.localStorage),
    detectStoreFromStorage(window.sessionStorage),
    detectStoreFromDom(),
    detectStoreFromUrl(),
  ].filter(Boolean);
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
  if (!best) return null;
  return {
    id: best.id || "",
    name: best.name || "",
    source: best.source,
    confidence: best.confidence,
    url: window.location.href,
    detectedAt: new Date().toISOString(),
  };
}

function storeSignature(store) {
  if (!store) return "";
  return `${store.id || ""}|${store.name || ""}|${store.source || ""}`;
}

function publishStore(store, reason) {
  if (!store) return;
  const storeName = normalizeStoreNameText(store.name);
  if (!isLikelyStoreName(storeName)) return;
  const currentConfidence = Number(latestStore?.confidence || 0);
  const nextConfidence = Number(store.confidence || 0);
  if (latestStore?.name && latestStore.name !== store.name && nextConfidence < currentConfidence) return;
  latestStore = { ...(latestStore || {}), ...store, name: storeName, lastReason: reason };
  const signature = storeSignature(latestStore);
  if (signature === lastStoreSignature) return;
  lastStoreSignature = signature;
  chrome.runtime.sendMessage({
    type: "TEMU_PATROL_STORE_DETECTED",
    store: latestStore,
  }).catch(() => {});
}

function mergeStoreFromApi(response) {
  const found = findStoreInObject(response);
  if (!found) return;
  publishStore({
    id: found.id || latestStore?.id || "",
    name: found.name || latestStore?.name || "",
    source: "api-response",
    confidence: 0.9,
    url: window.location.href,
    detectedAt: new Date().toISOString(),
  }, "api");
}

function injectPageHook() {
  const mount = document.documentElement || document.head || document.body;
  if (!mount) {
    setTimeout(injectPageHook, 50);
    return;
  }
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-hook.js");
  script.type = "text/javascript";
  script.onload = () => script.remove();
  mount.appendChild(script);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== PAGE_EVENT_SOURCE || event.data.type !== PAGE_EVENT_TYPE) return;
  const payload = event.data.payload || {};
  if (payload.response && typeof payload.response === "object") {
    mergeStoreFromApi(payload.response);
  }
  chrome.runtime.sendMessage({
    type: "TEMU_PATROL_API_EVENT",
    store: isAuthPage() ? null : (latestStore || detectCurrentStore()),
    event: payload,
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TEMU_PATROL_GET_STORE") {
    sendResponse({ store: latestStore || detectCurrentStore() });
  }
  return false;
});

injectPageHook();
publishStore(detectCurrentStore(), "initial");
setInterval(() => publishStore(detectCurrentStore(), "interval"), STORE_UPDATE_INTERVAL_MS);
