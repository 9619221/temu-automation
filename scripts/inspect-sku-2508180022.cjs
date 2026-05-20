// 一次性排查：看 2508180022 这个 SKU 在 erp_skus 里有几条、各自字段长啥样。
// 用法：ELECTRON_RUN_AS_NODE=1 electron.exe scripts/inspect-sku-2508180022.cjs
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(process.env.APPDATA, "temu-automation", "data", "erp.sqlite");
console.log("db:", dbPath);
const db = new Database(dbPath, { readonly: true });

const ids = ["2508180022", "jst:skuprofile:2508180022"];

function dump(title, sql, params) {
  console.log("\n=== " + title + " ===");
  try {
    const rows = params ? db.prepare(sql).all(params) : db.prepare(sql).all();
    if (rows.length === 0) {
      console.log("(empty)");
    } else {
      console.table(rows);
    }
  } catch (e) {
    console.log("err:", e.message);
  }
}

// 1) 列名先打出来，免得猜字段名
dump("erp_skus columns", "PRAGMA table_info(erp_skus)");

// 2) 两条记录的核心字段
for (const id of ids) {
  dump(
    `erp_skus row id=${id}`,
    `SELECT id, internal_sku_code, product_name, status, account_id, supplier_id,
            jst_cost_price, jst_supplier_name, jst_actual_stock_qty,
            jst_brand, jst_category, jst_short_name, created_at, updated_at
     FROM erp_skus WHERE id = ?`,
    [id],
  );
}

// 3) 库存映射（看为何前端"库存 -"）
for (const id of ids) {
  dump(
    `erp_sku_inventory for sku=${id}`,
    `SELECT account_id, sku_id, location_code, available_qty, reserved_qty, blocked_qty
     FROM erp_sku_inventory WHERE sku_id = ?`,
    [id],
  );
}

// 4) 1688 source 映射
for (const id of ids) {
  dump(
    `erp_sku_1688_sources for sku=${id}`,
    `SELECT id, account_id, sku_id, external_offer_id, supplier_name, unit_price, status
     FROM erp_sku_1688_sources WHERE sku_id = ?`,
    [id],
  );
}
