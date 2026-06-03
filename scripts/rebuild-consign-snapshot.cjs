#!/usr/bin/env node
/**
 * 送仓托管统一视图（consign-deliveries-unified）物化快照重建脚本。
 *
 * 背景：runConsignDeliveriesUnified 的 UNIFIED_CONSIGN_CTE 要跨 ATTACH 库把 cloud
 * temu_stock_order_snapshot（5万+行）全表聚合 + 与 jst 5万+行 join + 排序，在 2 核小机 +
 * 大 cloud 库（8GB）上冷态要 30~50s。ERP 服务是单进程同步 better-sqlite3，这条查询会独占
 * 事件循环数十秒，连带把同期所有人的登录探活 / 出库 workbench 一起拖超时
 *（表现为"连接主控端超时 / 卡在正在加载工作台"）。
 *
 * 方案：把这条重查询从「每次在线同步算」改为「后台单独进程预算好、落成物化表」，
 * 在线查询只读这张本地表（走索引，毫秒级）。本脚本就是那个独立进程，由 cron 定时跑，
 * 它的数十秒耗时发生在独立进程里，不影响 ERP 服务事件循环。
 *
 * 安全性：只新建 / 重写独立表 temu_consign_unified_snapshot，绝不碰任何现有业务表。
 * 在线侧 runConsignDeliveriesUnified 读快照失败/陈旧会自动回退到原 CTE，无快照=退化为现状。
 *
 * 用法：
 *   ERP_DB=/opt/temu-erp-data/erp.sqlite \
 *   TEMU_CLOUD_DB_PATH=/opt/temu-cloud/data/temu-cloud.sqlite \
 *   node scripts/rebuild-consign-snapshot.cjs
 */
"use strict";

const path = require("path");
const fs = require("fs");

const ERP_DB = process.env.ERP_DB
  || path.join(process.env.ERP_DATA_DIR || "/opt/temu-erp-data", "erp.sqlite");
const CLOUD_DB = process.env.TEMU_CLOUD_DB_PATH || "/opt/temu-cloud/data/temu-cloud.sqlite";

function log(msg) {
  process.stdout.write(`${new Date().toISOString()} [consign-snapshot] ${msg}\n`);
}

// 复用 lanServer 里的同一份 CTE 与行→payload 映射，杜绝 SQL 漂移。
let UNIFIED_CONSIGN_CTE;
let unifiedRowToPayload;
try {
  const lan = require(path.join(__dirname, "..", "electron", "erp", "lanServer.cjs"));
  // 按开关选 CTE:OPENAPI_CONSIGN=1 用官方物化表(erp_temu_openapi_consign),否则抓包。兼容老版 lanServer(无该函数则退回抓包 const)。
  UNIFIED_CONSIGN_CTE = typeof lan.buildUnifiedConsignCte === "function" ? lan.buildUnifiedConsignCte() : lan.UNIFIED_CONSIGN_CTE;
  unifiedRowToPayload = lan.unifiedRowToPayload;
} catch (e) {
  log(`无法加载 lanServer 导出（可能版本未同步该导出）：${e.message}`);
  process.exit(2);
}
if (!UNIFIED_CONSIGN_CTE || typeof unifiedRowToPayload !== "function") {
  log("lanServer 未导出 UNIFIED_CONSIGN_CTE / unifiedRowToPayload，请先同步新版 lanServer.cjs");
  process.exit(2);
}

const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const SNAPSHOT_DDL = `
CREATE TABLE IF NOT EXISTS temu_consign_unified_snapshot (
  company_id     TEXT NOT NULL,
  so_id          TEXT,
  source         TEXT,
  jst_status     TEXT,
  display_status TEXT,
  order_key      TEXT,
  search_blob    TEXT,
  payload_json   TEXT NOT NULL,
  rebuilt_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consign_unified_snap_company_order
  ON temu_consign_unified_snapshot(company_id, order_key DESC, so_id DESC);
CREATE INDEX IF NOT EXISTS idx_consign_unified_snap_company_source
  ON temu_consign_unified_snapshot(company_id, source);
CREATE INDEX IF NOT EXISTS idx_consign_unified_snap_company_status
  ON temu_consign_unified_snapshot(company_id, display_status);
`;

// display_status（= COALESCE(jst_status, cloud_temu_status)，与在线/读取侧筛选口径一致）
// 是后加的列，老快照表用 CREATE TABLE IF NOT EXISTS 建出来时没有它，这里幂等补列。
function ensureDisplayStatusColumn(db) {
  const has = db
    .prepare("SELECT 1 FROM pragma_table_info('temu_consign_unified_snapshot') WHERE name = 'display_status'")
    .get();
  if (!has) db.exec("ALTER TABLE temu_consign_unified_snapshot ADD COLUMN display_status TEXT");
}

// search_blob：把在线 LIKE 命中的字段拼起来，让快照侧用单列 LIKE 复现搜索。
function buildSearchBlob(row) {
  return [
    row.so_id, row.jst_shop_name, row.jst_outer_deliver_no, row.jst_supplier_name,
    row.jst_sku_info, row.jst_skus, row.jst_logistics_company, row.jst_l_id,
    row.cloud_mall_id, row.cloud_site, row.cloud_delivery_order_sn,
    row.cloud_product_name, row.cloud_spec_name, row.cloud_sku_ext_code,
  ].filter((v) => v != null && v !== "").join("  ");
}

function main() {
  if (!fs.existsSync(ERP_DB)) { log(`erp 库不存在：${ERP_DB}`); process.exit(1); }
  const t0 = Date.now();
  const db = new Database(ERP_DB);
  db.pragma("busy_timeout = 60000");
  db.pragma("mmap_size = 0");

  const cloudAttached = fs.existsSync(CLOUD_DB);
  if (cloudAttached) {
    db.exec(`ATTACH DATABASE '${CLOUD_DB.replace(/'/g, "''")}' AS cloud`);
  } else {
    log(`cloud 库不存在（${CLOUD_DB}），仅能物化 jst-only，跳过。`);
    process.exit(0);
  }

  // 这张表纯是可重建的物化快照（脚本本就全量 DELETE+重插），结构随脚本演进可能加列
  // （如 display_status）。旧表用 CREATE TABLE IF NOT EXISTS 不会补列，且 DDL 里引用新列的
  // 索引会因列不存在而失败。直接 DROP 重建，保证表结构永远是最新 DDL，彻底消除列漂移。
  db.exec("DROP TABLE IF EXISTS temu_consign_unified_snapshot");
  db.exec(SNAPSHOT_DDL);
  ensureDisplayStatusColumn(db); // 兜底（DROP 重建后必有该列，此处仅防御）

  const companies = db
    .prepare("SELECT DISTINCT company_id FROM jst_consign_deliveries WHERE company_id IS NOT NULL")
    .all()
    .map((r) => r.company_id);
  if (!companies.includes("company_default")) companies.push("company_default");
  log(`待物化公司数=${companies.length}: ${companies.join(", ")}`);

  const selectAll = db.prepare(`${UNIFIED_CONSIGN_CTE}\nSELECT * FROM unified`);
  const rebuiltAt = t0;

  const replaceCompany = db.transaction((companyId) => {
    const rows = selectAll.all({ company_id: companyId });
    db.prepare("DELETE FROM temu_consign_unified_snapshot WHERE company_id = ?").run(companyId);
    const ins = db.prepare(`
      INSERT INTO temu_consign_unified_snapshot
        (company_id, so_id, source, jst_status, display_status, order_key, search_blob, payload_json, rebuilt_at)
      VALUES (@company_id, @so_id, @source, @jst_status, @display_status, @order_key, @search_blob, @payload_json, @rebuilt_at)
    `);
    for (const row of rows) {
      ins.run({
        company_id: companyId,
        so_id: row.so_id || null,
        source: row.source || null,
        jst_status: row.jst_status || null,
        display_status: row.local_status_override || row.jst_status || row.cloud_temu_status || null,
        order_key: row.jst_order_date || row.cloud_order_time || null,
        search_blob: buildSearchBlob(row),
        payload_json: JSON.stringify(unifiedRowToPayload(row)),
        rebuilt_at: rebuiltAt,
      });
    }
    return rows.length;
  });

  let totalRows = 0;
  for (const companyId of companies) {
    const c0 = Date.now();
    const n = replaceCompany(companyId);
    totalRows += n;
    log(`  ${companyId}: ${n} 行, ${((Date.now() - c0) / 1000).toFixed(1)}s`);
  }

  // 清掉已不存在公司的陈旧快照
  db.prepare(
    `DELETE FROM temu_consign_unified_snapshot WHERE company_id NOT IN (${companies.map(() => "?").join(",")})`,
  ).run(...companies);

  db.close();
  log(`完成：共 ${totalRows} 行, 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

try {
  main();
} catch (e) {
  log(`重建失败：${e && e.stack ? e.stack : e}`);
  process.exit(1);
}
