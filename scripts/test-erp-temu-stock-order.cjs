// Temu 备货单镜像服务回归测试：同步幂等 / SKU 匹配 / resolveOutboundTarget 状态机。
// 仅覆盖 service 层（syncFromCollection / list / resolveOutboundTarget）；
// ipc 的 create-outbound 编排依赖 electron ipc 运行时，不在此单测范围。
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");
const { createErpServices } = require("../electron/erp/services/index.cjs");
const { nowIso } = require("../electron/erp/services/utils.cjs");

const ACTOR = Object.freeze({ id: null, role: "admin", name: "temu-so-test" });

function seed(db) {
  const now = nowIso();
  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO erp_accounts (id, name, status, source, created_at, updated_at)
      VALUES ('acc1', 'Temu SO test account', 'online', 'test', @now, @now)
    `).run({ now });

    db.prepare(`
      INSERT INTO erp_skus (
        id, account_id, internal_sku_code, temu_skc_id, product_name,
        status, created_at, updated_at
      )
      VALUES ('sku1', 'acc1', 'INT-1', 'SKC-9', 'Demo Product', 'active', @now, @now)
    `).run({ now });

    // 已通过 QC、有可用库存的批次（供 resolveOutboundTarget 选批次）。
    db.prepare(`
      INSERT INTO erp_inventory_batches (
        id, account_id, batch_code, sku_id, received_qty, available_qty,
        reserved_qty, blocked_qty, defective_qty, rework_qty, unit_landed_cost,
        qc_status, received_at, created_at, updated_at
      )
      VALUES (
        'b1', 'acc1', 'B1', 'sku1', 100, 100, 0, 0, 0, 0, 1,
        'passed', @now, @now, @now
      )
    `).run({ now });
  });
  run();
}

function runTest() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "temu-erp-so-"));
  let db;

  try {
    runMigrations({ userDataDir: tempUserData, backup: false });
    db = openErpDatabase({ userDataDir: tempUserData });
    seed(db);

    const services = createErpServices(db);
    const svc = services.temuStockOrder;

    // 1. 同步：PO-1 能按 SKC 匹配；PO-2 匹配不上；空单号跳过。
    const res = svc.syncFromCollection({
      accountId: "acc1",
      actor: ACTOR,
      orders: [
        { purchaseOrderNo: "PO-1", skcId: "SKC-9", skuId: "SKU-9", quantity: 30, status: "待发货", title: "P", warehouse: "W1" },
        { purchaseOrderNo: "PO-2", skcId: "SKC-X", quantity: 5, status: "待发货" },
        { purchaseOrderNo: "", skcId: "SKC-9", quantity: 1 },
      ],
    });
    assert.deepEqual(res, { synced: 2, matched: 1, unmatched: 1 });

    // 2. 幂等 + outbound_created 不被覆盖，但其它字段仍刷新。
    db.prepare("UPDATE erp_temu_stock_orders SET sync_status='outbound_created' WHERE temu_purchase_order_no='PO-1'").run();
    svc.syncFromCollection({
      accountId: "acc1",
      actor: ACTOR,
      orders: [{ purchaseOrderNo: "PO-1", skcId: "SKC-9", quantity: 30, status: "已发货" }],
    });
    const po1 = db.prepare("SELECT * FROM erp_temu_stock_orders WHERE temu_purchase_order_no='PO-1'").get();
    assert.equal(po1.sync_status, "outbound_created");
    assert.equal(po1.temu_status, "已发货");

    // 3. list：账号过滤 + 状态过滤。
    assert.equal(svc.list({ accountId: "acc1" }).length, 2);
    assert.equal(svc.list({ accountId: "acc1", status: "unmatched" }).length, 1);
    assert.equal(svc.list({ accountId: "acc1", status: "outbound_created" }).length, 1);

    // 4. resolveOutboundTarget：未匹配 SKU → 抛错并置 unmatched。
    const po2 = db.prepare("SELECT id FROM erp_temu_stock_orders WHERE temu_purchase_order_no='PO-2'").get();
    assert.throws(() => svc.resolveOutboundTarget(po2.id), /not mapped/);
    assert.equal(
      db.prepare("SELECT sync_status FROM erp_temu_stock_orders WHERE id=?").get(po2.id).sync_status,
      "unmatched",
    );

    // 5. resolveOutboundTarget：已匹配且库存足 → 选到批次 b1。
    const target = svc.resolveOutboundTarget(po1.id);
    assert.equal(target.batch.id, "b1");
    assert.equal(target.stockOrder.demand_qty, 30);

    // 6. resolveOutboundTarget：需求超过可用 → 置 unfulfillable 并抛错。
    svc.syncFromCollection({
      accountId: "acc1",
      actor: ACTOR,
      orders: [{ purchaseOrderNo: "PO-3", skcId: "SKC-9", quantity: 9999, status: "待发货" }],
    });
    const po3 = db.prepare("SELECT id FROM erp_temu_stock_orders WHERE temu_purchase_order_no='PO-3'").get();
    assert.throws(() => svc.resolveOutboundTarget(po3.id), /enough available/);
    assert.equal(
      db.prepare("SELECT sync_status FROM erp_temu_stock_orders WHERE id=?").get(po3.id).sync_status,
      "unfulfillable",
    );

    console.log("ERP Temu stock order service check passed");
  } finally {
    if (db) db.close();
    if (!process.exitCode) {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    }
  }
}

runTest();
