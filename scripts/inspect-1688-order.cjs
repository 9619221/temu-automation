#!/usr/bin/env node

const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function defaultUserDataDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "temu-automation");
}

function resolveDbPath() {
  const explicitDb = argValue("--db") || process.env.ERP_DB;
  if (explicitDb) return path.resolve(explicitDb);
  const dataDir = argValue("--data-dir") || process.env.ERP_DATA_DIR || process.env.ERP_DATA_PATH;
  if (dataDir) return path.join(path.resolve(dataDir), "erp.sqlite");
  return path.join(defaultUserDataDir(), "data", "erp.sqlite");
}

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function main() {
  const externalOrderId = optionalString(argValue("--external-order-id") || process.env.ERP_1688_EXTERNAL_ORDER_ID);
  const poId = optionalString(argValue("--po-id") || process.env.ERP_1688_PO_ID);
  if (!externalOrderId && !poId) {
    throw new Error("Provide --external-order-id or --po-id");
  }

  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const po = externalOrderId
      ? db.prepare(`
        SELECT id, po_no, status, payment_status, external_order_id, external_order_status,
               external_order_synced_at, external_order_previewed_at, pr_id, account_id
        FROM erp_purchase_orders
        WHERE external_order_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(externalOrderId)
      : db.prepare(`
        SELECT id, po_no, status, payment_status, external_order_id, external_order_status,
               external_order_synced_at, external_order_previewed_at, pr_id, account_id
        FROM erp_purchase_orders
        WHERE id = ?
        LIMIT 1
      `).get(poId);

    const events = po?.pr_id
      ? db.prepare(`
        SELECT event_type, actor_role, message, created_at
        FROM erp_purchase_request_events
        WHERE pr_id = ?
        ORDER BY created_at ASC
      `).all(po.pr_id)
      : [];

    const auditLogs = po
      ? db.prepare(`
        SELECT action, entity_type, entity_id, actor_role, created_at
        FROM erp_audit_logs
        WHERE entity_id IN (?, ?)
        ORDER BY created_at ASC
      `).all(po.pr_id || "", po.id)
      : [];

    const apiLogs = db.prepare(`
      SELECT api_key, action, status, error_message, created_by, created_at
      FROM erp_1688_api_call_log
      WHERE action IN ('preview_1688_order', 'push_1688_order')
      ORDER BY created_at DESC
      LIMIT 8
    `).all();

    console.log(JSON.stringify({
      ok: Boolean(po),
      dbPath,
      po,
      events,
      auditLogs,
      apiLogs,
    }, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
}
