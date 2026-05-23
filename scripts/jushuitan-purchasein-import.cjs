#!/usr/bin/env node
/**
 * Import exported Jushuitan purchase-in receipts into ERP warehouse tables.
 *
 * Expected input directory contains files such as:
 *   - jushuitan-purchasein-31385.json
 *   - jushuitan-purchasein-detail-39204.json
 *
 * Usage:
 *   node scripts/jushuitan-purchasein-import.cjs "C:/Users/Administrator/Desktop/商品文件夹"
 *   node scripts/jushuitan-purchasein-import.cjs --dry "C:/Users/Administrator/Desktop/商品文件夹"
 *
 * Server:
 *   ERP_DATA_DIR=/opt/temu-erp-data node scripts/jushuitan-purchasein-import.cjs /tmp/jst-519
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (process.platform === "win32" && process.env.JST_PURCHASEIN_IMPORT_NODE_RUNTIME !== "1") {
  const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");
  relaunchUnderElectronIfNeeded(__filename);
}

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");

const DEFAULT_COMPANY_ID = "company_default";
const NONE_ACCOUNT = "jst:account:none";

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    if (arg === "--dry") {
      args.dry = true;
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
    if (arg.startsWith("--company=")) {
      args.companyId = arg.slice("--company=".length);
      continue;
    }
    if (arg.startsWith("--head=")) {
      args.headFile = arg.slice("--head=".length);
      continue;
    }
    if (arg.startsWith("--detail=")) {
      args.detailFile = arg.slice("--detail=".length);
      continue;
    }
    args._.push(arg);
  }
  return args;
}

function readJsonArray(filePath) {
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(rows)) throw new Error(`JSON 顶层必须是数组: ${filePath}`);
  return rows;
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

function numberValue(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[,，￥¥\s]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function integerQty(value) {
  const number = numberValue(value);
  return number === null ? 0 : Math.max(0, Math.round(number));
}

function normalizeDate(value) {
  const raw = text(value);
  if (!raw) return null;
  return raw.replace(/\//g, "-");
}

function stableHash(value, length = 16) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex").slice(0, length);
}

function stableId(prefix, value) {
  const raw = text(value) || "default";
  const slug = raw.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `jst:${prefix}:${slug || "x"}:${stableHash(raw, 10)}`;
}

function pickFile(sourceDir, explicitFile, matcher, label) {
  if (explicitFile) {
    const filePath = path.isAbsolute(explicitFile) ? explicitFile : path.join(sourceDir, explicitFile);
    if (!fs.existsSync(filePath)) throw new Error(`${label} 不存在: ${filePath}`);
    return { filePath, rows: readJsonArray(filePath) };
  }

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

function mapInboundStatus(row) {
  const status = [
    firstText(row, ["status", "状态"]),
    firstText(row, ["f_status", "财审状态"]),
    firstText(row, ["archived", "财审日期"]),
  ].join(" ");
  if (/取消|作废|cancel/i.test(status)) return "cancelled";
  if (/已审核|已入库|归档|完成|archived/i.test(status)) return "inbounded_pending_qc";
  if (/已到货|到货/i.test(status)) return "arrived";
  return "pending_arrival";
}

function receiptNoOf(row) {
  return firstText(row, ["io_id", "ioId", "入仓单号", "采购入库单号", "入库单号"]);
}

function poNoOf(row) {
  return firstText(row, ["o_id", "oId", "po_id", "poId", "采购单号"]);
}

function skuCodeOf(row) {
  return firstText(row, ["商品编码", "sku_code", "sku_id", "skuId", "i_id", "iId"]);
}

function buildHeaderMap(headers) {
  const map = new Map();
  for (const header of headers) {
    const receiptNo = receiptNoOf(header);
    if (receiptNo && !map.has(receiptNo)) map.set(receiptNo, header);
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args._[0]
    || process.env.JST_PURCHASEIN_EXPORT_DIR
    || path.join(os.homedir(), "Desktop", "商品文件夹");
  const dryRun = args.dry || process.env.DRY === "1";
  const companyId = args.companyId || process.env.COMPANY_ID || DEFAULT_COMPANY_ID;
  const dbOptions = {};
  if (args.dbPath || process.env.ERP_DB) dbOptions.dbPath = args.dbPath || process.env.ERP_DB;
  if (args.dataDir || process.env.ERP_DATA_DIR) dbOptions.dataDir = args.dataDir || process.env.ERP_DATA_DIR;

  const head = pickFile(sourceDir, args.headFile, /^jushuitan-purchasein-\d+\.json$/i, "采购入库抬头 JSON");
  const detail = pickFile(sourceDir, args.detailFile, /^jushuitan-purchasein-detail-\d+\.json$/i, "采购入库明细 JSON");
  const headerByReceipt = buildHeaderMap(head.rows);

  const db = openErpDatabase(dbOptions);
  db.pragma("busy_timeout = 60000");

  try {
    runMigrations({ db });
    const now = new Date().toISOString();

    const upsertCompany = db.prepare(`
      INSERT INTO erp_companies (id, name, code, status, created_at, updated_at)
      VALUES (@id, @name, @code, @status, @created_at, @updated_at)
      ON CONFLICT(id) DO NOTHING
    `);
    const upsertAccount = db.prepare(`
      INSERT INTO erp_accounts (id, company_id, name, phone, status, source, created_at, updated_at)
      VALUES (@id, @company_id, @name, @phone, @status, @source, @created_at, @updated_at)
      ON CONFLICT(id) DO NOTHING
    `);
    const upsertSupplier = db.prepare(`
      INSERT INTO erp_suppliers (
        id, company_id, name, contact_name, phone, wechat, address,
        categories_json, status, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @name, @contact_name, @phone, @wechat, @address,
        @categories_json, @status, @created_at, @updated_at
      )
      ON CONFLICT(id) DO NOTHING
    `);
    const upsertSku = db.prepare(`
      INSERT INTO erp_skus (
        id, company_id, account_id, internal_sku_code, product_name,
        category, image_url, status, created_at, updated_at, color_spec
      )
      VALUES (
        @id, @company_id, @account_id, @internal_sku_code, @product_name,
        @category, @image_url, @status, @created_at, @updated_at, @color_spec
      )
      ON CONFLICT(id) DO NOTHING
    `);
    const poLineRows = db.prepare(`
      SELECT
        line.id AS po_line_id,
        line.account_id,
        line.po_id,
        line.sku_id,
        COALESCE(line.received_qty, 0) AS received_qty,
        po.supplier_id,
        po.po_no,
        sku.internal_sku_code
      FROM erp_purchase_order_lines line
      JOIN erp_purchase_orders po ON po.id = line.po_id
      JOIN erp_skus sku ON sku.id = line.sku_id
      WHERE line.id LIKE 'jst:pol:%'
         OR po.id LIKE 'jst:po:%'
    `).all();
    const poLineByPoSku = new Map();
    for (const row of poLineRows) {
      const key = `${row.po_no || ""}::${row.internal_sku_code || ""}`;
      if (!poLineByPoSku.has(key)) poLineByPoSku.set(key, []);
      poLineByPoSku.get(key).push(row);
    }
    function findMatchingPoLine(poNo, skuCode, qty) {
      const candidates = poLineByPoSku.get(`${poNo || ""}::${skuCode || ""}`) || [];
      if (!candidates.length) return null;
      return candidates.find((row) => Number(row.received_qty || 0) === qty) || candidates[0];
    }
    const upsertReceipt = db.prepare(`
      INSERT INTO erp_inbound_receipts (
        id, account_id, po_id, receipt_no, status, received_at,
        operator_id, remark, created_at, updated_at
      )
      VALUES (
        @id, @account_id, @po_id, @receipt_no, @status, @received_at,
        NULL, @remark, @created_at, @updated_at
      )
      ON CONFLICT(account_id, receipt_no) DO UPDATE SET
        po_id = COALESCE(excluded.po_id, erp_inbound_receipts.po_id),
        status = excluded.status,
        received_at = COALESCE(excluded.received_at, erp_inbound_receipts.received_at),
        remark = excluded.remark,
        updated_at = excluded.updated_at
    `);
    const upsertLine = db.prepare(`
      INSERT INTO erp_inbound_receipt_lines (
        id, account_id, receipt_id, po_line_id, sku_id,
        expected_qty, received_qty, damaged_qty, shortage_qty, over_qty, batch_id
      )
      VALUES (
        @id, @account_id, @receipt_id, @po_line_id, @sku_id,
        @expected_qty, @received_qty, @damaged_qty, 0, 0, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        receipt_id = excluded.receipt_id,
        po_line_id = COALESCE(excluded.po_line_id, erp_inbound_receipt_lines.po_line_id),
        sku_id = excluded.sku_id,
        expected_qty = excluded.expected_qty,
        received_qty = excluded.received_qty,
        damaged_qty = excluded.damaged_qty
    `);

    const seenLines = new Set();
    const stats = {
      mode: dryRun ? "DRY" : "WRITE",
      headFile: path.basename(head.filePath),
      detailFile: path.basename(detail.filePath),
      headRows: head.rows.length,
      detailRows: detail.rows.length,
      importedReceipts: 0,
      importedLines: 0,
      matchedPoLines: 0,
      fallbackLines: 0,
      createdSuppliers: 0,
      createdSkus: 0,
      skippedNoReceipt: 0,
      skippedNoSku: 0,
    };

    const existingSuppliers = new Set(db.prepare("SELECT id FROM erp_suppliers").all().map((row) => row.id));
    const existingSkus = new Set(db.prepare("SELECT id FROM erp_skus").all().map((row) => row.id));
    const touchedReceipts = new Set();

    function ensureFallbackSupplier(row) {
      const supplierCode = firstText(row, ["供应商编码", "seller_id"]);
      const supplierName = firstText(row, ["供应商", "receiver_name_en"]);
      if (!supplierCode && !supplierName) return null;
      const id = supplierCode ? `jst:supplier:${supplierCode}` : stableId("supplier", supplierName);
      if (!existingSuppliers.has(id)) {
        upsertSupplier.run({
          id,
          company_id: companyId,
          name: supplierName || supplierCode,
          contact_name: null,
          phone: null,
          wechat: null,
          address: null,
          categories_json: '["jushuitan_purchasein_export"]',
          status: "active",
          created_at: now,
          updated_at: now,
        });
        existingSuppliers.add(id);
        stats.createdSuppliers += 1;
      }
      return id;
    }

    function ensureFallbackSku(row, accountId, skuCode) {
      const id = `jst:skuprofile:${skuCode}`;
      if (!existingSkus.has(id)) {
        upsertSku.run({
          id,
          company_id: companyId,
          account_id: accountId,
          internal_sku_code: skuCode,
          product_name: firstText(row, ["商品名称"]) || skuCode,
          category: null,
          image_url: firstText(row, ["图片"]) || null,
          status: "active",
          created_at: now,
          updated_at: now,
          color_spec: firstText(row, ["颜色及规格"]) || null,
        });
        existingSkus.add(id);
        stats.createdSkus += 1;
      }
      return id;
    }

    const importRun = db.transaction(() => {
      upsertCompany.run({
        id: companyId,
        name: companyId === DEFAULT_COMPANY_ID ? "Default Company" : companyId,
        code: companyId === DEFAULT_COMPANY_ID ? "default" : companyId,
        status: "active",
        created_at: now,
        updated_at: now,
      });
      upsertAccount.run({
        id: NONE_ACCOUNT,
        company_id: companyId,
        name: "-",
        phone: null,
        status: "offline",
        source: "jushuitan_purchasein_export",
        created_at: now,
        updated_at: now,
      });

      for (const [index, detailRow] of detail.rows.entries()) {
        const receiptNo = receiptNoOf(detailRow);
        if (!receiptNo) {
          stats.skippedNoReceipt += 1;
          continue;
        }
        const skuCode = skuCodeOf(detailRow);
        if (!skuCode) {
          stats.skippedNoSku += 1;
          continue;
        }
        const poNo = poNoOf(detailRow);
        const qty = integerQty(first(detailRow, ["数量", "入库数量", "实收数量"]));
        const poLine = poNo ? findMatchingPoLine(poNo, skuCode, qty) : null;
        const accountId = poLine?.account_id || NONE_ACCOUNT;
        const skuId = poLine?.sku_id || ensureFallbackSku(detailRow, accountId, skuCode);
        const sourceHeader = headerByReceipt.get(receiptNo) || {};
        const header = { ...sourceHeader, ...detailRow };
        ensureFallbackSupplier(header);

        const receiptId = stableId("inbound", `${accountId}:${receiptNo}`);
        const receiptKey = `${accountId}:${receiptNo}`;
        const receivedAt = normalizeDate(first(header, ["io_date", "入库日期", "created", "创建日期", "archived", "财审日期"])) || now;
        upsertReceipt.run({
          id: receiptId,
          account_id: accountId,
          po_id: poLine?.po_id || null,
          receipt_no: receiptNo,
          status: mapInboundStatus(header),
          received_at: receivedAt,
          remark: JSON.stringify({
            source: "jushuitan_purchasein_export",
            poNo,
            supplier: firstText(header, ["供应商", "receiver_name_en"]),
            purchaser: firstText(header, ["采购员", "purchaser_name", "制单人", "creator_name"]),
            warehouse: firstText(header, ["仓库", "warehouse", "wms_co_name"]),
            logisticsCompany: firstText(header, ["物流公司", "logistics_company"]),
            trackingNo: firstText(header, ["物流单号", "l_id", "lId"]),
            totalQty: integerQty(first(header, ["total_qty", "数量"])),
            totalAmount: numberValue(first(header, ["total_amount", "金额"])),
            importFile: path.basename(detail.filePath),
          }),
          created_at: normalizeDate(first(header, ["created", "创建日期", "io_date", "入库日期"])) || now,
          updated_at: normalizeDate(first(header, ["modified", "archived", "财审日期", "io_date", "入库日期"])) || now,
        });
        if (!touchedReceipts.has(receiptKey)) {
          touchedReceipts.add(receiptKey);
          stats.importedReceipts += 1;
        }

        const lineKey = `${receiptId}:${poLine?.po_line_id || ""}:${skuId}:${stableHash(JSON.stringify(detailRow), 20)}:${index}`;
        if (seenLines.has(lineKey)) continue;
        seenLines.add(lineKey);
        const damagedQty = integerQty(first(detailRow, ["质检次品数", "损坏数量", "破损数量"]));
        upsertLine.run({
          id: `jst:irl:${stableHash(lineKey, 24)}`,
          account_id: accountId,
          receipt_id: receiptId,
          po_line_id: poLine?.po_line_id || null,
          sku_id: skuId,
          expected_qty: qty,
          received_qty: qty,
          damaged_qty: damagedQty,
        });
        stats.importedLines += 1;
        if (poLine?.po_line_id) stats.matchedPoLines += 1;
        else stats.fallbackLines += 1;
      }

      if (dryRun) throw new Error("__DRY_ROLLBACK__");
    });

    let rolledBack = false;
    try {
      importRun();
    } catch (error) {
      if (error?.message === "__DRY_ROLLBACK__") rolledBack = true;
      else throw error;
    }

    const after = {
      inboundReceipts: db.prepare("SELECT COUNT(*) AS count FROM erp_inbound_receipts WHERE id LIKE 'jst:inbound:%' OR remark LIKE '%jushuitan_purchasein_export%'").get().count,
      inboundLines: db.prepare("SELECT COUNT(*) AS count FROM erp_inbound_receipt_lines WHERE id LIKE 'jst:irl:%'").get().count,
    };

    console.log(JSON.stringify({ ok: true, rolledBack, stats, after }, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error("FATAL:", error?.stack || error?.message || String(error));
  process.exit(1);
}
