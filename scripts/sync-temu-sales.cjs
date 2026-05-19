const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");
const { TemuSalesBridge } = require("../electron/erp/services/temuSalesBridge.cjs");

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const text = String(arg || "");
    const match = text.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === "account") options.accountId = value;
    if (key === "shop") options.shopId = value;
    if (key === "shop-name") options.shopName = value;
    if (key === "date") options.statDate = value;
    if (key === "json") options.salesJsonPath = value;
    if (key === "company") options.companyId = value;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const companyId = options.companyId || process.env.COMPANY_ID || "company_default";
const db = openErpDatabase();

try {
  runMigrations({ db });
  const bridge = new TemuSalesBridge({ db });
  const result = bridge.sync({
    companyId,
    accountId: options.accountId,
    shopId: options.shopId,
    shopName: options.shopName,
    statDate: options.statDate,
    salesJsonPath: options.salesJsonPath,
  });

  const counts = {
    shop: db.prepare(`
      SELECT COUNT(*) AS count
      FROM erp_temu_sales_shop
      WHERE company_id = ? AND platform_shop_id = ? AND stat_date = ?
    `).get(result.companyId, result.platformShopId, result.statDate).count,
    sku: db.prepare(`
      SELECT COUNT(*) AS count
      FROM erp_temu_sales_sku
      WHERE company_id = ? AND platform_shop_id = ?
        AND stat_date_start = ? AND stat_date_end = ?
    `).get(result.companyId, result.platformShopId, result.statDate, result.statDate).count,
    priceLog: db.prepare(`
      SELECT COUNT(*) AS count
      FROM erp_temu_price_log
      WHERE company_id = ? AND platform_shop_id = ?
    `).get(result.companyId, result.platformShopId).count,
    runs: db.prepare(`
      SELECT COUNT(*) AS count
      FROM erp_temu_robot_sync_runs
      WHERE id = ?
    `).get(result.runId).count,
  };

  console.log(JSON.stringify({ ok: true, result, counts }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  db.close();
}
