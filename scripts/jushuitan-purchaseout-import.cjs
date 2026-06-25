#!/usr/bin/env node
/**
 * 聚水潭采购退货历史导入（一次性）。
 *
 * 输入目录必须包含：
 *   - jushuitan-purchaseout-1062.json        （单头 1062 条）
 *   - jushuitan-purchaseout-detail-1264.json （明细 1264 条）
 *
 * 用法：
 *   node scripts/jushuitan-purchaseout-import.cjs "C:/Users/Administrator/Desktop/商品文件夹"
 *   node scripts/jushuitan-purchaseout-import.cjs --dry "C:/Users/Administrator/Desktop/商品文件夹"
 *
 * 数据库覆写：
 *   --db=C:/path/to/erp.sqlite
 *   --data-dir=C:/path/to/data
 *   --company=company_default
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

if (process.env.JST_PURCHASEOUT_IMPORT_NODE_RUNTIME !== "1") {
  relaunchUnderElectronIfNeeded(__filename);
}

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");

const DEFAULT_HEAD_FILE = "jushuitan-purchaseout-1062.json";
const DEFAULT_DETAIL_FILE = "jushuitan-purchaseout-detail-1264.json";
const DEFAULT_COMPANY_ID = "company_default";

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    if (arg === "--dry") { args.dry = true; continue; }
    if (arg.startsWith("--db=")) { args.dbPath = arg.slice("--db=".length); continue; }
    if (arg.startsWith("--data-dir=")) { args.dataDir = arg.slice("--data-dir=".length); continue; }
    if (arg.startsWith("--company=")) { args.companyId = arg.slice("--company=".length); continue; }
    if (arg.startsWith("--head=")) { args.headFile = arg.slice("--head=".length); continue; }
    if (arg.startsWith("--detail=")) { args.detailFile = arg.slice("--detail=".length); continue; }
    args._.push(arg);
  }
  return args;
}

function pickJsonFile(sourceDir, defaultName, override) {
  if (override) {
    const p = path.isAbsolute(override) ? override : path.join(sourceDir, override);
    if (!fs.existsSync(p)) throw new Error(`缺少导出文件: ${p}`);
    return p;
  }
  // 允许文件名末尾的数字不一致（jushuitan-purchaseout-*.json）。
  const direct = path.join(sourceDir, defaultName);
  if (fs.existsSync(direct)) return direct;
  const prefix = defaultName.replace(/-\d+\.json$/, "-");
  const match = fs.readdirSync(sourceDir).find((name) => name.startsWith(prefix) && name.endsWith(".json"));
  if (!match) throw new Error(`缺少导出文件: ${direct}（或同前缀 ${prefix}*.json）`);
  return path.join(sourceDir, match);
}

function readJsonArray(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const data = JSON.parse(content);
  if (!Array.isArray(data)) throw new Error(`${filePath} 顶层必须是数组`);
  return data;
}

function text(value) {
  return value == null ? null : String(value).trim() || null;
}

function intValue(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function floatValue(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildHeadRow(raw, companyId, nowIso) {
  const ioId = intValue(raw.io_id);
  if (!ioId) return null;
  return {
    id: `jst:po-out:${ioId}`,
    company_id: companyId,
    io_id: ioId,
    io_date: text(raw.io_date),
    status: text(raw.status),
    f_status: text(raw.f_status),
    total_qty: intValue(raw.total_qty),
    total_sku_count: intValue(raw.total_sku_ids),
    total_amount: floatValue(raw.total_amount),
    wms_co_name: text(raw.wms_co_name),
    warehouse: text(raw.warehouse),
    supplier_name: text(raw.receiver_name),
    creator_name: text(raw.creator_name),
    archiver_name: text(raw.archiver),
    archived_at: text(raw.archived),
    labels: text(raw.labels),
    remark: text(raw.remark),
    created_text: text(raw.created),
    modified_text: text(raw.modified),
    raw_json: JSON.stringify(raw),
    imported_at: nowIso,
    updated_at: nowIso,
    status_internal: "active",
  };
}

function buildItemRow(raw, companyId, nowIso) {
  const ioiId = intValue(raw.ioi_id);
  const ioId = intValue(raw.io_id || raw.__io_id);
  if (!ioiId || !ioId) return null;
  return {
    id: `jst:po-out-item:${ioiId}`,
    company_id: companyId,
    io_id: ioId,
    ioi_id: ioiId,
    sku_id: text(raw.sku_id),
    product_name: text(raw.name),
    properties_value: text(raw.properties_value),
    pic_url: text(raw.pic),
    qty: intValue(raw.qty),
    cost_price: floatValue(raw.cost_price),
    cost_amount: floatValue(raw.cost_amount),
    i_id: text(raw.i_id),
    supplier_i_id: text(raw.supplier_i_id),
    supplier_sku_id: text(raw.supplier_sku_id),
    labels: text(raw.labels),
    remark: text(raw.remark),
    raw_json: JSON.stringify(raw),
    imported_at: nowIso,
    updated_at: nowIso,
    status_internal: "active",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args._[0]
    || process.env.JST_PURCHASEOUT_EXPORT_DIR
    || path.join(os.homedir(), "Desktop", "商品文件夹");
  const dryRun = args.dry || process.env.DRY === "1";
  const companyId = args.companyId || process.env.COMPANY_ID || DEFAULT_COMPANY_ID;
  const dbOptions = {};
  if (args.dbPath || process.env.ERP_DB) dbOptions.dbPath = args.dbPath || process.env.ERP_DB;
  if (args.dataDir || process.env.ERP_DATA_DIR) dbOptions.dataDir = args.dataDir || process.env.ERP_DATA_DIR;

  const headPath = pickJsonFile(sourceDir, DEFAULT_HEAD_FILE, args.headFile);
  const detailPath = pickJsonFile(sourceDir, DEFAULT_DETAIL_FILE, args.detailFile);
  console.log(`[purchaseout-import] 单头：${headPath}`);
  console.log(`[purchaseout-import] 明细：${detailPath}`);

  const rawHeads = readJsonArray(headPath);
  const rawDetails = readJsonArray(detailPath);
  const now = new Date().toISOString();

  const headRows = [];
  const headIoIds = new Set();
  const headSkipped = [];
  for (const raw of rawHeads) {
    const row = buildHeadRow(raw, companyId, now);
    if (!row) { headSkipped.push(raw); continue; }
    headRows.push(row);
    headIoIds.add(row.io_id);
  }

  const itemRows = [];
  const itemsOrphan = [];
  const itemsSkipped = [];
  for (const raw of rawDetails) {
    const row = buildItemRow(raw, companyId, now);
    if (!row) { itemsSkipped.push(raw); continue; }
    if (!headIoIds.has(row.io_id)) { itemsOrphan.push(row); continue; }
    itemRows.push(row);
  }

  console.log(`[purchaseout-import] 解析：单头 ${headRows.length}（跳过 ${headSkipped.length}），明细 ${itemRows.length}（孤儿 ${itemsOrphan.length} / 跳过 ${itemsSkipped.length}）`);

  if (dryRun) {
    if (headRows[0]) console.log("[dry] 头样例：", JSON.stringify(headRows[0], null, 2));
    if (itemRows[0]) console.log("[dry] 明细样例：", JSON.stringify(itemRows[0], null, 2));
    console.log("[dry] 未写库，退出。");
    return;
  }

  const db = openErpDatabase(dbOptions);
  db.pragma("busy_timeout = 60000");

  try {
    await runMigrations({ db });

    // 保险：确保 company 存在（开发库可能没有 company_default）。
    db.prepare(`
      INSERT INTO erp_companies (id, name, code, status, created_at, updated_at)
      VALUES (@id, @name, @code, 'active', @now, @now)
      ON CONFLICT(id) DO NOTHING
    `).run({ id: companyId, name: companyId, code: companyId, now });

    const upsertHead = db.prepare(`
      INSERT INTO purchase_returns (
        id, company_id, io_id, io_date, status, f_status,
        total_qty, total_sku_count, total_amount,
        wms_co_name, warehouse, supplier_name,
        creator_name, archiver_name, archived_at,
        labels, remark, created_text, modified_text,
        raw_json, imported_at, updated_at, status_internal
      ) VALUES (
        @id, @company_id, @io_id, @io_date, @status, @f_status,
        @total_qty, @total_sku_count, @total_amount,
        @wms_co_name, @warehouse, @supplier_name,
        @creator_name, @archiver_name, @archived_at,
        @labels, @remark, @created_text, @modified_text,
        @raw_json, @imported_at, @updated_at, @status_internal
      )
      ON CONFLICT(id) DO UPDATE SET
        io_date = excluded.io_date,
        status = excluded.status,
        f_status = excluded.f_status,
        total_qty = excluded.total_qty,
        total_sku_count = excluded.total_sku_count,
        total_amount = excluded.total_amount,
        wms_co_name = excluded.wms_co_name,
        warehouse = excluded.warehouse,
        supplier_name = excluded.supplier_name,
        creator_name = excluded.creator_name,
        archiver_name = excluded.archiver_name,
        archived_at = excluded.archived_at,
        labels = excluded.labels,
        remark = excluded.remark,
        created_text = excluded.created_text,
        modified_text = excluded.modified_text,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at,
        status_internal = excluded.status_internal
    `);

    const upsertItem = db.prepare(`
      INSERT INTO purchase_return_items (
        id, company_id, io_id, ioi_id,
        sku_id, product_name, properties_value, pic_url,
        qty, cost_price, cost_amount,
        i_id, supplier_i_id, supplier_sku_id,
        labels, remark, raw_json,
        imported_at, updated_at, status_internal
      ) VALUES (
        @id, @company_id, @io_id, @ioi_id,
        @sku_id, @product_name, @properties_value, @pic_url,
        @qty, @cost_price, @cost_amount,
        @i_id, @supplier_i_id, @supplier_sku_id,
        @labels, @remark, @raw_json,
        @imported_at, @updated_at, @status_internal
      )
      ON CONFLICT(id) DO UPDATE SET
        io_id = excluded.io_id,
        sku_id = excluded.sku_id,
        product_name = excluded.product_name,
        properties_value = excluded.properties_value,
        pic_url = excluded.pic_url,
        qty = excluded.qty,
        cost_price = excluded.cost_price,
        cost_amount = excluded.cost_amount,
        i_id = excluded.i_id,
        supplier_i_id = excluded.supplier_i_id,
        supplier_sku_id = excluded.supplier_sku_id,
        labels = excluded.labels,
        remark = excluded.remark,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at,
        status_internal = excluded.status_internal
    `);

    const tx = db.transaction(() => {
      for (const row of headRows) upsertHead.run(row);
      for (const row of itemRows) upsertItem.run(row);
    });
    tx();

    const headCount = db.prepare("SELECT COUNT(*) AS c FROM purchase_returns WHERE company_id = ?").get(companyId).c;
    const itemCount = db.prepare("SELECT COUNT(*) AS c FROM purchase_return_items WHERE company_id = ?").get(companyId).c;
    console.log(`[purchaseout-import] 完成。库内合计：单头 ${headCount}，明细 ${itemCount}`);
  } finally {
    db.close();
  }
}

try { main(); } catch (error) {
  console.error("[purchaseout-import] 失败：", error && error.stack ? error.stack : error);
  process.exit(1);
}
