const { OUTBOUND_SHIPMENT_STATUS: OS } = require("../workflow/enums.cjs");
const { nowIso } = require("./utils.cjs");

class OutboundService {
  constructor({ db, workflow, inventory }) {
    if (!db) throw new Error("OutboundService requires db");
    if (!workflow) throw new Error("OutboundService requires workflow");
    if (!inventory) throw new Error("OutboundService requires inventory");
    this.db = db;
    this.workflow = workflow;
    this.inventory = inventory;
  }

  getShipment(id) {
    const row = this.db.prepare("SELECT * FROM erp_outbound_shipments WHERE id = ?").get(id);
    if (!row) throw new Error(`Outbound shipment not found: ${id}`);
    return row;
  }

  submitOutbound(id, actor) {
    const shipment = this.getShipment(id);
    if (shipment.batch_id) {
      this.inventory.assertCanReserve(shipment.batch_id, shipment.qty);
    }
    const transition = this.workflow.transition({
      entityType: "outbound_shipment",
      id,
      action: "submit_outbound",
      toStatus: OS.PENDING_WAREHOUSE,
      actor,
    });
    if (shipment.batch_id) {
      this.inventory.reserveForOutbound({
        batchId: shipment.batch_id,
        qty: shipment.qty,
        outboundId: shipment.id,
        actor,
      });
    }
    return transition;
  }

  startPicking(id, actor) {
    return this.workflow.transition({
      entityType: "outbound_shipment",
      id,
      action: "start_picking",
      toStatus: OS.PICKING,
      actor,
    });
  }

  markPacked(id, actor, patch = {}) {
    return this.workflow.transition({
      entityType: "outbound_shipment",
      id,
      action: "mark_packed",
      toStatus: OS.PACKED,
      actor,
      patch: {
        boxes: patch.boxes ?? null,
        photos_json: JSON.stringify(patch.photos || []),
        warehouse_operator_id: actor?.id || null,
      },
    });
  }

  confirmShippedOut(id, actor, patch = {}) {
    const shipment = this.getShipment(id);
    if (shipment.batch_id) {
      this.inventory.assertCanShipReserved(shipment.batch_id, shipment.qty);
    }
    const transition = this.workflow.transition({
      entityType: "outbound_shipment",
      id,
      action: "confirm_shipped_out",
      toStatus: OS.SHIPPED_OUT,
      actor,
      patch: {
        logistics_provider: patch.logisticsProvider || shipment.logistics_provider || null,
        tracking_no: patch.trackingNo || shipment.tracking_no || null,
        warehouse_operator_id: actor?.id || shipment.warehouse_operator_id || null,
        shipped_at: patch.shippedAt || nowIso(),
      },
    });
    if (shipment.batch_id) {
      this.inventory.shipReserved({
        batchId: shipment.batch_id,
        qty: shipment.qty,
        outboundId: shipment.id,
        actor,
      });
    }
    return transition;
  }

  requestOperationsConfirm(id, actor) {
    return this.workflow.transition({
      entityType: "outbound_shipment",
      id,
      action: "request_ops_confirm",
      toStatus: OS.PENDING_OPS_CONFIRM,
      actor,
    });
  }

  confirmDone(id, actor) {
    return this.workflow.transition({
      entityType: "outbound_shipment",
      id,
      action: "confirm_outbound_done",
      toStatus: OS.CONFIRMED,
      actor,
      patch: {
        confirmed_by: actor?.id || null,
        confirmed_at: nowIso(),
      },
    });
  }
}

module.exports = {
  OutboundService,
};
