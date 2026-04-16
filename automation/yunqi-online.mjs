import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { spawn } from "child_process";
import { importFromRows, importFromApiItems, searchProducts, getStats, getTopProducts, getDbPath, getRowCount } from "./yunqi-db.mjs";

const APPDATA_DIR = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation");
const CHROME_YUNQI_EXT_ID = "emdedfmhnfkfiaogfakhdfbpekiefjkp";
const CHROME_LOCAL_EXT_SETTINGS_DIR = path.join(
  process.env.LOCALAPPDATA || "C:/Users/Administrator/AppData/Local",
  "Google/Chrome/User Data/Default/Local Extension Settings",
  CHROME_YUNQI_EXT_ID
);
const YUNQI_TOKEN_FILE = path.join(APPDATA_DIR, "yunqi_token.json");
const YUNQI_CRED_FILE = path.join(APPDATA_DIR, "yunqi_credentials.json");
const YUNQI_HOME_URL = "https://www.yunqishuju.com/";
const YUNQI_TEMU_URL = "https://www.yunqishuju.com/temu/";
const YUNQI_LOGIN_URL = "https://www.yunqishuju.com/login";
export const YUNQI_AUTH_INVALID_CODE = "YUNQI_AUTH_INVALID";

function ensureAppDataDir() {
  fs.mkdirSync(APPDATA_DIR, { recursive: true });
  return APPDATA_DIR;
}

const YUNQI_DEFAULT_CREDENTIALS = { account: "17607931063", password: "aA123456" };

function readYunqiCredentials() {
  try {
    if (fs.existsSync(YUNQI_CRED_FILE)) {
      const saved = JSON.parse(fs.readFileSync(YUNQI_CRED_FILE, "utf8"));
      if (saved?.account && saved?.password) return saved;
    }
  } catch {}
  return YUNQI_DEFAULT_CREDENTIALS;
}

function writeYunqiCredentials(account, password) {
  ensureAppDataDir();
  fs.writeFileSync(YUNQI_CRED_FILE, JSON.stringify({ account, password, savedAt: new Date().toISOString() }), "utf8");
}

function deleteYunqiCredentials() {
  try { fs.unlinkSync(YUNQI_CRED_FILE); } catch {}
}

function maskTokenPreview(token = "") {
  const raw = String(token || "").trim();
  if (!raw) return null;
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function decodeJwtExpiration(token = "") {
  const raw = String(token || "").trim();
  if (!raw) return 0;
  const parts = raw.split(".");
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? exp : 0;
  } catch {
    return 0;
  }
}

function isJwtExpired(token = "", skewMs = 60_000) {
  const exp = decodeJwtExpiration(token);
  if (!exp) return false;
  return exp * 1000 <= Date.now() + skewMs;
}

function readYunqiTokenRecord() {
  try {
    if (!fs.existsSync(YUNQI_TOKEN_FILE)) return { token: "" };
    const raw = fs.readFileSync(YUNQI_TOKEN_FILE, "utf8").trim();
    if (!raw) return { token: "" };
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      return {
        token: typeof parsed?.token === "string" ? parsed.token.trim() : "",
        savedAt: typeof parsed?.savedAt === "string" ? parsed.savedAt : "",
        source: typeof parsed?.source === "string" ? parsed.source : "",
      };
    }
    return { token: raw };
  } catch {
    return { token: "" };
  }
}

function writeYunqiTokenRecord(token, source = "manual") {
  const nextToken = String(token || "").trim();
  ensureAppDataDir();
  const savedAt = new Date().toISOString();
  fs.writeFileSync(YUNQI_TOKEN_FILE, JSON.stringify({ token: nextToken, source, savedAt }, null, 2), "utf8");
  return {
    success: true,
    hasToken: Boolean(nextToken),
    token: nextToken,
    tokenPreview: maskTokenPreview(nextToken),
    source,
    savedAt,
    expiresAt: decodeJwtExpiration(nextToken) || null,
    isExpired: isJwtExpired(nextToken),
  };
}

function buildYunqiTokenResponse() {
  const record = readYunqiTokenRecord();
  const token = String(record?.token || "").trim();
  const expiresAt = decodeJwtExpiration(token);
  const isExpired = Boolean(token) && isJwtExpired(token);
  return {
    hasToken: Boolean(token) && !isExpired,
    token: token || null,
    tokenPreview: maskTokenPreview(token),
    source: record?.source || null,
    savedAt: record?.savedAt || null,
    expiresAt: expiresAt || null,
    isExpired,
  };
}

/** 从 Chrome 云启扩展的 LevelDB 中提取 token */
function extractTokenFromChromeLevelDB() {
  try {
    if (!fs.existsSync(CHROME_LOCAL_EXT_SETTINGS_DIR)) return null;
    // 复制 LevelDB 到临时目录（Chrome 锁住了原目录）
    const tmpDir = path.join(APPDATA_DIR, "_yunqi_ldb_tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    const files = fs.readdirSync(CHROME_LOCAL_EXT_SETTINGS_DIR);
    for (const f of files) {
      if (f === "LOCK") continue; // 跳过锁文件
      try {
        const src = path.join(CHROME_LOCAL_EXT_SETTINGS_DIR, f);
        const dst = path.join(tmpDir, f);
        const buf = fs.readFileSync(src);
        fs.writeFileSync(dst, buf);
      } catch {}
    }
    // 写入空 LOCK 文件
    fs.writeFileSync(path.join(tmpDir, "LOCK"), "");
    // 用 classic-level 读取
    let ClassicLevel;
    try {
      const require = createRequire(import.meta.url);
      ClassicLevel = require("classic-level").ClassicLevel;
    } catch {
      // classic-level 未安装，回退到二进制搜索
      return extractTokenFromLevelDBBinary(tmpDir);
    }
    // 同步打开 LevelDB 不可用, 用 Promise 包装
    return null; // 先用二进制搜索，异步版在后面
  } catch {
    return null;
  }
}

/** 从 LevelDB 文件中用二进制方式搜索 JWT token */
function extractTokenFromLevelDBBinary(dir) {
  try {
    const targetDir = dir || CHROME_LOCAL_EXT_SETTINGS_DIR;
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".ldb") || f.endsWith(".log"));
    let bestToken = null;
    let bestIat = 0;
    for (const file of files) {
      let buf;
      try { buf = fs.readFileSync(path.join(targetDir, file)); } catch { continue; }
      let offset = 0;
      while (true) {
        const idx = buf.indexOf("eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp", offset);
        if (idx < 0) break;
        let end = idx;
        while (end < buf.length && end - idx < 2000) {
          const c = buf[end];
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c === 46 || c === 43 || c === 47 || c === 61) {
            end++;
          } else break;
        }
        const token = buf.slice(idx, end).toString("utf8");
        const parts = token.split(".");
        if (parts.length === 3 && parts[2].length > 20) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
            const iat = Number(payload?.iat) || 0;
            if (iat > bestIat) { bestIat = iat; bestToken = token; }
          } catch {}
        }
        offset = idx + 1;
      }
    }
    return bestToken;
  } catch {
    return null;
  }
}

/** 异步从 Chrome LevelDB 提取 token（使用 classic-level） */
async function extractTokenFromChromeLevelDBAsync() {
  try {
    if (!fs.existsSync(CHROME_LOCAL_EXT_SETTINGS_DIR)) return null;
    const tmpDir = path.join(APPDATA_DIR, "_yunqi_ldb_tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    const files = fs.readdirSync(CHROME_LOCAL_EXT_SETTINGS_DIR);
    for (const f of files) {
      if (f === "LOCK") continue;
      try {
        const src = path.join(CHROME_LOCAL_EXT_SETTINGS_DIR, f);
        const dst = path.join(tmpDir, f);
        fs.writeFileSync(dst, fs.readFileSync(src));
      } catch {}
    }
    fs.writeFileSync(path.join(tmpDir, "LOCK"), "");

    let ClassicLevel;
    try {
      const require = createRequire(import.meta.url);
      ClassicLevel = require("classic-level").ClassicLevel;
    } catch {
      return extractTokenFromLevelDBBinary(tmpDir);
    }

    const db = new ClassicLevel(tmpDir, { createIfMissing: false });
    try {
      await db.open();
      const val = await db.get("token");
      await db.close();
      // 值是 JSON 字符串包裹的 JWT
      const parsed = val.startsWith('"') ? JSON.parse(val) : val;
      return typeof parsed === "string" ? parsed : null;
    } catch {
      try { await db.close(); } catch {}
      return extractTokenFromLevelDBBinary(tmpDir);
    }
  } catch {
    return null;
  }
}

function getStoredYunqiTokenOrThrow() {
  const record = readYunqiTokenRecord();
  let token = String(record?.token || "").trim();
  if (!token || isJwtExpired(token)) {
    // 尝试从 Chrome 云启扩展 LevelDB 自动提取
    const chromeToken = extractTokenFromLevelDBBinary();
    if (chromeToken && !isJwtExpired(chromeToken)) {
      writeYunqiTokenRecord(chromeToken, "chrome-extension-auto");
      console.log("[yunqi] 自动从 Chrome 云启扩展提取到 token");
      token = chromeToken;
    }
  }
  if (!token) throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] Please configure a Yunqi token first`);
  if (isJwtExpired(token)) throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] Current Yunqi token is expired, please log in again`);
  return token;
}

function extractCookieValueFromText(cookieText = "", cookieName = "token") {
  const raw = String(cookieText || "");
  if (!raw) return "";
  const pattern = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`, "i");
  const match = raw.match(pattern);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return String(match[1] || "").trim();
  }
}

function firstFiniteNumberOrNull(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function isYunqiAuthErrorMessage(message = "") {
  const text = String(message || "").toLowerCase();
  return text.includes("token invalid")
    || text.includes("token is not valid")
    || text.includes("token is not newer than 24 hours")
    || text.includes("token失效")
    || text.includes("jwt malformed")
    || text.includes("jwt expired")
    || text.includes("not login")
    || text.includes("please login")
    || text.includes("login again")
    || text.includes("no token");
}

function collectTokenValues(value, source, bucket, depth = 0) {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;
    const bearerMatch = text.match(/Bearer\s+([A-Za-z0-9._-]{16,})/i);
    if (bearerMatch?.[1]) bucket.push({ token: bearerMatch[1], source: `${source}:bearer`, score: 120 });
    const jwtMatch = text.match(/\b([A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,})\b/);
    if (jwtMatch?.[1]) bucket.push({ token: jwtMatch[1], source: `${source}:jwt`, score: 115 });
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try { collectTokenValues(JSON.parse(text), `${source}:json`, bucket, depth + 1); } catch {}
    }
    if (/^[A-Za-z0-9._-]{24,}$/.test(text)) bucket.push({ token: text, source: `${source}:raw`, score: 80 });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTokenValues(item, `${source}[${index}]`, bucket, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = String(key || "");
      const scoreBoost = /access.?token|auth.?token|authorization/i.test(normalizedKey) ? 60 : /token/i.test(normalizedKey) ? 45 : /auth/i.test(normalizedKey) ? 20 : 0;
      if (typeof nested === "string" && scoreBoost > 0) {
        const nestedText = nested.trim();
        if (nestedText) bucket.push({ token: nestedText.replace(/^Bearer\s+/i, ""), source: `${source}.${normalizedKey}`, score: 100 + scoreBoost });
      }
      collectTokenValues(nested, `${source}.${normalizedKey}`, bucket, depth + 1);
    }
  }
}

function pickBestYunqiTokenCandidate(candidates = []) {
  const normalized = [];
  const seen = new Set();
  for (const item of candidates) {
    const token = String(item?.token || "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push({
      token,
      source: item?.source || "unknown",
      score: Number(item?.score) || 0,
      expiresAt: Number(item?.expiresAt) || decodeJwtExpiration(token),
    });
  }
  normalized.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.expiresAt !== left.expiresAt) return right.expiresAt - left.expiresAt;
    return right.token.length - left.token.length;
  });
  return normalized[0] || null;
}

function normalizeCompetitorSort(sortField = "", sortOrder = "") {
  const field = String(sortField || "").trim().toLowerCase();
  const orderText = String(sortOrder || "").trim().toLowerCase();
  const descending = orderText === "desc" || orderText === "descending" || orderText === "descend";
  if (field === "daily_sales") return { sortBy: "daily_sales", sortOrder: descending ? "DESC" : "ASC" };
  if (field === "weekly_sales") return { sortBy: "weekly_sales", sortOrder: descending ? "DESC" : "ASC" };
  if (field === "monthly_sales") return { sortBy: "monthly_sales", sortOrder: descending ? "DESC" : "ASC" };
  if (field === "created_at") return { sortBy: "listed_at", sortOrder: descending ? "DESC" : "ASC" };
  if (field === "price") return { sortBy: "usd_price", sortOrder: descending ? "DESC" : "ASC" };
  if (field === "price_asc") return { sortBy: "usd_price", sortOrder: "ASC" };
  if (field === "price_desc") return { sortBy: "usd_price", sortOrder: "DESC" };
  return { sortBy: "daily_sales", sortOrder: "DESC" };
}

function normalizeWareHouseType(value) {
  if (value === 1 || value === "1") return 1;
  if (String(value || "").toLowerCase() === "semi") return 1;
  return 0;
}

function parseTemuGoodsIdFromUrl(rawUrl = "") {
  const text = String(rawUrl || "").trim();
  if (!text) return "";
  const patterns = [/(?:goods_id|goodsId|goods-id)=([0-9]{6,})/i, /[?&]id=([0-9]{6,})/i, /-g-([0-9]{6,})(?:\.html)?/i, /\/([0-9]{9,})(?:\.html)?(?:[?#/]|$)/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]);
  }
  const digitMatches = text.match(/[0-9]{9,}/g);
  return digitMatches?.[digitMatches.length - 1] || "";
}

function getTemuProductUrlFromGoodsId(goodsId = "") {
  const normalized = String(goodsId || "").trim();
  if (!normalized) return "";
  return `https://www.temu.com/goods.html?goods_id=${normalized}`;
}

function formatCommentNumTips(count = 0) {
  const total = Number(count) || 0;
  if (total <= 0) return "";
  if (total >= 1000) return `${(total / 1000).toFixed(total >= 10000 ? 0 : 1)}k`;
  return String(total);
}

function mapYunqiApiProductToCompetitorProduct(row = {}, position = 0) {
  const price = firstFiniteNumberOrNull(row?.price, row?.usd_price, row?.usdPrice, row?.eur_price, row?.eurPrice);
  const goodsId = firstNonEmptyText(row?.goods_id, row?.goodsId, row?.id);
  const mall = row?.mall || {};
  const prices = Array.isArray(row?.prices) ? row.prices : [];
  const mainImage = firstNonEmptyText(row?.thumb_url, row?.thumbUrl, row?.image, row?.imageUrl, row?.main_image, row?.mainImage, Array.isArray(row?.image_urls) ? row.image_urls[0] : "", Array.isArray(row?.imageUrls) ? row.imageUrls[0] : "");
  const imageUrls = Array.isArray(row?.image_urls) ? row.image_urls.filter(Boolean).map((item) => String(item)) : Array.isArray(row?.imageUrls) ? row.imageUrls.filter(Boolean).map((item) => String(item)) : [mainImage].filter(Boolean);
  const comment = row?.comment || row?.comments || {};
  const commentStats = collectYunqiCommentStats(comment);
  return {
    position,
    goodsId,
    id: goodsId,
    skuId: firstNonEmptyText(row?.sku_id, row?.skuId),
    title: firstNonEmptyText(row?.title, row?.title_zh, row?.titleZh, row?.productName) || "Unnamed competitor",
    titleZh: firstNonEmptyText(row?.title_zh, row?.titleZh, row?.title, row?.productName),
    titleEn: firstNonEmptyText(row?.title_en, row?.titleEn),
    originalTitle: firstNonEmptyText(row?.original_title, row?.originalTitle),
    imageUrl: mainImage,
    imageUrls,
    productUrl: firstNonEmptyText(row?.product_url, row?.productUrl, getTemuProductUrlFromGoodsId(goodsId)),
    url: firstNonEmptyText(row?.product_url, row?.productUrl, getTemuProductUrlFromGoodsId(goodsId)),
    price,
    priceText: price != null ? `$${Number(price).toFixed(2)}` : "",
    marketPrice: firstFiniteNumberOrNull(row?.market_price, row?.marketPrice, row?.origin_price, row?.original_price, row?.originalPrice),
    usdPrice: firstFiniteNumberOrNull(row?.usd_price, row?.usdPrice),
    eurPrice: firstFiniteNumberOrNull(row?.eur_price, row?.eurPrice),
    usdGmv: firstFiniteNumberOrNull(row?.usd_gmv, row?.usdGmv),
    eurGmv: firstFiniteNumberOrNull(row?.eur_gmv, row?.eurGmv),
    dailySales: firstFiniteNumberOrNull(row?.daily_sales, row?.dailySales),
    weeklySales: firstFiniteNumberOrNull(row?.weekly_sales, row?.weeklySales),
    monthlySales: firstFiniteNumberOrNull(row?.monthly_sales, row?.monthlySales),
    totalSales: firstFiniteNumberOrNull(row?.sales, row?.total_sales, row?.totalSales),
    sameNum: firstFiniteNumberOrNull(row?.same_num, row?.sameNum),
    score: firstFiniteNumberOrNull(row?.score, row?.rating, commentStats.score),
    rating: firstFiniteNumberOrNull(row?.rating, row?.score, commentStats.score),
    reviewCount: firstFiniteNumberOrNull(row?.total_comment_num_tips, row?.comment_num_tips, row?.reviewCount, commentStats.reviewCount),
    commentNumTips: firstNonEmptyText(row?.commentNumTips) || formatCommentNumTips(firstFiniteNumberOrNull(row?.reviewCount, commentStats.reviewCount) || 0),
    wareHouseType: normalizeWareHouseType(row?.ware_house_type ?? row?.wareHouseType ?? row?.mall_mode),
    category: firstNonEmptyText(row?.category_zh, row?.categoryName, row?.category, row?.backend_category),
    categoryName: firstNonEmptyText(row?.categoryName, row?.category_zh, row?.category, row?.backend_category),
    mall: firstNonEmptyText(row?.mall_name, row?.mallName, mall?.name),
    mallName: firstNonEmptyText(row?.mall_name, row?.mallName, mall?.name),
    mallId: firstNonEmptyText(row?.mall_id, row?.mallId, mall?.id),
    mallScore: firstFiniteNumberOrNull(row?.mall_score, row?.mallScore, mall?.score),
    mallTotalGoods: firstFiniteNumberOrNull(row?.mall_product_count, row?.mallTotalGoods, mall?.total_goods, mall?.total_show_goods),
    brand: firstNonEmptyText(row?.brand),
    videoUrl: firstNonEmptyText(row?.video_url, row?.videoUrl),
    labels: Array.isArray(row?.labels) ? row.labels.filter(Boolean) : [],
    tags: Array.isArray(row?.tags) ? row.tags.filter(Boolean) : [],
    prices,
    adRecords: Array.isArray(row?.ad_records) ? row.ad_records : [],
    activityType: firstNonEmptyText(row?.activity_type, row?.activityType),
    soldOut: Boolean(row?.sold_out ?? row?.soldOut),
    adult: Boolean(row?.adult),
    createdAt: firstNonEmptyText(row?.created_at, row?.createdAt, row?.listed_at, row?.listedAt, row?.issued_date, row?.issuedDate),
    issuedDate: firstNonEmptyText(row?.issued_date, row?.issuedDate, row?.created_at, row?.createdAt),
    lastModified: firstNonEmptyText(row?.last_modified, row?.lastModified, row?.updated_at, row?.updatedAt),
    lastAdTime: firstNonEmptyText(row?.last_ad_time, row?.lastAdTime),
    dailySalesList: Array.isArray(row?.daily_sales_list) ? row.daily_sales_list.map((entry) => {
      const date = firstNonEmptyText(entry?.date, entry?.day);
      const sales = firstFiniteNumberOrNull(entry?.sales);
      if (!date || sales == null) return null;
      return { date, sales };
    }).filter(Boolean) : [],
    scrapedAt: new Date().toISOString(),
    raw: row,
  };
}

function buildYunqiSearchBody(params = {}) {
  const maxResults = Math.min(Math.max(Number(params?.maxResults) || 50, 1), 100);
  const { sortBy, sortOrder } = normalizeCompetitorSort(params?.sortField, params?.sortOrder);
  const goodsId = firstNonEmptyText(params?.goodsId);
  return {
    keyword: firstNonEmptyText(params?.keyword),
    q: firstNonEmptyText(params?.keyword),
    sold_out: null,
    ware_house_type: normalizeWareHouseType(params?.wareHouseType),
    regions: [],
    region: 0,
    ids: goodsId ? [goodsId] : [],
    mall_ids: Array.isArray(params?.mallIds) ? params.mallIds : [],
    opt_ids: Array.isArray(params?.optIds) ? params.optIds : [],
    tags: Array.isArray(params?.tags) ? params.tags : [],
    sort: [{ [sortBy]: String(sortOrder || "DESC").toLowerCase() }],
    with_mall: true,
    brands: Array.isArray(params?.brands) ? params.brands : [],
    from: Math.max(Number(params?.from) || 0, 0),
    size: maxResults,
  };
}

function collectYunqiCommentStats(comment = {}) {
  const scopes = ["global", "us", "eu"];
  let reviewCount = 0;
  let score = null;
  for (const scope of scopes) {
    const bucket = comment?.[scope];
    const nextReviewCount = firstFiniteNumberOrNull(bucket?.comment_num_tips, bucket?.total_comment_num_tips, bucket?.comment_num);
    if (nextReviewCount != null) {
      reviewCount += nextReviewCount;
    }
    if (score == null) {
      score = firstFiniteNumberOrNull(bucket?.goods_score, bucket?.score, bucket?.rating);
    }
  }
  return {
    reviewCount: reviewCount || firstFiniteNumberOrNull(comment?.comment_num_tips, comment?.total_comment_num_tips, comment?.comment_num) || 0,
    score,
  };
}

function extractYunqiItems(payload) {
  const candidates = [
    payload?.data?.data,
    payload?.data?.items,
    payload?.data?.list,
    payload?.data?.rows,
    payload?.data,
    payload?.items,
    payload?.list,
    payload?.rows,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(Boolean);
  }
  return [];
}

function extractYunqiTotal(payload, fallback = 0) {
  const candidates = [
    payload?.data?.total,
    payload?.data?.count,
    payload?.data?.totalCount,
    payload?.total,
    payload?.count,
    payload?.totalCount,
  ];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return fallback;
}

// ---- CDP 模式：启动真实 Chrome，通过 CDP 协议（原生 WebSocket）读取 cookie ----
const YUNQI_CDP_PORT = 9399;
// 独立 profile，避免和用户正在使用的 Chrome 冲突
const YUNQI_CDP_USER_DATA = path.join(APPDATA_DIR, "yunqi-chrome-profile");
let _cdpProcess = null;

function findChromeExeForCdp() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

async function isCdpAlive() {
  try {
    const resp = await fetch(`http://127.0.0.1:${YUNQI_CDP_PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch { return false; }
}

/** 启动独立 Chrome 带 CDP 调试端口（不影响用户正在用的 Chrome） */
async function launchCdpChromeProcess(startUrl) {
  const chromeExe = findChromeExeForCdp();
  if (!chromeExe) throw new Error("未找到系统 Chrome，请安装 Google Chrome");
  fs.mkdirSync(YUNQI_CDP_USER_DATA, { recursive: true });

  if (await isCdpAlive()) {
    console.error("[yunqi-cdp] 连接到已有 Chrome CDP 实例");
    return;
  }

  const args = [
    `--remote-debugging-port=${YUNQI_CDP_PORT}`,
    `--user-data-dir=${YUNQI_CDP_USER_DATA}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,800",
    startUrl || YUNQI_LOGIN_URL,
  ];

  console.error(`[yunqi-cdp] 启动 CDP Chrome 进行云启自动登录...`);
  _cdpProcess = spawn(chromeExe, args, { detached: true, stdio: "ignore" });
  _cdpProcess.unref();
  _cdpProcess.on("error", (err) => console.error("[yunqi-cdp] Chrome 启动失败:", err?.message));

  // 等待 CDP 就绪
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isCdpAlive()) {
      console.error("[yunqi-cdp] Chrome CDP 已就绪");
      return;
    }
  }
  throw new Error("Chrome CDP 启动超时");
}

/** 通过 CDP 原生 WebSocket 协议读取 yunqishuju.com 的 cookie */
async function readCdpCookies() {
  // 获取调试目标
  const listResp = await fetch(`http://127.0.0.1:${YUNQI_CDP_PORT}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await listResp.json();
  const pageTarget = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pageTarget) return [];

  // 通过 WebSocket 发送 CDP 命令
  const { createRequire: cr } = await import("module");
  const require = cr(import.meta.url);
  // Node.js 内置 WebSocket (v21+) 或 ws 包
  let WS;
  try { WS = globalThis.WebSocket || require("ws"); } catch { WS = (await import("ws")).default; }

  return new Promise((resolve, reject) => {
    const ws = new WS(pageTarget.webSocketDebuggerUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("CDP WebSocket 超时")); }, 10000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msg.result?.cookies || []);
        }
      } catch { /* ignore */ }
    };
    ws.onerror = (err) => { clearTimeout(timer); reject(err); };
  });
}

/** 通过 CDP WebSocket 发送任意命令 */
async function sendCdpCommand(method, params = {}) {
  const listResp = await fetch(`http://127.0.0.1:${YUNQI_CDP_PORT}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await listResp.json();
  // 优先找 yunqi 页面
  const yunqiTarget = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url?.includes("yunqishuju"));
  const pageTarget = yunqiTarget || targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error("没有可用的 CDP 页面");

  const { createRequire: cr } = await import("module");
  const require = cr(import.meta.url);
  let WS;
  try { WS = globalThis.WebSocket || require("ws"); } catch { WS = (await import("ws")).default; }

  return new Promise((resolve, reject) => {
    const ws = new WS(pageTarget.webSocketDebuggerUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("CDP 命令超时")); }, 15000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch { /* ignore */ }
    };
    ws.onerror = (err) => { clearTimeout(timer); reject(err); };
  });
}

/** 通过 CDP 自动填写账号密码并登录（全自动，无需手动操作） */
async function automateLoginViaCdp() {
  const creds = readYunqiCredentials();
  if (!creds?.account || !creds?.password) {
    console.error("[yunqi-cdp] 没有保存的账号密码，无法自动登录");
    return false;
  }
  console.error(`[yunqi-cdp] 开始自动登录，账号: ${creds.account}`);

  // 1. 导航到登录页
  await sendCdpCommand("Page.navigate", { url: YUNQI_LOGIN_URL });
  await new Promise((r) => setTimeout(r, 3000));

  // 2. 云启登录页流程：扫码页 → 点击"验证码登录" → 切换到"密码" tab → 填写 → 登录
  const loginScript = `
    (async () => {
      await new Promise(r => setTimeout(r, 1000));

      // 步骤1: 如果在扫码页面，点击"验证码登录"切换
      const tips1 = document.querySelector('.tips');
      if (tips1 && tips1.textContent.trim().includes('验证码登录')) {
        tips1.click();
        await new Promise(r => setTimeout(r, 1500));
      }

      // 步骤2: 点击"密码" tab 切换到密码登录
      const tabItems = document.querySelectorAll('.tabItem');
      for (const tab of tabItems) {
        if (tab.textContent.trim() === '密码') {
          tab.click();
          await new Promise(r => setTimeout(r, 1000));
          break;
        }
      }

      // 步骤3: 填写手机号（Element UI input，需要触发 Vue 响应式）
      const phoneInput = document.querySelector('input[placeholder="请输入手机号码"]');
      if (!phoneInput) return 'ERR:找不到手机号输入框';
      phoneInput.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(phoneInput, '${creds.account}');
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      phoneInput.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise(r => setTimeout(r, 500));

      // 步骤4: 填写密码
      const pwdInput = document.querySelector('input[placeholder="请输入登录密码"]');
      if (!pwdInput) return 'ERR:找不到密码输入框';
      pwdInput.focus();
      nativeSetter.call(pwdInput, '${creds.password}');
      pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
      pwdInput.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise(r => setTimeout(r, 500));

      // 步骤5: 点击登录按钮
      const loginBtn = document.querySelector('button.sgin');
      if (!loginBtn) {
        // fallback: 找文本为"登录"的按钮
        const allBtns = [...document.querySelectorAll('button')];
        const btn = allBtns.find(b => b.textContent.trim() === '登录' && b.offsetParent !== null);
        if (btn) { btn.click(); return 'OK'; }
        return 'ERR:找不到登录按钮';
      }
      loginBtn.click();
      return 'OK';
    })()
  `;

  try {
    const result = await sendCdpCommand("Runtime.evaluate", {
      expression: loginScript,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = result?.result?.value;
    console.error(`[yunqi-cdp] 自动登录脚本结果: ${value}`);
    if (typeof value === "string" && value.startsWith("ERR:")) {
      console.error(`[yunqi-cdp] 自动登录失败: ${value}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[yunqi-cdp] 自动登录脚本执行失败: ${err?.message}`);
    return false;
  }
}

/** 从 CDP Chrome 获取云启 token（不用 Playwright） */
async function extractTokenFromCdpChrome() {
  if (!(await isCdpAlive())) return null;
  try {
    const cookies = await readCdpCookies();
    const tokenCookie = cookies.find((c) => c.name === "token" && c.domain.includes("yunqishuju"));
    if (tokenCookie?.value && !isJwtExpired(tokenCookie.value)) {
      console.error("[yunqi-cdp] 从 CDP cookie 获取到有效 token");
      return tokenCookie.value;
    }
    console.error(`[yunqi-cdp] CDP cookies 中未找到有效 yunqi token (共 ${cookies.length} 个 cookie, yunqi相关: ${cookies.filter(c => c.domain.includes("yunqi")).map(c => c.name).join(",")})`);
  } catch (err) {
    console.error("[yunqi-cdp] 读取 CDP cookie 失败:", String(err?.message || err));
  }
  return null;
}

export function buildYunqiOnlineHandlers({ ensureBrowser, getContext, randomDelay, logSilent }) {
  let _lastChromeTokenRefreshAttempt = 0;

  /** 当 token 失效时，尝试从 Chrome 扩展自动刷新 */
  async function tryRefreshTokenFromChrome() {
    const now = Date.now();
    if (now - _lastChromeTokenRefreshAttempt < 30_000) return null; // 30秒内不重复
    _lastChromeTokenRefreshAttempt = now;
    try {
      const chromeToken = await extractTokenFromChromeLevelDBAsync();
      if (!chromeToken || isJwtExpired(chromeToken)) return null;
      const currentRecord = readYunqiTokenRecord();
      if (chromeToken === currentRecord?.token) return null; // 同一个 token
      console.log("[yunqi] 从 Chrome 扩展发现新 token，验证中...");
      writeYunqiTokenRecord(chromeToken, "chrome-extension-auto");
      return chromeToken;
    } catch {
      return null;
    }
  }

  // 缓存一个云启页面，用于通过浏览器发请求
  let _yunqiApiPage = null;

  /** 获取或创建一个云启页面，用于在浏览器上下文中发 API 请求 */
  async function getYunqiApiPage() {
    try {
      let context = getContext();
      if (!context) {
        // 浏览器未启动，先启动
        await ensureBrowser();
        context = getContext();
      }
      if (!context) return null;
      // 复用已有页面
      if (_yunqiApiPage && !_yunqiApiPage.isClosed()) return _yunqiApiPage;
      // 在已有页面中找一个云启域名的
      const pages = context.pages();
      for (const p of pages) {
        try {
          const url = p.url();
          if (url.includes("yunqishuju.com") || url.includes("yunqidata.com")) {
            _yunqiApiPage = p;
            return p;
          }
        } catch {}
      }
      // 没有就新开一个隐藏的
      const page = await context.newPage();
      await page.goto(YUNQI_TEMU_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      // 注入 token cookie
      const token = readYunqiTokenRecord()?.token;
      if (token) {
        await context.addCookies([{ name: "token", value: token, domain: ".yunqishuju.com", path: "/" }]);
      }
      _yunqiApiPage = page;
      return page;
    } catch {
      return null;
    }
  }

  /** 通过 CDP Chrome 发 API 请求（真实浏览器环境，不会被拦截） */
  async function requestYunqiApiViaCdp(apiPath, options = {}) {
    const pathName = String(apiPath || "").trim().startsWith("/") ? String(apiPath || "").trim() : `/${String(apiPath || "").trim()}`;
    const method = String(options?.method || "GET").trim().toUpperCase();
    const token = String(options?.token || "").trim();
    const bodyStr = options?.body == null ? null : (typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    const fullUrl = new URL(pathName, YUNQI_HOME_URL).toString();

    // 先确保 CDP Chrome 在云启域名上（cookie 需要同源）
    try {
      const navResult = await sendCdpCommand("Runtime.evaluate", {
        expression: `window.location.origin`,
        returnByValue: true,
      });
      const currentOrigin = navResult?.result?.value || "";
      if (!currentOrigin.includes("yunqishuju")) {
        await sendCdpCommand("Page.navigate", { url: YUNQI_TEMU_URL });
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch {}

    const fetchScript = `
      (async () => {
        try {
          const headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
          };
          ${token ? `headers["Authorization"] = "Bearer ${token}";` : ""}
          const opts = { method: "${method}", headers };
          ${bodyStr ? `opts.body = ${JSON.stringify(bodyStr)};` : ""}
          const res = await fetch(${JSON.stringify(fullUrl)}, opts);
          const text = await res.text();
          return JSON.stringify({ ok: res.ok, status: res.status, text });
        } catch (e) {
          return JSON.stringify({ ok: false, status: 0, text: String(e?.message || e) });
        }
      })()
    `;

    const evalResult = await sendCdpCommand("Runtime.evaluate", {
      expression: fetchScript,
      awaitPromise: true,
      returnByValue: true,
    });
    const resultStr = evalResult?.result?.value;
    if (!resultStr) return null;
    const result = JSON.parse(resultStr);

    let payload = null;
    try { payload = result.text ? JSON.parse(result.text) : null; } catch { payload = result.text; }
    const messageText = String(payload?.msg || payload?.message || payload?.error || result.text || "").trim();
    if (result.status === 401 || isYunqiAuthErrorMessage(messageText)) {
      throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] ${messageText || "Yunqi auth invalid"}`);
    }
    if (payload && typeof payload === "object") {
      const code = Number(payload?.code ?? payload?.status ?? -1);
      if (Number.isFinite(code) && code !== 0 && code !== 200 && payload?.success !== true) {
        if (isYunqiAuthErrorMessage(messageText)) throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] ${messageText}`);
        throw new Error(`Yunqi API ${method} ${pathName} failed: ${messageText || `code=${code}`}`);
      }
    }
    if (!result.ok && !payload) throw new Error(`Yunqi API ${method} ${pathName} failed: ${result.status}`);
    return payload;
  }

  /** 通过 Playwright 页面发请求（fallback） */
  async function requestYunqiApiViaPage(apiPath, options = {}) {
    // 优先通过 CDP Chrome 发请求
    if (await isCdpAlive()) {
      return requestYunqiApiViaCdp(apiPath, options);
    }
    const page = await getYunqiApiPage();
    if (!page) return null; // 没有浏览器，回退到 Node.js fetch
    const pathName = String(apiPath || "").trim().startsWith("/") ? String(apiPath || "").trim() : `/${String(apiPath || "").trim()}`;
    const method = String(options?.method || "GET").trim().toUpperCase();
    const token = String(options?.token || "").trim();
    const bodyStr = options?.body == null ? null : (typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    const fullUrl = new URL(pathName, YUNQI_HOME_URL).toString();

    const result = await page.evaluate(async ({ url, method, token, bodyStr }) => {
      try {
        const headers = {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
        };
        if (token) headers["Authorization"] = "Bearer " + token;
        const opts = { method, headers };
        if (bodyStr && method !== "GET") opts.body = bodyStr;
        const res = await fetch(url, opts);
        const text = await res.text();
        return { ok: res.ok, status: res.status, text };
      } catch (e) {
        return { ok: false, status: 0, text: String(e?.message || e) };
      }
    }, { url: fullUrl, method, token, bodyStr });

    if (!result) return null;
    let payload = null;
    try { payload = result.text ? JSON.parse(result.text) : null; } catch { payload = result.text; }
    const messageText = String(payload?.msg || payload?.message || payload?.error || result.text || "").trim();
    if (result.status === 401 || isYunqiAuthErrorMessage(messageText)) {
      throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] ${messageText || "Yunqi auth invalid"}`);
    }
    if (payload && typeof payload === "object") {
      const code = Number(payload?.code ?? payload?.status ?? -1);
      if (Number.isFinite(code) && code !== 0 && code !== 200 && payload?.success !== true) {
        if (isYunqiAuthErrorMessage(messageText)) throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] ${messageText}`);
        throw new Error(`Yunqi API ${method} ${pathName} failed: ${messageText || `code=${code}`}`);
      }
    }
    if (!result.ok && !payload) throw new Error(`Yunqi API ${method} ${pathName} failed: ${result.status}`);
    return payload;
  }

  async function requestYunqiApi(apiPath, options = {}) {
    const pathName = String(apiPath || "").trim().startsWith("/") ? String(apiPath || "").trim() : `/${String(apiPath || "").trim()}`;
    const method = String(options?.method || "GET").trim().toUpperCase();
    const token = String(options?.token || getStoredYunqiTokenOrThrow()).trim();

    // 优先通过 Playwright 页面发请求（绕过 TLS 指纹检测）
    try {
      const pageResult = await requestYunqiApiViaPage(apiPath, { ...options, token });
      if (pageResult !== null) return pageResult;
      // pageResult === null 说明浏览器不可用，继续走 Node.js HTTP
    } catch (err) {
      // 页面请求成功发出但 API 返回了错误——不要回退到 Node.js（会被云启拦截）
      // 直接把错误抛出去
      throw err;
    }

    // 回退：Node.js 直接 HTTP（加上浏览器 headers）
    const headers = {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Origin": YUNQI_HOME_URL.replace(/\/$/, ""),
      "Referer": YUNQI_TEMU_URL,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "Sec-Ch-Ua": '"Chromium";v="142", "Google Chrome";v="142", "Not:A-Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Authorization": `Bearer ${token}`,
      "Cookie": `token=${token}`,
      ...(options?.headers || {}),
    };
    const body = options?.body;
    if (body != null && method !== "GET" && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json;charset=UTF-8";
    const response = await fetch(new URL(pathName, YUNQI_HOME_URL).toString(), { method, headers, body: body == null || method === "GET" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
    const rawText = await response.text();
    let payload = null;
    try { payload = rawText ? JSON.parse(rawText) : null; } catch { payload = rawText; }
    const messageText = String(payload?.msg || payload?.message || payload?.error || rawText || "").trim();
    if (response.status === 401 || isYunqiAuthErrorMessage(messageText)) {
      if (!options?._retried) {
        const freshToken = await tryRefreshTokenFromChrome();
        if (freshToken) {
          console.log("[yunqi] Token 失效，使用 Chrome 扩展新 token 重试...");
          return requestYunqiApi(apiPath, { ...options, token: freshToken, _retried: true });
        }
      }
      throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] ${messageText || "Yunqi auth invalid"}`);
    }
    const apiCode = Number(payload?.code ?? payload?.status ?? payload?.errno);
    const hasApiCode = payload && typeof payload === "object" && (Object.prototype.hasOwnProperty.call(payload, "code") || Object.prototype.hasOwnProperty.call(payload, "status") || Object.prototype.hasOwnProperty.call(payload, "errno") || Object.prototype.hasOwnProperty.call(payload, "success"));
    if (hasApiCode) {
      const failedByCode = Number.isFinite(apiCode) && apiCode !== 0 && apiCode !== 200;
      const failedByFlag = payload?.success === false;
      if (failedByCode || failedByFlag) {
        if (!pathName.includes("/getUserInfo")) {
          try {
            const verifyRes = await fetch(new URL("/api/user/getUserInfo", YUNQI_HOME_URL).toString(), { method: "GET", headers });
            const verifyText = await verifyRes.text().catch(() => "");
            let verifyPayload = null; try { verifyPayload = verifyText ? JSON.parse(verifyText) : null; } catch {}
            const verifyMsg = String(verifyPayload?.msg || verifyPayload?.message || "").trim();
            if (verifyRes.status === 401 || isYunqiAuthErrorMessage(verifyMsg)) {
              throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] ${verifyMsg || "token失效，请重新登录"}`);
            }
          } catch (verifyErr) {
            if (String(verifyErr?.message || "").includes(YUNQI_AUTH_INVALID_CODE)) throw verifyErr;
          }
        }
        throw new Error(`Yunqi API ${method} ${pathName} failed: ${messageText || `code=${String(payload?.code ?? payload?.status ?? payload?.errno ?? "unknown")}`}`);
      }
    }
    if (!response.ok) throw new Error(`Yunqi API ${method} ${pathName} failed: ${response.status} ${messageText || response.statusText}`);
    return payload;
  }

  async function verifyYunqiTokenOnline(token = "") {
    const nextToken = String(token || "").trim();
    if (!nextToken) throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] Please configure a Yunqi token first`);
    if (isJwtExpired(nextToken)) throw new Error(`[${YUNQI_AUTH_INVALID_CODE}] Current Yunqi token is expired, please log in again`);
    await requestYunqiApi("/api/user/getUserInfo", { method: "GET", token: nextToken });
    return nextToken;
  }

  async function writeVerifiedYunqiTokenRecord(token, source = "manual") {
    const verifiedToken = await verifyYunqiTokenOnline(token);
    return writeYunqiTokenRecord(verifiedToken, source);
  }

  async function inspectYunqiTokenFromPage(page) {
    const context = getContext();
    const storageSnapshot = await page.evaluate(() => {
      const dumpStorage = (storage) => {
        const out = {};
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key) continue;
            out[key] = storage.getItem(key);
          }
        } catch {}
        return out;
      };
      return {
        href: location.href,
        title: document.title,
        cookie: document.cookie || "",
        localStorage: dumpStorage(window.localStorage),
        sessionStorage: dumpStorage(window.sessionStorage),
      };
    }).catch(() => ({ href: page.url(), title: "", cookie: "", localStorage: {}, sessionStorage: {} }));

    const candidates = [];
    const remember = (token, source, score = 0) => {
      const normalized = String(token || "").trim();
      if (!normalized) return;
      candidates.push({ token: normalized, source, score, expiresAt: decodeJwtExpiration(normalized) });
    };
    remember(extractCookieValueFromText(storageSnapshot.cookie || "", "token"), "document.cookie.token", 240);
    for (const [storageType, values] of Object.entries({ localStorage: storageSnapshot.localStorage || {}, sessionStorage: storageSnapshot.sessionStorage || {} })) {
      for (const [key, value] of Object.entries(values || {})) {
        const boost = /access.?token|login.?token|auth/i.test(String(key)) ? 200 : /token/i.test(String(key)) ? 140 : 0;
        if (boost <= 0 && !/token|bearer|jwt/i.test(String(value || ""))) continue;
        const bucket = [];
        collectTokenValues(value, `${storageType}.${String(key)}`, bucket);
        for (const item of bucket) candidates.push({ token: item.token, source: item.source, score: (Number(item.score) || 0) + boost, expiresAt: Number(item.expiresAt) || decodeJwtExpiration(item.token) });
      }
    }
    try {
      const cookieEntries = await context.cookies([page.url(), YUNQI_HOME_URL]);
      const yunqiTokenCookie = (cookieEntries || []).find((cookie) => String(cookie?.name || "").trim().toLowerCase() === "token" && String(cookie?.domain || "").trim().toLowerCase().includes("yunqishuju.com"));
      if (yunqiTokenCookie?.value) remember(String(yunqiTokenCookie.value).trim(), `cookie.${yunqiTokenCookie.name}`, 260);
    } catch (error) {
      logSilent("yunqi.token.cookies", error, "warn");
    }
    const best = pickBestYunqiTokenCandidate(candidates);
    if (!best?.token) return null;
    return { token: best.token, source: best.source, pageUrl: storageSnapshot.href || page.url(), title: storageSnapshot.title || "" };
  }

  function getOpenYunqiPages() {
    const context = getContext();
    return (context?.pages?.() || []).filter((item) => /yunqishuju\.com/i.test(String(item?.url?.() || "")));
  }

  // requestViaPage 已被 requestYunqiApiViaPage 替代


  // 检测 item 是否与关键词相关
  function isItemRelevantToKeyword(item, kwLower) {
    if (!kwLower) return true;
    const fields = [
      item?.title, item?.title_zh, item?.titleZh, item?.goods_name,
      item?.original_title, item?.originalTitle,
      item?.category_zh, item?.categoryName, item?.category, item?.backend_category,
    ];
    const allText = fields.map((f) => String(f || "").toLowerCase()).join(" ");
    if (!allText.trim()) return false;

    // 完整关键词匹配
    const kwCompact = kwLower.replace(/\s+/g, "");
    if (allText.includes(kwCompact)) return true;

    // 英文：空格分词后每个词都必须出现
    const kwTokens = kwLower.split(/\s+/).filter(Boolean);
    if (kwTokens.length > 1 && kwTokens.every((t) => allText.includes(t))) return true;

    // 中文：按2字词切分（滑动窗口），要求至少一半的2字词匹配
    if (kwCompact.length >= 2) {
      const bigrams = [];
      for (let i = 0; i < kwCompact.length - 1; i++) {
        bigrams.push(kwCompact.slice(i, i + 2));
      }
      const matchCount = bigrams.filter((bg) => allText.includes(bg)).length;
      if (matchCount >= Math.ceil(bigrams.length * 0.6)) return true;
    }
    return false;
  }

  /** 通过 CDP Chrome 在云启网站上执行搜索并抓取 DOM 结果 */
  async function searchViaCdpScrape(keyword, maxResults = 50) {
    if (!(await isCdpAlive())) {
      await launchCdpChromeProcess("https://www.yunqishuju.com/temu/home");
      await new Promise((r) => setTimeout(r, 3000));
      // 自动登录
      const token = await extractTokenFromCdpChrome();
      if (!token) {
        await automateLoginViaCdp();
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    console.error(`[yunqi-search] CDP DOM 抓取搜索: "${keyword}"`);

    // 导航到搜索页
    await sendCdpCommand("Page.navigate", { url: "https://www.yunqishuju.com/temu/home" });
    await new Promise((r) => setTimeout(r, 4000));

    // 步骤 1：同步填入关键词（不 await，不涉及导航）
    const fillScript = `
      (() => {
        const input = document.querySelector('.lay-input input.en')
          || document.querySelector('input.en')
          || document.querySelector('input[placeholder*="关键词"]')
          || document.querySelector('input[placeholder*="搜索"]');
        if (!input) return JSON.stringify({ error: '找不到搜索框' });
        input.focus();
        const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        ns.call(input, ${JSON.stringify(keyword)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ ok: true });
      })()
    `;
    const fillResult = await sendCdpCommand("Runtime.evaluate", {
      expression: fillScript, returnByValue: true,
    });
    const fillStatus = JSON.parse(fillResult?.result?.value || "{}");
    if (fillStatus.error) throw new Error(`[yunqi-search] ${fillStatus.error}`);

    // 步骤 2：点击搜索按钮（fire-and-forget，click 会触发导航，不 await 返回值避免 Promise was collected）
    const clickScript = `
      (() => {
        const btn = [...document.querySelectorAll('button,.el-button')].find(b => b.textContent.trim() === '搜索' && b.offsetParent);
        if (btn) { btn.click(); return 'clicked'; }
        return 'not-found';
      })()
    `;
    try {
      await sendCdpCommand("Runtime.evaluate", {
        expression: clickScript, returnByValue: true,
      });
    } catch (err) {
      // 即使 Promise was collected 也放过——click 本身已经发出
      console.error(`[yunqi-search] click 可忽略的错误: ${String(err?.message || err).slice(0, 100)}`);
    }

    // 步骤 3：等搜索结果加载 + 给导航后的新 execution context 时间
    await new Promise((r) => setTimeout(r, 6000));

    // 从 DOM 抓取结果
    const scrapeScript = `
      (() => {
        const rows = document.querySelectorAll('.el-table__body-wrapper .el-table__row');
        const products = [];
        rows.forEach(row => {
          const cells = [...row.querySelectorAll('.el-table__cell, td')];
          if (cells.length < 5) return;
          // 第1列：商品标题+图片
          const col0 = cells[0]?.innerText?.trim() || '';
          const imgEl = row.querySelector('img');
          const titleLines = col0.split('\\n').filter(l => l.trim() && !l.includes('播放视频'));
          const title = titleLines[0] || '';
          const tags = titleLines.slice(1).filter(t => t.length < 20);
          // 第2列：店铺
          const mall = cells[1]?.innerText?.trim() || '';
          // 第3列：分类
          const catText = cells[2]?.innerText?.trim() || '';
          const catParts = catText.split('\\n').filter(Boolean);
          // 第5列：价格
          const priceText = cells[4]?.innerText?.trim() || '';
          const priceMatch = priceText.match(/\\$([\\d,.]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;
          // 第6-9列：日/周/月/总销量
          const dailySales = parseInt((cells[5]?.innerText || '').replace(/[^\\d]/g, '')) || 0;
          const weeklySales = parseInt((cells[6]?.innerText || '').replace(/[^\\d]/g, '')) || 0;
          const monthlySales = parseInt((cells[7]?.innerText || '').replace(/[^\\d]/g, '')) || 0;
          const totalSales = parseInt((cells[8]?.innerText || '').replace(/[^\\d]/g, '')) || 0;
          // 第10列：评分
          const ratingText = cells[9]?.innerText?.trim() || '';
          const globalRating = ratingText.match(/全球\\s*([\\d.]+)/)?.[1];
          // 第11列：评论数
          const reviewText = cells[10]?.innerText?.trim() || '';
          const totalReviews = reviewText.match(/总计\\s*([\\d,]+)/)?.[1]?.replace(/,/g, '');
          // 提取 goods_id (从图片 URL 或链接)
          const goodsIdMatch = imgEl?.src?.match(/\\/(\\d{9,})/) || row.innerHTML.match(/goods_id=?(\\d{9,})/);

          const gid = goodsIdMatch?.[1] || '';
          // 尝试从 Vue 组件或 Nuxt store 获取中文标题
          let titleZh = '';
          try {
            // 方法1: 从 el-table 的 Vue 组件获取行数据
            const tableBody = document.querySelector('.el-table__body-wrapper');
            const tableVue = tableBody?.__vue__ || tableBody?.parentElement?.__vue__;
            if (tableVue) {
              const tableData = tableVue.data || tableVue.$parent?.data || tableVue.$parent?.tableData || [];
              if (Array.isArray(tableData)) {
                const rowData = tableData.find(d => String(d?.goods_id || d?.id || '') === gid);
                if (rowData) titleZh = rowData.title_zh || rowData.titleZh || rowData.title_cn || '';
              }
            }
            // 方法2: 从行元素的 __vue__ 获取
            if (!titleZh && row.__vue__) {
              const rowVue = row.__vue__;
              const rd = rowVue.row || rowVue.$attrs?.row || rowVue.$parent?.row;
              if (rd) titleZh = rd.title_zh || rd.titleZh || rd.title_cn || '';
            }
            // 方法3: 从 Nuxt store 获取
            if (!titleZh && gid && window.$nuxt?.$store?.state) {
              const findInObj = (obj, depth) => {
                if (!obj || typeof obj !== 'object' || depth > 4) return '';
                if (Array.isArray(obj)) {
                  for (const item of obj) {
                    if (item && String(item.goods_id || item.id || '') === gid) {
                      return item.title_zh || item.titleZh || item.title_cn || '';
                    }
                  }
                }
                for (const key of Object.keys(obj)) {
                  const found = findInObj(obj[key], depth + 1);
                  if (found) return found;
                }
                return '';
              };
              titleZh = findInObj(window.$nuxt.$store.state, 0);
            }
          } catch(e) {}
          products.push({
            title: titleZh || title, title_zh: titleZh, title_en: title,
            mall_name: mall, thumb_url: imgEl?.src || '',
            category_zh: catParts.join(' > '),
            usd_price: price, daily_sales: dailySales,
            weekly_sales: weeklySales, monthly_sales: monthlySales,
            total_sales: totalSales,
            score: globalRating ? parseFloat(globalRating) : null,
            review_count: totalReviews ? parseInt(totalReviews) : 0,
            goods_id: gid,
            tags,
          });
        });
        const totalEl = [...document.querySelectorAll('span,div')].find(el => /共\\s*\\d+\\s*条/.test(el.textContent));
        const totalMatch = totalEl?.textContent?.match(/(\\d+)/);
        return JSON.stringify({ total: totalMatch ? parseInt(totalMatch[1]) : products.length, products });
      })()
    `;
    const scrapeResult = await sendCdpCommand("Runtime.evaluate", {
      expression: scrapeScript, returnByValue: true,
    });
    const scraped = JSON.parse(scrapeResult?.result?.value || '{"products":[],"total":0}');
    console.error(`[yunqi-search] CDP 抓取到 ${scraped.products.length} 条结果 (总计 ${scraped.total})`);

    // 转换为标准格式
    return { code: 0, data: { data: scraped.products, total: scraped.total } };
  }

  async function requestYunqiSearch(body) {
    const kw = body.q || body.keyword || "";
    const requestedSize = Math.min(Math.max(Number(body.size) || 50, 1), 100);

    // 有关键词就优先走 CDP（searchViaCdpScrape 内部会自动启动 Chrome + 登录，
    // 所以这里**不要再用 isCdpAlive 门禁**——之前的门禁会导致 CDP 没开时直接跳到无关键词的 API，
    // 结果返回的是日销量倒序的通用 feed，跟搜索词毫无关系）
    if (kw) {
      try {
        return await searchViaCdpScrape(kw, requestedSize);
      } catch (err) {
        console.error(`[yunqi-search] CDP 抓取失败: ${String(err?.message || err).slice(0, 200)}`);
        if (String(err?.message || "").includes(YUNQI_AUTH_INVALID_CODE)) throw err;
        // 有关键词但 CDP 挂了——宁可报错也不要悄悄返回错的数据
        throw new Error(`关键词搜索失败（CDP）：${String(err?.message || err).slice(0, 200)}`);
      }
    }

    // 没关键词才用 API（例如 competitorTrack 只按 goodsId 查单品），
    // 这类请求 yunqi API 本身就不需要关键词
    try {
      const apiBody = {
        from: body.from || 0,
        size: requestedSize,
        sort: body.sort || [{ daily_sales: "desc" }],
        ware_house_type: body.ware_house_type ?? 0,
        regions: body.regions || [],
        region: body.region || 0,
        ids: body.ids || [],
        mall_ids: body.mall_ids || [],
        opt_ids: body.opt_ids || [],
        tags: body.tags || [],
        brands: body.brands || [],
        with_mall: body.with_mall ?? true,
        sold_out: body.sold_out ?? null,
      };
      const result = await requestYunqiApi("/api/proxytemu/good/search", { method: "POST", body: apiBody });
      if (result && result.code === 0) return result;
    } catch (err) {
      if (String(err?.message || "").includes(YUNQI_AUTH_INVALID_CODE)) throw err;
      console.error("[yunqi-search] API fallback 失败:", String(err?.message || err).slice(0, 200));
    }

    throw new Error("竞品搜索暂时不可用");
  }

  const competitorTrack = async (params = {}) => {
    const url = String(params.url || "").trim();
    const goodsId = String(params.goodsId || "").trim() || parseTemuGoodsIdFromUrl(url);
    if (!goodsId) throw new Error("Please provide a valid Temu goods link or goodsId");
    const payload = await requestYunqiSearch(buildYunqiSearchBody({ ...params, goodsId, keyword: "", maxResults: 20 }));
    const items = extractYunqiItems(payload);
    const matched = items.find((item) => firstNonEmptyText(item?.goods_id, item?.goodsId, item?.id) === goodsId) || null;
    if (!matched) {
      if (params.allowNotMatched) return { url, productUrl: url || getTemuProductUrlFromGoodsId(goodsId), goodsId, requestedGoodsId: goodsId, matchStatus: "not_matched", candidates: [], scrapedAt: new Date().toISOString() };
      throw new Error(`Yunqi did not return an exact match for goodsId=${goodsId}`);
    }
    let sameNum = null;
    try {
      const similarPayload = await requestYunqiApi(`/api/proxytemu/goods/${goodsId}/image-similar`, { method: "POST", body: {} });
      sameNum = extractYunqiTotal(similarPayload, extractYunqiItems(similarPayload).length);
    } catch (error) {
      if (String(error?.message || "").includes(`[${YUNQI_AUTH_INVALID_CODE}]`)) throw error;
      logSilent("yunqi.sameNum.fetch", error, "warn");
    }
    const mapped = mapYunqiApiProductToCompetitorProduct(matched);
    return { ...mapped, sameNum: sameNum ?? mapped.sameNum ?? null, requestedGoodsId: goodsId, matchStatus: "exact", scrapedAt: new Date().toISOString() };
  };

  return {
    setToken: async (token) => writeVerifiedYunqiTokenRecord(token, "manual"),
    getToken: async () => buildYunqiTokenResponse(),
    fetchTokenFromBrowser: async () => {
      // 优先从 CDP Chrome 获取 token（纯 CDP 协议，不走 Playwright）
      const cdpToken = await extractTokenFromCdpChrome();
      if (cdpToken) {
        const saved = writeYunqiTokenRecord(cdpToken, "cdp-fetch");
        console.error("[yunqi-cdp] fetchTokenFromBrowser: 从 CDP cookie 获取 token 成功");
        return { ...saved, cdpMode: true };
      }

      await ensureBrowser();
      const context = getContext();
      let pages = getOpenYunqiPages();
      let openedPage = false;
      let waitedForLogin = false;
      if (pages.length === 0) {
        const page = await context.newPage();
        openedPage = true;
        await page.goto(YUNQI_TEMU_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
        await randomDelay(1200, 1800);
        pages = getOpenYunqiPages();
        if (pages.length === 0) pages = [page];
      }

      const tryReadFromPages = async () => {
        for (const page of (getOpenYunqiPages().length > 0 ? getOpenYunqiPages() : pages)) {
          const result = await inspectYunqiTokenFromPage(page).catch((error) => {
            logSilent("yunqi.token.inspectPage", error, "warn");
            return null;
          });
          if (!result?.token) continue;
          try {
            const saved = await writeVerifiedYunqiTokenRecord(result.token, result.source || "browser-page");
            return { ...saved, openedPage, waitedForLogin, pageUrl: result.pageUrl || page.url(), title: result.title || "" };
          } catch (error) {
            const errorMessage = String(error?.message || "");
            if (!errorMessage.includes(`[${YUNQI_AUTH_INVALID_CODE}]`) && !isYunqiAuthErrorMessage(errorMessage)) throw error;
            logSilent("yunqi.token.browser.invalid", error, "warn");
          }
        }
        return null;
      };

      const immediate = await tryReadFromPages();
      if (immediate) return immediate;

      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        waitedForLogin = true;
        await Promise.all((getOpenYunqiPages().length > 0 ? getOpenYunqiPages() : pages).map((page) => page.waitForTimeout(2000)));
        const next = await tryReadFromPages();
        if (next) return next;
      }

      throw new Error("No usable Yunqi token was found in the active Yunqi page. Please log in to yunqishuju.com and keep that page open.");
    },
    setYunqiCredentials: async ({ account, password }) => {
      const a = String(account || "").trim();
      const p = String(password || "").trim();
      if (!a || !p) throw new Error("账号和密码不能为空");
      writeYunqiCredentials(a, p);
      return { success: true, account: a };
    },
    getYunqiCredentials: async () => {
      const cred = readYunqiCredentials();
      return { hasCredentials: Boolean(cred?.account && cred?.password), account: cred?.account || null };
    },
    deleteYunqiCredentials: async () => {
      deleteYunqiCredentials();
      return { success: true };
    },
    autoLogin: async () => {
      // ---- 纯 CDP 模式：启动真实 Chrome，全自动登录 ----

      // 1. 先检查是否已有有效 token（从 CDP Chrome cookie 或本地文件）
      const existingToken = await extractTokenFromCdpChrome();
      if (existingToken) {
        const saved = writeYunqiTokenRecord(existingToken, "cdp-existing");
        return { ...saved, autoLogin: true, alreadyLoggedIn: true, cdpMode: true };
      }

      // 2. 启动真实 Chrome（使用系统默认 profile）
      console.error("[yunqi-cdp] 启动真实 Chrome 进行云启登录...");
      await launchCdpChromeProcess(YUNQI_LOGIN_URL);

      // 等待页面加载
      await new Promise((r) => setTimeout(r, 3000));

      // 先检查一下启动后 cookie 里有没有有效 token（可能 Chrome profile 里已登录）
      const quickToken = await extractTokenFromCdpChrome();
      if (quickToken) {
        const saved = writeYunqiTokenRecord(quickToken, "cdp-profile-cookie");
        console.error("[yunqi-cdp] Chrome profile 中已有有效 token");
        return { ...saved, autoLogin: true, alreadyLoggedIn: true, cdpMode: true };
      }

      // 3. 自动填写账号密码登录
      const loginOk = await automateLoginViaCdp();

      // 4. 轮询等待登录完成（最多 60 秒）
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const token = await extractTokenFromCdpChrome();
        if (token) {
          const saved = writeYunqiTokenRecord(token, "cdp-auto-login");
          console.error("[yunqi-cdp] 自动登录成功，token 已保存");
          return { ...saved, autoLogin: true, alreadyLoggedIn: false, cdpMode: true };
        }
      }

      throw new Error("自动登录超时，请检查账号密码是否正确");
    },
    competitorSearch: async (params = {}) => {
      const keyword = String(params.keyword || "").trim();
      if (!keyword) throw new Error("Please input a keyword first");
      const payload = await requestYunqiSearch(buildYunqiSearchBody(params));
      const items = extractYunqiItems(payload);
      const products = items.map((item, index) => mapYunqiApiProductToCompetitorProduct(item, index + 1));
      return { products, keyword, region: String(params.region || "global"), totalFound: extractYunqiTotal(payload, products.length), scrapedAt: new Date().toISOString() };
    },
    competitorTrack,
    competitorBatchTrack: async (params = {}) => {
      const urls = Array.isArray(params.urls) ? params.urls.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const results = [];
      for (const url of urls) {
        try {
          results.push({ ...(await competitorTrack({ url, allowNotMatched: true })), url });
        } catch (error) {
          results.push({ url, productUrl: url, goodsId: parseTemuGoodsIdFromUrl(url), error: String(error?.message || error || "Competitor track failed"), scrapedAt: new Date().toISOString() });
        }
      }
      return { results, total: urls.length, success: results.filter((item) => !item.error && item.matchStatus !== "not_matched").length, scrapedAt: new Date().toISOString() };
    },
    competitorAutoRegister: async (params = {}) => ({
      success: false,
      email: "",
      region: String(params.region || "global"),
      registeredAt: new Date().toISOString(),
      message: "Current build does not support Yunqi auto registration yet. Please log in manually and fetch token from the active Yunqi page.",
    }),
    yunqiDbImport: async (params = {}) => {
      const filePath = String(params.filePath || "").trim();
      if (!filePath) throw new Error("请选择要导入的文件");
      if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
      const require = createRequire(import.meta.url);
      const XLSX = require("xlsx");
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("Excel 文件中没有工作表");
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
      if (!rows || rows.length < 3) throw new Error("文件数据不足（至少需要表头 + 1 行数据）");
      const fileName = path.basename(filePath);
      return importFromRows(rows, fileName);
    },
    yunqiDbSearch: async (params = {}) => searchProducts(params),
    yunqiDbStats: async () => getStats(),
    yunqiDbTop: async (params = {}) => getTopProducts(params.field, params.limit),
    yunqiDbInfo: async () => ({ dbPath: getDbPath(), rowCount: getRowCount() }),
    yunqiDbSyncOnline: async (params = {}) => {
      const keywords = Array.isArray(params.keywords) ? params.keywords.map((k) => String(k || "").trim()).filter(Boolean) : [];
      if (keywords.length === 0) throw new Error("请提供至少一个搜索关键词");
      const maxPages = Math.min(Math.max(Number(params.maxPages) || 3, 1), 10);
      const pageSize = 100;
      const wareHouseType = params.wareHouseType ?? null;
      const results = [];
      let totalImported = 0;
      let totalSkipped = 0;

      for (const keyword of keywords) {
        const allItems = [];
        try {
          for (let page = 0; page < maxPages; page++) {
            const body = {
              from: page * pageSize,
              size: pageSize,
              sort: [{ daily_sales: "desc" }],
              ware_house_type: wareHouseType,
              regions: [],
              region: 0,
              ids: [],
              mall_ids: [],
              opt_ids: [],
              tags: [],
              brands: [],
              with_mall: true,
              sold_out: null,
            };
            const payload = await requestYunqiApi("/api/proxytemu/good/search", { method: "POST", body });
            if (!payload || payload.code !== 0) break;
            const items = extractYunqiItems(payload);
            if (items.length === 0) break;
            allItems.push(...items);
            if (items.length < pageSize) break;
            await randomDelay(800, 1500);
          }
        } catch (err) {
          if (String(err?.message || "").includes(YUNQI_AUTH_INVALID_CODE)) throw err;
          logSilent("yunqi.dbSync", err, "warn");
        }
        const importResult = importFromApiItems(allItems, keyword);
        totalImported += importResult.imported;
        totalSkipped += importResult.skipped;
        results.push({ keyword, fetched: allItems.length, imported: importResult.imported, skipped: importResult.skipped, batchId: importResult.batchId });
        if (keywords.indexOf(keyword) < keywords.length - 1) await randomDelay(500, 1000);
      }

      return { results, totalImported, totalSkipped, syncedAt: new Date().toISOString(), dbRowCount: getRowCount() };
    },
  };
}
