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
const collectors = require("../electron/erp/services/temuOpenApiCollectors.cjs");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-openapi-sync]", ...args);
}

async function main() {
  const t0 = Date.now();
  const db = new Database(ERP_DB);
  db.pragma("busy_timeout=60000");
  try {
    // 1) 商品主数据
    const pr = await svc.syncAllMalls(db);
    const prOk = pr.results.filter((r) => r.ok);
    const products = prOk.reduce((sum, r) => sum + (r.productCount || 0), 0);
    log(`products: malls=${pr.malls} ok=${prOk.length} products=${products}`);
    // 2) 多源（采购/发货/销售/售后）—— 库存逐 SKC 太慢(8店×上千SKC=数小时)，
    //    从自动采集摘出，改按需手动触发（skipInventory）
    const cr = await collectors.syncAllCollectorsAllMalls(db, { skipInventory: true });
    const crOk = cr.results.filter((r) => r.ok);
    log(`records: malls=${cr.malls} ok=${crOk.length} summary=${JSON.stringify(crOk.map((r) => r.summary))}`);
    log(`all done in ${Date.now() - t0}ms`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  log("fatal:", (e && e.message) || String(e));
  process.exit(1);
});
