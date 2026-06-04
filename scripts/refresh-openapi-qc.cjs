// 采集+物化官方质检结果 → erp_temu_openapi_qc(运营工作台/QC 中心「平台仓质检」)。独立 cron 进程。
// 默认只采【不合格】,逐条补疵点详情;纯本地 erp.sqlite,不触 cloud。直接调官方接口(非走 records 中间表)。
// 用法(crontab,建议错峰、低频,如每 4 小时):
//   17 */4 * * * cd /opt/temu-automation && node scripts/refresh-openapi-qc.cjs >> /var/log/temu-openapi-qc.log 2>&1
"use strict";
const Database = require("better-sqlite3");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");
const { refreshQcAll } = require("../electron/erp/services/temuOpenApiQc.cjs");

(async () => {
  const t0 = Date.now();
  try {
    // 可选增量:设 QC_SINCE_DAYS 只采最近 N 天更新的质检(减少详情调用量);默认全量不合格。
    const sinceDays = Number(process.env.QC_SINCE_DAYS) || 0;
    const opts = sinceDays > 0 ? { sinceMs: Date.now() - sinceDays * 86400000 } : {};
    const r = await refreshQcAll(db, opts);
    console.log(new Date().toISOString(), "openapi_qc refreshed", JSON.stringify({ malls: r.malls, rows: r.rows, errors: r.errors.length }), "in", Date.now() - t0, "ms");
    if (r.errors.length) console.error("qc errors(前5):", JSON.stringify(r.errors.slice(0, 5)));
  } catch (e) {
    console.error(new Date().toISOString(), "qc refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
