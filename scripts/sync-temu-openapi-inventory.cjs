#!/usr/bin/env node
/**
 * 独立采集 Temu 全托虚拟库存（逐 SKC，并发池提速）。
 *
 * 与快源(商品/采购/发货/销售/售后)解耦：库存逐 SKC 量大，单独 systemd timer 低频跑，
 * 不堵 6h 快采。库存接口(PA)限流宽松，collector 内用 8 并发，~15/s。
 *
 * 手动跑：set -a && . /etc/temu-openapi-products.env && node scripts/sync-temu-openapi-inventory.cjs
 */
"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const ERP_DB = process.env.ERP_DB
  || process.env.ERP_DB_PATH
  || path.join(process.env.ERP_DATA_DIR || "/opt/temu-erp-data", "erp.sqlite");

const collectors = require("../electron/erp/services/temuOpenApiCollectors.cjs");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-openapi-inventory]", ...args);
}

async function main() {
  const t0 = Date.now();
  const db = new Database(ERP_DB);
  db.pragma("busy_timeout=60000");
  try {
    const r = await collectors.syncInventoryAllMalls(db);
    const ok = r.results.filter((x) => x.ok);
    const total = ok.reduce((sum, x) => sum + (x.inventory || 0), 0);
    log(`done: malls=${r.malls} ok=${ok.length} inventory_rows=${total} in ${Math.round((Date.now() - t0) / 1000)}s`);
    for (const x of r.results.filter((x) => !x.ok)) log(`  FAIL mall=${x.mallId}: ${x.error}`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  log("fatal:", (e && e.message) || String(e));
  process.exit(1);
});
