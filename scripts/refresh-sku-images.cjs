// cloud temu_sales_snapshot 缩略图 → erp_skus.image_url 回填。独立 cron 进程。
// 按「商品编码(internal_sku_code) == 平台货号(sku_ext_code)」匹配，只补空缺、不覆盖已有图
//（逻辑全在 temuCloudImageSync.cjs，本脚本纯调度壳）。
// busy_timeout 防与 ERP 服务并发写冲突（与其它 refresh-*.cjs 一致）。
// 用法（crontab，每天凌晨低峰跑一次）：
//   50 4 * * * cd /opt/temu-automation && ERP_DB=/opt/temu-erp-data/erp.sqlite TEMU_CLOUD_DB_PATH=/opt/temu-cloud/data/temu-cloud.sqlite node scripts/refresh-sku-images.cjs >> /var/log/temu-sku-images-sync.log 2>&1
"use strict";
const fs = require("fs");
const Database = require("better-sqlite3");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const CLOUD_DB = process.env.TEMU_CLOUD_DB_PATH || "/opt/temu-cloud/data/temu-cloud.sqlite";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");

function attachCloudDb(d) {
  if (!fs.existsSync(CLOUD_DB)) return false;
  try {
    d.exec(`ATTACH DATABASE '${CLOUD_DB.replace(/'/g, "''")}' AS cloud`);
    return true;
  } catch (e) {
    if (/already in use|already an attached database/i.test(String((e && e.message) || ""))) return true;
    throw e;
  }
}

const t0 = Date.now();
try {
  const { TemuCloudImageSync } = require("../electron/erp/services/temuCloudImageSync.cjs");
  const sync = new TemuCloudImageSync({ db, attachCloudDb });
  const r = sync.sync({});
  console.log(new Date().toISOString(), "sku images synced",
    JSON.stringify({ attached: r.attached, candidates: r.candidates, updated: r.updated }),
    "in", Date.now() - t0, "ms");
} catch (e) {
  console.error(new Date().toISOString(), "sku images sync failed:", (e && e.message) || e);
  process.exitCode = 1;
} finally {
  db.close();
}
