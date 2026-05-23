#!/usr/bin/env node
/**
 * One-time import for exported Jushuitan purchase orders.
 *
 * Input directory must contain:
 *   - jushuitan-purchase-orders-head-36373.json
 *   - jushuitan-purchase-detail.json
 *   - jushuitan-sku-profile.json
 *
 * Usage:
 *   node scripts/jushuitan-purchase-import.cjs "C:/Users/Administrator/Desktop/商品文件夹"
 *   node scripts/jushuitan-purchase-import.cjs --dry "C:/Users/Administrator/Desktop/商品文件夹"
 *
 * Optional DB overrides:
 *   --db=C:/path/to/erp.sqlite
 *   --data-dir=C:/path/to/data
 *   --company=company_default
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

if (process.env.JST_PURCHASE_IMPORT_NODE_RUNTIME !== "1") {
  relaunchUnderElectronIfNeeded(__filename);
}

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");

const HEAD_FILE = "jushuitan-purchase-orders-head-36373.json";
const DETAIL_FILE = "jushuitan-purchase-detail.json";
const PROFILE_FILE = "jushuitan-sku-profile.json";
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
    args._.push(arg);
  }
  return args;
}

function requiredJsonFile(sourceDir, fileName) {
  const filePath = path.join(sourceDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少导出文件: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(content);
}

function text(value) {
  return String(value ?? "").trim();
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

function isJinanBrand(brand) {
  return /^济南/.test(brand || "");
}

function freightStore(name, supplier) {
  const combined = `${name} ${supplier}`;
  if (!/快递费|到付/.test(combined)) return null;
  const match = combined.match(/(\d+)\s*店/);
  if (!match) return null;
  return `${match[1].padStart(3, "0")}店`;
}

function mapStatus(headStatus, receiveStatus) {
  const status = text(headStatus);
  if (/作废|取消/.test(status)) return "cancelled";
  if (/待审核/.test(status)) return "draft";
  const receive = text(receiveStatus);
  if (/全部入库/.test(receive)) return "inbounded";
  if (/部分入库/.test(receive)) return "arrived";
  return "supplier_processing";
}

function mapPaymentStatus(header) {
  if (text(header.plat_pay_date)) return "paid";
  if (/完成/.test(text(header.status))) return "paid";
  if (/交易成功|等待买家收货|等待卖家发货/.test(text(header.outer_status_1688))) return "paid";
  return "unpaid";
}

function mapPaidAt(header) {
  return text(header.plat_pay_date) || null;
}

function roundMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function sumLineMoney(lines, key) {
  return lines.reduce((sum, line) => sum + (numberValue(line[key]) || 0), 0);
}

function mapFreightAmount(header, lines, isSplit, allOrderLines = lines) {
  const headerFreight = numberValue(header.freight)
    ?? (lines.length ? numberValue(lines[0]["运费"]) : null);
  if (headerFreight === null) return null;
  if (!isSplit) return roundMoney(headerFreight);
  const groupGoodsAmount = sumLineMoney(lines, "金额");
  const orderGoodsAmount = sumLineMoney(allOrderLines, "金额");
  if (orderGoodsAmount > 0 && groupGoodsAmount >= 0) {
    return roundMoney(headerFreight * groupGoodsAmount / orderGoodsAmount);
  }
  return roundMoney(headerFreight);
}

function mapPaidAmount(header, lines, isSplit, allOrderLines = lines, fallbackTotalAmount = null) {
  const headerPaid = numberValue(header.plat_total_amount)
    ?? (lines.length ? (numberValue(lines[0]["线上实付总金额"]) ?? numberValue(lines[0]["总金额"])) : null);
  if (!isSplit) return roundMoney(headerPaid ?? fallbackTotalAmount);
  const groupGoodsAmount = sumLineMoney(lines, "金额");
  const orderGoodsAmount = sumLineMoney(allOrderLines, "金额");
  if (headerPaid !== null && orderGoodsAmount > 0 && groupGoodsAmount >= 0) {
    return roundMoney(headerPaid * groupGoodsAmount / orderGoodsAmount);
  }
  const freight = mapFreightAmount(header, lines, isSplit, allOrderLines) || 0;
  if (groupGoodsAmount > 0) return roundMoney(groupGoodsAmount + freight);
  return roundMoney(headerPaid ?? fallbackTotalAmount);
}

function skuCodeForLine(poNo, line, index) {
  return text(line["商品编码"]) || `UNKNOWN-${poNo}-${index + 1}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args._[0]
    || process.env.JST_PURCHASE_EXPORT_DIR
    || path.join(os.homedir(), "Desktop", "商品文件夹");
  const dryRun = args.dry || process.env.DRY === "1";
  const companyId = args.companyId || process.env.COMPANY_ID || DEFAULT_COMPANY_ID;
  const dbOptions = {};
  if (args.dbPath || process.env.ERP_DB) dbOptions.dbPath = args.dbPath || process.env.ERP_DB;
  if (args.dataDir || process.env.ERP_DATA_DIR) dbOptions.dataDir = args.dataDir || process.env.ERP_DATA_DIR;

  const headers = requiredJsonFile(sourceDir, HEAD_FILE);
  const details = requiredJsonFile(sourceDir, DETAIL_FILE);
  const profiles = requiredJsonFile(sourceDir, PROFILE_FILE);
  if (!Array.isArray(headers) || !Array.isArray(details) || !Array.isArray(profiles)) {
    throw new Error("三份导出 JSON 顶层都必须是数组");
  }

  const profileByCode = new Map();
  for (const profile of profiles) {
    const code = text(profile.internal_sku_code);
    if (!code) continue;
    profileByCode.set(code, {
      brand: profile.jst_brand == null ? "" : text(profile.jst_brand),
      name: text(profile.product_name),
      colorSpec: text(profile.color_spec),
      image: text(profile.image_url),
    });
  }

  const linesByPo = new Map();
  for (const detail of details) {
    const poNo = text(detail["采购单号"]);
    if (!poNo) continue;
    if (!linesByPo.has(poNo)) linesByPo.set(poNo, []);
    linesByPo.get(poNo).push(detail);
  }

  const db = openErpDatabase(dbOptions);
  db.pragma("busy_timeout = 60000");

  try {
    runMigrations({ db });

    const existingSkuCodes = new Set(
      db.prepare("SELECT internal_sku_code FROM erp_skus WHERE id LIKE 'jst:skuprofile:%'")
        .all()
        .map((row) => row.internal_sku_code),
    );
    const existingAccounts = new Set(
      db.prepare("SELECT id FROM erp_accounts").all().map((row) => row.id),
    );
    const createdSuppliers = new Set();
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
    const upsertPurchaseOrder = db.prepare(`
      INSERT INTO erp_purchase_orders (
        id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
        status, payment_status, paid_at, expected_delivery_date, actual_delivery_date,
        total_amount, paid_amount, freight_amount, created_by, created_at, updated_at, external_order_id,
        external_order_status, external_order_payload_json, external_order_synced_at,
        external_order_preview_json, external_order_previewed_at, external_payment_url,
        external_payment_url_synced_at, external_order_detail_json,
        external_order_detail_synced_at, external_logistics_json, external_logistics_synced_at,
        jst_purchaser_name
      )
      VALUES (
        @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
        @status, @payment_status, @paid_at, @expected_delivery_date, @actual_delivery_date,
        @total_amount, @paid_amount, @freight_amount, @created_by, @created_at, @updated_at, @external_order_id,
        @external_order_status, @external_order_payload_json, @external_order_synced_at,
        @external_order_preview_json, @external_order_previewed_at, @external_payment_url,
        @external_payment_url_synced_at, @external_order_detail_json,
        @external_order_detail_synced_at, @external_logistics_json, @external_logistics_synced_at,
        @jst_purchaser_name
      )
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        supplier_id = excluded.supplier_id,
        status = excluded.status,
        payment_status = excluded.payment_status,
        paid_at = COALESCE(excluded.paid_at, paid_at),
        total_amount = excluded.total_amount,
        paid_amount = COALESCE(excluded.paid_amount, paid_amount),
        freight_amount = COALESCE(excluded.freight_amount, freight_amount),
        updated_at = excluded.updated_at,
        external_order_payload_json = excluded.external_order_payload_json,
        jst_purchaser_name = excluded.jst_purchaser_name
    `);
    const upsertLine = db.prepare(`
      INSERT INTO erp_purchase_order_lines (
        id, account_id, po_id, sku_id, qty, unit_cost, logistics_fee,
        expected_qty, received_qty, remark, jst_payload_json
      )
      VALUES (
        @id, @account_id, @po_id, @sku_id, @qty, @unit_cost, @logistics_fee,
        @expected_qty, @received_qty, @remark, @jst_payload_json
      )
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        po_id = excluded.po_id,
        sku_id = excluded.sku_id,
        qty = excluded.qty,
        unit_cost = excluded.unit_cost,
        received_qty = excluded.received_qty,
        remark = excluded.remark,
        jst_payload_json = excluded.jst_payload_json
    `);

    const stats = {
      headCount: headers.length,
      importedPurchaseOrders: 0,
      splitChildOrders: 0,
      importedLines: 0,
      skippedJinanOrders: 0,
      skippedJinanLines: 0,
      headerOnlyOrders: 0,
      createdBrandAccounts: 0,
      createdSuppliers: 0,
      createdSkus: 0,
    };

    function ensureAccount(id, name) {
      if (existingAccounts.has(id)) return;
      upsertAccount.run({
        id,
        company_id: companyId,
        name,
        phone: null,
        status: "offline",
        source: "jushuitan_purchase_export",
        created_at: now,
        updated_at: now,
      });
      existingAccounts.add(id);
      if (id.startsWith("jst:brand:")) stats.createdBrandAccounts += 1;
    }

    function ensureSupplier(sellerId, sellerName) {
      if (!sellerId) return null;
      const id = `jst:supplier:${sellerId}`;
      if (createdSuppliers.has(id)) return id;
      upsertSupplier.run({
        id,
        company_id: companyId,
        name: sellerName || sellerId,
        contact_name: null,
        phone: null,
        wechat: null,
        address: null,
        categories_json: '["jushuitan_purchase_export"]',
        status: "active",
        created_at: now,
        updated_at: now,
      });
      createdSuppliers.add(id);
      stats.createdSuppliers += 1;
      return id;
    }

    function ensureSku(code, line, accountId) {
      if (existingSkuCodes.has(code)) return;
      const profile = profileByCode.get(code);
      try {
        upsertSku.run({
          id: `jst:skuprofile:${code}`,
          company_id: companyId,
          account_id: accountId,
          internal_sku_code: code,
          product_name: profile?.name || text(line["商品名称"]) || code,
          category: null,
          image_url: text(line["图片"]) || profile?.image || null,
          status: "active",
          created_at: now,
          updated_at: now,
          color_spec: text(line["颜色及规格"]) || profile?.colorSpec || null,
        });
      } catch (error) {
        const accountExists = db.prepare("SELECT COUNT(*) AS count FROM erp_accounts WHERE id = ?").get(accountId)?.count || 0;
        const companyExists = db.prepare("SELECT COUNT(*) AS count FROM erp_companies WHERE id = ?").get(companyId)?.count || 0;
        error.message = `${error.message}; sku=${code}; accountId=${accountId}; accountExists=${accountExists}; companyId=${companyId}; companyExists=${companyExists}`;
        throw error;
      }
      existingSkuCodes.add(code);
      stats.createdSkus += 1;
    }

    function writeOrder(poNo, brand, header, lines, isSplit, allOrderLines = lines) {
      const accountId = brand ? `jst:brand:${brand}` : NONE_ACCOUNT;
      ensureAccount(accountId, brand || "-");
      const supplierId = ensureSupplier(text(header.seller_id), text(header.seller));
      const poId = `jst:po:${poNo}:${brand || "none"}`;
      const totalAmount = isSplit
        ? lines.reduce((sum, line) => sum + (numberValue(line["金额"]) || 0), 0)
        : (lines.length ? (numberValue(lines[0]["总金额"]) || 0) : 0);
      const freightAmount = mapFreightAmount(header, lines, isSplit, allOrderLines);
      const paidAmount = mapPaidAmount(header, lines, isSplit, allOrderLines, totalAmount);

      upsertPurchaseOrder.run({
        id: poId,
        account_id: accountId,
        pr_id: null,
        selected_candidate_id: null,
        supplier_id: supplierId,
        po_no: poNo,
        status: mapStatus(header.status, header.receive_status),
        payment_status: mapPaymentStatus(header),
        paid_at: mapPaidAt(header),
        expected_delivery_date: null,
        actual_delivery_date: null,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        freight_amount: freightAmount ?? 0,
        created_by: null,
        created_at: text(header.po_date) || now,
        updated_at: text(header.modified) || now,
        external_order_id: text(header.outer_po_id_1688) || null,
        external_order_status: text(header.outer_status_1688) || null,
        external_order_payload_json: JSON.stringify(header),
        external_order_synced_at: now,
        external_order_preview_json: "{}",
        external_order_previewed_at: null,
        external_payment_url: null,
        external_payment_url_synced_at: null,
        external_order_detail_json: "{}",
        external_order_detail_synced_at: null,
        external_logistics_json: JSON.stringify({
          logistics_company: text(header.logistics_company),
          l_id: text(header.l_id),
          logistics_status: text(header.logistics_status),
          address: text(header.address),
        }),
        external_logistics_synced_at: now,
        jst_purchaser_name: text(header.purchaser_name) || null,
      });
      stats.importedPurchaseOrders += 1;

      for (const [index, line] of lines.entries()) {
        const code = skuCodeForLine(poNo, line, index);
        ensureSku(code, line, accountId);
        const lineId = `jst:pol:${text(line["明细单号"]) || `${poNo}:${code}`}`;
        upsertLine.run({
          id: lineId,
          account_id: accountId,
          po_id: poId,
          sku_id: `jst:skuprofile:${code}`,
          qty: integerQty(line["数量"]),
          unit_cost: numberValue(line["单价"]) || 0,
          logistics_fee: index === 0 ? (freightAmount || 0) : 0,
          expected_qty: integerQty(line["数量"]),
          received_qty: integerQty(line["已入库数量"]),
          remark: text(line["明细备注"]) || null,
          jst_payload_json: JSON.stringify(line),
        });
        stats.importedLines += 1;
      }
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
      ensureAccount(NONE_ACCOUNT, "-");

      for (const header of headers) {
        const poNo = text(header.po_id);
        if (!poNo) continue;
        const lines = linesByPo.get(poNo) || [];

        if (lines.length === 0) {
          writeOrder(poNo, null, header, [], false, []);
          stats.headerOnlyOrders += 1;
          continue;
        }

        const groups = new Map();
        const sellerName = text(header.seller);
        for (const line of lines) {
          const code = text(line["商品编码"]);
          const itemName = text(line["商品名称"]);
          const profile = profileByCode.get(code);
          const brand = freightStore(itemName, sellerName) || profile?.brand || null;
          if (brand && isJinanBrand(brand)) {
            stats.skippedJinanLines += 1;
            continue;
          }
          const key = brand || "__none__";
          if (!groups.has(key)) groups.set(key, { brand, lines: [] });
          groups.get(key).lines.push(line);
        }

        if (groups.size === 0) {
          stats.skippedJinanOrders += 1;
          continue;
        }
        const isSplit = groups.size > 1;
        if (isSplit) stats.splitChildOrders += groups.size;
        const importedOrderLines = Array.from(groups.values()).flatMap((group) => group.lines);
        for (const group of groups.values()) {
          writeOrder(poNo, group.brand, header, group.lines, isSplit, importedOrderLines);
        }
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
      purchaseOrders: db.prepare("SELECT COUNT(*) AS count FROM erp_purchase_orders WHERE id LIKE 'jst:po:%'").get().count,
      purchaseOrderLines: db.prepare("SELECT COUNT(*) AS count FROM erp_purchase_order_lines WHERE id LIKE 'jst:pol:%'").get().count,
    };

    console.log(JSON.stringify({
      ok: true,
      mode: dryRun ? "DRY" : "WRITE",
      rolledBack,
      sourceDir,
      companyId,
      dbPath: db.__erpDbPath,
      ...stats,
      after,
    }, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
  process.exit(0);
} catch (error) {
  console.error(`FATAL: ${error?.stack || error}`);
  process.exit(1);
}
