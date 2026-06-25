const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");
const { JushuitanOperationalBridge } = require("../electron/erp/services/jushuitanOperationalBridge.cjs");

const sourceKeys = process.argv.slice(2).map((value) => String(value || "").trim()).filter(Boolean);
const companyId = process.env.COMPANY_ID || "company_default";
(async () => {
const db = openErpDatabase();

try {
  await runMigrations({ db });
  const bridge = new JushuitanOperationalBridge({ db });
  const result = bridge.sync({ companyId, sourceKeys });
  const sourceCounts = db.prepare(`
    SELECT source_key AS sourceKey, COUNT(*) AS count
    FROM erp_jst_business_records
    WHERE company_id = ?
    GROUP BY source_key
    ORDER BY count DESC
  `).all(companyId);
  const tableCounts = {
    accounts: db.prepare("SELECT COUNT(*) AS count FROM erp_accounts WHERE id LIKE 'jst:%'").get().count,
    suppliers: db.prepare("SELECT COUNT(*) AS count FROM erp_suppliers WHERE id LIKE 'jst:%'").get().count,
    skus: db.prepare("SELECT COUNT(*) AS count FROM erp_skus WHERE id LIKE 'jst:%'").get().count,
    warehouses: db.prepare("SELECT COUNT(*) AS count FROM erp_warehouses WHERE id LIKE 'jst:%'").get().count,
    purchaseOrders: db.prepare("SELECT COUNT(*) AS count FROM erp_purchase_orders WHERE id LIKE 'jst:%' OR external_order_payload_json LIKE '%jushuitan%'").get().count,
    inboundReceipts: db.prepare("SELECT COUNT(*) AS count FROM erp_inbound_receipts WHERE id LIKE 'jst:%'").get().count,
    inventoryBatches: db.prepare("SELECT COUNT(*) AS count FROM erp_inventory_batches WHERE id LIKE 'jst:%'").get().count,
    sku1688Sources: db.prepare("SELECT COUNT(*) AS count FROM erp_sku_1688_sources WHERE id LIKE 'jst:%'").get().count,
    businessRecords: db.prepare("SELECT COUNT(*) AS count FROM erp_jst_business_records WHERE company_id = ?").get(companyId).count,
  };
  console.log(JSON.stringify({ ok: true, result, tableCounts, sourceCounts }, null, 2));
} finally {
  db.close();
}

})().catch(e => { console.error(e); process.exit(1); });