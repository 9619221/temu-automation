// 采集+物化「今日首单发货」→ erp_temu_firstship_daily(运营工作台总览统计卡)。独立 cron 进程。
// 调 bg.shiporderv2.get 按今日发货时间(北京)拉、筛 subPurchaseOrderBasicVO.isFirst、按 WB 去重;
// 纯本地 erp.sqlite,不触 cloud。用法(crontab,建议每 30 分钟刷当天):
//   */30 * * * * cd /opt/temu-automation && node scripts/refresh-openapi-firstship.cjs >> /var/log/temu-openapi-firstship.log 2>&1
"use strict";
const Database = require("better-sqlite3");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");
const { refreshFirstShipAll } = require("../electron/erp/services/temuOpenApiFirstShip.cjs");

(async () => {
  const t0 = Date.now();
  try {
    // 默认刷今天;设 FIRSTSHIP_DAY_OFFSET=-1 可补昨天(跨零点衔接)。
    const dayOffset = Number(process.env.FIRSTSHIP_DAY_OFFSET) || 0;
    const r = await refreshFirstShipAll(db, { dayOffset });
    console.log(new Date().toISOString(), "firstship refreshed", JSON.stringify({ malls: r.malls, first: r.first, errors: r.errors.length }), "in", Date.now() - t0, "ms");
    if (r.errors.length) console.error("firstship errors(前5):", JSON.stringify(r.errors.slice(0, 5)));
  } catch (e) {
    console.error(new Date().toISOString(), "firstship refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
