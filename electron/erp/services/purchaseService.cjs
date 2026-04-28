const {
  PURCHASE_REQUEST_STATUS: PR,
  PURCHASE_ORDER_STATUS: PO,
  SOURCING_CANDIDATE_STATUS: SC,
} = require("../workflow/enums.cjs");

class PurchaseService {
  constructor({ workflow }) {
    if (!workflow) throw new Error("PurchaseService requires workflow");
    this.workflow = workflow;
  }

  submitRequest(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_request",
      id,
      action: "submit_pr",
      toStatus: PR.SUBMITTED,
      actor,
    });
  }

  acceptRequest(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_request",
      id,
      action: "accept_pr",
      toStatus: PR.BUYER_PROCESSING,
      actor,
    });
  }

  markRequestSourced(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_request",
      id,
      action: "mark_sourced",
      toStatus: PR.SOURCED,
      actor,
    });
  }

  requestOperationsConfirm(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_request",
      id,
      action: "request_ops_confirm",
      toStatus: PR.WAITING_OPS_CONFIRM,
      actor,
    });
  }

  confirmSourcing(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_request",
      id,
      action: "confirm_sourcing",
      toStatus: PR.CONVERTED_TO_PO,
      actor,
    });
  }

  selectCandidate(id, actor) {
    return this.workflow.transition({
      entityType: "sourcing_candidate",
      id,
      action: "select_candidate",
      toStatus: SC.SELECTED,
      actor,
    });
  }

  submitPaymentApproval(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "submit_payment_approval",
      toStatus: PO.PENDING_FINANCE_APPROVAL,
      actor,
    });
  }

  approvePayment(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "approve_payment",
      toStatus: PO.APPROVED_TO_PAY,
      actor,
    });
  }

  confirmPaid(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "confirm_paid",
      toStatus: PO.PAID,
      actor,
      patch: {
        payment_status: "paid",
      },
    });
  }

  markSupplierProcessing(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "mark_supplier_processing",
      toStatus: PO.SUPPLIER_PROCESSING,
      actor,
    });
  }

  markSupplierShipped(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "mark_supplier_shipped",
      toStatus: PO.SHIPPED,
      actor,
    });
  }

  markArrived(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "mark_arrived",
      toStatus: PO.ARRIVED,
      actor,
    });
  }

  markInbounded(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "mark_inbounded",
      toStatus: PO.INBOUNDED,
      actor,
    });
  }

  closeOrder(id, actor) {
    return this.workflow.transition({
      entityType: "purchase_order",
      id,
      action: "close_po",
      toStatus: PO.CLOSED,
      actor,
    });
  }
}

module.exports = {
  PurchaseService,
};
