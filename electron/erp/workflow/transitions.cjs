const {
  ERP_ROLES,
  PURCHASE_REQUEST_STATUS: PR,
  SOURCING_CANDIDATE_STATUS: SC,
  PURCHASE_ORDER_STATUS: PO,
  INBOUND_RECEIPT_STATUS: IR,
  QC_INSPECTION_STATUS: QC,
  OUTBOUND_SHIPMENT_STATUS: OS,
} = require("./enums.cjs");

const OPS = [ERP_ROLES.OPERATIONS, ERP_ROLES.MANAGER, ERP_ROLES.ADMIN];
const BUYER = [ERP_ROLES.BUYER, ERP_ROLES.MANAGER, ERP_ROLES.ADMIN];
const FINANCE = [ERP_ROLES.FINANCE, ERP_ROLES.MANAGER, ERP_ROLES.ADMIN];
const WAREHOUSE = [ERP_ROLES.WAREHOUSE, ERP_ROLES.MANAGER, ERP_ROLES.ADMIN];

function rule(from, action, to, roles) {
  return {
    from: Array.isArray(from) ? from : [from],
    action,
    to,
    roles,
  };
}

const TRANSITIONS = Object.freeze({
  purchase_request: [
    rule(PR.DRAFT, "submit_pr", PR.SUBMITTED, OPS),
    rule(PR.SUBMITTED, "accept_pr", PR.BUYER_PROCESSING, BUYER),
    rule(PR.BUYER_PROCESSING, "mark_sourced", PR.SOURCED, BUYER),
    rule(PR.SOURCED, "request_ops_confirm", PR.WAITING_OPS_CONFIRM, BUYER),
    rule(PR.WAITING_OPS_CONFIRM, "confirm_sourcing", PR.CONVERTED_TO_PO, OPS),
    rule(PR.WAITING_OPS_CONFIRM, "reject_sourcing", PR.REJECTED, OPS),
    rule([PR.DRAFT, PR.SUBMITTED, PR.BUYER_PROCESSING, PR.SOURCED], "cancel_pr", PR.CANCELLED, OPS),
  ],

  sourcing_candidate: [
    rule(SC.CANDIDATE, "shortlist_candidate", SC.SHORTLISTED, BUYER),
    rule([SC.CANDIDATE, SC.SHORTLISTED], "select_candidate", SC.SELECTED, BUYER),
    rule([SC.CANDIDATE, SC.SHORTLISTED], "reject_candidate", SC.REJECTED, BUYER),
    rule([SC.CANDIDATE, SC.SHORTLISTED], "expire_candidate", SC.EXPIRED, BUYER),
  ],

  purchase_order: [
    rule(PO.DRAFT, "submit_payment_approval", PO.PENDING_FINANCE_APPROVAL, BUYER),
    rule(PO.PENDING_FINANCE_APPROVAL, "approve_payment", PO.APPROVED_TO_PAY, FINANCE),
    rule(PO.PENDING_FINANCE_APPROVAL, "reject_payment", PO.EXCEPTION, FINANCE),
    rule(PO.APPROVED_TO_PAY, "confirm_paid", PO.PAID, FINANCE),
    rule(PO.PAID, "mark_supplier_processing", PO.SUPPLIER_PROCESSING, BUYER),
    rule(PO.SUPPLIER_PROCESSING, "mark_supplier_shipped", PO.SHIPPED, BUYER),
    rule(PO.SHIPPED, "mark_arrived", PO.ARRIVED, WAREHOUSE),
    rule(PO.ARRIVED, "mark_inbounded", PO.INBOUNDED, WAREHOUSE),
    rule(PO.INBOUNDED, "close_po", PO.CLOSED, BUYER),
    rule([PO.PAID, PO.SUPPLIER_PROCESSING, PO.SHIPPED], "mark_delayed", PO.DELAYED, BUYER),
    rule([PO.DRAFT, PO.PENDING_FINANCE_APPROVAL, PO.APPROVED_TO_PAY], "cancel_po", PO.CANCELLED, BUYER),
  ],

  inbound_receipt: [
    rule(IR.PENDING_ARRIVAL, "register_arrival", IR.ARRIVED, WAREHOUSE),
    rule(IR.ARRIVED, "confirm_count", IR.COUNTED, WAREHOUSE),
    rule(IR.COUNTED, "create_batches", IR.INBOUNDED_PENDING_QC, WAREHOUSE),
    rule([IR.ARRIVED, IR.COUNTED], "mark_quantity_mismatch", IR.QUANTITY_MISMATCH, WAREHOUSE),
    rule([IR.ARRIVED, IR.COUNTED], "mark_damaged", IR.DAMAGED, WAREHOUSE),
    rule([IR.PENDING_ARRIVAL, IR.ARRIVED, IR.COUNTED], "mark_inbound_exception", IR.EXCEPTION, WAREHOUSE),
  ],

  qc_inspection: [
    rule(QC.PENDING_QC, "start_qc", QC.IN_PROGRESS, OPS),
    rule(QC.IN_PROGRESS, "submit_qc_passed", QC.PASSED, OPS),
    rule(QC.IN_PROGRESS, "submit_qc_observation", QC.PASSED_WITH_OBSERVATION, OPS),
    rule(QC.IN_PROGRESS, "submit_qc_partial", QC.PARTIAL_PASSED, OPS),
    rule(QC.IN_PROGRESS, "submit_qc_failed", QC.FAILED, OPS),
    rule(QC.IN_PROGRESS, "submit_qc_rework", QC.REWORK_REQUIRED, OPS),
    rule([QC.PENDING_QC, QC.IN_PROGRESS], "mark_qc_exception", QC.EXCEPTION, OPS),
  ],

  outbound_shipment: [
    rule(OS.DRAFT, "submit_outbound", OS.PENDING_WAREHOUSE, OPS),
    rule(OS.PENDING_WAREHOUSE, "start_picking", OS.PICKING, WAREHOUSE),
    rule(OS.PICKING, "mark_packed", OS.PACKED, WAREHOUSE),
    rule(OS.PACKED, "confirm_shipped_out", OS.SHIPPED_OUT, WAREHOUSE),
    rule(OS.SHIPPED_OUT, "request_ops_confirm", OS.PENDING_OPS_CONFIRM, WAREHOUSE),
    rule(OS.PENDING_OPS_CONFIRM, "confirm_outbound_done", OS.CONFIRMED, OPS),
    rule([OS.PENDING_WAREHOUSE, OS.PICKING, OS.PACKED], "mark_outbound_exception", OS.EXCEPTION, WAREHOUSE),
    rule([OS.DRAFT, OS.PENDING_WAREHOUSE], "cancel_outbound", OS.CANCELLED, OPS),
  ],
});

module.exports = {
  TRANSITIONS,
};

