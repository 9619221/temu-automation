// 自测：4 个直扣动作（采购退/客户退/平台退回/调拨）
// 跑：ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron.cmd scripts/test-inventory-actions.cjs

const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE erp_skus (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL DEFAULT 'company_default',
    internal_sku_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    weighted_avg_cost REAL NOT NULL DEFAULT 0,
    cost_balance_qty INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE erp_inventory_batches (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    batch_code TEXT NOT NULL,
    sku_id TEXT NOT NULL,
    po_id TEXT,
    inbound_receipt_id TEXT,
    received_qty INTEGER NOT NULL,
    available_qty INTEGER NOT NULL DEFAULT 0,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    blocked_qty INTEGER NOT NULL DEFAULT 0,
    defective_qty INTEGER NOT NULL DEFAULT 0,
    rework_qty INTEGER NOT NULL DEFAULT 0,
    unit_landed_cost REAL NOT NULL DEFAULT 0,
    qc_status TEXT NOT NULL DEFAULT 'pending',
    location_code TEXT,
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE erp_inventory_ledger_entries (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    sku_id TEXT,
    batch_id TEXT,
    type TEXT,
    qty_delta INTEGER,
    from_bucket TEXT,
    to_bucket TEXT,
    unit_cost REAL,
    source_doc_type TEXT,
    source_doc_id TEXT,
    created_at TEXT,
    created_by TEXT
  );
`);

const { InventoryService } = require(path.join(
  __dirname, "..", "electron", "erp", "services", "inventoryService.cjs",
));
const { INVENTORY_LEDGER_TYPE } = require(path.join(
  __dirname, "..", "electron", "erp", "workflow", "enums.cjs",
));

const svc = new InventoryService({ db, workflow: {} });

db.prepare(`INSERT INTO erp_skus (id, internal_sku_code, product_name, created_at, updated_at)
  VALUES ('sku1', 'TEST001', 'Test SKU', '2026-01-01', '2026-01-01')`).run();

function snap(label) {
  const sku = db.prepare("SELECT cost_balance_qty AS qty, weighted_avg_cost AS avg FROM erp_skus WHERE id='sku1'").get();
  const stocks = db.prepare("SELECT account_id, SUM(available_qty) AS qty FROM erp_inventory_batches WHERE sku_id='sku1' GROUP BY account_id").all();
  const stockMap = Object.fromEntries(stocks.map(s => [s.account_id, s.qty]));
  console.log(`${label}  SKU总qty=${sku.qty} avg=${sku.avg.toFixed(4)}  仓存=${JSON.stringify(stockMap)}`);
  return { sku, stocks: stockMap };
}

let pass = 0, fail = 0;
function expect(label, actual, expected) {
  const ok = Math.abs(Number(actual) - Number(expected)) < 0.0001;
  console.log(`  ${ok ? "✅" : "❌"} ${label}  实际=${actual}  期望=${expected}`);
  if (ok) pass++; else fail++;
}

// 初始化：模拟一笔采购入库 100 @ 2.0 → 进 acct_A
const now = "2026-05-01T00:00:00.000Z";
db.prepare(`INSERT INTO erp_inventory_batches (
  id, account_id, batch_code, sku_id, received_qty, available_qty, unit_landed_cost, qc_status, received_at, created_at, updated_at
) VALUES ('b1', 'acct_A', 'CODE-001', 'sku1', 100, 100, 2.0, 'passed', ?, ?, ?)`).run(now, now, now);
svc.applySkuCostChange("sku1", 100, 2.0);
snap("[初始] 采购入库 100@2.0 → acct_A");

console.log("\n=== 1. 采购退货 30 件（按退货单价冲库存金额，重算剩余均价）===");
svc.applyDirectOutbound({
  accountId: "acct_A",
  skuId: "sku1",
  qty: 30,
  unitCost: 2.4,  // 按退货单价冲库存金额
  ledgerType: INVENTORY_LEDGER_TYPE.PURCHASE_RETURN,
  sourceDocType: "purchase_return",
  sourceDocId: "PR-001",
  affectSkuTotal: true,
});
let s = snap("采购退货 30");
expect("acct_A 剩 70", s.stocks.acct_A, 70);
expect("SKU 总量=70", s.sku.qty, 70);
expect("均价=(100*2.0-30*2.4)/70", s.sku.avg, 128 / 70);

console.log("\n=== 2. 客户退货 20 件 到 acct_B（平台仓）===");
svc.applyDirectInbound({
  accountId: "acct_B",
  skuId: "sku1",
  qty: 20,
  unitLandedCost: svc.getSkuWeightedAvgCost("sku1"),  // 按当前均价灌
  ledgerType: INVENTORY_LEDGER_TYPE.CUSTOMER_RETURN,
  sourceDocType: "customer_return",
  sourceDocId: "CR-001",
  affectSkuTotal: true,
});
s = snap("客户退货 20");
expect("acct_A 仍 70", s.stocks.acct_A, 70);
expect("acct_B 有 20", s.stocks.acct_B, 20);
expect("SKU 总量=90", s.sku.qty, 90);
expect("均价仍为采购退货后的均价", s.sku.avg, 128 / 70);

console.log("\n=== 3. 调拨 50 件 acct_A → acct_C（搬位置，总量不变）===");
const transferUnitCost = svc.getSkuWeightedAvgCost("sku1");
db.transaction(() => {
  svc.applyDirectOutbound({
    accountId: "acct_A",
    skuId: "sku1",
    qty: 50,
    unitCost: transferUnitCost,
    ledgerType: INVENTORY_LEDGER_TYPE.TRANSFER_OUT,
    sourceDocType: "transfer",
    sourceDocId: "T-001",
    affectSkuTotal: false,
  });
  svc.applyDirectInbound({
    accountId: "acct_C",
    skuId: "sku1",
    qty: 50,
    unitLandedCost: transferUnitCost,
    ledgerType: INVENTORY_LEDGER_TYPE.TRANSFER_IN,
    sourceDocType: "transfer",
    sourceDocId: "T-001",
    affectSkuTotal: false,
  });
})();
s = snap("调拨 50 A→C");
expect("acct_A 剩 20", s.stocks.acct_A, 20);
expect("acct_B 仍 20", s.stocks.acct_B, 20);
expect("acct_C 有 50", s.stocks.acct_C, 50);
expect("SKU 总量仍=90", s.sku.qty, 90);  // 关键：总量不变
expect("均价仍为采购退货后的均价", s.sku.avg, 128 / 70);

console.log("\n=== 4. 平台退回自家仓 15 件 acct_B → acct_A（同调拨规则）===");
const returnUnitCost = svc.getSkuWeightedAvgCost("sku1");
db.transaction(() => {
  svc.applyDirectOutbound({
    accountId: "acct_B",
    skuId: "sku1",
    qty: 15,
    unitCost: returnUnitCost,
    ledgerType: INVENTORY_LEDGER_TYPE.PLATFORM_RETURN_OUT,
    sourceDocType: "platform_return",
    sourceDocId: "PR-002",
    affectSkuTotal: false,
  });
  svc.applyDirectInbound({
    accountId: "acct_A",
    skuId: "sku1",
    qty: 15,
    unitLandedCost: returnUnitCost,
    ledgerType: INVENTORY_LEDGER_TYPE.PLATFORM_RETURN_IN,
    sourceDocType: "platform_return",
    sourceDocId: "PR-002",
    affectSkuTotal: false,
  });
})();
s = snap("平台退回 15 B→A");
expect("acct_A 增到 35", s.stocks.acct_A, 35);
expect("acct_B 剩 5", s.stocks.acct_B, 5);
expect("acct_C 仍 50", s.stocks.acct_C, 50);
expect("SKU 总量仍=90", s.sku.qty, 90);
expect("均价仍为采购退货后的均价", s.sku.avg, 128 / 70);

// 验证 ledger 流水类型分布
console.log("\n=== Ledger 类型分布 ===");
const ledgers = db.prepare("SELECT type, COUNT(*) cnt, SUM(qty_delta) sum FROM erp_inventory_ledger_entries GROUP BY type").all();
ledgers.forEach(l => console.log(`  ${l.type}: ${l.cnt} 条, sum_delta=${l.sum}`));

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
