const crypto = require("crypto");
const { queryAll, queryOne, execute, withTransaction} = require("../../db/connection.cjs");
const path = require("path");
const XLSX = require("xlsx");
const { JushuitanClient, DEFAULT_LEGACY_BASE_URL, DEFAULT_SANDBOX_BASE_URL } = require("../jushuitanClient.cjs");
const { DEFAULT_JST_URL, JushuitanWebCollector } = require("../jushuitanWebCollector.cjs");
const { JushuitanOperationalBridge } = require("./jushuitanOperationalBridge.cjs");
const { createId, nowIso } = require("./utils.cjs");

const DEFAULT_COMPANY_ID = "company_default";
const MAX_EXTENSION_RECORDS_PER_EVENT = 2500;

const SOURCE_CATALOG = Object.freeze([
{ key: "shops", method: "shops.query", label: "店铺", category: "基础", syncMode: "static", pageSize: 100 },
{ key: "warehouses", method: "wms.partner.query", label: "仓库/分仓", category: "基础", syncMode: "static", pageSize: 100 },
{ key: "logistics_companies", method: "logisticscompany.query", label: "物流公司", category: "基础", syncMode: "static", pageSize: 100 },
{ key: "suppliers", method: "supplier.query", label: "供应商", category: "基础", syncMode: "paged", pageSize: 100 },
{ key: "buyers", method: "buyer.query", label: "买家", category: "基础", syncMode: "paged", pageSize: 100 },
{ key: "sku", method: "sku.query", label: "普通商品 SKU", category: "商品", syncMode: "paged", pageSize: 100 },
{ key: "sku_source", method: "sku.source.query", label: "商品源数据", category: "商品", syncMode: "paged", pageSize: 100 },
{ key: "skumap", method: "skumap.query", label: "店铺商品映射", category: "商品", syncMode: "paged", pageSize: 100 },
{ key: "combine_sku", method: "combine.sku.query", label: "组合商品", category: "商品", syncMode: "paged", pageSize: 100 },
{ key: "inventory", method: "inventory.query", label: "库存", category: "库存", syncMode: "paged", pageSize: 100 },
{ key: "inventory_count", method: "inventory.count.query", label: "盘点单", category: "库存", syncMode: "range", pageSize: 100 },
{ key: "allocate", method: "allocate.query", label: "调拨单", category: "库存", syncMode: "range", pageSize: 100 },
{ key: "other_inout", method: "other.inout.query", label: "其它出入库", category: "库存", syncMode: "range", pageSize: 100 },
{ key: "orders", method: "orders.query", label: "订单", category: "订单", syncMode: "range", pageSize: 100 },
{ key: "orders_source", method: "orders.source.query", label: "订单源数据", category: "订单", syncMode: "range", pageSize: 100 },
{ key: "logistics", method: "logistic.query", label: "发货信息", category: "订单", syncMode: "range", pageSize: 100 },
{ key: "order_actions", method: "order.action.query", label: "订单操作日志", category: "订单", syncMode: "range", pageSize: 100 },
{ key: "sales_out", method: "orders.out.query", label: "销售出库单", category: "出库", syncMode: "range", pageSize: 100 },
{ key: "sales_out_skusn", method: "orders.out.skusn.query", label: "出库唯一码", category: "出库", syncMode: "range", pageSize: 100 },
{ key: "refunds", method: "refund.query", label: "售后退款", category: "售后", syncMode: "range", pageSize: 100 },
{ key: "aftersale_received", method: "aftersale.received.query", label: "售后实收", category: "售后", syncMode: "range", pageSize: 100 },
{ key: "purchase", method: "purchase.query", label: "采购单", category: "采购", syncMode: "range", pageSize: 100 },
{ key: "purchase_in", method: "purchasein.query", label: "采购入库", category: "采购", syncMode: "range", pageSize: 100 },
{ key: "purchase_out", method: "purchaseout.query", label: "采购退货", category: "采购", syncMode: "range", pageSize: 100 },
{ key: "worklog", method: "worklog.query", label: "手持操作日志", category: "作业", syncMode: "range", pageSize: 100 },
{ key: "shop_auth_tokens", method: "shop.auth.token.query", label: "店铺授权", category: "基础", syncMode: "paged", pageSize: 100 },
{ key: "api_bill", method: "api.bill", label: "API 账单", category: "系统", syncMode: "range", pageSize: 100 },
{ key: "web_collect", method: "web.page.collect", label: "网页采集", category: "网页", syncMode: "static", pageSize: 500 }]
);

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeCompanyId(value, actor = {}) {
  return optionalString(value || actor.companyId || actor.company_id) || DEFAULT_COMPANY_ID;
}

function toCamelKey(key) {
  // 含数字段（如 default_1688_purchase_account_id / alibaba_1688_address_id）也要并入前一段，
  // 否则会产生 default_1688PurchaseAccountId 这种半生不熟的字段名，前端读不到。
  return String(key).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function toCamelRow(row) {
  if (!row || typeof row !== "object") return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamelKey(key), value]));
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashRecord(record) {
  return crypto.createHash("sha256").update(stableStringify(record), "utf8").digest("hex");
}

function maskSecret(value) {
  const text = optionalString(value);
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function normalizeEnvironment(value) {
  return value === "sandbox" ? "sandbox" : "production";
}

function normalizeStatus(value) {
  return value === "disabled" ? "disabled" : "active";
}

function normalizeSyncMode(value) {
  if (value === "static" || value === "range") return value;
  return "paged";
}

function sourceCatalogByKey() {
  return new Map(SOURCE_CATALOG.map((source) => [source.key, source]));
}

const SOURCE_CLASSIFIERS = Object.freeze([
{ key: "purchase_in", score: 120, terms: ["采购入库", "进仓", "入库单号", "采购进仓"] },
{ key: "purchase_out", score: 120, terms: ["采购退货", "退货出库", "采购退"] },
{ key: "purchase", score: 110, terms: ["采购单", "采购单号", "采购员", "采购数量"] },
{ key: "sales_out", score: 110, terms: ["销售出库", "出库单", "出库单号", "发货仓"] },
{ key: "refunds", score: 105, terms: ["售后", "退款", "退货退款", "售后单号", "退款单号"] },
{ key: "orders", score: 100, terms: ["订单", "线上订单", "内部订单号", "订单号", "收件人", "买家"] },
{ key: "inventory", score: 95, terms: ["库存", "可用库存", "锁定库存", "实际库存", "仓库库存", "库存数"] },
{ key: "skumap", score: 90, terms: ["店铺商品", "店铺sku", "店铺SKU", "店铺商品编码", "线上商品"] },
{ key: "sku", score: 85, terms: ["普通商品", "商品资料", "商品编码", "sku", "SKU", "款式编码", "商品名称"] },
{ key: "suppliers", score: 80, terms: ["供应商", "供应商编号", "供应商名称", "联系人"] },
{ key: "shops", score: 75, terms: ["店铺", "店铺编号", "店铺名称", "shop"] },
{ key: "warehouses", score: 75, terms: ["仓库", "分仓", "仓库编号", "仓库名称"] },
{ key: "logistics_companies", score: 70, terms: ["物流公司", "快递公司", "快递编码"] },
{ key: "buyers", score: 65, terms: ["买家", "客户", "客户编号", "买家账号"] },
{ key: "allocate", score: 65, terms: ["调拨", "调拨单"] },
{ key: "other_inout", score: 60, terms: ["其它出入库", "其他出入库", "其它入库", "其它出库"] },
{ key: "worklog", score: 55, terms: ["手持", "操作日志", "作业日志"] },
{ key: "api_bill", score: 50, terms: ["接口账单", "API账单", "调用次数"] }]
);

function normalizeHeaderText(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

function inferSourceKey({ filePath, sheetName, headers }) {
  const haystack = [
  path.basename(String(filePath || "")),
  sheetName,
  ...(headers || [])].
  map(normalizeHeaderText).join("|");
  let best = { key: "unknown", score: 0 };
  for (const classifier of SOURCE_CLASSIFIERS) {
    let score = 0;
    for (const term of classifier.terms) {
      if (haystack.includes(normalizeHeaderText(term))) score += classifier.score;
    }
    if (score > best.score) best = { key: classifier.key, score };
  }
  return best.key;
}

function sanitizeSheetRow(row = {}) {
  const next = {};
  for (const [key, value] of Object.entries(row || {})) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey || /^__EMPTY/i.test(cleanKey)) continue;
    const cleanValue = typeof value === "string" ? value.trim() : value;
    next[cleanKey] = cleanValue;
  }
  return next;
}

function isBlankRow(row = {}) {
  return Object.values(row || {}).every((value) => String(value ?? "").trim() === "");
}

function sourceToRow(source, companyId) {
  const now = nowIso();
  return {
    id: createId("jst_source"),
    company_id: companyId,
    source_key: source.key,
    method: source.method,
    label: source.label,
    category: source.category,
    enabled: 1,
    sync_mode: source.syncMode,
    page_size: source.pageSize,
    default_params_json: JSON.stringify(source.defaultParams || {}),
    cursor_field: source.cursorField || null,
    cursor_value: null,
    last_synced_at: null,
    last_success_at: null,
    last_error: null,
    total_synced: 0,
    created_at: now,
    updated_at: now
  };
}

function toSource(row) {
  const source = toCamelRow(row);
  source.enabled = Boolean(row.enabled);
  source.defaultParams = parseJsonObject(row.default_params_json, {});
  delete source.defaultParamsJson;
  return source;
}

function toAuthStatus(row) {
  if (!row) {
    return {
      configured: false,
      authorized: false,
      authMode: "legacy",
      environment: "production",
      baseUrl: DEFAULT_LEGACY_BASE_URL
    };
  }
  return {
    id: row.id,
    companyId: row.company_id,
    label: row.label,
    configured: Boolean(row.partner_id && row.partner_key && row.token),
    authorized: Boolean(row.token),
    authMode: row.auth_mode || "legacy",
    environment: row.environment || "production",
    baseUrl: row.base_url || DEFAULT_LEGACY_BASE_URL,
    partnerId: maskSecret(row.partner_id),
    tokenPreview: maskSecret(row.token),
    status: row.status,
    lastTestAt: row.last_test_at,
    lastTokenRefreshAt: row.last_token_refresh_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
}

function findFirstArray(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return [];

  const preferredKeys = [
  "data", "datas", "items", "rows", "list", "lists", "orders", "skus", "sku_list",
  "shops", "suppliers", "inventorys", "inventory", "purchases", "logs", "refunds"];

  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
    const nested = findFirstArray(value[key], depth + 1);
    if (nested.length) return nested;
  }
  for (const key of Object.keys(value)) {
    const nested = findFirstArray(value[key], depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function extractRecords(payload) {
  const records = findFirstArray(payload).filter((item) => item && typeof item === "object");
  if (records.length) return records;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const keys = Object.keys(payload).filter((key) => !["issuccess", "success", "code", "msg", "message"].includes(key));
    if (keys.length > 0) return [payload];
  }
  return [];
}

function collectExtensionJsonRecords(value, out, pathParts = [], depth = 0) {
  if (out.length >= MAX_EXTENSION_RECORDS_PER_EVENT || depth > 9 || value == null) return;
  if (Array.isArray(value)) {
    const objectItems = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objectItems.length > 0) {
      objectItems.slice(0, MAX_EXTENSION_RECORDS_PER_EVENT - out.length).forEach((item, index) => {
        out.push({
          ...item,
          __jst_web_kind: "extension_json",
          __jst_web_json_path: pathParts.join(".") || "$",
          __jst_web_json_index: index + 1
        });
      });
      return;
    }
    value.forEach((item, index) => collectExtensionJsonRecords(item, out, [...pathParts, String(index)], depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectExtensionJsonRecords(child, out, [...pathParts, key], depth + 1);
      if (out.length >= MAX_EXTENSION_RECORDS_PER_EVENT) return;
    }
  }
}

function parseExtensionBody(item = {}) {
  if (item.body && typeof item.body === "object") return item.body;
  const text = optionalString(item.bodyText || item.body_text || item.responseText || item.response_text);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isJushuitanCaptureItem(item = {}) {
  const haystack = [
  item.url,
  item.page,
  item.tab_url,
  item.site].
  map((value) => String(value || "").toLowerCase()).join(" ");
  return /erp321\.com|jushuitan\.com|scm121\.com|jushuitan|jst/.test(haystack);
}

function inferExtensionSourceKey(item = {}, firstRecord = null) {
  const recordKeys = firstRecord && typeof firstRecord === "object" ?
  Object.keys(firstRecord).slice(0, 120).join(" ") :
  "";
  const jsonPath = optionalString(firstRecord?.__jst_web_json_path);
  const haystack = [
  item.url,
  item.page,
  item.tab_url,
  item.__jst_web_response_url,
  jsonPath,
  recordKeys].
  map((value) => String(value || "").toLowerCase()).join(" ");

  const rules = [
  ["purchase_in", [/purchasein|purchase_in|purchase-in|inbound|io_id|ioid|purchase.*in/]],
  ["purchase_out", [/purchaseout|purchase_out|purchase-out|purchase.*out/]],
  ["purchase", [/purchasemode|purchase|po_id|poid|po_no|pono/]],
  ["sales_out", [/saleout|sales_out|orders\.out|delivery|sendgoods/]],
  ["refunds", [/aftersale|refund|refunds|return/]],
  ["orders", [/order\/order|orderflow|orders\.query|orders_source|so_id|soid/]],
  ["logistics", [/shipping|logistic|logistics|express|l_id|lid/]],
  ["skumap", [/itemmap|skumap|sku.*map|plat_sku|platform_sku|shop_sku/]],
  ["inventory", [/stockinventory|inventory|stock|warehouse.*stock|unlock_qty|lock_qty/]],
  ["sku", [/goodsinventory|sku\.query|goods|sku_id|skuid|i_id|iid/]],
  ["suppliers", [/supplier|seller_id|sellerid|supplier_id|supplierid/]],
  ["warehouses", [/partner|warehouse|wms|co_id|coid|wh_id|whid/]],
  ["shops", [/web-shop|\/shop|shop_id|shopid|shop_name|shopname/]]];

  for (const [sourceKey, matchers] of rules) {
    if (matchers.some((matcher) => matcher.test(haystack))) return sourceKey;
  }
  return "web_collect";
}

function readDeepValue(record, keys) {
  for (const key of keys) {
    if (record && Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function readNonEmptyValue(record, keys) {
  const value = readDeepValue(record, keys);
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function inferCompositeExternalId(record, sourceKey) {
  const skuKeys = ["商品编码", "SKU", "sku", "款式编码", "店铺商品编码", "sku_id", "skuId", "i_id", "iId", "shop_sku_id", "shopSkuId"];
  const warehouseKeys = ["仓库编号", "仓库名称", "wms_co_id", "co_id", "warehouse_id", "wmsCoId"];
  const sourceComposite = {
    inventory: [warehouseKeys, skuKeys],
    inventory_count: [warehouseKeys, skuKeys],
    orders: [["订单号", "内部订单号", "线上订单号", "o_id", "oId", "so_id", "soId"], skuKeys],
    orders_source: [["订单号", "内部订单号", "线上订单号", "o_id", "oId", "so_id", "soId"], skuKeys],
    sales_out: [["出库单号", "io_id", "ioId", "订单号", "o_id", "oId"], skuKeys],
    sales_out_skusn: [["出库单号", "io_id", "ioId"], ["序列号", "sn", "sku_sn", "skuSn", ...skuKeys]],
    refunds: [["售后单号", "退款单号", "as_id", "asId", "refund_id", "refundId"], skuKeys],
    aftersale_received: [["售后单号", "退款单号", "as_id", "asId", "refund_id", "refundId"], skuKeys],
    purchase: [["采购单号", "po_id", "poId", "po_no", "poNo"], skuKeys],
    purchase_in: [["采购入库单号", "入库单号", "io_id", "ioId"], ["采购单号", "po_id", "poId", "po_no", "poNo"], skuKeys],
    purchase_out: [["采购退货单号", "出库单号", "io_id", "ioId"], ["采购单号", "po_id", "poId", "po_no", "poNo"], skuKeys],
    allocate: [["调拨单号", "io_id", "ioId", "allocate_id", "allocateId"], skuKeys],
    other_inout: [["出入库单号", "入库单号", "出库单号", "io_id", "ioId"], skuKeys]
  };
  const groups = sourceComposite[sourceKey] || [];
  if (groups.length < 2) return "";

  const parts = groups.map((keys) => readNonEmptyValue(record, keys)).filter(Boolean);
  if (parts.length >= 2) return parts.join("::");
  return "";
}

function inferExternalId(record, sourceKey) {
  const compositeId = inferCompositeExternalId(record, sourceKey);
  if (compositeId) return compositeId;

  const sourceSpecific = {
    shops: ["店铺编号", "店铺名称", "shop_id", "shopId", "shop_name", "shopName"],
    warehouses: ["仓库编号", "仓库名称", "wms_co_id", "co_id", "warehouse_id", "wmsCoId"],
    logistics_companies: ["物流公司编号", "物流公司名称", "快递公司编号", "快递公司名称", "lc_id", "l_id", "logistics_company_id", "name"],
    suppliers: ["供应商编号", "供应商名称", "supplier_id", "supplierId", "name"],
    buyers: ["客户编号", "买家账号", "buyer_id", "buyerId", "shop_buyer_id", "name"],
    sku: ["商品编码", "SKU", "sku", "款式编码", "商品名称", "sku_id", "skuId", "i_id", "iId"],
    sku_source: ["商品编码", "SKU", "sku", "款式编码", "商品名称", "sku_id", "skuId", "i_id", "iId"],
    skumap: ["店铺商品编码", "商品编码", "SKU", "sku", "shop_sku_id", "shopSkuId", "sku_id", "skuId"],
    combine_sku: ["商品编码", "组合商品编码", "SKU", "sku", "sku_id", "skuId", "i_id", "iId"],
    inventory: ["仓库编号", "商品编码", "SKU", "sku", "sku_id", "skuId", "shop_sku_id", "shopSkuId"],
    inventory_count: ["盘点单号", "仓库编号", "商品编码", "SKU", "sku"],
    orders: ["订单号", "内部订单号", "线上订单号", "o_id", "oId", "so_id", "soId"],
    orders_source: ["订单号", "内部订单号", "线上订单号", "o_id", "oId", "so_id", "soId"],
    logistics: ["物流单号", "快递单号", "订单号", "l_id", "lId", "o_id", "oId", "so_id", "soId"],
    order_actions: ["日志编号", "操作编号", "订单号", "id", "log_id", "logId", "o_id", "oId"],
    sales_out: ["出库单号", "订单号", "io_id", "ioId", "o_id", "oId"],
    sales_out_skusn: ["序列号", "出库单号", "sn", "sku_sn", "skuSn", "io_id", "ioId"],
    refunds: ["售后单号", "退款单号", "as_id", "asId", "refund_id", "refundId"],
    aftersale_received: ["售后单号", "退款单号", "as_id", "asId", "refund_id", "refundId"],
    purchase: ["采购单号", "po_id", "poId", "po_no", "poNo"],
    purchase_in: ["采购入库单号", "入库单号", "io_id", "ioId", "采购单号", "po_id", "poId"],
    purchase_out: ["采购退货单号", "出库单号", "io_id", "ioId", "采购单号", "po_id", "poId"],
    allocate: ["调拨单号", "io_id", "ioId", "allocate_id", "allocateId"],
    other_inout: ["出入库单号", "入库单号", "出库单号", "io_id", "ioId"],
    worklog: ["id", "log_id", "logId"],
    shop_auth_tokens: ["shop_id", "shopId"],
    api_bill: ["id", "bill_id", "billId", "date"]
  };
  const keys = [
  ...(sourceSpecific[sourceKey] || []),
  "店铺编号", "店铺名称", "仓库编号", "仓库名称", "供应商编号", "供应商名称",
  "商品编码", "SKU", "sku", "款式编码", "商品名称", "店铺商品编码",
  "订单号", "内部订单号", "线上订单号", "出库单号", "售后单号", "退款单号",
  "采购单号", "采购入库单号", "采购退货单号", "入库单号", "调拨单号",
  "物流单号", "快递单号", "客户编号", "买家账号",
  "id", "guid", "code", "no", "number", "ts", "modified", "updated", "created"];

  const value = readDeepValue(record, keys);
  if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  return hashRecord(record);
}

function inferCursorValue(record) {
  const value = readDeepValue(record, [
  "修改时间", "更新时间", "最后修改时间", "创建时间", "下单时间", "付款时间",
  "入库时间", "出库时间", "发货时间", "日期",
  "modified", "modified_at", "modifiedAt", "updated", "updated_at", "updatedAt",
  "ts", "date", "created", "created_at", "createdAt"]
  );
  return optionalString(value);
}

function mergeRecordsByExternalId(records, sourceKey) {
  const merged = new Map();
  for (const record of records || []) {
    const externalId = inferExternalId(record, sourceKey);
    const current = merged.get(externalId);
    if (!current) {
      merged.set(externalId, {
        ...record,
        __jst_web_merged_count: 1,
        __jst_web_merged_methods: [record.__jst_web_legacy_method || record.__jst_web_json_path || record.__jst_web_kind].filter(Boolean)
      });
      continue;
    }

    const next = { ...current };
    for (const [key, value] of Object.entries(record)) {
      if (key === "__jst_web_record_index") continue;
      if (key === "__jst_web_merged_methods" || key === "__jst_web_merged_count") continue;
      const incoming = optionalString(value);
      const existing = optionalString(next[key]);
      if (key.startsWith("__")) {
        if (!existing && incoming) next[key] = value;
        continue;
      }
      if (incoming && (!existing || existing === "0" || existing === "0.0000")) next[key] = value;
    }
    next.__jst_web_merged_count = Number(current.__jst_web_merged_count || 1) + 1;
    next.__jst_web_merged_methods = [
    ...(Array.isArray(current.__jst_web_merged_methods) ? current.__jst_web_merged_methods : []),
    record.__jst_web_legacy_method || record.__jst_web_json_path || record.__jst_web_kind].
    filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
    merged.set(externalId, next);
  }
  return [...merged.values()];
}

function extractTotalCount(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
  payload.total,
  payload.total_count,
  payload.totalCount,
  payload.count,
  payload.data?.total,
  payload.data?.total_count,
  payload.data?.totalCount];

  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function responseHasMore(payload, pageIndex, pageSize, recordCount) {
  const values = [
  payload?.has_next,
  payload?.hasNext,
  payload?.has_more,
  payload?.hasMore,
  payload?.data?.has_next,
  payload?.data?.hasNext,
  payload?.data?.has_more,
  payload?.data?.hasMore];

  if (values.some((value) => value === true || value === "true" || value === 1 || value === "1")) return true;
  const total = extractTotalCount(payload);
  if (total !== null) return pageIndex * pageSize < total;
  return recordCount >= pageSize;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function formatJstDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
  date.getFullYear(),
  "-",
  pad(date.getMonth() + 1),
  "-",
  pad(date.getDate()),
  " ",
  pad(date.getHours()),
  ":",
  pad(date.getMinutes()),
  ":",
  pad(date.getSeconds())].
  join("");
}

function resolveRange(payload = {}, source = {}) {
  const now = new Date();
  const rangeDays = Math.max(1, Math.min(Math.floor(Number(payload.rangeDays) || 30), 3650));
  const startAt = optionalString(payload.startAt || payload.start_at) || (
  payload.full ? "2000-01-01 00:00:00" : optionalString(source.cursor_value)) ||
  formatJstDateTime(addDays(now, -rangeDays));
  const endAt = optionalString(payload.endAt || payload.end_at) || formatJstDateTime(now);
  return { startAt, endAt };
}

function buildRequestBody(source, options = {}) {
  const params = {
    ...parseJsonObject(source.default_params_json, {}),
    ...parseJsonObject(options.defaultParams, {}),
    ...(options.params && typeof options.params === "object" ? options.params : {})
  };
  const pageSize = Math.max(1, Math.min(Math.floor(Number(options.pageSize || source.page_size || 100)), 500));
  const pageIndex = Math.max(1, Math.floor(Number(options.pageIndex || 1)));
  if (source.sync_mode !== "static") {
    if (params.page_index === undefined && params.pageIndex === undefined) params.page_index = pageIndex;
    if (params.page_size === undefined && params.pageSize === undefined) params.page_size = pageSize;
  }
  if (source.sync_mode === "range") {
    const range = resolveRange(options, source);
    if (params.modified_begin === undefined && params.start_time === undefined && params.begin_time === undefined) {
      params.modified_begin = range.startAt;
    }
    if (params.modified_end === undefined && params.end_time === undefined) {
      params.modified_end = range.endAt;
    }
  }
  return { body: params, pageSize, pageIndex };
}

function summarizeResponse(payload, records, pageIndex) {
  return {
    pageIndex,
    recordCount: records.length,
    total: extractTotalCount(payload),
    issuccess: payload?.issuccess,
    code: payload?.code ?? payload?.error_code ?? null,
    message: payload?.msg || payload?.message || ""
  };
}

class JushuitanService {
  constructor(options = {}) {
    this.db = options.db;
    this.clientFactory = options.clientFactory || ((auth, clientOptions = {}) => new JushuitanClient({ ...auth, ...clientOptions }));
    this.webCollectorFactory = options.webCollectorFactory || (() => new JushuitanWebCollector({ userDataDir: options.webCollectorUserDataDir }));
    this.webCollector = null;
  }

  getWebCollector() {
    if (!this.webCollector) this.webCollector = this.webCollectorFactory();
    return this.webCollector;
  }

  async ensureDefaultSources(companyId) {






































    await withTransaction(this.db, async (txDb) => {for (const source of SOURCE_CATALOG) await execute(txDb, `
      INSERT INTO erp_jst_sync_sources (
        id, company_id, source_key, method, label, category, enabled, sync_mode,
        page_size, default_params_json, cursor_field, cursor_value, last_synced_at,
        last_success_at, last_error, total_synced, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @source_key, @method, @label, @category, @enabled, @sync_mode,
        @page_size, @default_params_json, @cursor_field, @cursor_value, @last_synced_at,
        @last_success_at, @last_error, @total_synced, @created_at, @updated_at
      )
      ON CONFLICT(company_id, source_key) DO UPDATE SET
        method = excluded.method,
        label = excluded.label,
        category = excluded.category,
        sync_mode = excluded.sync_mode,
        default_params_json = excluded.default_params_json,
        updated_at = excluded.updated_at
    `, [sourceToRow(source, companyId)]);}



















































































































































































































































































































































































































































































































































































































































































    );}async ensureImportedSource(companyId, sourceKey, meta = {}) {await this.ensureDefaultSources(companyId);const existing = await queryOne(this.db, `
      SELECT * FROM erp_jst_sync_sources WHERE company_id = ? AND source_key = ?
    `, [companyId, sourceKey]);if (existing) return existing;const now = nowIso();const row = { id: createId("jst_source"), company_id: companyId, source_key: sourceKey, method: optionalString(meta.method) || `file.${sourceKey}`, label: optionalString(meta.label) || "未识别导入表", category: optionalString(meta.category) || "导入", enabled: 1, sync_mode: normalizeSyncMode(meta.syncMode || meta.sync_mode || "static"), page_size: Number(meta.pageSize || meta.page_size) || 500, default_params_json: JSON.stringify(meta.defaultParams || meta.default_params || {}), cursor_field: null, cursor_value: null, last_synced_at: null, last_success_at: null, last_error: null, total_synced: 0, created_at: now, updated_at: now };await execute(this.db, `
      INSERT INTO erp_jst_sync_sources (
        id, company_id, source_key, method, label, category, enabled, sync_mode,
        page_size, default_params_json, cursor_field, cursor_value, last_synced_at,
        last_success_at, last_error, total_synced, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @source_key, @method, @label, @category, @enabled, @sync_mode,
        @page_size, @default_params_json, @cursor_field, @cursor_value, @last_synced_at,
        @last_success_at, @last_error, @total_synced, @created_at, @updated_at
      )
    `, [row]);return row;}async getAuthRow(companyId) {return await queryOne(this.db, `
      SELECT * FROM erp_jst_auth_settings
      WHERE company_id = ?
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `, [companyId]);}async getAuthStatus(actor = {}) {const companyId = normalizeCompanyId(null, actor);await this.ensureDefaultSources(companyId);const auth = toAuthStatus(await this.getAuthRow(companyId));const sources = await this.listSources({ companyId }, actor);const latestJobs = await this.listJobs({ companyId, limit: 5 }, actor);const rawCount = (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_jst_raw_records WHERE company_id = ?", [companyId]))?.count || 0;return { companyId, auth, configured: auth.configured, rawCount, sources, latestJobs };}async saveAuthConfig(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const now = nowIso();const environment = normalizeEnvironment(payload.environment);const baseUrl = optionalString(payload.baseUrl || payload.base_url) || (environment === "sandbox" ? DEFAULT_SANDBOX_BASE_URL : DEFAULT_LEGACY_BASE_URL);const existing = await this.getAuthRow(companyId);const row = { id: existing?.id || createId("jst_auth"), company_id: companyId, label: optionalString(payload.label) || existing?.label || "default", auth_mode: "legacy", environment, base_url: baseUrl, partner_id: optionalString(payload.partnerId || payload.partner_id) || existing?.partner_id || null, partner_key: optionalString(payload.partnerKey || payload.partner_key) || existing?.partner_key || null, token: optionalString(payload.token) || existing?.token || null, app_key: optionalString(payload.appKey || payload.app_key) || existing?.app_key || null, app_secret: optionalString(payload.appSecret || payload.app_secret) || existing?.app_secret || null, access_token: optionalString(payload.accessToken || payload.access_token) || existing?.access_token || null, status: normalizeStatus(payload.status || existing?.status), last_test_at: existing?.last_test_at || null, last_token_refresh_at: existing?.last_token_refresh_at || null, last_error: null, created_by: existing?.created_by || optionalString(actor.id) || null, created_at: existing?.created_at || now, updated_at: now };await execute(this.db, `
      INSERT INTO erp_jst_auth_settings (
        id, company_id, label, auth_mode, environment, base_url, partner_id, partner_key,
        token, app_key, app_secret, access_token, status, last_test_at,
        last_token_refresh_at, last_error, created_by, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @label, @auth_mode, @environment, @base_url, @partner_id, @partner_key,
        @token, @app_key, @app_secret, @access_token, @status, @last_test_at,
        @last_token_refresh_at, @last_error, @created_by, @created_at, @updated_at
      )
      ON CONFLICT(company_id, label) DO UPDATE SET
        auth_mode = excluded.auth_mode,
        environment = excluded.environment,
        base_url = excluded.base_url,
        partner_id = excluded.partner_id,
        partner_key = excluded.partner_key,
        token = excluded.token,
        app_key = excluded.app_key,
        app_secret = excluded.app_secret,
        access_token = excluded.access_token,
        status = excluded.status,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `, [row]);await this.ensureDefaultSources(companyId);return toAuthStatus(await this.getAuthRow(companyId));}async createClient(companyId, options = {}) {const row = await this.getAuthRow(companyId);if (!row || !row.partner_id || !row.partner_key || !row.token) {throw new Error("请先配置聚水潭 partnerId / partnerKey / token");}return this.clientFactory({ authMode: row.auth_mode || "legacy", environment: row.environment || "production", baseUrl: row.base_url, partnerId: row.partner_id, partnerKey: row.partner_key, token: row.token }, options);}async testConnection(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const client = await this.createClient(companyId, { timeoutMs: Number(payload.timeoutMs) || 20000 });const now = nowIso();try {const response = await client.request("shops.query", {}, { timeoutMs: Number(payload.timeoutMs) || 20000 });await execute(this.db, `
        UPDATE erp_jst_auth_settings
        SET last_test_at = @last_test_at, last_error = NULL, updated_at = @updated_at
        WHERE company_id = @company_id
      `, { company_id: companyId, last_test_at: now, updated_at: now });const records = extractRecords(response);return { ok: true, method: "shops.query", recordCount: records.length, responseSummary: summarizeResponse(response, records, 1) };} catch (error) {await execute(this.db, `
        UPDATE erp_jst_auth_settings
        SET last_test_at = @last_test_at, last_error = @last_error, updated_at = @updated_at
        WHERE company_id = @company_id
      `, { company_id: companyId, last_test_at: now, last_error: error?.message || String(error), updated_at: now });throw error;}}async listSources(params = {}, actor = {}) {const companyId = normalizeCompanyId(params.companyId || params.company_id, actor);await this.ensureDefaultSources(companyId);const rows = await queryAll(this.db, `
      SELECT source.*,
        (SELECT COUNT(*) FROM erp_jst_raw_records raw
          WHERE raw.company_id = source.company_id AND raw.source_key = source.source_key) AS raw_count
      FROM erp_jst_sync_sources source
      WHERE source.company_id = @company_id
      ORDER BY source.category, source.source_key
    `, { company_id: companyId });return rows.map((row) => ({ ...toSource(row), rawCount: row.raw_count || 0 }));}async saveSource(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const sourceKey = optionalString(payload.sourceKey || payload.source_key);if (!sourceKey) throw new Error("sourceKey is required");await this.ensureDefaultSources(companyId);const existing = await queryOne(this.db, `
      SELECT * FROM erp_jst_sync_sources WHERE company_id = ? AND source_key = ?
    `, [companyId, sourceKey]);if (!existing) throw new Error(`Jushuitan source not found: ${sourceKey}`);const defaultParams = payload.defaultParams && typeof payload.defaultParams === "object" ? payload.defaultParams : parseJsonObject(payload.defaultParamsJson || payload.default_params_json, parseJsonObject(existing.default_params_json, {}));const row = { company_id: companyId, source_key: sourceKey, enabled: payload.enabled === undefined ? existing.enabled : payload.enabled ? 1 : 0, page_size: Math.max(1, Math.min(Math.floor(Number(payload.pageSize || payload.page_size || existing.page_size || 100)), 500)), default_params_json: JSON.stringify(defaultParams || {}), updated_at: nowIso() };await execute(this.db, `
      UPDATE erp_jst_sync_sources
      SET enabled = @enabled,
          page_size = @page_size,
          default_params_json = @default_params_json,
          updated_at = @updated_at
      WHERE company_id = @company_id AND source_key = @source_key
    `, [row]);return toSource(await queryOne(this.db, "SELECT * FROM erp_jst_sync_sources WHERE company_id = ? AND source_key = ?", [companyId, sourceKey]));}async createJob({ companyId, source, payload, actor }) {const now = nowIso();const row = { id: createId("jst_job"), company_id: companyId, source_key: source?.source_key || null, method: source?.method || null, mode: payload?.mode || (payload?.full ? "full" : "incremental"), status: "running", started_at: now, finished_at: null, fetched_count: 0, page_count: 0, error: null, request_json: JSON.stringify(payload || {}), response_summary_json: "{}", created_by: optionalString(actor?.id) || null };await execute(this.db, `
      INSERT INTO erp_jst_sync_jobs (
        id, company_id, source_key, method, mode, status, started_at, finished_at,
        fetched_count, page_count, error, request_json, response_summary_json, created_by
      )
      VALUES (
        @id, @company_id, @source_key, @method, @mode, @status, @started_at, @finished_at,
        @fetched_count, @page_count, @error, @request_json, @response_summary_json, @created_by
      )
    `, [row]);return row;}readWorkbookSheets(filePath) {const ext = path.extname(filePath).toLowerCase();if (![".xlsx", ".xls", ".csv"].includes(ext)) {throw new Error("只支持导入 .xlsx / .xls / .csv 文件");}const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false, dense: false });return workbook.SheetNames.map((sheetName) => {const sheet = workbook.Sheets[sheetName];const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, blankrows: false }).map(sanitizeSheetRow).filter((row) => !isBlankRow(row));const headers = rows[0] ? Object.keys(rows[0]) : [];return { sheetName, rows, headers };}).filter((sheet) => sheet.rows.length > 0);}async importFile(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const filePath = optionalString(payload.filePath || payload.file_path);if (!filePath) throw new Error("filePath is required");const forcedSourceKey = optionalString(payload.sourceKey || payload.source_key);const sheets = this.readWorkbookSheets(filePath);if (!sheets.length) throw new Error("文件里没有可导入的数据行");const catalog = sourceCatalogByKey();const results = [];for (const sheet of sheets) {const inferredKey = forcedSourceKey || inferSourceKey({ filePath, sheetName: sheet.sheetName, headers: sheet.headers });const sourceMeta = catalog.get(inferredKey) || { key: inferredKey, method: `file.${inferredKey}`, label: inferredKey === "unknown" ? "未识别导入表" : inferredKey, category: "导入" };const source = await this.ensureImportedSource(companyId, inferredKey, sourceMeta);const job = await this.createJob({ companyId, source, payload: { mode: "file_import", filePath, fileName: path.basename(filePath), sheetName: sheet.sheetName, sourceKey: inferredKey, rowCount: sheet.rows.length }, actor });const importedAt = nowIso();try {const records = sheet.rows.map((row, index) => ({ ...row, __jst_import_file: path.basename(filePath), __jst_import_sheet: sheet.sheetName, __jst_import_row: index + 2, __jst_imported_at: importedAt }));await this.storeRecords({ companyId, source, records, jobId: job.id, fetchedAt: importedAt });await execute(this.db, `
          UPDATE erp_jst_sync_sources
          SET last_synced_at = @last_synced_at,
              last_success_at = @last_success_at,
              last_error = NULL,
              total_synced = total_synced + @fetched_count,
              updated_at = @updated_at
          WHERE company_id = @company_id AND source_key = @source_key
        `, { company_id: companyId, source_key: inferredKey, last_synced_at: importedAt, last_success_at: importedAt, fetched_count: records.length, updated_at: importedAt });await this.updateJob(job.id, { status: "success", finished_at: importedAt, fetched_count: records.length, page_count: 1, error: null, response_summary_json: { importType: "file", fileName: path.basename(filePath), sheetName: sheet.sheetName, sourceKey: inferredKey, headers: sheet.headers } });results.push({ jobId: job.id, sheetName: sheet.sheetName, sourceKey: inferredKey, label: source.label, importedRows: records.length, headers: sheet.headers, status: "success" });} catch (error) {const message = error?.message || String(error);await this.updateJob(job.id, { status: "failed", finished_at: nowIso(), fetched_count: 0, page_count: 1, error: message, response_summary_json: { importType: "file", fileName: path.basename(filePath), sheetName: sheet.sheetName, sourceKey: inferredKey, headers: sheet.headers } });results.push({ jobId: job.id, sheetName: sheet.sheetName, sourceKey: inferredKey, label: source.label, importedRows: 0, headers: sheet.headers, status: "failed", error: message });}}return { filePath, fileName: path.basename(filePath), sheetCount: results.length, importedRows: results.reduce((sum, item) => sum + Number(item.importedRows || 0), 0), results, importedAt: nowIso() };}async openWebCollector(payload = {}, actor = {}) {normalizeCompanyId(payload.companyId || payload.company_id, actor);const url = optionalString(payload.url) || DEFAULT_JST_URL;return this.getWebCollector().open({ url });}async closeWebCollector() {if (!this.webCollector) return { closed: true };return this.webCollector.close();}async syncToOperationalTables(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const bridge = new JushuitanOperationalBridge({ db: this.db });return await bridge.sync({ ...payload, companyId }, actor);}async collectWebPage(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const catalog = sourceCatalogByKey();const collectedAt = nowIso();const webResult = await this.getWebCollector().collect({ url: optionalString(payload.url), maxPages: payload.maxPages || payload.max_pages, maxScrolls: payload.maxScrolls || payload.max_scrolls, maxRecords: payload.maxRecords || payload.max_records, pageSize: payload.pageSize || payload.page_size, autoNext: payload.autoNext === true || payload.auto_next === true, captureNetwork: payload.captureNetwork !== false && payload.capture_network !== false });const firstRecord = webResult.records?.[0] || {};const inferredKey = optionalString(payload.sourceKey || payload.source_key) || inferSourceKey({ filePath: webResult.url, sheetName: [webResult.title, firstRecord.__jst_web_page_heading, firstRecord.__jst_web_json_path].filter(Boolean).join(" "), headers: Object.keys(firstRecord) });const sourceKey = inferredKey && inferredKey !== "unknown" ? inferredKey : "web_collect";const sourceMeta = catalog.get(sourceKey) || { key: sourceKey, method: `web.${sourceKey}`, label: sourceKey === "web_collect" ? "网页采集" : sourceKey, category: "网页", syncMode: "static", pageSize: 500 };const source = await this.ensureImportedSource(companyId, sourceKey, sourceMeta);const job = await this.createJob({ companyId, source, payload: { mode: "web_collect", url: webResult.url, title: webResult.title, sourceKey, maxPages: payload.maxPages || payload.max_pages || 1, autoNext: payload.autoNext === true || payload.auto_next === true }, actor });try {const records = mergeRecordsByExternalId((webResult.records || []).map((record, index) => ({ ...record, __jst_web_source: "browser", __jst_web_record_index: index + 1, __jst_web_collected_at: collectedAt })), sourceKey);if (records.length > 0) {await this.storeRecords({ companyId, source, records, jobId: job.id, fetchedAt: collectedAt });}await execute(this.db, `
        UPDATE erp_jst_sync_sources
        SET last_synced_at = @last_synced_at,
            last_success_at = @last_success_at,
            last_error = NULL,
            total_synced = total_synced + @fetched_count,
            updated_at = @updated_at
        WHERE company_id = @company_id AND source_key = @source_key
      `, { company_id: companyId, source_key: sourceKey, last_synced_at: collectedAt, last_success_at: collectedAt, fetched_count: records.length, updated_at: collectedAt });await this.updateJob(job.id, { status: "success", finished_at: collectedAt, fetched_count: records.length, page_count: webResult.pageCount || 1, error: null, response_summary_json: { importType: "web", url: webResult.url, title: webResult.title, sourceKey, domCount: webResult.domCount, networkCount: webResult.networkCount, loginLikely: webResult.loginLikely } });return { ...webResult, jobId: job.id, sourceKey, label: source.label, importedRows: records.length, collectedAt };} catch (error) {const message = error?.message || String(error);await this.updateJob(job.id, { status: "failed", finished_at: nowIso(), fetched_count: 0, page_count: webResult.pageCount || 0, error: message, response_summary_json: { importType: "web", url: webResult.url, title: webResult.title, sourceKey } });throw error;}}async ingestExtensionBatch(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const items = Array.isArray(payload.items) ? payload.items : [];const collectedAt = nowIso();const catalog = sourceCatalogByKey();const groups = new Map();let ignored = 0;let extractedRows = 0;for (const item of items) {if (!item || typeof item !== "object" || !isJushuitanCaptureItem(item)) {ignored += 1;continue;}const body = parseExtensionBody(item);if (!body) {ignored += 1;continue;}const records = [];collectExtensionJsonRecords(body, records);if (!records.length) {ignored += 1;continue;}const sourceKey = optionalString(item.sourceKey || item.source_key || body.sourceKey || body.source_key) || inferExtensionSourceKey(item, records[0]);if (!groups.has(sourceKey)) groups.set(sourceKey, []);const bucket = groups.get(sourceKey);records.forEach((record, index) => {bucket.push({ ...record, __jst_web_source: "extension", __jst_web_record_index: bucket.length + index + 1, __jst_web_collected_at: collectedAt, __jst_web_response_url: item.url || item.tab_url || "", __jst_web_response_status: item.status || null, __jst_web_page: item.page || "", __jst_web_tab_url: item.tab_url || "" });});extractedRows += records.length;}const sources = [];let importedRows = 0;for (const [sourceKey, rawRecords] of groups.entries()) {const sourceMeta = catalog.get(sourceKey) || { key: sourceKey, method: `extension.${sourceKey}`, label: sourceKey === "web_collect" ? "extension_capture" : sourceKey, category: "extension", syncMode: "static", pageSize: 500 };const source = await this.ensureImportedSource(companyId, sourceKey, sourceMeta);const records = mergeRecordsByExternalId(rawRecords, sourceKey);const job = await this.createJob({ companyId, source, payload: { mode: "extension_ingest", sourceKey, eventCount: items.length, extractedRows: rawRecords.length }, actor });try {if (records.length > 0) {await this.storeRecords({ companyId, source, records, jobId: job.id, fetchedAt: collectedAt });}await execute(this.db, `
          UPDATE erp_jst_sync_sources
          SET last_synced_at = @last_synced_at,
              last_success_at = @last_success_at,
              last_error = NULL,
              total_synced = total_synced + @fetched_count,
              updated_at = @updated_at
          WHERE company_id = @company_id AND source_key = @source_key
        `, { company_id: companyId, source_key: sourceKey, last_synced_at: collectedAt, last_success_at: collectedAt, fetched_count: records.length, updated_at: collectedAt });await this.updateJob(job.id, { status: "success", finished_at: collectedAt, fetched_count: records.length, page_count: 1, error: null, response_summary_json: { importType: "extension", sourceKey, extractedRows: rawRecords.length, importedRows: records.length } });importedRows += records.length;sources.push({ sourceKey, extractedRows: rawRecords.length, importedRows: records.length, jobId: job.id });} catch (error) {await this.updateJob(job.id, { status: "failed", finished_at: nowIso(), fetched_count: 0, page_count: 0, error: error?.message || String(error), response_summary_json: { importType: "extension", sourceKey } });throw error;}}const sourceKeys = sources.map((item) => item.sourceKey);const syncResult = importedRows > 0 && payload.sync !== false ? await this.syncToOperationalTables({ companyId, sourceKeys }, actor) : null;return { ok: true, companyId, acceptedEvents: items.length - ignored, ignoredEvents: ignored, extractedRows, importedRows, sources, syncResult, collectedAt };}async storeRecords({ companyId, source, records, jobId, fetchedAt }) {await withTransaction(this.db, async (txDb) => {for (const record of records) {const rawJson = stableStringify(record);const recordHash = hashRecord(record);await execute(txDb, `
      INSERT INTO erp_jst_raw_records (
        id, company_id, source_key, method, external_id, cursor_value,
        record_hash, raw_json, fetched_at, updated_at, job_id
      )
      VALUES (
        @id, @company_id, @source_key, @method, @external_id, @cursor_value,
        @record_hash, @raw_json, @fetched_at, @updated_at, @job_id
      )
      ON CONFLICT(company_id, source_key, external_id) DO UPDATE SET
        cursor_value = excluded.cursor_value,
        record_hash = excluded.record_hash,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at,
        job_id = excluded.job_id
    `, { id: createId("jst_raw"), company_id: companyId, source_key: source.source_key, method: source.method, external_id: inferExternalId(record, source.source_key), cursor_value: inferCursorValue(record) || null, record_hash: recordHash, raw_json: rawJson, fetched_at: fetchedAt, updated_at: fetchedAt, job_id: jobId });}});}async updateJob(jobId, patch) {const current = await queryOne(this.db, "SELECT * FROM erp_jst_sync_jobs WHERE id = ?", [jobId]);if (!current) return null;const row = { ...current, ...patch, response_summary_json: patch.response_summary_json !== undefined ? typeof patch.response_summary_json === "string" ? patch.response_summary_json : JSON.stringify(patch.response_summary_json || {}) : current.response_summary_json };await execute(this.db, `
      UPDATE erp_jst_sync_jobs
      SET status = @status,
          finished_at = @finished_at,
          fetched_count = @fetched_count,
          page_count = @page_count,
          error = @error,
          response_summary_json = @response_summary_json
      WHERE id = @id
    `, [row]);return row;}async syncSource(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);const sourceKey = optionalString(payload.sourceKey || payload.source_key);if (!sourceKey) throw new Error("sourceKey is required");await this.ensureDefaultSources(companyId);const source = await queryOne(this.db, `
      SELECT * FROM erp_jst_sync_sources WHERE company_id = ? AND source_key = ?
    `, [companyId, sourceKey]);if (!source) throw new Error(`Jushuitan source not found: ${sourceKey}`);if (!source.enabled && !payload.force) throw new Error(`Jushuitan source is disabled: ${sourceKey}`);const client = await this.createClient(companyId, { timeoutMs: Number(payload.timeoutMs) || 30000 });const job = await this.createJob({ companyId, source, payload: { ...payload, mode: payload.mode || "single" }, actor });const maxPages = source.sync_mode === "static" ? 1 : Math.max(1, Math.min(Math.floor(Number(payload.maxPages) || 200), 10000));const summaries = [];let fetchedCount = 0;let pageCount = 0;let lastCursor = optionalString(source.cursor_value);try {for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {const { body, pageSize } = buildRequestBody(source, { ...payload, pageIndex, pageSize: payload.pageSize || payload.page_size || source.page_size });const response = await client.request(source.method, body, { timeoutMs: Number(payload.timeoutMs) || 30000 });const records = extractRecords(response);const fetchedAt = nowIso();if (records.length) {await this.storeRecords({ companyId, source, records, jobId: job.id, fetchedAt });fetchedCount += records.length;for (const record of records) {const cursor = inferCursorValue(record);if (cursor && cursor > lastCursor) lastCursor = cursor;}}pageCount = pageIndex;summaries.push(summarizeResponse(response, records, pageIndex));if (source.sync_mode === "static" || !responseHasMore(response, pageIndex, pageSize, records.length)) break;}const now = nowIso();await execute(this.db, `
        UPDATE erp_jst_sync_sources
        SET cursor_value = COALESCE(@cursor_value, cursor_value),
            last_synced_at = @last_synced_at,
            last_success_at = @last_success_at,
            last_error = NULL,
            total_synced = total_synced + @fetched_count,
            updated_at = @updated_at
        WHERE company_id = @company_id AND source_key = @source_key
      `, { company_id: companyId, source_key: sourceKey, cursor_value: lastCursor || null, last_synced_at: now, last_success_at: now, fetched_count: fetchedCount, updated_at: now });await this.updateJob(job.id, { status: "success", finished_at: now, fetched_count: fetchedCount, page_count: pageCount, error: null, response_summary_json: { pages: summaries } });return { jobId: job.id, sourceKey, method: source.method, label: source.label, status: "success", fetchedCount, pageCount, summaries };} catch (error) {const now = nowIso();const message = error?.message || String(error);await execute(this.db, `
        UPDATE erp_jst_sync_sources
        SET last_synced_at = @last_synced_at,
            last_error = @last_error,
            updated_at = @updated_at
        WHERE company_id = @company_id AND source_key = @source_key
      `, { company_id: companyId, source_key: sourceKey, last_synced_at: now, last_error: message, updated_at: now });await this.updateJob(job.id, { status: "failed", finished_at: now, fetched_count: fetchedCount, page_count: pageCount, error: message, response_summary_json: { pages: summaries } });error.jobId = job.id;error.sourceKey = sourceKey;throw error;}}async syncAll(payload = {}, actor = {}) {const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);await this.ensureDefaultSources(companyId);const requested = Array.isArray(payload.sourceKeys || payload.source_keys) ? (payload.sourceKeys || payload.source_keys).map(optionalString).filter(Boolean) : [];const allSources = (await this.listSources({ companyId }, actor)).filter((source) => source.enabled && (!requested.length || requested.includes(source.sourceKey)));const results = [];for (const source of allSources) {
      try {
        const result = await this.syncSource({
          ...payload,
          companyId,
          sourceKey: source.sourceKey,
          mode: payload.full ? "full_all" : "incremental_all"
        }, actor);
        results.push(result);
      } catch (error) {
        results.push({
          sourceKey: source.sourceKey,
          method: source.method,
          label: source.label,
          status: "failed",
          error: error?.message || String(error),
          jobId: error?.jobId || null
        });
      }
    }
    const ok = results.filter((item) => item.status === "success");
    const failed = results.filter((item) => item.status === "failed");
    return {
      totalSources: results.length,
      okSources: ok.length,
      failedSources: failed.length,
      totalFetched: ok.reduce((sum, item) => sum + Number(item.fetchedCount || 0), 0),
      results,
      syncedAt: nowIso()
    };
  }

  async listJobs(params = {}, actor = {}) {
    const companyId = normalizeCompanyId(params.companyId || params.company_id, actor);
    const limit = Math.max(1, Math.min(Math.floor(Number(params.limit) || 20), 200));
    const rows = await queryAll(this.db, `
      SELECT * FROM erp_jst_sync_jobs
      WHERE company_id = @company_id
      ORDER BY started_at DESC
      LIMIT @limit
    `, { company_id: companyId, limit });
    return rows.map((row) => {
      const next = toCamelRow(row);
      next.responseSummary = parseJsonObject(row.response_summary_json, {});
      next.request = parseJsonObject(row.request_json, {});
      delete next.responseSummaryJson;
      delete next.requestJson;
      return next;
    });
  }

  async listRawRecords(params = {}, actor = {}) {
    const companyId = normalizeCompanyId(params.companyId || params.company_id, actor);
    const sourceKey = optionalString(params.sourceKey || params.source_key);
    const limit = Math.max(1, Math.min(Math.floor(Number(params.limit) || 100), 500));
    const where = ["company_id = @company_id"];
    const bind = { company_id: companyId, limit };
    if (sourceKey) {
      where.push("source_key = @source_key");
      bind.source_key = sourceKey;
    }
    const rows = await queryAll(this.db, `
      SELECT * FROM erp_jst_raw_records
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT @limit
    `, [bind]);
    return rows.map((row) => {
      const next = toCamelRow(row);
      next.raw = parseJsonObject(row.raw_json, {});
      delete next.rawJson;
      return next;
    });
  }

  async getBusinessSummary(params = {}, actor = {}) {
    const companyId = normalizeCompanyId(params.companyId || params.company_id, actor);
    const rawCount = (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_jst_raw_records WHERE company_id = ?", [companyId]))?.count || 0;
    const businessCount = (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_jst_business_records WHERE company_id = ?", [companyId]))?.count || 0;
    const bySource = await queryAll(this.db, `
      SELECT
        source_key AS sourceKey,
        COUNT(*) AS count,
        COALESCE(SUM(qty), 0) AS qty,
        COALESCE(SUM(amount), 0) AS amount
      FROM erp_jst_business_records
      WHERE company_id = ?
      GROUP BY source_key
      ORDER BY count DESC
    `, [companyId]);
    const latestRun = await queryOne(this.db, `
      SELECT *
      FROM erp_jst_business_sync_runs
      WHERE company_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `, [companyId]);
    return {
      companyId,
      rawCount,
      businessCount,
      accounts: (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_accounts WHERE company_id = ? AND id LIKE 'jst:%'", [companyId]))?.count || 0,
      suppliers: (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_suppliers WHERE company_id = ? AND id LIKE 'jst:%'", [companyId]))?.count || 0,
      skus: (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_skus WHERE company_id = ? AND id LIKE 'jst:%'", [companyId]))?.count || 0,
      purchaseOrders: (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_purchase_orders WHERE account_id = 'jst:account:default'"))?.count || 0,
      sku1688Sources: (await queryOne(this.db, "SELECT COUNT(*) AS count FROM erp_sku_1688_sources WHERE id LIKE 'jst:%'"))?.count || 0,
      bySource,
      latestRun: latestRun ? toCamelRow(latestRun) : null,
      generatedAt: nowIso()
    };
  }

  async listBusinessRecords(params = {}, actor = {}) {
    const companyId = normalizeCompanyId(params.companyId || params.company_id, actor);
    const sourceKey = optionalString(params.sourceKey || params.source_key);
    const keyword = optionalString(params.keyword || params.q);
    const limit = Math.max(1, Math.min(Math.floor(Number(params.limit) || 100), 500));
    const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
    const where = ["company_id = @company_id"];
    const bind = { company_id: companyId, limit, offset };
    if (sourceKey) {
      where.push("source_key = @source_key");
      bind.source_key = sourceKey;
    }
    if (keyword) {
      where.push(`(
        business_no LIKE @keyword
        OR related_no LIKE @keyword
        OR party_name LIKE @keyword
        OR shop_name LIKE @keyword
        OR sku_code LIKE @keyword
        OR product_name LIKE @keyword
        OR warehouse_name LIKE @keyword
        OR logistics_company LIKE @keyword
        OR tracking_no LIKE @keyword
      )`);
      bind.keyword = `%${keyword}%`;
    }
    const whereClause = where.join(" AND ");
    const total = (await queryOne(this.db, `
      SELECT COUNT(*) AS count
      FROM erp_jst_business_records
      WHERE ${whereClause}
    `, [bind]))?.count || 0;
    const rows = (await queryAll(this.db, `
      SELECT *
      FROM erp_jst_business_records
      WHERE ${whereClause}
      ORDER BY COALESCE(business_time, updated_at) DESC, updated_at DESC
      LIMIT @limit OFFSET @offset
    `, [bind])).map((row) => {
      const next = toCamelRow(row);
      next.raw = parseJsonObject(row.raw_json, {});
      delete next.rawJson;
      return next;
    });
    return {
      companyId,
      total,
      limit,
      offset,
      rows,
      generatedAt: nowIso()
    };
  }
}

module.exports = {
  JushuitanService,
  SOURCE_CATALOG
};