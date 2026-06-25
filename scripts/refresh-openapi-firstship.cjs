// 采集+物化「今日首单发货」→ erp_temu_firstship_daily(运营工作台总览统计卡)。独立 cron 进程。
// 调 bg.shiporderv2.get 按今日发货时间(北京)拉、筛 subPurchaseOrderBasicVO.isFirst、按 WB 去重;
// 纯本地 erp.sqlite,不触 cloud。用法(crontab,建议每 30 分钟刷当天):
//   */30 * * * * cd /opt/temu-automation && node scripts/refresh-openapi-firstship.cjs >> /var/log/temu-openapi-firstship.log 2>&1
"use strict";
const { openErpDatabase, closePgPool, USE_PG } = require("../electron/db/connection.cjs");
const { refreshFirstShipAll } = require("../electron/erp/services/temuOpenApiFirstShip.cjs");

(async () => {
  const db = openErpDatabase();
  const t0 = Date.now();
  try {
    const dayOffset = Number(process.env.FIRSTSHIP_DAY_OFFSET) || 0;
    const r = await refreshFirstShipAll(db, { dayOffset });
    console.log(new Date().toISOString(), "firstship refreshed", JSON.stringify({ malls: r.malls, first: r.first, errors: r.errors.length }), "in", Date.now() - t0, "ms");
    if (r.errors.length) console.error("firstship errors(前5):", JSON.stringify(r.errors.slice(0, 5)));
  } catch (e) {
    console.error(new Date().toISOString(), "firstship refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    if (USE_PG) await closePgPool(); else db.close();
  }
})();
