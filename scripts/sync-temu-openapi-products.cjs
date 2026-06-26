#!/usr/bin/env node
/**
 * 定时全量采集 Temu 官方商品主数据。
 *
 * 由 systemd timer 调度（temu-openapi-products.timer），EnvironmentFile 复用
 * TEMU_OPENAPI_APP_SECRET（签名用）。独立进程、崩溃隔离、日志独立。
 *
 * 手动跑：
 *   set -a && . /etc/temu-openapi-products.env && node scripts/sync-temu-openapi-products.cjs
 */
"use strict";

const { openErpDatabase, closePgPool, USE_PG } = require("../electron/db/connection.cjs");
const svc = require("../electron/erp/services/temuOpenApiProductSync.cjs");
const collectors = require("../electron/erp/services/temuOpenApiCollectors.cjs");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-openapi-sync]", ...args);
}

async function main() {
  const t0 = Date.now();
  const db = openErpDatabase();
  try {
    const pr = await svc.syncAllMalls(db);
    const prOk = pr.results.filter((r) => r.ok);
    const products = prOk.reduce((sum, r) => sum + (r.productCount || 0), 0);
    log(`products: malls=${pr.malls} ok=${prOk.length} products=${products}`);
    const cr = await collectors.syncAllCollectorsAllMalls(db, { skipInventory: true });
    const crOk = cr.results.filter((r) => r.ok);
    log(`records: malls=${cr.malls} ok=${crOk.length} summary=${JSON.stringify(crOk.map((r) => r.summary))}`);
    log(`all done in ${Date.now() - t0}ms`);
  } finally {
    if (USE_PG) await closePgPool(); else db.close();
  }
}

main().catch((e) => {
  log("fatal:", (e && e.message) || String(e));
  process.exit(1);
});
