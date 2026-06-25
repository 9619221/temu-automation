// 物化缓存刷新:独立 cron 进程预聚合"商品运营面板",写入 erp_report_cache。
// temu-erp 通过 getProductPanelFast 直接读该表(毫秒),不再实时跨 cloud 库聚合、不阻塞主进程。
// 用法(crontab): */10 * * * * cd /opt/temu-automation && node scripts/refresh-product-panel.cjs >> /var/log/temu-report-cache.log 2>&1
const { openErpDatabase, closePgPool, USE_PG, execute } = require("../electron/db/connection.cjs");

(async () => {
  const db = openErpDatabase();

  // SQLite 模式需要 ATTACH cloud 库；PG 模式 cloud 表已在同一库中
  if (!USE_PG) {
    const CLOUD_DB = process.env.CLOUD_DB || "/opt/temu-cloud/data/temu-cloud.sqlite";
    db.exec(`ATTACH '${CLOUD_DB}' AS cloud`);
  }

  const svc = require("../electron/erp/services/multiStoreReport.cjs");
  const upsertSql = "INSERT INTO erp_report_cache (cache_key, payload_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at";
  const t0 = Date.now();
  for (const inc of [false, true]) {
    try {
      const data = await svc.buildProductPanel(db, { includeTest: inc, attachCloudDb: () => true, force: true });
      const key = "product_panel:" + (inc ? "1" : "0");
      await execute(db, upsertSql, [key, JSON.stringify(data)]);
      console.log(new Date().toISOString(), key, "rows=" + data.row_count);
    } catch (e) {
      console.error(new Date().toISOString(), "refresh failed inc=" + inc, e && e.message);
    }
  }
  console.log(new Date().toISOString(), "refreshed in", Date.now() - t0, "ms");

  if (USE_PG) {
    await closePgPool();
  } else {
    db.close();
  }
})();
