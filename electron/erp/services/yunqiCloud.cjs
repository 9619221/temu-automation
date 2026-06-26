"use strict";
// 选品广场云端读取 service：读 yunqi_products.db（服务器抓取服务写入的云端库），供 lanServer 端点调用。
// 用 better-sqlite3（erp 服务进程已在用，ABI 匹配服务器 node；sqlite 文件格式标准，能读抓取服务用 node:sqlite 建的库）。
const Database = require("better-sqlite3");
const { queryAll, queryOne, execute, getTableColumns, tableExists } = require("../../db/connection.cjs");

const YUNQI_DB = process.env.YUNQI_DB || "/opt/temu-erp-data/yunqi_products.db";
const SELECTION_STATUSES = ["want", "sourcing", "sourced", "listing", "listed", "dropped"];

let _db = null;
async function db() {
  if (_db) return _db;
  _db = new Database(YUNQI_DB);
  _db.pragma("busy_timeout = 8000");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS selection_pool (
      account_id TEXT NOT NULL DEFAULT '',
      goods_id TEXT NOT NULL,
      sku_id TEXT, title_zh TEXT, title_en TEXT, main_image TEXT, product_url TEXT,
      usd_price REAL DEFAULT 0, daily_sales INTEGER DEFAULT 0, weekly_sales INTEGER DEFAULT 0, monthly_sales INTEGER DEFAULT 0,
      usd_gmv REAL DEFAULT 0, score REAL DEFAULT 0, category_zh TEXT, mall_name TEXT, mall_mode TEXT,
      backend_category TEXT DEFAULT '',
      status TEXT DEFAULT 'want', note TEXT, source_keyword TEXT, added_at TEXT, updated_at TEXT,
      PRIMARY KEY (account_id, goods_id)
    );
  `);
  try {
    const cols = (await getTableColumns(_db, "selection_pool")).map(name => ({ name }));
    if (cols.length && !cols.some((c) => c.name === "account_id")) {
      _db.exec(`
        ALTER TABLE selection_pool RENAME TO _selection_pool_old;
        CREATE TABLE selection_pool (
          account_id TEXT NOT NULL DEFAULT '',
          goods_id TEXT NOT NULL,
          sku_id TEXT, title_zh TEXT, title_en TEXT, main_image TEXT, product_url TEXT,
          usd_price REAL DEFAULT 0, daily_sales INTEGER DEFAULT 0, weekly_sales INTEGER DEFAULT 0, monthly_sales INTEGER DEFAULT 0,
          usd_gmv REAL DEFAULT 0, score REAL DEFAULT 0, category_zh TEXT, mall_name TEXT, mall_mode TEXT,
          backend_category TEXT DEFAULT '',
          status TEXT DEFAULT 'want', note TEXT, source_keyword TEXT, added_at TEXT, updated_at TEXT,
          PRIMARY KEY (account_id, goods_id)
        );
        INSERT INTO selection_pool (account_id, goods_id, sku_id, title_zh, title_en, main_image, product_url,
          usd_price, daily_sales, weekly_sales, monthly_sales, usd_gmv, score, category_zh, mall_name, mall_mode,
          backend_category, status, note, source_keyword, added_at, updated_at)
        SELECT '', goods_id, sku_id, title_zh, title_en, main_image, product_url,
          usd_price, daily_sales, weekly_sales, monthly_sales, usd_gmv, score, category_zh, mall_name, mall_mode,
          COALESCE(backend_category, ''), status, note, source_keyword, added_at, updated_at
        FROM _selection_pool_old;
        DROP TABLE _selection_pool_old;
        CREATE INDEX IF NOT EXISTS idx_sel_status ON selection_pool(status);
        CREATE INDEX IF NOT EXISTS idx_sel_account ON selection_pool(account_id);
      `);
    }
  } catch {}
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sel_status ON selection_pool(status);
    CREATE INDEX IF NOT EXISTS idx_sel_account ON selection_pool(account_id);
  `);
  return _db;
}

async function buildCategoryPath(optIds) {
  if (!Array.isArray(optIds) || !optIds.length) return "";
  const d = await db();
  const ids = optIds.map(String);
  const rows = await queryAll(d, `SELECT cat_id, cat_name, cat_level, parent_cat_id FROM categories WHERE cat_id IN (${ids.map(() => "?").join(",")})`, [...ids]);
  if (!rows.length) return "";
  const byId = Object.fromEntries(rows.map((r) => [String(r.cat_id), r]));
  const parts = [];
  for (const id of ids) {const r = byId[id];if (r) parts.push(r.cat_name);}
  return parts.join(">");
}

// products_latest：物化「每个 goods_id 最新一行」，供 searchProducts 免去每次全表去重。
// products 由抓取服务写入（只增不改历史），MAX(id) 单调增；据此惰性重建——抓取后首次
// 搜索重建一次，平时仅多一次主键 MAX 检查。重建为 DROP+CREATE AS SELECT，单进程同步无并发。
let _latestMaxId = null;
let _ftsReady = false;
async function ensureLatest(d) {
  let curMax;
  try {curMax = (await queryOne(d, "SELECT COALESCE(MAX(id), 0) AS m FROM products")).m;}
  catch {return false;} // products 表尚未就绪
  const exists = await tableExists(d, "products_latest");
  if (exists && _latestMaxId === curMax) return true;
  d.exec("DROP TABLE IF EXISTS products_latest");
  d.exec("CREATE TABLE products_latest AS SELECT p.* FROM products p WHERE p.id IN (SELECT MAX(id) FROM products GROUP BY goods_id)");
  for (const col of ["daily_sales", "weekly_sales", "monthly_sales", "total_sales", "usd_price", "usd_gmv", "score", "total_comments", "mall_mode"]) {
    try {d.exec(`CREATE INDEX IF NOT EXISTS idx_pl_${col} ON products_latest(${col})`);} catch {/* 列缺失则跳过 */}
  }
  // FTS5 trigram 全文搜索索引：替代 LIKE '%关键词%' 全表扫描
  _ftsReady = false;
  try {
    d.exec("DROP TABLE IF EXISTS products_fts");
    d.exec("CREATE VIRTUAL TABLE products_fts USING fts5(title_zh, title_en, category_zh, tokenize='trigram')");
    d.exec("INSERT INTO products_fts(rowid, title_zh, title_en, category_zh) SELECT id, COALESCE(title_zh,''), COALESCE(title_en,''), COALESCE(category_zh,'') FROM products_latest");
    _ftsReady = true;
  } catch {/* FTS5 不可用则降级到 LIKE */}
  _latestMaxId = curMax;
  return true;
}

// 商品搜索：查 products_latest(每商品最新一行) + 筛选/排序/分页
async function searchProducts(params = {}) {
  const d = await db();
  const { keyword = "", category = "", optId = "", mallMode = "", minPrice = null, maxPrice = null, minDailySales = null, sortBy = "daily_sales", sortOrder = "DESC", page = 1, pageSize = 24 } = params || {};
  const conds = [];
  const vals = [];
  if (keyword) {
    if (_ftsReady) {
      conds.push("id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)");
      vals.push(`"${keyword.replace(/"/g, '""')}"`);
    } else {
      conds.push("(title_zh LIKE ? OR title_en LIKE ?)");
      vals.push(`%${keyword}%`, `%${keyword}%`);
    }
  }
  // optId：真·按类目筛。商品 opt_ids 存为 JSON 如 ["580","1099","2708"]，选「汽车(580)」即筛 opt_ids 含 580。
  // 带引号匹配（%"580"%）防 580 误中 5801；选一级筛全部子类商品（子类商品 opt_ids 也含一级 id）。
  if (optId) {conds.push("opt_ids LIKE ?");vals.push(`%"${optId}"%`);}
  // category：保留「按词筛标题」兜底（无 opt_id 时输入"厨房/充电"筛标题）
  if (category) {
    if (_ftsReady) {
      conds.push("id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)");
      vals.push(`"${category.replace(/"/g, '""')}"`);
    } else {
      conds.push("(category_zh LIKE ? OR title_zh LIKE ? OR title_en LIKE ?)");
      vals.push(`%${category}%`, `%${category}%`, `%${category}%`);
    }
  }
  if (mallMode) {conds.push("mall_mode = ?");vals.push(mallMode);}
  if (minPrice != null && minPrice !== "") {conds.push("usd_price >= ?");vals.push(Number(minPrice));}
  if (maxPrice != null && maxPrice !== "") {conds.push("usd_price <= ?");vals.push(Number(maxPrice));}
  if (minDailySales != null && minDailySales !== "") {conds.push("daily_sales >= ?");vals.push(Number(minDailySales));}

  const allowedSort = ["daily_sales", "weekly_sales", "monthly_sales", "total_sales", "usd_price", "usd_gmv", "score", "total_comments"];
  const sort = allowedSort.includes(sortBy) ? sortBy : "daily_sales";
  const order = String(sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const pSize = Math.min(Math.max(Number(pageSize) || 24, 1), 100);
  const pNo = Math.max(Number(page) || 1, 1);
  const offset = (pNo - 1) * pSize;

  // 查物化表 products_latest（去重已在重建时算好，搜索免每次全表去重）。
  // ensureLatest 据 products.MAX(id) 惰性重建：抓取后首次搜索重建一次，之后命中。
  if (await ensureLatest(d)) {
    let base = "FROM products_latest";
    if (conds.length) base += " WHERE " + conds.join(" AND ");
    const total = (await queryOne(d, `SELECT COUNT(*) AS c ${base}`, [...vals])).c;
    const items = await queryAll(d, `SELECT * ${base} ORDER BY ${sort} ${order}, id DESC LIMIT ? OFFSET ?`, [...vals, pSize, offset]);
    return { items, total, page: pNo, pageSize: pSize, totalPages: Math.ceil(total / pSize) };
  }
  // 兜底：products 表尚未就绪、物化表建不出来时，回退原全表去重写法。
  let base = "FROM products WHERE id IN (SELECT MAX(id) FROM products GROUP BY goods_id)";
  if (conds.length) base += " AND " + conds.join(" AND ");
  const total = (await queryOne(d, `SELECT COUNT(*) AS c ${base}`, [...vals])).c;
  const items = await queryAll(d, `SELECT * ${base} ORDER BY ${sort} ${order}, id DESC LIMIT ? OFFSET ?`, [...vals, pSize, offset]);
  return { items, total, page: pNo, pageSize: pSize, totalPages: Math.ceil(total / pSize) };
}

async function getStats() {
  const d = await db();
  const s = await queryOne(d, "SELECT COUNT(DISTINCT goods_id) AS totalProducts, COUNT(DISTINCT mall_id) AS totalMalls FROM products");
  return { totalProducts: s.totalProducts || 0, totalMalls: s.totalMalls || 0 };
}

async function getInfo() {
  const d = await db();
  const n = (await queryOne(d, "SELECT COUNT(DISTINCT goods_id) AS c FROM products")).c;
  return { dbPath: YUNQI_DB, rowCount: n || 0 };
}

// ---- 选品池 ----
async function listSelection({ status = "", accountId = "" } = {}) {
  const d = await db();
  const aid = String(accountId || "");
  const rows = status && SELECTION_STATUSES.includes(status) ? await queryAll(d,
  "SELECT * FROM selection_pool WHERE account_id = ? AND status = ? ORDER BY added_at DESC", [aid, status]) : await queryAll(d,
  "SELECT * FROM selection_pool WHERE account_id = ? ORDER BY added_at DESC", [aid]);
  const summary = { total: (await queryOne(d, "SELECT COUNT(*) AS c FROM selection_pool WHERE account_id = ?", [aid])).c };
  for (const s of SELECTION_STATUSES) summary[s] = 0;
  for (const r of await queryAll(d, "SELECT status, COUNT(*) AS c FROM selection_pool WHERE account_id = ? GROUP BY status", [aid])) {if (r.status) summary[r.status] = r.c;}
  return { rows, summary };
}

async function listSelectionIds(accountId = "") {
  const aid = String(accountId || "");
  return (await queryAll(await db(), "SELECT goods_id FROM selection_pool WHERE account_id = ?", [aid])).map((r) => String(r.goods_id));
}

async function addSelection(item = {}) {
  const goodsId = String(item?.goods_id || item?.goodsId || "").trim();
  if (!goodsId) return { ok: false, reason: "缺少 goods_id" };
  const d = await db();
  const now = new Date().toISOString();
  const num = (v) => {const n = Number(v);return Number.isFinite(n) ? n : 0;};
  const optIds = Array.isArray(item.opt_ids) ? item.opt_ids : [];
  const backCat = String(item.backend_category || "") || await buildCategoryPath(optIds) || String(item.category_zh || "");
  const aid = String(item.accountId || item.account_id || "");
  await execute(d, `
    INSERT INTO selection_pool (account_id, goods_id, sku_id, title_zh, title_en, main_image, product_url, usd_price, daily_sales, weekly_sales, monthly_sales, usd_gmv, score, category_zh, mall_name, mall_mode, backend_category, status, note, source_keyword, added_at, updated_at)
    VALUES (@account_id,@goods_id,@sku_id,@title_zh,@title_en,@main_image,@product_url,@usd_price,@daily_sales,@weekly_sales,@monthly_sales,@usd_gmv,@score,@category_zh,@mall_name,@mall_mode,@backend_category,@status,@note,@source_keyword,@added_at,@updated_at)
    ON CONFLICT(account_id, goods_id) DO UPDATE SET
      title_zh=excluded.title_zh, main_image=excluded.main_image, product_url=excluded.product_url,
      usd_price=excluded.usd_price, daily_sales=excluded.daily_sales, weekly_sales=excluded.weekly_sales,
      monthly_sales=excluded.monthly_sales, usd_gmv=excluded.usd_gmv, score=excluded.score,
      mall_name=excluded.mall_name, mall_mode=excluded.mall_mode, backend_category=excluded.backend_category, updated_at=excluded.updated_at
  `, {
    account_id: aid, goods_id: goodsId, sku_id: String(item.sku_id || ""), title_zh: String(item.title_zh || ""), title_en: String(item.title_en || ""),
    main_image: String(item.main_image || ""), product_url: String(item.product_url || `https://www.temu.com/goods.html?goods_id=${goodsId}`),
    usd_price: num(item.usd_price), daily_sales: num(item.daily_sales), weekly_sales: num(item.weekly_sales), monthly_sales: num(item.monthly_sales),
    usd_gmv: num(item.usd_gmv), score: num(item.score), category_zh: String(item.category_zh || ""), mall_name: String(item.mall_name || ""), mall_mode: String(item.mall_mode || ""),
    backend_category: backCat,
    status: SELECTION_STATUSES.includes(item.status) ? item.status : "want", note: String(item.note || ""), source_keyword: String(item.source_keyword || ""),
    added_at: now, updated_at: now
  });
  return { ok: true, goodsId };
}

async function removeSelection(goodsId, accountId = "") {
  const id = String(goodsId || "").trim();
  if (!id) return { ok: false };
  const aid = String(accountId || "");
  const r = await execute(await db(), "DELETE FROM selection_pool WHERE account_id = ? AND goods_id = ?", [aid, id]);
  return { ok: true, removed: r.changes };
}

async function updateSelection(goodsId, { status, note, accountId = "" } = {}) {
  const id = String(goodsId || "").trim();
  if (!id) return { ok: false };
  const aid = String(accountId || "");
  const sets = [];
  const obj = { goods_id: id, account_id: aid, updated_at: new Date().toISOString() };
  if (status != null && SELECTION_STATUSES.includes(status)) {sets.push("status = @status");obj.status = status;}
  if (note != null) {sets.push("note = @note");obj.note = String(note);}
  if (!sets.length) return { ok: false, reason: "无可更新字段" };
  sets.push("updated_at = @updated_at");
  const r = await execute(await db(), `UPDATE selection_pool SET ${sets.join(", ")} WHERE account_id = @account_id AND goods_id = @goods_id`, obj);
  return { ok: true, changed: r.changes };
}

// 类目树（gettemucategorieslist 抓来存的），前端分类下拉用
async function listCategories() {
  try {return await queryAll(await db(), "SELECT cat_id, cat_name, cat_en_name, cat_level, parent_cat_id, is_leaf FROM categories ORDER BY cat_level, cat_id");}
  catch {return [];}
}

module.exports = { searchProducts, getStats, getInfo, listSelection, listSelectionIds, addSelection, removeSelection, updateSelection, listCategories };