// 自测：SKU 移动加权 + 出库 unit_cost
// 跑：set ELECTRON_RUN_AS_NODE=1 && node scripts/test-sku-weighted-cost.cjs
//   或 普通 node（如果 better-sqlite3 ABI 兼容）

const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(":memory:");

// 最小 schema：只造测试需要的两张表
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
  CREATE TABLE erp_inventory_cost_events (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_time TEXT NOT NULL,
    qty_delta REAL NOT NULL DEFAULT 0,
    old_qty REAL NOT NULL DEFAULT 0,
    new_qty REAL NOT NULL DEFAULT 0,
    unit_cost REAL,
    old_weighted_avg_cost REAL,
    new_weighted_avg_cost REAL,
    source_doc_type TEXT,
    source_doc_id TEXT,
    severity TEXT NOT NULL DEFAULT 'info',
    status TEXT NOT NULL DEFAULT 'recorded',
    message TEXT,
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE erp_sku_cost_daily_snapshot (
    sku_id TEXT NOT NULL,
    stat_date TEXT NOT NULL,
    weighted_avg_cost REAL NOT NULL DEFAULT 0,
    cost_balance_qty REAL NOT NULL DEFAULT 0,
    source_event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (sku_id, stat_date)
  );
`);

const { InventoryService } = require(path.join(
  __dirname,
  "..",
  "electron",
  "erp",
  "services",
  "inventoryService.cjs",
));

const svc = new InventoryService({ db, workflow: {} });

// 准备一个 SKU
db.prepare(`
  INSERT INTO erp_skus (id, internal_sku_code, product_name, created_at, updated_at)
  VALUES ('sku1', 'TEST001', 'Test SKU', '2026-01-01', '2026-01-01')
`).run();

function snap(label) {
  const sku = db.prepare("SELECT cost_balance_qty AS qty, weighted_avg_cost AS avg FROM erp_skus WHERE id='sku1'").get();
  console.log(`${label}  qty=${sku.qty}  avg=${sku.avg.toFixed(4)}`);
  return sku;
}

let pass = 0, fail = 0;
function expect(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.0001;
  console.log(`  ${ok ? "✅" : "❌"} ${label}  实际=${actual}  期望=${expected}`);
  if (ok) pass++; else fail++;
}

function expectThrows(label, fn, pattern) {
  try {
    fn();
    console.log(`  ❌ ${label}  未抛错`);
    fail++;
  } catch (error) {
    const ok = pattern.test(String(error?.message || error));
    console.log(`  ${ok ? "✅" : "❌"} ${label}  ${error.message}`);
    if (ok) pass++; else fail++;
  }
}

console.log("\n=== 场景：典型采购入库 + 平台销售出货流转 ===\n");

snap("初始");

// 1. 采购入库 100 @ 2.0
svc.applySkuCostChange("sku1", 100, 2.0);
let s = snap("入库 100 @ 2.0");
expect("数量=100", s.qty, 100);
expect("均价=2.0", s.avg, 2.0);

// 2. 再入库 100 @ 2.4
svc.applySkuCostChange("sku1", 100, 2.4);
s = snap("入库 100 @ 2.4");
expect("数量=200", s.qty, 200);
expect("均价=2.2 (加权)", s.avg, 2.2);

// 3. 平台销售出货 50 件
svc.applySkuCostChange("sku1", -50);
s = snap("销售出货 50");
expect("数量=150", s.qty, 150);
expect("均价不变=2.2", s.avg, 2.2);

// 4. 取均价（用于写出库 ledger.unit_cost）
const unitCost = svc.getSkuWeightedAvgCost("sku1");
expect("getSkuWeightedAvgCost=2.2", unitCost, 2.2);

// 5. 客户退货 20 件（按当时均价回灌，数学上均价不变）
svc.applySkuCostChange("sku1", 20, 2.2);
s = snap("客户退货 20");
expect("数量=170", s.qty, 170);
expect("均价仍=2.2", s.avg, 2.2);

// 6. 普通出库扣减 30 件（只扣数量，均价不变）
svc.applySkuCostChange("sku1", -30);
s = snap("出库扣减 30");
expect("数量=140", s.qty, 140);
expect("均价仍=2.2", s.avg, 2.2);

// 7. 第三次入库（不同价位）70 @ 1.8
svc.applySkuCostChange("sku1", 70, 1.8);
s = snap("入库 70 @ 1.8");
expect("数量=210", s.qty, 210);
// 新均价 = (140*2.2 + 70*1.8) / 210 = (308 + 126) / 210 = 434/210 ≈ 2.0667
expect("均价=2.0667", s.avg, 2.0667);

// 8. 入库成本为空/0 必须拦截，不允许把库存成本打成 0
expectThrows("0 成本入库被拦截", () => svc.applySkuCostChange("sku1", 10, 0), /greater than 0/i);
s = snap("0 成本拦截后");
expect("数量仍=210", s.qty, 210);
expect("均价仍=2.0667", s.avg, 2.0667);

// 9. 明显输错单价（偏离当前均价超过 50%）必须先挡住
expectThrows("异常高价入库被拦截", () => svc.applySkuCostChange("sku1", 1, 20), /more than 50%/i);
s = snap("异常高价拦截后");
expect("数量仍=210", s.qty, 210);
expect("均价仍=2.0667", s.avg, 2.0667);

const blockedEvents = db.prepare(`
  SELECT COUNT(*) AS n
    FROM erp_inventory_cost_events
   WHERE status = 'blocked'
`).get().n;
expect("已记录 2 条拦截事件", blockedEvents, 2);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
