const { createId, nowIso } = require("./utils.cjs");

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeLimit(value) {
  const number = Math.floor(Number(value || 200));
  if (!Number.isFinite(number) || number <= 0) return 200;
  return Math.min(number, 500);
}

class TemuStockOrderService {
  constructor({ db, workflow }) {
    if (!db) throw new Error("TemuStockOrderService requires db");
    if (!workflow) throw new Error("TemuStockOrderService requires workflow");
    this.db = db;
    this.workflow = workflow;
  }

  findMappedSkuId(accountId, skcId, skuId) {
    let row = null;
    if (skcId) {
      row = this.db.prepare("SELECT id FROM erp_skus WHERE account_id = ? AND temu_skc_id = ?").get(accountId, skcId);
    }
    if (!row && skuId) {
      row = this.db.prepare("SELECT id FROM erp_skus WHERE account_id = ? AND temu_sku_id = ?").get(accountId, skuId);
    }
    return row?.id || null;
  }

  syncFromCollection({ accountId, orders, actor }) {
    const rows = Array.isArray(orders) ? orders : [];
    const sync = this.db.transaction(() => {
      let synced = 0;
      let matched = 0;
      let unmatched = 0;

      const findExisting = this.db.prepare(`
        SELECT * FROM erp_temu_stock_orders
        WHERE account_id = ? AND temu_purchase_order_no = ?
      `);
      const insertOrder = this.db.prepare(`
        INSERT INTO erp_temu_stock_orders (
          id, account_id, temu_purchase_order_no, parent_order_no, category_type,
          temu_skc_id, temu_sku_id, sku_code, product_name, demand_qty,
          temu_status, warehouse_group, urgency_info, order_time,
          mapped_erp_sku_id, sync_status, raw_json, synced_at, created_at, updated_at
        )
        VALUES (
          @id, @account_id, @temu_purchase_order_no, @parent_order_no, @category_type,
          @temu_skc_id, @temu_sku_id, @sku_code, @product_name, @demand_qty,
          @temu_status, @warehouse_group, @urgency_info, @order_time,
          @mapped_erp_sku_id, @sync_status, @raw_json, @synced_at, @created_at, @updated_at
        )
      `);
      const updateOrder = this.db.prepare(`
        UPDATE erp_temu_stock_orders
        SET parent_order_no = @parent_order_no,
            category_type = @category_type,
            temu_skc_id = @temu_skc_id,
            temu_sku_id = @temu_sku_id,
            sku_code = @sku_code,
            product_name = @product_name,
            demand_qty = @demand_qty,
            temu_status = @temu_status,
            warehouse_group = @warehouse_group,
            urgency_info = @urgency_info,
            order_time = @order_time,
            mapped_erp_sku_id = @mapped_erp_sku_id,
            sync_status = @sync_status,
            raw_json = @raw_json,
            synced_at = @synced_at,
            updated_at = @updated_at
        WHERE id = @id
      `);

      for (const order of rows) {
        const purchaseOrderNo = optionalString(order?.purchaseOrderNo);
        if (!purchaseOrderNo) continue;

        const now = nowIso();
        const skcId = optionalString(order.skcId);
        const skuId = optionalString(order.skuId);
        const mappedSkuId = this.findMappedSkuId(accountId, skcId, skuId);
        const existing = findExisting.get(accountId, purchaseOrderNo);
        const syncStatus = existing?.sync_status === "outbound_created"
          ? "outbound_created"
          : (mappedSkuId ? "matched" : "unmatched");
        const row = {
          id: existing?.id || createId("temu_so"),
          account_id: accountId,
          temu_purchase_order_no: purchaseOrderNo,
          parent_order_no: optionalString(order.parentOrderNo),
          category_type: optionalString(order.type),
          temu_skc_id: skcId,
          temu_sku_id: skuId,
          sku_code: optionalString(order.skuCode),
          product_name: optionalString(order.title),
          demand_qty: Number(order.quantity) || 0,
          temu_status: optionalString(order.status),
          warehouse_group: optionalString(order.warehouse),
          urgency_info: optionalString(order.urgencyInfo),
          order_time: optionalString(order.orderTime),
          mapped_erp_sku_id: mappedSkuId,
          sync_status: syncStatus,
          raw_json: JSON.stringify(order),
          synced_at: now,
          created_at: existing?.created_at || now,
          updated_at: now,
        };

        if (existing) {
          updateOrder.run(row);
        } else {
          insertOrder.run(row);
        }

        synced += 1;
        if (mappedSkuId) matched += 1;
        else unmatched += 1;
      }

      this.workflow.writeAudit({
        accountId,
        actor,
        action: "temu_stock_order_sync",
        entityType: "temu_stock_order",
        entityId: null,
        before: null,
        after: { synced, matched, unmatched },
      });

      return { synced, matched, unmatched };
    });

    return sync();
  }

  list({ accountId, status, limit }) {
    const params = [accountId];
    let sql = "SELECT * FROM erp_temu_stock_orders WHERE account_id = ?";
    if (status) {
      sql += " AND sync_status = ?";
      params.push(status);
    }
    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(normalizeLimit(limit));
    return this.db.prepare(sql).all(...params);
  }

  resolveOutboundTarget(stockOrderId) {
    const stockOrder = this.db.prepare("SELECT * FROM erp_temu_stock_orders WHERE id = ?").get(stockOrderId);
    if (!stockOrder) throw new Error(`Temu stock order not found: ${stockOrderId}`);

    if (!stockOrder.mapped_erp_sku_id) {
      this.db.prepare(`
        UPDATE erp_temu_stock_orders
        SET sync_status = 'unmatched', updated_at = @updated_at
        WHERE id = @id
      `).run({ id: stockOrder.id, updated_at: nowIso() });
      throw new Error("Stock order not mapped to erp sku");
    }

    const batch = this.db.prepare(`
      SELECT * FROM erp_inventory_batches
      WHERE account_id = ?
        AND sku_id = ?
        AND available_qty >= ?
        AND qc_status IN ('passed', 'passed_with_observation', 'partial_passed')
      ORDER BY received_at ASC
      LIMIT 1
    `).get(stockOrder.account_id, stockOrder.mapped_erp_sku_id, stockOrder.demand_qty);

    if (!batch) {
      this.db.prepare(`
        UPDATE erp_temu_stock_orders
        SET sync_status = 'unfulfillable', updated_at = @updated_at
        WHERE id = @id
      `).run({ id: stockOrder.id, updated_at: nowIso() });
      throw new Error(`No single inventory batch has enough available qty for demand ${stockOrder.demand_qty}`);
    }

    return { stockOrder, batch };
  }
}

module.exports = {
  TemuStockOrderService,
};
