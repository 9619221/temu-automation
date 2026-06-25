// 采集+物化官方质检结果 → erp_temu_openapi_qc(运营工作台/QC 中心「平台仓质检」)。独立 cron 进程。
// 默认只采【不合格】,逐条补疵点详情;纯本地 erp.sqlite,不触 cloud。直接调官方接口(非走 records 中间表)。
// 用法(crontab,建议错峰、低频,如每 4 小时):
//   17 */4 * * * cd /opt/temu-automation && node scripts/refresh-openapi-qc.cjs >> /var/log/temu-openapi-qc.log 2>&1
"use strict";
const { openErpDatabase, closePgPool, USE_PG } = require("../electron/db/connection.cjs");
const { refreshQcAll } = require("../electron/erp/services/temuOpenApiQc.cjs");

(async () => {
  const db = openErpDatabase();
  const t0 = Date.now();
  try {
    const sinceDays = Number(process.env.QC_SINCE_DAYS) || 0;
    const opts = sinceDays > 0 ? { sinceMs: Date.now() - sinceDays * 86400000 } : {};
    const r = await refreshQcAll(db, opts);
    console.log(new Date().toISOString(), "openapi_qc refreshed", JSON.stringify({ malls: r.malls, rows: r.rows, errors: r.errors.length }), "in", Date.now() - t0, "ms");
    if (r.errors.length) console.error("qc errors(前5):", JSON.stringify(r.errors.slice(0, 5)));
  } catch (e) {
    console.error(new Date().toISOString(), "qc refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    if (USE_PG) await closePgPool(); else db.close();
  }
})();
