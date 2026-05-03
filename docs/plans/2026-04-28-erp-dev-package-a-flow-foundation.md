# ERP 开发包 A：流程底座

## 目标

开发包 A 的目标是先把采购到出库流程固化为可执行的底层规则，而不是先做页面。

本包产出三件东西：

```text
1. 状态枚举
2. 状态流转校验
3. SQLite migration 草案
```

本包完成后，后续采购工作台、仓库工作台、财务工作台和运营工作台都必须调用同一套流程规则，不能各自绕开状态机。

## 不做范围

本包暂不实现：

- 完整页面。
- 局域网 Web。
- 1688 自动采集。
- AI 方案。
- 复杂审批流。
- 自动生成 WorkItem 的完整调度。

但本包要预留这些能力需要的字段。

## 建议文件结构

```text
electron/
  db/
    connection.cjs
    migrate.cjs
    migrations/
      001_erp_core.sql
      002_erp_purchase.sql
      003_erp_inventory_qc_outbound.sql
      004_erp_work_items_audit.sql
      005_erp_indexes.sql
  erp/
    workflow/
      enums.cjs
      transitions.cjs
      validators.cjs
    repositories/
      purchaseRepository.cjs
      inventoryRepository.cjs
      workItemRepository.cjs
      auditRepository.cjs
    services/
      purchaseService.cjs
      inventoryService.cjs
      qcService.cjs
      outboundService.cjs

src/
  domain/
    erp/
      enums.ts
      workflowTypes.ts
```

说明：

- `electron/erp/workflow/*.cjs` 是主进程和 LAN server 的真实运行规则。
- `src/domain/erp/*.ts` 只放前端类型和展示映射，不直接决定业务状态。
- 状态流转只能在 service 层执行，repository 只负责持久化。

## 状态枚举

### 角色枚举

```ts
type ErpRole =
  | "admin"
  | "manager"
  | "operations"
  | "buyer"
  | "finance"
  | "warehouse"
  | "viewer";
```

角色说明：

- `admin`：系统管理员。
- `manager`：管理者，拥有高风险审批和全局查看权限。
- `operations`：运营。
- `buyer`：采购。
- `finance`：财务。
- `warehouse`：仓库。
- `viewer`：只读。

### 采购申请状态

```ts
type PurchaseRequestStatus =
  | "draft"
  | "submitted"
  | "buyer_processing"
  | "sourced"
  | "waiting_ops_confirm"
  | "converted_to_po"
  | "rejected"
  | "cancelled";
```

### 寻源候选状态

```ts
type SourcingCandidateStatus =
  | "candidate"
  | "shortlisted"
  | "selected"
  | "rejected"
  | "expired";
```

### 采购来源与寻源方式

```ts
type PurchaseSource =
  | "existing_supplier"
  | "1688_manual"
  | "other_manual";

type SourcingMethod =
  | "manual"
  | "browser_automation"
  | "official_api";
```

第一版只实现：

```text
sourcing_method = manual
```

### 采购单状态

```ts
type PurchaseOrderStatus =
  | "draft"
  | "pending_finance_approval"
  | "approved_to_pay"
  | "paid"
  | "supplier_processing"
  | "shipped"
  | "arrived"
  | "inbounded"
  | "closed"
  | "delayed"
  | "exception"
  | "cancelled";
```

### 入库状态

```ts
type InboundReceiptStatus =
  | "pending_arrival"
  | "arrived"
  | "counted"
  | "inbounded_pending_qc"
  | "quantity_mismatch"
  | "damaged"
  | "exception"
  | "cancelled";
```

### 库存批次 QC 状态

```ts
type BatchQcStatus =
  | "pending"
  | "passed"
  | "passed_with_observation"
  | "partial_passed"
  | "failed"
  | "rework_required";
```

### 质检状态

```ts
type QCInspectionStatus =
  | "pending_qc"
  | "in_progress"
  | "passed"
  | "passed_with_observation"
  | "partial_passed"
  | "failed"
  | "rework_required"
  | "exception";
```

### 出库状态

```ts
type OutboundShipmentStatus =
  | "draft"
  | "pending_warehouse"
  | "picking"
  | "packed"
  | "shipped_out"
  | "pending_ops_confirm"
  | "confirmed"
  | "exception"
  | "cancelled";
```

### 库存流水类型

```ts
type InventoryLedgerType =
  | "purchase_inbound"
  | "qc_release"
  | "qc_block"
  | "qc_rework"
  | "outbound_reserve"
  | "outbound_release_reservation"
  | "outbound_to_temu"
  | "stock_adjustment"
  | "scrap";
```

### WorkItem 状态与类型

```ts
type WorkItemStatus =
  | "new"
  | "in_progress"
  | "waiting_operations"
  | "waiting_buyer"
  | "waiting_finance"
  | "waiting_warehouse"
  | "waiting_supplier"
  | "done"
  | "dismissed";

type WorkItemPriority = "P0" | "P1" | "P2" | "P3";
```

第一批 WorkItem 类型：

```ts
type WorkItemType =
  | "PURCHASE_PLAN_CONFIRM"
  | "PURCHASE_REQUEST_PENDING"
  | "SOURCING_DELAY"
  | "PO_CREATE_PENDING"
  | "SUPPLIER_FOLLOW_UP"
  | "SUPPLIER_DELIVERY_DELAY"
  | "PAYMENT_APPROVAL_PENDING"
  | "PAYMENT_CONFIRM_PENDING"
  | "PAYMENT_EXCEPTION"
  | "WAREHOUSE_RECEIVE_PENDING"
  | "WAREHOUSE_COUNT_PENDING"
  | "WAREHOUSE_INBOUND_PENDING"
  | "QC_INSPECTION_PENDING"
  | "QC_FAILED"
  | "QC_PARTIAL_RELEASE"
  | "OUTBOUND_PLAN_PENDING"
  | "PICKING_PENDING"
  | "PACKING_PENDING"
  | "SHIP_OUT_PENDING"
  | "OUTBOUND_CONFIRM_PENDING"
  | "OUTBOUND_EXCEPTION";
```

## 状态流转校验

### 设计原则

状态流转校验放在 service 层。

```text
UI / LAN Web
-> IPC 或 HTTP API
-> service
-> workflow validator
-> repository transaction
-> audit log
```

禁止页面或 repository 直接改状态。

### 核心函数

```ts
type TransitionCheckInput = {
  entityType:
    | "purchase_request"
    | "sourcing_candidate"
    | "purchase_order"
    | "inbound_receipt"
    | "qc_inspection"
    | "outbound_shipment";
  fromStatus: string;
  toStatus: string;
  action: string;
  role: ErpRole;
};

function canTransition(input: TransitionCheckInput): boolean;

function assertTransition(input: TransitionCheckInput): void;
```

校验失败时抛业务错误：

```ts
class WorkflowTransitionError extends Error {
  code = "ERP_WORKFLOW_TRANSITION_DENIED";
}
```

### PR 流转表

| 当前状态 | 动作 | 下一状态 | 允许角色 |
| --- | --- | --- | --- |
| draft | submit_pr | submitted | operations, manager, admin |
| submitted | accept_pr | buyer_processing | buyer, manager, admin |
| buyer_processing | mark_sourced | sourced | buyer, manager, admin |
| sourced | request_ops_confirm | waiting_ops_confirm | buyer, manager, admin |
| waiting_ops_confirm | confirm_sourcing | converted_to_po | operations, manager, admin |
| waiting_ops_confirm | reject_sourcing | rejected | operations, manager, admin |
| draft/submitted/buyer_processing/sourced | cancel_pr | cancelled | operations, manager, admin |

说明：

- `converted_to_po` 应由 `purchaseService.convertPrToPo` 触发。
- 转 PO 必须检查至少一个 `selected` 候选。

### 寻源候选流转表

| 当前状态 | 动作 | 下一状态 | 允许角色 |
| --- | --- | --- | --- |
| candidate | shortlist_candidate | shortlisted | buyer, manager, admin |
| candidate/shortlisted | select_candidate | selected | buyer, manager, admin |
| candidate/shortlisted | reject_candidate | rejected | buyer, manager, admin |
| candidate/shortlisted | expire_candidate | expired | buyer, manager, admin |

规则：

- 同一 PR 第一版允许多个候选，但转 PO 时至少选择一个。
- 第一版可允许一个 PR 只转一个 PO；多 PO 后续再扩展。

### PO 流转表

| 当前状态 | 动作 | 下一状态 | 允许角色 |
| --- | --- | --- | --- |
| draft | submit_payment_approval | pending_finance_approval | buyer, manager, admin |
| pending_finance_approval | approve_payment | approved_to_pay | finance, manager, admin |
| pending_finance_approval | reject_payment | exception | finance, manager, admin |
| approved_to_pay | confirm_paid | paid | finance, manager, admin |
| paid | mark_supplier_processing | supplier_processing | buyer, manager, admin |
| supplier_processing | mark_supplier_shipped | shipped | buyer, manager, admin |
| shipped | mark_arrived | arrived | warehouse, manager, admin |
| arrived | mark_inbounded | inbounded | warehouse, manager, admin |
| inbounded | close_po | closed | buyer, manager, admin |
| paid/supplier_processing/shipped | mark_delayed | delayed | buyer, manager, admin |
| draft/pending_finance_approval/approved_to_pay | cancel_po | cancelled | buyer, manager, admin |

规则：

- `confirm_paid` 前必须有付款审批记录。
- `mark_arrived` 通常由入库到货登记触发。
- `mark_inbounded` 通常由入库建批次事务触发。

### 入库流转表

| 当前状态 | 动作 | 下一状态 | 允许角色 |
| --- | --- | --- | --- |
| pending_arrival | register_arrival | arrived | warehouse, manager, admin |
| arrived | confirm_count | counted | warehouse, manager, admin |
| counted | create_batches | inbounded_pending_qc | warehouse, manager, admin |
| arrived/counted | mark_quantity_mismatch | quantity_mismatch | warehouse, manager, admin |
| arrived/counted | mark_damaged | damaged | warehouse, manager, admin |
| any active | mark_inbound_exception | exception | warehouse, manager, admin |

规则：

- `create_batches` 必须在同一个 transaction 内创建批次和库存流水。
- 入库后批次默认进入 `blocked_qty`，不能直接进入 `available_qty`。

### QC 流转表

| 当前状态 | 动作 | 下一状态 | 允许角色 |
| --- | --- | --- | --- |
| pending_qc | start_qc | in_progress | operations, manager, admin |
| in_progress | submit_qc_passed | passed | operations, manager, admin |
| in_progress | submit_qc_observation | passed_with_observation | operations, manager, admin |
| in_progress | submit_qc_partial | partial_passed | operations, manager, admin |
| in_progress | submit_qc_failed | failed | operations, manager, admin |
| in_progress | submit_qc_rework | rework_required | operations, manager, admin |
| pending_qc/in_progress | mark_qc_exception | exception | operations, manager, admin |

规则：

- `actual_sample_qty` 必须大于 0。
- `defective_qty` 不能大于 `actual_sample_qty`。
- 系统根据不良率给出推荐状态，但运营可以选择更保守的状态。
- 选择 `partial_passed` 时必须填写 `release_qty`、`blocked_qty` 或 `rework_qty`，且合计不能超过批次数量。

### 出库流转表

| 当前状态 | 动作 | 下一状态 | 允许角色 |
| --- | --- | --- | --- |
| draft | submit_outbound | pending_warehouse | operations, manager, admin |
| pending_warehouse | start_picking | picking | warehouse, manager, admin |
| picking | mark_packed | packed | warehouse, manager, admin |
| packed | confirm_shipped_out | shipped_out | warehouse, manager, admin |
| shipped_out | request_ops_confirm | pending_ops_confirm | warehouse, manager, admin |
| pending_ops_confirm | confirm_outbound_done | confirmed | operations, manager, admin |
| pending_warehouse/picking/packed | mark_outbound_exception | exception | warehouse, manager, admin |
| draft/pending_warehouse | cancel_outbound | cancelled | operations, manager, admin |

规则：

- `submit_outbound` 必须检查批次 `available_qty` 足够。
- `submit_outbound` 在 transaction 内执行库存预留：`available_qty -> reserved_qty`。
- `confirm_shipped_out` 在 transaction 内扣减 `reserved_qty` 并写 `outbound_to_temu` 流水。
- `confirm_outbound_done` 只关闭流程，不再扣库存。

## QC 判定函数

```ts
type QCDecision = {
  defectRate: number;
  recommendedStatus:
    | "passed"
    | "passed_with_observation"
    | "partial_passed"
    | "failed";
  priority?: WorkItemPriority;
};

function decideQCResult(input: {
  actualSampleQty: number;
  defectiveQty: number;
  observationThreshold?: number;
  failureThreshold?: number;
}): QCDecision;
```

默认规则：

```text
0% -> passed
> 0% 且 <= 5% -> passed_with_observation
> 5% 且 <= 15% -> partial_passed
> 15% -> failed
```

## SQLite migration 草案

### 001_erp_core.sql

```sql
CREATE TABLE IF NOT EXISTS erp_migration_log (
  id TEXT PRIMARY KEY,
  migration_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  remark TEXT
);

CREATE TABLE IF NOT EXISTS erp_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  source TEXT NOT NULL DEFAULT 'json_store',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  access_code_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_skus (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  internal_sku_code TEXT NOT NULL,
  temu_sku_id TEXT,
  temu_product_id TEXT,
  temu_skc_id TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  image_url TEXT,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, internal_sku_code),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id)
);

CREATE TABLE IF NOT EXISTS erp_suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  wechat TEXT,
  address TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 002_erp_purchase.sql

```sql
CREATE TABLE IF NOT EXISTS erp_purchase_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  requested_by TEXT,
  reason TEXT NOT NULL,
  requested_qty INTEGER NOT NULL,
  target_unit_cost REAL,
  expected_arrival_date TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_sourcing_candidates (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  purchase_source TEXT NOT NULL,
  sourcing_method TEXT NOT NULL DEFAULT 'manual',
  supplier_id TEXT,
  supplier_name TEXT,
  product_title TEXT,
  product_url TEXT,
  image_url TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  moq INTEGER NOT NULL DEFAULT 1,
  lead_days INTEGER,
  logistics_fee REAL DEFAULT 0,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  pr_id TEXT,
  selected_candidate_id TEXT,
  supplier_id TEXT,
  po_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  expected_delivery_date TEXT,
  actual_delivery_date TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, po_no),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(selected_candidate_id) REFERENCES erp_sourcing_candidates(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_order_lines (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  po_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  logistics_fee REAL DEFAULT 0,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_payment_approvals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  po_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  paid_at TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id)
);
```

### 003_erp_inventory_qc_outbound.sql

```sql
CREATE TABLE IF NOT EXISTS erp_inbound_receipts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  po_id TEXT,
  receipt_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_arrival',
  received_at TEXT,
  operator_id TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, receipt_no),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id)
);

CREATE TABLE IF NOT EXISTS erp_inbound_receipt_lines (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  po_line_id TEXT,
  sku_id TEXT NOT NULL,
  expected_qty INTEGER DEFAULT 0,
  received_qty INTEGER NOT NULL,
  damaged_qty INTEGER DEFAULT 0,
  shortage_qty INTEGER DEFAULT 0,
  over_qty INTEGER DEFAULT 0,
  batch_id TEXT,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(receipt_id) REFERENCES erp_inbound_receipts(id),
  FOREIGN KEY(po_line_id) REFERENCES erp_purchase_order_lines(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_inventory_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  batch_code TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  po_id TEXT,
  inbound_receipt_id TEXT,
  received_qty INTEGER NOT NULL,
  available_qty INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  blocked_qty INTEGER NOT NULL DEFAULT 0,
  defective_qty INTEGER NOT NULL DEFAULT 0,
  rework_qty INTEGER NOT NULL DEFAULT 0,
  unit_landed_cost REAL NOT NULL DEFAULT 0,
  qc_status TEXT NOT NULL DEFAULT 'pending',
  location_code TEXT,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, batch_code),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id),
  FOREIGN KEY(inbound_receipt_id) REFERENCES erp_inbound_receipts(id)
);

CREATE TABLE IF NOT EXISTS erp_inventory_ledger_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  batch_id TEXT,
  type TEXT NOT NULL,
  qty_delta INTEGER NOT NULL,
  unit_cost REAL,
  source_doc_type TEXT NOT NULL,
  source_doc_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id),
  FOREIGN KEY(batch_id) REFERENCES erp_inventory_batches(id)
);

CREATE TABLE IF NOT EXISTS erp_qc_inspections (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_qc',
  suggested_sample_qty INTEGER DEFAULT 0,
  actual_sample_qty INTEGER DEFAULT 0,
  defective_qty INTEGER DEFAULT 0,
  defect_rate REAL DEFAULT 0,
  defect_types_json TEXT NOT NULL DEFAULT '[]',
  release_qty INTEGER DEFAULT 0,
  blocked_qty INTEGER DEFAULT 0,
  rework_qty INTEGER DEFAULT 0,
  photos_json TEXT NOT NULL DEFAULT '[]',
  inspector_id TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(batch_id) REFERENCES erp_inventory_batches(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_outbound_shipments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  shipment_no TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  batch_id TEXT,
  qty INTEGER NOT NULL,
  boxes INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  logistics_provider TEXT,
  tracking_no TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  warehouse_operator_id TEXT,
  shipped_at TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, shipment_no),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id),
  FOREIGN KEY(batch_id) REFERENCES erp_inventory_batches(id)
);
```

### 004_erp_work_items_audit.sql

```sql
CREATE TABLE IF NOT EXISTS erp_work_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P2',
  status TEXT NOT NULL DEFAULT 'new',
  owner_role TEXT NOT NULL,
  owner_user_id TEXT,
  title TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  related_doc_type TEXT,
  related_doc_id TEXT,
  sku_id TEXT,
  due_at TEXT,
  dedupe_key TEXT,
  source_rule TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(account_id, dedupe_key),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_audit_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
```

### 005_erp_indexes.sql

```sql
CREATE INDEX IF NOT EXISTS idx_erp_skus_account ON erp_skus(account_id);
CREATE INDEX IF NOT EXISTS idx_erp_skus_temu_product ON erp_skus(temu_product_id);
CREATE INDEX IF NOT EXISTS idx_erp_pr_account_status ON erp_purchase_requests(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_sourcing_pr_status ON erp_sourcing_candidates(pr_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_po_account_status ON erp_purchase_orders(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_payment_po_status ON erp_payment_approvals(po_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_inbound_account_status ON erp_inbound_receipts(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_batches_account_sku ON erp_inventory_batches(account_id, sku_id);
CREATE INDEX IF NOT EXISTS idx_erp_batches_qc_status ON erp_inventory_batches(account_id, qc_status);
CREATE INDEX IF NOT EXISTS idx_erp_ledger_sku_batch ON erp_inventory_ledger_entries(sku_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_qc_batch_status ON erp_qc_inspections(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_outbound_account_status ON erp_outbound_shipments(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_work_items_owner_status ON erp_work_items(account_id, owner_role, status);
CREATE INDEX IF NOT EXISTS idx_erp_work_items_priority ON erp_work_items(account_id, priority, status);
CREATE INDEX IF NOT EXISTS idx_erp_audit_entity ON erp_audit_logs(entity_type, entity_id);
```

## 需要实现的 service 方法

### purchaseService

```ts
createPurchaseRequest(input)
submitPurchaseRequest(prId, actor)
acceptPurchaseRequest(prId, actor)
addSourcingCandidate(prId, input, actor)
selectSourcingCandidate(candidateId, actor)
requestOperationsConfirm(prId, actor)
confirmSourcingAndCreatePo(prId, input, actor)
submitPaymentApproval(poId, actor)
markSupplierProcessing(poId, actor)
markSupplierShipped(poId, input, actor)
```

### financeService

```ts
approvePayment(poId, input, actor)
rejectPayment(poId, input, actor)
confirmPaid(poId, input, actor)
```

### inventoryService

```ts
registerArrival(poId, input, actor)
confirmInboundCount(receiptId, input, actor)
createInboundBatches(receiptId, input, actor)
```

### qcService

```ts
startQcInspection(qcId, actor)
submitQcResult(qcId, input, actor)
```

### outboundService

```ts
createOutboundDraft(input, actor)
submitOutbound(outboundId, actor)
startPicking(outboundId, actor)
markPacked(outboundId, input, actor)
confirmShippedOut(outboundId, input, actor)
confirmOutboundDone(outboundId, actor)
```

## 事务边界

必须使用 SQLite transaction 的动作：

- PR 转 PO。
- PO 提交付款审批。
- 财务确认付款。
- 到货入库建批次。
- QC 提交结果并释放或锁定库存。
- 创建发货指令并预留库存。
- 仓库确认发出并扣库存。
- 任何状态更新加 WorkItem 生成。
- 任何关键动作加 audit log。

## 校验规则清单

### 通用

- `account_id` 必须存在。
- 当前状态必须等于数据库里最新状态。
- 角色必须有权限。
- 状态流转必须在 transition map 中。
- 写操作必须写 audit log。

### 采购

- PR 转 PO 前必须有 selected 候选。
- PO 总金额必须等于明细汇总。
- 采购数量必须大于 0。
- 手工 1688 候选必须有商品链接或商品标题。

### 财务

- 未审批不能确认付款。
- 确认付款金额不能大于 PO 总金额，除非管理者覆盖。
- 驳回付款后 PO 进入 exception。

### 入库

- 入库数量必须大于 0。
- 到货数量差异必须记录异常原因。
- 入库建批次后，批次默认 `available_qty = 0`，`blocked_qty = received_qty`。

### QC

- 实际抽检数量必须大于 0。
- 不良数量不能大于实际抽检数量。
- 部分通过时，释放、锁定、返工数量合计不能超过批次剩余数量。
- QC failed 后禁止创建有效发货指令。

### 出库

- 发货指令数量必须大于 0。
- 提交发货指令时 `available_qty` 必须足够。
- 仓库实发数量不能大于预留数量，除非管理者覆盖。
- 缺少物流单号时可以保存 packed，但不能进入 shipped_out。

## 验收标准

开发包 A 完成后应满足：

- migration 能初始化空数据库。
- migration 可重复执行且不会重复建表。
- 所有状态枚举集中定义。
- 所有状态流转由 `assertTransition` 校验。
- 非法角色不能执行越权状态流转。
- 非法状态跳转会抛 `ERP_WORKFLOW_TRANSITION_DENIED`。
- PR、PO、入库、QC、出库的 happy path 可以通过 service 单元测试跑通。
- 入库后批次默认不可发货。
- QC 通过后释放库存。
- 出库提交后预留库存。
- 仓库确认发出后扣减库存。
- 运营确认出库完成不重复扣库存。
- 每个关键动作产生 audit log。
- WorkItem 表具备去重字段 `dedupe_key`。
- 不影响现有 `npm run build` 和 `npm run smoke:desktop`。

