#!/usr/bin/env node
/**
 * 独立采集 Temu 官方「扩展数据」：广告/流量报表(店铺维度)、爆款邀约、货品生命周期状态。
 *
 * 与快源(商品/采购/发货/销售/售后)、库存解耦，单独 systemd timer 跑。
 * 商品维度广告(ad_report_goods)参数尚在标定，默认跳过(skipAdGoods)，参数确认后去掉即可。
 *
 * 手动跑：set -a && . /etc/temu-openapi-products.env && node scripts/sync-temu-openapi-ext.cjs
 */
"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const ERP_DB = process.env.ERP_DB
  || process.env.ERP_DB_PATH
  || path.join(process.env.ERP_DATA_DIR || "/opt/temu-erp-data", "erp.sqlite");

const collectors = require("../electron/erp/services/temuOpenApiCollectors.cjs");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-openapi-ext]", ...args);
}

async function main() {
  const t0 = Date.now();
  // 商品维度广告参数未定前先跳过，避免每店一次必失败的调用浪费配额
  const skipAdGoods = process.env.TEMU_EXT_AD_GOODS !== "1";
  const db = new Database(ERP_DB);
  db.pragma("busy_timeout=60000");
  try {
    const r = await collectors.syncExtendedCollectorsAllMalls(db, { skipAdGoods });
    const ok = r.results.filter((x) => x.ok);
    const agg = {};
    for (const x of ok) {
      for (const [k, v] of Object.entries(x.summary || {})) {
        if (typeof v === "number" && v >= 0) agg[k] = (agg[k] || 0) + v;
      }
    }
    log(`done: malls=${r.malls} ok=${ok.length} skipAdGoods=${skipAdGoods} agg=${JSON.stringify(agg)} in ${Math.round((Date.now() - t0) / 1000)}s`);
    for (const x of r.results.filter((x) => !x.ok)) log(`  FAIL mall=${x.mallId}: ${x.error}`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  log("fatal:", (e && e.message) || String(e));
  process.exit(1);
});
