"use strict";
// 选品广场实时搜索代理：读 token 直连云端搜索 API，返回格式与原 yunqiCloud.searchProducts 兼容。
const fs = require("fs");
const https = require("https");

const TOKEN_FILE = process.env.YUNQI_TOKEN_FILE || "/opt/temu-erp-data/yunqi-token.json";
const SEARCH_URL = "https://www.yunqishuju.com/api/proxytemu/good/search";

function readToken() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf8");
    const j = JSON.parse(raw);
    if (!j.token) return null;
    if (j.expiresAt && Date.now() > j.expiresAt) return null;
    return j.token;
  } catch { return null; }
}

function httpsPost(url, body, headers, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: "POST", headers: { ...headers, "Content-Type": "application/json;charset=UTF-8", "Content-Length": Buffer.byteLength(data) },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error("响应解析失败")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("请求超时")); });
    req.write(data);
    req.end();
  });
}

const MODE_MAP = { "全托管": 0, "半托管": 1, "0": 0, "1": 1 };
const SORT_MAP = {
  daily_sales: "daily_sales", weekly_sales: "weekly_sales", monthly_sales: "monthly_sales",
  total_sales: "sales", usd_gmv: "usd_gmv", score: "score", total_comments: "total_comment_num_tips", usd_price: "usd_price",
};

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = (v) => String(v || "").trim();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const mall = raw.mall || {};
  const imgs = Array.isArray(raw.image_urls) ? raw.image_urls : [];
  const kwcdn = imgs.find((u) => /kwcdn\.com/.test(String(u || "")));
  const wht = raw.ware_house_type;
  return {
    goods_id: str(raw.goods_id || raw.id),
    sku_id: str(raw.sku_id),
    title_zh: str(raw.title_zh || raw.title || raw.productName),
    title_en: str(raw.title_en),
    main_image: str(kwcdn || raw.thumb_url || imgs[0]),
    product_url: str(raw.product_url) || `https://www.temu.com/goods.html?goods_id=${str(raw.goods_id || raw.id)}`,
    usd_price: num(raw.usd_price || raw.price),
    daily_sales: num(raw.daily_sales),
    weekly_sales: num(raw.weekly_sales),
    monthly_sales: num(raw.monthly_sales),
    total_sales: num(raw.sales || raw.total_sales),
    usd_gmv: num(raw.usd_gmv),
    score: num(raw.score),
    total_comments: num(raw.total_comment_num_tips || raw.comment_num_tips),
    category_zh: str(raw.category_zh || raw.categoryName),
    mall_name: str(raw.mall_name || mall.name),
    mall_mode: wht === 0 ? "全托管" : wht === 1 ? "半托管" : str(raw.mall_mode),
    same_num: num(raw.same_num),
    listed_at: str(raw.created_at || raw.issued_date),
    opt_ids: JSON.stringify(Array.isArray(raw.opt_ids) ? raw.opt_ids : []),
  };
}

async function liveSearch(params = {}) {
  const token = readToken();
  if (!token) {
    const err = new Error("搜索登录已过期，请点击「刷新登录」重新获取");
    err.statusCode = 401;
    throw err;
  }

  const { keyword = "", optId = "", mallMode = "", sortBy = "daily_sales", sortOrder = "DESC", page = 1, pageSize = 24 } = params;
  const pSize = Math.min(Math.max(Number(pageSize) || 24, 1), 100);
  const pNo = Math.max(Number(page) || 1, 1);

  const sortField = SORT_MAP[sortBy] || "daily_sales";
  const sortDir = String(sortOrder).toUpperCase() === "ASC" ? "asc" : "desc";

  const body = {
    from: (pNo - 1) * pSize,
    size: pSize,
    sort: [{ [sortField]: sortDir }],
    regions: [], region: 0, ids: [], mall_ids: [], opt_ids: [], tags: [], brands: [],
    with_mall: true, sold_out: null,
  };
  if (keyword) body.keyword = keyword;
  if (optId) body.opt_ids = [String(optId)];
  if (mallMode && MODE_MAP[mallMode] !== undefined) body.ware_house_type = MODE_MAP[mallMode];

  const json = await httpsPost(SEARCH_URL, body, { Authorization: `Bearer ${token}` });
  if (json.code !== 0) {
    if (json.code === 401 || json.code === 403 || (json.msg || "").includes("token")) {
      const err = new Error("搜索登录已过期，请点击「刷新登录」重新获取");
      err.statusCode = 401;
      throw err;
    }
    throw new Error(`搜索接口返回异常: code=${json.code} msg=${json.msg || ""}`);
  }

  const rawItems = json.data?.data || json.data?.items || json.data?.list || (Array.isArray(json.data) ? json.data : []);
  const total = json.data?.total || rawItems.length;
  let items = rawItems.map(normalizeItem).filter(Boolean);

  // 服务端后过滤（API 不原生支持的筛选条件）
  const minPrice = params.minPrice != null && params.minPrice !== "" ? Number(params.minPrice) : null;
  const maxPrice = params.maxPrice != null && params.maxPrice !== "" ? Number(params.maxPrice) : null;
  const minDailySales = params.minDailySales != null && params.minDailySales !== "" ? Number(params.minDailySales) : null;
  if (minPrice !== null || maxPrice !== null || minDailySales !== null) {
    items = items.filter((it) => {
      if (minPrice !== null && it.usd_price < minPrice) return false;
      if (maxPrice !== null && it.usd_price > maxPrice) return false;
      if (minDailySales !== null && it.daily_sales < minDailySales) return false;
      return true;
    });
  }

  return { items, total, page: pNo, pageSize: pSize, totalPages: Math.ceil(total / pSize) };
}

function tokenStatus() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf8");
    const j = JSON.parse(raw);
    if (!j.token) return { valid: false, reason: "token 文件为空" };
    if (j.expiresAt && Date.now() > j.expiresAt) return { valid: false, reason: "token 已过期", expiredAt: new Date(j.expiresAt).toISOString() };
    return { valid: true, savedAt: j.savedAt || null, expiresAt: j.expiresAt ? new Date(j.expiresAt).toISOString() : null };
  } catch { return { valid: false, reason: "token 文件不存在或无法读取" }; }
}

module.exports = { liveSearch, tokenStatus, readToken };
