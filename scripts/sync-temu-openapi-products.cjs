#!/usr/bin/env node
/**
 * 定时全量采集 Temu 官方商品主数据，落 erp.sqlite。
 *
 * 由 systemd timer 调度（temu-openapi-products.timer），EnvironmentFile 复用 temu-erp
 * 的 TEMU_OPENAPI_APP_SECRET（签名用）。独立进程、崩溃隔离、日志独立。
 *
 * 手动跑：
 *   set -a && . /etc/temu-erp.env && node scripts/sync-temu-openapi-products.cjs
 */
"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const ERP_DB = process.env.ERP_DB
  || process.env.ERP_DB_PATH
  || path.join(process.env.ERP_DATA_DIR || "/opt/temu-erp-data", "erp.sqlite");

const svc = require("../electron/erp/services/temuOpenApiProductSync.cjs");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-openapi-products]", ...args);
}

async function main() {
  const t0 = Date.now();
  const db = new Database(ERP_DB);
  db.pragma("busy_timeout=60000");
  try {
    const result = await svc.syncAllMalls(db);
    const ok = result.results.filter((r) => r.ok);
    const failed = result.results.filter((r) => r && r.ok === false);
    const products = ok.reduce((sum, r) => sum + (r.productCount || 0), 0);
    log(`done: malls=${result.malls} ok=${ok.length} failed=${failed.length} products=${products} in ${Date.now() - t0}ms`);
    for (const f of failed) log(`  FAIL mall=${f.mallId}: ${f.error}`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  log("fatal:", (e && e.message) || String(e));
  process.exit(1);
});
