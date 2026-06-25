const fs = require("fs");
const crypto = require("crypto");
const { createId, nowIso } = require("./utils.cjs");
const { execute, withTransaction} = require("../../db/connection.cjs");

const DEFAULT_COMPANY_ID = "company_default";
const DEFAULT_PLATFORM_SHOP_ID = "unknown";
const ROBOT_KEY = "temu_sales_robot";

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const number = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  return toNumber(value) ?? 0;
}

function stringify(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch (error) {
    return JSON.stringify({ stringifyError: error?.message || String(error) });
  }
}

function hashText(value, length = 20) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex").slice(0, length);
}

function stableId(prefix, parts) {
  const text = Array.isArray(parts) ? parts.join(":") : String(parts ?? "");
  return `${prefix}_${hashText(text)}`;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDate(value) {
  const text = optionalString(value);
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDate(parsed);
}

function getStatDate(payload, salesData) {
  return normalizeDate(payload.statDate || payload.stat_date) ||
  normalizeDate(salesData?.syncedAt || salesData?.synced_at) ||
  formatLocalDate(new Date());
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isSalesDataShape(value) {
  return isObject(value) && (
  Object.prototype.hasOwnProperty.call(value, "items") ||
  Object.prototype.hasOwnProperty.call(value, "summary") ||
  Object.prototype.hasOwnProperty.call(value, "syncedAt"));

}

function unwrapSalesData(value) {
  if (!isObject(value)) return {};
  if (isSalesDataShape(value)) return value;
  if (isSalesDataShape(value.temu_sales)) return value.temu_sales;
  const scopedKey = Object.keys(value).find((key) => key === "temu_sales" || key.endsWith(":temu_sales"));
  return scopedKey && isSalesDataShape(value[scopedKey]) ? value[scopedKey] : value;
}

function readSalesJson(filePath) {
  const raw = fs.readFileSync(String(filePath), "utf8");
  return unwrapSalesData(JSON.parse(raw));
}

function addError(stats, message) {
  stats.skippedCount += 1;
  if (stats.errors.length < 20) stats.errors.push(String(message || "").slice(0, 300));
}

function errorRemark(stats) {
  if (!stats.skippedCount) return null;
  return `skipped_rows=${stats.skippedCount}; ${stats.errors.join("; ")}`.slice(0, 2000);
}

class TemuSalesBridge {
  constructor({ db }) {
    if (!db) throw new Error("TemuSalesBridge requires db");
    this.db = db;
    this.prepareSqlStrings();
  }

  prepareSqlStrings() {
    this.upsertShopSql = `
      INSERT INTO erp_temu_sales_shop (
        id, company_id, platform_shop_id, shop_name, erp_shop_id, currency,
        stat_date, quality_score_lt60, quality_score_60_70,
        quality_score_70_90, quality_score_90_100, today_sales_qty,
        today_sales_amount, raw_json, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @platform_shop_id, @shop_name, @erp_shop_id, @currency,
        @stat_date, @quality_score_lt60, @quality_score_60_70,
        @quality_score_70_90, @quality_score_90_100, @today_sales_qty,
        @today_sales_amount, @raw_json, @created_at, @updated_at
      )
      ON CONFLICT(company_id, platform_shop_id, stat_date) DO UPDATE SET
        shop_name = excluded.shop_name,
        erp_shop_id = COALESCE(excluded.erp_shop_id, erp_temu_sales_shop.erp_shop_id),
        currency = excluded.currency,
        quality_score_lt60 = excluded.quality_score_lt60,
        quality_score_60_70 = excluded.quality_score_60_70,
        quality_score_70_90 = excluded.quality_score_70_90,
        quality_score_90_100 = excluded.quality_score_90_100,
        today_sales_qty = excluded.today_sales_qty,
        today_sales_amount = excluded.today_sales_amount,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `;
    this.upsertSkuSql = `
      INSERT INTO erp_temu_sales_sku (
        id, company_id, platform_shop_id, shop_name, sys_product_code,
        sys_style_code, product_name, product_category, local_stock,
        purchase_stock, platform_stock, quality_score_lt60,
        quality_score_60_70, quality_score_70_90, quality_score_90_100,
        sales_qty, sales_amount, currency, expected_income, declared_price,
        add_cart_7d, add_cart_total, stat_date_start, stat_date_end,
        raw_json, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @platform_shop_id, @shop_name, @sys_product_code,
        @sys_style_code, @product_name, @product_category, @local_stock,
        @purchase_stock, @platform_stock, @quality_score_lt60,
        @quality_score_60_70, @quality_score_70_90, @quality_score_90_100,
        @sales_qty, @sales_amount, @currency, @expected_income, @declared_price,
        @add_cart_7d, @add_cart_total, @stat_date_start, @stat_date_end,
        @raw_json, @created_at, @updated_at
      )
      ON CONFLICT(company_id, platform_shop_id, sys_product_code, stat_date_start, stat_date_end)
      DO UPDATE SET
        shop_name = excluded.shop_name,
        sys_style_code = excluded.sys_style_code,
        product_name = excluded.product_name,
        product_category = excluded.product_category,
        local_stock = excluded.local_stock,
        purchase_stock = excluded.purchase_stock,
        platform_stock = excluded.platform_stock,
        quality_score_lt60 = excluded.quality_score_lt60,
        quality_score_60_70 = excluded.quality_score_60_70,
        quality_score_70_90 = excluded.quality_score_70_90,
        quality_score_90_100 = excluded.quality_score_90_100,
        sales_qty = excluded.sales_qty,
        sales_amount = excluded.sales_amount,
        currency = excluded.currency,
        expected_income = excluded.expected_income,
        declared_price = excluded.declared_price,
        add_cart_7d = excluded.add_cart_7d,
        add_cart_total = excluded.add_cart_total,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `;
    this.insertRunSql = `
      INSERT INTO erp_temu_robot_sync_runs (
        id, company_id, robot_key, shop_count, sku_count, price_log_count,
        status, error, started_at, finished_at
      )
      VALUES (
        @id, @company_id, @robot_key, 0, 0, 0,
        'running', NULL, @started_at, NULL
      )
    `;
    this.updateRunSql = `
      UPDATE erp_temu_robot_sync_runs
      SET shop_count = @shop_count,
          sku_count = @sku_count,
          price_log_count = @price_log_count,
          status = @status,
          error = @error,
          finished_at = @finished_at
      WHERE id = @id
    `;
  }

  resolveSalesData(payload) {
    if (payload.salesData !== undefined) return unwrapSalesData(payload.salesData);
    if (payload.salesJsonPath) return readSalesJson(payload.salesJsonPath);
    throw new Error("TemuSalesBridge requires salesData or salesJsonPath");
  }

  buildShopRow({ companyId, platformShopId, shopName, statDate, summary, now }) {
    return {
      id: stableId("temu_sales_shop", [companyId, platformShopId, statDate]),
      company_id: companyId,
      platform_shop_id: platformShopId,
      shop_name: shopName || null,
      erp_shop_id: null,
      currency: null,
      stat_date: statDate,
      quality_score_lt60: 0,
      quality_score_60_70: 0,
      quality_score_70_90: 0,
      quality_score_90_100: 0,
      today_sales_qty: 0,
      today_sales_amount: 0,
      raw_json: stringify(summary),
      created_at: now,
      updated_at: now
    };
  }

  buildSkuRow({ companyId, platformShopId, shopName, statDate, item, now }) {
    if (!isObject(item)) return null;
    const skuCode = optionalString(item.skuCode) || optionalString(item.skcId);
    if (!skuCode) return null;
    return {
      id: stableId("temu_sales_sku", [companyId, platformShopId, skuCode, statDate, statDate]),
      company_id: companyId,
      platform_shop_id: platformShopId,
      shop_name: shopName || null,
      sys_product_code: skuCode,
      sys_style_code: optionalString(item.skcId) || null,
      product_name: optionalString(item.title) || null,
      product_category: optionalString(item.category) || null,
      local_stock: numberOrZero(item.warehouseStock),
      purchase_stock: numberOrZero(item.adviceQuantity),
      platform_stock: numberOrZero(item.occupyStock),
      quality_score_lt60: 0,
      quality_score_60_70: 0,
      quality_score_70_90: 0,
      quality_score_90_100: 0,
      sales_qty: numberOrZero(item.totalSales),
      sales_amount: 0,
      currency: null,
      expected_income: 0,
      declared_price: toNumber(item.price),
      add_cart_7d: numberOrZero(item.sevenDaysAddCartNum),
      add_cart_total: 0,
      stat_date_start: statDate,
      stat_date_end: statDate,
      raw_json: stringify(item),
      created_at: now,
      updated_at: now
    };
  }

  async sync(payload = {}, actor = {}) {
    const companyId = optionalString(payload.companyId || payload.company_id) || DEFAULT_COMPANY_ID;
    const platformShopId = optionalString(payload.shopId || payload.shop_id) ||
    optionalString(payload.accountId || payload.account_id) ||
    DEFAULT_PLATFORM_SHOP_ID;
    const shopName = optionalString(payload.shopName || payload.shop_name) || null;
    const now = nowIso();
    const runId = createId("temu_sales_run");
    const stats = {
      runId,
      companyId,
      platformShopId,
      shopName,
      statDate: null,
      shopCount: 0,
      skuCount: 0,
      priceLogCount: 0,
      skippedCount: 0,
      errors: [],
      startedAt: now,
      finishedAt: null
    };

    await execute(this.db, this.insertRunSql, {
      id: runId,
      company_id: companyId,
      robot_key: ROBOT_KEY,
      started_at: now
    });

    try {
      const salesData = this.resolveSalesData(payload);
      const statDate = getStatDate(payload, salesData);
      const summary = isObject(salesData.summary) ? salesData.summary : {};
      const items = Array.isArray(salesData.items) ? salesData.items : [];
      stats.statDate = statDate;await withTransaction(this.db,

        async (txDb) => {
          await execute(this.db, this.upsertShopSql, this.buildShopRow({
            companyId,
            platformShopId,
            shopName,
            statDate,
            summary,
            now
          }));
          stats.shopCount = 1;

          for (let index = 0; index < items.length; index++) {
            try {
              const row = this.buildSkuRow({ companyId, platformShopId, shopName, statDate, item: items[index], now });
              if (!row) {
                addError(stats, `items[${index}] missing skuCode/skcId`);
                continue;
              }
              await execute(this.db, this.upsertSkuSql, row);
              stats.skuCount += 1;
            } catch (error) {
              addError(stats, `items[${index}] ${error?.message || String(error)}`);
            }
          }

          stats.finishedAt = nowIso();
          await execute(this.db, this.updateRunSql, {
            id: runId,
            shop_count: stats.shopCount,
            sku_count: stats.skuCount,
            price_log_count: stats.priceLogCount,
            status: "success",
            error: errorRemark(stats),
            finished_at: stats.finishedAt
          });
        });


      return stats;
    } catch (error) {
      const message = error?.message || String(error);
      stats.finishedAt = nowIso();
      try {
        await execute(this.db, this.updateRunSql, {
          id: runId,
          shop_count: stats.shopCount,
          sku_count: stats.skuCount,
          price_log_count: stats.priceLogCount,
          status: "failed",
          error: message.slice(0, 2000),
          finished_at: stats.finishedAt
        });
      } catch {}
      throw error;
    }
  }
}

module.exports = {
  TemuSalesBridge,
  DEFAULT_COMPANY_ID,
  DEFAULT_PLATFORM_SHOP_ID,
  ROBOT_KEY
};