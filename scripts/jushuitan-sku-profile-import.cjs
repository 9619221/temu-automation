#!/usr/bin/env node
/**
 * 聚水潭「商品资料」(资料视角)规范化 JSON → ERP erp_skus(自包含,不经过 bridge)。
 *
 * 做三件事,全程单事务:
 *   1. 幂等给 erp_skus 增列(jst_* 新列,已存在则跳过)
 *   2. 每条落 erp_jst_raw_records 留底(source_key=sku,external_id=商品编码)
 *   3. upsert erp_skus(id=jst:skuprofile:<商品编码>,扩展列写成本/库存/销量等)
 *
 * 用法:
 *   ERP_DATA_DIR=/opt/temu-erp-data node jushuitan-sku-profile-import.cjs <profile.json>
 *   加 DRY=1 则全程事务最后 ROLLBACK,只报数不落库(生产先空跑核对用)。
 *   可用 ERP_DB=/abs/path/erp.sqlite 直接指定库文件。
 *
 * 依赖 better-sqlite3(服务器 /opt/temu-automation/node_modules 已有)。
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function resolveDbPath() {
  if (process.env.ERP_DB) return process.env.ERP_DB;
  const dir = process.env.ERP_DATA_DIR;
  if (!dir) throw new Error("需设置 ERP_DATA_DIR 或 ERP_DB");
  return path.join(dir, "erp.sqlite");
}

function loadBetterSqlite() {
  try {
    return require("better-sqlite3");
  } catch (_) {
    return require(path.join("/opt/temu-automation/node_modules/better-sqlite3"));
  }
}

// 新增列名 -> SQLite 列类型(数值列 REAL,文本列 TEXT;jst_synced_at 记录导入时间)
const NEW_COLUMNS = {
  jst_style_code: "TEXT",
  jst_short_name: "TEXT",
  jst_color: "TEXT",
  jst_spec: "TEXT",
  jst_brand: "TEXT",
  jst_virtual_category: "TEXT",
  jst_product_tags: "TEXT",
  jst_barcode: "TEXT",
  jst_main_bin: "TEXT",
  jst_cost_price: "REAL",
  jst_purchase_price: "REAL",
  jst_base_sale_price: "REAL",
  jst_market_price: "REAL",
  jst_actual_stock_qty: "REAL",
  jst_order_occupied_qty: "REAL",
  jst_purchase_in_transit_qty: "REAL",
  jst_transfer_in_transit_qty: "REAL",
  jst_pending_purchase_qty: "REAL",
  jst_sales_qty_30d: "REAL",
  jst_sales_qty_15d: "REAL",
  jst_purchase_model: "TEXT",
  jst_suggested_purchase_qty: "REAL",
  jst_stock_floor: "REAL",
  jst_stock_ceiling: "REAL",
  jst_supplier_name: "TEXT",
  jst_purchase_url: "TEXT",
  jst_purchase_feature: "TEXT",
  jst_stock_sync: "TEXT",
  jst_weight: "REAL",
  jst_length: "REAL",
  jst_width: "REAL",
  jst_height: "REAL",
  jst_volume: "REAL",
  jst_unit: "TEXT",
  jst_carton_qty: "REAL",
  jst_carton_volume: "REAL",
  jst_remark: "TEXT",
  jst_created_at: "TEXT",
  jst_modified_at: "TEXT",
  jst_creator: "TEXT",
  jst_synced_at: "TEXT",
};

const COMPANY_ID = process.env.COMPANY_ID || "company_default";
const ACCOUNT_ID = "jst:account:default";
const DRY = process.env.DRY === "1";

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) throw new Error("用法: node jushuitan-sku-profile-import.cjs <profile.json>");
  const records = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (!Array.isArray(records) || !records.length) throw new Error("JSON 为空或非数组");

  const Database = loadBetterSqlite();
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 60000");

  const now = new Date().toISOString();

  const skuCols = new Set(db.prepare("PRAGMA table_info(erp_skus)").all().map((r) => r.name));
  const acctCols = new Set(db.prepare("PRAGMA table_info(erp_accounts)").all().map((r) => r.name));
  const hasRawTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erp_jst_raw_records'")
    .get();

  // 1. 幂等增列(ALTER 不能进事务回滚,放事务外;DRY 模式也加列——纯增量无害,便于核对)
  const added = [];
  for (const [col, type] of Object.entries(NEW_COLUMNS)) {
    if (!skuCols.has(col)) {
      db.exec(`ALTER TABLE erp_skus ADD COLUMN ${col} ${type}`);
      skuCols.add(col);
      added.push(col);
    }
  }

  // 默认聚水潭账户(满足 erp_skus.account_id 外键),按 erp_accounts 实际列动态构造
  const acctFields = ["id", "name", "status", "source", "created_at", "updated_at"]
    .concat(acctCols.has("company_id") ? ["company_id"] : [])
    .concat(acctCols.has("phone") ? ["phone"] : []);
  const acctVals = {
    id: ACCOUNT_ID,
    name: "聚水潭",
    status: "offline",
    source: "jushuitan",
    created_at: now,
    updated_at: now,
    company_id: COMPANY_ID,
    phone: null,
  };
  const ensureAccount = db.prepare(
    `INSERT OR IGNORE INTO erp_accounts (${acctFields.join(",")}) VALUES (${acctFields
      .map((f) => "@" + f)
      .join(",")})`
  );

  const jstColList = Object.keys(NEW_COLUMNS).filter((c) => skuCols.has(c));
  const baseInsertCols = [
    "id",
    "account_id",
    "internal_sku_code",
    "product_name",
    "category",
    "image_url",
    "status",
    "created_at",
    "updated_at",
  ]
    .concat(skuCols.has("company_id") ? ["company_id"] : [])
    .concat(skuCols.has("color_spec") ? ["color_spec"] : []);
  const allInsertCols = baseInsertCols.concat(jstColList);
  const updateAssign = allInsertCols
    .filter((c) => c !== "id" && c !== "created_at")
    .map((c) => `${c}=excluded.${c}`)
    .join(", ");
  const upsertSku = db.prepare(
    `INSERT INTO erp_skus (${allInsertCols.join(",")})
     VALUES (${allInsertCols.map((c) => "@" + c).join(",")})
     ON CONFLICT(id) DO UPDATE SET ${updateAssign}`
  );

  const upsertRaw = hasRawTable
    ? db.prepare(
        `INSERT INTO erp_jst_raw_records
          (id, company_id, source_key, method, external_id, cursor_value, record_hash, raw_json, fetched_at, updated_at, job_id)
         VALUES (@id,@company_id,'sku','sku.query',@external_id,NULL,@record_hash,@raw_json,@fetched_at,@updated_at,NULL)
         ON CONFLICT(company_id, source_key, external_id) DO UPDATE SET
           record_hash=excluded.record_hash, raw_json=excluded.raw_json, updated_at=excluded.updated_at`
      )
    : null;

  const stats = { total: records.length, sku: 0, raw: 0, withCost: 0, withStock: 0 };

  const run = db.transaction(() => {
    ensureAccount.run(acctVals);
    for (const r of records) {
      const code = String(r.internal_sku_code || "").trim();
      if (!code) continue;
      const rawJson = JSON.stringify(r);

      if (upsertRaw) {
        upsertRaw.run({
          id: "jst:raw:sku:" + code,
          company_id: COMPANY_ID,
          external_id: code,
          record_hash: crypto.createHash("sha1").update(rawJson).digest("hex").slice(0, 16),
          raw_json: rawJson,
          fetched_at: now,
          updated_at: now,
        });
        stats.raw += 1;
      }

      const row = {
        id: "jst:skuprofile:" + code,
        account_id: ACCOUNT_ID,
        internal_sku_code: code,
        product_name: r.product_name || code,
        category: r.category || null,
        image_url: r.image_url || null,
        status: r.product_status === "停用" ? "inactive" : "active",
        created_at: now,
        updated_at: now,
        company_id: COMPANY_ID,
        color_spec: r.color_spec || null,
        jst_synced_at: now,
      };
      for (const c of jstColList) {
        if (c === "jst_synced_at") continue;
        row[c] = r[c] === undefined ? null : r[c];
      }
      // 仅传 upsert 实际用到的键
      const bind = {};
      for (const c of allInsertCols) bind[c] = row[c] === undefined ? null : row[c];
      upsertSku.run(bind);
      stats.sku += 1;
      if (r.jst_cost_price != null) stats.withCost += 1;
      if (r.jst_actual_stock_qty != null) stats.withStock += 1;
    }
    if (DRY) {
      // 触发回滚:better-sqlite3 的 transaction() 内抛错即整体 ROLLBACK
      throw new Error("__DRY_ROLLBACK__");
    }
  });

  let rolledBack = false;
  try {
    run();
  } catch (e) {
    if (e && e.message === "__DRY_ROLLBACK__") {
      rolledBack = true;
    } else {
      db.close();
      throw e;
    }
  }

  const skuCount = db
    .prepare("SELECT COUNT(*) c FROM erp_skus WHERE id LIKE 'jst:skuprofile:%'")
    .get().c;
  db.close();

  console.log(
    JSON.stringify(
      {
        mode: DRY ? "DRY(已回滚)" : "WRITE",
        dbPath,
        addedColumns: added,
        ...stats,
        erp_skus_jst_profile_rows_after: skuCount,
        rolledBack,
      },
      null,
      2
    )
  );
}

main();
