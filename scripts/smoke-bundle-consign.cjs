"use strict";

// 组合装出库 BOM 拆解 离线冒烟测试。
// 验证：expand 展开、可售套数 SQL、聚水潭/官方两路 ship+unship 扣回库存、库存不足整单原子回滚。
// 跑法（better-sqlite3 编译给 Electron ABI，须用 electron 当纯 node 跑）：
//   $env:ELECTRON_RUN_AS_NODE="1"; node_modules\.bin\electron scripts\smoke-bundle-consign.cjs

const path = require("path");
const Database = require("better-sqlite3");
const SVC = path.join(__dirname, "..", "electron", "erp", "services");
const { InventoryService } = require(path.join(SVC, "inventoryService.cjs"));
const consign = require(path.join(SVC, "consignDeliverShip.cjs"));

// Windows 上 electron.exe 是 GUI 子系统程序，console.log 不回传终端 → 镜像到文件。
const fs = require("fs");
const _lines = [];
const _origLog = console.log.bind(console);
console.log = (...a) => { _lines.push(a.map(String).join(" ")); _origLog(...a); };
process.on("exit", () => { try { fs.writeFileSync(path.join(__dirname, "smoke-bundle-consign.out.txt"), _lines.join("\n"), "utf8"); } catch (e) { /* ignore */ } });

const db = new Database(":memory:");
const NOW = "2026-06-04T00:00:00.000Z";

db.exec(`
CREATE TABLE erp_skus (
  id TEXT PRIMARY KEY, company_id TEXT, account_id TEXT, internal_sku_code TEXT,
  product_name TEXT, sku_type TEXT DEFAULT 'single', status TEXT DEFAULT 'active',
  weighted_avg_cost REAL DEFAULT 0, cost_balance_qty REAL DEFAULT 0, updated_at TEXT
);
CREATE TABLE erp_sku_bundle_components (
  id TEXT PRIMARY KEY, company_id TEXT, bundle_sku_id TEXT, component_sku_id TEXT,
  qty REAL DEFAULT 1, unit_cost REAL, sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE erp_inventory_batches (
  id TEXT PRIMARY KEY, account_id TEXT, batch_code TEXT, sku_id TEXT, po_id TEXT, inbound_receipt_id TEXT,
  received_qty REAL DEFAULT 0, available_qty REAL DEFAULT 0, reserved_qty REAL DEFAULT 0,
  blocked_qty REAL DEFAULT 0, defective_qty REAL DEFAULT 0, rework_qty REAL DEFAULT 0,
  unit_landed_cost REAL, qc_status TEXT DEFAULT 'passed', location_code TEXT,
  received_at TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE erp_inventory_ledger_entries (
  id TEXT PRIMARY KEY, account_id TEXT, sku_id TEXT, batch_id TEXT, type TEXT, qty_delta REAL,
  from_bucket TEXT, to_bucket TEXT, unit_cost REAL, source_doc_type TEXT, source_doc_id TEXT,
  created_at TEXT, created_by TEXT
);
CREATE TABLE erp_accounts (id TEXT PRIMARY KEY, name TEXT, company_id TEXT);
CREATE TABLE jst_consign_deliveries (
  company_id TEXT, o_id INTEGER, shop_name TEXT, status_internal TEXT DEFAULT 'active',
  inventory_deducted INTEGER DEFAULT 0, local_status_override TEXT, inventory_ledger_json TEXT,
  local_status_by TEXT, local_status_at TEXT, updated_at TEXT
);
CREATE TABLE jst_consign_deliver_items (
  company_id TEXT, o_id INTEGER, oi_id TEXT, sku_code TEXT, i_id TEXT, name TEXT, sku_id TEXT,
  qty REAL, local_ship_qty REAL, status_internal TEXT DEFAULT 'active', updated_at TEXT
);
CREATE TABLE erp_temu_openapi_consign (mall_id TEXT, so_id TEXT, items_json TEXT);
CREATE TABLE erp_consign_local_state (
  mall_id TEXT, so_id TEXT, inventory_deducted INTEGER DEFAULT 0, local_status_override TEXT,
  ship_qty_json TEXT, inventory_ledger_json TEXT, local_status_by TEXT, local_status_at TEXT, updated_at TEXT,
  PRIMARY KEY (mall_id, so_id)
);
CREATE TABLE erp_temu_openapi_skus (product_sku_id TEXT, ext_code TEXT);
`);

// ---- 造数据：店铺 acc1；子商品 A(砧板,库存10,均价3) + B(海绵,库存6,均价1)；组合装 BD001 = A×1 + B×2 ----
db.prepare("INSERT INTO erp_accounts (id,name,company_id) VALUES (?,?,?)").run("acc1", "测试店", "company_default");
const insSku = db.prepare(
  "INSERT INTO erp_skus (id,company_id,account_id,internal_sku_code,product_name,sku_type,weighted_avg_cost,cost_balance_qty,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
);
insSku.run("skuA", "company_default", "acc1", "A001", "砧板", "single", 3, 10, NOW);
insSku.run("skuB", "company_default", "acc1", "B001", "海绵", "single", 1, 6, NOW);
insSku.run("bundle1", "company_default", "acc1", "BD001", "砧板海绵套装", "bundle", 0, 0, NOW);
const addBatch = (id, sku, qty, cost) => db.prepare(
  "INSERT INTO erp_inventory_batches (id,account_id,batch_code,sku_id,received_qty,available_qty,unit_landed_cost,qc_status,received_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'passed',?,?,?)",
).run(id, "acc1", id, sku, qty, qty, cost, NOW, NOW, NOW);
addBatch("bA", "skuA", 10, 3);
addBatch("bB", "skuB", 6, 1);
const insComp = db.prepare(
  "INSERT INTO erp_sku_bundle_components (id,company_id,bundle_sku_id,component_sku_id,qty,unit_cost,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)",
);
insComp.run("c1", "company_default", "bundle1", "skuA", 1, 3, 0, NOW, NOW);
insComp.run("c2", "company_default", "bundle1", "skuB", 2, 1, 1, NOW, NOW);

const inventory = new InventoryService({ db, workflow: { transition() {} } });
const services = { inventory };
const actor = { id: "u1", name: "tester" };

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg); } };
const avail = (sku) => Number(db.prepare("SELECT COALESCE(SUM(available_qty),0) q FROM erp_inventory_batches WHERE sku_id=?").get(sku).q);
const expectThrow = (fn, re, msg) => {
  try { fn(); fail++; console.log("  FAIL  " + msg + "（未抛错）"); }
  catch (e) { const ok = re.test(e.message || ""); if (ok) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg + "（错误信息不符：" + e.message + "）"); } }
};

// ---- T1 expand 展开 ----
console.log("\n[T1] expandSkuToInventoryLines");
const ex = consign.expandSkuToInventoryLines(db, { skuId: "bundle1", qty: 3, fallbackAccountId: "acc1" });
assert(ex.length === 2, "组合装展开成 2 个子商品行");
assert(ex.find((l) => l.skuId === "skuA")?.qty === 3, "A 数量 = 3套 × 1 = 3");
assert(ex.find((l) => l.skuId === "skuB")?.qty === 6, "B 数量 = 3套 × 2 = 6");
assert(ex.every((l) => l.accountId === "acc1"), "子商品行 account = 子商品自绑店铺 acc1");
assert(ex.every((l) => l.bundleSkuCode === "BD001"), "子商品行带组合装编码 BD001");
const exSingle = consign.expandSkuToInventoryLines(db, { skuId: "skuA", qty: 5, fallbackAccountId: "acc1" });
assert(exSingle.length === 1 && exSingle[0].bundleSkuCode === null, "普通商品原样一行、bundleSkuCode 为空");

// ---- T2 可售套数 SQL（与 ipc.cjs listSkus 的 bundle_stock 子查询同口径）----
console.log("\n[T2] 可售套数 SQL");
const setsSql = `
  SELECT c.bundle_sku_id, MIN(CAST(COALESCE(ci.total_qty,0)/c.qty AS INTEGER)) AS available_sets
  FROM erp_sku_bundle_components c
  LEFT JOIN (SELECT sku_id, SUM(available_qty+reserved_qty+blocked_qty+defective_qty+rework_qty) total_qty FROM erp_inventory_batches GROUP BY sku_id) ci
    ON ci.sku_id = c.component_sku_id
  WHERE c.status='active' AND c.qty>0 GROUP BY c.bundle_sku_id`;
const sets = db.prepare(setsSql).get();
assert(Number(sets.available_sets) === 3, "可售套数 = min(floor(10/1), floor(6/2)) = 3");

// ---- T3 聚水潭单 ship（货号=组合装 BD001, 备货 3 套）----
console.log("\n[T3] 聚水潭单确认发货（拆 BOM 扣子商品）");
db.prepare("INSERT INTO jst_consign_deliveries (company_id,o_id,shop_name,status_internal,inventory_deducted) VALUES (?,?,?,?,0)").run("company_default", 1001, "测试店", "active");
db.prepare("INSERT INTO jst_consign_deliver_items (company_id,o_id,oi_id,sku_code,name,qty,status_internal) VALUES (?,?,?,?,?,?,?)").run("company_default", 1001, "oi1", "BD001", "砧板海绵套装", 3, "active");
const r3 = consign.shipConsignDelivery({ db, services, oId: 1001, companyId: "company_default", actor });
assert(r3.deducted === true, "发货成功");
assert(avail("skuA") === 7, "A 库存 10 → 7（扣 3）");
assert(avail("skuB") === 0, "B 库存 6 → 0（扣 6）");
assert(Number(db.prepare("SELECT inventory_deducted FROM jst_consign_deliveries WHERE o_id=1001").get().inventory_deducted) === 1, "单头标记已扣减");

// ---- T4 聚水潭单 unship 回补 ----
console.log("\n[T4] 聚水潭单撤销发货（回补子商品）");
const r4 = consign.unshipConsignDelivery({ db, services, oId: 1001, companyId: "company_default", actor });
assert(r4.restored === true, "撤销成功");
assert(avail("skuA") === 10, "A 库存回补 → 10");
assert(avail("skuB") === 6, "B 库存回补 → 6");

// ---- T5 聚水潭单 库存不足 → 整单原子回滚 ----
console.log("\n[T5] 聚水潭单库存不足（4 套需 B 8 > 6）→ 原子回滚");
db.prepare("INSERT INTO jst_consign_deliveries (company_id,o_id,shop_name,status_internal,inventory_deducted) VALUES (?,?,?,?,0)").run("company_default", 1002, "测试店", "active");
db.prepare("INSERT INTO jst_consign_deliver_items (company_id,o_id,oi_id,sku_code,name,qty,status_internal) VALUES (?,?,?,?,?,?,?)").run("company_default", 1002, "oi2", "BD001", "砧板海绵套装", 4, "active");
expectThrow(() => consign.shipConsignDelivery({ db, services, oId: 1002, companyId: "company_default", actor }), /组合装 BD001 的子商品 B001.*库存不足/, "报错指明组合装+子商品+店铺");
assert(avail("skuA") === 10, "A 未被扣（原子回滚，即便 A 够也整单不扣）");
assert(avail("skuB") === 6, "B 未被扣");

// ---- T6 官方备货单 cloud ship（货号=BD001, 2 套）----
console.log("\n[T6] 官方备货单确认发货（拆 BOM 扣子商品）");
db.prepare("INSERT INTO erp_temu_openapi_consign (mall_id,so_id,items_json) VALUES (?,?,?)").run("m1", "s1", JSON.stringify([{ skuId: "psku1", iId: "BD001", name: "砧板海绵套装", qty: 2 }]));
const r6 = consign.shipCloudConsignDelivery({ db, services, mallId: "m1", soId: "s1", actor });
assert(r6.deducted === true, "发货成功");
assert(avail("skuA") === 8, "A 库存 10 → 8（扣 2）");
assert(avail("skuB") === 2, "B 库存 6 → 2（扣 4）");

// ---- T7 官方备货单 cloud unship（按 ledger 原样回补）----
console.log("\n[T7] 官方备货单撤销发货（按扣减流水回补）");
const r7 = consign.unshipCloudConsignDelivery({ db, services, mallId: "m1", soId: "s1", actor });
assert(r7.restored === true, "撤销成功");
assert(avail("skuA") === 10, "A 库存回补 → 10");
assert(avail("skuB") === 6, "B 库存回补 → 6");

// ---- T8 官方备货单 库存不足 → 原子回滚 ----
console.log("\n[T8] 官方备货单库存不足（4 套需 B 8 > 6）→ 原子回滚");
db.prepare("INSERT INTO erp_temu_openapi_consign (mall_id,so_id,items_json) VALUES (?,?,?)").run("m1", "s2", JSON.stringify([{ skuId: "psku1", iId: "BD001", name: "砧板海绵套装", qty: 4 }]));
expectThrow(() => consign.shipCloudConsignDelivery({ db, services, mallId: "m1", soId: "s2", actor }), /组合装 BD001 的子商品 B001.*库存不足/, "报错指明组合装+子商品");
assert(avail("skuA") === 10, "A 未被扣（原子回滚）");
assert(avail("skuB") === 6, "B 未被扣");

console.log(`\n===== 冒烟结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
