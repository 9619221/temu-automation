// 物化官方送仓单 → erp_temu_openapi_consign(出库中心官方 API 化)。独立 cron,纯本地 erp.sqlite。
// 用法(crontab): 跟在官方采集后跑。node scripts/refresh-openapi-consign.cjs
"use strict";
const { openErpDatabase, closePgPool, USE_PG } = require("../electron/db/connection.cjs");
const { refreshConsignAllChunked } = require("../electron/erp/services/temuOpenApiConsign.cjs");

(async () => {
  const db = openErpDatabase();
  const t0 = Date.now();
  try {
    const r = await refreshConsignAllChunked(db, 500);
    console.log(new Date().toISOString(), "openapi_consign refreshed", JSON.stringify(r), "in", Date.now() - t0, "ms");
  } catch (e) {
    console.error(new Date().toISOString(), "refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    if (USE_PG) await closePgPool(); else db.close();
  }
})();
