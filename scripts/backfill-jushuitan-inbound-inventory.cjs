#!/usr/bin/env node
/**
 * Repair imported Jushuitan purchase-in receipts:
 * - received_at comes only from source 入库日期 / io_date
 * - warehouse is normalized to the warehouse company name used by the business
 * - already-inbounded receipts get inventory batches and ledger entries
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

if (process.platform === "win32" && process.env.JST_PURCHASEIN_BACKFILL_NODE_RUNTIME !== "1") {
  const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");
  relaunchUnderElectronIfNeeded(__filename);
}

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");

const JUSHUITAN_WAREHOUSE_NAME = "义乌明舵国际贸易有限公司";

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    if (arg === "--dry") {
      args.dry = true;
      continue;
    }
    if (arg === "--include-jinan") {
      args.includeJinan = true;
      continue;
    }
    if (arg.startsWith("--db=")) {
      args.dbPath = arg.slice("--db=".length);
      continue;
    }
    if (arg.startsWith("--data-dir=")) {
      args.dataDir = arg.slice("--data-dir=".length);
      continue;
    }
    args._.push(arg);
  }
  return args;
}

function text(value) {
  return String(value ?? "").trim();
}

function first(record, keys) {
  for (const key of keys) {
    if (!record || !Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return "";
}

function firstText(record, keys) {
  return text(first(record, keys));
}

function normalizeDate(value) {
  const raw = text(value);
  return raw ? raw.replace(/\//g, "-") : null;
}

function stableHash(value, length = 16) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex").slice(0, length);
}

function receiptNoOf(row) {
  return firstText(row, ["io_id", "ioId", "入仓单号", "采购入库单号", "入库单号"]);
}

function rowContainsText(record, pattern) {
  return Object.values(record || {}).some((value) => pattern.test(text(value)));
}

function mapInboundStatus(row) {
  const status = [
    firstText(row, ["status", "状态"]),
    firstText(row, ["f_status", "财审状态"]),
    firstText(row, ["archived", "财审日期"]),
  ].join(" ");
  if (/取消|作废|cancel/i.test(status)) return "cancelled";
  if (/待入库/i.test(status)) return "jst_pending_inbound";
  if (/已审核|已入库|归档|完成|archived/i.test(status)) return "inbounded_pending_qc";
  if (/已到货|到货/i.test(status)) return "arrived";
  return "pending_arrival";
}

function parseJsonObject(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readJsonArray(filePath) {
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(rows)) throw new Error(`JSON 顶层必须是数组: ${filePath}`);
  return rows;
}

function pickFile(sourceDir, matcher, label) {
  const candidates = fs.readdirSync(sourceDir)
    .filter((name) => matcher.test(name))
    .map((name) => {
      const filePath = path.join(sourceDir, name);
      const rows = readJsonArray(filePath);
      return { filePath, rows };
    })
    .sort((a, b) => b.rows.length - a.rows.length);
  if (!candidates.length) throw new Error(`缺少${label}`);
  return candidates[0];
}

function buildSourceMap(headRows, detailRows) {
  const headerByReceipt = new Map();
  for (const row of headRows) {
    const receiptNo = receiptNoOf(row);
    if (receiptNo && !headerByReceipt.has(receiptNo)) headerByReceipt.set(receiptNo, row);
  }
  const map = new Map();
  for (const detail of detailRows) {
    const receiptNo = receiptNoOf(detail);
    if (!receiptNo || map.has(receiptNo)) continue;
    const row = { ...(headerByReceipt.get(receiptNo) || {}), ...detail };
    map.set(receiptNo, {
      status: mapInboundStatus(row),
      sourceStatus: firstText(row, ["状态", "status"]),
      sourceFinancialStatus: firstText(row, ["财审状态", "f_status"]),
      sourceRemark: firstText(row, ["备注", "remark"]),
      sourceWarehouse: firstText(row, ["仓库", "warehouse", "wms_co_name"]),
      inboundAt: normalizeDate(first(row, ["io_date", "入库日期"])),
    });
  }
  return map;
}

function buildBatchCode(receiptNo, lineId, index) {
  const safeReceiptNo = text(receiptNo || "JST-INBOUND").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40);
  const safeLine = text(lineId || index + 1).replace(/[^A-Za-z0-9_-]+/g, "-").slice(-8);
  return `${safeReceiptNo}-B${String(index + 1).padStart(2, "0")}-${safeLine}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args._[0] || process.cwd();
  const dryRun = Boolean(args.dry);
  const dbOptions = {};
  if (args.dbPath) dbOptions.dbPath = args.dbPath;
  if (args.dataDir || process.env.ERP_DATA_DIR) dbOptions.dataDir = args.dataDir || process.env.ERP_DATA_DIR;

  const head = pickFile(sourceDir, /^jushuitan-purchasein-\d+\.json$/i, "采购入库抬头 JSON");
  const detail = pickFile(sourceDir, /^jushuitan-purchasein-detail-\d+\.json$/i, "采购入库明细 JSON");
  const excludePattern = /济南/;
  const headRows = args.includeJinan ? head.rows : head.rows.filter((row) => !rowContainsText(row, excludePattern));
  const detailRows = args.includeJinan ? detail.rows : detail.rows.filter((row) => !rowContainsText(row, excludePattern));
  const sourceByReceipt = buildSourceMap(headRows, detailRows);

  const db = openErpDatabase(dbOptions);
  db.pragma("busy_timeout = 60000");
  try {
    await runMigrations({ db });
    const now = new Date().toISOString();
    const receipts = db.prepare(`
      SELECT *
      FROM erp_inbound_receipts
      WHERE remark LIKE '%jushuitan_purchasein_export%'
         OR id LIKE 'jst:inbound:%'
    `).all();
    const lines = db.prepare(`
      SELECT line.*
      FROM erp_inbound_receipt_lines line
      JOIN erp_inbound_receipts receipt ON receipt.id = line.receipt_id
      WHERE receipt.remark LIKE '%jushuitan_purchasein_export%'
         OR receipt.id LIKE 'jst:inbound:%'
      ORDER BY line.receipt_id ASC, line.id ASC
    `).all();
    const linesByReceiptId = new Map();
    for (const line of lines) {
      const bucket = linesByReceiptId.get(line.receipt_id) || [];
      bucket.push(line);
      linesByReceiptId.set(line.receipt_id, bucket);
    }
    const updateReceipt = db.prepare(`
      UPDATE erp_inbound_receipts
      SET status = @status,
          received_at = @received_at,
          remark = @remark
      WHERE id = @id
    `);
    const updateLineQty = db.prepare(`
      UPDATE erp_inbound_receipt_lines
      SET expected_qty = @expected_qty,
          received_qty = @received_qty,
          shortage_qty = 0,
          over_qty = 0
      WHERE id = @id
    `);
    const linkLineBatch = db.prepare(`
      UPDATE erp_inbound_receipt_lines
      SET batch_id = @batch_id
      WHERE id = @id
    `);
    const upsertBatch = db.prepare(`
      INSERT INTO erp_inventory_batches (
        id, account_id, batch_code, sku_id, po_id, inbound_receipt_id,
        received_qty, available_qty, reserved_qty, blocked_qty, defective_qty,
        rework_qty, unit_landed_cost, qc_status, location_code,
        received_at, created_at, updated_at
      )
      VALUES (
        @id, @account_id, @batch_code, @sku_id, @po_id, @inbound_receipt_id,
        @received_qty, @available_qty, 0, 0, 0,
        0, 0, 'passed', @location_code,
        @received_at, @created_at, @updated_at
      )
      ON CONFLICT(account_id, batch_code) DO UPDATE SET
        sku_id = excluded.sku_id,
        po_id = COALESCE(excluded.po_id, erp_inventory_batches.po_id),
        inbound_receipt_id = excluded.inbound_receipt_id,
        received_qty = excluded.received_qty,
        available_qty = CASE
          WHEN erp_inventory_batches.reserved_qty = 0
            AND erp_inventory_batches.blocked_qty = 0
            AND erp_inventory_batches.defective_qty = 0
            AND erp_inventory_batches.rework_qty = 0
          THEN excluded.available_qty
          ELSE erp_inventory_batches.available_qty
        END,
        qc_status = 'passed',
        location_code = excluded.location_code,
        received_at = excluded.received_at,
        updated_at = excluded.updated_at
    `);
    const upsertLedger = db.prepare(`
      INSERT INTO erp_inventory_ledger_entries (
        id, account_id, sku_id, batch_id, type, qty_delta, from_bucket,
        to_bucket, unit_cost, source_doc_type, source_doc_id, created_at, created_by
      )
      VALUES (
        @id, @account_id, @sku_id, @batch_id, 'purchase_inbound', @qty_delta, NULL,
        'available', 0, 'inbound_receipt', @source_doc_id, @created_at, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        qty_delta = excluded.qty_delta,
        created_at = excluded.created_at
    `);

    const stats = {
      mode: dryRun ? "DRY" : "WRITE",
      sourceReceipts: sourceByReceipt.size,
      receipts: receipts.length,
      updatedReceipts: 0,
      normalizedPendingLines: 0,
      normalizedInboundedLines: 0,
      batchesUpserted: 0,
      ledgersUpserted: 0,
      missingSource: 0,
    };

    const run = db.transaction(() => {
      for (const receipt of receipts) {
        const source = sourceByReceipt.get(receipt.receipt_no);
        if (!source) {
          stats.missingSource += 1;
          continue;
        }
        const remark = parseJsonObject(receipt.remark);
        if (remark.warehouse && remark.warehouse !== JUSHUITAN_WAREHOUSE_NAME && !remark.sourceWarehouse) {
          remark.sourceWarehouse = remark.warehouse;
        }
        remark.warehouse = JUSHUITAN_WAREHOUSE_NAME;
        remark.sourceWarehouse = remark.sourceWarehouse || source.sourceWarehouse || null;
        remark.sourceInboundAt = source.inboundAt || null;
        remark.sourceStatus = source.sourceStatus || remark.sourceStatus || null;
        remark.sourceFinancialStatus = source.sourceFinancialStatus || remark.sourceFinancialStatus || null;
        if (source.sourceRemark) remark.sourceRemark = source.sourceRemark;

        updateReceipt.run({
          id: receipt.id,
          status: source.status,
          received_at: source.inboundAt || null,
          remark: JSON.stringify(remark),
        });
        stats.updatedReceipts += 1;

        const receiptLines = linesByReceiptId.get(receipt.id) || [];
        receiptLines.forEach((line, index) => {
          const expectedQty = Math.max(0, Math.floor(Number(line.expected_qty || 0)));
          const nextReceivedQty = source.status === "inbounded_pending_qc"
            ? Math.max(0, Math.floor(Number(line.received_qty || expectedQty || 0)))
            : 0;
          updateLineQty.run({ id: line.id, expected_qty: expectedQty, received_qty: nextReceivedQty });
          if (source.status === "inbounded_pending_qc") stats.normalizedInboundedLines += 1;
          else stats.normalizedPendingLines += 1;
          if (source.status !== "inbounded_pending_qc" || nextReceivedQty <= 0) return;

          const batchCode = buildBatchCode(receipt.receipt_no, line.id, index);
          const batchId = line.batch_id || `jst:batch:${stableHash(`${receipt.account_id}:${batchCode}`, 24)}`;
          const receivedAt = source.inboundAt || receipt.received_at || receipt.created_at || now;
          upsertBatch.run({
            id: batchId,
            account_id: receipt.account_id,
            batch_code: batchCode,
            sku_id: line.sku_id,
            po_id: receipt.po_id || line.po_id || null,
            inbound_receipt_id: receipt.id,
            received_qty: nextReceivedQty,
            available_qty: nextReceivedQty,
            location_code: JUSHUITAN_WAREHOUSE_NAME,
            received_at: receivedAt,
            created_at: receivedAt,
            updated_at: now,
          });
          linkLineBatch.run({ id: line.id, batch_id: batchId });
          upsertLedger.run({
            id: `jst:ledger:${stableHash(`purchase_inbound:${batchId}`, 24)}`,
            account_id: receipt.account_id,
            sku_id: line.sku_id,
            batch_id: batchId,
            qty_delta: nextReceivedQty,
            source_doc_id: receipt.id,
            created_at: receivedAt,
          });
          stats.batchesUpserted += 1;
          stats.ledgersUpserted += 1;
        });
      }
      if (dryRun) throw new Error("__DRY_ROLLBACK__");
    });

    try {
      run();
    } catch (error) {
      if (error?.message !== "__DRY_ROLLBACK__") throw error;
    }
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    db.close();
  }
}

main();
