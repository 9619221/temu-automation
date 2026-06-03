// 物化官方 sales → erp_temu_openapi_sku_sales（运营工作台官方 API 化）。独立 cron 进程。
// 跟在官方多源采集（sales）之后跑即可，纯本地 erp.sqlite、不触碰 cloud 大库。
// 用法(crontab): */15 * * * * cd /opt/temu-automation && node scripts/refresh-openapi-sku-sales.cjs >> /var/log/temu-openapi-sku-sales.log 2>&1
"use strict";
const Database = require("better-sqlite3");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");
const { refreshSkuSalesAll } = require("../electron/erp/services/temuOpenApiSkuSales.cjs");
const t0 = Date.now();
try {
  const r = refreshSkuSalesAll(db);
  console.log(new Date().toISOString(), "openapi_sku_sales refreshed", JSON.stringify(r), "in", Date.now() - t0, "ms");
} catch (e) {
  console.error(new Date().toISOString(), "refresh failed:", (e && e.message) || e);
  process.exitCode = 1;
} finally {
  db.close();
}
