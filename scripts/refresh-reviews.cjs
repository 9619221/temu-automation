// cloud temu_review_snapshot → erp_temu_reviews 增量同步。独立 cron 进程。
// 数据源：Chrome 扩展抓 /bg-luna-agent-seller/review/pageQuery → cloud parseTemuReview 落库，
// 本脚本把 cloud 新增评价搬进 ERP（运营工作台「评价」Tab 读 erp_temu_reviews）。
// 纯搬运，轻量；busy_timeout 防与 ERP 服务并发写冲突（与其它 refresh-*.cjs 一致）。
// 用法（crontab，错峰低频，如每 2 小时）：
//   38 */2 * * * cd /opt/temu-automation && ERP_DB=/opt/temu-erp-data/erp.sqlite TEMU_CLOUD_DB_PATH=/opt/temu-cloud/data/temu-cloud.sqlite node scripts/refresh-reviews.cjs >> /var/log/temu-reviews-sync.log 2>&1
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
  const { TemuCloudReviewSync } = require("../electron/erp/services/temuCloudReviewSync.cjs");
  const sync = new TemuCloudReviewSync({ db, attachCloudDb });
  const r = sync.sync({});
  console.log(new Date().toISOString(), "reviews synced",
    JSON.stringify({ upserted: r.reviewUpserted, skipped: r.reviewSkipped, cursor: r.reviewCursor }),
    "in", Date.now() - t0, "ms");
} catch (e) {
  console.error(new Date().toISOString(), "reviews sync failed:", (e && e.message) || e);
  process.exitCode = 1;
} finally {
  db.close();
}
