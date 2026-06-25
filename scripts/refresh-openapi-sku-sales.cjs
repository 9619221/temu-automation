// 物化官方 sales → erp_temu_openapi_sku_sales（运营工作台官方 API 化）。独立 cron 进程。
// 跟在官方多源采集（sales）之后跑即可，纯本地 erp.sqlite、不触碰 cloud 大库。
// 用法(crontab): */15 * * * * cd /opt/temu-automation && node scripts/refresh-openapi-sku-sales.cjs >> /var/log/temu-openapi-sku-sales.log 2>&1
"use strict";
const { openErpDatabase, closePgPool, USE_PG } = require("../electron/db/connection.cjs");
const { refreshSkuSalesAll } = require("../electron/erp/services/temuOpenApiSkuSales.cjs");

(async () => {
  const db = openErpDatabase();
  const t0 = Date.now();
  try {
    const r = await refreshSkuSalesAll(db);
    console.log(new Date().toISOString(), "openapi_sku_sales refreshed", JSON.stringify(r), "in", Date.now() - t0, "ms");
  } catch (e) {
    console.error(new Date().toISOString(), "refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    if (USE_PG) await closePgPool(); else db.close();
  }
})();
