const {
  ERP_ROLES,
  WORK_ITEM_PRIORITY: PRIORITY,
  WORK_ITEM_STATUS: STATUS,
  WORK_ITEM_TYPE: TYPE,
} = require("../workflow/enums.cjs");
const { createId, nowIso } = require("./utils.cjs");

const FINAL_STATUSES = new Set([STATUS.DONE, STATUS.DISMISSED]);
const GENERATED_RULE_PREFIX = "erp:";

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatSku(row) {
  const code = row.internal_sku_code || row.internalSkuCode || row.sku_id || row.skuId || "";
  const name = row.product_name || row.productName || "";
  return [code, name].filter(Boolean).join(" / ") || "-";
}

function compactEvidence(items) {
  return items
    .filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
    .map((item) => String(item));
}

function normalizeStatus(value) {
  const status = String(value || "").trim();
  if (!Object.values(STATUS).includes(status)) {
    throw new Error(`Unsupported work item status: ${status}`);
  }
  return status;
}

function normalizeLimit(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(Math.floor(number), 500));
}

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function pushTask(tasks, input) {
  tasks.push({
    accountId: input.accountId,
    type: input.type,
    priority: input.priority || PRIORITY.P2,
    ownerRole: input.ownerRole,
    ownerUserId: input.ownerUserId || null,
    title: input.title,
    evidence: compactEvidence(input.evidence || []),
    relatedDocType: input.relatedDocType,
    relatedDocId: input.relatedDocId,
    skuId: input.skuId || null,
    dueAt: input.dueAt || null,
    sourceRule: input.sourceRule,
    dedupeKey: input.dedupeKey,
  });
}

class WorkItemService {
  constructor({ db }) {
    if (!db) throw new Error("WorkItemService requires db");
    this.db = db;
  }

  writeEvent(input = {}) {
    this.db.prepare(`
      INSERT INTO erp_work_item_events (
        id, account_id, work_item_id, action, from_status, to_status,
        actor_id, actor_role, remark, created_at
      )
      VALUES (
        @id, @account_id, @work_item_id, @action, @from_status, @to_status,
        @actor_id, @actor_role, @remark, @created_at
      )
    `).run({
      id: createId("wie"),
      account_id: input.accountId,
      work_item_id: input.workItemId,
      action: input.action,
      from_status: input.fromStatus || null,
      to_status: input.toStatus || null,
      actor_id: input.actor?.id || null,
      actor_role: input.actor?.role || null,
      remark: optionalString(input.remark),
      created_at: nowIso(),
    });
  }

  list(params = {}) {
    const clauses = ["1 = 1"];
    const values = {
      limit: normalizeLimit(params.limit),
    };
    if (params.accountId) {
      clauses.push("wi.account_id = @account_id");
      values.account_id = params.accountId;
    }
    if (params.ownerRole) {
      clauses.push("wi.owner_role = @owner_role");
      values.owner_role = params.ownerRole;
    }
    if (params.status) {
      clauses.push("wi.status = @status");
      values.status = params.status;
    }
    if (params.priority) {
      clauses.push("wi.priority = @priority");
      values.priority = params.priority;
    }
    if (params.activeOnly) {
      clauses.push("wi.status NOT IN ('done', 'dismissed')");
    }

    return this.db.prepare(`
      SELECT
        wi.*,
        acct.name AS account_name,
        sku.internal_sku_code,
        sku.product_name,
        owner.name AS owner_user_name
      FROM erp_work_items wi
      LEFT JOIN erp_accounts acct ON acct.id = wi.account_id
      LEFT JOIN erp_skus sku ON sku.id = wi.sku_id
      LEFT JOIN erp_users owner ON owner.id = wi.owner_user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY
        CASE wi.priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 9
        END,
        CASE wi.status
          WHEN 'new' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'waiting_operations' THEN 2
          WHEN 'waiting_buyer' THEN 2
          WHEN 'waiting_finance' THEN 2
          WHEN 'waiting_warehouse' THEN 2
          WHEN 'waiting_supplier' THEN 3
          ELSE 9
        END,
        COALESCE(wi.due_at, '9999-12-31') ASC,
        wi.updated_at DESC
      LIMIT @limit
    `).all(values);
  }

  getStats(params = {}) {
    const clauses = ["1 = 1"];
    const values = {};
    if (params.accountId) {
      clauses.push("account_id = @account_id");
      values.account_id = params.accountId;
    }
    if (params.ownerRole) {
      clauses.push("owner_role = @owner_role");
      values.owner_role = params.ownerRole;
    }
    if (params.status) {
      clauses.push("status = @status");
      values.status = params.status;
    }
    if (params.priority) {
      clauses.push("priority = @priority");
      values.priority = params.priority;
    }
    if (params.activeOnly) {
      clauses.push("status NOT IN ('done', 'dismissed')");
    }
    const rows = this.db.prepare(`
      SELECT owner_role, status, priority, COUNT(*) AS count
      FROM erp_work_items
      WHERE ${clauses.join(" AND ")}
      GROUP BY owner_role, status, priority
    `).all(values);
    const stats = {
      total: 0,
      active: 0,
      byOwnerRole: {},
      byStatus: {},
      byPriority: {},
    };
    for (const row of rows) {
      const count = Number(row.count || 0);
      stats.total += count;
      if (!FINAL_STATUSES.has(row.status)) stats.active += count;
      stats.byOwnerRole[row.owner_role] = (stats.byOwnerRole[row.owner_role] || 0) + count;
      stats.byStatus[row.status] = (stats.byStatus[row.status] || 0) + count;
      stats.byPriority[row.priority] = (stats.byPriority[row.priority] || 0) + count;
    }
    return stats;
  }

  updateStatus(id, statusInput, actor = {}, remark = "") {
    const status = normalizeStatus(statusInput);
    const before = this.db.prepare("SELECT * FROM erp_work_items WHERE id = ?").get(id);
    if (!before) throw new Error(`Work item not found: ${id}`);

    const now = nowIso();
    this.db.prepare(`
      UPDATE erp_work_items
      SET status = @status,
          updated_at = @updated_at,
          resolved_at = @resolved_at
      WHERE id = @id
    `).run({
      id,
      status,
      updated_at: now,
      resolved_at: FINAL_STATUSES.has(status) ? now : null,
    });

    const after = this.db.prepare("SELECT * FROM erp_work_items WHERE id = ?").get(id);
    this.writeEvent({
      accountId: after.account_id,
      workItemId: after.id,
      action: "update_status",
      fromStatus: before.status,
      toStatus: after.status,
      actor,
      remark,
    });
    return after;
  }

  upsertGeneratedTask(task, actor) {
    const now = nowIso();
    const existing = this.db.prepare(`
      SELECT *
      FROM erp_work_items
      WHERE account_id = @account_id AND dedupe_key = @dedupe_key
      LIMIT 1
    `).get({
      account_id: task.accountId,
      dedupe_key: task.dedupeKey,
    });

    if (existing && FINAL_STATUSES.has(existing.status)) {
      return { action: "skipped_final", item: existing };
    }

    const payload = {
      id: existing?.id || createId("wi"),
      account_id: task.accountId,
      type: task.type,
      priority: task.priority,
      status: existing?.status || STATUS.NEW,
      owner_role: task.ownerRole,
      owner_user_id: task.ownerUserId,
      title: task.title,
      evidence_json: JSON.stringify(task.evidence || []),
      related_doc_type: task.relatedDocType,
      related_doc_id: task.relatedDocId,
      sku_id: task.skuId,
      due_at: task.dueAt,
      dedupe_key: task.dedupeKey,
      source_rule: task.sourceRule,
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO erp_work_items (
        id, account_id, type, priority, status, owner_role, owner_user_id,
        title, evidence_json, related_doc_type, related_doc_id, sku_id,
        due_at, dedupe_key, source_rule, created_at, updated_at
      )
      VALUES (
        @id, @account_id, @type, @priority, @status, @owner_role, @owner_user_id,
        @title, @evidence_json, @related_doc_type, @related_doc_id, @sku_id,
        @due_at, @dedupe_key, @source_rule, @created_at, @updated_at
      )
      ON CONFLICT(account_id, dedupe_key) DO UPDATE SET
        type = excluded.type,
        priority = excluded.priority,
        owner_role = excluded.owner_role,
        owner_user_id = excluded.owner_user_id,
        title = excluded.title,
        evidence_json = excluded.evidence_json,
        related_doc_type = excluded.related_doc_type,
        related_doc_id = excluded.related_doc_id,
        sku_id = excluded.sku_id,
        due_at = excluded.due_at,
        source_rule = excluded.source_rule,
        updated_at = excluded.updated_at
    `).run(payload);

    const item = this.db.prepare("SELECT * FROM erp_work_items WHERE id = ?").get(payload.id);
    if (!existing) {
      this.writeEvent({
        accountId: item.account_id,
        workItemId: item.id,
        action: "generated",
        fromStatus: null,
        toStatus: item.status,
        actor,
        remark: task.sourceRule,
      });
      return { action: "created", item };
    }
    return { action: "updated", item };
  }

  resolveStaleGeneratedTasks(activeKeys, params = {}, actor = {}) {
    const activeSet = new Set(activeKeys);
    const clauses = [
      "source_rule LIKE @source_rule",
      "status NOT IN ('done', 'dismissed')",
    ];
    const values = {
      source_rule: `${GENERATED_RULE_PREFIX}%`,
    };
    if (params.accountId) {
      clauses.push("account_id = @account_id");
      values.account_id = params.accountId;
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM erp_work_items
      WHERE ${clauses.join(" AND ")}
    `).all(values);

    let resolved = 0;
    for (const row of rows) {
      if (activeSet.has(row.dedupe_key)) continue;
      const now = nowIso();
      this.db.prepare(`
        UPDATE erp_work_items
        SET status = 'done',
            updated_at = @updated_at,
            resolved_at = @resolved_at
        WHERE id = @id
      `).run({
        id: row.id,
        updated_at: now,
        resolved_at: now,
      });
      this.writeEvent({
        accountId: row.account_id,
        workItemId: row.id,
        action: "auto_resolved",
        fromStatus: row.status,
        toStatus: STATUS.DONE,
        actor,
        remark: "Source document no longer matches the rule",
      });
      resolved += 1;
    }
    return resolved;
  }

  buildTasks(params = {}) {
    const accountClause = (alias) => (params.accountId ? `AND ${alias}.account_id = @account_id` : "");
    const baseParams = { account_id: params.accountId || null };
    const tasks = [];

    const purchaseRequests = this.db.prepare(`
      SELECT
        pr.*,
        sku.internal_sku_code,
        sku.product_name
      FROM erp_purchase_requests pr
      LEFT JOIN erp_skus sku ON sku.id = pr.sku_id
      WHERE pr.status IN ('submitted', 'buyer_processing')
        ${accountClause("pr")}
    `).all(baseParams);

    for (const row of purchaseRequests) {
      if (row.status === "submitted") {
        pushTask(tasks, {
          accountId: row.account_id,
          type: TYPE.PURCHASE_REQUEST_PENDING,
          priority: PRIORITY.P1,
          ownerRole: ERP_ROLES.BUYER,
          title: `采购申请待接收：${formatSku(row)}`,
          evidence: [`申请数量 ${row.requested_qty}`, `原因 ${row.reason}`, `目标到货 ${row.expected_arrival_date || "-"}`],
          relatedDocType: "purchase_request",
          relatedDocId: row.id,
          skuId: row.sku_id,
          dueAt: row.expected_arrival_date,
          sourceRule: "erp:purchase_request:submitted",
          dedupeKey: `purchase_request:${row.id}:submitted`,
        });
      }
      if (row.status === "buyer_processing") {
        pushTask(tasks, {
          accountId: row.account_id,
          type: TYPE.SOURCING_DELAY,
          priority: PRIORITY.P2,
          ownerRole: ERP_ROLES.BUYER,
          title: `采购申请待找货源：${formatSku(row)}`,
          evidence: [`申请数量 ${row.requested_qty}`, `原因 ${row.reason}`],
          relatedDocType: "purchase_request",
          relatedDocId: row.id,
          skuId: row.sku_id,
          dueAt: row.expected_arrival_date,
          sourceRule: "erp:purchase_request:buyer_processing",
          dedupeKey: `purchase_request:${row.id}:buyer_processing`,
        });
      }
    }

    const purchaseOrders = this.db.prepare(`
      SELECT
        po.*,
        supplier.name AS supplier_name,
        GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary
      FROM erp_purchase_orders po
      LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
      LEFT JOIN erp_purchase_order_lines line ON line.po_id = po.id
      LEFT JOIN erp_skus sku ON sku.id = line.sku_id
      WHERE po.status IN ('draft', 'pending_finance_approval', 'approved_to_pay')
        ${accountClause("po")}
      GROUP BY po.id
    `).all(baseParams);

    for (const row of purchaseOrders) {
      if (row.status === "draft") {
        pushTask(tasks, {
          accountId: row.account_id,
          type: TYPE.PAYMENT_APPROVAL_PENDING,
          priority: PRIORITY.P2,
          ownerRole: ERP_ROLES.BUYER,
          title: `采购单待提交付款审批：${row.po_no}`,
          evidence: [`供应商 ${row.supplier_name || "-"}`, `金额 ${row.total_amount || 0}`, row.sku_summary || ""],
          relatedDocType: "purchase_order",
          relatedDocId: row.id,
          dueAt: row.expected_delivery_date,
          sourceRule: "erp:purchase_order:draft",
          dedupeKey: `purchase_order:${row.id}:draft_payment_submit`,
        });
      }
      if (row.status === "pending_finance_approval") {
        pushTask(tasks, {
          accountId: row.account_id,
          type: TYPE.PAYMENT_APPROVAL_PENDING,
          priority: PRIORITY.P1,
          ownerRole: ERP_ROLES.FINANCE,
          title: `付款审批待财务批准：${row.po_no}`,
          evidence: [`供应商 ${row.supplier_name || "-"}`, `金额 ${row.total_amount || 0}`, row.sku_summary || ""],
          relatedDocType: "purchase_order",
          relatedDocId: row.id,
          dueAt: row.expected_delivery_date,
          sourceRule: "erp:purchase_order:pending_finance_approval",
          dedupeKey: `purchase_order:${row.id}:finance_approval`,
        });
      }
      if (row.status === "approved_to_pay") {
        pushTask(tasks, {
          accountId: row.account_id,
          type: TYPE.PAYMENT_CONFIRM_PENDING,
          priority: PRIORITY.P1,
          ownerRole: ERP_ROLES.FINANCE,
          title: `采购单待确认已付款：${row.po_no}`,
          evidence: [`供应商 ${row.supplier_name || "-"}`, `金额 ${row.total_amount || 0}`],
          relatedDocType: "purchase_order",
          relatedDocId: row.id,
          dueAt: row.expected_delivery_date,
          sourceRule: "erp:purchase_order:approved_to_pay",
          dedupeKey: `purchase_order:${row.id}:confirm_paid`,
        });
      }
    }

    const inboundReceipts = this.db.prepare(`
      SELECT
        receipt.*,
        po.po_no,
        supplier.name AS supplier_name,
        GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary,
        COALESCE(SUM(line.received_qty), 0) AS received_qty
      FROM erp_inbound_receipts receipt
      LEFT JOIN erp_purchase_orders po ON po.id = receipt.po_id
      LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
      LEFT JOIN erp_inbound_receipt_lines line ON line.receipt_id = receipt.id
      LEFT JOIN erp_skus sku ON sku.id = line.sku_id
      WHERE receipt.status IN ('pending_arrival', 'arrived', 'counted')
        ${accountClause("receipt")}
      GROUP BY receipt.id
    `).all(baseParams);

    for (const row of inboundReceipts) {
      const statusConfig = {
        pending_arrival: [TYPE.WAREHOUSE_RECEIVE_PENDING, "仓库待确认到仓", "erp:inbound_receipt:pending_arrival"],
        arrived: [TYPE.WAREHOUSE_COUNT_PENDING, "仓库待核数", "erp:inbound_receipt:arrived"],
        counted: [TYPE.WAREHOUSE_INBOUND_PENDING, "仓库待创建入库批次", "erp:inbound_receipt:counted"],
      }[row.status];
      if (!statusConfig) continue;
      pushTask(tasks, {
        accountId: row.account_id,
        type: statusConfig[0],
        priority: PRIORITY.P1,
        ownerRole: ERP_ROLES.WAREHOUSE,
        title: `${statusConfig[1]}：${row.receipt_no}`,
        evidence: [`PO ${row.po_no || "-"}`, `供应商 ${row.supplier_name || "-"}`, `数量 ${row.received_qty || 0}`, row.sku_summary || ""],
        relatedDocType: "inbound_receipt",
        relatedDocId: row.id,
        dueAt: row.received_at,
        sourceRule: statusConfig[2],
        dedupeKey: `inbound_receipt:${row.id}:${row.status}`,
      });
    }

    const pendingQcBatches = this.db.prepare(`
      SELECT
        batch.*,
        sku.internal_sku_code,
        sku.product_name,
        receipt.receipt_no,
        qc.id AS qc_id,
        qc.status AS qc_status_value
      FROM erp_inventory_batches batch
      LEFT JOIN erp_skus sku ON sku.id = batch.sku_id
      LEFT JOIN erp_inbound_receipts receipt ON receipt.id = batch.inbound_receipt_id
      LEFT JOIN erp_qc_inspections qc ON qc.id = (
        SELECT latest.id
        FROM erp_qc_inspections latest
        WHERE latest.batch_id = batch.id
        ORDER BY latest.updated_at DESC
        LIMIT 1
      )
      WHERE (batch.qc_status = 'pending' OR qc.status IN ('pending_qc', 'in_progress'))
        ${accountClause("batch")}
    `).all(baseParams);

    for (const row of pendingQcBatches) {
      pushTask(tasks, {
        accountId: row.account_id,
        type: TYPE.QC_INSPECTION_PENDING,
        priority: PRIORITY.P1,
        ownerRole: ERP_ROLES.OPERATIONS,
        title: `运营待抽检：${formatSku(row)}`,
        evidence: [`批次 ${row.batch_code}`, `入库单 ${row.receipt_no || "-"}`, `锁定 ${row.blocked_qty || 0}`],
        relatedDocType: row.qc_id ? "qc_inspection" : "inventory_batch",
        relatedDocId: row.qc_id || row.id,
        skuId: row.sku_id,
        dueAt: row.received_at,
        sourceRule: "erp:inventory_batch:pending_qc",
        dedupeKey: `inventory_batch:${row.id}:pending_qc`,
      });
    }

    const qcExceptions = this.db.prepare(`
      SELECT
        qc.*,
        batch.batch_code,
        sku.internal_sku_code,
        sku.product_name
      FROM erp_qc_inspections qc
      LEFT JOIN erp_inventory_batches batch ON batch.id = qc.batch_id
      LEFT JOIN erp_skus sku ON sku.id = qc.sku_id
      WHERE qc.status IN ('failed', 'partial_passed', 'rework_required')
        ${accountClause("qc")}
    `).all(baseParams);

    for (const row of qcExceptions) {
      const isFailed = row.status === "failed" || row.status === "rework_required";
      pushTask(tasks, {
        accountId: row.account_id,
        type: isFailed ? TYPE.QC_FAILED : TYPE.QC_PARTIAL_RELEASE,
        priority: isFailed ? PRIORITY.P0 : PRIORITY.P2,
        ownerRole: ERP_ROLES.OPERATIONS,
        title: `${isFailed ? "QC 异常待处理" : "QC 部分通过待确认"}：${formatSku(row)}`,
        evidence: [`批次 ${row.batch_code || row.batch_id}`, `抽检 ${row.actual_sample_qty || 0}`, `不良 ${row.defective_qty || 0}`, `释放 ${row.release_qty || 0}`],
        relatedDocType: "qc_inspection",
        relatedDocId: row.id,
        skuId: row.sku_id,
        sourceRule: `erp:qc_inspection:${row.status}`,
        dedupeKey: `qc_inspection:${row.id}:${row.status}`,
      });
    }

    const outboundShipments = this.db.prepare(`
      SELECT
        shipment.*,
        sku.internal_sku_code,
        sku.product_name,
        batch.batch_code
      FROM erp_outbound_shipments shipment
      LEFT JOIN erp_skus sku ON sku.id = shipment.sku_id
      LEFT JOIN erp_inventory_batches batch ON batch.id = shipment.batch_id
      WHERE shipment.status IN ('pending_warehouse', 'picking', 'packed', 'pending_ops_confirm', 'exception')
        ${accountClause("shipment")}
    `).all(baseParams);

    for (const row of outboundShipments) {
      const config = {
        pending_warehouse: [TYPE.PICKING_PENDING, PRIORITY.P1, ERP_ROLES.WAREHOUSE, "仓库待拣货", "erp:outbound_shipment:pending_warehouse"],
        picking: [TYPE.PACKING_PENDING, PRIORITY.P1, ERP_ROLES.WAREHOUSE, "仓库待打包", "erp:outbound_shipment:picking"],
        packed: [TYPE.SHIP_OUT_PENDING, PRIORITY.P1, ERP_ROLES.WAREHOUSE, "仓库待确认发出", "erp:outbound_shipment:packed"],
        pending_ops_confirm: [TYPE.OUTBOUND_CONFIRM_PENDING, PRIORITY.P1, ERP_ROLES.OPERATIONS, "运营待确认出库完成", "erp:outbound_shipment:pending_ops_confirm"],
        exception: [TYPE.OUTBOUND_EXCEPTION, PRIORITY.P0, ERP_ROLES.OPERATIONS, "出库异常待处理", "erp:outbound_shipment:exception"],
      }[row.status];
      if (!config) continue;
      pushTask(tasks, {
        accountId: row.account_id,
        type: config[0],
        priority: config[1],
        ownerRole: config[2],
        title: `${config[3]}：${row.shipment_no}`,
        evidence: [`SKU ${formatSku(row)}`, `批次 ${row.batch_code || row.batch_id || "-"}`, `数量 ${row.qty || 0}`],
        relatedDocType: "outbound_shipment",
        relatedDocId: row.id,
        skuId: row.sku_id,
        sourceRule: config[4],
        dedupeKey: `outbound_shipment:${row.id}:${row.status}`,
      });
    }

    return tasks;
  }

  generateFromCurrentState(params = {}, actor = {}) {
    const tasks = this.buildTasks(params);
    const activeKeys = tasks.map((task) => task.dedupeKey);
    const result = this.db.transaction(() => {
      const summary = {
        scanned: tasks.length,
        created: 0,
        updated: 0,
        skipped: 0,
        resolved: 0,
      };
      for (const task of tasks) {
        const change = this.upsertGeneratedTask(task, actor);
        if (change.action === "created") summary.created += 1;
        else if (change.action === "updated") summary.updated += 1;
        else summary.skipped += 1;
      }
      summary.resolved = this.resolveStaleGeneratedTasks(activeKeys, params, actor);
      return summary;
    })();

    return {
      generatedAt: nowIso(),
      summary: result,
      items: this.list({
        accountId: params.accountId,
        activeOnly: true,
        limit: params.limit || 100,
      }),
    };
  }

  parseEvidence(row) {
    return parseJsonArray(row.evidence_json);
  }
}

module.exports = {
  WorkItemService,
};
