const crypto = require("crypto");
const { queryAll, queryOne, execute, withTransaction} = require("../../db/connection.cjs");
const { createId, nowIso } = require("./utils.cjs");

const DEFAULT_COMPANY_ID = "company_default";
const DEFAULT_ACCOUNT_ID = "jst:account:default";
const JUSHUITAN_WAREHOUSE_NAME = "义乌明舵国际贸易有限公司";

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeCompanyId(value) {
  return optionalString(value) || DEFAULT_COMPANY_ID;
}

function hashText(value, length = 14) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex").slice(0, length);
}

function stableId(prefix, value) {
  const text = optionalString(value) || "default";
  const slug = text.
  replace(/https?:\/\//gi, "").
  replace(/[^\w.-]+/g, "_").
  replace(/^_+|_+$/g, "").
  slice(0, 54);
  return `jst:${prefix}:${slug || "x"}:${hashText(text, 10)}`;
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function stringify(value) {
  return JSON.stringify(value ?? {});
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[,￥¥\s]/g, "");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
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
  return optionalString(first(record, keys));
}

function joinAddress(record) {
  const parts = [
  firstText(record, ["state", "province", "receiver_state"]),
  firstText(record, ["city", "receiver_city"]),
  firstText(record, ["district", "area", "receiver_district"]),
  firstText(record, ["street", "address", "receiver_address", "send_address"])].
  filter(Boolean);
  return [...new Set(parts)].join(" ");
}

function isInactive(record) {
  const status = [
  firstText(record, ["status", "statusText", "enabled", "isNotEnabled"]),
  firstText(record, ["status_v"])].
  join(" ");
  if (record?.enabled === false || record?.enabled === 0 || record?.isNotEnabled === true) return true;
  return /停用|禁用|失效|删除|作废|disabled|inactive/i.test(status);
}

function normalizeDate(value) {
  const text = optionalString(value);
  if (!text) return null;
  return text;
}

function sumItems(items, key) {
  if (!Array.isArray(items)) return null;
  let total = 0;
  let used = false;
  for (const item of items) {
    const number = toNumber(item?.[key]);
    if (number !== null) {
      total += number;
      used = true;
    }
  }
  return used ? total : null;
}

function extractOfferId(record) {
  const direct = firstText(record, ["plat_offer_id", "offer_id", "offerId", "external_offer_id"]);
  if (direct) return direct;
  const url = firstText(record, ["url", "platpromotionurl", "cpsUrl", "product_url"]);
  const match = url.match(/(?:offer|detail)[/.](\d+)\.html/i) || url.match(/[?&](?:offerId|offer_id)=(\d+)/i);
  return match?.[1] || "";
}

function sourceBusinessNo(record, sourceKey, externalId) {
  const keysBySource = {
    shops: ["shop_id", "shopId", "shop_name", "shopName", "col_3", "name"],
    warehouses: ["coId2", "co_id", "wms_co_id", "wh_id", "warehouse_id", "partnerName"],
    suppliers: ["supplier_id", "supplierId", "supplier_code", "name"],
    sku: ["sku_id", "skuId", "sku_code", "i_id", "iId"],
    skumap: ["sku_id", "skuId", "sku_code", "i_id", "iId", "plat_offer_id"],
    inventory: ["sku_id", "skuId", "sku_code", "i_id", "iId"],
    purchase: ["po_id", "poId", "po_no", "outer_po_id_1688", "outer_po_id"],
    purchase_in: ["io_id", "ioId", "o_id", "oId"],
    purchase_out: ["io_id", "ioId", "o_id", "oId"],
    orders: ["o_id", "oId", "so_id", "soId"],
    sales_out: ["io_id", "ioId", "o_id", "oId", "so_id", "soId"],
    refunds: ["as_id", "asId", "refund_id", "refundId", "o_id", "oId", "so_id", "soId"],
    logistics: ["l_id", "lId", "logistics_no", "tracking_no", "o_id", "oId", "so_id", "soId"]
  };
  return firstText(record, keysBySource[sourceKey] || []) || externalId;
}

function normalizeBusinessRecord({ companyId, sourceKey, rawRow, raw, now }) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const firstItem = items[0] && typeof items[0] === "object" ? items[0] : {};
  const externalId = optionalString(rawRow.external_id) || hashText(rawRow.raw_json);
  const businessNo = sourceBusinessNo(raw, sourceKey, externalId);
  const qty = toNumber(first(raw, ["qty", "qty_count", "total_qty", "total_r_qty", "unlock_qty", "sale_qty"])) ??
  sumItems(items, "qty");
  const amount = toNumber(first(raw, [
  "amount", "total_amount", "plat_total_amount", "sku_amount", "total_sale_amount",
  "total_sale_base_amount", "cost_price", "free_amount"]
  )) ?? sumItems(items, "amount");
  const skuCode = firstText(raw, ["sku_code", "sku_id", "skuId", "i_id", "iId"]) ||
  firstText(firstItem, ["sku_code", "sku_id", "skuId", "i_id", "iId"]);
  const productName = firstText(raw, ["name", "product_name", "title"]) ||
  firstText(firstItem, ["name", "product_name", "title"]);
  const accountId = firstText(raw, ["shop_id", "shopId"]) ?
  stableId("shop", firstText(raw, ["shop_id", "shopId"])) :
  null;
  const supplierIdValue = firstText(raw, ["supplier_id", "supplierId", "seller_id", "sellerId"]);
  const warehouseIdValue = firstText(raw, ["wh_id", "whId", "wms_co_id", "wmsCoId", "coId2", "co_id"]);

  return {
    id: stableId("biz", `${companyId}:${sourceKey}:${externalId}:header`),
    company_id: companyId,
    source_key: sourceKey,
    record_type: "header",
    external_id: externalId,
    business_no: businessNo,
    business_time: normalizeDate(first(raw, [
    "order_date", "pay_date", "io_date", "po_date", "created", "modified", "date",
    "fetched_at", "__jst_web_collected_at"]
    )),
    status: [
    firstText(raw, ["status", "f_status", "statusText", "outer_status_1688"]),
    firstText(raw, ["receive_status", "delivery_status", "logistics_status"])].
    filter(Boolean).join(" / ") || null,
    related_no: firstText(raw, ["o_id", "oId", "so_id", "soId", "outer_po_id_1688", "outer_po_id", "out_io_id"]) || null,
    party_name: firstText(raw, [
    "seller", "supplier_name", "member_name_1688", "receiver_name", "buyer_name",
    "partnerName", "name", "contacts"]
    ) || null,
    shop_name: firstText(raw, ["shop_name", "shopName", "source_shop_name", "col_3"]) || null,
    account_id: accountId,
    supplier_id: supplierIdValue ? stableId("supplier", supplierIdValue) : null,
    sku_id: skuCode ? stableId("sku", skuCode) : null,
    sku_code: skuCode || null,
    product_name: productName || null,
    qty,
    amount,
    warehouse_id: warehouseIdValue ? stableId("warehouse", warehouseIdValue) : null,
    warehouse_name: firstText(raw, ["warehouse", "wms_co_name", "wh_name", "partnerName", "lwh_name"]) || null,
    logistics_company: firstText(raw, ["logistics_company", "logisticsCompany"]) || null,
    tracking_no: firstText(raw, ["l_id", "lId", "logistics_no", "tracking_no", "express_no"]) || null,
    raw_record_id: rawRow.id,
    raw_json: stringify(raw),
    created_at: now,
    updated_at: now
  };
}

function normalizeBusinessItemRecords({ companyId, sourceKey, rawRow, raw, now }) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (!items.length) return [];
  const parentExternalId = optionalString(rawRow.external_id) || hashText(rawRow.raw_json);
  const parentNo = sourceBusinessNo(raw, sourceKey, parentExternalId);
  return items.map((item, index) => {
    const skuCode = firstText(item, ["sku_code", "sku_id", "skuId", "i_id", "iId"]);
    const productName = firstText(item, ["name", "product_name", "title"]);
    const qty = toNumber(first(item, ["qty", "quantity", "sale_qty"]));
    const itemAmount = toNumber(first(item, ["amount", "total_amount"]));
    const inferredAmount = (qty ?? 0) * (toNumber(first(item, ["price", "unit_price", "sale_price"])) ?? 0);
    const amount = itemAmount ?? (inferredAmount || null);
    const externalId = `${parentExternalId}#item:${index + 1}:${skuCode || hashText(stringify(item), 8)}`;
    return {
      id: stableId("biz", `${companyId}:${sourceKey}_items:${externalId}:line`),
      company_id: companyId,
      source_key: `${sourceKey}_items`,
      record_type: "line",
      external_id: externalId,
      business_no: parentNo,
      business_time: normalizeDate(first(raw, ["order_date", "pay_date", "io_date", "created", "modified"])),
      status: firstText(raw, ["status", "f_status", "outer_status_1688"]) || null,
      related_no: firstText(raw, ["o_id", "oId", "so_id", "soId", "io_id", "ioId"]) || null,
      party_name: firstText(raw, ["receiver_name", "seller", "supplier_name", "buyer_name"]) || null,
      shop_name: firstText(raw, ["shop_name", "shopName", "source_shop_name"]) || null,
      account_id: firstText(raw, ["shop_id", "shopId"]) ? stableId("shop", firstText(raw, ["shop_id", "shopId"])) : null,
      supplier_id: null,
      sku_id: skuCode ? stableId("sku", skuCode) : null,
      sku_code: skuCode || null,
      product_name: productName || null,
      qty,
      amount,
      warehouse_id: null,
      warehouse_name: firstText(raw, ["warehouse", "wms_co_name", "wh_name"]) || null,
      logistics_company: firstText(raw, ["logistics_company", "logisticsCompany"]) || null,
      tracking_no: firstText(raw, ["l_id", "lId", "logistics_no", "tracking_no", "express_no"]) || null,
      raw_record_id: rawRow.id,
      raw_json: stringify({ parentExternalId, itemIndex: index + 1, item, header: {
          o_id: raw.o_id,
          so_id: raw.so_id,
          io_id: raw.io_id,
          po_id: raw.po_id
        } }),
      created_at: now,
      updated_at: now
    };
  });
}

function mapPurchaseStatus(raw) {
  const text = [
  firstText(raw, ["status"]),
  firstText(raw, ["f_status"]),
  firstText(raw, ["status_v"]),
  firstText(raw, ["outer_status_1688"]),
  firstText(raw, ["outer_status"]),
  firstText(raw, ["receive_status"]),
  firstText(raw, ["delivery_status"]),
  firstText(raw, ["logistics_status"])].
  join(" ");
  if (/作废|取消|关闭|cancel/i.test(text)) return "cancelled";
  if (/已入库|全部入库|入库完成|完成/i.test(text)) return "inbounded";
  if (/交易成功|交易完成|success/i.test(text)) return "trade_completed";
  if (/已到货|到货/i.test(text)) return "arrived";
  if (/已发货|待收货|等待买家收货|买家收货|卖家已发货|shipped/i.test(text)) return "shipped";
  if (/供应商|生产|备货/i.test(text)) return "supplier_processing";
  if (/等待卖家发货|待卖家发货/i.test(text)) return "paid";
  if (/等待买家付款|待付款|待支付/i.test(text)) return "approved_to_pay";
  if (/已付款|已支付|待卖家发货|paid|payed/i.test(text)) return "paid";
  if (/待审核|草稿|draft/i.test(text)) return "draft";
  if (/审核|生效|确认/i.test(text)) return "approved_to_pay";
  return "draft";
}

function mapPaymentStatus(raw) {
  const text = [
  firstText(raw, ["outer_status_1688"]),
  firstText(raw, ["outer_status"]),
  firstText(raw, ["payment_status"]),
  firstText(raw, ["status"]),
  firstText(raw, ["plat_pay_date"])].
  join(" ");
  if (/等待买家付款|待付款|待支付|waitbuyerpay/i.test(text)) return "unpaid";
  if (/已付款|已支付|待卖家发货|已发货|已完成|paid|payed|success/i.test(text)) return "paid";
  if (firstText(raw, ["plat_pay_date"])) return "paid";
  return "unpaid";
}

function mapInboundStatus(raw) {
  const text = [
  firstText(raw, ["status"]),
  firstText(raw, ["f_status"]),
  firstText(raw, ["archived"])].
  join(" ");
  if (/取消|作废|cancel/i.test(text)) return "cancelled";
  if (/待入库/i.test(text)) return "jst_pending_inbound";
  if (/已审核|已入库|归档|archived/i.test(text)) return "inbounded_pending_qc";
  if (/已到货|到货/i.test(text)) return "arrived";
  return "pending_arrival";
}

function integerQty(value, fallback = 0) {
  const number = toNumber(value);
  if (number === null) return fallback;
  return Math.max(0, Math.round(number));
}

class JushuitanOperationalBridge {
  constructor({ db }) {
    if (!db) throw new Error("JushuitanOperationalBridge requires db");
    this.db = db;
    this.prepareSqlStrings();
  }

  prepareSqlStrings() {
    this.upsertAccountSql = `
      INSERT INTO erp_accounts (id, company_id, name, phone, status, source, created_at, updated_at)
      VALUES (@id, @company_id, @name, @phone, @status, @source, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        name = excluded.name,
        phone = COALESCE(NULLIF(excluded.phone, ''), erp_accounts.phone),
        status = CASE WHEN erp_accounts.status = 'deleted' THEN erp_accounts.status ELSE excluded.status END,
        source = excluded.source,
        updated_at = excluded.updated_at
    `;
    this.upsertSupplierSql = `
      INSERT INTO erp_suppliers (
        id, company_id, name, contact_name, phone, wechat, address,
        categories_json, status, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @name, @contact_name, @phone, @wechat, @address,
        @categories_json, @status, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        name = excluded.name,
        contact_name = COALESCE(NULLIF(excluded.contact_name, ''), erp_suppliers.contact_name),
        phone = COALESCE(NULLIF(excluded.phone, ''), erp_suppliers.phone),
        wechat = COALESCE(NULLIF(excluded.wechat, ''), erp_suppliers.wechat),
        address = COALESCE(NULLIF(excluded.address, ''), erp_suppliers.address),
        categories_json = excluded.categories_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `;
    this.upsertWarehouseSql = `
      INSERT INTO erp_warehouses (id, company_id, name, code, status, created_at, updated_at)
      VALUES (@id, @company_id, @name, @code, @status, @created_at, @updated_at)
      ON CONFLICT(company_id, code) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `;
    this.upsertSkuSql = `
      INSERT INTO erp_skus (
        id, company_id, account_id, internal_sku_code, temu_sku_id, temu_product_id,
        temu_skc_id, product_name, category, image_url, supplier_id, status,
        created_at, updated_at, color_spec, created_by
      )
      VALUES (
        @id, @company_id, @account_id, @internal_sku_code, @temu_sku_id, @temu_product_id,
        @temu_skc_id, @product_name, @category, @image_url, @supplier_id, @status,
        @created_at, @updated_at, @color_spec, @created_by
      )
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        account_id = COALESCE(excluded.account_id, erp_skus.account_id),
        internal_sku_code = excluded.internal_sku_code,
        product_name = excluded.product_name,
        category = COALESCE(NULLIF(excluded.category, ''), erp_skus.category),
        image_url = COALESCE(NULLIF(excluded.image_url, ''), erp_skus.image_url),
        supplier_id = COALESCE(excluded.supplier_id, erp_skus.supplier_id),
        status = excluded.status,
        color_spec = COALESCE(NULLIF(excluded.color_spec, ''), erp_skus.color_spec),
        updated_at = excluded.updated_at
    `;
    this.upsertSku1688SourceSql = `
      INSERT INTO erp_sku_1688_sources (
        id, account_id, sku_id, external_offer_id, external_sku_id, external_spec_id,
        supplier_name, product_title, product_url, image_url, unit_price, moq,
        lead_days, logistics_fee, status, is_default, is_no_spec, source_payload_json,
        created_by, created_at, updated_at, mapping_group_id, platform_sku_name,
        our_qty, platform_qty, remark
      )
      VALUES (
        @id, @account_id, @sku_id, @external_offer_id, @external_sku_id, @external_spec_id,
        @supplier_name, @product_title, @product_url, @image_url, @unit_price, @moq,
        @lead_days, @logistics_fee, @status, @is_default, @is_no_spec, @source_payload_json,
        @created_by, @created_at, @updated_at, @mapping_group_id, @platform_sku_name,
        @our_qty, @platform_qty, @remark
      )
      ON CONFLICT(account_id, sku_id, external_offer_id, external_sku_id, external_spec_id)
      DO UPDATE SET
        supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), erp_sku_1688_sources.supplier_name),
        product_title = COALESCE(NULLIF(excluded.product_title, ''), erp_sku_1688_sources.product_title),
        product_url = COALESCE(NULLIF(excluded.product_url, ''), erp_sku_1688_sources.product_url),
        image_url = COALESCE(NULLIF(excluded.image_url, ''), erp_sku_1688_sources.image_url),
        unit_price = COALESCE(excluded.unit_price, erp_sku_1688_sources.unit_price),
        moq = COALESCE(excluded.moq, erp_sku_1688_sources.moq),
        status = excluded.status,
        is_no_spec = excluded.is_no_spec,
        source_payload_json = excluded.source_payload_json,
        platform_sku_name = COALESCE(NULLIF(excluded.platform_sku_name, ''), erp_sku_1688_sources.platform_sku_name),
        our_qty = CASE WHEN @ratio_from_jst = 1 THEN excluded.our_qty ELSE erp_sku_1688_sources.our_qty END,
        platform_qty = CASE WHEN @ratio_from_jst = 1 THEN excluded.platform_qty ELSE erp_sku_1688_sources.platform_qty END,
        remark = COALESCE(NULLIF(excluded.remark, ''), erp_sku_1688_sources.remark),
        updated_at = excluded.updated_at
    `;
    this.upsertPurchaseOrderSql = `
      INSERT INTO erp_purchase_orders (
        id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
        status, payment_status, expected_delivery_date, actual_delivery_date,
        total_amount, created_by, created_at, updated_at, external_order_id,
        external_order_status, external_order_payload_json, external_order_synced_at,
        external_order_preview_json, external_order_previewed_at, external_payment_url,
        external_payment_url_synced_at, external_order_detail_json,
        external_order_detail_synced_at, external_logistics_json, external_logistics_synced_at
      )
      VALUES (
        @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
        @status, @payment_status, @expected_delivery_date, @actual_delivery_date,
        @total_amount, @created_by, @created_at, @updated_at, @external_order_id,
        @external_order_status, @external_order_payload_json, @external_order_synced_at,
        @external_order_preview_json, @external_order_previewed_at, @external_payment_url,
        @external_payment_url_synced_at, @external_order_detail_json,
        @external_order_detail_synced_at, @external_logistics_json, @external_logistics_synced_at
      )
      ON CONFLICT(account_id, po_no) DO UPDATE SET
        supplier_id = COALESCE(excluded.supplier_id, erp_purchase_orders.supplier_id),
        status = excluded.status,
        payment_status = excluded.payment_status,
        expected_delivery_date = COALESCE(NULLIF(excluded.expected_delivery_date, ''), erp_purchase_orders.expected_delivery_date),
        actual_delivery_date = COALESCE(NULLIF(excluded.actual_delivery_date, ''), erp_purchase_orders.actual_delivery_date),
        total_amount = excluded.total_amount,
        updated_at = excluded.updated_at,
        external_order_id = COALESCE(NULLIF(excluded.external_order_id, ''), erp_purchase_orders.external_order_id),
        external_order_status = excluded.external_order_status,
        external_order_payload_json = excluded.external_order_payload_json,
        external_order_synced_at = excluded.external_order_synced_at,
        external_order_detail_json = excluded.external_order_detail_json,
        external_order_detail_synced_at = excluded.external_order_detail_synced_at,
        external_logistics_json = excluded.external_logistics_json,
        external_logistics_synced_at = excluded.external_logistics_synced_at
    `;
    this.upsertInboundReceiptSql = `
      INSERT INTO erp_inbound_receipts (
        id, account_id, po_id, receipt_no, status, received_at,
        operator_id, remark, created_at, updated_at
      )
      VALUES (
        @id, @account_id, @po_id, @receipt_no, @status, @received_at,
        @operator_id, @remark, @created_at, @updated_at
      )
      ON CONFLICT(account_id, receipt_no) DO UPDATE SET
        po_id = COALESCE(excluded.po_id, erp_inbound_receipts.po_id),
        status = excluded.status,
        received_at = excluded.received_at,
        remark = excluded.remark,
        updated_at = excluded.updated_at
    `;
    this.upsertInventoryBatchSql = `
      INSERT INTO erp_inventory_batches (
        id, account_id, batch_code, sku_id, po_id, inbound_receipt_id,
        received_qty, available_qty, reserved_qty, blocked_qty, defective_qty,
        rework_qty, unit_landed_cost, qc_status, location_code, received_at,
        created_at, updated_at
      )
      VALUES (
        @id, @account_id, @batch_code, @sku_id, @po_id, @inbound_receipt_id,
        @received_qty, @available_qty, @reserved_qty, @blocked_qty, @defective_qty,
        @rework_qty, @unit_landed_cost, @qc_status, @location_code, @received_at,
        @created_at, @updated_at
      )
      ON CONFLICT(account_id, batch_code) DO UPDATE SET
        sku_id = excluded.sku_id,
        received_qty = excluded.received_qty,
        available_qty = excluded.available_qty,
        reserved_qty = excluded.reserved_qty,
        blocked_qty = excluded.blocked_qty,
        defective_qty = excluded.defective_qty,
        rework_qty = excluded.rework_qty,
        unit_landed_cost = excluded.unit_landed_cost,
        qc_status = excluded.qc_status,
        location_code = COALESCE(NULLIF(excluded.location_code, ''), erp_inventory_batches.location_code),
        received_at = excluded.received_at,
        updated_at = excluded.updated_at
    `;
    this.upsertBusinessRecordSql = `
      INSERT INTO erp_jst_business_records (
        id, company_id, source_key, record_type, external_id, business_no,
        business_time, status, related_no, party_name, shop_name, account_id,
        supplier_id, sku_id, sku_code, product_name, qty, amount, warehouse_id,
        warehouse_name, logistics_company, tracking_no, raw_record_id, raw_json,
        created_at, updated_at
      )
      VALUES (
        @id, @company_id, @source_key, @record_type, @external_id, @business_no,
        @business_time, @status, @related_no, @party_name, @shop_name, @account_id,
        @supplier_id, @sku_id, @sku_code, @product_name, @qty, @amount, @warehouse_id,
        @warehouse_name, @logistics_company, @tracking_no, @raw_record_id, @raw_json,
        @created_at, @updated_at
      )
      ON CONFLICT(company_id, source_key, external_id, record_type) DO UPDATE SET
        business_no = excluded.business_no,
        business_time = excluded.business_time,
        status = excluded.status,
        related_no = excluded.related_no,
        party_name = excluded.party_name,
        shop_name = excluded.shop_name,
        account_id = excluded.account_id,
        supplier_id = excluded.supplier_id,
        sku_id = excluded.sku_id,
        sku_code = excluded.sku_code,
        product_name = excluded.product_name,
        qty = excluded.qty,
        amount = excluded.amount,
        warehouse_id = excluded.warehouse_id,
        warehouse_name = excluded.warehouse_name,
        logistics_company = excluded.logistics_company,
        tracking_no = excluded.tracking_no,
        raw_record_id = excluded.raw_record_id,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `;
  }

  async ensureDefaultAccount(companyId, now) {
    await execute(this.db, this.upsertAccountSql, {
      id: DEFAULT_ACCOUNT_ID,
      company_id: companyId,
      name: "聚水潭",
      phone: null,
      status: "offline",
      source: "jushuitan",
      created_at: now,
      updated_at: now
    });
  }

  async upsertShop(companyId, raw, now) {
    const shopName = firstText(raw, ["shop_name", "shopName", "col_3", "name"]);
    if (!shopName) return false;
    const shopId = firstText(raw, ["shop_id", "shopId", "col_2"]) || shopName;
    const statusText = firstText(raw, ["status", "auth_status", "col_6"]);
    await execute(this.db, this.upsertAccountSql, {
      id: stableId("shop", shopId),
      company_id: companyId,
      name: shopName,
      phone: firstText(raw, ["phone", "mobile"]) || null,
      status: /已授权|online|active/i.test(statusText) ? "online" : "offline",
      source: "jushuitan",
      created_at: now,
      updated_at: now
    });
    return true;
  }

  async upsertBrandAccount(companyId, raw, now) {
    const brandName = firstText(raw, ["brand", "category"]);
    if (!brandName) return null;
    const id = stableId("brand", brandName);
    await execute(this.db, this.upsertAccountSql, {
      id,
      company_id: companyId,
      name: brandName,
      phone: null,
      status: "online",
      source: "jushuitan_brand",
      created_at: now,
      updated_at: now
    });
    return id;
  }

  async resolveSkuAccountId(companyId, raw, now) {
    const brandAccountId = await this.upsertBrandAccount(companyId, raw, now);
    if (brandAccountId) return brandAccountId;
    const shopId = firstText(raw, ["shop_id", "shopId"]);
    if (shopId) return stableId("shop", shopId);
    return DEFAULT_ACCOUNT_ID;
  }

  async upsertSupplier(companyId, raw, now, fallback = {}) {
    const supplierIdValue = firstText(raw, ["supplier_id", "supplierId", "seller_id", "sellerId"]) || fallback.id || "";
    const name = firstText(raw, ["name", "supplier_name", "seller", "member_name_1688", "contacts"]) || fallback.name || "";
    if (!name && !supplierIdValue) return null;
    const id = stableId("supplier", supplierIdValue || name);
    const categories = [
    firstText(raw, ["group", "supplier_group", "sellerGroup"]),
    fallback.category].
    filter(Boolean);
    await execute(this.db, this.upsertSupplierSql, {
      id,
      company_id: companyId,
      name: name || supplierIdValue,
      contact_name: firstText(raw, ["contacts", "contact_name", "person"]) || null,
      phone: firstText(raw, ["phone", "mobile", "receiver_phone"]) || null,
      wechat: firstText(raw, ["wechat", "wangwang"]) || null,
      address: joinAddress(raw) || null,
      categories_json: stringify([...new Set(categories)]),
      status: isInactive(raw) ? "disabled" : "active",
      created_at: now,
      updated_at: now
    });
    return id;
  }

  async upsertWarehouse(companyId, raw, now) {
    const code = firstText(raw, ["coId2", "co_id", "wms_co_id", "wh_id", "warehouse_id", "wmsCoId", "partnerName"]);
    const name = firstText(raw, ["partnerName", "warehouse", "wms_co_name", "wh_name", "lwh_name"]) || code;
    if (!name) return null;
    const id = stableId("warehouse", code || name);
    await execute(this.db, this.upsertWarehouseSql, {
      id,
      company_id: companyId,
      name,
      code: code || id,
      status: isInactive(raw) ? "disabled" : "active",
      created_at: now,
      updated_at: now
    });
    return id;
  }

  async upsertSku(companyId, raw, now) {
    const skuCode = firstText(raw, ["sku_code", "sku_id", "skuId", "i_id", "iId"]);
    const productName = firstText(raw, ["name", "product_name", "title"]);
    // 硬护栏：缺少 sku_code/sku_id/i_id 的 raw 一律拒绝。
    // 历史原因：聚水潭 web sniff 会把字段定义 schema / 菜单项也错打 source_key='inventory'，
    // 这些条目只有 name（"图片"/"商品编码"/"齐点包装制品有限公司" 等字段标签或供应商名）没有 sku_code，
    // 走 stableId fallback "x" 就会灌出 jst:sku:x:<hash> 这种伪 SKU 污染 erp_skus 与 erp_inventory_batches。
    // 合法 SKU 永远来自 jushuitan-sku-profile-import.cjs（id 前缀 jst:skuprofile:），该路径不经过本函数。
    if (!skuCode) return null;
    const supplierId = firstText(raw, ["supplier_id", "supplierId"]) ?
    await this.upsertSupplier(companyId, raw, now) :
    null;
    const id = stableId("sku", skuCode || productName);
    await execute(this.db, this.upsertSkuSql, {
      id,
      company_id: companyId,
      account_id: await this.resolveSkuAccountId(companyId, raw, now),
      internal_sku_code: skuCode || id,
      temu_sku_id: null,
      temu_product_id: null,
      temu_skc_id: null,
      product_name: productName || skuCode || id,
      category: firstText(raw, ["brand", "category"]) || null,
      image_url: firstText(raw, ["pic_big", "pic", "image_url"]) || null,
      supplier_id: supplierId,
      status: isInactive(raw) ? "inactive" : "active",
      created_at: now,
      updated_at: now,
      color_spec: firstText(raw, ["properties_value", "sku_type"]) || null,
      created_by: null
    });
    return id;
  }

  async upsertSku1688Source(companyId, raw, now) {
    const offerId = extractOfferId(raw);
    if (!offerId) return false;
    const skuId = await this.upsertSku(companyId, raw, now);
    if (!skuId) return false;
    const accountId = await this.resolveSkuAccountId(companyId, raw, now);
    // 聚水潭对很多行没有比例字段(base_qty/pack_qty/plat_map_qty 全空)。这些行兜底成 1:1,
    // 但绝不能用兜底值无条件覆盖用户在供应商管理里手改的比例(见下方 DO UPDATE 的 CASE)。
    const jstOurQty = toNumber(first(raw, ["base_qty", "our_qty"]));
    const jstPlatformQty = toNumber(first(raw, ["pack_qty", "plat_map_qty", "platform_qty"]));
    const ratioFromJst = jstOurQty != null || jstPlatformQty != null ? 1 : 0;
    const jstExternalSkuId = firstText(raw, ["plat_sku_id", "external_sku_id"]) || "";
    let jstExternalSpecId = firstText(raw, ["plat_spec_id", "external_spec_id"]) || "";
    // 与手动绑定落库口径(ipc.cjs upsertSku1688SourceRow)一致:spec 与 sku 同值=伪 cargoSkuId,规整为无规格;
    // plat_spec_id 为空(单规格/无 SKU 商品)也按无规格处理。否则下单时 noSpec=false 会对空 spec 抛「缺少 1688 规格」、
    // 或被「specId 与 skuId 同值」护栏拦下。is_no_spec 由 external_spec_id 是否为空反推,与 7229 自洽。
    if (jstExternalSpecId && jstExternalSkuId && jstExternalSpecId === jstExternalSkuId) jstExternalSpecId = "";
    await execute(this.db, this.upsertSku1688SourceSql, {
      id: stableId("sku1688", `${skuId}:${offerId}:${firstText(raw, ["plat_sku_id"])}:${firstText(raw, ["plat_spec_id"])}`),
      account_id: accountId,
      sku_id: skuId,
      external_offer_id: offerId,
      external_sku_id: jstExternalSkuId,
      external_spec_id: jstExternalSpecId,
      supplier_name: firstText(raw, ["supplier_name", "manage_name_1688"]) || null,
      product_title: firstText(raw, ["name", "platform_sku_name"]) || null,
      product_url: firstText(raw, ["url", "platpromotionurl", "cpsUrl"]) || null,
      image_url: firstText(raw, ["pic", "cpsPic"]) || null,
      unit_price: toNumber(first(raw, ["price", "unit_price", "cost_price"])),
      moq: Math.max(1, Math.floor(toNumber(first(raw, ["min_order_qty", "moq"])) || 1)),
      lead_days: null,
      logistics_fee: null,
      status: isInactive(raw) ? "inactive" : "active",
      is_default: /是|true|1/i.test(firstText(raw, ["is_default_supplier", "is_default"])) ? 1 : 0,
      is_no_spec: jstExternalSpecId ? 0 : 1,
      source_payload_json: stringify(raw),
      created_by: null,
      created_at: now,
      updated_at: now,
      mapping_group_id: "",
      platform_sku_name: firstText(raw, ["manage_name_1688", "platform_sku_name"]) || null,
      // 聚水潭 pack_qty 实际全是 null,真实映射比例在 plat_map_qty。聚水潭没给比例时兜底 1:1
      // (仅用于 INSERT 新行);已存在的行靠 ratio_from_jst 在 DO UPDATE 里决定是否覆盖。
      our_qty: jstOurQty != null ? Math.max(1, Math.floor(jstOurQty)) : 1,
      platform_qty: jstPlatformQty != null ? Math.max(1, Math.floor(jstPlatformQty)) : 1,
      ratio_from_jst: ratioFromJst,
      remark: firstText(raw, ["plat_supplier_remark", "pack_qty_remark", "healthCheckResult"]) || null
    });
    return true;
  }

  async upsertPurchaseOrder(companyId, raw, now) {
    const poNo = firstText(raw, ["po_id", "poId", "po_no"]);
    if (!poNo) return false;
    const supplierId = await this.upsertSupplier(companyId, raw, now, {
      id: firstText(raw, ["seller_id", "sellerId"]),
      name: firstText(raw, ["seller", "supplier_name", "member_name_1688"]),
      category: "jushuitan_purchase"
    });
    const externalOrderId = firstText(raw, ["outer_po_id_1688", "outer_po_id"]);
    await execute(this.db, this.upsertPurchaseOrderSql, {
      id: stableId("po", poNo),
      account_id: DEFAULT_ACCOUNT_ID,
      pr_id: null,
      selected_candidate_id: null,
      supplier_id: supplierId,
      po_no: poNo,
      status: mapPurchaseStatus(raw),
      payment_status: mapPaymentStatus(raw),
      expected_delivery_date: normalizeDate(first(raw, ["plan_arrive_date", "delivery_date"])),
      actual_delivery_date: normalizeDate(first(raw, ["finish_time"])),
      total_amount: toNumber(first(raw, ["plat_total_amount", "sku_amount", "total_amount", "currency_amounts"])) || 0,
      created_by: null,
      created_at: normalizeDate(first(raw, ["po_date", "created"])) || now,
      updated_at: normalizeDate(first(raw, ["modified", "po_date", "created"])) || now,
      external_order_id: externalOrderId || poNo,
      external_order_status: firstText(raw, ["outer_status_1688", "outer_status", "status"]) || null,
      external_order_payload_json: stringify(raw),
      external_order_synced_at: now,
      external_order_preview_json: stringify({
        source: "jushuitan",
        seller: firstText(raw, ["seller", "member_name_1688"]),
        qty: toNumber(first(raw, ["qty_count"])),
        labels: firstText(raw, ["labels"])
      }),
      external_order_previewed_at: now,
      external_payment_url: null,
      external_payment_url_synced_at: null,
      external_order_detail_json: stringify(raw),
      external_order_detail_synced_at: now,
      external_logistics_json: stringify({
        l_id: firstText(raw, ["l_id", "lId"]),
        logistics_company: firstText(raw, ["logistics_company"]),
        logistics_status: firstText(raw, ["logistics_status"]),
        address: firstText(raw, ["address", "send_address"])
      }),
      external_logistics_synced_at: now
    });
    return true;
  }

  async getPurchaseOrderIdByNo(poNo) {
    const text = optionalString(poNo);
    if (!text) return null;
    const id = stableId("po", text);
    return (await queryOne(this.db, "SELECT id FROM erp_purchase_orders WHERE id = ?", [id]))?.id || null;
  }

  async upsertInboundReceipt(companyId, raw, now) {
    const receiptNo = firstText(raw, ["io_id", "ioId"]);
    if (!receiptNo) return false;
    const poNo = firstText(raw, ["o_id", "oId", "po_id", "poId"]);
    const totalQty = toNumber(first(raw, ["total_qty", "total_r_qty"]));
    const totalAmount = toNumber(first(raw, ["total_amount"]));
    await execute(this.db, this.upsertInboundReceiptSql, {
      id: stableId("inbound", receiptNo),
      account_id: DEFAULT_ACCOUNT_ID,
      po_id: await this.getPurchaseOrderIdByNo(poNo),
      receipt_no: receiptNo,
      status: mapInboundStatus(raw),
      received_at: normalizeDate(first(raw, ["io_date", "入库日期"])),
      operator_id: null,
      remark: stringify({
        source: "jushuitan",
        poNo,
        sourceStatus: firstText(raw, ["status"]),
        sourceFinancialStatus: firstText(raw, ["f_status"]),
        sourceRemark: firstText(raw, ["remark"]),
        sourceLabels: firstText(raw, ["labels"]),
        purchaser: firstText(raw, ["purchaser_name", "creator_name"]),
        warehouse: JUSHUITAN_WAREHOUSE_NAME,
        sourceWarehouse: firstText(raw, ["warehouse", "wms_co_name"]),
        sourceInboundAt: normalizeDate(first(raw, ["io_date", "入库日期"])) || null,
        totalQty,
        sourceTotalQty: totalQty,
        totalAmount,
        logisticsCompany: firstText(raw, ["logistics_company"]),
        trackingNo: firstText(raw, ["l_id", "lId"])
      }),
      created_at: normalizeDate(first(raw, ["created", "io_date"])) || now,
      updated_at: normalizeDate(first(raw, ["modified", "archived", "io_date"])) || now
    });
    return true;
  }

  async upsertInventoryBatch(companyId, raw, now) {
    // 硬护栏：跟 upsertSku 同源 —— inventory 源里的字段定义 schema / 菜单条目 没有 sku_code 也没有 qty，
    // 不是真库存数据，直接放行。
    const skuCode = firstText(raw, ["sku_code", "sku_id", "skuId", "i_id", "iId"]);
    if (!skuCode) return false;
    const skuId = await this.upsertSku(companyId, raw, now);
    if (!skuId) return false;
    const warehouseCode = firstText(raw, ["wh_id", "warehouse_id", "wms_co_id", "warehouse", "bin"]) || "default";
    const rawTotalQty = first(raw, ["qty", "stock_qty", "actual_qty", "unlock_qty"]);
    const rawLockedQty = first(raw, ["lock_qty", "locked_qty"]);
    const rawAvailableQty = first(raw, ["unlock_qty", "available_qty"]);
    if (rawTotalQty === "" && rawLockedQty === "" && rawAvailableQty === "") return false;
    const totalQty = integerQty(rawTotalQty);
    const lockedQty = integerQty(rawLockedQty);
    const availableQty = integerQty(rawAvailableQty, Math.max(0, totalQty - lockedQty));
    const batchCode = `JST-STOCK-${String(warehouseCode).slice(0, 36)}-${String(skuCode).slice(0, 48)}`;
    await execute(this.db, this.upsertInventoryBatchSql, {
      id: stableId("batch", batchCode),
      account_id: DEFAULT_ACCOUNT_ID,
      batch_code: batchCode,
      sku_id: skuId,
      po_id: null,
      inbound_receipt_id: null,
      received_qty: Math.max(totalQty, availableQty + lockedQty),
      available_qty: availableQty,
      reserved_qty: lockedQty,
      blocked_qty: 0,
      defective_qty: 0,
      rework_qty: 0,
      unit_landed_cost: toNumber(first(raw, ["cost_price", "unit_cost"])) || 0,
      qc_status: "passed",
      location_code: firstText(raw, ["bin", "warehouse", "wms_co_name"]) || null,
      received_at: normalizeDate(first(raw, ["modified", "created", "__jst_web_collected_at"])) || now,
      created_at: now,
      updated_at: now
    });
    return true;
  }

  async upsertBusinessRecords(companyId, sourceKey, rawRow, raw, now) {
    const header = normalizeBusinessRecord({ companyId, sourceKey, rawRow, raw, now });
    await execute(this.db, this.upsertBusinessRecordSql, header);
    let count = 1;
    for (const line of normalizeBusinessItemRecords({ companyId, sourceKey, rawRow, raw, now })) {
      await execute(this.db, this.upsertBusinessRecordSql, line);
      count += 1;
    }
    return count;
  }

  async sync(payload = {}, actor = {}) {
    const companyId = normalizeCompanyId(payload.companyId || payload.company_id || actor.companyId || actor.company_id);
    const sourceKeys = Array.isArray(payload.sourceKeys || payload.source_keys) ?
    (payload.sourceKeys || payload.source_keys).map(optionalString).filter(Boolean) :
    [];
    for (const sourceKey of sourceKeys) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(sourceKey)) throw new Error(`Unsafe Jushuitan sourceKey: ${sourceKey}`);
    }

    const now = nowIso();
    const runId = createId("jst_bridge_run");
    const stats = {
      runId,
      companyId,
      sourceKeys,
      rawCount: 0,
      businessCount: 0,
      accountCount: 0,
      supplierCount: 0,
      skuCount: 0,
      warehouseCount: 0,
      skuSourceCount: 0,
      purchaseOrderCount: 0,
      inboundReceiptCount: 0,
      inventoryBatchCount: 0,
      bySource: {},
      startedAt: now,
      finishedAt: null
    };

    const where = ["company_id = @company_id"];
    const bind = { company_id: companyId };
    if (sourceKeys.length) {
      const placeholders = sourceKeys.map((_, index) => `@source_${index}`);
      where.push(`source_key IN (${placeholders.join(", ")})`);
      sourceKeys.forEach((key, index) => {
        bind[`source_${index}`] = key;
      });
    }
    const rawRows = await queryAll(this.db, `
      SELECT * FROM erp_jst_raw_records
      WHERE ${where.join(" AND ")}
      ORDER BY source_key, updated_at
    `, [bind]);






































































    try {await withTransaction(this.db, async (txDb) => {await execute(txDb, `
        INSERT INTO erp_jst_business_sync_runs (
          id, company_id, source_keys_json, raw_count, business_count,
          account_count, supplier_count, sku_count, warehouse_count,
          sku_source_count, purchase_order_count, status, error, started_at, finished_at
        )
        VALUES (
          @id, @company_id, @source_keys_json, 0, 0,
          0, 0, 0, 0, 0, 0, 'running', NULL, @started_at, NULL
        )
      `, { id: runId, company_id: companyId, source_keys_json: stringify(sourceKeys), started_at: now });await this.ensureDefaultAccount(companyId, now);stats.accountCount += 1;for (const rawRow of rawRows) {const raw = parseJsonObject(rawRow.raw_json, null);if (!raw) continue;const sourceKey = rawRow.source_key;stats.rawCount += 1;stats.bySource[sourceKey] = (stats.bySource[sourceKey] || 0) + 1;if (sourceKey === "shops" && await this.upsertShop(companyId, raw, now)) stats.accountCount += 1;if (sourceKey === "suppliers" && await this.upsertSupplier(companyId, raw, now)) stats.supplierCount += 1;if (sourceKey === "warehouses" && await this.upsertWarehouse(companyId, raw, now)) stats.warehouseCount += 1;if ((sourceKey === "sku" || sourceKey === "inventory" || sourceKey === "skumap") && await this.upsertSku(companyId, raw, now)) stats.skuCount += 1;if (sourceKey === "skumap" && await this.upsertSku1688Source(companyId, raw, now)) stats.skuSourceCount += 1;if (sourceKey === "purchase" && await this.upsertPurchaseOrder(companyId, raw, now)) stats.purchaseOrderCount += 1;if (sourceKey === "purchase_in" && await this.upsertInboundReceipt(companyId, raw, now)) stats.inboundReceiptCount += 1;if (sourceKey === "inventory" && await this.upsertInventoryBatch(companyId, raw, now)) stats.inventoryBatchCount += 1;stats.businessCount += await this.upsertBusinessRecords(companyId, sourceKey, rawRow, raw, now);}stats.finishedAt = nowIso();await execute(txDb, `
        UPDATE erp_jst_business_sync_runs
        SET raw_count = @raw_count,
            business_count = @business_count,
            account_count = @account_count,
            supplier_count = @supplier_count,
            sku_count = @sku_count,
            warehouse_count = @warehouse_count,
            sku_source_count = @sku_source_count,
            purchase_order_count = @purchase_order_count,
            status = 'success',
            error = NULL,
            finished_at = @finished_at
        WHERE id = @id
      `, { id: runId, raw_count: stats.rawCount, business_count: stats.businessCount, account_count: stats.accountCount, supplier_count: stats.supplierCount, sku_count: stats.skuCount, warehouse_count: stats.warehouseCount, sku_source_count: stats.skuSourceCount, purchase_order_count: stats.purchaseOrderCount, finished_at: stats.finishedAt });});return stats;} catch (error) {const message = error?.message || String(error);try {await execute(this.db, `
          UPDATE erp_jst_business_sync_runs
          SET status = 'failed', error = @error, finished_at = @finished_at
          WHERE id = @id
        `, { id: runId, error: message, finished_at: nowIso() });} catch {}throw error;}}}module.exports = { JushuitanOperationalBridge, DEFAULT_ACCOUNT_ID };