const ERP_ROLES = Object.freeze({
  ADMIN: "admin",
  MANAGER: "manager",
  OPERATIONS: "operations",
  BUYER: "buyer",
  FINANCE: "finance",
  WAREHOUSE: "warehouse",
  VIEWER: "viewer",
});

const PURCHASE_REQUEST_STATUS = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  BUYER_PROCESSING: "buyer_processing",
  SOURCED: "sourced",
  WAITING_OPS_CONFIRM: "waiting_ops_confirm",
  CONVERTED_TO_PO: "converted_to_po",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});

const SOURCING_CANDIDATE_STATUS = Object.freeze({
  CANDIDATE: "candidate",
  SHORTLISTED: "shortlisted",
  SELECTED: "selected",
  REJECTED: "rejected",
  EXPIRED: "expired",
});

const PURCHASE_SOURCE = Object.freeze({
  EXISTING_SUPPLIER: "existing_supplier",
  SOURCE_1688_MANUAL: "1688_manual",
  SOURCE_1688_OFFICIAL: "1688_official_api",
  OTHER_MANUAL: "other_manual",
});

const SOURCING_METHOD = Object.freeze({
  MANUAL: "manual",
  BROWSER_AUTOMATION: "browser_automation",
  OFFICIAL_API: "official_api",
});

const PURCHASE_ORDER_STATUS = Object.freeze({
  DRAFT: "draft",
  PUSHED_PENDING_PRICE: "pushed_pending_price",
  PENDING_FINANCE_APPROVAL: "pending_finance_approval",
  APPROVED_TO_PAY: "approved_to_pay",
  PAID: "paid",
  SUPPLIER_PROCESSING: "supplier_processing",
  SHIPPED: "shipped",
  ARRIVED: "arrived",
  INBOUNDED: "inbounded",
  CLOSED: "closed",
  DELAYED: "delayed",
  EXCEPTION: "exception",
  CANCELLED: "cancelled",
});

const INBOUND_RECEIPT_STATUS = Object.freeze({
  PENDING_ARRIVAL: "pending_arrival",
  ARRIVED: "arrived",
  COUNTED: "counted",
  INBOUNDED_PENDING_QC: "inbounded_pending_qc",
  QUANTITY_MISMATCH: "quantity_mismatch",
  DAMAGED: "damaged",
  EXCEPTION: "exception",
  CANCELLED: "cancelled",
});

const BATCH_QC_STATUS = Object.freeze({
  PENDING: "pending",
  PASSED: "passed",
  PASSED_WITH_OBSERVATION: "passed_with_observation",
  PARTIAL_PASSED: "partial_passed",
  FAILED: "failed",
  REWORK_REQUIRED: "rework_required",
});

const QC_INSPECTION_STATUS = Object.freeze({
  PENDING_QC: "pending_qc",
  IN_PROGRESS: "in_progress",
  PASSED: "passed",
  PASSED_WITH_OBSERVATION: "passed_with_observation",
  PARTIAL_PASSED: "partial_passed",
  FAILED: "failed",
  REWORK_REQUIRED: "rework_required",
  EXCEPTION: "exception",
});

const OUTBOUND_SHIPMENT_STATUS = Object.freeze({
  DRAFT: "draft",
  PENDING_WAREHOUSE: "pending_warehouse",
  PICKING: "picking",
  PACKED: "packed",
  SHIPPED_OUT: "shipped_out",
  PENDING_OPS_CONFIRM: "pending_ops_confirm",
  CONFIRMED: "confirmed",
  EXCEPTION: "exception",
  CANCELLED: "cancelled",
});

const INVENTORY_LEDGER_TYPE = Object.freeze({
  PURCHASE_INBOUND: "purchase_inbound",
  QC_RELEASE: "qc_release",
  QC_BLOCK: "qc_block",
  QC_REWORK: "qc_rework",
  OUTBOUND_RESERVE: "outbound_reserve",
  OUTBOUND_RELEASE_RESERVATION: "outbound_release_reservation",
  OUTBOUND_TO_TEMU: "outbound_to_temu",
  OUTBOUND_TO_TEMU_REVERSAL: "outbound_to_temu_reversal",  // 送仓托管本地撤销发货→反向入库回补
  STOCK_ADJUSTMENT: "stock_adjustment",
  SCRAP: "scrap",
  PURCHASE_RETURN: "purchase_return",          // 自家仓退给供应商
  PURCHASE_RETURN_REVERSAL: "purchase_return_reversal",  // 采购退货单作废→反向入库（补偿）
  CUSTOMER_RETURN: "customer_return",          // 消费者退回平台仓
  CONSIGN_AFTER_SALE_RETURN: "consign_after_sale_return",  // 送仓售后确认收货→退回货入库
  PLATFORM_RETURN_OUT: "platform_return_out",  // 平台仓 → 自家仓 出库腿
  PLATFORM_RETURN_IN: "platform_return_in",    // 平台仓 → 自家仓 入库腿
  TRANSFER_OUT: "transfer_out",                // 店铺 A → 店铺 B 出库腿
  TRANSFER_IN: "transfer_in",                  // 店铺 A → 店铺 B 入库腿
  SKU_SWAP_OUT: "sku_swap_out",                // 商品编码 A → 编码 B 换货：A 出库腿
  SKU_SWAP_IN: "sku_swap_in",                  // 商品编码 A → 编码 B 换货：B 入库腿
});

const WORK_ITEM_STATUS = Object.freeze({
  NEW: "new",
  IN_PROGRESS: "in_progress",
  WAITING_OPERATIONS: "waiting_operations",
  WAITING_BUYER: "waiting_buyer",
  WAITING_FINANCE: "waiting_finance",
  WAITING_WAREHOUSE: "waiting_warehouse",
  WAITING_SUPPLIER: "waiting_supplier",
  DONE: "done",
  DISMISSED: "dismissed",
});

const WORK_ITEM_PRIORITY = Object.freeze({
  P0: "P0",
  P1: "P1",
  P2: "P2",
  P3: "P3",
});

const WORK_ITEM_TYPE = Object.freeze({
  PURCHASE_PLAN_CONFIRM: "PURCHASE_PLAN_CONFIRM",
  PURCHASE_REQUEST_PENDING: "PURCHASE_REQUEST_PENDING",
  SOURCING_DELAY: "SOURCING_DELAY",
  PO_CREATE_PENDING: "PO_CREATE_PENDING",
  SUPPLIER_FOLLOW_UP: "SUPPLIER_FOLLOW_UP",
  SUPPLIER_DELIVERY_DELAY: "SUPPLIER_DELIVERY_DELAY",
  PAYMENT_APPROVAL_PENDING: "PAYMENT_APPROVAL_PENDING",
  PAYMENT_CONFIRM_PENDING: "PAYMENT_CONFIRM_PENDING",
  PAYMENT_EXCEPTION: "PAYMENT_EXCEPTION",
  WAREHOUSE_RECEIVE_PENDING: "WAREHOUSE_RECEIVE_PENDING",
  WAREHOUSE_COUNT_PENDING: "WAREHOUSE_COUNT_PENDING",
  WAREHOUSE_INBOUND_PENDING: "WAREHOUSE_INBOUND_PENDING",
  QC_INSPECTION_PENDING: "QC_INSPECTION_PENDING",
  QC_FAILED: "QC_FAILED",
  QC_PARTIAL_RELEASE: "QC_PARTIAL_RELEASE",
  OUTBOUND_PLAN_PENDING: "OUTBOUND_PLAN_PENDING",
  PICKING_PENDING: "PICKING_PENDING",
  PACKING_PENDING: "PACKING_PENDING",
  SHIP_OUT_PENDING: "SHIP_OUT_PENDING",
  OUTBOUND_CONFIRM_PENDING: "OUTBOUND_CONFIRM_PENDING",
  OUTBOUND_EXCEPTION: "OUTBOUND_EXCEPTION",
});

module.exports = {
  ERP_ROLES,
  PURCHASE_REQUEST_STATUS,
  SOURCING_CANDIDATE_STATUS,
  PURCHASE_SOURCE,
  SOURCING_METHOD,
  PURCHASE_ORDER_STATUS,
  INBOUND_RECEIPT_STATUS,
  BATCH_QC_STATUS,
  QC_INSPECTION_STATUS,
  OUTBOUND_SHIPMENT_STATUS,
  INVENTORY_LEDGER_TYPE,
  WORK_ITEM_STATUS,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
};
