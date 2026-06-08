"use strict";
// 选品广场云端读取 service：读 yunqi_products.db（服务器抓取服务写入的云端库），供 lanServer 端点调用。
// 用 better-sqlite3（erp 服务进程已在用，ABI 匹配服务器 node；sqlite 文件格式标准，能读抓取服务用 node:sqlite 建的库）。
const Database = require("better-sqlite3");

const YUNQI_DB = process.env.YUNQI_DB || "/opt/temu-erp-data/yunqi_products.db";
const SELECTION_STATUSES = ["want", "sourcing", "sourced", "listing", "listed", "dropped"];

let _db = null;
function db() {
  if (_db) return _db;
  _db = new Database(YUNQI_DB);
  _db.pragma("busy_timeout = 8000");
  // 选品池表（抓取服务只建 products；selection_pool 在这边按需建，幂等）
  _db.exec(`
    CREATE TABLE IF NOT EXISTS selection_pool (
      goods_id TEXT PRIMARY KEY, sku_id TEXT, title_zh TEXT, title_en TEXT, main_image TEXT, product_url TEXT,
      usd_price REAL DEFAULT 0, daily_sales INTEGER DEFAULT 0, weekly_sales INTEGER DEFAULT 0, monthly_sales INTEGER DEFAULT 0,
      usd_gmv REAL DEFAULT 0, score REAL DEFAULT 0, category_zh TEXT, mall_name TEXT, mall_mode TEXT,
      status TEXT DEFAULT 'want', note TEXT, source_keyword TEXT, added_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sel_status ON selection_pool(status);
  `);
  return _db;
}

// products_latest：物化「每个 goods_id 最新一行」，供 searchProducts 免去每次全表去重。
// products 由抓取服务写入（只增不改历史），MAX(id) 单调增；据此惰性重建——抓取后首次
// 搜索重建一次，平时仅多一次主键 MAX 检查。重建为 DROP+CREATE AS SELECT，单进程同步无并发。
let _latestMaxId = null;
function ensureLatest(d) {
  let curMax;
  try { curMax = d.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM products").get().m; }
  catch { return false; } // products 表尚未就绪
  const exists = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products_latest'").get();
  if (exists && _latestMaxId === curMax) return true;
  d.exec("DROP TABLE IF EXISTS products_latest");
  d.exec("CREATE TABLE products_latest AS SELECT p.* FROM products p WHERE p.id IN (SELECT MAX(id) FROM products GROUP BY goods_id)");
  for (const col of ["daily_sales", "weekly_sales", "monthly_sales", "total_sales", "usd_price", "usd_gmv", "score", "total_comments", "mall_mode"]) {
    try { d.exec(`CREATE INDEX IF NOT EXISTS idx_pl_${col} ON products_latest(${col})`); } catch { /* 列缺失则跳过 */ }
  }
  _latestMaxId = curMax;
  return true;
}

// 商品搜索：查 products_latest(每商品最新一行) + 筛选/排序/分页
function searchProducts(params = {}) {
  const d = db();
  const { keyword = "", category = "", optId = "", mallMode = "", minPrice = null, maxPrice = null, minDailySales = null, sortBy = "daily_sales", sortOrder = "DESC", page = 1, pageSize = 24 } = params || {};
  const conds = [];
  const vals = [];
  if (keyword) { conds.push("(title_zh LIKE ? OR title_en LIKE ?)"); vals.push(`%${keyword}%`, `%${keyword}%`); }
  // optId：真·按类目筛。商品 opt_ids 存为 JSON 如 ["580","1099","2708"]，选「汽车(580)」即筛 opt_ids 含 580。
  // 带引号匹配（%"580"%）防 580 误中 5801；选一级筛全部子类商品（子类商品 opt_ids 也含一级 id）。
  if (optId) { conds.push("opt_ids LIKE ?"); vals.push(`%"${optId}"%`); }
  // category：保留「按词筛标题」兜底（无 opt_id 时输入"厨房/充电"筛标题）
  if (category) { conds.push("(category_zh LIKE ? OR title_zh LIKE ? OR title_en LIKE ?)"); vals.push(`%${category}%`, `%${category}%`, `%${category}%`); }
  if (mallMode) { conds.push("mall_mode = ?"); vals.push(mallMode); }
  if (minPrice != null && minPrice !== "") { conds.push("usd_price >= ?"); vals.push(Number(minPrice)); }
  if (maxPrice != null && maxPrice !== "") { conds.push("usd_price <= ?"); vals.push(Number(maxPrice)); }
  if (minDailySales != null && minDailySales !== "") { conds.push("daily_sales >= ?"); vals.push(Number(minDailySales)); }

  const allowedSort = ["daily_sales", "weekly_sales", "monthly_sales", "total_sales", "usd_price", "usd_gmv", "score", "total_comments"];
  const sort = allowedSort.includes(sortBy) ? sortBy : "daily_sales";
  const order = String(sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const pSize = Math.min(Math.max(Number(pageSize) || 24, 1), 100);
  const pNo = Math.max(Number(page) || 1, 1);
  const offset = (pNo - 1) * pSize;

  // 查物化表 products_latest（去重已在重建时算好，搜索免每次全表去重）。
  // ensureLatest 据 products.MAX(id) 惰性重建：抓取后首次搜索重建一次，之后命中。
  if (ensureLatest(d)) {
    let base = "FROM products_latest";
    if (conds.length) base += " WHERE " + conds.join(" AND ");
    const total = d.prepare(`SELECT COUNT(*) AS c ${base}`).get(...vals).c;
    const items = d.prepare(`SELECT * ${base} ORDER BY ${sort} ${order}, id DESC LIMIT ? OFFSET ?`).all(...vals, pSize, offset);
    return { items, total, page: pNo, pageSize: pSize, totalPages: Math.ceil(total / pSize) };
  }
  // 兜底：products 表尚未就绪、物化表建不出来时，回退原全表去重写法。
  let base = "FROM products WHERE id IN (SELECT MAX(id) FROM products GROUP BY goods_id)";
  if (conds.length) base += " AND " + conds.join(" AND ");
  const total = d.prepare(`SELECT COUNT(*) AS c ${base}`).get(...vals).c;
  const items = d.prepare(`SELECT * ${base} ORDER BY ${sort} ${order}, id DESC LIMIT ? OFFSET ?`).all(...vals, pSize, offset);
  return { items, total, page: pNo, pageSize: pSize, totalPages: Math.ceil(total / pSize) };
}

function getStats() {
  const d = db();
  const s = d.prepare("SELECT COUNT(DISTINCT goods_id) AS totalProducts, COUNT(DISTINCT mall_id) AS totalMalls FROM products").get();
  return { totalProducts: s.totalProducts || 0, totalMalls: s.totalMalls || 0 };
}

function getInfo() {
  const d = db();
  const n = d.prepare("SELECT COUNT(DISTINCT goods_id) AS c FROM products").get().c;
  return { dbPath: YUNQI_DB, rowCount: n || 0 };
}

// ---- 选品池 ----
function listSelection({ status = "" } = {}) {
  const d = db();
  const rows = (status && SELECTION_STATUSES.includes(status))
    ? d.prepare("SELECT * FROM selection_pool WHERE status = ? ORDER BY added_at DESC").all(status)
    : d.prepare("SELECT * FROM selection_pool ORDER BY added_at DESC").all();
  const summary = { total: d.prepare("SELECT COUNT(*) AS c FROM selection_pool").get().c };
  for (const s of SELECTION_STATUSES) summary[s] = 0;
  for (const r of d.prepare("SELECT status, COUNT(*) AS c FROM selection_pool GROUP BY status").all()) { if (r.status) summary[r.status] = r.c; }
  return { rows, summary };
}

function listSelectionIds() {
  return db().prepare("SELECT goods_id FROM selection_pool").all().map((r) => String(r.goods_id));
}

function addSelection(item = {}) {
  const goodsId = String(item?.goods_id || item?.goodsId || "").trim();
  if (!goodsId) return { ok: false, reason: "缺少 goods_id" };
  const d = db();
  const now = new Date().toISOString();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  d.prepare(`
    INSERT INTO selection_pool (goods_id, sku_id, title_zh, title_en, main_image, product_url, usd_price, daily_sales, weekly_sales, monthly_sales, usd_gmv, score, category_zh, mall_name, mall_mode, status, note, source_keyword, added_at, updated_at)
    VALUES (@goods_id,@sku_id,@title_zh,@title_en,@main_image,@product_url,@usd_price,@daily_sales,@weekly_sales,@monthly_sales,@usd_gmv,@score,@category_zh,@mall_name,@mall_mode,@status,@note,@source_keyword,@added_at,@updated_at)
    ON CONFLICT(goods_id) DO UPDATE SET
      title_zh=excluded.title_zh, main_image=excluded.main_image, product_url=excluded.product_url,
      usd_price=excluded.usd_price, daily_sales=excluded.daily_sales, weekly_sales=excluded.weekly_sales,
      monthly_sales=excluded.monthly_sales, usd_gmv=excluded.usd_gmv, score=excluded.score,
      mall_name=excluded.mall_name, mall_mode=excluded.mall_mode, updated_at=excluded.updated_at
  `).run({
    goods_id: goodsId, sku_id: String(item.sku_id || ""), title_zh: String(item.title_zh || ""), title_en: String(item.title_en || ""),
    main_image: String(item.main_image || ""), product_url: String(item.product_url || `https://www.temu.com/goods.html?goods_id=${goodsId}`),
    usd_price: num(item.usd_price), daily_sales: num(item.daily_sales), weekly_sales: num(item.weekly_sales), monthly_sales: num(item.monthly_sales),
    usd_gmv: num(item.usd_gmv), score: num(item.score), category_zh: String(item.category_zh || ""), mall_name: String(item.mall_name || ""), mall_mode: String(item.mall_mode || ""),
    status: SELECTION_STATUSES.includes(item.status) ? item.status : "want", note: String(item.note || ""), source_keyword: String(item.source_keyword || ""),
    added_at: now, updated_at: now,
  });
  return { ok: true, goodsId };
}

function removeSelection(goodsId) {
  const id = String(goodsId || "").trim();
  if (!id) return { ok: false };
  const r = db().prepare("DELETE FROM selection_pool WHERE goods_id = ?").run(id);
  return { ok: true, removed: r.changes };
}

function updateSelection(goodsId, { status, note } = {}) {
  const id = String(goodsId || "").trim();
  if (!id) return { ok: false };
  const sets = [];
  const obj = { goods_id: id, updated_at: new Date().toISOString() };
  if (status != null && SELECTION_STATUSES.includes(status)) { sets.push("status = @status"); obj.status = status; }
  if (note != null) { sets.push("note = @note"); obj.note = String(note); }
  if (!sets.length) return { ok: false, reason: "无可更新字段" };
  sets.push("updated_at = @updated_at");
  const r = db().prepare(`UPDATE selection_pool SET ${sets.join(", ")} WHERE goods_id = @goods_id`).run(obj);
  return { ok: true, changed: r.changes };
}

// 类目树（gettemucategorieslist 抓来存的），前端分类下拉用
function listCategories() {
  try { return db().prepare("SELECT cat_id, cat_name, cat_en_name, cat_level, parent_cat_id, is_leaf FROM categories ORDER BY cat_level, cat_id").all(); }
  catch { return []; }
}

module.exports = { searchProducts, getStats, getInfo, listSelection, listSelectionIds, addSelection, removeSelection, updateSelection, listCategories };
