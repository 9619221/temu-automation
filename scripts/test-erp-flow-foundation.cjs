const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { listMigrationFiles, runMigrations } = require("../electron/db/migrate.cjs");
const { createErpServices } = require("../electron/erp/services/index.cjs");
const {
  ERP_ROLES,
  BATCH_QC_STATUS,
  INVENTORY_LEDGER_TYPE,
  OUTBOUND_SHIPMENT_STATUS,
  PURCHASE_ORDER_STATUS,
  PURCHASE_REQUEST_STATUS,
  PURCHASE_SOURCE,
  QC_INSPECTION_STATUS,
  SOURCING_CANDIDATE_STATUS,
  SOURCING_METHOD,
} = require("../electron/erp/workflow/enums.cjs");
const {
  WorkflowTransitionError,
  decideQCResult,
} = require("../electron/erp/workflow/validators.cjs");
const { nowIso } = require("../electron/erp/services/utils.cjs");

const ACTORS = Object.freeze({
  ops: { id: "user_ops", role: ERP_ROLES.OPERATIONS },
  buyer: { id: "user_buyer", role: ERP_ROLES.BUYER },
  finance: { id: "user_finance", role: ERP_ROLES.FINANCE },
  warehouse: { id: "user_warehouse", role: ERP_ROLES.WAREHOUSE },
});

function insertSeedData(db) {
  const now = nowIso();
  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO erp_accounts (id, name, status, source, created_at, updated_at)
      VALUES ('acct_demo', 'ERP flow demo account', 'online', 'test', @now, @now)
    `).run({ now });

    for (const [name, actor] of Object.entries(ACTORS)) {
      db.prepare(`
        INSERT INTO erp_users (id, name, role, status, created_at, updated_at)
        VALUES (@id, @name, @role, 'active', @now, @now)
      `).run({
        id: actor.id,
        name,
        role: actor.role,
        now,
      });
    }

    db.prepare(`
      INSERT INTO erp_suppliers (id, name, contact_name, phone, wechat, status, created_at, updated_at)
      VALUES ('supplier_demo', 'Demo Supplier', 'Lily', '13800000000', 'demo_supplier', 'active', @now, @now)
    `).run({ now });

    db.prepare(`
      INSERT INTO erp_skus (
        id, account_id, internal_sku_code, product_name, category, supplier_id,
        status, created_at, updated_at
      )
      VALUES (
        'sku_demo', 'acct_demo', 'SKU-DEMO-001', 'Demo Product', 'daily',
        'supplier_demo', 'active', @now, @now
      )
    `).run({ now });

    db.prepare(`
      INSERT INTO erp_purchase_requests (
        id, account_id, sku_id, requested_by, reason, requested_qty,
        target_unit_cost, evidence_json, status, created_at, updated_at
      )
      VALUES (
        'pr_demo', 'acct_demo', 'sku_demo', @ops_id, 'replenishment', 100,
        12.5, '["7日销量上升", "库存不足"]', 'draft', @now, @now
      )
    `).run({
      ops_id: ACTORS.ops.id,
      now,
    });

    db.prepare(`
      INSERT INTO erp_sourcing_candidates (
        id, account_id, pr_id, purchase_source, sourcing_method, supplier_id,
        supplier_name, product_title, unit_price, moq, lead_days, status,
        created_by, created_at, updated_at
      )
      VALUES (
        'candidate_demo', 'acct_demo', 'pr_demo', @purchase_source,
        @sourcing_method, 'supplier_demo', 'Demo Supplier', 'Demo 1688 Product',
        12.5, 50, 3, 'candidate', @buyer_id, @now, @now
      )
    `).run({
      purchase_source: PURCHASE_SOURCE.EXISTING_SUPPLIER,
      sourcing_method: SOURCING_METHOD.MANUAL,
      buyer_id: ACTORS.buyer.id,
      now,
    });

    db.prepare(`
      INSERT INTO erp_purchase_orders (
        id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
        status, payment_status, expected_delivery_date, total_amount,
        created_by, created_at, updated_at
      )
      VALUES (
        'po_demo', 'acct_demo', 'pr_demo', 'candidate_demo', 'supplier_demo',
        'PO-DEMO-001', 'draft', 'unpaid', '2026-05-05', 1250,
        @buyer_id, @now, @now
      )
    `).run({
      buyer_id: ACTORS.buyer.id,
      now,
    });

    db.prepare(`
      INSERT INTO erp_purchase_order_lines (
        id, account_id, po_id, sku_id, qty, unit_cost, expected_qty, received_qty
      )
      VALUES ('po_line_demo', 'acct_demo', 'po_demo', 'sku_demo', 100, 12.5, 100, 0)
    `).run();

    db.prepare(`
      INSERT INTO erp_inbound_receipts (
        id, account_id, po_id, receipt_no, status, created_at, updated_at
      )
      VALUES ('inbound_demo', 'acct_demo', 'po_demo', 'IN-DEMO-001', 'pending_arrival', @now, @now)
    `).run({ now });

    db.prepare(`
      INSERT INTO erp_inbound_receipt_lines (
        id, account_id, receipt_id, po_line_id, sku_id, expected_qty, received_qty
      )
      VALUES ('inbound_line_demo', 'acct_demo', 'inbound_demo', 'po_line_demo', 'sku_demo', 100, 100)
    `).run();
  });

  insert();
}

function insertQcInspection(db, batchId) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO erp_qc_inspections (
      id, account_id, batch_id, sku_id, status, suggested_sample_qty,
      actual_sample_qty, defective_qty, defect_rate, inspector_id,
      created_at, updated_at
    )
    VALUES (
      'qc_demo', 'acct_demo', @batch_id, 'sku_demo', 'pending_qc', 20,
      0, 0, 0, @inspector_id, @now, @now
    )
  `).run({
    batch_id: batchId,
    inspector_id: ACTORS.ops.id,
    now,
  });
}

function insertOutboundShipment(db, batchId) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO erp_outbound_shipments (
      id, account_id, shipment_no, sku_id, batch_id, qty, boxes, status,
      created_at, updated_at
    )
    VALUES (
      'outbound_demo', 'acct_demo', 'OUT-DEMO-001', 'sku_demo', @batch_id,
      80, 4, 'draft', @now, @now
    )
  `).run({
    batch_id: batchId,
    now,
  });
}

function assertTableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  assert.ok(row, `Expected table ${tableName} to exist`);
}

function assertColumnExists(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  assert.ok(
    columns.some((column) => column.name === columnName),
    `Expected column ${tableName}.${columnName} to exist`,
  );
}

function assertColumnNullable(db, tableName, columnName) {
  const column = db.prepare(`PRAGMA table_info(${tableName})`).all()
    .find((item) => item.name === columnName);
  assert.ok(column, `Expected column ${tableName}.${columnName} to exist`);
  assert.equal(column.notnull, 0, `Expected column ${tableName}.${columnName} to be nullable`);
}

function assertTransitionDenied(fn) {
  assert.throws(fn, (error) => (
    error instanceof WorkflowTransitionError
    && error.code === "ERP_WORKFLOW_TRANSITION_DENIED"
  ));
}

function assertQcThresholds() {
  assert.equal(
    decideQCResult({ actualSampleQty: 20, defectiveQty: 0 }).recommendedStatus,
    QC_INSPECTION_STATUS.PASSED,
  );
  assert.equal(
    decideQCResult({ actualSampleQty: 20, defectiveQty: 1 }).recommendedStatus,
    QC_INSPECTION_STATUS.PASSED_WITH_OBSERVATION,
  );
  assert.equal(
    decideQCResult({ actualSampleQty: 20, defectiveQty: 2 }).recommendedStatus,
    QC_INSPECTION_STATUS.PARTIAL_PASSED,
  );
  assert.equal(
    decideQCResult({ actualSampleQty: 20, defectiveQty: 4 }).recommendedStatus,
    QC_INSPECTION_STATUS.FAILED,
  );
}

function runFlow() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "temu-erp-flow-"));
  let db;

  try {
    const migrationResult = runMigrations({
      userDataDir: tempUserData,
      backup: false,
    });
    assert.equal(
      migrationResult.migrations.filter((item) => item.status === "success").length,
      listMigrationFiles().length,
    );

    db = openErpDatabase({ userDataDir: tempUserData });
    for (const tableName of [
      "erp_companies",
      "erp_accounts",
      "erp_users",
      "erp_skus",
      "erp_purchase_requests",
      "erp_sourcing_candidates",
      "erp_purchase_orders",
      "erp_inbound_receipts",
      "erp_inventory_batches",
      "erp_qc_inspections",
      "erp_outbound_shipments",
      "erp_inventory_ledger_entries",
      "erp_work_items",
      "erp_work_item_events",
      "erp_audit_logs",
      "erp_1688_api_call_log",
      "erp_1688_message_events",
      "erp_1688_delivery_addresses",
      "erp_warehouses",
      "erp_role_permissions",
      "erp_user_resource_scopes",
    ]) {
      assertTableExists(db, tableName);
    }
    assertColumnExists(db, "erp_users", "company_id");
    assertColumnExists(db, "erp_accounts", "company_id");
    assertColumnExists(db, "erp_skus", "company_id");
    assertColumnNullable(db, "erp_skus", "account_id");
    assertColumnExists(db, "erp_1688_auth_settings", "company_id");
    assertColumnExists(db, "erp_1688_delivery_addresses", "company_id");
    assertColumnExists(db, "erp_sourcing_candidates", "external_offer_id");
    assertColumnExists(db, "erp_sourcing_candidates", "source_payload_json");
    assertColumnExists(db, "erp_sourcing_candidates", "external_sku_options_json");
    assertColumnExists(db, "erp_sourcing_candidates", "external_price_ranges_json");
    assertColumnExists(db, "erp_purchase_orders", "external_order_id");
    assertColumnExists(db, "erp_purchase_orders", "external_order_payload_json");
    assertColumnExists(db, "erp_purchase_orders", "external_order_preview_json");

    assertQcThresholds();
    insertSeedData(db);

    const services = createErpServices(db);
    const generatedWorkItems = services.workItem.generateFromCurrentState({ accountId: "acct_demo" }, ACTORS.ops);
    assert.equal(generatedWorkItems.summary.created, 2);
    assert.equal(
      generatedWorkItems.items.some((item) => item.owner_role === ERP_ROLES.BUYER),
      true,
    );
    assert.equal(
      generatedWorkItems.items.some((item) => item.owner_role === ERP_ROLES.WAREHOUSE),
      true,
    );

    assertTransitionDenied(() => services.purchase.submitRequest("pr_demo", ACTORS.warehouse));
    services.purchase.submitRequest("pr_demo", ACTORS.ops);
    services.purchase.acceptRequest("pr_demo", ACTORS.buyer);
    services.purchase.selectCandidate("candidate_demo", ACTORS.buyer);
    services.purchase.markRequestSourced("pr_demo", ACTORS.buyer);
    services.purchase.requestOperationsConfirm("pr_demo", ACTORS.buyer);
    services.purchase.confirmSourcing("pr_demo", ACTORS.ops);
    assert.equal(
      db.prepare("SELECT status FROM erp_purchase_requests WHERE id = 'pr_demo'").get().status,
      PURCHASE_REQUEST_STATUS.CONVERTED_TO_PO,
    );
    assert.equal(
      db.prepare("SELECT status FROM erp_sourcing_candidates WHERE id = 'candidate_demo'").get().status,
      SOURCING_CANDIDATE_STATUS.SELECTED,
    );

    services.purchase.submitPaymentApproval("po_demo", ACTORS.buyer);
    assertTransitionDenied(() => services.purchase.approvePayment("po_demo", ACTORS.ops));
    services.purchase.approvePayment("po_demo", ACTORS.finance);
    services.purchase.confirmPaid("po_demo", ACTORS.finance);
    services.purchase.markSupplierProcessing("po_demo", ACTORS.buyer);
    services.purchase.markSupplierShipped("po_demo", ACTORS.buyer);
    services.purchase.markArrived("po_demo", ACTORS.warehouse);

    services.inventory.registerArrival("inbound_demo", ACTORS.warehouse);
    services.inventory.confirmCount("inbound_demo", ACTORS.warehouse);
    services.inventory.markBatchesCreated("inbound_demo", ACTORS.warehouse);
    const batch = services.inventory.createBatchFromInbound({
      id: "batch_demo",
      accountId: "acct_demo",
      batchCode: "BATCH-DEMO-001",
      skuId: "sku_demo",
      poId: "po_demo",
      inboundReceiptId: "inbound_demo",
      receivedQty: 100,
      unitLandedCost: 12.5,
      locationCode: "A-01",
      actor: ACTORS.warehouse,
    });
    assert.equal(batch.available_qty, 0);
    assert.equal(batch.blocked_qty, 100);
    assert.equal(batch.qc_status, BATCH_QC_STATUS.PENDING);

    services.purchase.markInbounded("po_demo", ACTORS.warehouse);
    insertQcInspection(db, batch.id);
    services.qc.startInspection("qc_demo", ACTORS.ops);
    const qcResult = services.qc.submitByPercent({
      id: "qc_demo",
      actualSampleQty: 20,
      defectiveQty: 1,
      actor: ACTORS.ops,
    });
    assert.equal(qcResult.recommendedStatus, QC_INSPECTION_STATUS.PASSED_WITH_OBSERVATION);
    const batchAfterQc = services.inventory.getBatch(batch.id);
    assert.equal(batchAfterQc.available_qty, 100);
    assert.equal(batchAfterQc.blocked_qty, 0);
    assert.equal(batchAfterQc.qc_status, BATCH_QC_STATUS.PASSED_WITH_OBSERVATION);

    insertOutboundShipment(db, batch.id);
    services.outbound.submitOutbound("outbound_demo", ACTORS.ops);
    let batchAfterReserve = services.inventory.getBatch(batch.id);
    assert.equal(batchAfterReserve.available_qty, 20);
    assert.equal(batchAfterReserve.reserved_qty, 80);

    services.outbound.startPicking("outbound_demo", ACTORS.warehouse);
    services.outbound.markPacked("outbound_demo", ACTORS.warehouse, {
      boxes: 4,
      photos: ["packed-demo.jpg"],
    });
    services.outbound.confirmShippedOut("outbound_demo", ACTORS.warehouse, {
      logisticsProvider: "demo-logistics",
      trackingNo: "TRACK-DEMO-001",
    });
    batchAfterReserve = services.inventory.getBatch(batch.id);
    assert.equal(batchAfterReserve.available_qty, 20);
    assert.equal(batchAfterReserve.reserved_qty, 0);

    services.outbound.requestOperationsConfirm("outbound_demo", ACTORS.warehouse);
    services.outbound.confirmDone("outbound_demo", ACTORS.ops);
    assert.equal(
      db.prepare("SELECT status FROM erp_outbound_shipments WHERE id = 'outbound_demo'").get().status,
      OUTBOUND_SHIPMENT_STATUS.CONFIRMED,
    );

    services.purchase.closeOrder("po_demo", ACTORS.buyer);
    assert.equal(
      db.prepare("SELECT status FROM erp_purchase_orders WHERE id = 'po_demo'").get().status,
      PURCHASE_ORDER_STATUS.CLOSED,
    );

    const ledgerTypes = db.prepare(`
      SELECT type, COUNT(*) AS count
      FROM erp_inventory_ledger_entries
      GROUP BY type
    `).all().reduce((acc, row) => {
      acc[row.type] = row.count;
      return acc;
    }, {});
    assert.equal(ledgerTypes[INVENTORY_LEDGER_TYPE.PURCHASE_INBOUND], 1);
    assert.equal(ledgerTypes[INVENTORY_LEDGER_TYPE.QC_RELEASE], 1);
    assert.equal(ledgerTypes[INVENTORY_LEDGER_TYPE.OUTBOUND_RESERVE], 1);
    assert.equal(ledgerTypes[INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU], 1);

    const auditCount = db.prepare("SELECT COUNT(*) AS count FROM erp_audit_logs").get().count;
    assert.ok(auditCount >= 20, `Expected audit logs, got ${auditCount}`);

    console.log("ERP flow foundation check passed");
    console.log(`Temp database checked and removed after success: ${migrationResult.dbPath}`);
  } finally {
    if (db) db.close();
    if (!process.exitCode) {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    }
  }
}

try {
  runFlow();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
