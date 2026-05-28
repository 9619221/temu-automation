// 从 cloud sqlite (ATTACH 为 cloud) 把 temu_sales_snapshot 增量同步进本地 ERP
// erp_temu_sales_sku / erp_temu_sales_shop。
//
// 替代原 temuSalesBridge.cjs（聚水潭 CbReportApi 路径）。
// 数据源切换后下列字段不再有数据（cloud TEMU API 不提供），保留为默认值 0/NULL：
//   - sales_amount / today_sales_amount（销售金额）
//   - expected_income（预估收入）
//   - quality_score_lt60/60_70/70_90/90_100（质量分分布）
//   - local_stock / purchase_stock（聚水潭本地 WMS 数据）
//   - add_cart_7d / add_cart_total（加购）
// erp_temu_price_log 不再写入新行（cloud 无价格变更日志）。

const crypto = require("crypto");

const DEFAULT_COMPANY_ID = "company_default";
const ROBOT_KEY = "temu_sales_robot";

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, parts) {
  const text = parts.map((p) => String(p ?? "")).join("|");
  const hash = crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 20);
  return `${prefix}_${hash}`;
}

function ensureCloudAttached(db, attachFn) {
  if (typeof attachFn !== "function") return false;
  return attachFn(db) === true;
}

// ERP updated_at 是 ISO 毫秒精度，cloud last_updated_at 是 SQLite datetime 秒精度。
// 减 1 秒兜底同秒边界（upsert 幂等）。
function normalizeCursor(value) {
  if (!value) return "1970-01-01 00:00:00";
  const text = String(value);
  const sqliteFmt = text.includes("T") ? text.replace("T", " ").replace(/\.\d+Z?$/, "") : text;
  const ms = Date.parse(sqliteFmt.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return sqliteFmt;
  return new Date(ms - 1000).toISOString().replace("T", " ").replace(/\.\d+Z?$/, "");
}

function getSkuCursor(db, companyId) {
  const row = db.prepare(`
    SELECT MAX(updated_at) AS cursor FROM erp_temu_sales_sku WHERE company_id = ?
  `).get(companyId);
  return normalizeCursor(row?.cursor);
}

function syncSku(db, { companyId, since, now, limit }) {
  const rows = db.prepare(`
    SELECT mall_supplier_id, skc_id, product_id, title, category_name,
           sku_ext_code, today_sales, warehouse_stock,
           declared_price_cents, price_currency, stat_date, last_updated_at
    FROM cloud.temu_sales_snapshot
    WHERE last_updated_at > @since
      AND mall_supplier_id IS NOT NULL AND mall_supplier_id <> ''
      AND skc_id IS NOT NULL AND skc_id <> ''
    ORDER BY last_updated_at ASC
    LIMIT @limit
  `).all({ since, limit });
  if (!rows.length) return { upserted: 0, skipped: 0, latestCursor: since, shopAgg: new Map() };
  const upsert = db.prepare(`
    INSERT INTO erp_temu_sales_sku (
      id, company_id, platform_shop_id, shop_name,
      sys_product_code, sys_style_code, product_name, product_category,
      local_stock, purchase_stock, platform_stock,
      quality_score_lt60, quality_score_60_70, quality_score_70_90, quality_score_90_100,
      sales_qty, sales_amount, currency, expected_income, declared_price,
      add_cart_7d, add_cart_total,
      stat_date_start, stat_date_end, raw_json, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @platform_shop_id, NULL,
      @sys_product_code, @sys_style_code, @product_name, @product_category,
      0, 0, @platform_stock,
      0, 0, 0, 0,
      @sales_qty, 0, @currency, 0, @declared_price,
      0, 0,
      @stat_date_start, @stat_date_end, @raw_json, @now, @now
    )
    ON CONFLICT(company_id, platform_shop_id, sys_product_code, stat_date_start, stat_date_end)
    DO UPDATE SET
      sys_style_code = excluded.sys_style_code,
      product_name = excluded.product_name,
      product_category = excluded.product_category,
      platform_stock = excluded.platform_stock,
      sales_qty = excluded.sales_qty,
      currency = excluded.currency,
      declared_price = excluded.declared_price,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  let upserted = 0;
  let skipped = 0;
  let latestCursor = since;
  const shopAgg = new Map();
  for (const row of rows) {
    if (!row.mall_supplier_id || !row.skc_id) { skipped += 1; continue; }
    const statDate = row.stat_date || String(row.last_updated_at || now).slice(0, 10);
    const declaredPrice = row.declared_price_cents == null
      ? null
      : Number(row.declared_price_cents) / 100;
    const todaySales = Number.isFinite(Number(row.today_sales)) ? Number(row.today_sales) : 0;
    upsert.run({
      id: stableId("temu_sales_sku", [companyId, row.mall_supplier_id, row.skc_id, statDate]),
      company_id: companyId,
      platform_shop_id: String(row.mall_supplier_id),
      sys_product_code: String(row.skc_id),
      sys_style_code: row.product_id || null,
      product_name: row.title || null,
      product_category: row.category_name || null,
      platform_stock: Number.isFinite(Number(row.warehouse_stock)) ? Number(row.warehouse_stock) : 0,
      sales_qty: todaySales,
      currency: row.price_currency || null,
      declared_price: declaredPrice,
      stat_date_start: statDate,
      stat_date_end: statDate,
      raw_json: JSON.stringify({
        skc_id: row.skc_id,
        sku_ext_code: row.sku_ext_code || null,
        cloud_last_updated_at: row.last_updated_at || null,
      }),
      now,
    });
    upserted += 1;
    if (row.last_updated_at && row.last_updated_at > latestCursor) latestCursor = row.last_updated_at;
    const aggKey = `${row.mall_supplier_id}|${statDate}`;
    const agg = shopAgg.get(aggKey) || {
      mall_supplier_id: row.mall_supplier_id,
      stat_date: statDate,
      sales_qty_sum: 0,
      currency: row.price_currency || null,
    };
    agg.sales_qty_sum += todaySales;
    if (!agg.currency && row.price_currency) agg.currency = row.price_currency;
    shopAgg.set(aggKey, agg);
  }
  return { upserted, skipped, latestCursor, shopAgg };
}

function syncShop(db, { companyId, shopAgg, now }) {
  if (!shopAgg || !shopAgg.size) return { upserted: 0 };
  const upsert = db.prepare(`
    INSERT INTO erp_temu_sales_shop (
      id, company_id, platform_shop_id, shop_name, erp_shop_id, currency, stat_date,
      quality_score_lt60, quality_score_60_70, quality_score_70_90, quality_score_90_100,
      today_sales_qty, today_sales_amount, raw_json, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @platform_shop_id, NULL, NULL, @currency, @stat_date,
      0, 0, 0, 0,
      @today_sales_qty, 0, @raw_json, @now, @now
    )
    ON CONFLICT(company_id, platform_shop_id, stat_date) DO UPDATE SET
      currency = excluded.currency,
      today_sales_qty = excluded.today_sales_qty,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  let upserted = 0;
  for (const agg of shopAgg.values()) {
    upsert.run({
      id: stableId("temu_sales_shop", [companyId, agg.mall_supplier_id, agg.stat_date]),
      company_id: companyId,
      platform_shop_id: String(agg.mall_supplier_id),
      currency: agg.currency || null,
      stat_date: agg.stat_date,
      today_sales_qty: agg.sales_qty_sum,
      raw_json: JSON.stringify({ source: "cloud_temu_sales_snapshot", batch_ts: now }),
      now,
    });
    upserted += 1;
  }
  return { upserted };
}

class TemuCloudSalesSync {
  constructor({ db, attachCloudDb }) {
    if (!db) throw new Error("TemuCloudSalesSync requires db");
    this.db = db;
    this.attachCloudDb = attachCloudDb;
  }

  sync(payload = {}) {
    const companyId = String(payload.companyId || payload.company_id || DEFAULT_COMPANY_ID);
    const limit = Math.min(20000, Math.max(1, Number(payload.limit) || 5000));
    if (!ensureCloudAttached(this.db, this.attachCloudDb)) {
      throw new Error("cloud 数据库未挂载（本地 dev 或服务器未配置 cloud sqlite）");
    }
    const now = nowIso();
    const runId = stableId("temu_sales_run", [companyId, now]);
    this.db.prepare(`
      INSERT INTO erp_temu_robot_sync_runs (
        id, company_id, robot_key, shop_count, sku_count, price_log_count,
        jit_count, vmi_count, status, error, started_at, finished_at
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'running', NULL, ?, NULL)
    `).run(runId, companyId, ROBOT_KEY, now);

    try {
      const since = payload.since || getSkuCursor(this.db, companyId);
      const stats = this.db.transaction(() => {
        const skuStats = syncSku(this.db, { companyId, since, now, limit });
        const shopStats = syncShop(this.db, { companyId, shopAgg: skuStats.shopAgg, now });
        return { skuStats, shopStats };
      })();
      const finishedAt = nowIso();
      this.db.prepare(`
        UPDATE erp_temu_robot_sync_runs
        SET shop_count = ?, sku_count = ?, price_log_count = 0,
            status = 'success', error = NULL, finished_at = ?
        WHERE id = ?
      `).run(stats.shopStats.upserted, stats.skuStats.upserted, finishedAt, runId);
      return {
        runId,
        companyId,
        shopCount: stats.shopStats.upserted,
        skuCount: stats.skuStats.upserted,
        skuSkipped: stats.skuStats.skipped,
        skuCursor: stats.skuStats.latestCursor,
        startedAt: now,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = nowIso();
      try {
        this.db.prepare(`
          UPDATE erp_temu_robot_sync_runs
          SET status = 'failed', error = ?, finished_at = ?
          WHERE id = ?
        `).run(String(error?.message || error).slice(0, 2000), finishedAt, runId);
      } catch {}
      throw error;
    }
  }
}

module.exports = {
  TemuCloudSalesSync,
  DEFAULT_COMPANY_ID,
  ROBOT_KEY,
};
