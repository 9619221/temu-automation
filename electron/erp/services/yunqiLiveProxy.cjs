"use strict";
// 选品广场实时搜索代理：转发请求到 yunqi-search-proxy（Playwright 浏览器 session 内 fetch）。
const http = require("http");

const PROXY_PORT = Number(process.env.YQ_PROXY_PORT) || 19281;
const PROXY_HOST = "127.0.0.1";

function proxyPost(path, body, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: PROXY_HOST, port: PROXY_PORT, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { reject(new Error("代理响应解析失败")); }
      });
    });
    req.on("error", (e) => reject(new Error(`搜索代理不可用 (${e.code || e.message})，请稍后重试`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("搜索代理响应超时")); });
    req.write(data);
    req.end();
  });
}

function proxyGet(path, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: PROXY_HOST, port: PROXY_PORT, path, method: "GET", timeout }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
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
  const { keyword = "", optId = "", mallMode = "", sortBy = "daily_sales", sortOrder = "DESC", page = 1, pageSize = 24 } = params;
  const pSize = Math.min(Math.max(Number(pageSize) || 24, 1), 100);
  const pNo = Math.max(Number(page) || 1, 1);

  const sortField = SORT_MAP[sortBy] || "daily_sales";
  const sortDir = String(sortOrder).toUpperCase() === "ASC" ? "asc" : "desc";
  const wareHouseType = (mallMode && MODE_MAP[mallMode] !== undefined) ? MODE_MAP[mallMode] : 0;

  const searchBody = {
    from: (pNo - 1) * pSize,
    size: pSize,
    sort: [{ [sortField]: sortDir }],
    ware_house_type: wareHouseType,
  };
  if (keyword) searchBody.keyword = keyword;
  if (optId) searchBody.opt_ids = [String(optId)];

  const resp = await proxyPost("/search", searchBody);
  if (resp.statusCode === 401) {
    const err = new Error("搜索登录已过期，请点击「刷新登录」重新获取");
    err.statusCode = 401;
    throw err;
  }
  const result = resp.body;
  if (result.code !== 0 && result.code !== undefined) {
    throw new Error(result.message || `搜索异常: code=${result.code}`);
  }

  const rawItems = result.items || [];
  const total = result.total || rawItems.length;
  let items = rawItems.map(normalizeItem).filter(Boolean);

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

async function tokenStatus() {
  const health = await proxyGet("/health");
  if (!health) return { valid: false, reason: "搜索代理未运行" };
  return { valid: health.ready === true, ready: health.ready, lastUsed: health.lastUsed };
}

module.exports = { liveSearch, tokenStatus };
