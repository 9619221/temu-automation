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

  markInboundConfirmed(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "confirm_inbound",
      toStatus: IR.INBOUNDED_PENDING_QC,
      actor,
      patch: {
        operator_id: actor?.id || null,
      },
    });
  }

  markQuantityMismatch(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "mark_quantity_mismatch",
      toStatus: IR.QUANTITY_MISMATCH,
      actor,
      patch: {
        operator_id: actor?.id || null,
      },
    });
  }

  markDamaged(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "mark_damaged",
      toStatus: IR.DAMAGED,
      actor,
      patch: {
        operator_id: actor?.id || null,
      },
    });
  }

  markInboundException(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "mark_inbound_exception",
      toStatus: IR.EXCEPTION,
      actor,
      patch: {
        operator_id: actor?.id || null,
      },
    });
  }

  resolveInboundException(id, actor) {
    return this.workflow.transition({
      entityType: "inbound_receipt",
      id,
      action: "resolve_inbound_exception",
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
      // 已去掉入库 QC 闸门：入库即把全部数量放进可用桶，批次直接可出库。
      available_qty: receivedQty,
      reserved_qty: 0,
      blocked_qty: 0,
      defective_qty: 0,
      rework_qty: 0,
      unit_landed_cost: Number(input.unitLandedCost || 0),
      qc_status: BATCH_QC_STATUS.PASSED,
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
        toBucket: "available",
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

      // COGS 按 SKU 全公司加权成本结转；均价不变，仅扣减 cost_balance_qty
      const unitCost = this.getSkuWeightedAvgCost(batch.sku_id);
      this.applySkuCostChange(batch.sku_id, -qty);

      this.writeLedger({
        accountId: batch.account_id,
        skuId: batch.sku_id,
        batchId: batch.id,
        type: INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU,
        qtyDelta: -qty,
        fromBucket: "reserved",
        toBucket: null,
        unitCost,
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

  // 全公司单 SKU 移动加权成本。只在"实物总量变化"的动作里调用：
  //   addedQty > 0 + addedUnitCost：采购入库 / 客户退货 → 按加权重算均价
  //   addedQty < 0：采购退货 / 平台销售 → 均价不变，只扣减 cost_balance_qty
  // 调拨 / 平台送仓 / 平台退回自家仓：均价和总量都不变，不要调用本方法
  applySkuCostChange(skuId, addedQty, addedUnitCost) {
    if (!skuId) return null;
    const qty = Number(addedQty || 0);
    if (qty === 0) return null;
    const sku = this.db
      .prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id = ?")
      .get(skuId);
    if (!sku) return null;
    const oldQty = Number(sku.cost_balance_qty || 0);
    const oldAvg = Number(sku.weighted_avg_cost || 0);
    const newQty = oldQty + qty;
    let newAvg = oldAvg;
    if (qty > 0) {
      const unitCost = Number(addedUnitCost || 0);
      newAvg = newQty > 0 ? (oldQty * oldAvg + qty * unitCost) / newQty : 0;
    }
    this.db.prepare(`
      UPDATE erp_skus
      SET weighted_avg_cost = @avg,
          cost_balance_qty = @qty,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: skuId,
      avg: newAvg,
      qty: Math.max(0, newQty),
      updated_at: nowIso(),
    });
    return { weightedAvgCost: newAvg, costBalanceQty: Math.max(0, newQty) };
  }

  getSkuWeightedAvgCost(skuId) {
    if (!skuId) return 0;
    const row = this.db
      .prepare("SELECT weighted_avg_cost FROM erp_skus WHERE id = ?")
      .get(skuId);
    return Number(row?.weighted_avg_cost || 0);
  }

  // 直接出库（绕开 outbound_shipment 单据流程）。
  // 用于：采购退货 / 店铺间调拨出库腿 / 平台仓→自家仓出库腿。
  // 按 FIFO（received_at ASC）跨批次扣 available_qty，每批次单独写一条 ledger。
  // affectSkuTotal=true 时同步扣 cost_balance_qty（采购退货是；调拨/位置切换是 false）。
  // unitCost 由调用方传：采购退按 PO 原单价；位置切换按 SKU 当前均价。
  applyDirectOutbound(input = {}) {
    const accountId = input.accountId;
    const skuId = input.skuId;
    const qty = ensurePositiveInteger(input.qty, "qty");
    const ledgerType = input.ledgerType;
    if (!accountId) throw new Error("applyDirectOutbound requires accountId");
    if (!skuId) throw new Error("applyDirectOutbound requires skuId");
    if (!ledgerType) throw new Error("applyDirectOutbound requires ledgerType");

    const batches = this.db.prepare(`
      SELECT * FROM erp_inventory_batches
      WHERE account_id = @account_id
        AND sku_id = @sku_id
        AND available_qty > 0
        AND qc_status IN ('passed', 'passed_with_observation', 'partial_passed')
      ORDER BY received_at ASC, created_at ASC, id ASC
    `).all({ account_id: accountId, sku_id: skuId });

    let totalAvailable = 0;
    for (const b of batches) totalAvailable += Number(b.available_qty || 0);
    if (totalAvailable < qty) {
      throw new Error(`Insufficient available inventory for ${skuId} @${accountId}: ${totalAvailable} < ${qty}`);
    }

    const run = this.db.transaction(() => {
      let remaining = qty;
      const lines = [];
      const now = nowIso();
      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(Number(batch.available_qty || 0), remaining);
        if (take <= 0) continue;
        this.db.prepare(`
          UPDATE erp_inventory_batches
          SET available_qty = available_qty - @take,
              updated_at = @updated_at
          WHERE id = @id
        `).run({ id: batch.id, take, updated_at: now });
        this.writeLedger({
          accountId: batch.account_id,
          skuId: batch.sku_id,
          batchId: batch.id,
          type: ledgerType,
          qtyDelta: -take,
          fromBucket: "available",
          toBucket: null,
          unitCost: input.unitCost ?? null,
          sourceDocType: input.sourceDocType || "manual",
          sourceDocId: input.sourceDocId || "",
          actor: input.actor,
        });
        lines.push({ batchId: batch.id, qty: take, unitLandedCost: Number(batch.unit_landed_cost || 0) });
        remaining -= take;
      }
      if (input.affectSkuTotal) {
        this.applySkuCostChange(skuId, -qty);
      }
      return lines;
    });

    return run();
  }

  // 直接入库（绕开 inbound_receipt 单据流程）。
  // 用于：客户退货回平台仓 / 店铺间调拨入库腿 / 平台仓→自家仓入库腿。
  // 建一条新批次（available_qty=qty，unit_landed_cost=unitCost）+ 写一条 ledger。
  // affectSkuTotal=true 时按"加权均价"重算 SKU 主表（客户退按当前均价灌→均价不变；
  //   位置切换→ false，因为总量没变）。
  applyDirectInbound(input = {}) {
    const accountId = input.accountId;
    const skuId = input.skuId;
    const qty = ensurePositiveInteger(input.qty, "qty");
    const ledgerType = input.ledgerType;
    const unitLandedCost = Number(input.unitLandedCost || 0);
    if (!accountId) throw new Error("applyDirectInbound requires accountId");
    if (!skuId) throw new Error("applyDirectInbound requires skuId");
    if (!ledgerType) throw new Error("applyDirectInbound requires ledgerType");

    const now = nowIso();
    const batchId = createId("batch");
    const batchCode = input.batchCode || `DIRECT-${ledgerType}-${Date.now().toString(36).slice(-6).toUpperCase()}`;

    const run = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO erp_inventory_batches (
          id, account_id, batch_code, sku_id, po_id, inbound_receipt_id,
          received_qty, available_qty, reserved_qty, blocked_qty, defective_qty,
          rework_qty, unit_landed_cost, qc_status, location_code,
          received_at, created_at, updated_at
        ) VALUES (
          @id, @account_id, @batch_code, @sku_id, NULL, NULL,
          @qty, @qty, 0, 0, 0,
          0, @unit_landed_cost, 'passed', NULL,
          @now, @now, @now
        )
      `).run({
        id: batchId,
        account_id: accountId,
        batch_code: batchCode,
        sku_id: skuId,
        qty,
        unit_landed_cost: unitLandedCost,
        now,
      });
      this.writeLedger({
        accountId,
        skuId,
        batchId,
        type: ledgerType,
        qtyDelta: qty,
        fromBucket: null,
        toBucket: "available",
        unitCost: unitLandedCost,
        sourceDocType: input.sourceDocType || "manual",
        sourceDocId: input.sourceDocId || "",
        actor: input.actor,
      });
      if (input.affectSkuTotal) {
        this.applySkuCostChange(skuId, qty, unitLandedCost);
      }
      return this.getBatch(batchId);
    });

    return run();
  }
}

module.exports = {
  InventoryService,
};
