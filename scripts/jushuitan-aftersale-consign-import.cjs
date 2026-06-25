#!/usr/bin/env node
/**
 * 聚水潭送仓售后历史导入（一次性）。
 *
 * 输入目录必须包含：
 *   - jushuitan-aftersale-consign-5483.json   （单头 5483 条）
 *   - jushuitan-aftersale-detail-10325.json   （明细 10325 条，含 __as_id 反向引用）
 *
 * 用法：
 *   node scripts/jushuitan-aftersale-consign-import.cjs "C:/Users/Administrator/Desktop/商品文件夹"
 *   node scripts/jushuitan-aftersale-consign-import.cjs --dry "C:/Users/Administrator/Desktop/商品文件夹"
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

if (process.env.JST_CONSIGN_AS_IMPORT_NODE_RUNTIME !== "1") {
  relaunchUnderElectronIfNeeded(__filename);
}

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");

const DEFAULT_HEAD_FILE = "jushuitan-aftersale-consign-5483.json";
const DEFAULT_DETAIL_FILE = "jushuitan-aftersale-detail-10325.json";
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

function boolToInt(value) {
  if (value == null) return null;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function arrayToJson(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return null; }
}

function isJinanShop(name) {
  return /济南/.test(String(name || ""));
}

function buildHeadRow(raw, companyId, nowIso) {
  const asId = intValue(raw.as_id || raw.id);
  if (!asId) return null;
  return {
    id: `jst:as-consign:${asId}`,
    company_id: companyId,
    as_id: asId,
    outer_as_id: text(raw.outer_as_id),
    as_date: text(raw.as_date),
    shop_type: text(raw.shop_type),
    type: text(raw.type),
    status: text(raw.status),
    shop_status: text(raw.shop_status),
    good_status: text(raw.good_status),
    shop_name: text(raw.shop_name),
    shop_id: intValue(raw.shop_id),
    shop_site: text(raw.shop_site),
    warehouse: text(raw.warehouse),
    wh_id: intValue(raw.wh_id),
    wh_code: text(raw.wh_code),
    receiver_name: text(raw.receiver_name_en || raw.receiver_name),
    receiver_mobile: text(raw.receiver_mobile_en || raw.receiver_mobile),
    receiver_phone: text(raw.receiver_phone_en || raw.receiver_phone),
    refund_qty: intValue(raw.refund_Qty != null ? raw.refund_Qty : raw.refund_qty),
    r_qty: intValue(raw.r_qty),
    box_id_count: intValue(raw.box_id_count),
    payment: floatValue(raw.payment),
    total_amount: floatValue(raw.total_amount),
    refund_total_amount: floatValue(raw.refund_total_amount),
    buyer_apply_refund: text(raw.buyer_apply_refund),
    refund: floatValue(raw.refund),
    logistics_company: text(raw.logistics_company),
    l_id: text(raw.l_id),
    o_id: text(raw.o_id),
    so_id: text(raw.so_id),
    labels: text(raw.labels),
    remark: text(raw.remark),
    modifier_name: text(raw.modifier_name),
    creator_name: text(raw.creator_name),
    confirm_date: text(raw.confirm_date),
    created_text: text(raw.created),
    modified_text: text(raw.modified),
    raw_json: JSON.stringify(raw),
    imported_at: nowIso,
    updated_at: nowIso,
    status_internal: "active",
  };
}

function buildItemRow(raw, companyId, nowIso) {
  const asiId = intValue(raw.asi_id);
  const asId = intValue(raw.__as_id);
  if (!asiId || !asId) return null;
  return {
    id: `jst:as-consign-item:${asiId}`,
    company_id: companyId,
    asi_id: asiId,
    as_id: asId,
    outer_as_id: text(raw.__outer_as_id),
    shop_name: text(raw.__shop_name),
    sku_id: text(raw.sku_id),
    i_id: text(raw.i_id),
    sku_code: text(raw.sku_code),
    product_name: text(raw.name),
    properties_value: text(raw.properties_value),
    pic_url: text(raw.pic),
    qty: intValue(raw.qty),
    r_qty: intValue(raw.r_qty),
    defective_qty: intValue(raw.defective_qty),
    price: floatValue(raw.price),
    amount: floatValue(raw.amount),
    refund_amount: floatValue(raw.refund_amount),
    shop_amount: text(raw.shop_amount),
    supplier_name: text(raw.supplier_name),
    type: text(raw.type),
    des: typeof raw.des === "string" ? raw.des : arrayToJson(raw.des),
    outer_oi_id: text(raw.outer_oi_id),
    o_id: text(raw.o_id),
    o_id_en: text(raw.o_id_en),
    box_id: text(raw.box_id),
    item_sign: text(raw.item_sign),
    temu_bill_ids: text(raw.temu_bill_ids),
    temu_has_flaw: boolToInt(raw.temu_has_flaw),
    temu_so_id: text(raw.temu_so_id),
    item_labels: arrayToJson(raw.item_labels),
    shelf_life: intValue(raw.shelf_life),
    is_enable_batch: boolToInt(raw.is_enable_batch),
    receive_date: text(raw.receive_date),
    raw_json: JSON.stringify(raw),
    imported_at: nowIso,
    updated_at: nowIso,
    status_internal: "active",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args._[0]
    || process.env.JST_CONSIGN_AS_EXPORT_DIR
    || path.join(os.homedir(), "Desktop", "商品文件夹");
  const dryRun = args.dry || process.env.DRY === "1";
  const companyId = args.companyId || process.env.COMPANY_ID || DEFAULT_COMPANY_ID;
  const dbOptions = {};
  if (args.dbPath || process.env.ERP_DB) dbOptions.dbPath = args.dbPath || process.env.ERP_DB;
  if (args.dataDir || process.env.ERP_DATA_DIR) dbOptions.dataDir = args.dataDir || process.env.ERP_DATA_DIR;

  const headPath = pickJsonFile(sourceDir, DEFAULT_HEAD_FILE, args.headFile);
  const detailPath = pickJsonFile(sourceDir, DEFAULT_DETAIL_FILE, args.detailFile);
  console.log(`[consign-as-import] 单头：${headPath}`);
  console.log(`[consign-as-import] 明细：${detailPath}`);

  const rawHeads = readJsonArray(headPath);
  const rawDetails = readJsonArray(detailPath);
  const now = new Date().toISOString();

  const headRows = [];
  const headAsIds = new Set();
  const headSkipped = [];
  const jinanAsIds = new Set();
  let headJinanSkipped = 0;
  for (const raw of rawHeads) {
    const row = buildHeadRow(raw, companyId, now);
    if (!row) { headSkipped.push(raw); continue; }
    if (isJinanShop(row.shop_name)) {
      jinanAsIds.add(row.as_id);
      headJinanSkipped += 1;
      continue;
    }
    headRows.push(row);
    headAsIds.add(row.as_id);
  }

  const itemRows = [];
  const itemsOrphan = [];
  const itemsSkipped = [];
  let itemJinanSkipped = 0;
  for (const raw of rawDetails) {
    const row = buildItemRow(raw, companyId, now);
    if (!row) { itemsSkipped.push(raw); continue; }
    if (jinanAsIds.has(row.as_id) || isJinanShop(row.shop_name)) {
      itemJinanSkipped += 1;
      continue;
    }
    if (!headAsIds.has(row.as_id)) { itemsOrphan.push(row); continue; }
    itemRows.push(row);
  }

  console.log(`[consign-as-import] 解析：单头 ${headRows.length}（跳过 ${headSkipped.length}，济南 ${headJinanSkipped}），明细 ${itemRows.length}（孤儿 ${itemsOrphan.length} / 跳过 ${itemsSkipped.length}，济南 ${itemJinanSkipped}）`);

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

    db.prepare(`
      INSERT INTO erp_companies (id, name, code, status, created_at, updated_at)
      VALUES (@id, @name, @code, 'active', @now, @now)
      ON CONFLICT(id) DO NOTHING
    `).run({ id: companyId, name: companyId, code: companyId, now });

    const upsertHead = db.prepare(`
      INSERT INTO consign_after_sales (
        id, company_id, as_id, outer_as_id, as_date,
        shop_type, type, status, shop_status, good_status,
        shop_name, shop_id, shop_site,
        warehouse, wh_id, wh_code,
        receiver_name, receiver_mobile, receiver_phone,
        refund_qty, r_qty, box_id_count,
        payment, total_amount, refund_total_amount,
        buyer_apply_refund, refund,
        logistics_company, l_id, o_id, so_id,
        labels, remark, modifier_name, creator_name,
        confirm_date, created_text, modified_text,
        raw_json, imported_at, updated_at, status_internal
      ) VALUES (
        @id, @company_id, @as_id, @outer_as_id, @as_date,
        @shop_type, @type, @status, @shop_status, @good_status,
        @shop_name, @shop_id, @shop_site,
        @warehouse, @wh_id, @wh_code,
        @receiver_name, @receiver_mobile, @receiver_phone,
        @refund_qty, @r_qty, @box_id_count,
        @payment, @total_amount, @refund_total_amount,
        @buyer_apply_refund, @refund,
        @logistics_company, @l_id, @o_id, @so_id,
        @labels, @remark, @modifier_name, @creator_name,
        @confirm_date, @created_text, @modified_text,
        @raw_json, @imported_at, @updated_at, @status_internal
      )
      ON CONFLICT(id) DO UPDATE SET
        outer_as_id = excluded.outer_as_id,
        as_date = excluded.as_date,
        shop_type = excluded.shop_type,
        type = excluded.type,
        status = excluded.status,
        shop_status = excluded.shop_status,
        good_status = excluded.good_status,
        shop_name = excluded.shop_name,
        shop_id = excluded.shop_id,
        shop_site = excluded.shop_site,
        warehouse = excluded.warehouse,
        wh_id = excluded.wh_id,
        wh_code = excluded.wh_code,
        receiver_name = excluded.receiver_name,
        receiver_mobile = excluded.receiver_mobile,
        receiver_phone = excluded.receiver_phone,
        refund_qty = excluded.refund_qty,
        r_qty = excluded.r_qty,
        box_id_count = excluded.box_id_count,
        payment = excluded.payment,
        total_amount = excluded.total_amount,
        refund_total_amount = excluded.refund_total_amount,
        buyer_apply_refund = excluded.buyer_apply_refund,
        refund = excluded.refund,
        logistics_company = excluded.logistics_company,
        l_id = excluded.l_id,
        o_id = excluded.o_id,
        so_id = excluded.so_id,
        labels = excluded.labels,
        remark = excluded.remark,
        modifier_name = excluded.modifier_name,
        creator_name = excluded.creator_name,
        confirm_date = excluded.confirm_date,
        created_text = excluded.created_text,
        modified_text = excluded.modified_text,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at,
        status_internal = excluded.status_internal
    `);

    const upsertItem = db.prepare(`
      INSERT INTO consign_after_sale_items (
        id, company_id, asi_id, as_id, outer_as_id, shop_name,
        sku_id, i_id, sku_code, product_name, properties_value, pic_url,
        qty, r_qty, defective_qty,
        price, amount, refund_amount, shop_amount,
        supplier_name, type, des,
        outer_oi_id, o_id, o_id_en, box_id, item_sign,
        temu_bill_ids, temu_has_flaw, temu_so_id,
        item_labels, shelf_life, is_enable_batch, receive_date,
        raw_json, imported_at, updated_at, status_internal
      ) VALUES (
        @id, @company_id, @asi_id, @as_id, @outer_as_id, @shop_name,
        @sku_id, @i_id, @sku_code, @product_name, @properties_value, @pic_url,
        @qty, @r_qty, @defective_qty,
        @price, @amount, @refund_amount, @shop_amount,
        @supplier_name, @type, @des,
        @outer_oi_id, @o_id, @o_id_en, @box_id, @item_sign,
        @temu_bill_ids, @temu_has_flaw, @temu_so_id,
        @item_labels, @shelf_life, @is_enable_batch, @receive_date,
        @raw_json, @imported_at, @updated_at, @status_internal
      )
      ON CONFLICT(id) DO UPDATE SET
        as_id = excluded.as_id,
        outer_as_id = excluded.outer_as_id,
        shop_name = excluded.shop_name,
        sku_id = excluded.sku_id,
        i_id = excluded.i_id,
        sku_code = excluded.sku_code,
        product_name = excluded.product_name,
        properties_value = excluded.properties_value,
        pic_url = excluded.pic_url,
        qty = excluded.qty,
        r_qty = excluded.r_qty,
        defective_qty = excluded.defective_qty,
        price = excluded.price,
        amount = excluded.amount,
        refund_amount = excluded.refund_amount,
        shop_amount = excluded.shop_amount,
        supplier_name = excluded.supplier_name,
        type = excluded.type,
        des = excluded.des,
        outer_oi_id = excluded.outer_oi_id,
        o_id = excluded.o_id,
        o_id_en = excluded.o_id_en,
        box_id = excluded.box_id,
        item_sign = excluded.item_sign,
        temu_bill_ids = excluded.temu_bill_ids,
        temu_has_flaw = excluded.temu_has_flaw,
        temu_so_id = excluded.temu_so_id,
        item_labels = excluded.item_labels,
        shelf_life = excluded.shelf_life,
        is_enable_batch = excluded.is_enable_batch,
        receive_date = excluded.receive_date,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at,
        status_internal = excluded.status_internal
    `);

    const tx = db.transaction(() => {
      for (const row of headRows) upsertHead.run(row);
      for (const row of itemRows) upsertItem.run(row);
    });
    tx();

    const headCount = db.prepare("SELECT COUNT(*) AS c FROM consign_after_sales WHERE company_id = ?").get(companyId).c;
    const itemCount = db.prepare("SELECT COUNT(*) AS c FROM consign_after_sale_items WHERE company_id = ?").get(companyId).c;
    console.log(`[consign-as-import] 完成。库内合计：单头 ${headCount}，明细 ${itemCount}`);
  } finally {
    db.close();
  }
}

try { main(); } catch (error) {
  console.error("[consign-as-import] 失败：", error && error.stack ? error.stack : error);
  process.exit(1);
}
