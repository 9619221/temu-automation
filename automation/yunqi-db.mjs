/**
 * 云启数据 SQLite 数据库管理
 * - 导入 Excel 导出文件
 * - 查询、搜索、统计
 */
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

const APP_DATA_ROOT = process.env.APP_USER_DATA
  || path.join(process.env.APPDATA || path.join(process.env.HOME || "", ".config"), "temu-automation");

const DB_PATH = path.join(
  APP_DATA_ROOT,
  "yunqi_products.db"
);

let _db = null;

export function getDb() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  initSchema(_db);
  return _db;
}

// node:sqlite 没有 better-sqlite3 的 db.transaction()，用 helper 模拟（返回可调用的事务函数，保持原调用方式 tx() 不变）。
function makeTransaction(db, fn) {
  return (...args) => {
    db.exec("BEGIN");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch {}
      throw e;
    }
  };
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goods_id TEXT NOT NULL,
      sku_id TEXT,
      title_zh TEXT,
      title_en TEXT,
      main_image TEXT,
      carousel_images TEXT,
      video_url TEXT,
      product_url TEXT,
      -- 价格
      usd_price REAL DEFAULT 0,
      eur_price REAL DEFAULT 0,
      -- 销量
      daily_sales INTEGER DEFAULT 0,
      weekly_sales INTEGER DEFAULT 0,
      monthly_sales INTEGER DEFAULT 0,
      total_sales INTEGER DEFAULT 0,
      -- GMV
      usd_gmv REAL DEFAULT 0,
      eur_gmv REAL DEFAULT 0,
      -- 评价
      score REAL DEFAULT 0,
      total_comments INTEGER DEFAULT 0,
      -- 分类
      category_en TEXT,
      category_zh TEXT,
      backend_category TEXT,
      -- 标签
      labels TEXT,
      -- 店铺
      mall_id TEXT,
      mall_name TEXT,
      mall_mode TEXT,
      mall_logo TEXT,
      mall_product_count INTEGER DEFAULT 0,
      mall_total_sales INTEGER DEFAULT 0,
      mall_score REAL DEFAULT 0,
      mall_fans INTEGER DEFAULT 0,
      -- 时间
      listed_at TEXT,
      recorded_at TEXT,
      -- 导入批次
      import_batch TEXT,
      imported_at TEXT DEFAULT (datetime('now', 'localtime')),
      -- 索引用
      UNIQUE(goods_id, import_batch)
    );

    CREATE INDEX IF NOT EXISTS idx_products_goods_id ON products(goods_id);
    CREATE INDEX IF NOT EXISTS idx_products_title_zh ON products(title_zh);
    CREATE INDEX IF NOT EXISTS idx_products_mall_id ON products(mall_id);
    CREATE INDEX IF NOT EXISTS idx_products_daily_sales ON products(daily_sales DESC);
    CREATE INDEX IF NOT EXISTS idx_products_weekly_sales ON products(weekly_sales DESC);
    CREATE INDEX IF NOT EXISTS idx_products_monthly_sales ON products(monthly_sales DESC);
    CREATE INDEX IF NOT EXISTS idx_products_total_sales ON products(total_sales DESC);
    CREATE INDEX IF NOT EXISTS idx_products_usd_price ON products(usd_price);
    CREATE INDEX IF NOT EXISTS idx_products_usd_gmv ON products(usd_gmv DESC);
    CREATE INDEX IF NOT EXISTS idx_products_score ON products(score DESC);
    CREATE INDEX IF NOT EXISTS idx_products_import_batch ON products(import_batch);
    CREATE INDEX IF NOT EXISTS idx_products_category_zh ON products(category_zh);
    CREATE INDEX IF NOT EXISTS idx_products_mall_mode ON products(mall_mode);

    CREATE TABLE IF NOT EXISTS import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL UNIQUE,
      file_name TEXT,
      total_rows INTEGER DEFAULT 0,
      imported_rows INTEGER DEFAULT 0,
      skipped_rows INTEGER DEFAULT 0,
      imported_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- 核价筛选快照（每次扫描一批，sku_id 为主键组件）
    CREATE TABLE IF NOT EXISTS price_review_snapshot (
      snapshot_id TEXT NOT NULL,
      scanned_at INTEGER NOT NULL,
      spu_id TEXT,
      sku_id TEXT NOT NULL,
      skc_id TEXT,
      title TEXT,
      main_image TEXT,
      sku_spec TEXT,
      original_price REAL,              -- 原申报价
      seller_current_price REAL,        -- 卖家当前报价
      reference_price REAL,             -- 平台参考申报价（Temu 给的，非 1688）
      price_diff REAL,
      price_diff_pct REAL,
      review_status TEXT,               -- 仅扫描「价格申报中」
      change_count INTEGER DEFAULT 0,
      cost_1688 REAL,                   -- 1688 图搜命中价（取策略后）
      cost_manual REAL,                 -- 人工手填成本（优先级最高）
      cost_source TEXT,                 -- 1688_image_search / manual / not_found / pending
      pass_175 INTEGER,                 -- 0=不通过 1=通过 NULL=未知（无成本）
      detail_url TEXT,                  -- Temu 后台该 SKU 的核价直达链接
      PRIMARY KEY (snapshot_id, sku_id)
    );

    CREATE INDEX IF NOT EXISTS idx_price_review_sku ON price_review_snapshot(sku_id);
    CREATE INDEX IF NOT EXISTS idx_price_review_snapshot_id ON price_review_snapshot(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_price_review_scanned_at ON price_review_snapshot(scanned_at DESC);
    CREATE INDEX IF NOT EXISTS idx_price_review_pass ON price_review_snapshot(pass_175);

    -- 核价成本缓存（跨快照复用，手填优先）
    CREATE TABLE IF NOT EXISTS price_review_cost_cache (
      sku_id TEXT PRIMARY KEY,
      main_image_hash TEXT,
      cost_1688 REAL,
      cost_manual REAL,
      cost_source TEXT,
      updated_at INTEGER
    );

    -- 选品池：用户从选品广场标记「想上的」商品。
    -- 独立保留商品快照（不随 products 表重抓/清空而丢失），并承接后续「找货源 → 上架」状态流转。
    CREATE TABLE IF NOT EXISTS selection_pool (
      goods_id TEXT PRIMARY KEY,
      sku_id TEXT,
      title_zh TEXT,
      title_en TEXT,
      main_image TEXT,
      product_url TEXT,
      usd_price REAL DEFAULT 0,
      daily_sales INTEGER DEFAULT 0,
      weekly_sales INTEGER DEFAULT 0,
      monthly_sales INTEGER DEFAULT 0,
      usd_gmv REAL DEFAULT 0,
      score REAL DEFAULT 0,
      category_zh TEXT,
      mall_name TEXT,
      mall_mode TEXT,
      status TEXT DEFAULT 'want',          -- want想上 / sourcing找货源中 / sourced已找到货源 / listing上架中 / listed已上架 / dropped弃用
      note TEXT,
      source_keyword TEXT,                 -- 从哪个抓取关键词进入选品池
      added_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_selection_status ON selection_pool(status);
    CREATE INDEX IF NOT EXISTS idx_selection_added ON selection_pool(added_at DESC);

    -- 云启类目树（gettemucategorieslist 抓来），选品广场分类下拉的数据源
    CREATE TABLE IF NOT EXISTS categories (
      cat_id INTEGER PRIMARY KEY,
      cat_name TEXT,
      cat_en_name TEXT,
      cat_level INTEGER,
      parent_cat_id INTEGER,
      is_leaf INTEGER DEFAULT 0,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_cat_id);
  `);
  // 商品类目 ID（catId 数组，JSON 字符串）。已有库幂等加列。
  try { db.exec("ALTER TABLE products ADD COLUMN opt_ids TEXT"); } catch (e) { /* 列已存在 */ }
}

// ============ 核价筛选器 CRUD ============

/**
 * 写入一次扫描快照（完整批次）
 * @param {object} batch - { snapshotId, scannedAt, rows: [...] }
 */
export function savePriceReviewSnapshot(batch) {
  if (!batch || !Array.isArray(batch.rows) || batch.rows.length === 0) {
    return { inserted: 0 };
  }
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO price_review_snapshot (
      snapshot_id, scanned_at, spu_id, sku_id, skc_id, title, main_image, sku_spec,
      original_price, seller_current_price, reference_price,
      price_diff, price_diff_pct, review_status, change_count,
      cost_1688, cost_manual, cost_source, pass_175, detail_url
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);
  let inserted = 0;
  const tx = makeTransaction(db, () => {
    for (const r of batch.rows) {
      if (!r?.skuId) continue;
      insert.run(
        batch.snapshotId,
        batch.scannedAt,
        r.spuId || "",
        r.skuId,
        r.skcId || "",
        r.title || "",
        r.mainImage || "",
        r.skuSpec || "",
        r.originalPrice ?? null,
        r.sellerCurrentPrice ?? null,
        r.referencePrice ?? null,
        r.priceDiff ?? null,
        r.priceDiffPct ?? null,
        r.reviewStatus || "",
        r.changeCount ?? 0,
        r.cost1688 ?? null,
        r.costManual ?? null,
        r.costSource || "pending",
        r.pass175 == null ? null : (r.pass175 ? 1 : 0),
        r.detailUrl || ""
      );
      inserted++;
    }
  });
  tx();
  return { inserted };
}

/**
 * 读取最新一次扫描的全部行（或指定 snapshotId）
 */
export function listPriceReview({ snapshotId = null, onlyFail = false, onlyPass = false, onlyUnknown = false } = {}) {
  const db = getDb();
  let effectiveSnapshotId = snapshotId;
  if (!effectiveSnapshotId) {
    const latest = db.prepare(`
      SELECT snapshot_id FROM price_review_snapshot
      ORDER BY scanned_at DESC LIMIT 1
    `).get();
    effectiveSnapshotId = latest?.snapshot_id || null;
  }
  if (!effectiveSnapshotId) return { snapshotId: null, rows: [], summary: { total: 0, pass: 0, fail: 0, unknown: 0 } };

  const conditions = ["snapshot_id = ?"];
  const values = [effectiveSnapshotId];
  if (onlyFail) { conditions.push("pass_175 = 0"); }
  else if (onlyPass) { conditions.push("pass_175 = 1"); }
  else if (onlyUnknown) { conditions.push("pass_175 IS NULL"); }

  const rows = db.prepare(`
    SELECT * FROM price_review_snapshot
    WHERE ${conditions.join(" AND ")}
    ORDER BY CASE WHEN pass_175 IS NULL THEN 2 ELSE pass_175 END ASC, price_diff_pct DESC
  `).all(...values);

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN pass_175 = 1 THEN 1 ELSE 0 END) as pass,
      SUM(CASE WHEN pass_175 = 0 THEN 1 ELSE 0 END) as fail,
      SUM(CASE WHEN pass_175 IS NULL THEN 1 ELSE 0 END) as unknown
    FROM price_review_snapshot WHERE snapshot_id = ?
  `).get(effectiveSnapshotId);

  return { snapshotId: effectiveSnapshotId, rows, summary };
}

/**
 * 读取最近 N 次扫描的元信息
 */
export function listPriceReviewSnapshots(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT snapshot_id, MAX(scanned_at) AS scanned_at, COUNT(*) AS total,
           SUM(CASE WHEN pass_175 = 1 THEN 1 ELSE 0 END) AS pass,
           SUM(CASE WHEN pass_175 = 0 THEN 1 ELSE 0 END) AS fail,
           SUM(CASE WHEN pass_175 IS NULL THEN 1 ELSE 0 END) AS unknown
    FROM price_review_snapshot
    GROUP BY snapshot_id
    ORDER BY scanned_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * 读取成本缓存（手填优先）
 */
export function getPriceReviewCost(skuId) {
  if (!skuId) return null;
  const db = getDb();
  return db.prepare(`SELECT * FROM price_review_cost_cache WHERE sku_id = ?`).get(skuId) || null;
}

export function upsertPriceReviewCost({ skuId, mainImageHash, cost1688, costManual, costSource }) {
  if (!skuId) return;
  const db = getDb();
  const existing = getPriceReviewCost(skuId);
  const now = Date.now();
  // 手填值永远不被图搜覆盖
  const nextManual = costManual != null ? costManual : (existing?.cost_manual ?? null);
  const next1688 = cost1688 != null ? cost1688 : (existing?.cost_1688 ?? null);
  const nextSource = costSource || existing?.cost_source || "pending";
  db.prepare(`
    INSERT INTO price_review_cost_cache (sku_id, main_image_hash, cost_1688, cost_manual, cost_source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku_id) DO UPDATE SET
      main_image_hash = COALESCE(excluded.main_image_hash, main_image_hash),
      cost_1688 = ?,
      cost_manual = ?,
      cost_source = ?,
      updated_at = ?
  `).run(skuId, mainImageHash || null, next1688, nextManual, nextSource, now,
          next1688, nextManual, nextSource, now);
}

export function setPriceReviewManualCost(skuId, cost) {
  if (!skuId) return;
  const value = cost == null ? null : Number(cost);
  upsertPriceReviewCost({
    skuId,
    costManual: value,
    costSource: value != null ? "manual" : "pending",
  });
}

export function clearPriceReviewManualCost(skuId) {
  if (!skuId) return;
  const db = getDb();
  const existing = getPriceReviewCost(skuId);
  if (!existing) return;
  db.prepare(`
    UPDATE price_review_cost_cache
    SET cost_manual = NULL,
        cost_source = CASE WHEN cost_1688 IS NOT NULL THEN '1688_image_search' ELSE 'pending' END,
        updated_at = ?
    WHERE sku_id = ?
  `).run(Date.now(), skuId);
}

/**
 * 从 Excel 行数据导入（xlsx 解析后的二维数组）
 */
export function importFromRows(rows, fileName = "unknown") {
  const db = getDb();
  const batchId = `batch_${Date.now()}`;
  const header = rows[1]; // 第2行是表头
  if (!header) throw new Error("无法读取表头");

  const insert = db.prepare(`
    INSERT OR REPLACE INTO products (
      goods_id, title_zh, title_en, main_image, carousel_images, video_url, product_url,
      usd_price, eur_price, daily_sales, weekly_sales, monthly_sales, total_sales,
      usd_gmv, eur_gmv, score, total_comments,
      category_en, category_zh, backend_category, labels,
      mall_id, mall_name, mall_mode, mall_logo, mall_product_count, mall_total_sales, mall_score, mall_fans,
      listed_at, recorded_at, import_batch, opt_ids
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  let imported = 0;
  let skipped = 0;

  const tx = makeTransaction(db, () => {
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[10]) { skipped++; continue; } // 跳过没有商品ID的行

      try {
        insert.run(
          String(r[10] || ""),           // goods_id
          r[11] || "",                    // title_zh
          r[12] || "",                    // title_en
          r[13] || "",                    // main_image
          r[14] || "",                    // carousel_images
          r[15] || "",                    // video_url
          r[16] || "",                    // product_url
          parseFloat(r[21]) || 0,         // usd_price
          parseFloat(r[22]) || 0,         // eur_price
          parseInt(r[26]) || 0,           // daily_sales
          parseInt(r[27]) || 0,           // weekly_sales
          parseInt(r[28]) || 0,           // monthly_sales
          parseInt(r[25]) || 0,           // total_sales
          parseFloat(r[23]) || 0,         // usd_gmv
          parseFloat(r[24]) || 0,         // eur_gmv
          parseFloat(r[29]) || 0,         // score
          parseInt(r[30]) || 0,           // total_comments
          r[17] || "",                    // category_en
          r[18] || "",                    // category_zh
          r[19] || "",                    // backend_category
          r[20] || "",                    // labels
          String(r[0] || ""),             // mall_id
          r[1] || "",                     // mall_name
          r[2] || "",                     // mall_mode
          r[3] || "",                     // mall_logo
          parseInt(r[4]) || 0,            // mall_product_count
          parseInt(r[5]) || 0,            // mall_total_sales
          parseFloat(r[6]) || 0,          // mall_score
          parseInt(r[7]) || 0,            // mall_fans
          r[8] || "",                     // listed_at
          r[9] ? String(r[9]) : "",       // recorded_at
          batchId,                        // import_batch
          "[]"                            // opt_ids（Excel 导入无类目）
        );
        imported++;
      } catch (e) {
        skipped++;
      }
    }

    // 记录导入历史
    db.prepare(`
      INSERT INTO import_history (batch_id, file_name, total_rows, imported_rows, skipped_rows)
      VALUES (?, ?, ?, ?, ?)
    `).run(batchId, fileName, rows.length - 2, imported, skipped);
  });

  tx();

  return { batchId, imported, skipped, total: rows.length - 2 };
}

/**
 * 搜索商品
 */
export function searchProducts(params = {}) {
  const db = getDb();
  const {
    keyword = "",
    mallName = "",
    mallMode = "",
    category = "",
    optId = "",
    minPrice = null,
    maxPrice = null,
    minDailySales = null,
    sortBy = "daily_sales",
    sortOrder = "DESC",
    page = 1,
    pageSize = 50,
  } = params;

  const conditions = [];
  const values = [];

  if (keyword) {
    conditions.push("(title_zh LIKE ? OR title_en LIKE ?)");
    values.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (mallName) {
    conditions.push("mall_name LIKE ?");
    values.push(`%${mallName}%`);
  }
  if (mallMode) {
    conditions.push("mall_mode = ?");
    values.push(mallMode);
  }
  if (category) {
    conditions.push("(category_zh LIKE ? OR category_en LIKE ? OR backend_category LIKE ?)");
    values.push(`%${category}%`, `%${category}%`, `%${category}%`);
  }
  if (optId) {
    // 商品 opt_ids 存为 JSON 字符串如 ["580","1099","2708"]，按 opt_id（带引号防 580 误匹配 5801）筛
    conditions.push("opt_ids LIKE ?");
    values.push(`%"${optId}"%`);
  }
  if (minPrice != null) {
    conditions.push("usd_price >= ?");
    values.push(minPrice);
  }
  if (maxPrice != null) {
    conditions.push("usd_price <= ?");
    values.push(maxPrice);
  }
  if (minDailySales != null) {
    conditions.push("daily_sales >= ?");
    values.push(minDailySales);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const allowedSorts = ["daily_sales", "weekly_sales", "monthly_sales", "total_sales", "usd_price", "usd_gmv", "score", "total_comments", "listed_at"];
  const sort = allowedSorts.includes(sortBy) ? sortBy : "daily_sales";
  const order = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const offset = (page - 1) * pageSize;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM products ${where}`).get(...values);
  const items = db.prepare(`SELECT * FROM products ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`).all(...values, pageSize, offset);

  return {
    items,
    total: countRow.total,
    page,
    pageSize,
    totalPages: Math.ceil(countRow.total / pageSize),
  };
}

/**
 * 统计概览
 */
export function getStats() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as totalProducts,
      COUNT(DISTINCT mall_id) as totalMalls,
      ROUND(AVG(usd_price), 2) as avgPrice,
      ROUND(MIN(usd_price), 2) as minPrice,
      ROUND(MAX(usd_price), 2) as maxPrice,
      SUM(daily_sales) as totalDailySales,
      SUM(weekly_sales) as totalWeeklySales,
      SUM(monthly_sales) as totalMonthlySales,
      SUM(total_sales) as totalSales,
      ROUND(SUM(usd_gmv), 2) as totalGmv,
      ROUND(AVG(score), 2) as avgScore,
      SUM(total_comments) as totalComments,
      SUM(CASE WHEN video_url != '' AND video_url IS NOT NULL THEN 1 ELSE 0 END) as withVideo
    FROM products
  `).get();

  // 分类统计 TOP 10
  const categories = db.prepare(`
    SELECT category_zh, COUNT(*) as count, ROUND(AVG(usd_price), 2) as avgPrice,
           SUM(daily_sales) as totalDailySales
    FROM products WHERE category_zh != ''
    GROUP BY category_zh ORDER BY count DESC LIMIT 10
  `).all();

  // 托管模式分布
  const modeDistribution = db.prepare(`
    SELECT mall_mode, COUNT(*) as count FROM products GROUP BY mall_mode
  `).all();

  // 导入历史
  const importHistory = db.prepare(`
    SELECT * FROM import_history ORDER BY imported_at DESC LIMIT 10
  `).all();

  return { ...stats, categories, modeDistribution, importHistory };
}

/**
 * 获取 TOP 商品
 */
export function getTopProducts(field = "daily_sales", limit = 20) {
  const db = getDb();
  const allowedFields = ["daily_sales", "weekly_sales", "monthly_sales", "total_sales", "usd_gmv", "score", "usd_price"];
  const f = allowedFields.includes(field) ? field : "daily_sales";
  return db.prepare(`SELECT * FROM products ORDER BY ${f} DESC LIMIT ?`).all(limit);
}

/**
 * 获取数据库路径
 */
export function getDbPath() {
  return DB_PATH;
}

/**
 * 获取数据库总行数
 */
export function getRowCount() {
  const db = getDb();
  return db.prepare("SELECT COUNT(*) as count FROM products").get().count;
}

/**
 * 从云启 API 返回的商品对象数组直接导入数据库
 * @param {Array} items - 云启 API 返回的商品对象列表
 * @param {string} sourceName - 导入来源标识（如关键词）
 */
export function importFromApiItems(items, sourceName = "api-sync") {
  if (!Array.isArray(items) || items.length === 0) return { batchId: null, imported: 0, skipped: 0, total: 0 };
  const db = getDb();
  const batchId = `api_${Date.now()}`;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO products (
      goods_id, title_zh, title_en, main_image, carousel_images, video_url, product_url,
      usd_price, eur_price, daily_sales, weekly_sales, monthly_sales, total_sales,
      usd_gmv, eur_gmv, score, total_comments,
      category_en, category_zh, backend_category, labels,
      mall_id, mall_name, mall_mode, mall_logo, mall_product_count, mall_total_sales, mall_score, mall_fans,
      listed_at, recorded_at, import_batch, opt_ids
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  let imported = 0;
  let skipped = 0;

  const str = (v) => String(v || "").trim();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const firstStr = (...vals) => { for (const v of vals) { const s = str(v); if (s) return s; } return ""; };
  const firstNum = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n)) return n; } return 0; };

  const tx = makeTransaction(db, () => {
    for (const row of items) {
      if (!row) { skipped++; continue; }
      const goodsId = firstStr(row.goods_id, row.goodsId, row.id);
      if (!goodsId) { skipped++; continue; }
      const mall = row.mall || {};
      const imageUrls = Array.isArray(row.image_urls) ? row.image_urls : Array.isArray(row.imageUrls) ? row.imageUrls : [];
      try {
        insert.run(
          goodsId,
          firstStr(row.title_zh, row.titleZh, row.title, row.productName),
          firstStr(row.title_en, row.titleEn),
          firstStr(row.thumb_url, row.thumbUrl, row.image, row.main_image, imageUrls[0]),
          imageUrls.filter(Boolean).join(","),
          firstStr(row.video_url, row.videoUrl),
          firstStr(row.product_url, row.productUrl) || `https://www.temu.com/goods.html?goods_id=${goodsId}`,
          firstNum(row.usd_price, row.usdPrice, row.price),
          firstNum(row.eur_price, row.eurPrice),
          firstNum(row.daily_sales, row.dailySales),
          firstNum(row.weekly_sales, row.weeklySales),
          firstNum(row.monthly_sales, row.monthlySales),
          firstNum(row.sales, row.total_sales, row.totalSales),
          firstNum(row.usd_gmv, row.usdGmv),
          firstNum(row.eur_gmv, row.eurGmv),
          firstNum(row.score, row.rating),
          firstNum(row.total_comment_num_tips, row.comment_num_tips, row.reviewCount),
          firstStr(row.category_en),
          firstStr(row.category_zh, row.categoryName, row.category),
          firstStr(row.backend_category),
          Array.isArray(row.labels) ? row.labels.join(",") : str(row.labels),
          firstStr(row.mall_id, row.mallId, mall.id),
          firstStr(row.mall_name, row.mallName, mall.name),
          firstStr(row.mall_mode, row.wareHouseType != null ? String(row.wareHouseType) : "", mall.mode),
          firstStr(mall.logo, row.mall_logo),
          firstNum(row.mall_product_count, mall.total_goods, mall.total_show_goods),
          firstNum(row.mall_total_sales, mall.total_sales),
          firstNum(row.mall_score, mall.score),
          firstNum(row.mall_fans, mall.fans),
          firstStr(row.created_at, row.createdAt, row.listed_at, row.issued_date),
          new Date().toISOString(),
          batchId,
          JSON.stringify(Array.isArray(row.opt_ids) ? row.opt_ids : (row.opt_id != null ? [row.opt_id] : []))
        );
        imported++;
      } catch { skipped++; }
    }

    db.prepare(`
      INSERT INTO import_history (batch_id, file_name, total_rows, imported_rows, skipped_rows)
      VALUES (?, ?, ?, ?, ?)
    `).run(batchId, `[API] ${sourceName}`, items.length, imported, skipped);
  });

  tx();
  return { batchId, imported, skipped, total: items.length };
}

// ============ 云启 opt_id 类目树 ============

/**
 * 保存云启 opt_id 类目树（从选品页 cascader 读出的扁平数组）。
 * 复用 categories 表，字段语义改为 opt_id 体系：
 *   cat_id = opt_id（如 580=汽车用品）, cat_name = 中文名, cat_level = 层级(1一级/2二级), parent_cat_id = 父 opt_id
 * 商品的 opt_ids 字段（如 ["580","1099","2708"]）与此 opt_id 同体系，前端选类目后按 opt_id 筛商品。
 * @param {Array} rows - [{ id, name, enName?, parentId, level }]
 */
export function saveCategories(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { saved: 0 };
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO categories (cat_id, cat_name, cat_en_name, cat_level, parent_cat_id, is_leaf, updated_at)
    VALUES (@cat_id, @cat_name, @cat_en_name, @cat_level, @parent_cat_id, @is_leaf, @updated_at)
  `);
  let saved = 0;
  const tx = makeTransaction(db, () => {
    db.exec("DELETE FROM categories"); // 全量刷新整棵树
    for (const c of rows) {
      const optId = Number(c?.id ?? c?.optId);
      if (!Number.isFinite(optId)) continue;
      const parentId = Number(c?.parentId ?? c?.parent_opt_id) || 0;
      const level = Number(c?.level) || (parentId ? 2 : 1);
      insert.run({
        cat_id: optId,
        cat_name: String(c.name || c.showName || ""),
        cat_en_name: String(c.enName || ""),
        cat_level: level,
        parent_cat_id: parentId,
        is_leaf: level >= 2 ? 1 : 0,
        updated_at: now,
      });
      saved += 1;
    }
  });
  tx();
  return { saved };
}

/** 读取全部类目（前端构建分类树） */
export function listCategories() {
  return getDb().prepare("SELECT cat_id, cat_name, cat_en_name, cat_level, parent_cat_id, is_leaf FROM categories ORDER BY cat_level, cat_id").all();
}

// ============ 选品池 CRUD ============

export const SELECTION_STATUSES = ["want", "sourcing", "sourced", "listing", "listed", "dropped"];

/**
 * 加入选品池：存商品快照。
 * 已存在则刷新快照（价格/销量等），但保留用户的 status 与 note 不被覆盖。
 */
export function addSelection(item = {}) {
  const goodsId = String(item?.goods_id || item?.goodsId || "").trim();
  if (!goodsId) return { ok: false, reason: "缺少 goods_id" };
  const db = getDb();
  const now = new Date().toISOString();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  db.prepare(`
    INSERT INTO selection_pool (
      goods_id, sku_id, title_zh, title_en, main_image, product_url,
      usd_price, daily_sales, weekly_sales, monthly_sales, usd_gmv, score,
      category_zh, mall_name, mall_mode, status, note, source_keyword, added_at, updated_at
    ) VALUES (
      @goods_id, @sku_id, @title_zh, @title_en, @main_image, @product_url,
      @usd_price, @daily_sales, @weekly_sales, @monthly_sales, @usd_gmv, @score,
      @category_zh, @mall_name, @mall_mode, @status, @note, @source_keyword, @added_at, @updated_at
    )
    ON CONFLICT(goods_id) DO UPDATE SET
      sku_id = excluded.sku_id, title_zh = excluded.title_zh, title_en = excluded.title_en,
      main_image = excluded.main_image, product_url = excluded.product_url,
      usd_price = excluded.usd_price, daily_sales = excluded.daily_sales,
      weekly_sales = excluded.weekly_sales, monthly_sales = excluded.monthly_sales,
      usd_gmv = excluded.usd_gmv, score = excluded.score,
      category_zh = excluded.category_zh, mall_name = excluded.mall_name, mall_mode = excluded.mall_mode,
      updated_at = excluded.updated_at
  `).run({
    goods_id: goodsId,
    sku_id: String(item.sku_id || ""),
    title_zh: String(item.title_zh || ""),
    title_en: String(item.title_en || ""),
    main_image: String(item.main_image || ""),
    product_url: String(item.product_url || `https://www.temu.com/goods.html?goods_id=${goodsId}`),
    usd_price: num(item.usd_price),
    daily_sales: num(item.daily_sales),
    weekly_sales: num(item.weekly_sales),
    monthly_sales: num(item.monthly_sales),
    usd_gmv: num(item.usd_gmv),
    score: num(item.score),
    category_zh: String(item.category_zh || ""),
    mall_name: String(item.mall_name || ""),
    mall_mode: String(item.mall_mode || ""),
    status: SELECTION_STATUSES.includes(item.status) ? item.status : "want",
    note: String(item.note || ""),
    source_keyword: String(item.source_keyword || ""),
    added_at: now,
    updated_at: now,
  });
  return { ok: true, goodsId };
}

/** 移出选品池 */
export function removeSelection(goodsId) {
  const id = String(goodsId || "").trim();
  if (!id) return { ok: false };
  const db = getDb();
  const r = db.prepare(`DELETE FROM selection_pool WHERE goods_id = ?`).run(id);
  return { ok: true, removed: r.changes };
}

/** 更新选品池条目的状态 / 备注 */
export function updateSelection(goodsId, { status, note } = {}) {
  const id = String(goodsId || "").trim();
  if (!id) return { ok: false };
  const db = getDb();
  const sets = [];
  const params = { goods_id: id, updated_at: new Date().toISOString() };
  if (status != null && SELECTION_STATUSES.includes(status)) { sets.push("status = @status"); params.status = status; }
  if (note != null) { sets.push("note = @note"); params.note = String(note); }
  if (sets.length === 0) return { ok: false, reason: "无可更新字段" };
  sets.push("updated_at = @updated_at");
  const r = db.prepare(`UPDATE selection_pool SET ${sets.join(", ")} WHERE goods_id = @goods_id`).run(params);
  return { ok: true, changed: r.changes };
}

/** 列出选品池（可按状态过滤），附各状态计数 */
export function listSelection({ status = "" } = {}) {
  const db = getDb();
  const rows = (status && SELECTION_STATUSES.includes(status))
    ? db.prepare(`SELECT * FROM selection_pool WHERE status = ? ORDER BY added_at DESC`).all(status)
    : db.prepare(`SELECT * FROM selection_pool ORDER BY added_at DESC`).all();
  const summary = { total: db.prepare(`SELECT COUNT(*) AS c FROM selection_pool`).get().c };
  for (const s of SELECTION_STATUSES) summary[s] = 0;
  for (const row of db.prepare(`SELECT status, COUNT(*) AS c FROM selection_pool GROUP BY status`).all()) {
    if (row.status) summary[row.status] = row.c;
  }
  return { rows, summary };
}

/** 返回已在选品池中的 goods_id 列表（前端给商品墙打「已加入」标记用） */
export function listSelectionIds() {
  const db = getDb();
  return db.prepare(`SELECT goods_id FROM selection_pool`).all().map((r) => String(r.goods_id));
}

/**
 * 选品→上品桥：把选品池商品导出为 autoPricingFromCSV 能吃的格式，
 * 直接在内存中生成行数据（不写临时 CSV），由 worker 侧调用 autoPricing。
 * 同时把选品池 status 标记为 listing。
 */
export function exportSelectionForAutoPricing(goodsIds = []) {
  if (!goodsIds.length) return { ok: false, reason: "无选中商品" };
  const db = getDb();
  const ph = goodsIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT sp.goods_id, sp.title_zh, sp.title_en, sp.main_image, sp.usd_price, sp.category_zh,
           p.carousel_images, p.backend_category, p.product_url
      FROM selection_pool sp
      LEFT JOIN products p ON p.goods_id = sp.goods_id
     WHERE sp.goods_id IN (${ph}) AND sp.status IN ('want', 'sourced', 'listing')
  `).all(...goodsIds);
  if (!rows.length) return { ok: false, reason: "没有可上品的商品(需 want/sourced 状态)" };

  const csvRows = rows.map(r => ({
    "商品标题（中文）": r.title_zh || "",
    "商品标题（英文）": r.title_en || "",
    "商品主图": r.main_image || "",
    "商品轮播图": r.carousel_images || "",
    "美元价格($)": r.usd_price || 0,
    "分类（中文）": r.category_zh || "",
    "后台分类": r.backend_category || r.category_zh || "",
    "goods_id": r.goods_id,
    "product_url": r.product_url || "",
  }));

  const now = new Date().toISOString();
  const update = db.prepare("UPDATE selection_pool SET status = 'listing', updated_at = ? WHERE goods_id = ?");
  const tx = db.transaction(() => {
    for (const r of rows) update.run(now, r.goods_id);
  });
  tx();

  return { ok: true, count: csvRows.length, csvRows, goodsIds: rows.map(r => r.goods_id) };
}
