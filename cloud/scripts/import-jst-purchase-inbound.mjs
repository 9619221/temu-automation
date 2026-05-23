import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_DIR = path.join(os.homedir(), "Desktop", "商品文件夹");
const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/temu-cloud.sqlite");
const MIGRATION_FILE = path.resolve(__dirname, "../db/migrations/011_jst_purchase_inbound.sql");
const DEFAULT_EXCLUDE_ACCOUNT_PATTERN = "济南";

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function num(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function firstText(...values) {
  for (const value of values) {
    const s = text(value);
    if (s) return s;
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const n = num(value);
    if (n != null) return n;
  }
  return null;
}

function normalizeDateTime(value) {
  const s = text(value);
  if (!s) return null;
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
  if (!match) return s;
  const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:${ss.padStart(2, "0")}`;
}

function normalizeDate(value) {
  const s = normalizeDateTime(value);
  return s ? s.slice(0, 10) : "";
}

function dateRange(rows, pick) {
  let min = "";
  let max = "";
  let datedRows = 0;
  for (const row of rows) {
    const d = normalizeDate(pick(row));
    if (!d) continue;
    datedRows += 1;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { min, max, datedRows };
}

function stableLineId(tenantId, row, index) {
  const seed = [
    tenantId,
    firstText(row["入仓单号"], row.io_id),
    firstText(row["采购单号"], row.o_id),
    firstText(row["商品编码"], row.sku_id, row.sku_code),
    firstText(row["颜色及规格"], row.properties_value),
    firstText(row["数量"], row.qty),
    firstText(row["金额"], row.amount),
    index,
  ].join("|");
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 24);
}

function readJsonArray(filePath, label) {
  if (!filePath) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} 不是 JSON 数组: ${filePath}`);
  }
  return parsed;
}

function numberedFileScore(fileName) {
  const match = /-(\d+)\.json$/i.exec(fileName);
  return match ? Number(match[1]) : 0;
}

function selectLatestFile(sourceDir, regex) {
  const files = fs.readdirSync(sourceDir)
    .filter((name) => regex.test(name))
    .map((name) => {
      const fullPath = path.join(sourceDir, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, score: numberedFileScore(name), mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((left, right) => (
      right.score - left.score
      || right.mtimeMs - left.mtimeMs
      || right.size - left.size
      || left.name.localeCompare(right.name)
    ));
  return files[0]?.fullPath || "";
}

function buildSkuProfileMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const code = text(row?.internal_sku_code || row?.商品编码 || row?.sku_code);
    if (!code) continue;
    map.set(code, row);
  }
  return map;
}

function resolveAccountName(row, profile) {
  return firstText(
    profile?.jst_brand,
    profile?.brand,
    row["店铺"],
    row["品牌"],
    row.account_name,
  );
}

function excludedByAccount(row, skuProfileByCode, excludePattern) {
  if (!excludePattern) return false;
  const skuCode = firstText(row["商品编码"], row.sku_id, row.sku_code);
  const profile = skuProfileByCode.get(skuCode);
  return resolveAccountName(row, profile).includes(excludePattern);
}

function aggregateDetailRows(detailRows, skuProfileByCode) {
  const byReceipt = new Map();
  for (const row of detailRows) {
    const receiptNo = firstText(row["入仓单号"], row.io_id);
    if (!receiptNo) continue;
    const skuCode = firstText(row["商品编码"], row.sku_id, row.sku_code);
    const profile = skuProfileByCode.get(skuCode);
    const accountName = resolveAccountName(row, profile);
    const agg = byReceipt.get(receiptNo) || {
      receiptNo,
      first: row,
      accountName: "",
      qty: 0,
      amount: 0,
      lineCount: 0,
      skuCodes: new Set(),
      freight: null,
      fee: null,
    };
    agg.lineCount += 1;
    agg.qty += num(row["数量"]) || 0;
    agg.amount += num(row["金额"]) || 0;
    if (skuCode) agg.skuCodes.add(skuCode);
    if (!agg.accountName && accountName) agg.accountName = accountName;
    if (agg.freight == null) agg.freight = firstNumber(row["运费"]);
    if (agg.fee == null) agg.fee = firstNumber(row["费用"]);
    byReceipt.set(receiptNo, agg);
  }
  return byReceipt;
}

function buildOrderRecord(tenantId, headerRow, aggregate, sourceFile) {
  const detail = aggregate?.first || {};
  const receiptNo = firstText(headerRow?.io_id, detail["入仓单号"]);
  const totalAmount = firstNumber(headerRow?.total_amount, aggregate?.amount);
  const freightAmount = firstNumber(headerRow?.freight, aggregate?.freight);
  const feeAmount = firstNumber(headerRow?.operating_fee, aggregate?.fee);
  const paidAmount = (totalAmount || 0) + (freightAmount || 0);
  return {
    tenant_id: tenantId,
    receipt_no: receiptNo,
    purchase_no: firstText(headerRow?.o_id, detail["采购单号"]),
    online_purchase_no: firstText(headerRow?.plat_so_id, detail["线上采购单号"], detail["线上订单号"]),
    supplier_name: firstText(headerRow?.receiver_name_en, detail["供应商"]),
    supplier_code: firstText(headerRow?.seller_id, detail["供应商编码"]),
    account_name: aggregate?.accountName || "",
    operation_warehouse_name: firstText(detail["操作仓储方"], headerRow?.wms_co_name),
    warehouse_name: firstText(headerRow?.warehouse, detail["仓库"]),
    status: firstText(headerRow?.status, detail["状态"]),
    finance_status: firstText(headerRow?.f_status, detail["财审状态"], detail["财审人"] ? "已审核" : ""),
    inbound_type: firstText(headerRow?.type, detail["进仓类型"]),
    created_at: normalizeDateTime(firstText(headerRow?.created, detail["创建日期"])),
    inbound_at: normalizeDateTime(firstText(headerRow?.io_date, detail["入库日期"])),
    archived_at: normalizeDateTime(firstText(headerRow?.archived, detail["财审日期"])),
    modified_at: normalizeDateTime(headerRow?.modified),
    total_qty: firstNumber(headerRow?.total_qty, aggregate?.qty),
    line_count: Number(aggregate?.lineCount || headerRow?.total_sku_ids || 0) || 0,
    sku_count: Number(headerRow?.total_sku_ids || aggregate?.skuCodes?.size || 0) || 0,
    total_amount: totalAmount,
    freight_amount: freightAmount,
    fee_amount: feeAmount,
    paid_amount: paidAmount,
    purchaser_name: firstText(headerRow?.purchaser_name, detail["采购员"]),
    creator_name: firstText(headerRow?.creator_name, detail["制单人"]),
    logistics_company: firstText(headerRow?.logistics_company, detail["物流公司"]),
    tracking_no: firstText(headerRow?.l_id, detail["物流单号"]),
    labels: firstText(headerRow?.labels, detail["标记多标签"]),
    remark: firstText(headerRow?.remark, detail["备注"]),
    source_file: sourceFile,
    raw_json: JSON.stringify(headerRow || detail),
  };
}

function buildLineRecord(tenantId, row, index, skuProfileByCode, sourceFile, orderByReceipt) {
  const receiptNo = firstText(row["入仓单号"], row.io_id);
  const skuCode = firstText(row["商品编码"], row.sku_id, row.sku_code);
  const profile = skuProfileByCode.get(skuCode);
  const order = orderByReceipt.get(receiptNo) || {};
  return {
    tenant_id: tenantId,
    line_id: stableLineId(tenantId, row, index),
    receipt_no: receiptNo,
    purchase_no: firstText(row["采购单号"], order.purchase_no),
    online_purchase_no: firstText(row["线上采购单号"], row["线上订单号"], order.online_purchase_no),
    account_name: resolveAccountName(row, profile) || order.account_name || "",
    supplier_name: firstText(row["供应商"], order.supplier_name),
    supplier_code: firstText(row["供应商编码"], order.supplier_code),
    operation_warehouse_name: firstText(row["操作仓储方"], order.operation_warehouse_name),
    warehouse_name: firstText(row["仓库"], order.warehouse_name),
    status: firstText(row["状态"], order.status),
    finance_status: firstText(row["财审状态"], order.finance_status, row["财审人"] ? "已审核" : ""),
    inbound_type: firstText(row["进仓类型"], order.inbound_type),
    created_at: normalizeDateTime(firstText(row["创建日期"], order.created_at)),
    inbound_at: normalizeDateTime(firstText(row["入库日期"], order.inbound_at)),
    archived_at: normalizeDateTime(firstText(row["财审日期"], order.archived_at)),
    sku_code: skuCode,
    product_name: firstText(row["商品名称"], profile?.product_name),
    style_code: firstText(row["款式编号"], profile?.jst_style_code),
    color_spec: firstText(row["颜色及规格"], profile?.color_spec),
    image_url: firstText(row["图片"], profile?.image_url),
    product_tag: firstText(row["商品标签"]),
    qty: firstNumber(row["数量"]),
    qc_qty: firstNumber(row["质检数"], row["总质检数"]),
    qc_good_qty: firstNumber(row["质检正品数"], row["总质检正品数"]),
    qc_defective_qty: firstNumber(row["质检次品数"], row["总质检次品数"]),
    unit: firstText(row["单位"], profile?.jst_unit),
    box_qty: firstNumber(row["标准装箱数量"]),
    carton_qty: firstNumber(row["箱数"]),
    unit_price: firstNumber(row["单价"]),
    amount: firstNumber(row["金额"]),
    tax_rate: firstNumber(row["明细税率"], row["税率"]),
    no_tax_unit_price: firstNumber(row["不含税单价"]),
    no_tax_amount: firstNumber(row["不含税金额"]),
    warehouse_available_qty: firstNumber(row["仓库可用数"]),
    bind_location: firstText(row["绑定仓位"], profile?.jst_main_bin),
    shelf_location: firstText(row["上架仓位"]),
    supplier_style_no: firstText(row["供应商款号"]),
    supplier_sku_code: firstText(row["供应商商品编码"]),
    weight: firstNumber(row["重量"]),
    volume: firstNumber(row["体积"]),
    remark: firstText(row["入库明细备注"], row["备注"]),
    source_file: sourceFile,
    raw_json: JSON.stringify(row),
  };
}

function insertStmt(db, table, row) {
  const columns = Object.keys(row);
  const names = columns.join(", ");
  const placeholders = columns.map((name) => `@${name}`).join(", ");
  const updates = columns
    .filter((name) => name !== "tenant_id" && name !== "receipt_no" && name !== "line_id")
    .map((name) => `${name} = excluded.${name}`)
    .join(", ");
  const conflict = table.endsWith("_orders") ? "(tenant_id, receipt_no)" : "(tenant_id, line_id)";
  return db.prepare(`
    INSERT INTO ${table} (${names})
    VALUES (${placeholders})
    ON CONFLICT ${conflict} DO UPDATE SET ${updates}, imported_at = datetime('now')
  `);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(String(args["source-dir"] || args.sourceDir || DEFAULT_SOURCE_DIR));
  const dbPath = path.resolve(String(args["cloud-db"] || args.db || process.env.CLOUD_DB || DEFAULT_DB_PATH));
  const tenantId = String(args.tenant || process.env.TENANT_ID || "default-tenant");
  const append = Boolean(args.append);
  const headerPath = path.resolve(String(args.header || selectLatestFile(sourceDir, /^jushuitan-purchasein-\d+\.json$/i)));
  const detailPath = path.resolve(String(args.detail || selectLatestFile(sourceDir, /^jushuitan-purchasein-detail-\d+\.json$/i)));
  const profileCandidate = args["sku-profile"] || args.profile || path.join(sourceDir, "jushuitan-sku-profile.json");
  const profilePath = fs.existsSync(profileCandidate) ? path.resolve(String(profileCandidate)) : "";
  const excludeAccountPattern = String(args["exclude-account-pattern"] ?? args.excludeAccountPattern ?? DEFAULT_EXCLUDE_ACCOUNT_PATTERN).trim();

  if (!fs.existsSync(sourceDir)) throw new Error(`source dir not found: ${sourceDir}`);
  if (!fs.existsSync(headerPath)) throw new Error(`header file not found: ${headerPath}`);
  if (!fs.existsSync(detailPath)) throw new Error(`detail file not found: ${detailPath}`);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(fs.readFileSync(MIGRATION_FILE, "utf8"));

  const headers = readJsonArray(headerPath, "入仓单主表");
  const details = readJsonArray(detailPath, "入仓单明细");
  const profiles = profilePath ? readJsonArray(profilePath, "SKU 档案") : [];
  const headerDateRange = dateRange(headers, (row) => firstText(row.io_date, row.created));
  const detailDateRange = dateRange(details, (row) => firstText(row["入库日期"], row["创建日期"]));
  const skuProfileByCode = buildSkuProfileMap(profiles);
  const includedDetails = [];
  const excludedDetails = [];
  for (const row of details) {
    if (excludedByAccount(row, skuProfileByCode, excludeAccountPattern)) excludedDetails.push(row);
    else includedDetails.push(row);
  }
  const detailAgg = aggregateDetailRows(includedDetails, skuProfileByCode);

  const headerByReceipt = new Map(headers.map((row) => [firstText(row.io_id), row]).filter(([key]) => key));
  const orderSourceFile = path.basename(headerPath);
  const detailSourceFile = path.basename(detailPath);
  const orderRows = [];
  for (const [receiptNo, aggregate] of detailAgg.entries()) {
    const header = headerByReceipt.get(receiptNo);
    orderRows.push(buildOrderRecord(tenantId, header || null, aggregate, header ? orderSourceFile : detailSourceFile));
  }
  const orderByReceipt = new Map(orderRows.map((row) => [row.receipt_no, row]));
  const lineRows = includedDetails
    .map((row, index) => buildLineRecord(tenantId, row, index, skuProfileByCode, detailSourceFile, orderByReceipt))
    .filter((row) => row.receipt_no && row.sku_code);

  const tx = db.transaction(() => {
    if (!append) {
      db.prepare("DELETE FROM jst_purchase_inbound_lines WHERE tenant_id = ?").run(tenantId);
      db.prepare("DELETE FROM jst_purchase_inbound_orders WHERE tenant_id = ?").run(tenantId);
    }
    if (orderRows.length) {
      const stmt = insertStmt(db, "jst_purchase_inbound_orders", orderRows[0]);
      for (const row of orderRows) stmt.run(row);
    }
    if (lineRows.length) {
      const stmt = insertStmt(db, "jst_purchase_inbound_lines", lineRows[0]);
      for (const row of lineRows) stmt.run(row);
    }
  });
  tx();

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM jst_purchase_inbound_orders WHERE tenant_id = @tenant_id) AS order_count,
      (SELECT COUNT(*) FROM jst_purchase_inbound_lines WHERE tenant_id = @tenant_id) AS line_count,
      (SELECT COALESCE(SUM(qty), 0) FROM jst_purchase_inbound_lines WHERE tenant_id = @tenant_id) AS qty,
      (SELECT COALESCE(SUM(amount), 0) FROM jst_purchase_inbound_lines WHERE tenant_id = @tenant_id) AS amount,
      (SELECT COUNT(*) FROM jst_purchase_inbound_lines WHERE tenant_id = @tenant_id AND NULLIF(TRIM(COALESCE(account_name, '')), '') IS NOT NULL) AS account_filled_lines
  `).get({ tenant_id: tenantId });
  console.log(JSON.stringify({
    tenantId,
    dbPath,
    sourceDir,
    header: { file: headerPath, rows: headers.length, dateRange: headerDateRange },
    detail: { file: detailPath, rows: details.length, dateRange: detailDateRange },
    skuProfile: { file: profilePath || null, rows: profiles.length },
    imported: {
      orders: orderRows.length,
      lines: lineRows.length,
      excludeAccountPattern,
      excludedLines: excludedDetails.length,
      headerMatchedReceipts: Array.from(detailAgg.keys()).filter((receiptNo) => headerByReceipt.has(receiptNo)).length,
      detailOnlyReceipts: Array.from(detailAgg.keys()).filter((receiptNo) => !headerByReceipt.has(receiptNo)).length,
      accountFilledLines: Number(summary.account_filled_lines || 0),
    },
    totals: {
      orders: Number(summary.order_count || 0),
      lines: Number(summary.line_count || 0),
      qty: Number(summary.qty || 0),
      amount: Number(summary.amount || 0),
    },
  }, null, 2));
  db.close();
}

main();
