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

  runOptionalCostTrace(sql, params = {}) {
    try {
      return this.db.prepare(sql).run(params);
    } catch (error) {
      if (/no such table|no such column/i.test(String(error?.message || ""))) return null;
      throw error;
    }
  }

  recordCostEvent(input = {}) {
    if (!input.skuId) return null;
    const eventTime = input.eventTime || nowIso();
    const id = input.id || createId("costevt");
    const unitCost = input.unitCost == null ? null : Number(input.unitCost);
    const oldAvg = input.oldAvg == null ? null : Number(input.oldAvg);
    const newAvg = input.newAvg == null ? null : Number(input.newAvg);
    this.runOptionalCostTrace(`
      INSERT INTO erp_inventory_cost_events (
        id, sku_id, event_type, event_time, qty_delta, old_qty, new_qty,
        unit_cost, old_weighted_avg_cost, new_weighted_avg_cost,
        source_doc_type, source_doc_id, severity, status, message, raw_json, created_at
      ) VALUES (
        @id, @sku_id, @event_type, @event_time, @qty_delta, @old_qty, @new_qty,
        @unit_cost, @old_weighted_avg_cost, @new_weighted_avg_cost,
        @source_doc_type, @source_doc_id, @severity, @status, @message, @raw_json, @created_at
      )
    `, {
      id,
      sku_id: input.skuId,
      event_type: input.eventType || "weighted_avg_change",
      event_time: eventTime,
      qty_delta: Number(input.qtyDelta || 0),
      old_qty: Number(input.oldQty || 0),
      new_qty: Number(input.newQty || 0),
      unit_cost: Number.isFinite(unitCost) ? unitCost : null,
      old_weighted_avg_cost: Number.isFinite(oldAvg) ? oldAvg : null,
      new_weighted_avg_cost: Number.isFinite(newAvg) ? newAvg : null,
      source_doc_type: input.sourceDocType || null,
      source_doc_id: input.sourceDocId || null,
      severity: input.severity || "info",
      status: input.status || "recorded",
      message: input.message || null,
      raw_json: JSON.stringify(input.raw || {}),
      created_at: nowIso(),
    });
    return id;
  }

  upsertDailyCostSnapshot(input = {}) {
    if (!input.skuId || !Number.isFinite(Number(input.weightedAvgCost))) return;
    const eventTime = input.eventTime || nowIso();
    this.runOptionalCostTrace(`
      INSERT INTO erp_sku_cost_daily_snapshot (
        sku_id, stat_date, weighted_avg_cost, cost_balance_qty,
        source_event_id, created_at, updated_at
      ) VALUES (
        @sku_id, @stat_date, @weighted_avg_cost, @cost_balance_qty,
        @source_event_id, @now, @now
      )
      ON CONFLICT(sku_id, stat_date) DO UPDATE SET
        weighted_avg_cost = excluded.weighted_avg_cost,
        cost_balance_qty = excluded.cost_balance_qty,
        source_event_id = excluded.source_event_id,
        updated_at = excluded.updated_at
    `, {
      sku_id: input.skuId,
      stat_date: String(eventTime).slice(0, 10),
      weighted_avg_cost: Number(input.weightedAvgCost),
      cost_balance_qty: Number(input.costBalanceQty || 0),
      source_event_id: input.sourceEventId || null,
      now: nowIso(),
    });
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
      if (!Number.isFinite(batch.unit_landed_cost) || batch.unit_landed_cost <= 0) {
        this.recordCostEvent({
          skuId: batch.sku_id,
          eventType: "invalid_inbound_batch_cost",
          qtyDelta: receivedQty,
          oldQty: 0,
          newQty: 0,
          unitCost: batch.unit_landed_cost,
          sourceDocType: "inbound_receipt",
          sourceDocId: batch.inbound_receipt_id || batch.id,
          severity: "warn",
          status: "open",
          message: `Inventory batch ${batch.id} has no valid unit cost`,
          raw: { batchId: batch.id, unitLandedCost: input.unitLandedCost },
        });
      }

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
      this.applySkuCostChange(batch.sku_id, -qty, null, {
        sourceDocType: "outbound_shipment",
        sourceDocId: input.outboundId,
        actor: input.actor,
      });

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
  //   addedQty < 0：平台销售 / 普通出库 → 均价不变，只扣减 cost_balance_qty
  // 调拨 / 平台送仓 / 平台退回自家仓：均价和总量都不变，不要调用本方法
  applySkuCostChange(skuId, addedQty, addedUnitCost, options = {}) {
    if (!skuId) return null;
    const qty = Number(addedQty || 0);
    if (qty === 0) return null;
    const opts = options && typeof options === "object" ? options : {};
    const eventTime = nowIso();
    const sku = this.db
      .prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id = ?")
      .get(skuId);
    if (!sku) return null;
    const oldQty = Number(sku.cost_balance_qty || 0);
    const oldAvg = Number(sku.weighted_avg_cost || 0);
    const newQty = oldQty + qty;
    let newAvg = oldAvg;
    if (qty > 0) {
      const unitCost = Number(addedUnitCost);
      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        const message = `SKU ${skuId} inbound cost must be greater than 0`;
        this.recordCostEvent({
          skuId,
          eventType: "invalid_inbound_cost",
          eventTime,
          qtyDelta: qty,
          oldQty,
          newQty: oldQty,
          unitCost,
          oldAvg,
          newAvg: oldAvg,
          sourceDocType: opts.sourceDocType,
          sourceDocId: opts.sourceDocId,
          severity: "error",
          status: "blocked",
          message,
          raw: { addedQty, addedUnitCost },
        });
        throw new Error(message);
      }
      const costJumpLimit = Number.isFinite(Number(opts.costJumpLimit)) ? Number(opts.costJumpLimit) : 0.5;
      if (!opts.allowCostJump && oldAvg > 0 && Math.abs(unitCost - oldAvg) / oldAvg > costJumpLimit) {
        const message = `SKU ${skuId} inbound cost ${unitCost} differs from current average ${oldAvg} by more than ${(costJumpLimit * 100).toFixed(0)}%`;
        this.recordCostEvent({
          skuId,
          eventType: "inbound_cost_jump",
          eventTime,
          qtyDelta: qty,
          oldQty,
          newQty: oldQty,
          unitCost,
          oldAvg,
          newAvg: oldAvg,
          sourceDocType: opts.sourceDocType,
          sourceDocId: opts.sourceDocId,
          severity: "warn",
          status: "blocked",
          message,
          raw: { addedQty, addedUnitCost, costJumpLimit },
        });
        throw new Error(message);
      }
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
      updated_at: eventTime,
    });
    const costBalanceQty = Math.max(0, newQty);
    const eventId = this.recordCostEvent({
      skuId,
      eventType: qty > 0 ? "weighted_avg_inbound" : "weighted_avg_qty_out",
      eventTime,
      qtyDelta: qty,
      oldQty,
      newQty: costBalanceQty,
      unitCost: qty > 0 ? Number(addedUnitCost) : null,
      oldAvg,
      newAvg,
      sourceDocType: opts.sourceDocType,
      sourceDocId: opts.sourceDocId,
      severity: "info",
      status: "recorded",
      raw: { addedQty, addedUnitCost },
    });
    this.upsertDailyCostSnapshot({
      skuId,
      eventTime,
      weightedAvgCost: newAvg,
      costBalanceQty,
      sourceEventId: eventId,
    });
    return { weightedAvgCost: newAvg, costBalanceQty };
  }

  // 换货专用：按「货值变动」调整 SKU 主表并重算加权均价。
  // deltaQty 件 + deltaValue 货值一起记账（出库腿传负、入库腿传正）。
  // 新均价 = (旧货值 + deltaValue) / (旧库存 + deltaQty)；库存到 0 则均价归 0。
  // 跟 applySkuCostChange 的区别：出库时也按指定货值扣并重算均价，而非「按旧均价扣、均价不变」。
  adjustSkuInventoryValue(skuId, deltaQty, deltaValue, options = {}) {
    if (!skuId) return null;
    const opts = options && typeof options === "object" ? options : {};
    const sku = this.db
      .prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id = ?")
      .get(skuId);
    if (!sku) return null;
    const oldQty = Number(sku.cost_balance_qty || 0);
    const oldAvg = Number(sku.weighted_avg_cost || 0);
    const newQty = oldQty + Number(deltaQty || 0);
    const newValue = oldQty * oldAvg + Number(deltaValue || 0);
    if (newQty > 0 && newValue < -0.0001) {
      throw new Error(`SKU ${skuId} inventory value cannot become negative`);
    }
    const newAvg = newQty > 0 ? newValue / newQty : 0;
    const eventTime = nowIso();
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
      updated_at: eventTime,
    });
    const costBalanceQty = Math.max(0, newQty);
    const eventId = this.recordCostEvent({
      skuId,
      eventType: opts.eventType || "inventory_value_adjustment",
      eventTime,
      qtyDelta: Number(deltaQty || 0),
      oldQty,
      newQty: costBalanceQty,
      unitCost: null,
      oldAvg,
      newAvg,
      sourceDocType: opts.sourceDocType,
      sourceDocId: opts.sourceDocId,
      raw: { deltaQty, deltaValue },
    });
    this.upsertDailyCostSnapshot({
      skuId,
      eventTime,
      weightedAvgCost: newAvg,
      costBalanceQty,
      sourceEventId: eventId,
    });
    return { weightedAvgCost: newAvg, costBalanceQty };
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
  // affectSkuTotal=true 时同步扣 SKU 总量；采购退货按退货单价同步冲货值并重算均价。
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
        if (ledgerType === INVENTORY_LEDGER_TYPE.PURCHASE_RETURN) {
          const unitCost = Number(input.unitCost);
          if (!Number.isFinite(unitCost) || unitCost <= 0) {
            throw new Error("purchase return unitCost must be greater than 0");
          }
          this.adjustSkuInventoryValue(skuId, -qty, -(qty * unitCost), {
            eventType: "purchase_return_value_out",
            sourceDocType: input.sourceDocType || "purchase_return",
            sourceDocId: input.sourceDocId || "",
          });
        } else {
          this.applySkuCostChange(skuId, -qty, null, {
            sourceDocType: input.sourceDocType || "manual",
            sourceDocId: input.sourceDocId || "",
            actor: input.actor,
          });
        }
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
        if (ledgerType === INVENTORY_LEDGER_TYPE.PURCHASE_RETURN_REVERSAL) {
          if (!Number.isFinite(unitLandedCost) || unitLandedCost <= 0) {
            throw new Error("purchase return reversal unitCost must be greater than 0");
          }
          this.adjustSkuInventoryValue(skuId, qty, qty * unitLandedCost, {
            eventType: "purchase_return_value_reversal",
            sourceDocType: input.sourceDocType || "purchase_return_cancel",
            sourceDocId: input.sourceDocId || "",
          });
        } else {
          this.applySkuCostChange(skuId, qty, unitLandedCost, {
            sourceDocType: input.sourceDocType || "manual",
            sourceDocId: input.sourceDocId || "",
            actor: input.actor,
          });
        }
      }
      return this.getBatch(batchId);
    });

    return run();
  }
}

module.exports = {
  InventoryService,
};
