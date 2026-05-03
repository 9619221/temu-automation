const {
  BATCH_QC_STATUS,
  INBOUND_RECEIPT_STATUS: IR,
  INVENTORY_LEDGER_TYPE,
} = require("../workflow/enums.cjs");
const { createId, ensurePositiveInteger, nowIso } = require("./utils.cjs");

class InventoryService {
  constructor({ db, workflow }) {
    if (!db) throw new Error("InventoryService requires db");
    if (!workflow) throw new Error("InventoryService requires workflow");
    this.db = db;
    this.workflow = workflow;
  }

  registerArrival(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "register_arrival",
      toStatus: IR.ARRIVED,
      actor,
      patch: {
        received_at: nowIso(),
        operator_id: actor?.id || null,
      },
    });
  }

  confirmCount(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "confirm_count",
      toStatus: IR.COUNTED,
      actor,
      patch: {
        operator_id: actor?.id || null,
      },
    });
  }

  markBatchesCreated(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "create_batches",
      toStatus: IR.INBOUNDED_PENDING_QC,
      actor,
      patch: {
        operator_id: actor?.id || null,
      },
    });
  }

  createBatchFromInbound(input = {}) {
    const receivedQty = ensurePositiveInteger(input.receivedQty, "receivedQty");
    const now = nowIso();
    const batch = {
      id: input.id || createId("batch"),
      account_id: input.accountId,
      batch_code: input.batchCode,
      sku_id: input.skuId,
      po_id: input.poId || null,
      inbound_receipt_id: input.inboundReceiptId || null,
      received_qty: receivedQty,
      available_qty: 0,
      reserved_qty: 0,
      blocked_qty: receivedQty,
      defective_qty: 0,
      rework_qty: 0,
      unit_landed_cost: Number(input.unitLandedCost || 0),
      qc_status: BATCH_QC_STATUS.PENDING,
      location_code: input.locationCode || null,
      received_at: input.receivedAt || now,
      created_at: now,
      updated_at: now,
    };

    const create = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO erp_inventory_batches (
          id, account_id, batch_code, sku_id, po_id, inbound_receipt_id,
          received_qty, available_qty, reserved_qty, blocked_qty, defective_qty,
          rework_qty, unit_landed_cost, qc_status, location_code,
          received_at, created_at, updated_at
        )
        VALUES (
          @id, @account_id, @batch_code, @sku_id, @po_id, @inbound_receipt_id,
          @received_qty, @available_qty, @reserved_qty, @blocked_qty,
          @defective_qty, @rework_qty, @unit_landed_cost, @qc_status,
          @location_code, @received_at, @created_at, @updated_at
        )
      `).run(batch);

      this.writeLedger({
        accountId: batch.account_id,
        skuId: batch.sku_id,
        batchId: batch.id,
        type: INVENTORY_LEDGER_TYPE.PURCHASE_INBOUND,
        qtyDelta: receivedQty,
        fromBucket: null,
        toBucket: "blocked",
        unitCost: batch.unit_landed_cost,
        sourceDocType: "inbound_receipt",
        sourceDocId: batch.inbound_receipt_id || batch.id,
        actor: input.actor,
      });

      return this.getBatch(batch.id);
    });

    return create();
  }

  getBatch(batchId) {
    const batch = this.db.prepare("SELECT * FROM erp_inventory_batches WHERE id = ?").get(batchId);
    if (!batch) throw new Error(`Inventory batch not found: ${batchId}`);
    return batch;
  }

  releaseAfterQc(input = {}) {
    const batch = this.getBatch(input.batchId);
    const releaseQty = Number(input.releaseQty || 0);
    const blockedQty = Number(input.blockedQty || 0);
    const defectiveQty = Number(input.defectiveQty || 0);
    const reworkQty = Number(input.reworkQty || 0);
    if (releaseQty < 0 || blockedQty < 0 || defectiveQty < 0 || reworkQty < 0) {
      throw new Error("QC inventory quantities cannot be negative");
    }
    if (releaseQty + blockedQty + reworkQty > batch.blocked_qty) {
      throw new Error("QC release quantities exceed blocked quantity");
    }

    const apply = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE erp_inventory_batches
        SET available_qty = available_qty + @release_qty,
            blocked_qty = @blocked_qty,
            defective_qty = defective_qty + @defective_qty,
            rework_qty = rework_qty + @rework_qty,
            qc_status = @qc_status,
            updated_at = @updated_at
        WHERE id = @batch_id
      `).run({
        batch_id: input.batchId,
        release_qty: releaseQty,
        blocked_qty: blockedQty,
        defective_qty: defectiveQty,
        rework_qty: reworkQty,
        qc_status: input.qcStatus,
        updated_at: nowIso(),
      });

      if (releaseQty > 0) {
        this.writeLedger({
          accountId: batch.account_id,
          skuId: batch.sku_id,
          batchId: batch.id,
          type: INVENTORY_LEDGER_TYPE.QC_RELEASE,
          qtyDelta: 0,
          fromBucket: "blocked",
          toBucket: "available",
          sourceDocType: "qc_inspection",
          sourceDocId: input.sourceDocId,
          actor: input.actor,
        });
      }

      if (reworkQty > 0) {
        this.writeLedger({
          accountId: batch.account_id,
          skuId: batch.sku_id,
          batchId: batch.id,
          type: INVENTORY_LEDGER_TYPE.QC_REWORK,
          qtyDelta: 0,
          fromBucket: "blocked",
          toBucket: "rework",
          sourceDocType: "qc_inspection",
          sourceDocId: input.sourceDocId,
          actor: input.actor,
        });
      }

      return this.getBatch(input.batchId);
    });

    return apply();
  }

  assertCanReserve(batchId, qty) {
    const quantity = ensurePositiveInteger(qty, "qty");
    const batch = this.getBatch(batchId);
    if (batch.available_qty < quantity) {
      throw new Error(`Insufficient available inventory: ${batch.available_qty} < ${quantity}`);
    }
    if (batch.qc_status === BATCH_QC_STATUS.PENDING || batch.qc_status === BATCH_QC_STATUS.FAILED) {
      throw new Error(`Batch cannot outbound while qc_status is ${batch.qc_status}`);
    }
    return batch;
  }

  reserveForOutbound(input = {}) {
    const qty = ensurePositiveInteger(input.qty, "qty");
    const batch = this.assertCanReserve(input.batchId, qty);
    const reserve = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE erp_inventory_batches
        SET available_qty = available_qty - @qty,
            reserved_qty = reserved_qty + @qty,
            updated_at = @updated_at
        WHERE id = @batch_id
      `).run({
        batch_id: input.batchId,
        qty,
        updated_at: nowIso(),
      });

      this.writeLedger({
        accountId: batch.account_id,
        skuId: batch.sku_id,
        batchId: batch.id,
        type: INVENTORY_LEDGER_TYPE.OUTBOUND_RESERVE,
        qtyDelta: 0,
        fromBucket: "available",
        toBucket: "reserved",
        sourceDocType: "outbound_shipment",
        sourceDocId: input.outboundId,
        actor: input.actor,
      });

      return this.getBatch(input.batchId);
    });
    return reserve();
  }

  assertCanShipReserved(batchId, qty) {
    const quantity = ensurePositiveInteger(qty, "qty");
    const batch = this.getBatch(batchId);
    if (batch.reserved_qty < quantity) {
      throw new Error(`Insufficient reserved inventory: ${batch.reserved_qty} < ${quantity}`);
    }
    return batch;
  }

  shipReserved(input = {}) {
    const qty = ensurePositiveInteger(input.qty, "qty");
    const batch = this.assertCanShipReserved(input.batchId, qty);
    const ship = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE erp_inventory_batches
        SET reserved_qty = reserved_qty - @qty,
            updated_at = @updated_at
        WHERE id = @batch_id
      `).run({
        batch_id: input.batchId,
        qty,
        updated_at: nowIso(),
      });

      this.writeLedger({
        accountId: batch.account_id,
        skuId: batch.sku_id,
        batchId: batch.id,
        type: INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU,
        qtyDelta: -qty,
        fromBucket: "reserved",
        toBucket: null,
        sourceDocType: "outbound_shipment",
        sourceDocId: input.outboundId,
        actor: input.actor,
      });

      return this.getBatch(input.batchId);
    });
    return ship();
  }

  writeLedger(input = {}) {
    this.db.prepare(`
      INSERT INTO erp_inventory_ledger_entries (
        id, account_id, sku_id, batch_id, type, qty_delta, from_bucket,
        to_bucket, unit_cost, source_doc_type, source_doc_id, created_at,
        created_by
      )
      VALUES (
        @id, @account_id, @sku_id, @batch_id, @type, @qty_delta,
        @from_bucket, @to_bucket, @unit_cost, @source_doc_type,
        @source_doc_id, @created_at, @created_by
      )
    `).run({
      id: createId("ledger"),
      account_id: input.accountId,
      sku_id: input.skuId,
      batch_id: input.batchId || null,
      type: input.type,
      qty_delta: input.qtyDelta,
      from_bucket: input.fromBucket || null,
      to_bucket: input.toBucket || null,
      unit_cost: input.unitCost ?? null,
      source_doc_type: input.sourceDocType,
      source_doc_id: input.sourceDocId,
      created_at: nowIso(),
      created_by: input.actor?.id || null,
    });
  }
}

module.exports = {
  InventoryService,
};
