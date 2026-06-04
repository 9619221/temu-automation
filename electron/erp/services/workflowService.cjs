const { assertTransition } = require("../workflow/validators.cjs");
const { createId, nowIso } = require("./utils.cjs");

const ENTITY_CONFIG = Object.freeze({
  purchase_request: {
    table: "erp_purchase_requests",
  },
  sourcing_candidate: {
    table: "erp_sourcing_candidates",
  },
  purchase_order: {
    table: "erp_purchase_orders",
  },
  inbound_receipt: {
    table: "erp_inbound_receipts",
  },
  qc_inspection: {
    table: "erp_qc_inspections",
  },
  outbound_shipment: {
    table: "erp_outbound_shipments",
  },
});

function assertSafeColumn(column) {
  if (!/^[a-z][a-z0-9_]*$/.test(column)) {
    throw new Error(`Unsafe column name: ${column}`);
  }
}

function pickActor(actor = {}) {
  return {
    id: actor.id || null,
    role: actor.role || "",
  };
}

// 审计快照裁剪：剔除大 JSON 字段、截断超长字符串，避免 before/after 把整行的大字段
// （external_*_json / payload / raw_json / preview 等）原样各存一份，导致审计表爆量
// （历史上单条曾达 30KB、半月 4.3G）。只保留状态/金额/单号等小字段，不影响现有审计读取
// （展示只用 status 等小字段，见 ipc.cjs 流转历史查询）。
const AUDIT_DROP_KEY = /(_json$|payload|raw_|preview|sensitive|logistics_json|detail_json)/i;
const AUDIT_MAX_FIELD_BYTES = 512;

function sanitizeAuditSnapshot(value) {
  if (value == null || typeof value !== "object") return value;
  const isArray = Array.isArray(value);
  const out = isArray ? [] : {};
  for (const [key, val] of Object.entries(value)) {
    if (!isArray && AUDIT_DROP_KEY.test(key)) continue; // 整列丢弃已知大字段
    if (val == null) { out[key] = val; continue; }
    if (typeof val === "object") {
      let serialized = "";
      try { serialized = JSON.stringify(val) || ""; } catch (_) { serialized = "[unserializable]"; }
      out[key] = serialized.length > AUDIT_MAX_FIELD_BYTES ? `[omitted ${serialized.length}B]` : val;
      continue;
    }
    if (typeof val === "string" && val.length > AUDIT_MAX_FIELD_BYTES) {
      out[key] = `${val.slice(0, 64)}…[truncated ${val.length}B]`;
      continue;
    }
    out[key] = val;
  }
  return out;
}

class ErpWorkflowService {
  constructor({ db }) {
    if (!db) throw new Error("ErpWorkflowService requires db");
    this.db = db;
  }

  getEntity(entityType, id) {
    const config = ENTITY_CONFIG[entityType];
    if (!config) throw new Error(`Unknown ERP entity type: ${entityType}`);

    const row = this.db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
    if (!row) throw new Error(`${entityType} not found: ${id}`);
    return row;
  }

  transition(input = {}) {
    const {
      entityType,
      id,
      action,
      toStatus,
      actor,
      patch = {},
    } = input;

    const config = ENTITY_CONFIG[entityType];
    if (!config) throw new Error(`Unknown ERP entity type: ${entityType}`);

    const before = this.getEntity(entityType, id);
    const actorInfo = pickActor(actor);
    assertTransition({
      entityType,
      fromStatus: before.status,
      toStatus,
      action,
      role: actorInfo.role,
    });

    const updatedAt = nowIso();
    const params = {
      id,
      status: toStatus,
      updated_at: updatedAt,
    };
    const assignments = ["status = @status", "updated_at = @updated_at"];

    for (const [column, value] of Object.entries(patch)) {
      if (column === "id" || column === "status" || column === "created_at") continue;
      assertSafeColumn(column);
      assignments.push(`${column} = @${column}`);
      params[column] = value;
    }

    const apply = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE ${config.table}
        SET ${assignments.join(", ")}
        WHERE id = @id
      `).run(params);

      const after = this.getEntity(entityType, id);
      this.writeAudit({
        accountId: after.account_id || before.account_id || null,
        actor: actorInfo,
        action,
        entityType,
        entityId: id,
        before,
        after,
      });
      return after;
    });

    const after = apply();
    return {
      entityType,
      id,
      action,
      fromStatus: before.status,
      toStatus: after.status,
      before,
      after,
    };
  }

  writeAudit(input = {}) {
    this.db.prepare(`
      INSERT INTO erp_audit_logs (
        id, account_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, created_at
      )
      VALUES (
        @id, @account_id, @actor_id, @actor_role, @action, @entity_type,
        @entity_id, @before_json, @after_json, @created_at
      )
    `).run({
      id: createId("audit"),
      account_id: input.accountId,
      actor_id: input.actor?.id || null,
      actor_role: input.actor?.role || null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      before_json: JSON.stringify(sanitizeAuditSnapshot(input.before || null)),
      after_json: JSON.stringify(sanitizeAuditSnapshot(input.after || null)),
      created_at: nowIso(),
    });
  }
}

module.exports = {
  ENTITY_CONFIG,
  ErpWorkflowService,
  sanitizeAuditSnapshot,
};
