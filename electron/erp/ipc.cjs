const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { getErpDatabasePath, openErpDatabase } = require("../db/connection.cjs");
const { runMigrations } = require("../db/migrate.cjs");
const { createErpServices } = require("./services/index.cjs");
const { createId, nowIso } = require("./services/utils.cjs");
const {
  canTransition,
  decideQCResult,
} = require("./workflow/validators.cjs");
const enums = require("./workflow/enums.cjs");
const {
  broadcastLanEvent,
  getLanStatus,
  syncLanUserSessions,
  startLanServer,
  stopLanServer,
} = require("./lanServer.cjs");
const {
  HK_SERVER_URL,
  configureClientRuntime,
  discoverControllers,
  getRuntimeStatus,
  isClientMode,
  remoteAuthStatus,
  remoteLogin,
  remoteLogout,
  remoteRequest: rawRemoteRequest,
  setClientMode,
  setHostMode,
} = require("./clientRuntime.cjs");
const skuCache = require("./skuCache.cjs");
const mappingCache = require("./mappingCache.cjs");
const {
  DEFAULT_1688_GATEWAY_BASE,
  PROCUREMENT_APIS,
  call1688OpenApi,
  normalize1688BuyerOrderListResponse,
  normalize1688MarketingMixConfigResponse,
  normalize1688ProductDetailResponse,
  normalize1688RefundListResponse,
  normalize1688SearchResponse,
} = require("./1688Client.cjs");
const {
  imageSearchProduct: imageSearchAlphaShopProduct,
  productDetailQuery: alphaShopProductDetailQuery,
} = require("./alphaShopMcpClient.cjs");
const { imageSearch1688Web } = require("./1688WebImageSearch.cjs");

const erpState = {
  db: null,
  services: null,
  initResult: null,
  initError: null,
  currentUser: null,
  userDataDir: null,
  auto1688OrderSyncTimer: null,
  auto1688OrderSyncRunning: false,
  auto1688AddressSyncByCompany: new Map(),
  schemaRepairDone: false,
  // 由 main.cjs 注入的 worker 调用器：(action, params, options) => Promise<result>
  workerInvoker: null,
};

const PURCHASE_UPDATE_CHANNEL = "erp:purchase:update";
const USER_UPDATE_CHANNEL = "erp:user:update";
const AUTH_EXPIRED_CHANNEL = "erp:auth:expired";
const AUTO_1688_ADDRESS_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const ALPHASHOP_API_BASE = "https://api.alphashop.cn";
const rendererEventSubscribers = new Set();
const BROADCAST_PURCHASE_ACTIONS = new Set([
  "create_pr",
  "create_purchase_request",
  "add_comment",
  "accept_pr",
  "mark_sourced",
  "cancel_pr",
  "quote_feedback",
  "add_sourcing_candidate",
  "source_1688_keyword",
  "source_1688_image",
  "auto_inquiry_1688",
  "record_local_1688_inquiry_results",
  "sync_1688_inquiry_results",
  "save_purchase_settings",
  "refresh_1688_product_detail",
  "search_1688_relation_suppliers",
  "sync_1688_relation_user_info",
  "follow_1688_product",
  "unfollow_1688_product",
  "sync_1688_purchased_products",
  "ensure_1688_supplier_profile_once",
  "save_1688_address",
  "sync_1688_addresses",
  "list_1688_purchase_accounts",
  "delete_1688_purchase_account",
  "update_1688_purchase_account",
  "update_1688_purchase_account_label",
  "set_account_default_1688_purchase",
  "set_default_1688_purchase_account",
  "upsert_sku_1688_source",
  "delete_sku_1688_source",
  "bind_1688_candidate_spec",
  "validate_1688_order_push",
  "preview_1688_order",
  "create_direct_po",
  "generate_po",
  "delete_po",
  "push_1688_order",
  "query_1688_mix_config",
  "get_1688_payment_url",
  "query_1688_pay_ways",
  "query_1688_protocol_pay_status",
  "prepare_1688_protocol_pay",
  "fetch_1688_order_detail",
  "sync_1688_logistics",
  "get_1688_refund_reasons",
  "get_1688_max_refund_fee",
  "upload_1688_refund_voucher",
  "create_1688_refund",
  "sync_1688_refunds",
  "sync_1688_refund_detail",
  "sync_1688_refund_operations",
  "submit_1688_return_goods",
  "list_1688_offline_logistics_companies",
  "request_1688_price_change",
  "sync_1688_order_price",
  "import_1688_orders",
  "generate_po_from_1688_order",
  "link_1688_order_to_po",
  "cancel_1688_order",
  "add_1688_order_memo",
  "add_1688_order_feedback",
  "confirm_1688_receive_goods",
  "run_1688_supply_change_agent",
  "feedback_1688_supply_change_agent",
  "add_1688_monitor_product",
  "delete_1688_monitor_product",
  "query_1688_monitor_products",
  "run_1688_deep_search_agent",
  "ensure_1688_mix_config_once",
  "configure_1688_message_subscriptions",
  "receive_1688_message",
  "sync_1688_orders",
  "submit_payment_approval",
  "approve_payment",
  "confirm_paid",
  "rollback_po_status",
  "update_offline_po",
]);

const ACCESS_CODE_ITERATIONS = 120000;
const ACCESS_CODE_KEY_LENGTH = 32;
const ACCESS_CODE_DIGEST = "sha256";
const VALID_USER_ROLES = new Set(["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"]);
const VALID_USER_STATUSES = new Set(["active", "blocked"]);
const JUSHUITAN_WAREHOUSE_NAME = "义乌明舵国际贸易有限公司";
const DEFAULT_COMPANY_ID = "company_default";
const DEFAULT_COMPANY_CODE = "default";
const DEFAULT_COMPANY_NAME = "Default Company";
const DEFAULT_PURCHASE_INQUIRY_TEMPLATE = [
  "商品包装方式是什么？商品需要提供哪些资质文件？可以优惠吗？",
  "整箱包装尺寸和重量是多少？下单需要注意什么？",
].join("");
const AUTO_1688_ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const AUTO_1688_ORDER_SYNC_START_DELAY_MS = 15 * 1000;
const VALID_COMPANY_STATUSES = new Set(["active", "disabled"]);
const VALID_PERMISSION_RESOURCE_TYPES = new Set(["menu", "document", "action"]);
const VALID_RESOURCE_SCOPE_TYPES = new Set(["account", "warehouse"]);
const VALID_ACCESS_LEVELS = new Set(["read", "write", "approve", "manage", "allow", "deny"]);
const ALIBABA_1688_AUTH_SETTING_ID = "default";
const ALIBABA_1688_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ALIBABA_1688_AUTHORIZE_URL = "https://auth.1688.com/oauth/authorize";
const ALIBABA_1688_TOKEN_URL_BASE = "https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken";
const ALIBABA_1688_MESSAGE_TOPICS = Object.freeze([
  ["order", "ORDER_BUYER_VIEW_BUYER_MAKE", "1688 order created"],
  ["order", "ORDER_BUYER_VIEW_MODIFY_MEMO", "1688 order memo modified"],
  ["order", "ORDER_BUYER_VIEW_ORDER_BUYER_CLOSE", "1688 buyer closed order"],
  ["order", "ORDER_BUYER_VIEW_ORDER_BOPS_CLOSE", "1688 platform closed order"],
  ["order", "ORDER_BUYER_VIEW_ORDER_PRICE_MODIFY", "1688 order price modified"],
  ["order", "ORDER_BUYER_VIEW_ORDER_SUCCESS", "1688 trade success"],
  ["order", "ORDER_BUYER_VIEW_ANNOUNCE_SENDGOODS", "1688 order shipped"],
  ["order", "ORDER_BUYER_VIEW_ORDER_BUYER_REFUND_IN_SALES", "1688 in-sale refund"],
  ["order", "ORDER_BUYER_VIEW_ORDER_SELLER_CLOSE", "1688 seller closed order"],
  ["order", "ORDER_BUYER_VIEW_PART_PART_SENDGOODS", "1688 partial shipment"],
  ["order", "ORDER_BATCH_PAY", "1688 batch payment"],
  ["order", "ORDER_BUYER_VIEW_ORDER_PAY", "1688 order paid"],
  ["order", "ORDER_BUYER_VIEW_ORDER_REFUND_AFTER_SALES", "1688 after-sale refund"],
  ["order", "ORDER_BUYER_VIEW_ORDER_COMFIRM_RECEIVEGOODS", "1688 received goods"],
  ["order", "ORDER_BUYER_VIEW_ORDER_STEP_PAY", "1688 step payment"],
  ["product", "PRODUCT_PRODUCT_INVENTORY_CHANGE", "1688 inventory changed"],
  ["product", "PRODUCT_RELATION_VIEW_PRODUCT_DELETE", "1688 product deleted"],
  ["product", "PRODUCT_RELATION_VIEW_PRODUCT_EXPIRE", "1688 product expired"],
  ["product", "PRODUCT_RELATION_VIEW_PRODUCT_REPOST", "1688 product reposted"],
  ["product", "PRODUCT_RELATION_VIEW_PRODUCT_NEW_OR_MODIFY", "1688 product created or modified"],
  ["logistics", "LOGISTICS_BUYER_VIEW_TRACE", "1688 logistics trace"],
  ["logistics", "LOGISTICS_MAIL_NO_CHANGE", "1688 logistics mail number changed"],
  ["agent", "AGENT_SUPPLY_CHANGE_RECOMMEND", "1688 supply change recommendation"],
]);

function toCamelKey(key) {
  // 含数字段（如 default_1688_purchase_account_id / alibaba_1688_address_id）也要并入前一段，
  // 否则会产生 default_1688PurchaseAccountId 这种半生不熟的字段名，前端读不到。
  return String(key).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function toCamelRow(row) {
  if (!row || typeof row !== "object") return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [toCamelKey(key), value]),
  );
}

function toSupplier(row) {
  const next = toCamelRow(row);
  try {
    next.categories = JSON.parse(row.categories_json || "[]");
  } catch {
    next.categories = [];
  }
  if (!next.source && String(next.id || "").startsWith("feishu:")) {
    next.source = "feishu";
  }
  return next;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    code: error.code || null,
    message: error.message || String(error),
  };
}

function subscribeRendererEvents(webContents) {
  if (!webContents || typeof webContents.send !== "function") return;
  if (rendererEventSubscribers.has(webContents)) return;
  rendererEventSubscribers.add(webContents);
  webContents.once("destroyed", () => {
    rendererEventSubscribers.delete(webContents);
  });
}

function unsubscribeRendererEvents(webContents) {
  if (webContents) rendererEventSubscribers.delete(webContents);
}

function broadcastRendererEvent(channel, payload) {
  for (const webContents of Array.from(rendererEventSubscribers)) {
    if (!webContents || webContents.isDestroyed()) {
      rendererEventSubscribers.delete(webContents);
      continue;
    }
    try {
      webContents.send(channel, payload);
    } catch {
      rendererEventSubscribers.delete(webContents);
    }
  }
}

function broadcastRendererPurchaseUpdate(payload) {
  broadcastRendererEvent(PURCHASE_UPDATE_CHANNEL, payload);
}

function broadcastRendererUserUpdate(payload) {
  broadcastRendererEvent(USER_UPDATE_CHANNEL, payload);
}

function broadcastRendererAuthExpired(payload = {}) {
  broadcastRendererEvent(AUTH_EXPIRED_CHANNEL, {
    type: "auth:expired",
    message: optionalString(payload.message) || "Cloud login expired, please reconnect.",
    path: optionalString(payload.path),
    at: nowIso(),
  });
}

async function remoteRequest(requestPath, options = {}) {
  try {
    return await rawRemoteRequest(requestPath, options);
  } catch (error) {
    const message = String(error?.message || "");
    if (error?.statusCode === 401 || message.includes("Cloud login expired")) {
      broadcastRendererAuthExpired({
        path: requestPath,
        message,
      });
    }
    throw error;
  }
}

function broadcastPurchaseUpdate(action, payload = {}, actor = {}, result = {}) {
  if (!BROADCAST_PURCHASE_ACTIONS.has(action)) return null;
  const event = {
    type: "purchase:update",
    action,
    prId: optionalString(payload.prId || payload.id || result?.id || result?.purchaseRequest?.id),
    poId: optionalString(payload.poId || result?.purchaseOrder?.id),
    actorRole: optionalString(actor.role),
    at: nowIso(),
  };
  try {
    broadcastLanEvent(event);
  } catch {}
  broadcastRendererPurchaseUpdate(event);
  return event;
}

function broadcastUserUpdate(action, payload = {}, actor = {}, user = {}) {
  const event = {
    type: "user:update",
    action,
    userId: optionalString(user.id || payload.id),
    role: optionalString(user.role || payload.role),
    status: optionalString(user.status || payload.status),
    actorRole: optionalString(actor.role),
    at: nowIso(),
  };
  try {
    broadcastLanEvent(event);
  } catch {}
  broadcastRendererUserUpdate(event);
  return event;
}

function requireString(value, fieldName) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

function require1688SpecId(value, context = "1688 mapping") {
  const text = optionalString(value);
  if (!text) {
    throw new Error(`${context} 缺少 1688 规格，请先选择具体规格`);
  }
  return text;
}

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeImportHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\r\n\t:：()（）【】\[\]{}_\-—/\\|.,，。;；]+/g, "");
}

function normalizeImportCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeImportCell).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.fullPhoneNum) return normalizeImportCell(value.fullPhoneNum);
    if (value.phoneNumber) return normalizeImportCell(value.phoneNumber);
    if (value.email) return normalizeImportCell(value.email);
    if (value.text) return normalizeImportCell(value.text);
    if (value.name) return normalizeImportCell(value.name);
    if (value.title) return normalizeImportCell(value.title);
    if (value.value) return normalizeImportCell(value.value);
    if (value.url) return normalizeImportCell(value.url);
    if (value.link) return normalizeImportCell(value.link);
    return Object.values(value).map(normalizeImportCell).filter(Boolean).join("、");
  }
  return String(value).trim();
}

const FEISHU_SUPPLIER_COLUMN_ALIASES = {
  supplierCode: ["供应商编号", "供应商编码", "供应商代码", "供应商id", "供应商ID", "供方编号", "供方编码", "编码", "编号", "代码", "id"],
  name: ["供应商名称", "供应商名", "供应商", "供方名称", "供方", "公司名称", "厂家名称", "厂家", "店铺名称", "店铺", "名称"],
  contactName: ["联系人", "联系人姓名", "对接人", "负责人", "采购联系人", "业务联系人"],
  phone: ["电话", "联系电话", "手机", "手机号", "手机号码", "联系方式", "联系电话/微信", "联系方式电话"],
  wechat: ["微信", "微信号", "微信号码"],
  address: ["地址", "供应商地址", "公司地址", "详细地址"],
  categories: ["经营类目", "供应类目", "类目", "主营类目", "品类", "分类", "供应商分类", "供方分类"],
  supplierLevel: ["供应商等级", "等级", "供应商级别", "级别", "分级"],
  paymentTerms: ["结算方式", "付款方式", "支付方式", "账期", "付款账期"],
  leadDays: ["交期", "标准交期", "供货周期", "发货周期", "交货天数", "生产周期"],
  taxRate: ["税率", "开票税率", "发票税率"],
  status: ["状态", "供应商状态", "启用状态"],
  remark: ["备注", "说明", "备注说明", "标签", "标记"],
};

function importValueByAliases(row, aliases) {
  const entries = Object.entries(row || {}).map(([key, value]) => ({
    key,
    normalizedKey: normalizeImportHeader(key),
    value,
  }));
  const normalizedAliases = aliases.map(normalizeImportHeader).filter(Boolean);
  for (const alias of normalizedAliases) {
    const exact = entries.find((entry) => entry.normalizedKey === alias);
    if (exact) return normalizeImportCell(exact.value);
  }
  for (const alias of normalizedAliases) {
    const fuzzy = entries.find((entry) => (
      entry.normalizedKey.length >= 2
      && alias.length >= 4
      && (entry.normalizedKey.includes(alias) || alias.includes(entry.normalizedKey))
    ));
    if (fuzzy) return normalizeImportCell(fuzzy.value);
  }
  return "";
}

function splitSupplierCategories(value) {
  const text = normalizeImportCell(value);
  if (!text) return [];
  return Array.from(new Set(
    text
      .split(/[\n\r,，、;；|/]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function normalizeSupplierLevel(value) {
  const text = normalizeImportCell(value).toLowerCase();
  if (!text) return null;
  if (/战略|strategic|s级|s\b/.test(text)) return "strategic";
  if (/优选|preferred|a级|a\b/.test(text)) return "preferred";
  if (/观察|待观察|watch/.test(text)) return "watch";
  if (/普通|标准|standard|b级|b\b/.test(text)) return "standard";
  return text;
}

function normalizePaymentTerms(value) {
  const text = normalizeImportCell(value).toLowerCase();
  if (!text) return null;
  if (/现款|现付|预付|prepaid/.test(text)) return "prepaid";
  if (/货到|到付|cod/.test(text)) return "cod";
  if (/周结|weekly/.test(text)) return "weekly";
  if (/月结|monthly/.test(text)) return "monthly";
  return text;
}

function normalizeSupplierStatus(value) {
  const text = normalizeImportCell(value).toLowerCase();
  if (!text) return null;
  if (/停用|禁用|拉黑|黑名单|blocked|inactive|disabled|作废/.test(text)) return "blocked";
  return "active";
}

function parseImportNumber(value) {
  const text = normalizeImportCell(value).replace(/,/g, "");
  if (!text) return null;
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const number = Number(matched[0]);
  return Number.isFinite(number) ? number : null;
}

function normalizeFeishuSupplierImportRow(raw = {}) {
  const read = (key) => importValueByAliases(raw, FEISHU_SUPPLIER_COLUMN_ALIASES[key] || []);
  const supplierCode = optionalString(read("supplierCode"));
  const name = optionalString(read("name"));
  return {
    supplierCode,
    name,
    contactName: optionalString(read("contactName")),
    phone: optionalString(read("phone")),
    wechat: optionalString(read("wechat")),
    address: optionalString(read("address")),
    categories: splitSupplierCategories(read("categories")),
    supplierLevel: normalizeSupplierLevel(read("supplierLevel")),
    paymentTerms: normalizePaymentTerms(read("paymentTerms")),
    leadDays: parseImportNumber(read("leadDays")),
    taxRate: parseImportNumber(read("taxRate")),
    status: normalizeSupplierStatus(read("status")),
    remark: optionalString(read("remark")),
  };
}

function readSupplierImportRowsFromSpreadsheet(filePath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`导入文件不存在：${resolvedPath}`);
  }
  const workbook = XLSX.readFile(resolvedPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
    raw: false,
  });
}

const FEISHU_SUPPLIER_BASE_URL = "https://mcn24onb5t1o.feishu.cn/base/RLy7bndc4aCXhtsx4yAcr2d8nSg?table=tbl0UhZRpR0niDSt&view=vew5Spjz7c";

function safeJsonParse(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeFeishuSupplierSource(value = {}) {
  const text = [
    value.url,
    value.tab_url,
    value.page,
    value.sourceUrl,
    value.source_url,
    value?.body?.sourceUrl,
    value?.body?.source_url,
  ].filter(Boolean).join(" ");
  if (/feishu\.cn\/base\/RLy7bndc4aCXhtsx4yAcr2d8nSg/i.test(text)) return true;
  if (/feishu\.cn/i.test(text) && /tbl0UhZRpR0niDSt|vew5Spjz7c/i.test(text)) return true;
  if (value?.body?.source === "feishu_supplier_table") return true;
  return false;
}

function collectFeishuFieldNameMap(root) {
  const map = new Map();
  const stack = [root];
  let steps = 0;
  const remember = (id, name) => {
    const key = optionalString(id);
    const label = optionalString(name);
    if (!key || !label) return;
    if (!/^fld|^field/i.test(key) && !/field/i.test(key)) return;
    map.set(key, label);
  };
  while (stack.length && steps < 30000) {
    steps += 1;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    remember(
      node.fieldId ?? node.field_id ?? node.fieldID ?? node.id ?? node.key,
      node.fieldName ?? node.field_name ?? node.name ?? node.title ?? node.label,
    );
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        if (/^fld|^field/i.test(key)) {
          remember(key, value.fieldName ?? value.field_name ?? value.name ?? value.title ?? value.label);
        }
        stack.push(value);
      }
    }
  }
  return map;
}

function normalizeFeishuRecordFields(fields = {}, fieldNameMap = new Map()) {
  const out = {};
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return out;
  for (const [key, value] of Object.entries(fields)) {
    const label = fieldNameMap.get(key) || key;
    out[label] = normalizeImportCell(value);
  }
  return out;
}

function knownSupplierHeaderScore(cells = []) {
  const aliases = Object.values(FEISHU_SUPPLIER_COLUMN_ALIASES)
    .flat()
    .map(normalizeImportHeader)
    .filter(Boolean);
  let score = 0;
  for (const cell of cells) {
    const normalized = normalizeImportHeader(cell);
    if (!normalized) continue;
    if (aliases.some((alias) => normalized === alias || (alias.length >= 3 && (normalized.includes(alias) || alias.includes(normalized))))) {
      score += 1;
    }
  }
  return score;
}

function visibleFeishuRowsToObjects(rows = []) {
  const snapshots = rows
    .map((row) => Array.isArray(row?.__visibleCells) ? row.__visibleCells.map(normalizeImportCell).filter(Boolean) : null)
    .filter((cells) => Array.isArray(cells) && cells.length >= 2);
  if (!snapshots.length) return [];
  const headerIndex = snapshots.findIndex((cells) => knownSupplierHeaderScore(cells) >= 2);
  if (headerIndex < 0) return [];
  const headers = snapshots[headerIndex];
  return snapshots.slice(headerIndex + 1).map((cells) => {
    const row = {};
    headers.forEach((header, index) => {
      if (header && cells[index] !== undefined) row[header] = cells[index];
    });
    return row;
  }).filter((row) => optionalString(importValueByAliases(row, FEISHU_SUPPLIER_COLUMN_ALIASES.name)));
}

function collectFeishuSupplierRowsFromRoot(root, fieldNameMap = new Map()) {
  const rows = [];
  const stack = [root];
  let steps = 0;
  const pushRow = (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    if (optionalString(importValueByAliases(row, FEISHU_SUPPLIER_COLUMN_ALIASES.name))) {
      rows.push(row);
    }
  };
  while (stack.length && steps < 50000) {
    steps += 1;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (Array.isArray(node.rows) && node.source === "feishu_supplier_table") {
      rows.push(...visibleFeishuRowsToObjects(node.rows));
      for (const row of node.rows) pushRow(row);
    }
    const fields = node.fields || node.fieldValues || node.field_values || node.values;
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      pushRow(normalizeFeishuRecordFields(fields, fieldNameMap));
    }
    pushRow(node);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return rows;
}

function dedupeFeishuSupplierRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const normalized = normalizeFeishuSupplierImportRow(row);
    const key = normalizeImportHeader(normalized.supplierCode || normalized.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function extractFeishuSupplierRowsFromExtensionPayload(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  const roots = [];
  for (const item of items) {
    if (!looksLikeFeishuSupplierSource(item)) continue;
    const body = item.body || safeJsonParse(item.bodyText) || {};
    roots.push(body);
  }
  const fieldNameMap = new Map();
  for (const root of roots) {
    for (const [key, value] of collectFeishuFieldNameMap(root)) fieldNameMap.set(key, value);
  }
  const rows = [];
  for (const root of roots) {
    rows.push(...collectFeishuSupplierRowsFromRoot(root, fieldNameMap));
  }
  return dedupeFeishuSupplierRows(rows);
}

function stableFeishuSupplierId(companyId, key) {
  const digest = crypto
    .createHash("sha1")
    .update(`${companyId || DEFAULT_COMPANY_ID}:${key}`)
    .digest("hex")
    .slice(0, 24);
  return `feishu:supplier:${digest}`;
}

function roundMoney(value) {
  const number = optionalNumber(value);
  if (number === null) return null;
  return Math.round(number * 100) / 100;
}

function splitOrderMoney(totalAmount, freightAmount, fallbackGoodsAmount = null) {
  const paidAmount = roundMoney(totalAmount);
  const freight = roundMoney(freightAmount) ?? 0;
  const fallbackGoods = roundMoney(fallbackGoodsAmount);
  if (paidAmount === null) {
    return {
      goodsAmount: fallbackGoods,
      paidAmount: fallbackGoods === null ? null : roundMoney(fallbackGoods + freight),
      freightAmount: freight,
    };
  }
  return {
    goodsAmount: roundMoney(Math.max(0, paidAmount - freight)),
    paidAmount,
    freightAmount: freight,
  };
}

function moneyOrZero(value) {
  return roundMoney(value) ?? 0;
}

function allocateMoneyByWeight(total, weights = []) {
  const amount = moneyOrZero(total);
  if (!weights.length || amount <= 0) return weights.map(() => 0);
  const normalizedWeights = weights.map((weight) => {
    const number = optionalNumber(weight);
    return number !== null && number > 0 ? number : 0;
  });
  const weightSum = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = weightSum > 0 ? normalizedWeights : weights.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : effectiveWeights.length;
  let allocated = 0;
  return effectiveWeights.map((weight, index) => {
    if (index === effectiveWeights.length - 1) return moneyOrZero(amount - allocated);
    const share = moneyOrZero((amount * weight) / effectiveSum);
    allocated = moneyOrZero(allocated + share);
    return share;
  });
}

function normalizePurchaseOrderLineItems(row = {}, rawItems = []) {
  const items = Array.isArray(rawItems) ? rawItems.filter((item) => item && typeof item === "object") : [];
  if (!items.length) return [];
  const normalized = items.map((item, index) => {
    const qty = optionalNumber(item.qty ?? item.quantity) ?? 0;
    const unitCost = optionalNumber(item.unitCost ?? item.unit_cost) ?? 0;
    const amount = moneyOrZero(optionalNumber(item.amount) ?? qty * unitCost);
    const logisticsFee = moneyOrZero(item.logisticsFee ?? item.logistics_fee);
    return {
      ...item,
      id: optionalString(item.id) || `${row.id || row.po_no || "po"}:line:${index}`,
      qty,
      unitCost,
      logisticsFee,
      amount,
      paidAmount: moneyOrZero(optionalNumber(item.paidAmount ?? item.paid_amount) ?? amount + logisticsFee),
    };
  });
  const lineFreightTotal = moneyOrZero(normalized.reduce((sum, item) => sum + moneyOrZero(item.logisticsFee), 0));
  if (lineFreightTotal > 0) return normalized;

  const explicitFreight = optionalNumber(row.freightAmount ?? row.freight_amount);
  const lineAmountTotal = moneyOrZero(normalized.reduce((sum, item) => sum + moneyOrZero(item.amount), 0));
  const paidAmount = optionalNumber(row.paidAmount ?? row.paid_amount);
  const inferredFreight = paidAmount !== null && paidAmount > lineAmountTotal
    ? moneyOrZero(paidAmount - lineAmountTotal)
    : 0;
  const freightToAllocate = explicitFreight !== null && explicitFreight > 0
    ? explicitFreight
    : inferredFreight;
  if (!freightToAllocate) return normalized;

  const weights = normalized.map((item) => moneyOrZero(item.amount) || optionalNumber(item.qty) || 0);
  const allocatedFreight = allocateMoneyByWeight(freightToAllocate, weights);
  return normalized.map((item, index) => {
    const logisticsFee = allocatedFreight[index] ?? 0;
    const amount = moneyOrZero(item.amount);
    return {
      ...item,
      logisticsFee,
      paidAmount: moneyOrZero(amount + logisticsFee),
    };
  });
}

function enrichPurchaseWorkbenchWithLocalLineItems(workbench = {}) {
  const purchaseOrders = Array.isArray(workbench.purchaseOrders) ? workbench.purchaseOrders : [];
  const missingLineOrders = purchaseOrders.filter((po) => !Array.isArray(po.lineItems) || po.lineItems.length === 0);
  if (!missingLineOrders.length || !hasExistingErpDatabase({ userDataDir: erpState.userDataDir })) return workbench;

  const keys = Array.from(new Set(missingLineOrders.flatMap((po) => [
    optionalString(po.id),
    optionalString(po.poNo || po.po_no),
    optionalString(po.externalOrderId || po.external_order_id),
  ]).filter(Boolean)));
  if (!keys.length) return workbench;

  let db = null;
  try {
    db = openErpDatabase({ userDataDir: erpState.userDataDir });
    const placeholders = keys.map(() => "?").join(",");
    const localOrders = db.prepare(`
      SELECT id, po_no, external_order_id, total_amount, freight_amount, paid_amount
      FROM erp_purchase_orders
      WHERE id IN (${placeholders})
        OR po_no IN (${placeholders})
        OR external_order_id IN (${placeholders})
    `).all(...keys, ...keys, ...keys);
    if (!localOrders.length) return workbench;

    const localIds = localOrders.map((row) => row.id).filter(Boolean);
    if (!localIds.length) return workbench;
    const linePlaceholders = localIds.map(() => "?").join(",");
    const localLines = db.prepare(`
      SELECT
        line.po_id,
        line.id,
        line.sku_id,
        sku.internal_sku_code,
        sku.product_name,
        sku.color_spec,
        COALESCE(line.qty, 0) AS qty,
        COALESCE(line.received_qty, 0) AS received_qty,
        COALESCE(line.unit_cost, 0) AS unit_cost,
        COALESCE(line.logistics_fee, 0) AS logistics_fee
      FROM erp_purchase_order_lines line
      LEFT JOIN erp_skus sku ON sku.id = line.sku_id
      WHERE line.po_id IN (${linePlaceholders})
      ORDER BY line.id ASC
    `).all(...localIds);

    const linesByPoId = new Map();
    for (const line of localLines) {
      const item = {
        id: optionalString(line.id),
        skuId: optionalString(line.sku_id),
        skuCode: optionalString(line.internal_sku_code),
        productName: optionalString(line.product_name),
        specText: optionalString(line.color_spec),
        qty: optionalNumber(line.qty) ?? 0,
        receivedQty: optionalNumber(line.received_qty) ?? 0,
        unitCost: optionalNumber(line.unit_cost) ?? 0,
        logisticsFee: optionalNumber(line.logistics_fee) ?? 0,
      };
      item.amount = moneyOrZero(item.qty * item.unitCost);
      item.paidAmount = moneyOrZero(item.amount + item.logisticsFee);
      const list = linesByPoId.get(line.po_id) || [];
      list.push(item);
      linesByPoId.set(line.po_id, list);
    }

    const orderByKey = new Map();
    for (const row of localOrders) {
      const local = toCamelRow(row);
      for (const key of [row.id, row.po_no, row.external_order_id]) {
        const normalizedKey = optionalString(key);
        if (normalizedKey) orderByKey.set(normalizedKey, local);
      }
    }

    return {
      ...workbench,
      purchaseOrders: purchaseOrders.map((po) => {
        if (Array.isArray(po.lineItems) && po.lineItems.length > 0) return po;
        const local = orderByKey.get(optionalString(po.id))
          || orderByKey.get(optionalString(po.poNo || po.po_no))
          || orderByKey.get(optionalString(po.externalOrderId || po.external_order_id));
        if (!local) return po;
        const lineItems = normalizePurchaseOrderLineItems(
          { ...po, ...local },
          linesByPoId.get(local.id) || [],
        );
        return lineItems.length ? { ...po, lineItems } : po;
      }),
    };
  } catch {
    return workbench;
  } finally {
    try { db?.close?.(); } catch {}
  }
}

function optionalPositiveInteger(value, fallback = null) {
  const number = optionalNumber(value);
  if (number === null) return fallback;
  const integer = Math.floor(number);
  return integer > 0 ? integer : fallback;
}

function normalizeCompanyId(value, actor = erpState.currentUser) {
  return optionalString(value) || optionalString(actor?.companyId || actor?.company_id) || DEFAULT_COMPANY_ID;
}

function companySettingId(companyId) {
  const id = normalizeCompanyId(companyId, null);
  return id === DEFAULT_COMPANY_ID ? ALIBABA_1688_AUTH_SETTING_ID : `company:${id}`;
}

function purchaseSettingsId(companyId) {
  return `purchase_settings:${normalizeCompanyId(companyId, null)}`;
}

function normalizeInquiryTemplate(value) {
  const text = optionalString(value);
  return (text || DEFAULT_PURCHASE_INQUIRY_TEMPLATE).slice(0, 2000);
}

function normalizeAlphaShopAccessKey(value) {
  const text = optionalString(value);
  return text ? text.slice(0, 256) : "";
}

function normalizeAlphaShopSecretKey(value) {
  const text = optionalString(value);
  return text ? text.slice(0, 512) : "";
}

function getPurchaseSettings(db, companyId) {
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const row = db.prepare(`
    SELECT *
    FROM erp_purchase_settings
    WHERE company_id = ?
    LIMIT 1
  `).get(normalizedCompanyId);
  const imageSearchSettings = getAlphaShopSettingsRow(db, normalizedCompanyId);
  const purchaseAccessKey = normalizeAlphaShopAccessKey(row?.alphashop_access_key);
  const purchaseSecretKey = normalizeAlphaShopSecretKey(row?.alphashop_secret_key);
  const imageSearchAccessKey = normalizeAlphaShopAccessKey(imageSearchSettings?.access_key);
  const imageSearchSecretKey = normalizeAlphaShopSecretKey(imageSearchSettings?.secret_key);
  const envAccessKey = normalizeAlphaShopAccessKey(
    process.env.ALPHASHOP_ACCESS_KEY || process.env.ERP_ALPHASHOP_ACCESS_KEY,
  );
  const envSecretKey = normalizeAlphaShopSecretKey(
    process.env.ALPHASHOP_SECRET_KEY || process.env.ERP_ALPHASHOP_SECRET_KEY,
  );
  const accessKey = purchaseAccessKey || imageSearchAccessKey || envAccessKey;
  const secretKey = purchaseSecretKey || imageSearchSecretKey || envSecretKey;
  return {
    id: row?.id || purchaseSettingsId(normalizedCompanyId),
    companyId: normalizedCompanyId,
    inquiryTemplate: normalizeInquiryTemplate(row?.inquiry_template),
    alphaShopAccessKey: accessKey,
    hasAlphaShopSecretKey: Boolean(secretKey),
    hasAlphaShopCredentials: Boolean(accessKey && secretKey),
    alphaShopCredentialSource: purchaseAccessKey && purchaseSecretKey
      ? "purchase_settings"
      : imageSearchAccessKey && imageSearchSecretKey
        ? "image_search"
        : envAccessKey && envSecretKey
          ? "environment"
          : "",
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

function savePurchaseSettingsAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "采购中心设置");
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const now = nowIso();
  const inquiryTemplate = normalizeInquiryTemplate(payload.inquiryTemplate || payload.inquiry_template);
  const existing = db.prepare(`
    SELECT alphashop_access_key, alphashop_secret_key
    FROM erp_purchase_settings
    WHERE company_id = ?
    LIMIT 1
  `).get(companyId);
  const hasAccessKeyPayload = Object.prototype.hasOwnProperty.call(payload, "alphaShopAccessKey")
    || Object.prototype.hasOwnProperty.call(payload, "alphashop_access_key");
  const hasSecretKeyPayload = Object.prototype.hasOwnProperty.call(payload, "alphaShopSecretKey")
    || Object.prototype.hasOwnProperty.call(payload, "alphashop_secret_key");
  const accessKey = hasAccessKeyPayload
    ? normalizeAlphaShopAccessKey(payload.alphaShopAccessKey || payload.alphashop_access_key)
    : normalizeAlphaShopAccessKey(existing?.alphashop_access_key);
  const submittedSecretKey = hasSecretKeyPayload
    ? normalizeAlphaShopSecretKey(payload.alphaShopSecretKey || payload.alphashop_secret_key)
    : "";
  const secretKey = submittedSecretKey || normalizeAlphaShopSecretKey(existing?.alphashop_secret_key);
  db.prepare(`
    INSERT INTO erp_purchase_settings (
      id, company_id, inquiry_template, alphashop_access_key, alphashop_secret_key, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @inquiry_template, @alphashop_access_key, @alphashop_secret_key, @created_at, @updated_at
    )
    ON CONFLICT(company_id) DO UPDATE SET
      inquiry_template = excluded.inquiry_template,
      alphashop_access_key = excluded.alphashop_access_key,
      alphashop_secret_key = excluded.alphashop_secret_key,
      updated_at = excluded.updated_at
  `).run({
    id: purchaseSettingsId(companyId),
    company_id: companyId,
    inquiry_template: inquiryTemplate,
    alphashop_access_key: accessKey,
    alphashop_secret_key: secretKey,
    created_at: now,
    updated_at: now,
  });
  return { purchaseSettings: getPurchaseSettings(db, companyId) };
}

function hashAccessCode(accessCode) {
  const code = String(accessCode || "");
  if (!code) return null;
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto
    .pbkdf2Sync(code, salt, ACCESS_CODE_ITERATIONS, ACCESS_CODE_KEY_LENGTH, ACCESS_CODE_DIGEST)
    .toString("base64url");
  return `pbkdf2_${ACCESS_CODE_DIGEST}$${ACCESS_CODE_ITERATIONS}$${salt}$${hash}`;
}

function verifyAccessCode(accessCode, storedHash) {
  const [scheme, iterationsText, salt, expectedHash] = String(storedHash || "").split("$");
  if (scheme !== `pbkdf2_${ACCESS_CODE_DIGEST}` || !salt || !expectedHash) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = crypto
    .pbkdf2Sync(String(accessCode || ""), salt, iterations, ACCESS_CODE_KEY_LENGTH, ACCESS_CODE_DIGEST)
    .toString("base64url");
  const expectedBuffer = Buffer.from(expectedHash);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function toPublicUser(row) {
  const next = toCamelRow(row);
  next.hasAccessCode = Boolean(row.has_access_code ?? row.access_code_hash);
  next.companyId = next.companyId || row.company_id || DEFAULT_COMPANY_ID;
  next.companyName = next.companyName || row.company_name || "";
  next.companyCode = next.companyCode || row.company_code || "";
  delete next.accessCodeHash;
  return next;
}

function toSessionUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    companyId: row.company_id || row.companyId || DEFAULT_COMPANY_ID,
    companyName: row.company_name || row.companyName || DEFAULT_COMPANY_NAME,
    companyCode: row.company_code || row.companyCode || DEFAULT_COMPANY_CODE,
  };
}

function toCompany(row) {
  return toCamelRow(row);
}

function normalizeLimit(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(Math.floor(number), 10000));
}

function normalizeOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function hasExistingErpDatabase(options = {}) {
  try {
    return fs.existsSync(getErpDatabasePath(options));
  } catch {
    return false;
  }
}

function tableHasColumn(db, tableName, columnName) {
  if (!/^[a-z0-9_]+$/i.test(tableName)) return false;
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName);
}

function ensureRuntimeSchema(db, options = {}) {
  if (!db || (erpState.schemaRepairDone && !options.force)) return;
  if (!tableHasColumn(db, "erp_skus", "created_by")) {
    db.exec("ALTER TABLE erp_skus ADD COLUMN created_by TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_erp_skus_created_by ON erp_skus(created_by)");
  if (!tableHasColumn(db, "erp_skus", "sku_type")) {
    db.exec("ALTER TABLE erp_skus ADD COLUMN sku_type TEXT NOT NULL DEFAULT 'single'");
  }
  if (!tableHasColumn(db, "erp_skus", "bundle_cost_price")) {
    db.exec("ALTER TABLE erp_skus ADD COLUMN bundle_cost_price REAL");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS erp_sku_bundle_components (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'company_default',
      bundle_sku_id TEXT NOT NULL,
      component_sku_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      unit_cost REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bundle_sku_id, component_sku_id),
      FOREIGN KEY(company_id) REFERENCES erp_companies(id),
      FOREIGN KEY(bundle_sku_id) REFERENCES erp_skus(id),
      FOREIGN KEY(component_sku_id) REFERENCES erp_skus(id)
    );
    CREATE INDEX IF NOT EXISTS idx_erp_sku_bundle_components_bundle
      ON erp_sku_bundle_components(company_id, bundle_sku_id, status);
    CREATE INDEX IF NOT EXISTS idx_erp_sku_bundle_components_component
      ON erp_sku_bundle_components(company_id, component_sku_id, status);
  `);
  if (!tableHasColumn(db, "erp_purchase_requests", "spec_text")) {
    db.exec("ALTER TABLE erp_purchase_requests ADD COLUMN spec_text TEXT");
  }
  if (!tableHasColumn(db, "erp_sourcing_candidates", "inquiry_status")) {
    db.exec("ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_status TEXT");
  }
  if (!tableHasColumn(db, "erp_sourcing_candidates", "inquiry_message")) {
    db.exec("ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_message TEXT");
  }
  if (!tableHasColumn(db, "erp_sourcing_candidates", "inquiry_sent_at")) {
    db.exec("ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_sent_at TEXT");
  }
  if (!tableHasColumn(db, "erp_sourcing_candidates", "inquiry_result_json")) {
    db.exec("ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_result_json TEXT NOT NULL DEFAULT '{}'");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_erp_sourcing_inquiry_status ON erp_sourcing_candidates(pr_id, inquiry_status, inquiry_sent_at)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS erp_purchase_settings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'company_default',
      inquiry_template TEXT NOT NULL DEFAULT '',
      alphashop_access_key TEXT,
      alphashop_secret_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id)
    )
  `);
  if (!tableHasColumn(db, "erp_purchase_settings", "alphashop_access_key")) {
    db.exec("ALTER TABLE erp_purchase_settings ADD COLUMN alphashop_access_key TEXT");
  }
  if (!tableHasColumn(db, "erp_purchase_settings", "alphashop_secret_key")) {
    db.exec("ALTER TABLE erp_purchase_settings ADD COLUMN alphashop_secret_key TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_erp_purchase_settings_company ON erp_purchase_settings(company_id)");
  if (tableHasColumn(db, "erp_outbound_shipments", "id")) {
    if (!tableHasColumn(db, "erp_outbound_shipments", "temu_stock_order_no")) {
      db.exec("ALTER TABLE erp_outbound_shipments ADD COLUMN temu_stock_order_no TEXT");
    }
    if (!tableHasColumn(db, "erp_outbound_shipments", "temu_delivery_order_sn")) {
      db.exec("ALTER TABLE erp_outbound_shipments ADD COLUMN temu_delivery_order_sn TEXT");
    }
    if (!tableHasColumn(db, "erp_outbound_shipments", "temu_delivery_batch_sn")) {
      db.exec("ALTER TABLE erp_outbound_shipments ADD COLUMN temu_delivery_batch_sn TEXT");
    }
    if (!tableHasColumn(db, "erp_outbound_shipments", "temu_sync_status")) {
      db.exec("ALTER TABLE erp_outbound_shipments ADD COLUMN temu_sync_status TEXT");
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_erp_outbound_temu_stock_order
      ON erp_outbound_shipments(account_id, temu_stock_order_no)
    `);
  }
  erpState.schemaRepairDone = true;
}

function initializeHostErp(options = {}) {
  if (erpState.db) {
    return erpState.initResult;
  }

  let openedDb = null;
  try {
    openedDb = openErpDatabase(options);
    const initResult = runMigrations({
      ...options,
      db: openedDb,
    });
    ensureRuntimeSchema(openedDb, { force: true });
    erpState.db = openedDb;
    erpState.services = createErpServices(openedDb);
    erpState.initResult = initResult;
    erpState.initError = null;
    return initResult;
  } catch (error) {
    erpState.initError = error;
    erpState.initResult = null;
    if (openedDb) {
      try { openedDb.close(); } catch {}
    }
    erpState.db = null;
    erpState.services = null;
    erpState.schemaRepairDone = false;
    throw error;
  }
}

function initializeErp(options = {}) {
  erpState.userDataDir = options.userDataDir || erpState.userDataDir || null;
  if (typeof options.workerInvoker === "function") {
    erpState.workerInvoker = options.workerInvoker;
  }
  configureClientRuntime({ userDataDir: erpState.userDataDir });
  skuCache.configureSkuCache({ userDataDir: erpState.userDataDir });
  mappingCache.configureMappingCache({ userDataDir: erpState.userDataDir });

  const runtime = getRuntimeStatus();
  if (runtime.mode === "client") {
    erpState.initResult = {
      mode: "client",
      dbPath: null,
      backupPath: null,
      migrations: [],
      runtime,
    };
    erpState.initError = null;
    erpState.db = null;
    erpState.services = null;
    return erpState.initResult;
  }

  if (runtime.mode === "unset") {
    // Cloud desktop is the default. A leftover local sqlite file must not
    // silently switch a fresh/unknown runtime into host mode.
    setClientMode({ serverUrl: HK_SERVER_URL });
    erpState.initResult = {
      mode: "client",
      dbPath: null,
      backupPath: null,
      migrations: [],
      runtime: getRuntimeStatus(),
    };
    erpState.initError = null;
    erpState.db = null;
    erpState.services = null;
    return erpState.initResult;
  }

  return initializeHostErp(options);
}

function getErpStatus() {
  const runtime = getRuntimeStatus();
  return {
    initialized: Boolean(erpState.db),
    mode: runtime.mode,
    runtime,
    dbPath: erpState.initResult?.dbPath || erpState.db?.__erpDbPath || null,
    backupPath: erpState.initResult?.backupPath || null,
    migrations: erpState.initResult?.migrations || [],
    error: serializeError(erpState.initError),
  };
}

function requireErp() {
  if (!erpState.db || !erpState.services) {
    const error = erpState.initError;
    throw new Error(error ? `ERP database is not ready: ${error.message}` : "ERP database is not initialized");
  }
  ensureRuntimeSchema(erpState.db);
  return erpState;
}

function rerunMigrations() {
  const state = requireErp();
  const result = runMigrations({
    db: state.db,
  });
  ensureRuntimeSchema(state.db, { force: true });
  state.initResult = result;
  state.initError = null;
  return getErpStatus();
}

function getCompany(companyId = DEFAULT_COMPANY_ID) {
  const { db } = requireErp();
  const id = normalizeCompanyId(companyId, null);
  return toCompany(db.prepare("SELECT * FROM erp_companies WHERE id = ?").get(id));
}

function listCompanies(params = {}) {
  const { db } = requireErp();
  const rows = db.prepare(`
    SELECT *
    FROM erp_companies
    ORDER BY updated_at DESC, created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toCompany);
}

function upsertCompany(payload = {}) {
  const { db } = requireErp();
  const now = nowIso();
  const id = optionalString(payload.id) || createId("company");
  const status = optionalString(payload.status) || "active";
  if (!VALID_COMPANY_STATUSES.has(status)) throw new Error("Invalid company status");
  const row = {
    id,
    name: requireString(payload.name, "name"),
    code: optionalString(payload.code) || id,
    status,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO erp_companies (id, name, code, status, created_at, updated_at)
    VALUES (@id, @name, @code, @status, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      code = excluded.code,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(row);
  return getCompany(row.id);
}

function listAccounts(params = {}) {
  const { db } = requireErp();
  const companyId = optionalString(params.companyId || params.company_id);
  const includeDeleted = Boolean(params.includeDeleted || params.include_deleted);
  const includeJushuitanRawAccounts = Boolean(params.includeJushuitanRawAccounts || params.include_jushuitan_raw_accounts);
  const conditions = [];
  if (companyId) conditions.push("acct.company_id = @company_id");
  if (!includeDeleted) conditions.push("acct.status != 'deleted'");
  if (!includeJushuitanRawAccounts) {
    const hasJushuitanBrandAccounts = companyId
      ? db.prepare(`
        SELECT 1
        FROM erp_accounts
        WHERE source = 'jushuitan_brand'
          AND company_id = @company_id
        LIMIT 1
      `).get({ company_id: companyId })
      : db.prepare(`
        SELECT 1
        FROM erp_accounts
        WHERE source = 'jushuitan_brand'
        LIMIT 1
      `).get();
    if (hasJushuitanBrandAccounts) {
      conditions.push("acct.id != 'jst:account:default'");
      conditions.push("acct.id NOT LIKE 'jst:shop:%'");
    }
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      acct.*,
      addr.id AS alibaba_1688_address_id,
      addr.label AS alibaba_1688_address_label,
      addr.full_name AS alibaba_1688_full_name,
      addr.mobile AS alibaba_1688_mobile,
      addr.phone AS alibaba_1688_phone,
      addr.post_code AS alibaba_1688_post_code,
      addr.province_text AS alibaba_1688_province_text,
      addr.city_text AS alibaba_1688_city_text,
      addr.area_text AS alibaba_1688_area_text,
      addr.town_text AS alibaba_1688_town_text,
      addr.address AS alibaba_1688_address,
      addr.address_id AS alibaba_1688_address_remote_id,
      addr.is_default AS alibaba_1688_address_is_default
    FROM erp_accounts acct
    LEFT JOIN erp_1688_delivery_addresses addr
      ON addr.id = (
        SELECT latest_addr.id
        FROM erp_1688_delivery_addresses latest_addr
        WHERE latest_addr.company_id = acct.company_id
          AND latest_addr.account_id = acct.id
          AND latest_addr.status = 'active'
        ORDER BY
          CASE WHEN latest_addr.address_id IS NOT NULL AND latest_addr.address_id != '' THEN 0 ELSE 1 END,
          latest_addr.is_default DESC,
          latest_addr.updated_at DESC,
          latest_addr.created_at DESC
        LIMIT 1
      )
    ${whereClause}
    ORDER BY acct.updated_at DESC, acct.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    company_id: companyId,
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toCamelRow);
}

function upsertAccount(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const now = nowIso();
  const existing = optionalString(payload.id)
    ? db.prepare("SELECT id, company_id FROM erp_accounts WHERE id = ?").get(payload.id)
    : null;
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id || existing?.company_id, actor);
  const row = {
    id: optionalString(payload.id) || createId("acct"),
    company_id: companyId,
    name: requireString(payload.name, "name"),
    phone: optionalString(payload.phone),
    status: optionalString(payload.status) || "offline",
    source: optionalString(payload.source) || "manual",
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_accounts (id, company_id, name, phone, status, source, created_at, updated_at)
    VALUES (@id, @company_id, @name, @phone, @status, @source, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      phone = excluded.phone,
      status = excluded.status,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(row);

  return toCamelRow(db.prepare("SELECT * FROM erp_accounts WHERE id = ?").get(row.id));
}

function deleteAccount(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const accountId = requireString(payload.id || payload.accountId || payload.account_id, "accountId");
  const existing = db.prepare("SELECT id, company_id, status FROM erp_accounts WHERE id = ?").get(accountId);
  if (!existing) throw new Error("店铺不存在或已删除");
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id || existing.company_id, actor);
  if (normalizeCompanyId(existing.company_id, actor) !== companyId) {
    throw new Error("店铺不属于当前公司，不能删除");
  }
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE erp_accounts
      SET status = 'deleted',
          updated_at = ?
      WHERE id = ?
    `).run(now, accountId);
    db.prepare(`
      UPDATE erp_1688_delivery_addresses
      SET status = 'blocked',
          is_default = 0,
          updated_at = ?
      WHERE account_id = ?
    `).run(now, accountId);
  })();
  return {
    id: accountId,
    deleted: true,
  };
}

function listUsers(params = {}) {
  const { db } = requireErp();
  const companyId = optionalString(params.companyId || params.company_id);
  const whereCompany = companyId ? "WHERE user.company_id = @company_id" : "";
  const rows = db.prepare(`
    SELECT user.id, user.name, user.role, user.status, user.company_id,
           company.name AS company_name, company.code AS company_code,
           CASE WHEN user.access_code_hash IS NOT NULL AND user.access_code_hash != '' THEN 1 ELSE 0 END AS has_access_code,
           user.created_at, user.updated_at
    FROM erp_users user
    LEFT JOIN erp_companies company ON company.id = user.company_id
    ${whereCompany}
    ORDER BY user.updated_at DESC, user.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    company_id: companyId,
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toPublicUser);
}

function upsertUser(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const now = nowIso();
  const id = optionalString(payload.id) || createId("user");
  const role = requireString(payload.role, "role");
  const status = optionalString(payload.status) || "active";
  const accessCodeHash = hashAccessCode(payload.accessCode);
  if (!VALID_USER_ROLES.has(role)) {
    throw new Error("Invalid user role");
  }
  if (!VALID_USER_STATUSES.has(status)) {
    throw new Error("Invalid user status");
  }
  const existing = db.prepare("SELECT id, company_id FROM erp_users WHERE id = ?").get(id);
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id || existing?.company_id, actor);
  const company = db.prepare("SELECT id FROM erp_companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!company) throw new Error("Company is not active or does not exist");
  if (!existing && !accessCodeHash) {
    throw new Error("Access code is required for new users");
  }
  const row = {
    id,
    company_id: companyId,
    name: requireString(payload.name, "name"),
    role,
    status,
    access_code_hash: accessCodeHash,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_users (id, company_id, name, role, status, access_code_hash, created_at, updated_at)
    VALUES (@id, @company_id, @name, @role, @status, @access_code_hash, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      role = excluded.role,
      status = excluded.status,
      access_code_hash = COALESCE(excluded.access_code_hash, erp_users.access_code_hash),
      updated_at = excluded.updated_at
  `).run(row);

  return toPublicUser(db.prepare(`
    SELECT user.id, user.name, user.role, user.status, user.company_id,
           company.name AS company_name, company.code AS company_code,
           CASE WHEN user.access_code_hash IS NOT NULL AND user.access_code_hash != '' THEN 1 ELSE 0 END AS has_access_code,
           user.created_at, user.updated_at
    FROM erp_users user
    LEFT JOIN erp_companies company ON company.id = user.company_id
    WHERE user.id = ?
  `).get(row.id));
}

function upsertUserAndBroadcast(payload = {}, actor = {}) {
  const user = upsertUser(payload);
  broadcastUserUpdate(optionalString(payload.id) ? "update_user" : "create_user", payload, actor, user);
  try {
    syncLanUserSessions(user);
  } catch {}
  return user;
}

function validateLanSessionUser(userId) {
  const { db } = requireErp();
  const id = optionalString(userId);
  if (!id) return null;
  const row = db.prepare(`
    SELECT user.id, user.name, user.role, user.status, user.company_id,
           company.name AS company_name, company.code AS company_code
    FROM erp_users user
    LEFT JOIN erp_companies company ON company.id = user.company_id
    WHERE user.id = ?
    LIMIT 1
  `).get(id);
  if (!row || row.status !== "active") return null;
  return toSessionUser(row);
}

function verifyLanLogin(payload = {}) {
  const { db } = requireErp();
  const login = optionalString(payload.login);
  const accessCode = optionalString(payload.accessCode);
  const companyId = optionalString(payload.companyId || payload.company_id);
  const companyCode = optionalString(payload.companyCode || payload.company_code);
  if (!login || !accessCode) {
    return null;
  }

  const row = db.prepare(`
    SELECT user.id, user.name, user.role, user.status, user.access_code_hash,
           user.company_id, company.name AS company_name, company.code AS company_code
    FROM erp_users user
    LEFT JOIN erp_companies company ON company.id = user.company_id
    WHERE (user.id = @login OR user.name = @login)
      AND (@company_id IS NULL OR user.company_id = @company_id)
      AND (@company_code IS NULL OR company.code = @company_code)
    ORDER BY CASE WHEN user.company_id = @default_company_id THEN 0 ELSE 1 END,
             user.created_at ASC
    LIMIT 1
  `).get({
    login,
    company_id: companyId,
    company_code: companyCode,
    default_company_id: DEFAULT_COMPANY_ID,
  });

  if (!row || row.status !== "active" || !row.access_code_hash) {
    return null;
  }
  if (!verifyAccessCode(accessCode, row.access_code_hash)) {
    return null;
  }
  return toSessionUser(row);
}

function hashLanSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function timestampToIso(value) {
  const time = Number(value);
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString();
}

function parseSessionTime(value, fallback = Date.now()) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : fallback;
}

function normalizeStoredSessionUser(user) {
  const sessionUser = toSessionUser(user);
  if (!sessionUser?.id) return null;
  return sessionUser;
}

function createLanSessionStore() {
  const { db } = requireErp();
  const save = (token, session = {}) => {
    const user = normalizeStoredSessionUser(session.user);
    if (!token || !user) return null;
    const now = nowIso();
    const row = {
      token_hash: hashLanSessionToken(token),
      user_id: user.id,
      user_json: JSON.stringify(user),
      created_at: timestampToIso(session.createdAt),
      expires_at: timestampToIso(session.expiresAt),
      updated_at: now,
    };
    db.prepare(`
      INSERT INTO erp_lan_sessions (
        token_hash, user_id, user_json, created_at, expires_at, updated_at
      )
      VALUES (
        @token_hash, @user_id, @user_json, @created_at, @expires_at, @updated_at
      )
      ON CONFLICT(token_hash) DO UPDATE SET
        user_id = excluded.user_id,
        user_json = excluded.user_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(row);
    return row;
  };

  return {
    save,
    load(token) {
      const tokenHash = hashLanSessionToken(token);
      const row = db.prepare(`
        SELECT *
        FROM erp_lan_sessions
        WHERE token_hash = ?
        LIMIT 1
      `).get(tokenHash);
      if (!row) return null;
      const expiresAt = parseSessionTime(row.expires_at, 0);
      if (expiresAt <= Date.now()) {
        db.prepare("DELETE FROM erp_lan_sessions WHERE token_hash = ?").run(tokenHash);
        return null;
      }
      let user = null;
      try {
        user = JSON.parse(row.user_json || "null");
      } catch {
        user = null;
      }
      user = normalizeStoredSessionUser(user);
      if (!user) {
        db.prepare("DELETE FROM erp_lan_sessions WHERE token_hash = ?").run(tokenHash);
        return null;
      }
      return {
        token,
        user,
        createdAt: parseSessionTime(row.created_at),
        expiresAt,
      };
    },
    touch(token, session = {}) {
      const user = normalizeStoredSessionUser(session.user);
      if (!token || !user) return null;
      const result = db.prepare(`
        UPDATE erp_lan_sessions
        SET user_id = @user_id,
            user_json = @user_json,
            expires_at = @expires_at,
            updated_at = @updated_at
        WHERE token_hash = @token_hash
      `).run({
        token_hash: hashLanSessionToken(token),
        user_id: user.id,
        user_json: JSON.stringify(user),
        expires_at: timestampToIso(session.expiresAt),
        updated_at: nowIso(),
      });
      if (result.changes === 0) return save(token, session);
      return result;
    },
    destroy(token) {
      if (!token) return null;
      return db.prepare("DELETE FROM erp_lan_sessions WHERE token_hash = ?").run(hashLanSessionToken(token));
    },
    cleanupExpired(now = Date.now()) {
      return db.prepare("DELETE FROM erp_lan_sessions WHERE expires_at <= ?").run(timestampToIso(now));
    },
    syncUser(user = {}) {
      const nextUser = normalizeStoredSessionUser(user);
      const userId = optionalString(user.id || nextUser?.id);
      if (!userId) return null;
      if (!nextUser || nextUser.status !== "active") {
        return db.prepare("DELETE FROM erp_lan_sessions WHERE user_id = ?").run(userId);
      }
      return db.prepare(`
        UPDATE erp_lan_sessions
        SET user_json = @user_json,
            updated_at = @updated_at
        WHERE user_id = @user_id
      `).run({
        user_id: userId,
        user_json: JSON.stringify(nextUser),
        updated_at: nowIso(),
      });
    },
  };
}

function listRolePermissions(params = {}) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(params.companyId || params.company_id, erpState.currentUser);
  const role = optionalString(params.role);
  const whereRole = role ? "AND role = @role" : "";
  return db.prepare(`
    SELECT *
    FROM erp_role_permissions
    WHERE company_id = @company_id
    ${whereRole}
    ORDER BY role ASC, resource_type ASC, resource_key ASC
  `).all({
    company_id: companyId,
    role,
  }).map((row) => {
    const next = toCamelRow(row);
    next.conditions = parseJsonObject(row.conditions_json);
    return next;
  });
}

function upsertRolePermission(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const role = requireString(payload.role, "role");
  const resourceType = requireString(payload.resourceType || payload.resource_type, "resourceType");
  const resourceKey = requireString(payload.resourceKey || payload.resource_key, "resourceKey");
  const accessLevel = optionalString(payload.accessLevel || payload.access_level) || "allow";
  if (!VALID_USER_ROLES.has(role)) throw new Error("Invalid user role");
  if (!VALID_PERMISSION_RESOURCE_TYPES.has(resourceType)) throw new Error("Invalid permission resource type");
  if (!VALID_ACCESS_LEVELS.has(accessLevel)) throw new Error("Invalid access level");
  const now = nowIso();
  const row = {
    id: optionalString(payload.id) || createId("perm"),
    company_id: companyId,
    role,
    resource_type: resourceType,
    resource_key: resourceKey,
    access_level: accessLevel,
    conditions_json: JSON.stringify(payload.conditions || payload.conditions_json || {}),
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO erp_role_permissions (
      id, company_id, role, resource_type, resource_key, access_level,
      conditions_json, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @role, @resource_type, @resource_key, @access_level,
      @conditions_json, @created_at, @updated_at
    )
    ON CONFLICT(company_id, role, resource_type, resource_key) DO UPDATE SET
      access_level = excluded.access_level,
      conditions_json = excluded.conditions_json,
      updated_at = excluded.updated_at
  `).run(row);
  return listRolePermissions({ companyId, role }).find((item) => (
    item.resourceType === resourceType && item.resourceKey === resourceKey
  ));
}

function listUserResourceScopes(params = {}) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(params.companyId || params.company_id, erpState.currentUser);
  const userId = optionalString(params.userId || params.user_id);
  const whereUser = userId ? "AND scope.user_id = @user_id" : "";
  return db.prepare(`
    SELECT scope.*, user.name AS user_name
    FROM erp_user_resource_scopes scope
    LEFT JOIN erp_users user ON user.id = scope.user_id
    WHERE scope.company_id = @company_id
    ${whereUser}
    ORDER BY scope.user_id ASC, scope.resource_type ASC, scope.resource_id ASC
  `).all({
    company_id: companyId,
    user_id: userId,
  }).map(toCamelRow);
}

function upsertUserResourceScope(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const userId = requireString(payload.userId || payload.user_id, "userId");
  const resourceType = requireString(payload.resourceType || payload.resource_type, "resourceType");
  const resourceId = requireString(payload.resourceId || payload.resource_id, "resourceId");
  const accessLevel = optionalString(payload.accessLevel || payload.access_level) || "manage";
  if (!VALID_RESOURCE_SCOPE_TYPES.has(resourceType)) throw new Error("Invalid resource scope type");
  if (!VALID_ACCESS_LEVELS.has(accessLevel)) throw new Error("Invalid access level");
  const user = db.prepare("SELECT id FROM erp_users WHERE id = ? AND company_id = ?").get(userId, companyId);
  if (!user) throw new Error("Scoped user does not exist in this company");
  const now = nowIso();
  const row = {
    id: optionalString(payload.id) || createId("scope"),
    company_id: companyId,
    user_id: userId,
    resource_type: resourceType,
    resource_id: resourceId,
    access_level: accessLevel,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO erp_user_resource_scopes (
      id, company_id, user_id, resource_type, resource_id, access_level,
      created_at, updated_at
    )
    VALUES (
      @id, @company_id, @user_id, @resource_type, @resource_id, @access_level,
      @created_at, @updated_at
    )
    ON CONFLICT(company_id, user_id, resource_type, resource_id) DO UPDATE SET
      access_level = excluded.access_level,
      updated_at = excluded.updated_at
  `).run(row);
  return listUserResourceScopes({ companyId, userId }).find((item) => (
    item.resourceType === resourceType && item.resourceId === resourceId
  ));
}

function getPermissionProfile(user = erpState.currentUser) {
  const sessionUser = user?.id ? validateLanSessionUser(user.id) : toSessionUser(user);
  const companyId = normalizeCompanyId(sessionUser?.companyId, null);
  return {
    company: getCompany(companyId),
    user: sessionUser,
    rolePermissions: listRolePermissions({
      companyId,
      role: sessionUser?.role,
    }),
    resourceScopes: sessionUser?.id
      ? listUserResourceScopes({ companyId, userId: sessionUser.id })
      : [],
  };
}

function get1688AuthRow(companyId = erpState.currentUser?.companyId || DEFAULT_COMPANY_ID) {
  const { db } = requireErp();
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  return db.prepare(`
    SELECT *
    FROM erp_1688_auth_settings
    WHERE company_id = @company_id
    ORDER BY CASE WHEN id = @default_id THEN 0 ELSE 1 END
    LIMIT 1
  `).get({
    company_id: normalizedCompanyId,
    default_id: companySettingId(normalizedCompanyId),
  }) || null;
}

function to1688AuthStatus(row = get1688AuthRow()) {
  return {
    id: row?.id || "",
    purchase1688AccountId: row?.id || "",
    configured: Boolean(row?.app_key && row?.app_secret && row?.redirect_uri),
    authorized: Boolean(row?.access_token),
    companyId: row?.company_id || DEFAULT_COMPANY_ID,
    appKey: row?.app_key || "",
    redirectUri: row?.redirect_uri || "",
    hasAppSecret: Boolean(row?.app_secret),
    memberId: row?.member_id || "",
    aliId: row?.ali_id || "",
    resourceOwner: row?.resource_owner || "",
    authorizedAt: row?.authorized_at || "",
    accessTokenExpiresAt: row?.access_token_expires_at || "",
    refreshTokenExpiresAt: row?.refresh_token_expires_at || "",
    label: row?.label || "",
    status: row?.status || "",
    updatedAt: row?.updated_at || "",
  };
}

function get1688AuthStatus(actor = erpState.currentUser) {
  requireErp();
  return to1688AuthStatus(get1688AuthRow(normalizeCompanyId(actor?.companyId || actor?.company_id, null)));
}

// === Multi 1688 采购账号支持（v0.2.8+，参 docs/plans/2026-05-06-multi-1688-purchase-accounts.md）===

function to1688PurchaseAccountRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id || DEFAULT_COMPANY_ID,
    label: row.label || row.member_id || row.ali_id || row.app_key || "",
    appKey: row.app_key || "",
    hasAppSecret: Boolean(row.app_secret),
    redirectUri: row.redirect_uri || "",
    memberId: row.member_id || "",
    aliId: row.ali_id || "",
    resourceOwner: row.resource_owner || "",
    status: row.status === "disabled" ? "disabled" : "active",
    configured: Boolean(row.app_key && row.app_secret && row.redirect_uri),
    authorized: Boolean(row.access_token),
    accessTokenExpiresAt: row.access_token_expires_at || "",
    refreshTokenExpiresAt: row.refresh_token_expires_at || "",
    authorizedAt: row.authorized_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function list1688PurchaseAccounts(companyId) {
  const { db } = requireErp();
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const rows = db.prepare(`
    SELECT *
    FROM erp_1688_auth_settings
    WHERE company_id = @company_id
    ORDER BY status = 'active' DESC, updated_at DESC, created_at DESC
  `).all({ company_id: normalizedCompanyId });
  return { accounts: rows.map(to1688PurchaseAccountRow).filter(Boolean) };
}

function get1688PurchaseAccountByIdScoped(db, id, companyId) {
  if (!id) return null;
  return db.prepare(`
    SELECT * FROM erp_1688_auth_settings
    WHERE id = @id AND company_id = @company_id
  `).get({ id, company_id: normalizeCompanyId(companyId, null) }) || null;
}

function delete1688PurchaseAccount({ id, companyId }, actor) {
  assertActorRole(actor, ["admin", "manager"], "1688 采购账号删除");
  const { db } = requireErp();
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const targetId = requireString(id, "id");
  const row = get1688PurchaseAccountByIdScoped(db, targetId, normalizedCompanyId);
  if (!row) throw new Error("1688 purchase account not found");
  // 拦截：被任意 Temu 店铺当作默认时拒绝
  const occupants = db.prepare(`
    SELECT id, name FROM erp_accounts
    WHERE default_1688_purchase_account_id = @id
    LIMIT 50
  `).all({ id: targetId });
  if (occupants.length) {
    const error = new Error(
      `1688 采购账号被以下店铺设为默认，无法删除：${occupants.map((a) => a.name || a.id).join("、")}。请先到「店铺」改默认账号或清空默认。`,
    );
    error.code = "PURCHASE_ACCOUNT_IN_USE";
    error.occupants = occupants;
    throw error;
  }
  db.prepare("DELETE FROM erp_1688_auth_settings WHERE id = @id AND company_id = @company_id").run({
    id: targetId,
    company_id: normalizedCompanyId,
  });
  return { ok: true, id: targetId };
}

function update1688PurchaseAccount({ id, companyId, label, status }, actor) {
  assertActorRole(actor, ["admin", "manager"], "1688 采购账号更新");
  const { db } = requireErp();
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const targetId = requireString(id, "id");
  const row = get1688PurchaseAccountByIdScoped(db, targetId, normalizedCompanyId);
  if (!row) throw new Error("1688 purchase account not found");
  const nextLabel = label === undefined ? row.label : (optionalString(label) || "");
  const allowedStatus = status === "disabled" || status === "active" ? status : null;
  const nextStatus = allowedStatus || row.status || "active";
  db.prepare(`
    UPDATE erp_1688_auth_settings
    SET label = @label, status = @status, updated_at = @updated_at
    WHERE id = @id AND company_id = @company_id
  `).run({
    id: targetId,
    company_id: normalizedCompanyId,
    label: nextLabel,
    status: nextStatus,
    updated_at: nowIso(),
  });
  return {
    ok: true,
    id: targetId,
    account: to1688PurchaseAccountRow(get1688PurchaseAccountByIdScoped(db, targetId, normalizedCompanyId)),
  };
}

function setAccount1688DefaultPurchase({ accountId, default1688AccountId, companyId }, actor) {
  assertActorRole(actor, ["admin", "manager"], "Temu 店铺默认 1688 采购账号设置");
  const { db } = requireErp();
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const acctId = requireString(accountId, "accountId");
  const erpAcct = db.prepare("SELECT id, company_id FROM erp_accounts WHERE id = ?").get(acctId);
  if (!erpAcct) throw new Error(`Temu account not found: ${acctId}`);
  if (normalizeCompanyId(erpAcct.company_id, null) !== normalizedCompanyId) {
    throw new Error("Temu account does not belong to this company");
  }
  const default1688 = optionalString(default1688AccountId) || null;
  if (default1688) {
    const purchaseRow = get1688PurchaseAccountByIdScoped(db, default1688, normalizedCompanyId);
    if (!purchaseRow) throw new Error("1688 purchase account not found");
  }
  db.prepare(`
    UPDATE erp_accounts
    SET default_1688_purchase_account_id = @default_1688_purchase_account_id, updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: acctId,
    default_1688_purchase_account_id: default1688,
    updated_at: nowIso(),
  });
  return { ok: true, accountId: acctId, default1688AccountId: default1688 };
}

function requireHttpUrl(value, fieldName) {
  const text = requireString(value, fieldName);
  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${fieldName} must start with http:// or https://`);
  }
  return parsed.toString();
}

function cleanupExpired1688OAuthStates() {
  const { db } = requireErp();
  db.prepare("DELETE FROM erp_1688_oauth_states WHERE expires_at <= ?").run(nowIso());
}

function parse1688OAuthTargetId(redirectAfter) {
  const raw = optionalString(redirectAfter);
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "http://127.0.0.1");
    return optionalString(parsed.searchParams.get("purchase1688AccountId")
      || parsed.searchParams.get("purchase_1688_account_id"));
  } catch {
    return null;
  }
}

function parseAbsoluteTokenTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/);
  if (compact) {
    const [, year, month, day, hour, minute, second, zoneHour, zoneMinute] = compact;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${zoneHour}:${zoneMinute}`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const compactNoZone = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compactNoZone) {
    const [, year, month, day, hour, minute, second] = compactNoZone;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    if (numeric > 100000000000) {
      const date = new Date(numeric);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (numeric > 1000000000) {
      const date = new Date(numeric * 1000);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function computeTokenExpiryIso(payload = {}, durationKeys = [], absoluteKeys = []) {
  for (const key of absoluteKeys) {
    const value = parseAbsoluteTokenTime(payload[key]);
    if (value) return value;
  }

  for (const key of durationKeys) {
    const value = optionalNumber(payload[key]);
    if (!value) continue;
    const date = new Date(Date.now() + value * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

function build1688TokenUrl(appKey) {
  const configuredUrl = optionalString(process.env.ERP_1688_TOKEN_URL);
  if (configuredUrl) return configuredUrl;
  const configuredBase = optionalString(process.env.ERP_1688_TOKEN_URL_BASE) || ALIBABA_1688_TOKEN_URL_BASE;
  return `${configuredBase.replace(/\/+$/, "")}/${encodeURIComponent(appKey)}`;
}

function build1688AuthorizeUrl() {
  return optionalString(process.env.ERP_1688_AUTHORIZE_URL) || ALIBABA_1688_AUTHORIZE_URL;
}

async function postFormJson(url, params) {
  if (typeof fetch !== "function") {
    throw new Error("Current Node runtime does not provide fetch");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`1688 token response is not JSON: ${text.slice(0, 200)}`);
  }
  const errorText = payload.error_description
    || payload.errorMessage
    || payload.error_message
    || payload.message
    || payload.error;
  if (!response.ok || payload.error || payload.error_code || payload.errorCode) {
    throw new Error(errorText || `1688 token request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function exchange1688AuthorizationCode({ appKey, appSecret, redirectUri, code }) {
  return postFormJson(build1688TokenUrl(appKey), {
    grant_type: "authorization_code",
    need_refresh_token: "true",
    client_id: appKey,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
}

async function exchange1688RefreshToken({ appKey, appSecret, refreshToken }) {
  return postFormJson(build1688TokenUrl(appKey), {
    grant_type: "refresh_token",
    client_id: appKey,
    client_secret: appSecret,
    refresh_token: refreshToken,
  });
}

function extract1688TokenFields(payload = {}, existing = {}) {
  const accessToken = optionalString(payload.access_token || payload.accessToken);
  const refreshToken = optionalString(payload.refresh_token || payload.refreshToken) || existing.refresh_token || null;
  return {
    access_token: accessToken || existing.access_token || null,
    refresh_token: refreshToken,
    member_id: optionalString(payload.memberId || payload.member_id || payload.memberID) || existing.member_id || null,
    ali_id: optionalString(payload.aliId || payload.ali_id || payload.aliID) || existing.ali_id || null,
    resource_owner: optionalString(payload.resource_owner || payload.resourceOwner) || existing.resource_owner || null,
    token_payload_json: JSON.stringify(payload || {}),
    access_token_expires_at: computeTokenExpiryIso(
      payload,
      ["expires_in", "expiresIn", "expires_in_seconds", "access_token_timeout"],
      ["expires_at", "expiresAt", "expires_time", "accessTokenExpiresAt"],
    ) || existing.access_token_expires_at || null,
    refresh_token_expires_at: computeTokenExpiryIso(
      payload,
      ["refresh_token_timeout", "refreshTokenTimeout", "refresh_expires_in", "refreshExpiresIn"],
      ["refresh_token_timeout", "refreshTokenTimeout", "refresh_token_expires_at", "refreshTokenExpiresAt", "refresh_token_expires_time"],
    ) || existing.refresh_token_expires_at || null,
  };
}

function upsert1688AuthConfig(payload = {}, actor = {}) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  // mode=new: 总是创建新行；mode=update + purchase1688AccountId: 定位指定行；
  // 默认行为兼容老逻辑：在 company 第一行（companySettingId）上 upsert
  const mode = optionalString(payload.mode);
  const targetId = optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id || payload.id);
  let existing = null;
  if (mode === "new") {
    existing = null;
  } else if (targetId) {
    existing = get1688AuthRowById(targetId, companyId);
    if (!existing) throw new Error(`1688 purchase account not found: ${targetId}`);
  } else {
    existing = get1688AuthRow(companyId);
  }
  const appKey = optionalString(payload.appKey) || optionalString(payload.app_key) || existing?.app_key;
  const appSecretInput = optionalString(payload.appSecret) || optionalString(payload.app_secret);
  const appSecret = appSecretInput || existing?.app_secret;
  const redirectUri = optionalString(payload.redirectUri) || optionalString(payload.redirect_uri) || existing?.redirect_uri;
  if (!appKey) throw new Error("1688 AppKey is required");
  if (!appSecret) throw new Error("1688 AppSecret is required");
  const normalizedRedirectUri = requireHttpUrl(redirectUri, "1688 redirect URI");
  const credentialsChanged = !existing
    || appKey !== existing.app_key
    || Boolean(appSecretInput && appSecretInput !== existing.app_secret)
    || normalizedRedirectUri !== existing.redirect_uri;
  const now = nowIso();
  const labelInput = optionalString(payload.label);
  const statusInput = payload.status === "disabled" ? "disabled" : (payload.status === "active" ? "active" : null);
  const row = {
    id: existing?.id || (mode === "new" ? createId("1688_auth") : companySettingId(companyId)),
    company_id: companyId,
    app_key: appKey,
    app_secret: appSecret,
    redirect_uri: normalizedRedirectUri,
    access_token: credentialsChanged ? null : existing.access_token,
    refresh_token: credentialsChanged ? null : existing.refresh_token,
    member_id: credentialsChanged ? null : existing.member_id,
    ali_id: credentialsChanged ? null : existing.ali_id,
    resource_owner: credentialsChanged ? null : existing.resource_owner,
    token_payload_json: credentialsChanged ? "{}" : existing.token_payload_json,
    access_token_expires_at: credentialsChanged ? null : existing.access_token_expires_at,
    refresh_token_expires_at: credentialsChanged ? null : existing.refresh_token_expires_at,
    authorized_at: credentialsChanged ? null : existing.authorized_at,
    label: labelInput !== null && labelInput !== undefined ? labelInput : (existing?.label || ""),
    status: statusInput || existing?.status || "active",
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_1688_auth_settings (
      id, company_id, app_key, app_secret, redirect_uri, access_token, refresh_token,
      member_id, ali_id, resource_owner, token_payload_json,
      access_token_expires_at, refresh_token_expires_at, authorized_at,
      label, status,
      created_at, updated_at
    )
    VALUES (
      @id, @company_id, @app_key, @app_secret, @redirect_uri, @access_token, @refresh_token,
      @member_id, @ali_id, @resource_owner, @token_payload_json,
      @access_token_expires_at, @refresh_token_expires_at, @authorized_at,
      @label, @status,
      @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      app_key = excluded.app_key,
      app_secret = excluded.app_secret,
      redirect_uri = excluded.redirect_uri,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      member_id = excluded.member_id,
      ali_id = excluded.ali_id,
      resource_owner = excluded.resource_owner,
      token_payload_json = excluded.token_payload_json,
      access_token_expires_at = excluded.access_token_expires_at,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      authorized_at = excluded.authorized_at,
      label = excluded.label,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(row);

  return to1688AuthStatus(db.prepare("SELECT * FROM erp_1688_auth_settings WHERE id = ?").get(row.id));
}

function save1688ManualToken(payload = {}, actor = {}) {
  const { db } = requireErp();
  const hasCredentialInput = payload.appKey || payload.app_key || payload.appSecret || payload.app_secret || payload.redirectUri || payload.redirect_uri;
  if (hasCredentialInput) {
    // 透传 mode/purchase1688AccountId/label，让 upsert 知道是新建还是更新
    upsert1688AuthConfig(payload, actor);
  }
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const targetId = optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id || payload.id);
  const setting = targetId
    ? get1688AuthRowById(targetId, companyId)
    : get1688AuthRow(companyId);
  if (!setting?.app_key || !setting?.app_secret) {
    throw new Error("请先保存 1688 AppKey 和 AppSecret");
  }
  const accessToken = requireString(payload.accessToken || payload.access_token || payload.token, "accessToken");
  const refreshToken = optionalString(payload.refreshToken || payload.refresh_token) || setting.refresh_token || null;
  const accessTokenExpiresAt = parseAbsoluteTokenTime(
    payload.accessTokenExpiresAt || payload.access_token_expires_at || payload.expiresAt || payload.expires_at,
  );
  const refreshTokenExpiresAt = parseAbsoluteTokenTime(
    payload.refreshTokenExpiresAt || payload.refresh_token_expires_at || payload.refreshExpiresAt || payload.refresh_expires_at,
  ) || setting.refresh_token_expires_at || null;
  const now = nowIso();
  db.prepare(`
    UPDATE erp_1688_auth_settings
    SET access_token = @access_token,
        refresh_token = @refresh_token,
        member_id = @member_id,
        ali_id = @ali_id,
        resource_owner = @resource_owner,
        token_payload_json = @token_payload_json,
        access_token_expires_at = @access_token_expires_at,
        refresh_token_expires_at = @refresh_token_expires_at,
        authorized_at = @authorized_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: setting.id,
    access_token: accessToken,
    refresh_token: refreshToken,
    member_id: optionalString(payload.memberId || payload.member_id || payload.memberName || payload.member_name) || setting.member_id || null,
    ali_id: optionalString(payload.aliId || payload.ali_id) || setting.ali_id || null,
    resource_owner: optionalString(payload.resourceOwner || payload.resource_owner) || setting.resource_owner || null,
    token_payload_json: JSON.stringify({
      source: "manual",
      savedAt: now,
      hasRefreshToken: Boolean(refreshToken),
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    }),
    access_token_expires_at: accessTokenExpiresAt,
    refresh_token_expires_at: refreshTokenExpiresAt,
    authorized_at: now,
    updated_at: now,
  });
  return to1688AuthStatus(get1688AuthRowById(setting.id, companyId) || get1688AuthRow(companyId));
}

function create1688AuthorizeUrl(payload = {}, actor = {}) {
  let savedStatus = null;
  if (payload.appKey || payload.app_key || payload.appSecret || payload.app_secret || payload.redirectUri || payload.redirect_uri) {
    savedStatus = upsert1688AuthConfig(payload, actor);
  }
  const { db } = requireErp();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const targetId = optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id || payload.id)
    || optionalString(savedStatus?.purchase1688AccountId || savedStatus?.id);
  const setting = targetId
    ? get1688AuthRowById(targetId, companyId)
    : get1688AuthRow(companyId);
  if (targetId && !setting) {
    throw new Error(`1688 purchase account not found: ${targetId}`);
  }
  if (setting?.status === "disabled") {
    throw new Error("1688 purchase account is disabled");
  }
  if (!setting?.app_key || !setting?.app_secret || !setting?.redirect_uri) {
    throw new Error("Save 1688 AppKey, AppSecret and redirect URI first");
  }
  cleanupExpired1688OAuthStates();
  const state = crypto.randomBytes(18).toString("base64url");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ALIBABA_1688_OAUTH_STATE_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO erp_1688_oauth_states (state, company_id, created_by, redirect_after, expires_at, created_at)
    VALUES (@state, @company_id, @created_by, @redirect_after, @expires_at, @created_at)
  `).run({
    state,
    company_id: companyId,
    created_by: optionalString(actor?.id),
    redirect_after: `/1688?purchase1688AccountId=${encodeURIComponent(setting.id)}`,
    expires_at: expiresAt,
    created_at: now,
  });
  const params = new URLSearchParams({
    client_id: setting.app_key,
    site: "1688",
    redirect_uri: setting.redirect_uri,
    response_type: "code",
    state,
  });
  return {
    authUrl: `${build1688AuthorizeUrl()}?${params.toString()}`,
    state,
    redirectUri: setting.redirect_uri,
    purchase1688AccountId: setting.id,
    expiresAt,
  };
}

async function complete1688OAuth(payload = {}) {
  const { db } = requireErp();
  const code = requireString(payload.code, "1688 authorization code");
  const state = requireString(payload.state, "1688 OAuth state");
  const stateRow = db.prepare("SELECT * FROM erp_1688_oauth_states WHERE state = ?").get(state);
  if (!stateRow) throw new Error("1688 authorization state has expired or is invalid");
  if (new Date(stateRow.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM erp_1688_oauth_states WHERE state = ?").run(state);
    throw new Error("1688 authorization state has expired");
  }
  const companyId = normalizeCompanyId(stateRow.company_id, null);
  const targetId = parse1688OAuthTargetId(stateRow.redirect_after);
  const setting = targetId
    ? get1688AuthRowById(targetId, companyId)
    : get1688AuthRow(companyId);
  if (!setting?.app_key || !setting?.app_secret || !setting?.redirect_uri) {
    throw new Error("1688 authorization config is missing");
  }
  if (setting.status === "disabled") {
    throw new Error("1688 purchase account is disabled");
  }
  const tokenPayload = await exchange1688AuthorizationCode({
    appKey: setting.app_key,
    appSecret: setting.app_secret,
    redirectUri: setting.redirect_uri,
    code,
  });
  const tokenFields = extract1688TokenFields(tokenPayload, setting);
  if (!tokenFields.access_token) {
    throw new Error("1688 did not return an access token");
  }
  const now = nowIso();
  db.prepare(`
    UPDATE erp_1688_auth_settings
    SET access_token = @access_token,
        refresh_token = @refresh_token,
        member_id = @member_id,
        ali_id = @ali_id,
        resource_owner = @resource_owner,
        token_payload_json = @token_payload_json,
        access_token_expires_at = @access_token_expires_at,
        refresh_token_expires_at = @refresh_token_expires_at,
        authorized_at = @authorized_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: setting.id,
    ...tokenFields,
    authorized_at: now,
    updated_at: now,
  });
  db.prepare("DELETE FROM erp_1688_oauth_states WHERE state = ?").run(state);
  return to1688AuthStatus(get1688AuthRowById(setting.id, companyId) || get1688AuthRow(companyId));
}

// 取指定 ID 的 1688 凭据行（限定 company）
function get1688AuthRowById(id, companyId) {
  if (!id) return null;
  const { db } = requireErp();
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  return db.prepare(`
    SELECT * FROM erp_1688_auth_settings
    WHERE id = @id AND company_id = @company_id
  `).get({ id, company_id: normalizedCompanyId }) || null;
}

// 推单/预览选 1688 凭据：显式 ID > Temu 店铺默认 > company 第一行兜底
function resolve1688AuthRowForPurchase({ companyId, purchase1688AccountId, accountId }) {
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  // 1) 显式指定优先
  if (purchase1688AccountId) {
    const row = get1688AuthRowById(purchase1688AccountId, normalizedCompanyId);
    if (!row) {
      throw new Error(`指定的 1688 采购账号不存在: ${purchase1688AccountId}`);
    }
    if (row.status === "disabled") {
      throw new Error(`指定的 1688 采购账号已被禁用: ${row.label || row.member_id || row.id}`);
    }
    return row;
  }
  // 2) Temu 店铺设置的默认
  if (accountId) {
    const { db } = requireErp();
    const erpAcct = db.prepare(`
      SELECT default_1688_purchase_account_id FROM erp_accounts WHERE id = ?
    `).get(accountId);
    const storeDefaultId = optionalString(erpAcct?.default_1688_purchase_account_id);
    if (storeDefaultId) {
      const row = get1688AuthRowById(storeDefaultId, normalizedCompanyId);
      if (row && row.status !== "disabled") return row;
      // 默认账号失效（被删/禁用）就静默回退到第一行
    }
  }
  // 3) Company 第一行兜底（保留 0.2.7 之前的行为）
  return get1688AuthRow(normalizedCompanyId);
}

async function refresh1688AccessToken(actor = {}, options = {}) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(actor?.companyId || actor?.company_id, null);
  const setting = options.purchase1688AccountId
    ? get1688AuthRowById(options.purchase1688AccountId, companyId)
    : get1688AuthRow(companyId);
  if (!setting?.app_key || !setting?.app_secret || !setting?.refresh_token) {
    throw new Error("1688 refresh token is not available; authorize again first");
  }
  const tokenPayload = await exchange1688RefreshToken({
    appKey: setting.app_key,
    appSecret: setting.app_secret,
    refreshToken: setting.refresh_token,
  });
  const tokenFields = extract1688TokenFields(tokenPayload, setting);
  if (!tokenFields.access_token) {
    throw new Error("1688 did not return an access token");
  }
  db.prepare(`
    UPDATE erp_1688_auth_settings
    SET access_token = @access_token,
        refresh_token = @refresh_token,
        member_id = @member_id,
        ali_id = @ali_id,
        resource_owner = @resource_owner,
        token_payload_json = @token_payload_json,
        access_token_expires_at = @access_token_expires_at,
        refresh_token_expires_at = @refresh_token_expires_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: setting.id,
    ...tokenFields,
    updated_at: nowIso(),
  });
  return to1688AuthStatus(get1688AuthRowById(setting.id, companyId) || get1688AuthRow(companyId));
}

function shouldRefresh1688AccessToken(row) {
  if (!row?.access_token || !row?.refresh_token || !row?.access_token_expires_at) return false;
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 5 * 60 * 1000;
}

async function getReady1688Credentials(actor = {}, options = {}) {
  const companyId = normalizeCompanyId(actor?.companyId || actor?.company_id, null);
  let setting = resolve1688AuthRowForPurchase({
    companyId,
    purchase1688AccountId: options.purchase1688AccountId,
    accountId: options.accountId,
  });
  if (shouldRefresh1688AccessToken(setting)) {
    await refresh1688AccessToken(actor, { purchase1688AccountId: setting?.id });
    // 用同一个 ID 重新取，避免 fallback 到第一行
    setting = setting?.id
      ? get1688AuthRowById(setting.id, companyId)
      : get1688AuthRow(companyId);
  }
  if (!setting?.app_key || !setting?.app_secret) {
    throw new Error("1688 AppKey/AppSecret is not configured");
  }
  if (!setting?.access_token) {
    throw new Error("1688 access token is missing; authorize 1688 first");
  }
  return {
    appKey: setting.app_key,
    appSecret: setting.app_secret,
    accessToken: setting.access_token,
    purchase1688AccountId: setting.id,
    purchase1688AccountLabel: setting.label || setting.member_id || setting.app_key || "",
  };
}

function trimJsonForStorage(value, maxLength = 60000) {
  const text = JSON.stringify(value ?? {});
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

// 网络出参用：从 sourcePayload 里剥掉只对内部审计/兜底有用、UI 完全不读的「重」字段。
// 1688 web mtop 的 raw（aliTalk/marketOfferTag/trackInfoModel 等）单条就 14-21KB，
// 一个 PR 累积几百条候选时 workbench 会膨胀到 8MB+，结构化克隆 IPC 走得很慢。
// 客户端真正用的字段（originTitle / aiTitle / originImageUrl / detailUrl / soldOut / 营销
// 监控配置等）都在顶层，剥掉 raw / skuInfos / rawAlphaShopResponse 不影响显示。
const SLIM_SOURCE_PAYLOAD_DROP_KEYS = [
  "raw",
  "skuInfos",
  "rawResponse",
  "rawAlphaShopResponse",
  "rawAlphaShopProductDetail",
  "alphaShopRawResponse",
  "apiResponse",
  "mockResponse",
  "rawOfferDetail",
  "rawOfferResponse",
  "rawSearchResponse",
];
function slimSourcePayloadForUi(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  let needsCopy = false;
  for (const key of SLIM_SOURCE_PAYLOAD_DROP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) { needsCopy = true; break; }
  }
  if (!needsCopy) return parsed;
  const next = { ...parsed };
  for (const key of SLIM_SOURCE_PAYLOAD_DROP_KEYS) delete next[key];
  return next;
}

function redact1688Request(request = {}) {
  const params = { ...(request.params || {}) };
  if (params.access_token) params.access_token = "***";
  if (params._aop_signature) params._aop_signature = "***";
  if (params.uploadImageParam) params.uploadImageParam = "[image payload]";
  return {
    ...request,
    params,
  };
}

function write1688ApiCallLog(db, row = {}) {
  db.prepare(`
    INSERT INTO erp_1688_api_call_log (
      id, account_id, api_key, action, status, request_json, response_json,
      error_message, created_by, created_at
    )
    VALUES (
      @id, @account_id, @api_key, @action, @status, @request_json, @response_json,
      @error_message, @created_by, @created_at
    )
  `).run({
    id: createId("1688_call"),
    account_id: optionalString(row.accountId),
    api_key: requireString(row.apiKey, "apiKey"),
    action: optionalString(row.action),
    status: requireString(row.status, "status"),
    request_json: trimJsonForStorage(row.request || {}),
    response_json: trimJsonForStorage(row.response || {}),
    error_message: optionalString(row.errorMessage),
    created_by: optionalString(row.actor?.id),
    created_at: nowIso(),
  });
}

function pick1688MessageField(payload = {}, keys = []) {
  for (const key of keys) {
    const value = payload[key];
    if (value !== null && value !== undefined && value !== "") return String(value);
  }
  return null;
}

function normalize1688MessagePayload(input = {}) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const query = input.query && typeof input.query === "object" ? input.query : {};
  return {
    messageId: pick1688MessageField(payload, ["messageId", "message_id", "msgId", "msg_id", "id"]),
    topic: pick1688MessageField(payload, ["topic", "typeName", "messageType", "message_type", "event", "eventType"])
      || pick1688MessageField(query, ["topic", "typeName", "messageType", "event"]),
    messageType: pick1688MessageField(payload, ["messageType", "message_type", "type", "typeName", "eventType"])
      || pick1688MessageField(query, ["messageType", "type", "typeName", "eventType"]),
  };
}

function parseEmbeddedJson(value) {
  if (!value || typeof value !== "string") return null;
  const text = value.trim();
  if (!text || !/^[{[]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function expandMessageValue(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === "string") {
    const parsed = parseEmbeddedJson(value);
    return parsed ? expandMessageValue(parsed, depth + 1) : value;
  }
  if (Array.isArray(value)) return value.map((item) => expandMessageValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [key, expandMessageValue(next, depth + 1)]),
    );
  }
  return value;
}

function findFirstDeepValue(value, keys = [], depth = 0) {
  if (!value || depth > 8) return null;
  const keySet = new Set(keys.map((key) => String(key).toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstDeepValue(item, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, next] of Object.entries(value)) {
    if (keySet.has(String(key).toLowerCase()) && next !== null && next !== undefined && next !== "") {
      if (Array.isArray(next)) {
        const first = next.find((item) => item !== null && item !== undefined && item !== "");
        if (first !== undefined) return first;
      }
      return next;
    }
  }
  for (const next of Object.values(value)) {
    const found = findFirstDeepValue(next, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function normalizeMessageTopic(normalized = {}) {
  const topic = optionalString(normalized.topic || normalized.messageType);
  return topic ? topic.toUpperCase() : "";
}

function extract1688MessageRefs(input = {}, normalized = {}) {
  const expanded = expandMessageValue({
    query: input.query || {},
    payload: input.payload || {},
    bodyText: input.bodyText || "",
  });
  const orderId = findFirstDeepValue(expanded, [
    "orderId",
    "orderID",
    "order_id",
    "tradeId",
    "tradeID",
    "trade_id",
    "mainOrderId",
    "main_order_id",
    "bizId",
    "resourceId",
  ]);
  const refundId = findFirstDeepValue(expanded, [
    "refundId",
    "refundID",
    "refund_id",
    "orderRefundId",
    "disputeId",
  ]);
  const logisticsBillNo = findFirstDeepValue(expanded, [
    "logisticsBillNo",
    "logistics_bill_no",
    "mailNo",
    "mail_no",
    "trackingNo",
    "tracking_no",
  ]);
  const productId = findFirstDeepValue(expanded, [
    "offerId",
    "offerID",
    "productId",
    "productID",
    "product_id",
    "itemId",
    "itemID",
  ]);
  const skuId = findFirstDeepValue(expanded, [
    "skuId",
    "skuID",
    "sku_id",
    "cargoSkuId",
    "cargoSkuID",
  ]);
  const specId = findFirstDeepValue(expanded, [
    "specId",
    "specID",
    "spec_id",
    "cargoSpecId",
    "cargoSpecID",
  ]);
  return {
    topic: normalizeMessageTopic(normalized),
    externalOrderId: orderId ? String(orderId) : null,
    refundId: refundId ? String(refundId) : null,
    logisticsBillNo: logisticsBillNo ? String(logisticsBillNo) : null,
    productId: productId ? String(productId) : null,
    skuId: skuId ? String(skuId) : null,
    specId: specId ? String(specId) : null,
    expanded,
  };
}

function findPurchaseOrderByExternalOrderId(db, externalOrderId) {
  const orderId = optionalString(externalOrderId);
  if (!orderId) return null;
  return db.prepare(`
    SELECT *
    FROM erp_purchase_orders
    WHERE external_order_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(orderId) || null;
}

function build1688MessageEffect(topic = "") {
  const text = String(topic || "").toUpperCase();
  if (!text) return null;
  const normalized = text.replace(/[^A-Z0-9]+/g, "_");
  const hasTopic = (part) => text.includes(part) || normalized.includes(part);
  if (hasTopic("REFUND")) {
    return {
      externalOrderStatus: hasTopic("AFTER_SALES") ? "refund_after_sales" : "refund_in_sales",
      paymentStatus: "partial_refund",
      eventType: "1688_refund_message",
      message: "1688 退款售后消息已同步",
      refund: true,
    };
  }
  if (hasTopic("ORDER_PAY") || hasTopic("BATCH_PAY") || hasTopic("ORDER_STEP_PAY")) {
    return {
      externalOrderStatus: "paid",
      paymentStatus: "paid",
      poStatus: "paid",
      eventType: "1688_payment_message",
      message: "1688 付款消息已同步",
    };
  }
  if (hasTopic("ANNOUNCE_SENDGOODS") || hasTopic("PART_PART_SENDGOODS")) {
    return {
      externalOrderStatus: hasTopic("PART_PART") ? "partial_shipped" : "shipped",
      poStatus: "shipped",
      eventType: "1688_ship_message",
      message: "1688 发货消息已同步",
    };
  }
  if (hasTopic("LOGISTICS")) {
    return {
      externalOrderStatus: "logistics_updated",
      eventType: "1688_logistics_message",
      message: "1688 物流消息已同步",
    };
  }
  if (hasTopic("COMFIRM_RECEIVEGOODS") || hasTopic("CONFIRM_RECEIVEGOODS")) {
    return {
      externalOrderStatus: "received",
      eventType: "1688_receive_message",
      message: "1688 确认收货消息已同步",
    };
  }
  if (hasTopic("ORDER_SUCCESS")) {
    return {
      externalOrderStatus: "success",
      eventType: "1688_order_success_message",
      message: "1688 交易成功消息已同步",
    };
  }
  if (hasTopic("ORDER_PRICE_MODIFY")) {
    return {
      externalOrderStatus: "price_modified",
      eventType: "1688_price_message",
      message: "1688 改价消息已同步",
    };
  }
  if (hasTopic("MODIFY_MEMO")) {
    return {
      externalOrderStatus: "memo_modified",
      eventType: "1688_memo_message",
      message: "1688 备注修改消息已同步",
    };
  }
  if (hasTopic("ORDER_BUYER_CLOSE") || hasTopic("ORDER_SELLER_CLOSE") || hasTopic("ORDER_BOPS_CLOSE")) {
    return {
      externalOrderStatus: "closed",
      poStatus: "cancelled",
      eventType: "1688_close_message",
      message: "1688 关闭订单消息已同步",
    };
  }
  if (hasTopic("BUYER_MAKE")) {
    return {
      externalOrderStatus: "created",
      eventType: "1688_create_message",
      message: "1688 创建订单消息已同步",
    };
  }
  if (hasTopic("PRODUCT")) {
    let productStatus = "product_changed";
    if (hasTopic("DELETE")) productStatus = "product_deleted";
    else if (hasTopic("EXPIRE")) productStatus = "product_expired";
    else if (hasTopic("REPOST")) productStatus = "product_reposted";
    else if (hasTopic("INVENTORY")) productStatus = "inventory_changed";
    return {
      product: true,
      productStatus,
      eventType: "1688_product_message",
      message: "1688 商品消息已同步",
    };
  }
  if (hasTopic("AGENT_SUPPLY_CHANGE_RECOMMEND")) {
    return {
      agent: true,
      eventType: "1688_supply_agent_message",
      message: "1688 换供推荐消息已接收",
    };
  }
  return null;
}

function safeMessagePoStatus(currentStatus, nextStatus) {
  if (!nextStatus) return null;
  const current = optionalString(currentStatus);
  if (["closed", "cancelled", "inbounded"].includes(current)) return null;
  if (nextStatus === "paid" && ["shipped", "arrived"].includes(current)) return null;
  if (nextStatus === "shipped" && ["arrived"].includes(current)) return null;
  if (nextStatus === "cancelled" && ["paid", "supplier_processing", "shipped", "arrived"].includes(current)) return null;
  return nextStatus;
}

function updatePurchaseOrderFrom1688Message({ db, services, po, refs, effect, row }) {
  const before = po;
  const now = nowIso();
  const nextStatus = safeMessagePoStatus(before.status, effect.poStatus);
  const params = {
    id: before.id,
    status: nextStatus || before.status,
    payment_status: effect.paymentStatus || before.payment_status,
    external_order_status: effect.externalOrderStatus || before.external_order_status,
    external_order_payload_json: trimJsonForStorage({
      ...(parseJsonObject(before.external_order_payload_json) || {}),
      lastMessage: {
        messageId: row.message_id,
        topic: row.topic,
        messageType: row.message_type,
        refundId: refs.refundId,
        logisticsBillNo: refs.logisticsBillNo,
        receivedAt: row.received_at,
      },
    }),
    external_order_synced_at: now,
    updated_at: now,
  };
  db.prepare(`
    UPDATE erp_purchase_orders
    SET status = @status,
        payment_status = @payment_status,
        external_order_status = @external_order_status,
        external_order_payload_json = @external_order_payload_json,
        external_order_synced_at = @external_order_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run(params);
  const after = getPurchaseOrder(db, before.id);
  services.workflow.writeAudit({
    accountId: after.account_id || before.account_id,
    actor: { id: null, role: "system" },
    action: "process_1688_message",
    entityType: "purchase_order",
    entityId: before.id,
    before,
    after,
  });
  if (before.pr_id) {
    writePurchaseRequestEvent(db, getPurchaseRequest(db, before.pr_id), { role: "system" }, effect.eventType, effect.message);
  }
  return after;
}

function get1688MessageTopicDefinition(topic) {
  const normalizedTopic = optionalString(topic)?.toUpperCase();
  if (!normalizedTopic) return null;
  const found = ALIBABA_1688_MESSAGE_TOPICS.find((item) => item[1] === normalizedTopic);
  if (found) {
    return {
      category: found[0],
      topic: found[1],
      displayName: found[2],
    };
  }
  if (normalizedTopic.includes("PRODUCT")) return { category: "product", topic: normalizedTopic, displayName: normalizedTopic };
  if (normalizedTopic.includes("LOGISTICS")) return { category: "logistics", topic: normalizedTopic, displayName: normalizedTopic };
  if (normalizedTopic.includes("AGENT")) return { category: "agent", topic: normalizedTopic, displayName: normalizedTopic };
  return { category: "order", topic: normalizedTopic, displayName: normalizedTopic };
}

function get1688MessageCallbackUrl(payload = {}) {
  const explicit = optionalString(payload.callbackUrl || payload.callback_url);
  if (explicit) return explicit;
  const configured = optionalString(
    process.env.ERP_1688_MESSAGE_CALLBACK_URL
    || process.env.ERP_PUBLIC_1688_MESSAGE_CALLBACK_URL,
  );
  if (configured) return configured;
  const publicBase = optionalString(process.env.ERP_PUBLIC_URL || process.env.ERP_BASE_URL || process.env.PUBLIC_URL);
  if (publicBase) return `${publicBase.replace(/\/+$/, "")}/api/1688/message`;
  try {
    const status = getLanStatus();
    const base = optionalString(status.primaryUrl || status.localUrl);
    return base ? `${base.replace(/\/+$/, "")}/api/1688/message` : null;
  } catch {
    return null;
  }
}

function upsert1688MessageSubscriptions({ db, payload = {}, actor = {}, companyId: explicitCompanyId = null } = {}) {
  const now = nowIso();
  const companyId = normalizeCompanyId(explicitCompanyId || payload.companyId || payload.company_id, actor);
  const callbackUrl = get1688MessageCallbackUrl(payload);
  const requestedTopics = new Set(
    (Array.isArray(payload.topics) && payload.topics.length
      ? payload.topics
      : ALIBABA_1688_MESSAGE_TOPICS.map((item) => item[1]))
      .map((item) => optionalString(item)?.toUpperCase())
      .filter(Boolean),
  );
  const rows = [];
  for (const topic of requestedTopics) {
    const def = get1688MessageTopicDefinition(topic);
    const row = {
      id: createId("1688_sub"),
      company_id: companyId,
      topic: def.topic,
      category: def.category,
      display_name: def.displayName,
      status: optionalString(payload.status) || "enabled",
      callback_url: callbackUrl,
      created_by: optionalString(actor.id),
      created_at: now,
      updated_at: now,
    };
    db.prepare(`
      INSERT INTO erp_1688_message_subscriptions (
        id, company_id, topic, category, display_name, status, callback_url,
        created_by, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @topic, @category, @display_name, @status, @callback_url,
        @created_by, @created_at, @updated_at
      )
      ON CONFLICT(company_id, topic) DO UPDATE SET
        category = excluded.category,
        display_name = excluded.display_name,
        status = excluded.status,
        callback_url = COALESCE(excluded.callback_url, callback_url),
        updated_at = excluded.updated_at
    `).run(row);
    rows.push(db.prepare(`
      SELECT *
      FROM erp_1688_message_subscriptions
      WHERE company_id = ? AND topic = ?
    `).get(companyId, def.topic));
  }
  return {
    callbackUrl,
    count: rows.length,
    subscriptions: rows.map(toCamelRow),
    note: "Local subscriptions are ready. Configure the same callback URL in the 1688 open platform message console.",
  };
}

function ensureDefault1688MessageSubscriptions(db, params = {}) {
  return upsert1688MessageSubscriptions({
    db,
    payload: {
      callbackUrl: params.callbackUrl || params.callback_url,
      status: "enabled",
    },
    actor: params.actor || {},
    companyId: params.companyId || params.company_id,
  });
}

function configure1688MessageSubscriptionsAction({ db, payload = {}, actor = {} }) {
  assertActorRole(actor, ["manager", "admin"], "1688 message subscriptions");
  return upsert1688MessageSubscriptions({ db, payload, actor });
}

function list1688MessageSubscriptions(db, params = {}) {
  const companyId = normalizeCompanyId(params.companyId || params.company_id, erpState.currentUser);
  return db.prepare(`
    SELECT *
    FROM erp_1688_message_subscriptions
    WHERE company_id = @company_id
    ORDER BY category ASC, topic ASC
  `).all({ company_id: companyId }).map(toCamelRow);
}

function list1688MessageEvents(db, params = {}) {
  const limit = normalizeLimit(params.limit, 30);
  return db.prepare(`
    SELECT *
    FROM erp_1688_message_events
    ORDER BY received_at DESC
    LIMIT @limit
  `).all({ limit }).map((row) => {
    const next = toCamelRow(row);
    next.headers = parseJsonObject(row.headers_json);
    next.query = parseJsonObject(row.query_json);
    next.payload = parseJsonObject(row.payload_json);
    delete next.headersJson;
    delete next.queryJson;
    delete next.payloadJson;
    return next;
  });
}

function update1688MessageSubscriptionStats(db, row = {}, status = "received") {
  const def = get1688MessageTopicDefinition(row.topic || row.message_type);
  if (!def) return null;
  const now = nowIso();
  const companyId = DEFAULT_COMPANY_ID;
  const callbackUrl = get1688MessageCallbackUrl();
  db.prepare(`
    INSERT INTO erp_1688_message_subscriptions (
      id, company_id, topic, category, display_name, status, callback_url,
      last_message_event_id, last_received_at, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @topic, @category, @display_name, 'enabled', @callback_url,
      @last_message_event_id, @last_received_at, @created_at, @updated_at
    )
    ON CONFLICT(company_id, topic) DO UPDATE SET
      category = excluded.category,
      display_name = excluded.display_name,
      callback_url = COALESCE(excluded.callback_url, callback_url),
      last_message_event_id = excluded.last_message_event_id,
      last_received_at = excluded.last_received_at,
      processed_count = processed_count + @processed_delta,
      unmatched_count = unmatched_count + @unmatched_delta,
      ignored_count = ignored_count + @ignored_delta,
      error_count = error_count + @error_delta,
      updated_at = excluded.updated_at
  `).run({
    id: createId("1688_sub"),
    company_id: companyId,
    topic: def.topic,
    category: def.category,
    display_name: def.displayName,
    callback_url: callbackUrl,
    last_message_event_id: row.id,
    last_received_at: row.received_at || now,
    created_at: now,
    updated_at: now,
    processed_delta: status === "processed" ? 1 : 0,
    unmatched_delta: status === "unmatched" ? 1 : 0,
    ignored_delta: status === "ignored" ? 1 : 0,
    error_delta: status === "error" ? 1 : 0,
  });
  return db.prepare(`
    SELECT *
    FROM erp_1688_message_subscriptions
    WHERE company_id = ? AND topic = ?
  `).get(companyId, def.topic);
}

function process1688ProductMessageEvent({ db, services, refs, effect, row }) {
  const productId = optionalString(refs.productId);
  if (!productId) return { status: "unmatched", reason: "product_id_not_found", refs };
  const rows = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE external_offer_id = @external_offer_id
      AND (@external_sku_id IS NULL OR external_sku_id = @external_sku_id OR external_sku_id = '')
      AND (@external_spec_id IS NULL OR external_spec_id = @external_spec_id OR external_spec_id = '')
  `).all({
    external_offer_id: productId,
    external_sku_id: optionalString(refs.skuId),
    external_spec_id: optionalString(refs.specId),
  });
  if (!rows.length) return { status: "unmatched", reason: "sku_1688_source_not_found", refs };
  const now = nowIso();
  const nextStatus = ["product_deleted", "product_expired"].includes(effect.productStatus)
    ? "inactive"
    : (["product_reposted", "product_changed"].includes(effect.productStatus) ? "active" : null);
  for (const source of rows) {
    const before = source;
    const payload = {
      ...(parseJsonObject(source.source_payload_json) || {}),
      lastMessage: {
        messageId: row.message_id,
        topic: row.topic,
        productStatus: effect.productStatus,
        receivedAt: row.received_at,
        refs,
      },
    };
    db.prepare(`
      UPDATE erp_sku_1688_sources
      SET status = COALESCE(@status, status),
          source_payload_json = @source_payload_json,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: source.id,
      status: nextStatus,
      source_payload_json: trimJsonForStorage(payload),
      updated_at: now,
    });
    const after = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(source.id);
    services.workflow.writeAudit({
      accountId: source.account_id,
      actor: { id: null, role: "system" },
      action: "process_1688_product_message",
      entityType: "sku_1688_source",
      entityId: source.id,
      before,
      after,
    });
  }
  return {
    status: "processed",
    refs,
    productStatus: effect.productStatus,
    updatedCount: rows.length,
  };
}

function process1688AgentMessageEvent({ refs, effect }) {
  return {
    status: "processed",
    refs,
    agentStatus: effect.eventType,
  };
}

function process1688MessageEvent({ db, services, input, normalized, row }) {
  const refs = extract1688MessageRefs(input, normalized);
  const effect = build1688MessageEffect(refs.topic);
  if (!effect) {
    return { status: "ignored", reason: "unsupported_topic", refs };
  }
  if (effect.product) {
    return process1688ProductMessageEvent({ db, services, refs, effect, row });
  }
  if (effect.agent) {
    return process1688AgentMessageEvent({ refs, effect });
  }
  const po = findPurchaseOrderByExternalOrderId(db, refs.externalOrderId);
  if (!po) {
    return { status: "unmatched", reason: "purchase_order_not_found", refs };
  }
  const afterPo = updatePurchaseOrderFrom1688Message({ db, services, po, refs, effect, row });
  if (effect.refund || refs.refundId) {
    upsert1688RefundRow(db, {
      po: afterPo,
      refund: {
        refundId: refs.refundId,
        externalOrderId: refs.externalOrderId,
        status: effect.externalOrderStatus,
        raw: refs.expanded,
      },
      actor: { role: "system" },
    });
  }
  return {
    status: "processed",
    refs,
    purchaseOrder: toCamelRow(afterPo),
  };
}

function receive1688Message(input = {}) {
  const { db, services } = requireErp();
  const normalized = normalize1688MessagePayload(input);
  const row = {
    id: createId("1688_msg"),
    message_id: normalized.messageId,
    topic: normalized.topic,
    message_type: normalized.messageType,
    status: "received",
    source_ip: optionalString(input.sourceIp),
    headers_json: trimJsonForStorage(input.headers || {}),
    query_json: trimJsonForStorage(input.query || {}),
    payload_json: trimJsonForStorage(input.payload || {}),
    body_text: optionalString(input.bodyText),
    error_message: null,
    received_at: nowIso(),
    processed_at: null,
  };

  db.prepare(`
    INSERT INTO erp_1688_message_events (
      id, message_id, topic, message_type, status, source_ip, headers_json,
      query_json, payload_json, body_text, error_message, received_at, processed_at
    )
    VALUES (
      @id, @message_id, @topic, @message_type, @status, @source_ip, @headers_json,
      @query_json, @payload_json, @body_text, @error_message, @received_at, @processed_at
    )
  `).run(row);

  try {
    const processResult = process1688MessageEvent({ db, services, input, normalized, row });
    const status = processResult.status === "processed"
      ? "processed"
      : (processResult.status === "unmatched" ? "unmatched" : "ignored");
    db.prepare(`
      UPDATE erp_1688_message_events
      SET status = @status,
          error_message = @error_message,
          processed_at = @processed_at
      WHERE id = @id
    `).run({
      id: row.id,
      status,
      error_message: processResult.reason || null,
      processed_at: nowIso(),
    });
    update1688MessageSubscriptionStats(db, row, status);
    broadcastPurchaseUpdate("receive_1688_message", {}, { role: "system" }, processResult);
    return {
      ...toCamelRow({ ...row, status, processed_at: nowIso(), error_message: processResult.reason || null }),
      processResult,
    };
  } catch (error) {
    db.prepare(`
      UPDATE erp_1688_message_events
      SET status = 'error',
          error_message = @error_message,
          processed_at = @processed_at
      WHERE id = @id
    `).run({
      id: row.id,
      error_message: error?.message || String(error),
      processed_at: nowIso(),
    });
    update1688MessageSubscriptionStats(db, row, "error");
    broadcastPurchaseUpdate("receive_1688_message", {}, { role: "system" }, { status: "error" });
    return {
      ...toCamelRow({ ...row, status: "error", error_message: error?.message || String(error), processed_at: nowIso() }),
      processResult: { status: "error", error: error?.message || String(error) },
    };
  }
}

async function call1688ProcurementApi({ db, actor, accountId, action, api, params, purchase1688AccountId }) {
  const credentials = await getReady1688Credentials(actor, {
    purchase1688AccountId,
    accountId,
  });
  const gatewayBase = optionalString(process.env.ERP_1688_GATEWAY_BASE) || DEFAULT_1688_GATEWAY_BASE;
  try {
    const result = await call1688OpenApi({
      credentials,
      api,
      params,
      gatewayBase,
      protocol: optionalString(process.env.ERP_1688_GATEWAY_PROTOCOL) || undefined,
    });
    write1688ApiCallLog(db, {
      accountId,
      apiKey: api.key,
      action,
      status: "success",
      request: redact1688Request(result.request),
      response: result.response,
      actor,
    });
    return result.response;
  } catch (error) {
    write1688ApiCallLog(db, {
      accountId,
      apiKey: api.key,
      action,
      status: "failed",
      request: error?.request ? redact1688Request(error.request) : redact1688Request({ params }),
      response: error?.payload || error?.response || {},
      errorMessage: error?.message || String(error),
      actor,
    });
    throw normalize1688ProcurementError(error, api);
  }
}

function normalize1688ProcurementError(error, api = {}) {
  const message = String(error?.message || error || "");
  if (/AppKey is not allowed\(acl\)|not allowed\(acl\)/i.test(message)) {
    const apiName = [api.namespace, api.name].filter(Boolean).join(":") || api.key || "this 1688 API";
    const next = new Error(`当前 1688 AppKey 没有接口权限（${apiName}）。请在 1688 开放平台为这个应用开通对应 ACL 后重试。`);
    next.code = "1688_APP_ACL_DENIED";
    next.apiKey = api.key;
    next.cause = error;
    return next;
  }
  return error;
}

function build1688KeywordSearchParams(payload = {}, pr = {}, sku = {}) {
  const keyword = requireString(
    payload.keyword || sku.product_name || sku.internal_sku_code || pr.sku_id,
    "keyword",
  );
  const pageSize = Math.max(1, Math.min(Number(optionalNumber(payload.pageSize) ?? 10), 20));
  const beginPage = Math.max(1, Math.floor(Number(optionalNumber(payload.page) ?? 1)));
  const param = {
    keyword,
    beginPage,
    pageSize,
  };
  for (const key of ["priceStart", "priceEnd", "categoryId", "categoryIdList", "filter", "sort"]) {
    const value = optionalString(payload[key]);
    if (value) param[key] = value;
  }
  return {
    query: { keyword, beginPage, pageSize },
    apiParams: { param },
  };
}

function countUsers() {
  const { db } = requireErp();
  return Number(db.prepare("SELECT COUNT(*) AS count FROM erp_users").get().count || 0);
}

function loadExistingHostDatabaseForStatus() {
  if (!erpState.db && hasExistingErpDatabase({ userDataDir: erpState.userDataDir })) {
    if (isClientMode()) {
      setHostMode();
      erpState.currentUser = null;
    }
    initializeHostErp({ userDataDir: erpState.userDataDir });
  }
}

function getLocalAuthStatus() {
  loadExistingHostDatabaseForStatus();
  if (!erpState.db) {
    return {
      hasUsers: false,
      currentUser: null,
    };
  }
  return {
    hasUsers: countUsers() > 0,
    currentUser: erpState.currentUser,
  };
}

async function getAuthStatus() {
  if (process.env.TEMU_DESKTOP_REGRESSION_AUTH === "1") {
    const currentUser = {
      id: "user_desktop_regression_admin",
      name: "Desktop Regression Admin",
      role: "admin",
      companyId: DEFAULT_COMPANY_ID,
      companyName: DEFAULT_COMPANY_NAME,
      companyCode: DEFAULT_COMPANY_CODE,
    };
    erpState.currentUser = currentUser;
    return { hasUsers: true, currentUser };
  }
  if (!isClientMode()) {
    setClientMode({ serverUrl: HK_SERVER_URL });
  }
  const status = await remoteAuthStatus();
  erpState.currentUser = status.currentUser || null;
  return status;
}

function createBootstrapAdmin(payload = {}) {
  assertHostMode("首个管理员创建");
  if (!erpState.db) {
    setHostMode();
    initializeHostErp({ userDataDir: erpState.userDataDir });
  }
  if (countUsers() > 0) {
    throw new Error("Initial admin already exists");
  }
  if (payload.companyName || payload.companyCode) {
    upsertCompany({
      id: DEFAULT_COMPANY_ID,
      name: optionalString(payload.companyName) || DEFAULT_COMPANY_NAME,
      code: optionalString(payload.companyCode) || DEFAULT_COMPANY_CODE,
      status: "active",
    });
  }
  const user = upsertUser({
    companyId: DEFAULT_COMPANY_ID,
    name: requireString(payload.name, "name"),
    role: "admin",
    status: "active",
    accessCode: requireString(payload.accessCode, "accessCode"),
  });
  erpState.currentUser = toSessionUser(user);
  return getLocalAuthStatus();
}

function createFirstAdmin() {
  throw new Error("桌面端已移除本地管理员创建，请在 HK 云端用户管理中创建账号");
}

async function loginElectronUser(payload = {}) {
  if (process.env.TEMU_DESKTOP_REGRESSION_AUTH === "1") {
    return getAuthStatus();
  }
  const status = await remoteLogin({ ...payload, serverUrl: HK_SERVER_URL });
  erpState.currentUser = status.currentUser || null;
  // 登录后预热商品资料缓存（fire-and-forget）：用户进商品资料/采购页前缓存就开始建，
  // 进页时多半已就绪可秒开。失败静默，listSkusRuntime 仍会按需触发兜底。
  void skuCache.triggerSync({ mode: "incremental" }).catch(() => {});
  void skuCache.triggerReconcile().catch(() => {});
  return status;
}

async function logoutElectronUser() {
  if (process.env.TEMU_DESKTOP_REGRESSION_AUTH === "1") {
    return getAuthStatus();
  }
  if (!isClientMode()) {
    setClientMode({ serverUrl: HK_SERVER_URL });
  }
  const status = await remoteLogout();
  erpState.currentUser = null;
  return status;
}

function getClientRuntimeStatus() {
  return getRuntimeStatus({
    dbInitialized: Boolean(erpState.db),
  });
}

function switchToHostMode() {
  const config = setHostMode();
  erpState.currentUser = null;
  initializeHostErp({ userDataDir: erpState.userDataDir });
  return getRuntimeStatus({
    dbInitialized: Boolean(erpState.db),
    config,
  });
}

function switchToClientMode(payload = {}) {
  const config = setClientMode(payload);
  erpState.currentUser = null;
  return getRuntimeStatus({
    dbInitialized: Boolean(erpState.db),
    config,
  });
}

function getCurrentSessionActor(actorInput = {}) {
  if (erpState.currentUser) {
    return {
      id: erpState.currentUser.id,
      role: erpState.currentUser.role,
      companyId: erpState.currentUser.companyId,
    };
  }
  return normalizeActor(actorInput);
}

function assertRoleIfLoggedIn(allowedRoles) {
  if (!erpState.currentUser) return;
  if (!allowedRoles.includes(erpState.currentUser.role)) {
    throw new Error(`当前角色无权执行该操作：${erpState.currentUser.role}`);
  }
}

function scopeWorkItemParamsForUser(params = {}, user = erpState.currentUser) {
  if (!user || ["admin", "manager"].includes(user.role)) return params;
  return {
    ...params,
    ownerRole: user.role,
  };
}

function scopeWorkItemParams(params = {}) {
  return scopeWorkItemParamsForUser(params, erpState.currentUser);
}

function listSuppliers(params = {}) {
  const { db } = requireErp();
  const companyId = optionalString(params.companyId || params.company_id);
  const whereParts = ["supplier.id NOT LIKE 'jst:%'"];
  if (companyId) {
    whereParts.push("supplier.company_id = @company_id");
  }
  const whereSql = `WHERE ${whereParts.join(" AND ")}`;
  const rows = db.prepare(`
    SELECT
      supplier.*,
      (
        SELECT COUNT(*)
        FROM erp_skus sku
        WHERE sku.supplier_id = supplier.id
          AND sku.status != 'deleted'
      ) AS sku_count,
      (
        SELECT COUNT(DISTINCT source.sku_id)
        FROM erp_sku_1688_sources source
        JOIN erp_skus sku ON sku.id = source.sku_id
        WHERE sku.supplier_id = supplier.id
          AND sku.status != 'deleted'
          AND source.status = 'active'
      ) AS mapped_sku_count,
      (
        SELECT COUNT(*)
        FROM erp_purchase_orders po
        WHERE po.supplier_id = supplier.id
          AND po.status != 'cancelled'
      ) AS purchase_order_count,
      (
        SELECT COALESCE(SUM(COALESCE(po.paid_amount, po.total_amount, 0)), 0)
        FROM erp_purchase_orders po
        WHERE po.supplier_id = supplier.id
          AND po.status != 'cancelled'
      ) AS purchase_amount,
      (
        SELECT MAX(COALESCE(po.paid_at, po.updated_at, po.created_at))
        FROM erp_purchase_orders po
        WHERE po.supplier_id = supplier.id
          AND po.status != 'cancelled'
      ) AS last_purchase_at
    FROM erp_suppliers supplier
    ${whereSql}
    ORDER BY supplier.updated_at DESC, supplier.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    company_id: companyId,
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toSupplier);
}

function createSupplier(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const now = nowIso();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const row = {
    id: optionalString(payload.id) || createId("supplier"),
    company_id: companyId,
    supplier_code: optionalString(payload.supplierCode ?? payload.supplier_code ?? payload.code),
    name: requireString(payload.name, "name"),
    contact_name: optionalString(payload.contactName),
    phone: optionalString(payload.phone),
    wechat: optionalString(payload.wechat),
    address: optionalString(payload.address),
    categories_json: JSON.stringify(Array.isArray(payload.categories) ? payload.categories : []),
    supplier_level: optionalString(payload.supplierLevel ?? payload.supplier_level) || "standard",
    payment_terms: optionalString(payload.paymentTerms ?? payload.payment_terms),
    lead_days: optionalNumber(payload.leadDays ?? payload.lead_days),
    tax_rate: optionalNumber(payload.taxRate ?? payload.tax_rate),
    settlement_currency: optionalString(payload.settlementCurrency ?? payload.settlement_currency) || "CNY",
    remark: optionalString(payload.remark),
    status: optionalString(payload.status) || "active",
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_suppliers (
      id, company_id, supplier_code, name, contact_name, phone, wechat, address, categories_json,
      supplier_level, payment_terms, lead_days, tax_rate, settlement_currency, remark,
      status, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @supplier_code, @name, @contact_name, @phone, @wechat, @address,
      @categories_json, @supplier_level, @payment_terms, @lead_days, @tax_rate, @settlement_currency,
      @remark, @status, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      supplier_code = excluded.supplier_code,
      name = excluded.name,
      contact_name = excluded.contact_name,
      phone = excluded.phone,
      wechat = excluded.wechat,
      address = excluded.address,
      categories_json = excluded.categories_json,
      supplier_level = excluded.supplier_level,
      payment_terms = excluded.payment_terms,
      lead_days = excluded.lead_days,
      tax_rate = excluded.tax_rate,
      settlement_currency = excluded.settlement_currency,
      remark = excluded.remark,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(row);

  return toSupplier(db.prepare("SELECT * FROM erp_suppliers WHERE id = ?").get(row.id));
}

function listSkus(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId || params.account_id);
  const companyId = optionalString(params.companyId || params.company_id);
  const search = optionalString(params.search);
  const includeDeleted = Boolean(params.includeDeleted || params.include_deleted);
  // 增量同步游标：只返回 updated_at 严格晚于 since 的行。客户端 cache.db 用它
  // 增量拉变化。配合 includeDeleted:true 可拿到软删行（status='deleted'），让
  // 客户端把缓存里对应行清掉。不传 since 时行为不变，向后兼容老桌面端。
  const since = optionalString(params.since || params.updated_since);
  // 桌面端商品资料/采购单列表展示的是纯数字 id 的 SKU（ERP 原生）。
  // 聚水潭同步的 jst:skuprofile: 前缀那一份是底层副本，搜索时要排除掉，
  // 否则同一个 internal_sku_code 会同时出现两条记录。
  const excludeJst = Boolean(params.excludeJst || params.exclude_jst);
  const conditions = [];
  if (accountId) conditions.push("(sku.account_id = @account_id OR sku.account_id IS NULL)");
  if (companyId) conditions.push("sku.company_id = @company_id");
  if (!includeDeleted) conditions.push("sku.status != 'deleted'");
  if (excludeJst) conditions.push("sku.id NOT LIKE 'jst:skuprofile:%'");
  // 永久护栏：排除 jushuitanOperationalBridge.upsertSku 历史灌入的 jst:sku:<slug>: 污染行。
  // 合法 SKU 只有两种 id 形态：ERP 原生（前缀 sku_）和聚水潭权威导入（前缀 jst:skuprofile:）。
  // 此 LIKE 'jst:sku:%' 不会误伤 jst:skuprofile:（因为后者前 8 字符是 'jst:skup'，不等于 'jst:sku:'）。
  conditions.push("sku.id NOT LIKE 'jst:sku:%'");
  // 关键词模糊匹配：SKU 编码 / 内部 ID / 商品名
  if (search) conditions.push("(sku.internal_sku_code LIKE @search OR sku.id LIKE @search OR sku.product_name LIKE @search)");
  if (since) conditions.push("sku.updated_at > @since");
  // 未绑定：没有任何 active 1688 映射的 SKU（供应商管理「未绑定」Tab，host 模式）。
  const unmappedOnly = Boolean(params.unmappedOnly || params.unmapped_only);
  if (unmappedOnly) conditions.push("NOT EXISTS (SELECT 1 FROM erp_sku_1688_sources s2 WHERE s2.sku_id = sku.id AND s2.status != 'deleted')");
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      sku.*,
      acct.name AS account_name,
      supplier.name AS system_supplier_name,
      COALESCE(inv.actual_stock_qty, 0) AS actual_stock_qty,
      COALESCE(inv.costed_stock_qty, 0) AS costed_stock_qty,
      COALESCE(inv.missing_cost_stock_qty, 0) AS missing_cost_stock_qty,
      COALESCE(inv.stock_value, 0) AS stock_value,
      inv.location_codes AS warehouse_location,
      inv.weighted_unit_landed_cost AS weighted_stock_cost,
      COALESCE(bundle_meta.bundle_cost_price, sku.bundle_cost_price, CASE
        WHEN COALESCE(inv.actual_stock_qty, 0) > 0 THEN inv.weighted_unit_landed_cost
        ELSE source.unit_price
      END) AS cost_price,
      COALESCE(bundle_meta.component_count, 0) AS bundle_component_count,
      creator.name AS created_by_name,
      COALESCE(source_count.source_count, 0) AS procurement_source_count,
      source.id AS primary_1688_source_id,
      source.external_offer_id AS primary_1688_offer_id,
      source.external_sku_id AS primary_1688_sku_id,
      source.external_spec_id AS primary_1688_spec_id,
      source.supplier_name AS primary_1688_supplier_name,
      source.product_title AS primary_1688_product_title,
      source.unit_price AS primary_1688_unit_price,
      source.moq AS primary_1688_moq
    FROM erp_skus sku
    -- jst:account:default 是聚水潭导入的"无品牌兜底"，不是真店铺/品牌；
    -- 关联到它的 SKU 在 UI 应该跟 account_id IS NULL 一样显示为"-"，
    -- 所以这里 JOIN 时把它过滤掉，让 acct.name 落回 NULL，前端 fallback 到 "-"。
    LEFT JOIN erp_accounts acct ON acct.id = sku.account_id AND acct.id != 'jst:account:default'
    LEFT JOIN erp_suppliers supplier ON supplier.id = sku.supplier_id
    LEFT JOIN (
      SELECT account_id, sku_id, COUNT(*) AS source_count
      FROM erp_sku_1688_sources
      WHERE status = 'active'
      GROUP BY account_id, sku_id
    ) source_count ON source_count.account_id = sku.account_id AND source_count.sku_id = sku.id
    LEFT JOIN (
      SELECT
        sku_id,
        SUM(available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) AS actual_stock_qty,
        SUM(CASE
          WHEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) > 0
            AND COALESCE(unit_landed_cost, 0) > 0
          THEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
          ELSE 0
        END) AS costed_stock_qty,
        SUM(CASE
          WHEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) > 0
            AND COALESCE(unit_landed_cost, 0) <= 0
          THEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
          ELSE 0
        END) AS missing_cost_stock_qty,
        SUM(CASE
          WHEN COALESCE(unit_landed_cost, 0) > 0 THEN unit_landed_cost * (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
          ELSE 0
        END) AS stock_value,
        GROUP_CONCAT(DISTINCT CASE
          WHEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) > 0 THEN NULLIF(location_code, '')
          ELSE NULL
        END) AS location_codes,
        CASE
          WHEN SUM(CASE
            WHEN COALESCE(unit_landed_cost, 0) > 0 THEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
            ELSE 0
          END) > 0 THEN
            SUM(CASE
              WHEN COALESCE(unit_landed_cost, 0) > 0 THEN unit_landed_cost * (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
              ELSE 0
            END)
            / SUM(CASE
              WHEN COALESCE(unit_landed_cost, 0) > 0 THEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
              ELSE 0
            END)
          ELSE NULL
        END AS weighted_unit_landed_cost
      FROM erp_inventory_batches
      GROUP BY sku_id
    ) inv ON inv.sku_id = sku.id
    LEFT JOIN (
      SELECT
        bundle_sku_id,
        COUNT(*) AS component_count,
        SUM(COALESCE(unit_cost, 0) * qty) AS bundle_cost_price
      FROM erp_sku_bundle_components
      WHERE status = 'active'
      GROUP BY bundle_sku_id
    ) bundle_meta ON bundle_meta.bundle_sku_id = sku.id
    LEFT JOIN erp_sku_1688_sources source ON source.id = (
      SELECT id
      FROM erp_sku_1688_sources item
      WHERE item.account_id = sku.account_id
        AND item.sku_id = sku.id
        AND item.status = 'active'
      ORDER BY item.is_default DESC, item.updated_at DESC, item.created_at DESC
      LIMIT 1
    )
    LEFT JOIN erp_users creator ON creator.id = sku.created_by
    ${whereClause}
    ORDER BY sku.updated_at DESC, sku.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    account_id: accountId,
    company_id: companyId,
    ...(search ? { search: `%${search}%` } : {}),
    ...(since ? { since } : {}),
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });

  return rows.map(toSkuOptionRow);
}

function buildSkuCodePrefix(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function generateInternalSkuCode(db, companyId) {
  const prefix = buildSkuCodePrefix();
  const rows = db.prepare(`
    SELECT internal_sku_code
    FROM erp_skus
    WHERE company_id = @company_id
      AND internal_sku_code LIKE @code_like
    ORDER BY internal_sku_code DESC
    LIMIT 1000
  `).all({
    company_id: companyId,
    code_like: `${prefix}%`,
  });
  const usedCodes = new Set(rows.map((row) => row.internal_sku_code));
  let nextSequence = 1;
  for (const row of rows) {
    const suffix = String(row.internal_sku_code || "").slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      nextSequence = Math.max(nextSequence, Number(suffix) + 1);
    }
  }
  for (let offset = 0; offset < 2000; offset += 1) {
    const code = `${prefix}${String(nextSequence + offset).padStart(4, "0")}`;
    if (!usedCodes.has(code)) return code;
  }
  throw new Error("无法自动生成商品编码，请稍后重试");
}

function createSku(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const now = nowIso();
  const accountId = optionalString(payload.accountId || payload.account_id);
  const account = accountId
    ? db.prepare("SELECT id, company_id FROM erp_accounts WHERE id = ?").get(accountId)
    : null;
  if (accountId && !account) throw new Error("账号不存在");
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id || account?.company_id, actor);
  if (account && account.company_id !== companyId) {
    throw new Error("商品资料账号不属于当前公司");
  }
  const supplierId = optionalString(payload.supplierId);
  if (companyId && supplierId) {
    const supplier = db.prepare("SELECT id, company_id FROM erp_suppliers WHERE id = ?").get(supplierId);
    if (!supplier || supplier.company_id !== companyId) {
      throw new Error("商品资料供应商不属于当前公司");
    }
  }
  const existingId = optionalString(payload.id);
  const existingSku = existingId
    ? db.prepare("SELECT id, company_id, internal_sku_code FROM erp_skus WHERE id = ?").get(existingId)
    : null;
  if (existingSku && existingSku.company_id !== companyId) {
    throw new Error("商品资料不属于当前公司");
  }
  const internalSkuCode = optionalString(payload.internalSkuCode || payload.internal_sku_code)
    || optionalString(existingSku?.internal_sku_code)
    || generateInternalSkuCode(db, companyId);
  const duplicate = db.prepare(`
    SELECT id
    FROM erp_skus
    WHERE company_id = @company_id
      AND internal_sku_code = @internal_sku_code
      AND id != @id
    LIMIT 1
  `).get({
    company_id: companyId,
    internal_sku_code: internalSkuCode,
    id: optionalString(payload.id) || "",
  });
  if (duplicate) throw new Error(`商品编码已存在：${internalSkuCode}`);
  const row = {
    id: existingId || createId("sku"),
    company_id: companyId,
    account_id: accountId,
    internal_sku_code: internalSkuCode,
    temu_sku_id: optionalString(payload.temuSkuId),
    temu_product_id: optionalString(payload.temuProductId),
    temu_skc_id: optionalString(payload.temuSkcId),
    product_name: requireString(payload.productName, "productName"),
    color_spec: optionalString(payload.colorSpec || payload.color_spec || payload.category),
    category: optionalString(payload.category),
    image_url: optionalString(payload.imageUrl),
    supplier_id: supplierId,
    sku_type: optionalString(payload.skuType ?? payload.sku_type) || "single",
    bundle_cost_price: optionalNumber(payload.bundleCostPrice ?? payload.bundle_cost_price),
    status: optionalString(payload.status) || "active",
    created_by: optionalString(payload.createdBy || payload.created_by || actor?.id),
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_skus (
      id, company_id, account_id, internal_sku_code, temu_sku_id, temu_product_id,
      temu_skc_id, product_name, color_spec, category, image_url, supplier_id,
      sku_type, bundle_cost_price, status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @account_id, @internal_sku_code, @temu_sku_id, @temu_product_id,
      @temu_skc_id, @product_name, @color_spec, @category, @image_url, @supplier_id,
      @sku_type, @bundle_cost_price, @status, @created_by, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      internal_sku_code = excluded.internal_sku_code,
      product_name = excluded.product_name,
      color_spec = excluded.color_spec,
      category = excluded.category,
      image_url = COALESCE(excluded.image_url, erp_skus.image_url),
      supplier_id = excluded.supplier_id,
      sku_type = excluded.sku_type,
      bundle_cost_price = excluded.bundle_cost_price,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(row);

  return toCamelRow(db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(row.id));
}

function getSkuEffectiveCost(db, skuId) {
  const hasJstCost = tableHasColumn(db, "erp_skus", "jst_cost_price");
  const row = db.prepare(`
    SELECT
      sku.id,
      ${hasJstCost ? "sku.jst_cost_price" : "NULL"} AS jst_cost_price,
      COALESCE(CASE
        WHEN COALESCE(inv.actual_stock_qty, 0) > 0 THEN inv.weighted_unit_landed_cost
        ELSE source.unit_price
      END, sku.bundle_cost_price) AS cost_price
    FROM erp_skus sku
    LEFT JOIN (
      SELECT
        sku_id,
        SUM(available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) AS actual_stock_qty,
        CASE
          WHEN SUM(CASE
            WHEN COALESCE(unit_landed_cost, 0) > 0 THEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
            ELSE 0
          END) > 0 THEN
            SUM(CASE
              WHEN COALESCE(unit_landed_cost, 0) > 0 THEN unit_landed_cost * (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
              ELSE 0
            END)
            / SUM(CASE
              WHEN COALESCE(unit_landed_cost, 0) > 0 THEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
              ELSE 0
            END)
          ELSE NULL
        END AS weighted_unit_landed_cost
      FROM erp_inventory_batches
      GROUP BY sku_id
    ) inv ON inv.sku_id = sku.id
    LEFT JOIN erp_sku_1688_sources source ON source.id = (
      SELECT id
      FROM erp_sku_1688_sources item
      WHERE item.account_id = sku.account_id
        AND item.sku_id = sku.id
        AND item.status = 'active'
      ORDER BY item.is_default DESC, item.updated_at DESC, item.created_at DESC
      LIMIT 1
    )
    WHERE sku.id = ?
    LIMIT 1
  `).get(skuId);
  if (!row) return null;
  const cost = optionalNumber(row.cost_price);
  if (cost !== null) return cost;
  return optionalNumber(row.jst_cost_price);
}

function listSkuBundleComponents(params = {}) {
  const { db } = requireErp();
  const bundleSkuId = requireString(params.bundleSkuId || params.bundle_sku_id || params.skuId || params.sku_id, "bundleSkuId");
  const companyId = optionalString(params.companyId || params.company_id);
  const conditions = ["component.bundle_sku_id = @bundle_sku_id", "component.status = 'active'"];
  if (companyId) conditions.push("component.company_id = @company_id");
  const rows = db.prepare(`
    SELECT
      component.*,
      child.internal_sku_code AS component_sku_code,
      child.product_name AS component_product_name,
      child.color_spec AS component_color_spec,
      child.image_url AS component_image_url,
      child.status AS component_sku_status
    FROM erp_sku_bundle_components component
    LEFT JOIN erp_skus child ON child.id = component.component_sku_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY component.sort_order ASC, component.created_at ASC
  `).all({
    bundle_sku_id: bundleSkuId,
    company_id: companyId,
  });
  return rows.map((row) => ({
    ...toCamelRow(row),
    qty: Number(row.qty || 0),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
  }));
}

function saveSkuBundle(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const rawComponents = Array.isArray(payload.components) ? payload.components : [];
  if (rawComponents.length < 2) throw new Error("组合装至少选择 2 个普通商品");
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const seen = new Set();
  const components = rawComponents.map((item, index) => {
    const componentSkuId = requireString(item.skuId || item.sku_id || item.componentSkuId || item.component_sku_id, `components[${index}].skuId`);
    if (seen.has(componentSkuId)) throw new Error("组合装子商品不能重复");
    seen.add(componentSkuId);
    const qty = optionalNumber(item.qty ?? item.quantity);
    if (!qty || qty <= 0) throw new Error("组合装子商品数量必须大于 0");
    const sku = db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(componentSkuId);
    if (!sku || sku.status === "deleted") throw new Error(`子商品不存在：${componentSkuId}`);
    if (sku.company_id !== companyId) throw new Error(`子商品不属于当前公司：${sku.internal_sku_code || componentSkuId}`);
    if ((sku.sku_type || "single") === "bundle") throw new Error("组合装只能由普通商品组成，不能再套组合装");
    const unitCost = optionalNumber(item.unitCost ?? item.unit_cost) ?? getSkuEffectiveCost(db, componentSkuId);
    if (unitCost === null) throw new Error(`子商品缺成本价：${sku.internal_sku_code || componentSkuId}`);
    return {
      sku,
      componentSkuId,
      qty,
      unitCost,
      sortOrder: index,
    };
  });
  const bundleCostPrice = Number(components.reduce((sum, item) => sum + item.qty * item.unitCost, 0).toFixed(4));
  const now = nowIso();
  let savedSku = null;
  db.transaction(() => {
    savedSku = createSku({
      ...payload,
      companyId,
      skuType: "bundle",
      bundleCostPrice,
      status: optionalString(payload.status) || "active",
    }, actor);
    db.prepare("DELETE FROM erp_sku_bundle_components WHERE bundle_sku_id = ?").run(savedSku.id);
    const insertComponent = db.prepare(`
      INSERT INTO erp_sku_bundle_components (
        id, company_id, bundle_sku_id, component_sku_id, qty, unit_cost, sort_order,
        status, created_at, updated_at
      )
      VALUES (
        @id, @company_id, @bundle_sku_id, @component_sku_id, @qty, @unit_cost, @sort_order,
        'active', @created_at, @updated_at
      )
    `);
    for (const component of components) {
      insertComponent.run({
        id: createId("sku_bundle"),
        company_id: companyId,
        bundle_sku_id: savedSku.id,
        component_sku_id: component.componentSkuId,
        qty: component.qty,
        unit_cost: component.unitCost,
        sort_order: component.sortOrder,
        created_at: now,
        updated_at: now,
      });
    }
  })();
  return {
    sku: savedSku,
    components: listSkuBundleComponents({ bundleSkuId: savedSku.id, companyId }),
    bundleCostPrice,
  };
}

function getSkuReferenceCounts(db, skuId) {
  const references = [
    { table: "erp_purchase_requests", label: "采购需求" },
    { table: "erp_purchase_order_lines", label: "采购单明细" },
    { table: "erp_inbound_receipt_lines", label: "入库明细" },
    { table: "erp_inventory_batches", label: "库存批次" },
    { table: "erp_inventory_ledger_entries", label: "库存流水" },
    { table: "erp_qc_inspections", label: "QC 记录" },
    { table: "erp_outbound_shipments", label: "出库单" },
    { table: "erp_work_items", label: "工作事项" },
  ];
  return references
    .map((item) => ({
      ...item,
      count: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${item.table} WHERE sku_id = ?`).get(skuId)?.count || 0),
    }))
    .concat([
      {
        table: "erp_sku_bundle_components",
        label: "组合装组件",
        count: Number(db.prepare(`
          SELECT COUNT(*) AS count
          FROM erp_sku_bundle_components
          WHERE component_sku_id = ? AND status = 'active'
        `).get(skuId)?.count || 0),
      },
    ])
    .filter((item) => item.count > 0);
}

function deleteSku(payload = {}, actor = erpState.currentUser) {
  const { db } = requireErp();
  const skuId = requireString(payload.skuId || payload.id, "skuId");
  const sku = db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(skuId);
  if (!sku) throw new Error("商品资料不存在");

  const companyId = normalizeCompanyId(payload.companyId || payload.company_id || sku.company_id, actor);
  if (sku.company_id !== companyId) {
    throw new Error("商品资料不属于当前公司");
  }

  const references = getSkuReferenceCounts(db, skuId);
  if (references.length > 0) {
    const detail = references.map((item) => `${item.label}${item.count}条`).join("、");
    const now = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE erp_sku_1688_sources
        SET status = 'deleted',
            is_default = 0,
            updated_at = ?
        WHERE sku_id = ?
      `).run(now, skuId);
      db.prepare(`
        UPDATE erp_skus
        SET status = 'deleted',
            updated_at = ?
        WHERE id = ?
      `).run(now, skuId);
      db.prepare(`
        UPDATE erp_sku_bundle_components
        SET status = 'deleted',
            updated_at = ?
        WHERE bundle_sku_id = ?
      `).run(now, skuId);
    })();
    return {
      id: skuId,
      deleted: true,
      archived: true,
      referenceSummary: detail,
    };
  }

  db.transaction(() => {
    db.prepare("DELETE FROM erp_sku_1688_sources WHERE sku_id = ?").run(skuId);
    db.prepare("DELETE FROM erp_sku_bundle_components WHERE bundle_sku_id = ?").run(skuId);
    db.prepare("DELETE FROM erp_skus WHERE id = ?").run(skuId);
  })();

  return {
    id: skuId,
    deleted: true,
  };
}

function normalizeWarehouseLocationText(...values) {
  const parts = values
    .flatMap((value) => String(value || "").split(/[,，;；、|]/))
    .map((value) => value.trim())
    .filter((value) => value && value !== JUSHUITAN_WAREHOUSE_NAME);
  return Array.from(new Set(parts)).join("、");
}

function toSku1688Source(row) {
  if (!row) return null;
  const next = toCamelRow(row);
  next.isDefault = Boolean(row.is_default);
  next.ourQty = Number(row.our_qty || 1);
  next.platformQty = Number(row.platform_qty || 1);
  next.ratioText = `${next.ourQty}:${next.platformQty}`;
  next.sourcePayload = slimSourcePayloadForUi(parseJsonObject(row.source_payload_json));
  delete next.sourcePayloadJson;
  return next;
}

function toSkuOptionRow(row) {
  const next = toCamelRow(row);
  next.procurementSourceCount = Number(row.procurement_source_count || 0);
  next.actualStockQty = Number(row.actual_stock_qty || 0);
  next.costedStockQty = Number(row.costed_stock_qty || 0);
  next.missingCostStockQty = Number(row.missing_cost_stock_qty || 0);
  next.stockValue = Number(row.stock_value || 0);
  next.weightedStockCost = row.weighted_stock_cost === null || row.weighted_stock_cost === undefined ? null : Number(row.weighted_stock_cost);
  next.warehouseLocation = normalizeWarehouseLocationText(row.warehouse_location, row.jst_main_bin);
  next.costPrice = row.cost_price === null || row.cost_price === undefined ? null : Number(row.cost_price);
  next.bundleComponentCount = Number(row.bundle_component_count || 0);
  if (row.primary_1688_source_id) {
    next.primary1688Source = {
      id: row.primary_1688_source_id,
      externalOfferId: row.primary_1688_offer_id,
      externalSkuId: row.primary_1688_sku_id || "",
      externalSpecId: row.primary_1688_spec_id || "",
      supplierName: row.primary_1688_supplier_name || "",
      productTitle: row.primary_1688_product_title || "",
      unitPrice: row.primary_1688_unit_price,
      moq: row.primary_1688_moq,
    };
  } else {
    next.primary1688Source = null;
  }
  for (const key of [
    "primary1688SourceId",
    "primary1688OfferId",
    "primary1688SkuId",
    "primary1688SpecId",
    "primary1688SupplierName",
    "primary1688ProductTitle",
    "primary1688UnitPrice",
    "primary1688Moq",
  ]) {
    delete next[key];
  }
  return next;
}

function toSkuStockDetail(row) {
  const next = toCamelRow(row);
  const remark = parseJsonObject(row.receipt_remark);
  next.businessType = "采购进仓";
  next.date = row.received_at || row.created_at || null;
  next.qty = Number(row.received_qty || 0);
  next.orderNo = row.receipt_no || row.batch_code || row.id;
  next.batchCode = row.batch_code || "";
  next.receiptNo = row.receipt_no || "";
  next.poNo = row.po_no || "";
  next.warehouse = row.location_code || remark.warehouse || remark.sourceWarehouse || "-";
  next.store = row.account_name || row.account_id || "-";
  next.operator = remark.purchaser || row.operator_name || "-";
  next.sourceStatus = remark.sourceStatus || row.receipt_status || "";
  next.sourceRemark = remark.sourceRemark || "";
  next.availableQty = Number(row.available_qty || 0);
  next.reservedQty = Number(row.reserved_qty || 0);
  next.blockedQty = Number(row.blocked_qty || 0);
  next.defectiveQty = Number(row.defective_qty || 0);
  next.reworkQty = Number(row.rework_qty || 0);
  next.currentQty = next.availableQty + next.reservedQty + next.blockedQty + next.defectiveQty + next.reworkQty;
  next.unitCost = Number(row.po_unit_cost || 0);
  next.unitLandedCost = Number(row.unit_landed_cost || 0);
  next.unitFreightCost = next.unitLandedCost && next.unitCost ? Number((next.unitLandedCost - next.unitCost).toFixed(6)) : 0;
  next.stockValue = Number((next.unitLandedCost * next.currentQty).toFixed(6));
  next.costStatus = next.currentQty > 0 && next.unitLandedCost <= 0 ? "missing" : "confirmed";
  next.costedQty = next.costStatus === "confirmed" ? next.currentQty : 0;
  next.missingCostQty = next.costStatus === "missing" ? next.currentQty : 0;
  delete next.receiptRemark;
  return next;
}

function listSkuStockDetails(params = {}) {
  const { db } = requireErp();
  const skuId = optionalString(params.skuId || params.sku_id || params.id);
  const internalSkuCode = optionalString(params.internalSkuCode || params.internal_sku_code || params.skuCode || params.sku_code);
  if (!skuId && !internalSkuCode) throw new Error("skuId or internalSkuCode is required");

  const conditions = [];
  const queryParams = {
    sku_id: skuId,
    internal_sku_code: internalSkuCode,
    limit: Math.min(normalizeLimit(params.limit, 100), 1000),
    offset: normalizeOffset(params.offset),
  };
  if (skuId && internalSkuCode) {
    conditions.push("(batch.sku_id = @sku_id OR sku.internal_sku_code = @internal_sku_code)");
  } else if (skuId) {
    conditions.push("batch.sku_id = @sku_id");
  } else if (internalSkuCode) {
    conditions.push("sku.internal_sku_code = @internal_sku_code");
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS row_count,
      COALESCE(SUM(batch.received_qty), 0) AS received_qty,
      COALESCE(SUM(batch.available_qty), 0) AS available_qty,
      COALESCE(SUM(batch.reserved_qty), 0) AS reserved_qty,
      COALESCE(SUM(batch.blocked_qty), 0) AS blocked_qty,
      COALESCE(SUM(batch.defective_qty), 0) AS defective_qty,
      COALESCE(SUM(batch.rework_qty), 0) AS rework_qty,
      COALESCE(SUM(CASE
        WHEN (batch.available_qty + batch.reserved_qty + batch.blocked_qty + batch.defective_qty + batch.rework_qty) > 0
          AND COALESCE(batch.unit_landed_cost, 0) > 0
        THEN (batch.available_qty + batch.reserved_qty + batch.blocked_qty + batch.defective_qty + batch.rework_qty)
        ELSE 0
      END), 0) AS costed_qty,
      COALESCE(SUM(CASE
        WHEN (batch.available_qty + batch.reserved_qty + batch.blocked_qty + batch.defective_qty + batch.rework_qty) > 0
          AND COALESCE(batch.unit_landed_cost, 0) <= 0
        THEN (batch.available_qty + batch.reserved_qty + batch.blocked_qty + batch.defective_qty + batch.rework_qty)
        ELSE 0
      END), 0) AS missing_cost_qty,
      COALESCE(SUM(batch.unit_landed_cost * (
        batch.available_qty + batch.reserved_qty + batch.blocked_qty + batch.defective_qty + batch.rework_qty
      )), 0) AS stock_value
    FROM erp_inventory_batches batch
    LEFT JOIN erp_skus sku ON sku.id = batch.sku_id
    ${whereClause}
  `).get(queryParams) || {};

  const rows = db.prepare(`
    SELECT
      batch.*,
      sku.internal_sku_code,
      sku.product_name,
      acct.name AS account_name,
      receipt.receipt_no,
      receipt.status AS receipt_status,
      receipt.remark AS receipt_remark,
      operator.name AS operator_name,
      receipt_line.po_line_id,
      po_line.unit_cost AS po_unit_cost,
      po.po_no
    FROM erp_inventory_batches batch
    LEFT JOIN erp_skus sku ON sku.id = batch.sku_id
    LEFT JOIN erp_accounts acct ON acct.id = batch.account_id
    LEFT JOIN erp_inbound_receipts receipt ON receipt.id = batch.inbound_receipt_id
    LEFT JOIN erp_users operator ON operator.id = receipt.operator_id
    LEFT JOIN erp_inbound_receipt_lines receipt_line ON receipt_line.batch_id = batch.id
    LEFT JOIN erp_purchase_order_lines po_line ON po_line.id = receipt_line.po_line_id
    LEFT JOIN erp_purchase_orders po ON po.id = batch.po_id
    ${whereClause}
    ORDER BY datetime(batch.received_at) DESC, batch.updated_at DESC, batch.id DESC
    LIMIT @limit OFFSET @offset
  `).all(queryParams).map(toSkuStockDetail);

  return {
    rows,
    total: Number(summary.row_count || 0),
    summary: {
      receivedQty: Number(summary.received_qty || 0),
      availableQty: Number(summary.available_qty || 0),
      reservedQty: Number(summary.reserved_qty || 0),
      blockedQty: Number(summary.blocked_qty || 0),
      defectiveQty: Number(summary.defective_qty || 0),
      reworkQty: Number(summary.rework_qty || 0),
      costedQty: Number(summary.costed_qty || 0),
      missingCostQty: Number(summary.missing_cost_qty || 0),
      stockValue: Number(summary.stock_value || 0),
    },
  };
}

function getDefaultSku1688Source(db, accountId, skuId) {
  return db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND status = 'active'
    ORDER BY is_default DESC, updated_at DESC, created_at DESC
    LIMIT 1
  `).get({
    account_id: accountId,
    sku_id: skuId,
  });
}

function listSku1688Sources(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId || params.account_id);
  const skuId = optionalString(params.skuId || params.sku_id);
  const includeDeleted = Boolean(params.includeDeleted || params.include_deleted);
  const since = optionalString(params.since);
  const companyId = optionalString(params.companyId || params.company_id);
  const conditions = [];
  const values = {
    account_id: accountId,
    sku_id: skuId,
    status: optionalString(params.status),
    since,
    company_id: companyId,
    limit: normalizeLimit(params.limit, 500),
    offset: normalizeOffset(params.offset),
  };
  if (accountId) conditions.push("source.account_id = @account_id");
  if (skuId) conditions.push("source.sku_id = @sku_id");
  if (values.status) conditions.push("source.status = @status");
  // company 分区：映射表本身没有 company_id，靠 sku / account 任一归属命中。
  if (companyId) conditions.push("(sku.company_id = @company_id OR acct.company_id = @company_id)");
  // 增量游标：只取 since 之后变化的行（含软删，由 includeDeleted 控制）。
  if (since) conditions.push("source.updated_at > @since");
  // 关键词搜索（供应商管理「已绑定」Tab，host 模式）：覆盖 client 端 payload LIKE 的主要字段。
  const search = optionalString(params.search);
  if (search) {
    values.search = `%${search}%`;
    conditions.push("(sku.internal_sku_code LIKE @search OR sku.product_name LIKE @search OR source.supplier_name LIKE @search OR source.product_title LIKE @search OR source.external_offer_id LIKE @search OR source.external_sku_id LIKE @search OR source.external_spec_id LIKE @search OR source.platform_sku_name LIKE @search OR acct.name LIKE @search)");
  }
  if (!includeDeleted) {
    conditions.push("source.status != 'deleted'");
    conditions.push("(sku.status IS NULL OR sku.status != 'deleted')");
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      source.*,
      acct.name AS account_name,
      supplier.name AS system_supplier_name,
      sku.internal_sku_code,
      sku.product_name,
      sku.color_spec
    FROM erp_sku_1688_sources source
    LEFT JOIN erp_skus sku ON sku.id = source.sku_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = sku.supplier_id
    LEFT JOIN erp_accounts acct ON acct.id = source.account_id
    ${where}
    ORDER BY source.is_default DESC, source.updated_at DESC, source.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all(values);
  return rows.map(toSku1688Source);
}

// 与 listSku1688Sources 同口径的计数（分页器总数，host 模式）。只 join company 分区/搜索所需的表。
function countSku1688Sources(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId || params.account_id);
  const skuId = optionalString(params.skuId || params.sku_id);
  const includeDeleted = Boolean(params.includeDeleted || params.include_deleted);
  const companyId = optionalString(params.companyId || params.company_id);
  const conditions = [];
  const values = {
    account_id: accountId,
    sku_id: skuId,
    status: optionalString(params.status),
    company_id: companyId,
  };
  if (accountId) conditions.push("source.account_id = @account_id");
  if (skuId) conditions.push("source.sku_id = @sku_id");
  if (values.status) conditions.push("source.status = @status");
  if (companyId) conditions.push("(sku.company_id = @company_id OR acct.company_id = @company_id)");
  const search = optionalString(params.search);
  if (search) {
    values.search = `%${search}%`;
    conditions.push("(sku.internal_sku_code LIKE @search OR sku.product_name LIKE @search OR source.supplier_name LIKE @search OR source.product_title LIKE @search OR source.external_offer_id LIKE @search OR source.external_sku_id LIKE @search OR source.external_spec_id LIKE @search OR source.platform_sku_name LIKE @search OR acct.name LIKE @search)");
  }
  if (!includeDeleted) {
    conditions.push("source.status != 'deleted'");
    conditions.push("(sku.status IS NULL OR sku.status != 'deleted')");
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db.prepare(`
    SELECT COUNT(*) AS c
    FROM erp_sku_1688_sources source
    LEFT JOIN erp_skus sku ON sku.id = source.sku_id
    LEFT JOIN erp_accounts acct ON acct.id = source.account_id
    ${where}
  `).get(values);
  return row ? row.c : 0;
}

// 与 listSkus(unmappedOnly) 同口径的未绑定 SKU 计数（分页器总数，host 模式）。
function countUnmappedSkus(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId || params.account_id);
  const companyId = optionalString(params.companyId || params.company_id);
  const conditions = ["sku.id NOT LIKE 'jst:sku:%'", "sku.status != 'deleted'"];
  const values = { account_id: accountId, company_id: companyId };
  if (accountId) conditions.push("(sku.account_id = @account_id OR sku.account_id IS NULL)");
  if (companyId) conditions.push("sku.company_id = @company_id");
  const search = optionalString(params.search);
  if (search) {
    values.search = `%${search}%`;
    conditions.push("(sku.internal_sku_code LIKE @search OR sku.id LIKE @search OR sku.product_name LIKE @search)");
  }
  conditions.push("NOT EXISTS (SELECT 1 FROM erp_sku_1688_sources s2 WHERE s2.sku_id = sku.id AND s2.status != 'deleted')");
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM erp_skus sku
    WHERE ${conditions.join(" AND ")}
  `).get(values);
  return row ? row.c : 0;
}

function getActiveSku1688SourceRows(db, accountId, skuId) {
  const rows = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND status = 'active'
    ORDER BY is_default DESC, updated_at DESC, created_at DESC
  `).all({
    account_id: accountId,
    sku_id: skuId,
  });
  if (!rows.length) return [];
  const defaultRow = rows.find((row) => Number(row.is_default) === 1);
  const defaultGroupId = optionalString(defaultRow?.mapping_group_id);
  if (defaultGroupId) {
    return rows.filter((row) => optionalString(row.mapping_group_id) === defaultGroupId);
  }
  const defaultRows = rows.filter((row) => Number(row.is_default) === 1);
  return defaultRows.length ? defaultRows : rows.slice(0, 1);
}

function buildCandidateFromSku1688Source(db, pr = {}, source = {}, actor = {}) {
  const now = nowIso();
  const row = {
    id: createId("source"),
    account_id: pr.account_id,
    pr_id: pr.id,
    purchase_source: enums.PURCHASE_SOURCE.SOURCE_1688_MANUAL,
    sourcing_method: "1688_mapping",
    supplier_id: null,
    supplier_name: optionalString(source.supplier_name) || "1688",
    product_title: optionalString(source.product_title),
    product_url: optionalString(source.product_url),
    image_url: optionalString(source.image_url),
    unit_price: optionalNumber(source.unit_price) ?? 0,
    moq: Math.max(1, Math.floor(Number(optionalNumber(source.moq) ?? 1))),
    lead_days: optionalNumber(source.lead_days),
    logistics_fee: optionalNumber(source.logistics_fee) ?? 0,
    remark: "来自供应商管理总表",
    status: "candidate",
    created_by: actor.id || null,
    external_offer_id: optionalString(source.external_offer_id),
    external_sku_id: optionalString(source.external_sku_id),
    external_spec_id: optionalString(source.external_spec_id),
    source_payload_json: source.source_payload_json || "{}",
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO erp_sourcing_candidates (
      id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
      product_title, product_url, image_url, unit_price, moq, lead_days,
      logistics_fee, remark, status, created_by, external_offer_id, external_sku_id,
      external_spec_id, source_payload_json, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @purchase_source, @sourcing_method, @supplier_id, @supplier_name,
      @product_title, @product_url, @image_url, @unit_price, @moq, @lead_days,
      @logistics_fee, @remark, @status, @created_by, @external_offer_id, @external_sku_id,
      @external_spec_id, @source_payload_json, @created_at, @updated_at
    )
  `).run(row);
  return db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(row.id);
}

function getSkuSupplierSource(db, skuId) {
  if (!skuId) return null;
  return db.prepare(`
    SELECT
      sku.supplier_id,
      sku.product_name,
      sku.image_url,
      supplier.name AS supplier_name
    FROM erp_skus sku
    LEFT JOIN erp_suppliers supplier ON supplier.id = sku.supplier_id
    WHERE sku.id = ?
    LIMIT 1
  `).get(skuId);
}

function buildCandidateFromSkuSupplier(db, pr = {}, source = {}, actor = {}) {
  const supplierId = optionalString(source.supplier_id);
  const supplierName = optionalString(source.supplier_name);
  if (!supplierId && !supplierName) return null;
  const now = nowIso();
  const row = {
    id: createId("source"),
    account_id: pr.account_id,
    pr_id: pr.id,
    purchase_source: "existing_supplier",
    sourcing_method: "sku_supplier",
    supplier_id: supplierId,
    supplier_name: supplierName || "商品资料供应商",
    product_title: optionalString(source.product_name),
    product_url: null,
    image_url: optionalString(source.image_url),
    unit_price: 0,
    moq: 1,
    lead_days: null,
    logistics_fee: 0,
    remark: "来自商品资料供应商",
    status: "candidate",
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO erp_sourcing_candidates (
      id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
      product_title, product_url, image_url, unit_price, moq, lead_days,
      logistics_fee, remark, status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @purchase_source, @sourcing_method, @supplier_id, @supplier_name,
      @product_title, @product_url, @image_url, @unit_price, @moq, @lead_days,
      @logistics_fee, @remark, @status, @created_by, @created_at, @updated_at
    )
  `).run(row);
  return db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(row.id);
}

function upsertSku1688SourceRow(db, payload = {}, actor = {}) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688采购来源绑定");
  const skuId = requireString(payload.skuId || payload.sku_id, "skuId");
  const sku = db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(skuId);
  if (!sku) throw new Error(`SKU not found: ${skuId}`);
  const now = nowIso();
  const externalOfferId = requireString(payload.externalOfferId || payload.external_offer_id, "externalOfferId");
  const externalSpecId = require1688SpecId(payload.externalSpecId || payload.external_spec_id, "供应商映射");
  const mappingGroupId = optionalString(payload.mappingGroupId || payload.mapping_group_id) || `map_${sku.id}_${externalOfferId}`;
  const row = {
    id: optionalString(payload.id) || createId("sku_1688"),
    account_id: optionalString(payload.accountId || payload.account_id) || sku.account_id,
    sku_id: sku.id,
    mapping_group_id: mappingGroupId,
    external_offer_id: externalOfferId,
    external_sku_id: optionalString(payload.externalSkuId || payload.external_sku_id) || "",
    external_spec_id: externalSpecId,
    platform_sku_name: optionalString(payload.platformSkuName || payload.platform_sku_name),
    supplier_name: optionalString(payload.supplierName || payload.supplier_name),
    product_title: optionalString(payload.productTitle || payload.product_title),
    product_url: optionalString(payload.productUrl || payload.product_url),
    image_url: optionalString(payload.imageUrl || payload.image_url),
    unit_price: optionalNumber(payload.unitPrice ?? payload.unit_price),
    moq: optionalNumber(payload.moq),
    lead_days: optionalNumber(payload.leadDays ?? payload.lead_days),
    logistics_fee: optionalNumber(payload.logisticsFee ?? payload.logistics_fee),
    // 默认 null 表示"调用方未提供";UPDATE 时保留原值,避免找货/刷新等
    // 不关心 ratio 的回写路径拿前端默认 1 把 db 里的真值冲掉(回写循环 bug)。
    // 首次 INSERT 时再由 SQL 的 COALESCE 兜到 1。
    our_qty: optionalPositiveInteger(payload.ourQty ?? payload.our_qty, null),
    platform_qty: optionalPositiveInteger(payload.platformQty ?? payload.platform_qty, null),
    status: optionalString(payload.status) || "active",
    is_default: payload.isDefault === false || payload.is_default === false ? 0 : (payload.isDefault || payload.is_default ? 1 : 0),
    remark: optionalString(payload.remark),
    source_payload_json: trimJsonForStorage(payload.sourcePayload || payload.source_payload || payload.raw || {}),
    created_by: optionalString(actor.id),
    created_at: now,
    updated_at: now,
  };
  if (!["active", "disabled"].includes(row.status)) {
    throw new Error("Invalid 1688 source status");
  }
  if (row.moq !== null && (!Number.isInteger(Number(row.moq)) || Number(row.moq) <= 0)) {
    throw new Error("moq must be a positive integer");
  }
  // 允许 null(=未提供,UPDATE 保留原值);提供了就必须是正整数。
  if (row.our_qty !== null && (!Number.isInteger(row.our_qty) || row.our_qty <= 0)) {
    throw new Error("1688 mapping our_qty must be a positive integer");
  }
  if (row.platform_qty !== null && (!Number.isInteger(row.platform_qty) || row.platform_qty <= 0)) {
    throw new Error("1688 mapping platform_qty must be a positive integer");
  }
  if (row.is_default) {
    db.prepare(`
      UPDATE erp_sku_1688_sources
      SET is_default = 0, updated_at = @updated_at
      WHERE account_id = @account_id
        AND sku_id = @sku_id
        AND COALESCE(NULLIF(mapping_group_id, ''), id) != @mapping_group_id
    `).run({
      account_id: row.account_id,
      sku_id: row.sku_id,
      mapping_group_id: row.mapping_group_id,
      updated_at: now,
    });
  }
  db.prepare(`
    INSERT INTO erp_sku_1688_sources (
      id, account_id, sku_id, mapping_group_id, external_offer_id, external_sku_id, external_spec_id,
      platform_sku_name, supplier_name, product_title, product_url, image_url, unit_price, moq,
      lead_days, logistics_fee, our_qty, platform_qty, status, is_default, remark, source_payload_json,
      created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @sku_id, @mapping_group_id, @external_offer_id, @external_sku_id, @external_spec_id,
      @platform_sku_name, @supplier_name, @product_title, @product_url, @image_url, @unit_price, @moq,
      @lead_days, @logistics_fee, COALESCE(@our_qty, 1), COALESCE(@platform_qty, 1), @status, @is_default, @remark, @source_payload_json,
      @created_by, @created_at, @updated_at
    )
    ON CONFLICT(account_id, sku_id, external_offer_id, external_sku_id, external_spec_id) DO UPDATE SET
      mapping_group_id = excluded.mapping_group_id,
      platform_sku_name = COALESCE(excluded.platform_sku_name, platform_sku_name),
      supplier_name = COALESCE(excluded.supplier_name, supplier_name),
      product_title = COALESCE(excluded.product_title, product_title),
      product_url = COALESCE(excluded.product_url, product_url),
      image_url = COALESCE(excluded.image_url, image_url),
      unit_price = COALESCE(excluded.unit_price, unit_price),
      moq = COALESCE(excluded.moq, moq),
      lead_days = COALESCE(excluded.lead_days, lead_days),
      logistics_fee = COALESCE(excluded.logistics_fee, logistics_fee),
      -- 用 @parameter 而不是 excluded:VALUES 里已 COALESCE 成 1,excluded 拿不到 null。
      -- 直接读绑定参数才能区分"未提供"(保留原值) vs "提供 1"(覆盖)。
      our_qty = COALESCE(@our_qty, our_qty),
      platform_qty = COALESCE(@platform_qty, platform_qty),
      status = excluded.status,
      is_default = excluded.is_default,
      remark = COALESCE(excluded.remark, remark),
      source_payload_json = excluded.source_payload_json,
      updated_at = excluded.updated_at
  `).run(row);
  const after = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND external_offer_id = @external_offer_id
      AND external_sku_id = @external_sku_id
      AND external_spec_id = @external_spec_id
  `).get(row);
  return toSku1688Source(after);
}

function deleteSku1688SourceRow(db, payload = {}, actor = {}) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688采购来源删除");
  const sourceId = requireString(payload.sourceId || payload.source_id || payload.id, "sourceId");
  const row = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  if (!row) throw new Error(`1688 supplier mapping not found: ${sourceId}`);

  const now = nowIso();
  db.prepare(`
    UPDATE erp_sku_1688_sources
    SET status = 'deleted',
        is_default = 0,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: sourceId,
    updated_at: now,
  });

  let promotedSourceId = null;
  if (Number(row.is_default) === 1) {
    const next = db.prepare(`
      SELECT id
      FROM erp_sku_1688_sources
      WHERE account_id = @account_id
        AND sku_id = @sku_id
        AND status = 'active'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `).get({
      account_id: row.account_id,
      sku_id: row.sku_id,
    });
    if (next?.id) {
      promotedSourceId = next.id;
      db.prepare(`
        UPDATE erp_sku_1688_sources
        SET is_default = 1,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
        id: next.id,
        updated_at: now,
      });
    }
  }

  const after = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  return {
    deleted: true,
    promotedSourceId,
    sku1688Source: toSku1688Source(after),
  };
}

function findSku1688SourceByIdentity(db, params = {}) {
  const accountId = optionalString(params.accountId || params.account_id);
  const skuId = optionalString(params.skuId || params.sku_id);
  const externalOfferId = optionalString(params.externalOfferId || params.external_offer_id);
  if (!accountId || !skuId || !externalOfferId) return null;
  return db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND external_offer_id = @external_offer_id
      AND external_sku_id = @external_sku_id
      AND external_spec_id = @external_spec_id
    LIMIT 1
  `).get({
    account_id: accountId,
    sku_id: skuId,
    external_offer_id: externalOfferId,
    external_sku_id: optionalString(params.externalSkuId || params.external_sku_id) || "",
    external_spec_id: optionalString(params.externalSpecId || params.external_spec_id) || "",
  });
}

function upsertSku1688SourceFromCandidate(db, candidate = {}, pr = {}, actor = {}, options = {}) {
  const externalOfferId = optionalString(candidate.external_offer_id || candidate.externalOfferId);
  if (!externalOfferId || !pr?.sku_id) return null;
  const candidateSourcePayload = parseJsonObject(candidate.source_payload_json);
  const candidateDetailPayload = parseJsonObject(candidate.external_detail_json);
  const sourcePayload = Object.keys(candidateSourcePayload).length ? candidateSourcePayload : candidateDetailPayload;
  const inferredCandidate = {
    ...candidate,
    raw: sourcePayload,
  };
  const externalSpecId = require1688SpecId(
    candidate.external_spec_id || candidate.externalSpecId || infer1688CandidateSpecId(inferredCandidate),
    "候选货源",
  );
  const externalSkuId = optionalString(candidate.external_sku_id || candidate.externalSkuId || infer1688CandidateSkuId(inferredCandidate));
  const accountId = optionalString(candidate.account_id || candidate.accountId || pr.account_id || pr.accountId);
  const existingSource = findSku1688SourceByIdentity(db, {
    accountId,
    skuId: pr.sku_id,
    externalOfferId,
    externalSkuId,
    externalSpecId,
  });
  const existingPayload = existingSource ? parseJsonObject(existingSource.source_payload_json) : {};
  const finalSourcePayload = Object.keys(sourcePayload).length ? sourcePayload : existingPayload;
  const ourQty = optionalPositiveInteger(options.ourQty ?? options.our_qty, null)
    ?? optionalPositiveInteger(candidate.our_qty ?? candidate.ourQty, null)
    ?? optionalPositiveInteger(existingSource?.our_qty, null);
  const platformQty = optionalPositiveInteger(options.platformQty ?? options.platform_qty, null)
    ?? optionalPositiveInteger(candidate.platform_qty ?? candidate.platformQty, null)
    ?? optionalPositiveInteger(existingSource?.platform_qty, null);
  return upsertSku1688SourceRow(db, {
    accountId: accountId || pr.account_id,
    skuId: pr.sku_id,
    mappingGroupId: options.mappingGroupId || options.mapping_group_id
      || candidate.mapping_group_id || candidate.mappingGroupId
      || existingSource?.mapping_group_id
      || `map_${pr.sku_id}_${externalOfferId}_${externalSpecId}`,
    externalOfferId,
    externalSkuId,
    externalSpecId,
    platformSkuName: options.platformSkuName || options.platform_sku_name || candidate.platform_sku_name || candidate.platformSkuName || existingSource?.platform_sku_name || externalSpecId || externalSkuId,
    supplierName: candidate.supplier_name || candidate.supplierName || existingSource?.supplier_name,
    productTitle: candidate.product_title || candidate.productTitle || existingSource?.product_title,
    productUrl: candidate.product_url || candidate.productUrl || existingSource?.product_url,
    imageUrl: candidate.image_url || candidate.imageUrl || existingSource?.image_url,
    unitPrice: candidate.unit_price ?? candidate.unitPrice ?? existingSource?.unit_price,
    moq: candidate.moq ?? existingSource?.moq,
    leadDays: candidate.lead_days ?? candidate.leadDays ?? existingSource?.lead_days,
    logisticsFee: candidate.logistics_fee ?? candidate.logisticsFee ?? existingSource?.logistics_fee,
    ourQty,
    platformQty,
    sourcePayload: finalSourcePayload,
    isDefault: Boolean(options.isDefault),
    status: "active",
  }, actor);
}

function toPurchaseRequest(row) {
  const next = toCamelRow(row);
  next.evidence = parseJsonArray(row.evidence_json);
  delete next.evidenceJson;
  return next;
}

function to1688DeliveryAddress(row) {
  const next = toCamelRow(row);
  next.isDefault = Boolean(row.is_default);
  next.rawAddressParam = parseJsonObject(row.raw_address_param_json);
  delete next.rawAddressParamJson;
  next.addressParam = build1688AddressParamFromRow(row);
  // toCamelKey 的正则只认 _[a-z],"_1688"前的下划线没被去掉 → 显式补一个干净的 purchase1688AccountId。
  next.purchase1688AccountId = row.purchase_1688_account_id || null;
  delete next.purchase_1688AccountId;
  return next;
}

function actorCan(actor, roles) {
  return Boolean(actor?.role && roles.includes(actor.role));
}

function assertActorRole(actor, roles, actionName = "该操作") {
  if (!actorCan(actor, roles)) {
    throw new Error(`${actionName}需要以下角色之一：${roles.join(", ")}`);
  }
}

function getActorProfile(db, actor = {}) {
  const id = optionalString(actor.id);
  const row = id ? db.prepare("SELECT id, name, role FROM erp_users WHERE id = ?").get(id) : null;
  const role = row?.role || optionalString(actor.role);
  return {
    id: row?.id || id || null,
    name: row?.name || optionalString(actor.name || actor.actorName) || (role === "system" ? "系统" : null),
    role,
  };
}

function getPurchaseRequest(db, prId) {
  const row = db.prepare("SELECT * FROM erp_purchase_requests WHERE id = ?").get(prId);
  if (!row) throw new Error(`Purchase request not found: ${prId}`);
  return row;
}

function markPurchaseRequestRead(db, prId, actor) {
  const actorProfile = getActorProfile(db, actor);
  if (!actorProfile.id) return null;
  const now = nowIso();
  db.prepare(`
    INSERT INTO erp_purchase_request_reads (pr_id, user_id, last_read_at)
    VALUES (@pr_id, @user_id, @last_read_at)
    ON CONFLICT(pr_id, user_id) DO UPDATE SET
      last_read_at = excluded.last_read_at
  `).run({
    pr_id: prId,
    user_id: actorProfile.id,
    last_read_at: now,
  });
  return now;
}

function writePurchaseRequestEvent(db, pr, actor, eventType, message) {
  const actorProfile = getActorProfile(db, actor);
  const row = {
    id: createId("pr_evt"),
    pr_id: pr.id,
    account_id: pr.account_id,
    actor_id: actorProfile.id,
    actor_name: actorProfile.name,
    actor_role: actorProfile.role,
    event_type: eventType,
    message: requireString(message, "message"),
    created_at: nowIso(),
  };
  db.prepare(`
    INSERT INTO erp_purchase_request_events (
      id, pr_id, account_id, actor_id, actor_name, actor_role,
      event_type, message, created_at
    )
    VALUES (
      @id, @pr_id, @account_id, @actor_id, @actor_name, @actor_role,
      @event_type, @message, @created_at
    )
  `).run(row);
  return row;
}

function writePurchaseOrderFlowEvent(db, poOrId, actor, eventType, message) {
  const po = typeof poOrId === "string"
    ? db.prepare("SELECT * FROM erp_purchase_orders WHERE id = ?").get(poOrId)
    : poOrId;
  if (!po?.pr_id) return null;
  const pr = db.prepare("SELECT * FROM erp_purchase_requests WHERE id = ?").get(po.pr_id);
  if (!pr) return null;
  const event = writePurchaseRequestEvent(db, pr, actor, eventType, message);
  markPurchaseRequestRead(db, pr.id, actor);
  return event;
}

function writeInboundReceiptFlowEvent(db, receiptOrId, actor, eventType, message) {
  const receipt = typeof receiptOrId === "string"
    ? db.prepare("SELECT * FROM erp_inbound_receipts WHERE id = ?").get(receiptOrId)
    : receiptOrId;
  if (!receipt?.po_id) return null;
  return writePurchaseOrderFlowEvent(db, receipt.po_id, actor, eventType, message);
}

function writeOutboundFlowEvent(db, shipmentOrId, actor, eventType, message) {
  const shipment = typeof shipmentOrId === "string"
    ? db.prepare("SELECT * FROM erp_outbound_shipments WHERE id = ?").get(shipmentOrId)
    : shipmentOrId;
  if (!shipment?.batch_id) return null;
  const batch = db.prepare("SELECT po_id FROM erp_inventory_batches WHERE id = ?").get(shipment.batch_id);
  if (!batch?.po_id) return null;
  return writePurchaseOrderFlowEvent(db, batch.po_id, actor, eventType, message);
}

function addPurchaseRequestComment(db, pr, actor, body) {
  const actorProfile = getActorProfile(db, actor);
  const row = {
    id: createId("pr_msg"),
    pr_id: pr.id,
    account_id: pr.account_id,
    author_id: actorProfile.id,
    author_name: actorProfile.name,
    author_role: actorProfile.role,
    body: requireString(body, "comment"),
    created_at: nowIso(),
  };
  db.prepare(`
    INSERT INTO erp_purchase_request_comments (
      id, pr_id, account_id, author_id, author_name, author_role, body, created_at
    )
    VALUES (
      @id, @pr_id, @account_id, @author_id, @author_name, @author_role, @body, @created_at
    )
  `).run(row);
  markPurchaseRequestRead(db, pr.id, actor);
  return row;
}

function getPurchaseWorkbench(params = {}) {
  const { db } = requireErp();
  normalizePurchaseOrderNumbers(db);
  const accountId = optionalString(params.accountId);
  const companyId = normalizeCompanyId(params.user?.companyId || params.companyId || params.company_id, erpState.currentUser);
  const limit = normalizeLimit(params.limit, 50);
  const purchaseOrderLimit = normalizeLimit(params.purchaseOrderLimit || params.purchase_order_limit || params.poLimit || params.po_limit || params.limit, 50);
  const purchaseOrderOffset = normalizeOffset(params.purchaseOrderOffset || params.purchase_order_offset || params.poOffset || params.po_offset || params.offset);
  const purchaseOrderQueue = optionalString(params.purchaseOrderQueue || params.purchase_order_queue || params.poQueue || params.po_queue);
  const purchaseOrderSearch = optionalString(params.purchaseOrderSearch || params.purchase_order_search || params.poSearch || params.po_search || params.search);
  const purchaseOrderNo = optionalString(params.purchaseOrderNo || params.purchase_order_no || params.poNo || params.po_no || params.orderNo || params.order_no);
  const purchaseOrderDateFrom = optionalString(params.purchaseOrderDateFrom || params.purchase_order_date_from || params.poDateFrom || params.po_date_from || params.dateFrom || params.date_from);
  const purchaseOrderDateTo = optionalString(params.purchaseOrderDateTo || params.purchase_order_date_to || params.poDateTo || params.po_date_to || params.dateTo || params.date_to);
  const purchaseOrderPurchaser = optionalString(params.purchaseOrderPurchaser || params.purchase_order_purchaser || params.purchaser || params.buyer || params.createdByName || params.created_by_name);
  const purchaseOrderAccountId = optionalString(params.purchaseOrderAccountId || params.purchase_order_account_id || params.poAccountId || params.po_account_id || params.storeId || params.store_id || params.shopId || params.shop_id);
  const purchaseOrderSupplier = optionalString(params.purchaseOrderSupplier || params.purchase_order_supplier || params.poSupplier || params.po_supplier || params.supplierName || params.supplier_name);
  const purchaseOrderPaymentState = optionalString(params.purchaseOrderPaymentState || params.purchase_order_payment_state || params.poPaymentState || params.po_payment_state || params.paymentState || params.payment_state);
  const purchaseOrderSourceState = optionalString(params.purchaseOrderSourceState || params.purchase_order_source_state || params.poSourceState || params.po_source_state || params.sourceState || params.source_state);
  const purchaseOrderRiskState = optionalString(params.purchaseOrderRiskState || params.purchase_order_risk_state || params.poRiskState || params.po_risk_state || params.riskState || params.risk_state);
  const purchaseOrderProductCode = optionalString(params.purchaseOrderProductCode || params.purchase_order_product_code || params.poProductCode || params.po_product_code || params.productCode || params.product_code || params.skuCode || params.sku_code);
  const purchaseOrderAmountMin = optionalNumber(params.purchaseOrderAmountMin ?? params.purchase_order_amount_min ?? params.poAmountMin ?? params.po_amount_min ?? params.amountMin ?? params.amount_min);
  const purchaseOrderAmountMax = optionalNumber(params.purchaseOrderAmountMax ?? params.purchase_order_amount_max ?? params.poAmountMax ?? params.po_amount_max ?? params.amountMax ?? params.amount_max);
  const purchaseOrderSortField = optionalString(params.purchaseOrderSortField || params.purchase_order_sort_field || params.poSortField || params.po_sort_field || params.sortField || params.sort_field);
  const purchaseOrderSortDirection = optionalString(params.purchaseOrderSortDirection || params.purchase_order_sort_direction || params.poSortDirection || params.po_sort_direction || params.sortDirection || params.sort_direction);
  const includePurchaseOrders = params.includePurchaseOrders !== false && params.include_purchase_orders !== false;
  const includeRequestDetails = params.includeRequestDetails !== false && params.include_request_details !== false;
  const includeOptions = params.includeOptions !== false && params.include_options !== false;
  const include1688Meta = params.include1688Meta !== false && params.include_1688_meta !== false;
  const detailPrId = optionalString(params.detailPrId || params.detail_pr_id || params.prId || params.pr_id);
  const whereAccount = accountId ? "WHERE pr.account_id = @account_id" : "";
  const paymentWhereAccount = accountId ? "AND po.account_id = @account_id" : "";
  const baseParams = {
    account_id: accountId,
    limit,
  };
  const poConditions = [];
  const poPaidSignalSql = `(po.status IN ('paid', 'supplier_processing', 'shipped', 'arrived')
    OR LOWER(COALESCE(po.payment_status, '')) IN ('paid', 'confirmed', 'success')
    OR NULLIF(TRIM(COALESCE(po.paid_at, '')), '') IS NOT NULL)`;
  const poActivePaidSql = `(${poPaidSignalSql} AND po.status NOT IN ('inbounded', 'closed', 'cancelled', 'delayed', 'exception'))`;
  const poDraftSql = `(po.status IN ('draft', 'pushed_pending_price') AND NOT ${poPaidSignalSql})`;
  const poPendingPaymentSql = `(po.status IN ('pending_finance_approval', 'approved_to_pay') AND NOT ${poPaidSignalSql})`;
  const poCompletedSql = `(po.status IN ('inbounded', 'closed'))`;
  const poHas1688MappingSql = `EXISTS (
    SELECT 1
    FROM erp_purchase_order_lines mapping_line
    JOIN erp_sku_1688_sources mapping_source
      ON mapping_source.account_id = mapping_line.account_id
     AND mapping_source.sku_id = mapping_line.sku_id
     AND mapping_source.status = 'active'
    WHERE mapping_line.po_id = po.id
  )`;
  const poHasDeliveryAddressSql = `EXISTS (
    SELECT 1
    FROM erp_1688_delivery_addresses filter_addr
    WHERE filter_addr.account_id = po.account_id
      AND filter_addr.status = 'active'
  )`;
  const poHasRefundSql = `EXISTS (
    SELECT 1
    FROM erp_1688_refunds filter_refund
    WHERE filter_refund.po_id = po.id
      OR (po.external_order_id IS NOT NULL AND filter_refund.external_order_id = po.external_order_id)
  )`;
  const poAmountSql = `COALESCE(NULLIF(po.paid_amount, 0), COALESCE(po.total_amount, 0) + COALESCE(po.freight_amount, 0), 0)`;
  const poTotalQtySql = "COALESCE(SUM(line.qty), 0)";
  const poReceivedQtySql = "COALESCE(SUM(line.received_qty), 0)";
  const poRefundCountSql = `(
    SELECT COUNT(*)
    FROM erp_1688_refunds sort_refund
    WHERE sort_refund.po_id = po.id
      OR (po.external_order_id IS NOT NULL AND sort_refund.external_order_id = po.external_order_id)
  )`;
  const poRiskScoreSql = `CASE
    WHEN po.status IN ('delayed', 'exception') THEN 5
    WHEN ${poHasRefundSql} THEN 4
    WHEN (${poPendingPaymentSql} OR po.status = 'approved_to_pay') THEN 3
    WHEN ${poPaidSignalSql}
      AND NOT ${poCompletedSql}
      AND po.status NOT IN ('cancelled', 'delayed', 'exception') THEN 2
    WHEN NULLIF(TRIM(COALESCE(po.external_order_id, '')), '') IS NULL
      AND ${poHas1688MappingSql}
      AND NOT ${poHasDeliveryAddressSql} THEN 1
    ELSE 0
  END`;
  if (accountId) poConditions.push("po.account_id = @account_id");
  if (purchaseOrderAccountId) poConditions.push("po.account_id = @po_account_id");
  switch (purchaseOrderQueue) {
    case "po_draft":
      poConditions.push(poDraftSql);
      break;
    case "po_pending_payment":
      poConditions.push(poPendingPaymentSql);
      break;
    case "po_paid":
      poConditions.push(poActivePaidSql);
      break;
    case "po_completed":
      poConditions.push(poCompletedSql);
      break;
    case "po_cancelled":
      poConditions.push("po.status = 'cancelled'");
      break;
    case "po_exception":
      poConditions.push("po.status IN ('delayed', 'exception')");
      break;
    default:
      break;
  }
  const poParams = {
    account_id: accountId,
    limit: purchaseOrderLimit,
    offset: purchaseOrderOffset,
    po_search: purchaseOrderSearch ? `%${purchaseOrderSearch}%` : "",
    po_no_filter: purchaseOrderNo ? `%${purchaseOrderNo}%` : "",
    po_date_from: purchaseOrderDateFrom,
    po_date_to: purchaseOrderDateTo,
    po_purchaser_filter: purchaseOrderPurchaser ? `%${purchaseOrderPurchaser}%` : "",
    po_account_id: purchaseOrderAccountId,
    po_supplier_filter: purchaseOrderSupplier ? `%${purchaseOrderSupplier}%` : "",
    po_product_code_filter: purchaseOrderProductCode ? `%${purchaseOrderProductCode}%` : "",
    po_amount_min: purchaseOrderAmountMin,
    po_amount_max: purchaseOrderAmountMax,
  };
  if (purchaseOrderSearch) {
    poConditions.push(`(
      po.id LIKE @po_search
      OR po.po_no LIKE @po_search
      OR po.external_order_id LIKE @po_search
      OR po.external_order_status LIKE @po_search
      OR po.jst_purchaser_name LIKE @po_search
      OR acct.name LIKE @po_search
      OR supplier.name LIKE @po_search
      OR cand.supplier_name LIKE @po_search
      OR sku.internal_sku_code LIKE @po_search
      OR sku.product_name LIKE @po_search
    )`);
  }
  if (purchaseOrderNo) {
    poConditions.push(`(
      po.id LIKE @po_no_filter
      OR po.po_no LIKE @po_no_filter
      OR po.external_order_id LIKE @po_no_filter
    )`);
  }
  if (purchaseOrderDateFrom) {
    poConditions.push("DATE(COALESCE(po.created_at, po.updated_at)) >= DATE(@po_date_from)");
  }
  if (purchaseOrderDateTo) {
    poConditions.push("DATE(COALESCE(po.created_at, po.updated_at)) <= DATE(@po_date_to)");
  }
  if (purchaseOrderPurchaser) {
    poConditions.push(`(
      creator.name LIKE @po_purchaser_filter
      OR po.jst_purchaser_name LIKE @po_purchaser_filter
    )`);
  }
  if (purchaseOrderSupplier) {
    poConditions.push(`(
      supplier.name LIKE @po_supplier_filter
      OR cand.supplier_name LIKE @po_supplier_filter
      OR po.supplier_id LIKE @po_supplier_filter
    )`);
  }
  if (purchaseOrderProductCode) {
    poConditions.push(`EXISTS (
      SELECT 1
      FROM erp_purchase_order_lines code_line
      LEFT JOIN erp_skus code_sku ON code_sku.id = code_line.sku_id
      WHERE code_line.po_id = po.id
        AND (
          code_sku.internal_sku_code LIKE @po_product_code_filter
          OR code_line.sku_id LIKE @po_product_code_filter
        )
    )`);
  }
  if (purchaseOrderAmountMin !== null && purchaseOrderAmountMin !== undefined) {
    poConditions.push(`${poAmountSql} >= @po_amount_min`);
  }
  if (purchaseOrderAmountMax !== null && purchaseOrderAmountMax !== undefined) {
    poConditions.push(`${poAmountSql} <= @po_amount_max`);
  }
  switch (purchaseOrderPaymentState) {
    case "unpaid":
      poConditions.push(`NOT ${poPaidSignalSql}`);
      break;
    case "pending":
      poConditions.push(poPendingPaymentSql);
      break;
    case "paid":
      poConditions.push(poPaidSignalSql);
      break;
    default:
      break;
  }
  switch (purchaseOrderSourceState) {
    case "1688_bound":
      poConditions.push("NULLIF(TRIM(COALESCE(po.external_order_id, '')), '') IS NOT NULL");
      break;
    case "1688_pushable":
      poConditions.push("NULLIF(TRIM(COALESCE(po.external_order_id, '')), '') IS NULL");
      poConditions.push(poHas1688MappingSql);
      break;
    case "offline":
      poConditions.push("NULLIF(TRIM(COALESCE(po.external_order_id, '')), '') IS NULL");
      poConditions.push(`NOT ${poHas1688MappingSql}`);
      break;
    case "unbound":
      poConditions.push("NULLIF(TRIM(COALESCE(po.external_order_id, '')), '') IS NULL");
      break;
    default:
      break;
  }
  switch (purchaseOrderRiskState) {
    case "missing_address":
      poConditions.push("NULLIF(TRIM(COALESCE(po.external_order_id, '')), '') IS NULL");
      poConditions.push(poHas1688MappingSql);
      poConditions.push(`NOT ${poHasDeliveryAddressSql}`);
      break;
    case "pending_payment":
      poConditions.push(`(${poPendingPaymentSql} OR po.status = 'approved_to_pay')`);
      break;
    case "pending_inbound":
      poConditions.push(poPaidSignalSql);
      poConditions.push(`NOT ${poCompletedSql}`);
      poConditions.push("po.status NOT IN ('cancelled', 'delayed', 'exception')");
      break;
    case "refund":
      poConditions.push(poHasRefundSql);
      break;
    case "exception":
      poConditions.push("po.status IN ('delayed', 'exception')");
      break;
    default:
      break;
  }
  const poWhereSql = poConditions.length ? `WHERE ${poConditions.join(" AND ")}` : "";
  const poBaseWhereSql = accountId ? "WHERE po.account_id = @account_id" : "";
  const poSortSqlByField = {
    createdAt: "datetime(COALESCE(po.created_at, po.updated_at))",
    po: "COALESCE(po.po_no, po.id)",
    status: "po.status",
    paymentStatus: "COALESCE(po.payment_status, '')",
    riskTags: poRiskScoreSql,
    paidAt: "datetime(COALESCE(NULLIF(po.paid_at, ''), '1970-01-01'))",
    createdByName: "COALESCE(creator.name, po.jst_purchaser_name, '')",
    accountName: "COALESCE(acct.name, '')",
    supplierName: "COALESCE(supplier.name, cand.supplier_name, '')",
    skuCodes: "sku_codes",
    productNames: "product_names",
    totalQty: poTotalQtySql,
    totalAmount: "COALESCE(po.total_amount, 0)",
    freightAmount: "COALESCE(po.freight_amount, 0)",
    paidAmount: poAmountSql,
    externalOrderId: "COALESCE(po.external_order_id, '')",
    externalOrderStatus: "COALESCE(po.external_order_status, '')",
    logistics: "datetime(COALESCE(NULLIF(po.external_logistics_synced_at, ''), NULLIF(po.external_order_detail_synced_at, ''), '1970-01-01'))",
    refundStatus: poRefundCountSql,
    receivedQty: `CASE WHEN ${poTotalQtySql} > 0 THEN CAST(${poReceivedQtySql} AS REAL) / ${poTotalQtySql} ELSE 0 END`,
    expectedDeliveryDate: "date(COALESCE(NULLIF(po.expected_delivery_date, ''), '9999-12-31'))",
  };
  const poSortExpression = poSortSqlByField[purchaseOrderSortField];
  const poSortDirectionSql = /^(asc|ascend)$/i.test(purchaseOrderSortDirection) ? "ASC" : "DESC";
  const poNormalizedSortDirection = poSortExpression ? (poSortDirectionSql === "ASC" ? "ascend" : "descend") : null;
  const poOrderSql = poSortExpression
    ? `${poSortExpression} ${poSortDirectionSql}, po.updated_at DESC, po.id DESC`
    : `CASE po.status
        WHEN 'pending_finance_approval' THEN 0
        WHEN 'approved_to_pay' THEN 1
        WHEN 'pushed_pending_price' THEN 2
        WHEN 'paid' THEN 3
        WHEN 'supplier_processing' THEN 4
        WHEN 'shipped' THEN 5
        WHEN 'arrived' THEN 6
        WHEN 'draft' THEN 7
        WHEN 'inbounded' THEN 8
        WHEN 'closed' THEN 9
        ELSE 9
      END,
      po.updated_at DESC,
      po.id DESC`;

  const purchaseRequests = db.prepare(`
    SELECT
      pr.*,
      acct.name AS account_name,
      sku.internal_sku_code,
      sku.product_name,
      sku.color_spec,
      sku.image_url AS sku_image_url,
      sku.supplier_id AS sku_supplier_id,
      sku_supplier.name AS sku_supplier_name,
      requester.name AS requested_by_name,
      COUNT(candidate.id) AS candidate_count,
      SUM(CASE WHEN candidate.status = 'selected' THEN 1 ELSE 0 END) AS selected_candidate_count,
      (
        SELECT COUNT(*)
        FROM erp_sku_1688_sources source
        WHERE source.account_id = pr.account_id
          AND source.sku_id = pr.sku_id
          AND source.status = 'active'
      ) AS mapping_count,
      (
        SELECT source.supplier_name
        FROM erp_sku_1688_sources source
        WHERE source.account_id = pr.account_id
          AND source.sku_id = pr.sku_id
          AND source.status = 'active'
        ORDER BY source.is_default DESC, source.updated_at DESC, source.created_at DESC
        LIMIT 1
      ) AS primary_mapping_supplier_name,
      (
        SELECT source.external_offer_id
        FROM erp_sku_1688_sources source
        WHERE source.account_id = pr.account_id
          AND source.sku_id = pr.sku_id
          AND source.status = 'active'
        ORDER BY source.is_default DESC, source.updated_at DESC, source.created_at DESC
        LIMIT 1
      ) AS primary_mapping_offer_id,
      (
        SELECT source.unit_price
        FROM erp_sku_1688_sources source
        WHERE source.account_id = pr.account_id
          AND source.sku_id = pr.sku_id
          AND source.status = 'active'
        ORDER BY source.is_default DESC, source.updated_at DESC, source.created_at DESC
        LIMIT 1
      ) AS primary_mapping_unit_price,
      (
        SELECT candidate_price.unit_price
        FROM erp_sourcing_candidates candidate_price
        WHERE candidate_price.pr_id = pr.id
        ORDER BY
          CASE candidate_price.status
            WHEN 'selected' THEN 0
            WHEN 'shortlisted' THEN 1
            WHEN 'candidate' THEN 2
            ELSE 9
          END,
          candidate_price.updated_at DESC,
          candidate_price.created_at DESC
        LIMIT 1
      ) AS primary_candidate_unit_price,
      (
        SELECT COALESCE(candidate_supplier.name, candidate_supplier_row.supplier_name)
        FROM erp_sourcing_candidates candidate_supplier_row
        LEFT JOIN erp_suppliers candidate_supplier ON candidate_supplier.id = candidate_supplier_row.supplier_id
        WHERE candidate_supplier_row.pr_id = pr.id
        ORDER BY
          CASE candidate_supplier_row.status
            WHEN 'selected' THEN 0
            WHEN 'shortlisted' THEN 1
            WHEN 'candidate' THEN 2
            ELSE 9
          END,
          candidate_supplier_row.updated_at DESC,
          candidate_supplier_row.created_at DESC
        LIMIT 1
      ) AS primary_candidate_supplier_name
    FROM erp_purchase_requests pr
    LEFT JOIN erp_accounts acct ON acct.id = pr.account_id
    LEFT JOIN erp_skus sku ON sku.id = pr.sku_id
    LEFT JOIN erp_suppliers sku_supplier ON sku_supplier.id = sku.supplier_id
    LEFT JOIN erp_users requester ON requester.id = pr.requested_by
    LEFT JOIN erp_sourcing_candidates candidate ON candidate.pr_id = pr.id
    ${whereAccount}
    GROUP BY pr.id
    ORDER BY
      CASE pr.status
        WHEN 'submitted' THEN 0
        WHEN 'buyer_processing' THEN 1
        WHEN 'sourced' THEN 2
        WHEN 'waiting_ops_confirm' THEN 3
        WHEN 'draft' THEN 4
        WHEN 'converted_to_po' THEN 5
        ELSE 9
      END,
      pr.updated_at DESC
    LIMIT @limit
  `).all(baseParams).map(toPurchaseRequest);

  const currentUserId = params.user?.id || erpState.currentUser?.id || null;

  for (const pr of purchaseRequests) pr.unreadCount = 0;
  if (currentUserId && purchaseRequests.length) {
    const prIds = purchaseRequests.map((pr) => pr.id);
    const placeholders = prIds.map(() => "?").join(",");
    const unreadRows = db.prepare(`
      SELECT item.pr_id, COUNT(*) AS count
      FROM (
        SELECT pr_id, author_id AS source_user_id, created_at
        FROM erp_purchase_request_comments
        WHERE pr_id IN (${placeholders})
        UNION ALL
        SELECT pr_id, actor_id AS source_user_id, created_at
        FROM erp_purchase_request_events
        WHERE pr_id IN (${placeholders})
      ) item
      LEFT JOIN erp_purchase_request_reads read_state
        ON read_state.pr_id = item.pr_id AND read_state.user_id = ?
      WHERE item.created_at > COALESCE(read_state.last_read_at, '')
        AND COALESCE(item.source_user_id, '') != ?
      GROUP BY item.pr_id
    `).all(...prIds, ...prIds, currentUserId, currentUserId);
    const unreadByPr = new Map(unreadRows.map((row) => [row.pr_id, Number(row.count || 0)]));
    for (const pr of purchaseRequests) pr.unreadCount = unreadByPr.get(pr.id) || 0;
  }

  const detailPurchaseRequests = purchaseRequests.filter((pr) => (
    includeRequestDetails || (detailPrId && pr.id === detailPrId)
  ));

  if (detailPurchaseRequests.length) {
    const candidateStmt = db.prepare(`
      SELECT
        candidate.*,
        supplier.name AS linked_supplier_name,
        creator.name AS created_by_name
      FROM erp_sourcing_candidates candidate
      LEFT JOIN erp_suppliers supplier ON supplier.id = candidate.supplier_id
      LEFT JOIN erp_users creator ON creator.id = candidate.created_by
      WHERE candidate.pr_id = ?
      ORDER BY
        CASE candidate.status
          WHEN 'selected' THEN 0
          WHEN 'shortlisted' THEN 1
          WHEN 'candidate' THEN 2
          ELSE 9
        END,
        candidate.updated_at DESC
    `);
    const commentStmt = db.prepare(`
      SELECT *
      FROM erp_purchase_request_comments
      WHERE pr_id = ?
      ORDER BY created_at ASC
    `);
    const eventStmt = db.prepare(`
      SELECT *
      FROM erp_purchase_request_events
      WHERE pr_id = ?
      ORDER BY created_at ASC
    `);

    for (const pr of detailPurchaseRequests) {
      const candidates = candidateStmt.all(pr.id).map((row) => {
        const next = toCamelRow(row);
        next.supplierName = next.supplierName || next.linkedSupplierName || "";
        next.sourcePayload = slimSourcePayloadForUi(parseJsonObject(row.source_payload_json));
        delete next.sourcePayloadJson;
        next.externalSkuOptions = parseJsonArray(row.external_sku_options_json);
        next.externalPriceRanges = parseJsonArray(row.external_price_ranges_json);
        next.inquiryResult = parseJsonObject(row.inquiry_result_json);
        delete next.inquiryResultJson;
        return next;
      });
      const comments = commentStmt.all(pr.id).map(toCamelRow);
      const events = eventStmt.all(pr.id).map(toCamelRow);
      const timeline = [
        ...events.map((item) => ({
          id: item.id,
          kind: "event",
          actorId: item.actorId,
          actorName: item.actorName,
          actorRole: item.actorRole,
          message: item.message,
          eventType: item.eventType,
          createdAt: item.createdAt,
        })),
        ...comments.map((item) => ({
          id: item.id,
          kind: "comment",
          actorId: item.authorId,
          actorName: item.authorName,
          actorRole: item.authorRole,
          message: item.body,
          createdAt: item.createdAt,
        })),
      ].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));

      pr.candidates = candidates;
      pr.comments = comments;
      pr.events = events;
      pr.timeline = timeline;
    }
  }

  const purchaseOrderTotalRow = db.prepare(`
    SELECT COUNT(DISTINCT po.id) AS total
    FROM erp_purchase_orders po
    LEFT JOIN erp_accounts acct ON acct.id = po.account_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_sourcing_candidates cand ON cand.id = po.selected_candidate_id
    LEFT JOIN erp_users creator ON creator.id = po.created_by
    LEFT JOIN erp_purchase_order_lines line ON line.po_id = po.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${poWhereSql}
  `).get(poParams);
  const purchaseOrderStatusCounts = db.prepare(`
    SELECT
      COUNT(*) AS all_count,
      SUM(CASE WHEN ${poDraftSql} THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN ${poPendingPaymentSql} THEN 1 ELSE 0 END) AS pending_payment_count,
      SUM(CASE WHEN ${poActivePaidSql} THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN po.status IN ('inbounded', 'closed') THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN po.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
      SUM(CASE WHEN po.status IN ('delayed', 'exception') THEN 1 ELSE 0 END) AS exception_count,
      SUM(CASE WHEN po.status NOT IN ('closed', 'cancelled') THEN 1 ELSE 0 END) AS open_count
    FROM erp_purchase_orders po
    ${poBaseWhereSql}
  `).get({ account_id: accountId }) || {};
  const purchaseOrderCounts = {
    all: Number(purchaseOrderStatusCounts.all_count || 0),
    draft: Number(purchaseOrderStatusCounts.draft_count || 0),
    pendingPayment: Number(purchaseOrderStatusCounts.pending_payment_count || 0),
    paid: Number(purchaseOrderStatusCounts.paid_count || 0),
    completed: Number(purchaseOrderStatusCounts.completed_count || 0),
    cancelled: Number(purchaseOrderStatusCounts.cancelled_count || 0),
    exception: Number(purchaseOrderStatusCounts.exception_count || 0),
    open: Number(purchaseOrderStatusCounts.open_count || 0),
  };
  const purchaseOrderTotal = Number(purchaseOrderTotalRow?.total || 0);

  const purchaseOrders = includePurchaseOrders ? db.prepare(`
    SELECT
      po.*,
      acct.name AS account_name,
      COALESCE(supplier.name, cand.supplier_name) AS supplier_name,
      COALESCE(creator.name, po.jst_purchaser_name) AS created_by_name,
      pr.status AS pr_status,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code) AS sku_codes,
      GROUP_CONCAT(DISTINCT sku.product_name) AS product_names,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', detail.id,
          'skuId', detail.sku_id,
          'skuCode', detail.internal_sku_code,
          'productName', detail.product_name,
          'specText', detail.color_spec,
          'qty', detail.qty,
          'receivedQty', detail.received_qty,
          'unitCost', detail.unit_cost,
          'logisticsFee', detail.logistics_fee,
          'amount', ROUND(detail.qty * detail.unit_cost, 2),
          'paidAmount', ROUND(detail.qty * detail.unit_cost + detail.logistics_fee, 2)
        ))
        FROM (
          SELECT
            detail_line.id,
            detail_line.sku_id,
            detail_sku.internal_sku_code,
            detail_sku.product_name,
            detail_sku.color_spec,
            COALESCE(detail_line.qty, 0) AS qty,
            COALESCE(detail_line.received_qty, 0) AS received_qty,
            COALESCE(detail_line.unit_cost, 0) AS unit_cost,
            COALESCE(detail_line.logistics_fee, 0) AS logistics_fee
          FROM erp_purchase_order_lines detail_line
          LEFT JOIN erp_skus detail_sku ON detail_sku.id = detail_line.sku_id
          WHERE detail_line.po_id = po.id
          ORDER BY detail_line.id ASC
        ) detail
      ), '[]') AS line_items_json,
      (
        SELECT first_sku.image_url
        FROM erp_purchase_order_lines first_line
        LEFT JOIN erp_skus first_sku ON first_sku.id = first_line.sku_id
        WHERE first_line.po_id = po.id
          AND COALESCE(first_sku.image_url, '') <> ''
        ORDER BY first_line.id ASC
        LIMIT 1
      ) AS sku_image_url,
      COUNT(DISTINCT line.id) AS line_count,
      COALESCE(SUM(line.qty), 0) AS total_qty,
      COALESCE(SUM(line.received_qty), 0) AS received_qty,
      (
        SELECT COUNT(*)
        FROM erp_purchase_order_lines map_line
        JOIN erp_sku_1688_sources map_source
          ON map_source.account_id = map_line.account_id
         AND map_source.sku_id = map_line.sku_id
         AND map_source.status = 'active'
        WHERE map_line.po_id = po.id
      ) AS mapping_count
      ,
      (
        SELECT COUNT(*)
        FROM erp_1688_delivery_addresses addr
        WHERE addr.account_id = po.account_id
          AND addr.status = 'active'
          AND addr.address_id IS NOT NULL
          AND addr.address_id != ''
      ) AS delivery_address_count
      ,
      (
        SELECT COUNT(*)
        FROM erp_1688_refunds refund
        WHERE refund.po_id = po.id
          OR (po.external_order_id IS NOT NULL AND refund.external_order_id = po.external_order_id)
      ) AS refund_count,
      (
        SELECT latest_refund.refund_id
        FROM erp_1688_refunds latest_refund
        WHERE latest_refund.po_id = po.id
          OR (po.external_order_id IS NOT NULL AND latest_refund.external_order_id = po.external_order_id)
        ORDER BY latest_refund.updated_at DESC
        LIMIT 1
      ) AS latest_refund_id,
      (
        SELECT latest_refund.refund_status
        FROM erp_1688_refunds latest_refund
        WHERE latest_refund.po_id = po.id
          OR (po.external_order_id IS NOT NULL AND latest_refund.external_order_id = po.external_order_id)
        ORDER BY latest_refund.updated_at DESC
        LIMIT 1
      ) AS latest_refund_status,
      (
        SELECT latest_refund.refund_amount
        FROM erp_1688_refunds latest_refund
        WHERE latest_refund.po_id = po.id
          OR (po.external_order_id IS NOT NULL AND latest_refund.external_order_id = po.external_order_id)
        ORDER BY latest_refund.updated_at DESC
        LIMIT 1
      ) AS latest_refund_amount,
      (
        SELECT cost_line.unit_cost
        FROM erp_purchase_order_lines cost_line
        WHERE cost_line.po_id = po.id
        ORDER BY cost_line.id ASC
        LIMIT 1
      ) AS unit_cost,
      (
        SELECT fee_line.logistics_fee
        FROM erp_purchase_order_lines fee_line
        WHERE fee_line.po_id = po.id
        ORDER BY fee_line.id ASC
        LIMIT 1
      ) AS logistics_fee
    FROM erp_purchase_orders po
    LEFT JOIN erp_accounts acct ON acct.id = po.account_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_sourcing_candidates cand ON cand.id = po.selected_candidate_id
    LEFT JOIN erp_users creator ON creator.id = po.created_by
    LEFT JOIN erp_purchase_requests pr ON pr.id = po.pr_id
    LEFT JOIN erp_purchase_order_lines line ON line.po_id = po.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${poWhereSql}
    GROUP BY po.id
    ORDER BY ${poOrderSql}
    LIMIT @limit OFFSET @offset
  `).all(poParams).map((row) => {
    const next = toCamelRow(row);
    next.lineItems = normalizePurchaseOrderLineItems(next, parseJsonArray(row.line_items_json));
    delete next.lineItemsJson;
    if (row.account_id === "jst:account:default") {
      const raw = parseJsonObject(row.external_order_payload_json, {});
      const rawQty = Number(raw.qty_count || raw.total_qty || raw.enable_follow_qty || 0);
      if (rawQty > 0 && Number(next.totalQty || 0) <= 0) next.totalQty = rawQty;
      const rawReceived = Number(raw.total_in_qty || raw.plan_arrive_qty || 0);
      if (rawReceived > 0 && Number(next.receivedQty || 0) <= 0) next.receivedQty = rawReceived;
      if (!next.skuSummary) {
        next.skuSummary = [raw.item_type, raw.labels].filter(Boolean).join(" / ") || "聚水潭采购单";
      }
      if (!next.skuCodes) next.skuCodes = raw.merge_sku_id || raw.merge_i_id || "";
      if (!next.productNames) next.productNames = next.skuSummary;
    }
    return next;
  }) : undefined;

  const paymentApprovals = db.prepare(`
    SELECT
      payment.*,
      po.po_no,
      po.status AS po_status,
      po.payment_status AS po_payment_status,
      po.total_amount AS po_total_amount,
      supplier.name AS supplier_name,
      requester.name AS requested_by_name,
      approver.name AS approved_by_name
    FROM erp_payment_approvals payment
    LEFT JOIN erp_purchase_orders po ON po.id = payment.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_users requester ON requester.id = payment.requested_by
    LEFT JOIN erp_users approver ON approver.id = payment.approved_by
    WHERE 1 = 1
      ${paymentWhereAccount}
    ORDER BY
      CASE payment.status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        WHEN 'paid' THEN 2
        WHEN 'rejected' THEN 3
        ELSE 9
      END,
      payment.updated_at DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const paymentQueue = db.prepare(`
    SELECT
      po.id AS po_id,
      po.account_id,
      po.po_no,
      po.status AS po_status,
      po.payment_status AS po_payment_status,
      po.total_amount,
      po.paid_amount,
      po.freight_amount,
      po.expected_delivery_date,
      supplier.name AS supplier_name,
      payment.id AS payment_approval_id,
      payment.amount AS payment_amount,
      payment.status AS payment_approval_status,
      payment.requested_by,
      requester.name AS requested_by_name,
      payment.approved_by,
      approver.name AS approved_by_name,
      payment.approved_at,
      payment.paid_at,
      payment.remark,
      COALESCE(payment.updated_at, po.updated_at) AS updated_at
    FROM erp_purchase_orders po
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_payment_approvals payment ON payment.id = (
      SELECT latest.id
      FROM erp_payment_approvals latest
      WHERE latest.po_id = po.id
      ORDER BY latest.updated_at DESC
      LIMIT 1
    )
    LEFT JOIN erp_users requester ON requester.id = payment.requested_by
    LEFT JOIN erp_users approver ON approver.id = payment.approved_by
    WHERE (
      po.status IN ('pending_finance_approval', 'approved_to_pay')
      OR payment.status IN ('pending', 'approved')
    )
    ${accountId ? "AND po.account_id = @account_id" : ""}
    ORDER BY
      CASE
        WHEN payment.status = 'pending' THEN 0
        WHEN po.status = 'pending_finance_approval' THEN 1
        WHEN payment.status = 'approved' THEN 2
        WHEN po.status = 'approved_to_pay' THEN 3
        ELSE 9
      END,
      COALESCE(payment.updated_at, po.updated_at) DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const purchaseOrdersForSummary = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const summary = {
    purchaseRequestCount: purchaseRequests.length,
    pendingPurchaseRequestCount: purchaseRequests.filter((item) => (
      ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(item.status)
    )).length,
    purchaseOrderCount: purchaseOrderCounts.all,
    openPurchaseOrderCount: purchaseOrderCounts.open,
    paymentApprovalCount: paymentApprovals.length,
    paymentQueueCount: paymentQueue.length,
    paymentQueueAmount: paymentQueue.reduce((sum, item) => (
      sum + Number(item.paymentAmount ?? item.paidAmount ?? item.totalAmount ?? 0)
    ), 0),
    refundOrderCount: purchaseOrdersForSummary.filter((item) => Number(item.refundCount || 0) > 0).length,
    unreadPurchaseRequestCount: purchaseRequests.reduce((sum, item) => (
      sum + Number(item.unreadCount || 0)
    ), 0),
  };

  const skuOptions = includeOptions ? listSkus({ accountId, companyId, limit: 500 }) : undefined;
  const sku1688Sources = includeOptions ? listSku1688Sources({ accountId, limit: 500 }) : undefined;
  const supplierOptions = includeOptions
    ? db.prepare(`
      SELECT id, name
      FROM erp_suppliers
      WHERE company_id = @company_id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 500
    `).all({ company_id: companyId }).map(toCamelRow)
    : undefined;

  if (include1688Meta) {
    ensureDefault1688MessageSubscriptions(db, {
      companyId,
      actor: params.user || erpState.currentUser || {},
    });
    ensureDefault1688DeliveryAddresses(db, {
      companyId,
      actor: params.user || erpState.currentUser || {},
    });
  }

  const alibaba1688Addresses = include1688Meta ? list1688DeliveryAddresses({ status: "active", companyId }) : undefined;
  const alibaba1688MessageSubscriptions = include1688Meta ? list1688MessageSubscriptions(db, { companyId }) : undefined;
  const recent1688MessageEvents = include1688Meta ? list1688MessageEvents(db, { limit: 30 }) : undefined;
  const purchaseSettings = getPurchaseSettings(db, companyId);

  const workbench = {
    generatedAt: nowIso(),
    summary,
    purchaseRequests,
    purchaseOrderCounts,
    purchaseOrderPage: {
      limit: purchaseOrderLimit,
      offset: purchaseOrderOffset,
      total: purchaseOrderTotal,
      queue: purchaseOrderQueue || "all",
      search: purchaseOrderSearch,
      poNo: purchaseOrderNo,
      dateFrom: purchaseOrderDateFrom,
      dateTo: purchaseOrderDateTo,
      purchaser: purchaseOrderPurchaser,
      supplier: purchaseOrderSupplier,
      paymentState: purchaseOrderPaymentState,
      sourceState: purchaseOrderSourceState,
      riskState: purchaseOrderRiskState,
      productCode: purchaseOrderProductCode,
      amountMin: purchaseOrderAmountMin,
      amountMax: purchaseOrderAmountMax,
      sortField: poSortExpression ? purchaseOrderSortField : "",
      sortDirection: poNormalizedSortDirection,
    },
    paymentApprovals,
    paymentQueue,
    purchaseSettings,
  };
  if (includePurchaseOrders) workbench.purchaseOrders = purchaseOrders;
  if (includeOptions) {
    workbench.skuOptions = skuOptions;
    workbench.sku1688Sources = sku1688Sources;
    workbench.supplierOptions = supplierOptions;
  }
  if (include1688Meta) {
    workbench.alibaba1688Addresses = alibaba1688Addresses;
    workbench.alibaba1688MessageSubscriptions = alibaba1688MessageSubscriptions;
    workbench.recent1688MessageEvents = recent1688MessageEvents;
  }
  return workbench;
}

function getPurchaseOrder(db, poId) {
  const row = db.prepare("SELECT * FROM erp_purchase_orders WHERE id = ?").get(poId);
  if (!row) throw new Error(`Purchase order not found: ${poId}`);
  return row;
}

function findLatestPurchaseOrderByRequestId(db, prId) {
  const requestId = optionalString(prId);
  if (!requestId) return null;
  return db.prepare(`
    SELECT *
    FROM erp_purchase_orders
    WHERE pr_id = ?
    ORDER BY
      COALESCE(updated_at, created_at, '') DESC,
      id DESC
    LIMIT 1
  `).get(requestId) || null;
}

function getPurchaseOrderActionRow(db, poId) {
  const id = optionalString(poId);
  if (!id) return null;
  return db.prepare(`
    SELECT
      po.*,
      acct.name AS account_name,
      COALESCE(supplier.name, cand.supplier_name) AS supplier_name,
      COALESCE(creator.name, po.jst_purchaser_name) AS created_by_name,
      pr.status AS pr_status,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code) AS sku_codes,
      GROUP_CONCAT(DISTINCT sku.product_name) AS product_names,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', detail.id,
          'skuId', detail.sku_id,
          'skuCode', detail.internal_sku_code,
          'productName', detail.product_name,
          'specText', detail.color_spec,
          'qty', detail.qty,
          'receivedQty', detail.received_qty,
          'unitCost', detail.unit_cost,
          'logisticsFee', detail.logistics_fee,
          'amount', ROUND(detail.qty * detail.unit_cost, 2),
          'paidAmount', ROUND(detail.qty * detail.unit_cost + detail.logistics_fee, 2)
        ))
        FROM (
          SELECT
            detail_line.id,
            detail_line.sku_id,
            detail_sku.internal_sku_code,
            detail_sku.product_name,
            detail_sku.color_spec,
            COALESCE(detail_line.qty, 0) AS qty,
            COALESCE(detail_line.received_qty, 0) AS received_qty,
            COALESCE(detail_line.unit_cost, 0) AS unit_cost,
            COALESCE(detail_line.logistics_fee, 0) AS logistics_fee
          FROM erp_purchase_order_lines detail_line
          LEFT JOIN erp_skus detail_sku ON detail_sku.id = detail_line.sku_id
          WHERE detail_line.po_id = po.id
          ORDER BY detail_line.id ASC
        ) detail
      ), '[]') AS line_items_json,
      (
        SELECT first_sku.image_url
        FROM erp_purchase_order_lines first_line
        LEFT JOIN erp_skus first_sku ON first_sku.id = first_line.sku_id
        WHERE first_line.po_id = po.id
          AND COALESCE(first_sku.image_url, '') <> ''
        ORDER BY first_line.id ASC
        LIMIT 1
      ) AS sku_image_url,
      COUNT(DISTINCT line.id) AS line_count,
      COALESCE(SUM(line.qty), 0) AS total_qty,
      COALESCE(SUM(line.received_qty), 0) AS received_qty,
      (
        SELECT COUNT(*)
        FROM erp_purchase_order_lines map_line
        JOIN erp_sku_1688_sources map_source
          ON map_source.account_id = map_line.account_id
         AND map_source.sku_id = map_line.sku_id
         AND map_source.status = 'active'
        WHERE map_line.po_id = po.id
      ) AS mapping_count,
      (
        SELECT COUNT(*)
        FROM erp_1688_delivery_addresses addr
        WHERE addr.account_id = po.account_id
          AND addr.status = 'active'
          AND addr.address_id IS NOT NULL
          AND addr.address_id != ''
      ) AS delivery_address_count,
      (
        SELECT cost_line.unit_cost
        FROM erp_purchase_order_lines cost_line
        WHERE cost_line.po_id = po.id
        ORDER BY cost_line.id ASC
        LIMIT 1
      ) AS unit_cost,
      (
        SELECT fee_line.logistics_fee
        FROM erp_purchase_order_lines fee_line
        WHERE fee_line.po_id = po.id
        ORDER BY fee_line.id ASC
        LIMIT 1
      ) AS logistics_fee
    FROM erp_purchase_orders po
    LEFT JOIN erp_accounts acct ON acct.id = po.account_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_sourcing_candidates cand ON cand.id = po.selected_candidate_id
    LEFT JOIN erp_users creator ON creator.id = po.created_by
    LEFT JOIN erp_purchase_requests pr ON pr.id = po.pr_id
    LEFT JOIN erp_purchase_order_lines line ON line.po_id = po.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    WHERE po.id = ?
    GROUP BY po.id
  `).get(id) || null;
}

function toPurchaseOrderResult(db, poOrId) {
  const poId = typeof poOrId === "object" ? poOrId?.id : poOrId;
  const row = getPurchaseOrderActionRow(db, poId);
  const next = toCamelRow(row || (typeof poOrId === "object" ? poOrId : null));
  if (next && typeof next === "object") {
    next.lineItems = normalizePurchaseOrderLineItems(next, parseJsonArray(row?.line_items_json));
    delete next.lineItemsJson;
  }
  return next;
}

function getLatestPaymentApproval(db, payload = {}) {
  const paymentApprovalId = optionalString(payload.paymentApprovalId);
  if (paymentApprovalId) {
    const row = db.prepare("SELECT * FROM erp_payment_approvals WHERE id = ?").get(paymentApprovalId);
    if (!row) throw new Error(`Payment approval not found: ${paymentApprovalId}`);
    return row;
  }

  const poId = requireString(payload.poId, "poId");
  const row = db.prepare(`
    SELECT *
    FROM erp_payment_approvals
    WHERE po_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(poId);
  if (!row) throw new Error(`Payment approval not found for PO: ${poId}`);
  return row;
}

function writePaymentApprovalAudit({ services, before, after, actor, action }) {
  services.workflow.writeAudit({
    accountId: after.account_id || before?.account_id || null,
    actor,
    action,
    entityType: "payment_approval",
    entityId: after.id,
    before,
    after,
  });
}

const PAYMENT_SUBMITTED_PO_STATUSES = new Set([
  "approved_to_pay",
  "paid",
  "supplier_processing",
  "shipped",
  "arrived",
  "inbounded",
  "closed",
]);
const PAYMENT_PAID_OR_LATER_PO_STATUSES = new Set([
  "paid",
  "supplier_processing",
  "shipped",
  "arrived",
  "inbounded",
  "closed",
]);

function isPaymentSubmittedPurchaseOrder(po = {}) {
  return PAYMENT_SUBMITTED_PO_STATUSES.has(String(po.status || ""));
}

function isPaidOrLaterPurchaseOrder(po = {}) {
  return PAYMENT_PAID_OR_LATER_PO_STATUSES.has(String(po.status || ""))
    || String(po.payment_status || "") === "paid";
}

function noOpPurchaseOrderTransition(po = {}, action = "") {
  return {
    entityType: "purchase_order",
    id: po.id,
    action,
    fromStatus: po.status,
    toStatus: po.status,
    before: po,
    after: po,
    idempotent: true,
  };
}

function createPaymentApprovalForPo({ db, services, po, payload, actor }) {
  const now = nowIso();
  const amount = optionalNumber(payload.amount) ?? optionalNumber(po.paid_amount) ?? Number(po.total_amount || 0);
  // 已删除财务审批环节：审批记录创建即视为已批准，保留作为审计 / 付款追溯凭据。
  const row = {
    id: optionalString(payload.paymentApprovalId) || createId("pay"),
    account_id: po.account_id,
    po_id: po.id,
    amount,
    status: "approved",
    requested_by: actor.id || null,
    approved_by: actor.id || null,
    approved_at: now,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_payment_approvals (
      id, account_id, po_id, amount, status, requested_by,
      approved_by, approved_at, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @po_id, @amount, @status, @requested_by,
      @approved_by, @approved_at, @created_at, @updated_at
    )
  `).run(row);

  const after = db.prepare("SELECT * FROM erp_payment_approvals WHERE id = ?").get(row.id);
  writePaymentApprovalAudit({
    services,
    before: null,
    after,
    actor,
    action: "create_payment_approval",
  });
  writePurchaseOrderFlowEvent(db, po, actor, "submit_payment_approval", `采购提交付款：${po.po_no || po.id}`);
  return after;
}

function approvePaymentApproval({ db, services, payload, actor }) {
  const before = getLatestPaymentApproval(db, payload);
  if (before.status !== "pending") {
    throw new Error(`Payment approval is not pending: ${before.status}`);
  }

  services.purchase.approvePayment(before.po_id, actor);
  const now = nowIso();
  db.prepare(`
    UPDATE erp_payment_approvals
    SET status = 'approved',
        approved_by = @approved_by,
        approved_at = @approved_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: before.id,
    approved_by: actor.id || null,
    approved_at: now,
    updated_at: now,
  });
  const after = db.prepare("SELECT * FROM erp_payment_approvals WHERE id = ?").get(before.id);
  writePaymentApprovalAudit({
    services,
    before,
    after,
    actor,
    action: "approve_payment_approval",
  });
  const po = getPurchaseOrder(db, after.po_id);
  writePurchaseOrderFlowEvent(db, po, actor, "approve_payment", `财务确认付款申请：${po.po_no || po.id}`);
  return after;
}

// 桥接 PO → 入库单：付款确认后自动建一条 inbound_receipt（status=pending_arrival），
// 让 PO 同步出现在仓库中心，库管不用再手工新建入库单。
// 已存在则跳过；明细行从 erp_purchase_order_lines 拷贝 expected_qty。
// 生成入库单号：6 位纯数字账号内自增序号（000001、000002 …）。
// 历史数据若已有 6 位纯数字，从最大值 +1 开始；超过 999999 自动溢出到 7 位。
function markPaymentApprovalApproved({ db, services, before, actor }) {
  if (!before || before.status === "approved" || before.status === "paid") return before || null;
  const now = nowIso();
  db.prepare(`
    UPDATE erp_payment_approvals
    SET status = 'approved',
        approved_by = @approved_by,
        approved_at = @approved_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: before.id,
    approved_by: actor.id || null,
    approved_at: now,
    updated_at: now,
  });
  const after = db.prepare("SELECT * FROM erp_payment_approvals WHERE id = ?").get(before.id);
  writePaymentApprovalAudit({
    services,
    before,
    after,
    actor,
    action: "approve_payment_approval",
  });
  return after;
}

function markPaymentApprovalPaid({ db, services, before, payload = {}, actor }) {
  if (!before) return null;
  if (before.status === "paid") return before;
  const now = nowIso();
  db.prepare(`
    UPDATE erp_payment_approvals
    SET status = 'paid',
        paid_at = @paid_at,
        payment_method = COALESCE(@payment_method, payment_method),
        payment_reference = COALESCE(@payment_reference, payment_reference),
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: before.id,
    paid_at: now,
    payment_method: optionalString(payload.paymentMethod),
    payment_reference: optionalString(payload.paymentReference),
    updated_at: now,
  });
  const after = db.prepare("SELECT * FROM erp_payment_approvals WHERE id = ?").get(before.id);
  writePaymentApprovalAudit({
    services,
    before,
    after,
    actor,
    action: "confirm_payment_paid",
  });
  const po = getPurchaseOrder(db, after.po_id);
  writePurchaseOrderFlowEvent(db, po, actor, "confirm_paid", `财务确认已付款：${po.po_no || po.id}`);
  return after;
}

function ensurePaymentApprovalForPo({ db, services, po, payload = {}, actor, status = "approved" }) {
  let paymentApproval = findLatestPaymentApprovalByPoId(db, po.id);
  if (!paymentApproval) {
    paymentApproval = createPaymentApprovalForPo({ db, services, po, payload, actor });
  }
  if (status === "paid") {
    paymentApproval = markPaymentApprovalApproved({ db, services, before: paymentApproval, actor }) || paymentApproval;
    paymentApproval = markPaymentApprovalPaid({ db, services, before: paymentApproval, payload, actor }) || paymentApproval;
  } else {
    paymentApproval = markPaymentApprovalApproved({ db, services, before: paymentApproval, actor }) || paymentApproval;
  }
  return paymentApproval;
}

function generateInboundReceiptNo(db, accountId) {
  const row = db.prepare(
    "SELECT receipt_no FROM erp_inbound_receipts WHERE account_id = @account_id AND receipt_no GLOB '[0-9]*' ORDER BY CAST(receipt_no AS INTEGER) DESC LIMIT 1"
  ).get({ account_id: accountId });
  let nextSeq = 1;
  if (row?.receipt_no) {
    const n = parseInt(row.receipt_no, 10);
    if (Number.isFinite(n)) nextSeq = n + 1;
  }
  return String(nextSeq).padStart(6, "0");
}

function ensureInboundReceiptForPo(db, services, po, actor) {
  if (!po || !po.id) return null;
  const existing = db.prepare("SELECT id, status FROM erp_inbound_receipts WHERE po_id = ? LIMIT 1").get(po.id);
  if (existing) return existing;
  const lines = getPurchaseOrderLines(db, po.id);
  if (!lines.length) return null;
  const now = nowIso();
  const receiptId = createId("ir");
  const receiptNo = generateInboundReceiptNo(db, po.account_id, now);
  try {
    db.prepare(`
      INSERT INTO erp_inbound_receipts (
        id, account_id, po_id, receipt_no, status, created_at, updated_at
      ) VALUES (
        @id, @account_id, @po_id, @receipt_no, 'pending_arrival', @now, @now
      )
    `).run({
      id: receiptId,
      account_id: po.account_id,
      po_id: po.id,
      receipt_no: receiptNo,
      now,
    });
  } catch (e) {
    // 某些罕见情形（receipt_no 重复 / FK 失败等），让付款流程继续，不阻塞。
    return { error: e?.message || String(e) };
  }
  const insertLine = db.prepare(`
    INSERT INTO erp_inbound_receipt_lines (
      id, account_id, receipt_id, po_line_id, sku_id, expected_qty, received_qty
    ) VALUES (
      @id, @account_id, @receipt_id, @po_line_id, @sku_id, @expected_qty, 0
    )
  `);
  for (const line of lines) {
    if (!line.sku_id) continue;
    insertLine.run({
      id: createId("irl"),
      account_id: po.account_id,
      receipt_id: receiptId,
      po_line_id: line.id,
      sku_id: line.sku_id,
      expected_qty: Number(line.qty || 0),
    });
  }
  try {
    services.workflow.writeAudit({
      accountId: po.account_id,
      actor,
      action: "auto_create_inbound_receipt",
      entityType: "inbound_receipt",
      entityId: receiptId,
      before: null,
      after: { id: receiptId, po_id: po.id, status: "pending_arrival" },
    });
  } catch {}
  writePurchaseOrderFlowEvent(db, po, actor, "auto_create_inbound_receipt", `付款后自动生成入库单：${receiptNo}`);
  return { id: receiptId, isNew: true };
}

function confirmPaymentPaid({ db, services, payload, actor }) {
  const poId = optionalString(payload.poId || payload.id);
  let before = null;
  try {
    before = getLatestPaymentApproval(db, payload);
  } catch (error) {
    if (!poId || !/Payment approval not found/i.test(String(error?.message || ""))) throw error;
    const po = getPurchaseOrder(db, poId);
    if (po.status !== "approved_to_pay" && !isPaidOrLaterPurchaseOrder(po)) throw error;
    before = ensurePaymentApprovalForPo({
      db,
      services,
      po,
      payload,
      actor,
      status: isPaidOrLaterPurchaseOrder(po) ? "paid" : "approved",
    });
  }

  const currentPo = getPurchaseOrder(db, before.po_id);
  if (isPaidOrLaterPurchaseOrder(currentPo)) {
    const alreadyPaid = ensurePaymentApprovalForPo({ db, services, po: currentPo, payload, actor, status: "paid" });
    try {
      ensureInboundReceiptForPo(db, services, currentPo, actor);
    } catch (e) {
      try { console.warn("[purchase] auto-create inbound receipt failed:", e?.message || e); } catch {}
    }
    return alreadyPaid;
  }
  if (before.status !== "approved") {
    throw new Error(`Payment approval is not approved: ${before.status}`);
  }

  services.purchase.confirmPaid(before.po_id, actor);
  const after = markPaymentApprovalPaid({ db, services, before, payload, actor });
  const paidAmount = optionalNumber(payload.amount) ?? optionalNumber(after?.amount);
  if (paidAmount !== null) {
    db.prepare(`
      UPDATE erp_purchase_orders
      SET paid_amount = COALESCE(paid_amount, @paid_amount)
      WHERE id = @id
    `).run({
      id: before.po_id,
      paid_amount: paidAmount,
    });
  }
  // 同步建对应入库单（仓库中心立即可见）；失败不阻塞付款确认。
  try {
    const po = getPurchaseOrder(db, before.po_id);
    if (po) ensureInboundReceiptForPo(db, services, po, actor);
  } catch (e) {
    // 仅日志，不影响付款流程
    try { console.warn("[purchase] auto-create inbound receipt failed:", e?.message || e); } catch {}
  }
  return after;
}

function findLatestPaymentApprovalByPoId(db, poId) {
  return db.prepare(`
    SELECT *
    FROM erp_payment_approvals
    WHERE po_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(poId) || null;
}

function getPurchaseOrderReceivedQty(db, poId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(received_qty), 0) AS received_qty
    FROM erp_purchase_order_lines
    WHERE po_id = ?
  `).get(poId);
  return Number(row?.received_qty || 0);
}

function getPurchaseOrderQtySummary(db, poId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(COALESCE(expected_qty, qty, 0)), 0) AS total_qty,
      COALESCE(SUM(received_qty), 0) AS received_qty
    FROM erp_purchase_order_lines
    WHERE po_id = ?
  `).get(poId);
  return {
    totalQty: Number(row?.total_qty || 0),
    receivedQty: Number(row?.received_qty || 0),
  };
}

function has1688OrderTrace(po = {}) {
  if (optionalString(po.external_order_id)) return true;
  const status = optionalString(po.external_order_status);
  return Boolean(status && !["previewed", "price_change_requested"].includes(status));
}

function getRollbackPurchaseOrderTarget(po, receivedQty = 0) {
  const status = String(po?.status || "");
  if (status === "pushed_pending_price") {
    if (has1688OrderTrace(po)) {
      throw new Error("采购单已有 1688 推单记录，不能回退到草稿后重复下单");
    }
    return "draft";
  }
  if (status === "pending_finance_approval") {
    return has1688OrderTrace(po) ? "pushed_pending_price" : "draft";
  }
  // 跳过财务审批，approved_to_pay 直接退回 pushed_pending_price。
  if (status === "approved_to_pay") return "pushed_pending_price";
  if (status === "paid") return "approved_to_pay";
  if (status === "supplier_processing") return "paid";
  if (status === "shipped") return "supplier_processing";
  if (status === "arrived") {
    if (Number(receivedQty || 0) > 0) {
      throw new Error("该采购单已有入库数量，不能直接回退到发货前状态");
    }
    return "shipped";
  }
  return null;
}

function getRollbackPaymentPatch(fromStatus, toStatus) {
  if (fromStatus === "pending_finance_approval") {
    return {
      status: "rejected",
      approved_by: null,
      approved_at: null,
      paid_at: null,
      payment_method: null,
      payment_reference: null,
    };
  }
  if (fromStatus === "approved_to_pay" && toStatus === "pending_finance_approval") {
    return {
      status: "pending",
      approved_by: null,
      approved_at: null,
      paid_at: null,
      payment_method: null,
      payment_reference: null,
    };
  }
  if (fromStatus === "paid" && toStatus === "approved_to_pay") {
    return {
      status: "approved",
      paid_at: null,
      payment_method: null,
      payment_reference: null,
    };
  }
  return null;
}

function updatePaymentApprovalForRollback({ db, services, po, fromStatus, toStatus, actor }) {
  const patch = getRollbackPaymentPatch(fromStatus, toStatus);
  if (!patch) return null;
  const before = findLatestPaymentApprovalByPoId(db, po.id);
  if (!before) return null;

  const now = nowIso();
  const patched = (key) => (Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : before[key]);
  db.prepare(`
    UPDATE erp_payment_approvals
    SET status = @status,
        approved_by = @approved_by,
        approved_at = @approved_at,
        paid_at = @paid_at,
        payment_method = @payment_method,
        payment_reference = @payment_reference,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: before.id,
    status: patched("status"),
    approved_by: patched("approved_by") || null,
    approved_at: patched("approved_at") || null,
    paid_at: patched("paid_at") || null,
    payment_method: patched("payment_method") || null,
    payment_reference: patched("payment_reference") || null,
    updated_at: now,
  });
  const after = db.prepare("SELECT * FROM erp_payment_approvals WHERE id = ?").get(before.id);
  writePaymentApprovalAudit({
    services,
    before,
    after,
    actor,
    action: "rollback_payment_approval",
  });
  return after;
}

function getPaymentStatusAfterRollback(targetStatus, currentPaymentStatus) {
  if (["draft", "pushed_pending_price", "pending_finance_approval", "approved_to_pay"].includes(targetStatus)) {
    return "unpaid";
  }
  return currentPaymentStatus || "unpaid";
}

function rollbackPurchaseOrderStatusAction({ db, services, payload, actor }) {
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrder(db, poId);
  const receivedQty = getPurchaseOrderReceivedQty(db, poId);
  const targetStatus = optionalString(payload.toStatus) || getRollbackPurchaseOrderTarget(po, receivedQty);
  if (!targetStatus) {
    throw new Error(`当前采购单状态不能回退：${po.status}`);
  }
  if (targetStatus === "draft" && has1688OrderTrace(po)) {
    throw new Error("采购单已有 1688 推单记录，不能回退到草稿后重复下单");
  }
  const transition = services.workflow.transition({
    entityType: "purchase_order",
    id: po.id,
    action: "rollback_po_status",
    toStatus: targetStatus,
    actor,
    patch: {
      payment_status: getPaymentStatusAfterRollback(targetStatus, po.payment_status),
    },
  });
  const paymentApproval = updatePaymentApprovalForRollback({
    db,
    services,
    po,
    fromStatus: po.status,
    toStatus: targetStatus,
    actor,
  });
  const afterPo = getPurchaseOrder(db, po.id);
  return {
    transition,
    paymentApproval: paymentApproval ? toCamelRow(paymentApproval) : null,
    purchaseOrder: toCamelRow(afterPo),
  };
}

function countPurchaseOrderInboundLineRefs(db, poId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM erp_inbound_receipt_lines line
    JOIN erp_purchase_order_lines po_line ON po_line.id = line.po_line_id
    WHERE po_line.po_id = ?
  `).get(poId);
  return Number(row?.count || 0);
}

function deletePurchaseOrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "删除采购单");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = db.prepare("SELECT * FROM erp_purchase_orders WHERE id = ?").get(poId);
  if (!po) {
    return {
      deleted: true,
      alreadyMissing: true,
      poId,
    };
  }
  const lines = db.prepare("SELECT * FROM erp_purchase_order_lines WHERE po_id = ?").all(po.id);
  const blockers = [];
  const status = optionalString(po.status);
  const paymentStatus = optionalString(po.payment_status) || "unpaid";
  const externalOrderStatus = optionalString(po.external_order_status);
  // cancelled / orphan_cleared 是死单，跳过 1688 / 付款审批 / 售后记录的"已有"校验，
  // 让用户能清理掉历史死数据；但仍硬阻止有"入库单 / 入库明细 / 库存批次"的删除，
  // 防止创建 orphan 库存。
  const isClearable = status === "cancelled" || externalOrderStatus === "orphan_cleared";
  if (!isClearable) {
    if (status !== "draft") blockers.push(`当前状态为 ${status || "-"}`);
    if (paymentStatus !== "unpaid") blockers.push(`付款状态为 ${paymentStatus}`);
    if (has1688OrderTrace(po)) blockers.push("已有 1688 订单记录");
    const paymentApprovalCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_payment_approvals WHERE po_id = ?").get(po.id)?.count || 0);
    if (paymentApprovalCount > 0) blockers.push("已有付款审批记录");
    const refundCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_1688_refunds WHERE po_id = ?").get(po.id)?.count || 0);
    if (refundCount > 0) blockers.push("已有售后记录");
  }
  if (getPurchaseOrderReceivedQty(db, po.id) > 0) blockers.push("已有入库数量");
  const inboundReceiptCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_inbound_receipts WHERE po_id = ?").get(po.id)?.count || 0);
  if (inboundReceiptCount > 0) blockers.push("已有入库单");
  const inboundLineCount = countPurchaseOrderInboundLineRefs(db, po.id);
  if (inboundLineCount > 0) blockers.push("已有入库明细");
  const batchCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_inventory_batches WHERE po_id = ?").get(po.id)?.count || 0);
  if (batchCount > 0) blockers.push("已有库存批次");
  if (blockers.length) {
    throw new Error(`采购单不能删除：${blockers.join("、")}`);
  }
  // 死单清理：把关联的付款审批 / 1688 退款记录一并清掉（已经做了"硬阻断"的入库类除外）
  if (isClearable) {
    db.prepare("DELETE FROM erp_payment_approvals WHERE po_id = ?").run(po.id);
    db.prepare("DELETE FROM erp_1688_refunds WHERE po_id = ?").run(po.id);
  }

  let reopenedPurchaseRequest = null;
  const beforePayload = {
    purchaseOrder: po,
    lines,
  };
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "delete_purchase_order",
    entityType: "purchase_order",
    entityId: po.id,
    before: beforePayload,
    after: null,
  });

  db.prepare("DELETE FROM erp_purchase_order_lines WHERE po_id = ?").run(po.id);
  db.prepare("DELETE FROM erp_purchase_orders WHERE id = ?").run(po.id);
  const now = nowIso();
  const resolvedWorkItems = db.prepare(`
    UPDATE erp_work_items
    SET status = 'done',
        updated_at = @updated_at,
        resolved_at = COALESCE(resolved_at, @updated_at)
    WHERE related_doc_type = 'purchase_order'
      AND related_doc_id = @po_id
      AND status NOT IN ('done', 'dismissed')
  `).run({
    po_id: po.id,
    updated_at: now,
  }).changes;

  if (po.pr_id) {
    const remainingPoCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM erp_purchase_orders
      WHERE pr_id = ?
    `).get(po.pr_id)?.count || 0);
    const pr = getPurchaseRequest(db, po.pr_id);
    if (remainingPoCount === 0 && pr.status === "converted_to_po") {
      const beforePr = { ...pr };
      db.prepare(`
        UPDATE erp_purchase_requests
        SET status = 'sourced',
            updated_at = @updated_at
        WHERE id = @id
      `).run({
        id: pr.id,
        updated_at: now,
      });
      const afterPr = getPurchaseRequest(db, pr.id);
      services.workflow.writeAudit({
        accountId: afterPr.account_id,
        actor,
        action: "reopen_purchase_request_after_delete_po",
        entityType: "purchase_request",
        entityId: afterPr.id,
        before: beforePr,
        after: afterPr,
      });
      reopenedPurchaseRequest = toCamelRow(afterPr);
    }
    const latestPr = getPurchaseRequest(db, po.pr_id);
    writePurchaseRequestEvent(db, latestPr, actor, "delete_po", `采购单已删除：${po.po_no}`);
    markPurchaseRequestRead(db, po.pr_id, actor);
  }

  return {
    deleted: true,
    purchaseOrder: toCamelRow(po),
    purchaseRequest: reopenedPurchaseRequest,
    deletedLineCount: lines.length,
    resolvedWorkItemCount: resolvedWorkItems,
  };
}

function normalizeActor(actorInput = {}) {
  return {
    id: optionalString(actorInput.id),
    role: requireString(actorInput.role, "actor.role"),
  };
}

function parseEvidenceList(payload = {}) {
  if (Array.isArray(payload.evidence)) {
    return payload.evidence.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = optionalString(payload.evidenceText || payload.evidenceLines);
  if (!text) return [];
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function createPurchaseRequestAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["operations", "manager", "admin"], "新建采购需求");
  const skuId = requireString(payload.skuId, "skuId");
  const sku = db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(skuId);
  if (!sku) throw new Error(`SKU not found: ${skuId}`);

  const companyId = normalizeCompanyId(sku.company_id || payload.companyId || payload.company_id, actor);
  let accountId = optionalString(payload.accountId || payload.account_id) || optionalString(sku.account_id);
  if (!accountId) {
    const accounts = listAccounts({ companyId, limit: 2 }).filter((account) => account.status !== "blocked");
    if (accounts.length === 1) {
      accountId = accounts[0].id;
    } else if (accounts.length === 0) {
      throw new Error("请先创建采购店铺，再提交采购单");
    } else {
      throw new Error("该商品资料未绑定采购店铺，请先到商品资料补充店铺");
    }
  }
  const account = db.prepare("SELECT id, company_id FROM erp_accounts WHERE id = ?").get(accountId);
  if (!account) throw new Error("采购店铺不存在");
  if (account.company_id !== companyId) throw new Error("采购店铺不属于当前公司");
  const now = nowIso();
  const uploadedImageUrls = saveErpImageUploads(db, payload, "purchase-images");
  const manualImageUrls = [
    ...(Array.isArray(payload.imageUrls) ? payload.imageUrls.map((value) => optionalString(value)).filter(Boolean) : []),
    optionalString(payload.imageUrl || payload.imgUrl),
  ].filter(Boolean);
  const purchaseImageUrls = [...uploadedImageUrls, ...manualImageUrls];
  const purchaseImageUrl = purchaseImageUrls[0] || null;
  const evidence = parseEvidenceList(payload);
  if (purchaseImageUrls.length) {
    purchaseImageUrls.slice().reverse().forEach((imageUrl, index) => {
      const label = purchaseImageUrls.length > 1 ? `采购图片${purchaseImageUrls.length - index}` : "采购图片";
      evidence.unshift(`${label}：${imageUrl}`);
    });
    if (!optionalString(sku.image_url)) {
      db.prepare(`
        UPDATE erp_skus
        SET image_url = @image_url,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
        id: skuId,
        image_url: purchaseImageUrl,
        updated_at: now,
      });
    }
  }
  const row = {
    id: optionalString(payload.id) || createId("pr"),
    account_id: accountId,
    sku_id: skuId,
    requested_by: actor.id || null,
    reason: requireString(payload.reason, "reason"),
    spec_text: optionalString(payload.specText || payload.spec_text),
    requested_qty: Number(requireString(payload.requestedQty, "requestedQty")),
    target_unit_cost: optionalNumber(payload.targetUnitCost),
    expected_arrival_date: optionalString(payload.expectedArrivalDate),
    evidence_json: JSON.stringify(evidence),
    status: "submitted",
    created_at: now,
    updated_at: now,
  };
  if (!Number.isInteger(row.requested_qty) || row.requested_qty <= 0) {
    throw new Error("requestedQty must be a positive integer");
  }

  db.prepare(`
    INSERT INTO erp_purchase_requests (
      id, account_id, sku_id, requested_by, reason, spec_text, requested_qty,
      target_unit_cost, expected_arrival_date, evidence_json, status, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @sku_id, @requested_by, @reason, @spec_text, @requested_qty,
      @target_unit_cost, @expected_arrival_date, @evidence_json, @status, @created_at, @updated_at
    )
  `).run(row);

  const after = getPurchaseRequest(db, row.id);
  services.workflow.writeAudit({
    accountId,
    actor,
    action: "create_purchase_request",
    entityType: "purchase_request",
    entityId: row.id,
    before: null,
    after,
  });
  writePurchaseRequestEvent(db, after, actor, "create_request", "运营新建采购需求");
  markPurchaseRequestRead(db, row.id, actor);
  return toPurchaseRequest(after);
}

function addSourcingCandidateAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "报价反馈");
  const prId = requireString(payload.prId || payload.id, "prId");
  let pr = getPurchaseRequest(db, prId);

  if (pr.status === "submitted") {
    services.purchase.acceptRequest(prId, actor);
    pr = getPurchaseRequest(db, prId);
    writePurchaseRequestEvent(db, pr, actor, "accept_request", "采购接收需求");
  }

  const supplierId = optionalString(payload.supplierId);
  const supplier = supplierId ? db.prepare("SELECT * FROM erp_suppliers WHERE id = ?").get(supplierId) : null;
  const now = nowIso();
  const row = {
    id: optionalString(payload.candidateId) || createId("source"),
    account_id: pr.account_id,
    pr_id: pr.id,
    purchase_source: supplierId ? "existing_supplier" : (optionalString(payload.purchaseSource) || "other_manual"),
    sourcing_method: "manual",
    supplier_id: supplierId,
    supplier_name: optionalString(payload.supplierName) || supplier?.name || "",
    product_title: optionalString(payload.productTitle),
    product_url: optionalString(payload.productUrl),
    image_url: optionalString(payload.imageUrl),
    unit_price: optionalNumber(payload.unitPrice) ?? 0,
    moq: Number(optionalNumber(payload.moq) ?? 1),
    lead_days: optionalNumber(payload.leadDays),
    logistics_fee: optionalNumber(payload.logisticsFee) ?? 0,
    remark: optionalString(payload.remark),
    status: "candidate",
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };
  if (!row.supplier_name) throw new Error("supplierName is required");
  if (!Number.isFinite(row.unit_price) || row.unit_price < 0) throw new Error("unitPrice must be greater than or equal to 0");
  if (!Number.isInteger(row.moq) || row.moq <= 0) throw new Error("moq must be a positive integer");

  db.prepare(`
    INSERT INTO erp_sourcing_candidates (
      id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
      product_title, product_url, image_url, unit_price, moq, lead_days,
      logistics_fee, remark, status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @purchase_source, @sourcing_method, @supplier_id, @supplier_name,
      @product_title, @product_url, @image_url, @unit_price, @moq, @lead_days,
      @logistics_fee, @remark, @status, @created_by, @created_at, @updated_at
    )
  `).run(row);

  const afterCandidate = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(row.id);
  services.workflow.writeAudit({
    accountId: pr.account_id,
    actor,
    action: "add_sourcing_candidate",
    entityType: "sourcing_candidate",
    entityId: row.id,
    before: null,
    after: afterCandidate,
  });

  if (pr.status === "buyer_processing") {
    services.purchase.markRequestSourced(prId, actor);
    pr = getPurchaseRequest(db, prId);
  }

  writePurchaseRequestEvent(db, pr, actor, "quote_feedback", `采购反馈报价：${row.supplier_name} ¥${Number(row.unit_price).toFixed(2)}`);
  const feedback = optionalString(payload.feedback || payload.remark);
  if (feedback) addPurchaseRequestComment(db, pr, actor, feedback);
  markPurchaseRequestRead(db, pr.id, actor);
  return toCamelRow(afterCandidate);
}

function extract1688OfferIdFromUrl(value) {
  const text = optionalString(value);
  if (!text) return "";
  const matched = text.match(/\/offer\/(\d+)(?:\.html)?/i)
    || text.match(/[?&](?:offerId|offerID|productId|productID|id)=(\d+)/i);
  return matched ? matched[1] : "";
}

function normalizeCandidateProductUrlForDedupe(value) {
  const text = optionalString(value);
  if (!text) return "";
  const offerId = extract1688OfferIdFromUrl(text);
  if (offerId) return `https://detail.1688.com/offer/${offerId}.html`;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return text.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function sourcingCandidateDedupeKey(candidate = {}) {
  const offerId = optionalString(candidate.external_offer_id || candidate.externalOfferId)
    || extract1688OfferIdFromUrl(candidate.product_url || candidate.productUrl);
  if (offerId) return `offer:${offerId}`;
  const productUrl = normalizeCandidateProductUrlForDedupe(candidate.product_url || candidate.productUrl);
  return productUrl ? `url:${productUrl}` : "";
}

function loadSourcingCandidateDedupeMap(db, prId) {
  const rows = db.prepare(`
    SELECT id, external_offer_id, product_url
    FROM erp_sourcing_candidates
    WHERE pr_id = ?
  `).all(prId);
  const map = new Map();
  for (const row of rows) {
    const key = sourcingCandidateDedupeKey(row);
    if (key && !map.has(key)) map.set(key, row.id);
  }
  return map;
}

function findNestedCandidateValue(value, keys, depth = 0) {
  if (!value || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedCandidateValue(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of keys) {
    const candidate = optionalString(value[key]);
    if (candidate) return candidate;
  }
  for (const item of Object.values(value)) {
    const found = findNestedCandidateValue(item, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function infer1688CandidateSpecId(item = {}) {
  return optionalString(
    item.externalSpecId
      || item.external_spec_id
      || item.specId
      || item.specID
      || item.spec_id
      || item.cargoSkuId
      || item.cargoSkuID
      || item.cargo_sku_id,
  ) || findNestedCandidateValue(item.raw || item, [
    "specId",
    "specID",
    "spec_id",
    "cargoSkuId",
    "cargoSkuID",
    "cargo_sku_id",
    "mainPriceSkuId",
    "skuId",
    "skuID",
    "sku_id",
    "offerSkuId",
    "offer_sku_id",
  ]);
}

function infer1688CandidateSkuId(item = {}) {
  return optionalString(
    item.externalSkuId
      || item.external_sku_id
      || item.skuId
      || item.skuID
      || item.sku_id,
  ) || infer1688CandidateSpecId(item);
}

function insert1688SourcingCandidate(db, services, pr, actor, item = {}, options = {}) {
  const now = nowIso();
  const auditAction = optionalString(item.auditAction) || "source_1688_keyword";
  const externalSkuId = infer1688CandidateSkuId(item);
  const externalSpecId = infer1688CandidateSpecId(item);
  const row = {
    id: createId("source"),
    account_id: pr.account_id,
    pr_id: pr.id,
    purchase_source: enums.PURCHASE_SOURCE.SOURCE_1688_OFFICIAL,
    sourcing_method: enums.SOURCING_METHOD.OFFICIAL_API,
    supplier_id: null,
    supplier_name: optionalString(item.supplierName) || "1688 Supplier",
    product_title: optionalString(item.productTitle),
    product_url: optionalString(item.productUrl),
    image_url: optionalString(item.imageUrl),
    unit_price: optionalNumber(item.unitPrice) ?? 0,
    moq: Math.max(1, Math.floor(Number(optionalNumber(item.moq) ?? 1))),
    lead_days: optionalNumber(item.leadDays),
    logistics_fee: optionalNumber(item.logisticsFee) ?? 0,
    remark: optionalString(item.remark),
    status: "candidate",
    created_by: actor.id || null,
    external_offer_id: optionalString(item.externalOfferId),
    external_sku_id: externalSkuId,
    external_spec_id: externalSpecId,
    source_payload_json: trimJsonForStorage(item.raw || item),
    created_at: now,
    updated_at: now,
  };
  const dedupeKey = sourcingCandidateDedupeKey(row);
  const dedupeMap = options.dedupeMap;
  if (dedupeKey && dedupeMap?.has(dedupeKey)) return null;

  db.prepare(`
    INSERT INTO erp_sourcing_candidates (
      id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
      product_title, product_url, image_url, unit_price, moq, lead_days,
      logistics_fee, remark, status, created_by, external_offer_id, external_sku_id,
      external_spec_id, source_payload_json, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @purchase_source, @sourcing_method, @supplier_id, @supplier_name,
      @product_title, @product_url, @image_url, @unit_price, @moq, @lead_days,
      @logistics_fee, @remark, @status, @created_by, @external_offer_id, @external_sku_id,
      @external_spec_id, @source_payload_json, @created_at, @updated_at
    )
  `).run(row);
  if (dedupeKey) dedupeMap?.set(dedupeKey, row.id);

  const afterCandidate = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(row.id);
  services.workflow.writeAudit({
    accountId: pr.account_id,
    actor,
    action: auditAction,
    entityType: "sourcing_candidate",
    entityId: row.id,
    before: null,
    after: afterCandidate,
  });
  // Slim: 别把 1688 web mtop 的 raw 字段塞进 action 响应，否则 10 个候选就 200KB+，
  // 客户端渲染时还会撞 IPC 结构化克隆瓶颈。
  const camelCandidate = toCamelRow(afterCandidate);
  if (camelCandidate?.sourcePayloadJson) {
    try {
      const parsed = slimSourcePayloadForUi(JSON.parse(camelCandidate.sourcePayloadJson));
      camelCandidate.sourcePayloadJson = JSON.stringify(parsed);
    } catch {}
  }
  return camelCandidate;
}

async function source1688KeywordAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 API sourcing");
  const prId = requireString(payload.prId || payload.id, "prId");
  let pr = getPurchaseRequest(db, prId);
  const sku = db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(pr.sku_id);
  if (!sku) throw new Error(`SKU not found: ${pr.sku_id}`);

  const { query, apiParams } = build1688KeywordSearchParams(payload, pr, sku);
  const mockResults = Array.isArray(payload.mockResults) ? payload.mockResults : null;
  let normalized = [];
  let rawResponse = null;
  if (mockResults) {
    rawResponse = { mock: true, result: { data: mockResults } };
    normalized = normalize1688SearchResponse(rawResponse);
  } else {
    rawResponse = await call1688ProcurementApi({
      db,
      actor,
      accountId: pr.account_id,
      action: "source_1688_keyword",
      api: PROCUREMENT_APIS.KEYWORD_SEARCH,
      params: apiParams,
    });
    normalized = normalize1688SearchResponse(rawResponse);
  }

  const maxImport = Math.max(1, Math.min(Number(optionalNumber(payload.importLimit) ?? normalized.length), 20));
  const candidatesToImport = normalized.slice(0, maxImport);
  const insertCandidates = db.transaction(() => {
    if (pr.status === "submitted") {
      services.purchase.acceptRequest(prId, actor);
      pr = getPurchaseRequest(db, prId);
      writePurchaseRequestEvent(db, pr, actor, "accept_request", "采购接收需求");
    }
    const dedupeMap = loadSourcingCandidateDedupeMap(db, pr.id);
    const candidates = candidatesToImport
      .map((item) => insert1688SourcingCandidate(db, services, pr, actor, item, { dedupeMap }))
      .filter(Boolean);
    if (candidates.length && pr.status === "buyer_processing") {
      services.purchase.markRequestSourced(prId, actor);
      pr = getPurchaseRequest(db, prId);
    }
    writePurchaseRequestEvent(
      db,
      pr,
      actor,
      "source_1688_keyword",
      candidates.length
        ? `1688 API sourcing: ${query.keyword}; imported ${candidates.length} candidates`
        : `1688 API sourcing: ${query.keyword}; all matched candidates already exist`,
    );
    markPurchaseRequestRead(db, pr.id, actor);
    return candidates;
  });

  const candidates = insertCandidates();
  return {
    query,
    apiKey: PROCUREMENT_APIS.KEYWORD_SEARCH.key,
    importedCount: candidates.length,
    totalFound: normalized.length,
    candidates,
    rawResponse,
  };
}

function alphaShopSettingId(companyId) {
  return `alphashop:${normalizeCompanyId(companyId, null)}`;
}

function getAlphaShopSettingsRow(db, companyId) {
  return db.prepare(`
    SELECT *
    FROM erp_alpha_shop_settings
    WHERE company_id = @company_id
    LIMIT 1
  `).get({ company_id: normalizeCompanyId(companyId, null) }) || null;
}

function saveAlphaShopCredentials(db, credentials = {}) {
  const companyId = normalizeCompanyId(credentials.companyId || credentials.company_id, null);
  const accessKey = requireString(credentials.accessKey || credentials.access_key, "accessKey");
  const secretKey = requireString(credentials.secretKey || credentials.secret_key, "secretKey");
  const now = nowIso();
  db.prepare(`
    INSERT INTO erp_alpha_shop_settings (
      id, company_id, access_key, secret_key, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @access_key, @secret_key, @created_at, @updated_at
    )
    ON CONFLICT(company_id) DO UPDATE SET
      access_key = excluded.access_key,
      secret_key = excluded.secret_key,
      updated_at = excluded.updated_at
  `).run({
    id: alphaShopSettingId(companyId),
    company_id: companyId,
    access_key: accessKey,
    secret_key: secretKey,
    created_at: now,
    updated_at: now,
  });
  return getAlphaShopSettingsRow(db, companyId);
}

function getAlphaShopCredentials(db, payload = {}, actor = {}) {
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const saved = getAlphaShopSettingsRow(db, companyId);
  const payloadAccessKey = optionalString(payload.accessKey || payload.ak);
  const payloadSecretKey = optionalString(payload.secretKey || payload.sk);
  const accessKey = optionalString(
    payloadAccessKey
      || process.env.ALPHASHOP_ACCESS_KEY
      || process.env.ERP_ALPHASHOP_ACCESS_KEY
      || saved?.access_key,
  );
  const secretKey = optionalString(
    payloadSecretKey
      || process.env.ALPHASHOP_SECRET_KEY
      || process.env.ERP_ALPHASHOP_SECRET_KEY
      || saved?.secret_key,
  );
  if (!accessKey || !secretKey) {
    throw new Error("请先配置图搜密钥，首次使用填写一次即可");
  }
  return {
    accessKey,
    secretKey,
    companyId,
    shouldSave: Boolean(payloadAccessKey && payloadSecretKey),
  };
}

function sanitizeAlphaShopPayload(payload = {}) {
  const sanitized = { ...payload };
  delete sanitized.accessKey;
  delete sanitized.secretKey;
  delete sanitized.ak;
  delete sanitized.sk;
  delete sanitized.imageDataUrl;
  delete sanitized.imageData;
  return sanitized;
}

function getErpUploadDataDir(db, bucket = "1688-image-search") {
  const dbPath = db?.__erpDbPath || getErpDatabasePath();
  return path.join(path.dirname(dbPath), "uploads", bucket);
}

function getErpUploadRootDir(db) {
  const dbPath = db?.__erpDbPath || getErpDatabasePath();
  return path.join(path.dirname(dbPath), "uploads");
}

function publicUploadBaseUrl(payload = {}) {
  const configured = optionalString(
    payload.publicBaseUrl
      || process.env.ERP_PUBLIC_BASE_URL
      || process.env.ERP_PUBLIC_URL
      || process.env.PUBLIC_BASE_URL,
  );
  return (configured || HK_SERVER_URL).replace(/\/+$/, "");
}

function parseErpImageDataUrl(payload = {}) {
  const dataUrl = optionalString(payload.imageDataUrl || payload.imageData);
  if (!dataUrl) return null;
  const matched = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!matched) throw new Error("请上传 PNG、JPG 或 WebP 图片");

  const mime = matched[1].toLowerCase();
  const buffer = Buffer.from(matched[2], "base64");
  if (!buffer.length) throw new Error("上传图片为空");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("图片太大，请压缩后再上传");
  return { mime, buffer };
}

function saveErpImageUpload(db, payload = {}, bucket = "purchase-images") {
  const parsed = parseErpImageDataUrl(payload);
  if (!parsed) return null;

  const ext = parsed.mime.includes("png") ? "png" : parsed.mime.includes("webp") ? "webp" : "jpg";
  const uploadDir = getErpUploadDataDir(db, bucket);
  fs.mkdirSync(uploadDir, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, fileName), parsed.buffer);
  return `${publicUploadBaseUrl(payload)}/uploads/${bucket}/${fileName}`;
}

function saveErpImageUploads(db, payload = {}, bucket = "purchase-images") {
  const dataUrls = Array.isArray(payload.imageDataUrls)
    ? payload.imageDataUrls.map((value) => optionalString(value)).filter(Boolean)
    : [];
  const fileNames = Array.isArray(payload.imageFileNames) ? payload.imageFileNames : [];
  const uploadPayloads = dataUrls.length
    ? dataUrls.map((dataUrl, index) => ({
      ...payload,
      imageDataUrl: dataUrl,
      imageFileName: optionalString(fileNames[index]) || payload.imageFileName,
    }))
    : [payload];
  return uploadPayloads
    .slice(0, 6)
    .map((item) => saveErpImageUpload(db, item, bucket))
    .filter(Boolean);
}

function save1688ImageSearchUpload(db, payload = {}) {
  return saveErpImageUpload(db, payload, "1688-image-search");
}

function extractFirstHttpUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>，。；、]+/i);
  return match ? match[0].replace(/[),.;，。；、]+$/u, "") : "";
}

function getPurchaseRequestImageUrl(db, pr = {}) {
  const evidence = parseJsonArray(pr.evidence_json);
  for (const item of evidence) {
    const url = extractFirstHttpUrl(item);
    if (url) return url;
  }
  const skuImageUrl = pr.sku_id
    ? optionalString(db.prepare("SELECT image_url FROM erp_skus WHERE id = ?").get(pr.sku_id)?.image_url)
    : "";
  return skuImageUrl || "";
}

function buildImageSearchEmptyReason(error = null) {
  const messageText = String(error?.message || error || "");
  if (/auth|token|鉴权|密钥|FAIL_AUTH/i.test(messageText)) {
    return "图搜暂时不可用，请联系管理员检查配置。";
  }
  return "这张图没有搜到候选，可以换一张更清晰的商品主图再试。";
}

function isAlibabaImageUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return host.endsWith(".alicdn.com") || host.endsWith(".alibaba.com") || host.endsWith(".1688.com");
  } catch {
    return false;
  }
}

function erpUploadUrlToLocalPath(db, imageUrl, payload = {}) {
  const text = optionalString(imageUrl);
  if (!text) return "";
  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }
  const publicBase = publicUploadBaseUrl(payload);
  let publicHost = "";
  try {
    publicHost = new URL(publicBase).host;
  } catch {
    publicHost = "";
  }
  if (publicHost && parsed.host !== publicHost) return "";

  const parts = parsed.pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean);
  if (parts[0] !== "uploads" || parts.length < 3) return "";
  const root = path.resolve(getErpUploadRootDir(db));
  const localPath = path.resolve(root, ...parts.slice(1));
  if (localPath !== root && !localPath.startsWith(`${root}${path.sep}`)) return "";
  return fs.existsSync(localPath) ? localPath : "";
}

async function fetchImageBuffer(imageUrl) {
  if (typeof fetch !== "function") {
    throw new Error("当前运行环境不能下载图片");
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 30000) : null;
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error("图片链接返回的不是图片");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("图片内容为空");
    if (buffer.length > 5 * 1024 * 1024) throw new Error("图片太大，请压缩后再试");
    return buffer;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveImageSearchAsset(db, payload = {}, pr = {}) {
  const parsedUpload = parseErpImageDataUrl(payload);
  const uploadedImgUrl = parsedUpload ? save1688ImageSearchUpload(db, payload) : null;
  const imgUrl = uploadedImgUrl
    || optionalString(payload.imgUrl || payload.imageUrl)
    || getPurchaseRequestImageUrl(db, pr);
  if (!imgUrl) {
    throw new Error("采购单没有可用于图搜的图片，请先在采购单上传图片");
  }
  if (parsedUpload?.buffer) {
    return { imgUrl, imageBuffer: parsedUpload.buffer };
  }

  const localPath = erpUploadUrlToLocalPath(db, imgUrl, payload);
  if (localPath) {
    const buffer = fs.readFileSync(localPath);
    if (!buffer.length) throw new Error("图片内容为空");
    return { imgUrl, imageBuffer: buffer };
  }
  return { imgUrl, imageBuffer: await fetchImageBuffer(imgUrl) };
}

function build1688ImageUploadParams(imageBuffer) {
  return {
    uploadImageParam: JSON.stringify({
      imageBase64: imageBuffer.toString("base64"),
    }),
  };
}

function extract1688ImageId(rawResponse = {}) {
  const values = [
    rawResponse?.result?.result,
    rawResponse?.result?.imageId,
    rawResponse?.result?.data?.imageId,
    rawResponse?.data?.imageId,
    rawResponse?.imageId,
  ];
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = optionalString(value.imageId || value.id || value.value);
      if (nested && nested !== "0") return nested;
    }
    const text = optionalString(value);
    if (text && text !== "0") return text;
  }
  return "";
}

function build1688ImageSearchParams({ imageId, imgUrl, beginPage, pageSize }) {
  const offerQueryParam = {
    country: "en",
    beginPage,
    pageSize,
  };
  if (imageId) offerQueryParam.imageId = imageId;
  else offerQueryParam.imageAddress = imgUrl;
  return { offerQueryParam: JSON.stringify(offerQueryParam) };
}

async function runOfficial1688ImageSearch({ db, actor, pr, imgUrl, imageBuffer, beginPage, pageSize }) {
  let imageId = "";
  let uploadResponse = null;
  if (!isAlibabaImageUrl(imgUrl)) {
    uploadResponse = await call1688ProcurementApi({
      db,
      actor,
      accountId: pr.account_id,
      action: "source_1688_image",
      api: PROCUREMENT_APIS.IMAGE_UPLOAD,
      params: build1688ImageUploadParams(imageBuffer),
    });
    imageId = extract1688ImageId(uploadResponse);
    if (!imageId) throw new Error("1688 没有返回可用图片ID");
  }

  const rawResponse = await call1688ProcurementApi({
    db,
    actor,
    accountId: pr.account_id,
    action: "source_1688_image",
    api: PROCUREMENT_APIS.IMAGE_SEARCH,
    params: build1688ImageSearchParams({
      imageId,
      imgUrl,
      beginPage,
      pageSize,
    }),
  });
  return {
    imageId,
    uploadResponse,
    rawResponse,
    products: normalize1688SearchResponse(rawResponse),
  };
}

async function runAlphaShopImageSearch({ db, payload, actor, imgUrl, beginPage, pageSize = 10 }) {
  const credentials = getAlphaShopCredentials(db, payload, actor);
  const raw = await imageSearchAlphaShopProduct({
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
    imgUrl,
    beginPage,
    pageSize,
    timeoutMs: 25000,
  });
  if (credentials.shouldSave) {
    saveAlphaShopCredentials(db, credentials);
  }
  return {
    rawResponse: raw.rawResponse,
    products: Array.isArray(raw.products) ? raw.products : [],
  };
}

async function runAlphaShopProductDetail({ db, payload, actor, offerId }) {
  const credentials = getAlphaShopCredentials(db, payload, actor);
  const raw = await alphaShopProductDetailQuery({
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
    productId: offerId,
    timeoutMs: 120000,
  });
  if (credentials.shouldSave) {
    saveAlphaShopCredentials(db, credentials);
  }
  return {
    rawResponse: raw.rawResponse,
    detail: raw.detail,
  };
}

async function run1688WebImageSearch({ imageBuffer, beginPage, pageSize = 10, timeoutMs = 120000 }) {
  const raw = await imageSearch1688Web({
    imageBuffer,
    beginPage,
    pageSize,
    timeoutMs,
  });
  return {
    imageId: raw.imageId,
    rawResponse: raw.rawResponse,
    products: Array.isArray(raw.products) ? raw.products : [],
  };
}

async function source1688ImageAction({ db, services, payload, actor }) {
  const __t0 = Date.now();
  const __log = (msg) => console.error(`[source_1688_image t=${Date.now() - __t0}ms] ${msg}`);
  __log("start");
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 image sourcing");
  const prId = requireString(payload.prId || payload.id, "prId");
  let pr = getPurchaseRequest(db, prId);
  const beginPage = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.beginPage) ?? 1)), 10));
  const importLimit = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.importLimit) ?? 10)), 20));
  const pageSize = Math.max(1, Math.min(importLimit, 50));
  const mockResults = Array.isArray(payload.mockResults) ? payload.mockResults : null;
  __log(`prId=${prId} mockResults=${mockResults?.length || 0} payload.imgUrl=${optionalString(payload.imgUrl || payload.imageUrl)?.slice(0, 80)}`);
  const { imgUrl, imageBuffer } = mockResults
    ? { imgUrl: optionalString(payload.imgUrl || payload.imageUrl), imageBuffer: null }
    : await resolveImageSearchAsset(db, payload, pr);
  __log(`asset resolved: imgUrl=${imgUrl?.slice(0, 80)} bufferLen=${imageBuffer?.length || 0}`);

  let normalized = [];
  let rawResponse = null;
  let searchError = null;
  let conversionError = null;
  let sourceMode = "alphashop_image";

  if (mockResults) {
    rawResponse = { mock: true, localImageSearch: payload.localImageSearch || null, result: { data: mockResults } };
    normalized = normalize1688SearchResponse(rawResponse);
    sourceMode = optionalString(payload.localImageSearch?.source) || "mock";
  } else {
    if (!isAlibabaImageUrl(imgUrl)) {
      __log("trying official_1688_image_search");
      try {
        const official = await runOfficial1688ImageSearch({
          db,
          actor,
          pr,
          imgUrl,
          imageBuffer,
          beginPage,
          pageSize,
        });
        normalized = Array.isArray(official.products) ? official.products : [];
        rawResponse = official.rawResponse;
        sourceMode = "official_1688_image";
        __log(`official_1688_image_search done normalized=${normalized.length}`);
      } catch (error) {
        conversionError = error;
        __log(`official_1688_image_search failed: ${error?.message}`);
      }
    } else {
      __log("skip official (alibaba url)");
    }

    try {
      // 1688 mtop 网页接口对裸 fetch 易反爬，且即使设了 timeoutMs，AbortController 在
      // socket connect 阶段经常不生效，整体能吃到 IPC 120s 超时。默认跳过这一步直接走
      // alphashop（1-2 秒就能返回）。想恢复网页图搜行为可以设 ERP_SERVER_WEB_IMAGE_SEARCH=1。
      if (process.env.ERP_SERVER_WEB_IMAGE_SEARCH === "1" && normalized.length === 0 && imageBuffer?.length) {
        const webImageSearch = await run1688WebImageSearch({
          imageBuffer,
          beginPage,
          pageSize,
          timeoutMs: 25000,
        });
        normalized = Array.isArray(webImageSearch.products) ? webImageSearch.products : [];
        rawResponse = webImageSearch.rawResponse;
        sourceMode = "1688_web_image";
      }
    } catch (error) {
      searchError = error;
    }

    try {
      if (normalized.length === 0) {
        __log("trying alphashop_image_search");
        const imageSearch = await runAlphaShopImageSearch({
          db,
          payload,
          actor,
          imgUrl,
          beginPage,
          pageSize,
        });
        normalized = Array.isArray(imageSearch.products) ? imageSearch.products : [];
        rawResponse = imageSearch.rawResponse;
        sourceMode = "alphashop_image";
        __log(`alphashop_image_search done normalized=${normalized.length}`);
      }
    } catch (error) {
      searchError = error;
      __log(`alphashop_image_search failed: ${error?.message}`);
      if (!rawResponse) throw error;
    }
  }
  __log(`search phase done normalized=${normalized.length} mode=${sourceMode}`);
  const clientEmptyReason = optionalString(payload.localImageSearch?.emptyReason);
  const emptyReason = normalized.length === 0
    ? clientEmptyReason || buildImageSearchEmptyReason(conversionError || searchError)
    : "";
  const candidatesToImport = normalized.slice(0, importLimit);
  const insertCandidates = db.transaction(() => {
    if (pr.status === "submitted") {
      services.purchase.acceptRequest(prId, actor);
      pr = getPurchaseRequest(db, prId);
      writePurchaseRequestEvent(db, pr, actor, "accept_request", "采购接收需求");
    }
    const dedupeMap = loadSourcingCandidateDedupeMap(db, pr.id);
    const candidates = candidatesToImport
      .map((item) => insert1688SourcingCandidate(
        db,
        services,
        pr,
        actor,
        { ...item, auditAction: "source_1688_image" },
        { dedupeMap },
      ))
      .filter(Boolean);
    if (candidates.length && pr.status === "buyer_processing") {
      services.purchase.markRequestSourced(prId, actor);
      pr = getPurchaseRequest(db, prId);
    }
    writePurchaseRequestEvent(
      db,
      pr,
      actor,
      "source_1688_image",
      candidates.length
        ? `以图搜款：第 ${beginPage} 页，导入 ${candidates.length} 个候选`
        : (normalized.length ? `以图搜款：第 ${beginPage} 页命中结果已存在，未新增重复候选` : emptyReason),
    );
    markPurchaseRequestRead(db, pr.id, actor);
    return candidates;
  });

  const candidates = insertCandidates();
  return {
    query: { beginPage, pageSize, importLimit, sourceMode },
    importedCount: candidates.length,
    duplicateSkippedCount: Math.max(0, candidatesToImport.length - candidates.length),
    totalFound: normalized.length,
    emptyReason,
    candidates,
    rawResponse,
  };
}

function buildAutoInquiryMessage(db, pr, candidate, payload = {}) {
  const explicitMessage = optionalString(payload.message || payload.inquiryMessage);
  if (explicitMessage) return explicitMessage.slice(0, 1000);
  const sku = pr.sku_id
    ? db.prepare("SELECT internal_sku_code, product_name FROM erp_skus WHERE id = ?").get(pr.sku_id)
    : null;
  const productName = optionalString(sku?.product_name)
    || optionalString(sku?.internal_sku_code)
    || optionalString(candidate.product_title)
    || "这款商品";
  const productCode = optionalString(sku?.internal_sku_code) || "-";
  const candidateTitle = optionalString(candidate.product_title) || productName;
  const qty = Math.max(1, Math.floor(Number(optionalNumber(payload.requestedQty || payload.qty) ?? pr.requested_qty ?? 1)));
  const targetCost = optionalNumber(payload.targetUnitCost ?? pr.target_unit_cost);
  const targetCostText = targetCost !== null ? `目标到手价 ${Number(targetCost).toFixed(2)} 元，` : "";
  const companyId = normalizeCompanyId(
    db.prepare("SELECT company_id FROM erp_accounts WHERE id = ?").get(pr.account_id)?.company_id,
    null,
  );
  const template = normalizeInquiryTemplate(payload.inquiryTemplate || getPurchaseSettings(db, companyId).inquiryTemplate);
  const variables = {
    商品名称: productName,
    商品编码: productCode,
    采购数量: String(qty),
    目标成本: targetCostText,
    候选商品标题: candidateTitle,
    供应商: optionalString(candidate.supplier_name) || "-",
    "1688链接": optionalString(candidate.product_url) || "-",
  };
  return template.replace(/\{([^{}]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
  )).slice(0, 1000);
}

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createAlphaShopJwt(accessKey, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64UrlJson({ alg: "HS256", typ: "JWT" });
  const body = encodeBase64UrlJson({
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
  });
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function getAlphaShopInquiryCredentials(db, companyId) {
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const row = db.prepare(`
    SELECT alphashop_access_key, alphashop_secret_key
    FROM erp_purchase_settings
    WHERE company_id = ?
    LIMIT 1
  `).get(normalizedCompanyId);
  const imageSearchSettings = getAlphaShopSettingsRow(db, normalizedCompanyId);
  const accessKey = normalizeAlphaShopAccessKey(row?.alphashop_access_key)
    || normalizeAlphaShopAccessKey(imageSearchSettings?.access_key)
    || normalizeAlphaShopAccessKey(process.env.ALPHASHOP_ACCESS_KEY || process.env.ERP_ALPHASHOP_ACCESS_KEY);
  const secretKey = normalizeAlphaShopSecretKey(row?.alphashop_secret_key)
    || normalizeAlphaShopSecretKey(imageSearchSettings?.secret_key)
    || normalizeAlphaShopSecretKey(process.env.ALPHASHOP_SECRET_KEY || process.env.ERP_ALPHASHOP_SECRET_KEY);
  if (!accessKey || !secretKey) {
    throw new Error("请先配置图搜同款密钥，或在采购中心的询盘设置里单独配置 AlphaShop Access Key 和 Secret Key");
  }
  return {
    accessKey,
    secretKey,
    source: row?.alphashop_access_key && row?.alphashop_secret_key
      ? "purchase_settings"
      : imageSearchSettings?.access_key && imageSearchSettings?.secret_key
        ? "image_search"
        : "environment",
    apiBase: optionalString(process.env.ALPHASHOP_API_BASE) || ALPHASHOP_API_BASE,
  };
}

function compactAlphaShopResponse(response = {}) {
  const result = response?.result || response?.data || {};
  return {
    success: response?.success,
    api: response?.api,
    version: response?.version,
    requestId: response?.requestId || response?.request_id,
    code: response?.code || response?.errorCode || response?.error_code || response?.resultCode || response?.result_code,
    message: response?.message || response?.errorMessage || response?.error_message || response?.resultMessage || response?.result_message,
    result: typeof result === "object" && result !== null ? {
      success: result.success,
      code: result.code || result.errorCode || result.error_code || result.resultCode || result.result_code,
      message: result.message || result.errorMessage || result.error_message || result.resultMessage || result.result_message,
      data: typeof result.data === "string" ? result.data : result.data?.taskId || result.data?.id || result.data,
    } : result,
  };
}

function alphaShopErrorMessage(response = {}) {
  const resultCode = optionalString(response.resultCode || response.result_code || response.code || response.errorCode || response.error_code);
  if (resultCode === "FAIL_ACCOUNT_POINT_NOT_ENOUGH") return "AlphaShop 点数不足，无法发起询盘";
  if (resultCode === "FAIL_REQUEST_PARAMETER_ILLEGAL") return "AlphaShop 请求参数不合法";
  const candidates = [
    response.errorMessage,
    response.error_message,
    response.errorMsg,
    response.message,
    response.msg,
    response.resultMessage,
    response.result_message,
    response.result?.errorMessage,
    response.result?.error_message,
    response.result?.errorMsg,
    response.result?.message,
    response.result?.msg,
    response.data?.errorMessage,
    response.data?.message,
  ];
  const message = candidates.map((item) => optionalString(item)).find(Boolean) || "";
  return message || resultCode || "";
}

function createAlphaShopApiError(message, response = null, status = null) {
  const error = new Error(message);
  error.alphaShopResponse = response;
  error.alphaShopStatus = status;
  return error;
}

async function callAlphaShopApi(pathname, body, credentials) {
  const url = `${credentials.apiBase.replace(/\/+$/, "")}${pathname}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${createAlphaShopJwt(credentials.accessKey, credentials.secretKey)}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }
  }
  if (!response.ok) {
    throw createAlphaShopApiError(
      alphaShopErrorMessage(parsed) || `AlphaShop API HTTP ${response.status}`,
      parsed,
      response.status,
    );
  }
  if (
    parsed?.success === false
    || parsed?.result?.success === false
    || parsed?.error
    || parsed?.errorCode
    || parsed?.error_code
    || optionalString(parsed?.resultCode || parsed?.result_code).startsWith("FAIL_")
  ) {
    throw createAlphaShopApiError(alphaShopErrorMessage(parsed) || "AlphaShop API 返回失败", parsed);
  }
  return parsed;
}

function alphaShopTaskIdValue(value) {
  if (typeof value === "string" || typeof value === "number") {
    const text = optionalString(value);
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        return alphaShopTaskIdValue(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  if (!value || typeof value !== "object") return "";
  const directKeys = [
    "taskId",
    "taskID",
    "task_id",
    "taskNo",
    "task_no",
    "inquiryTaskId",
    "inquiry_task_id",
  ];
  for (const key of directKeys) {
    const text = alphaShopTaskIdValue(value[key]);
    if (text) return text;
  }
  if (value.task && typeof value.task === "object") {
    const text = alphaShopTaskIdValue(value.task.id || value.task.taskId || value.task.task_id);
    if (text) return text;
  }
  return "";
}

function extractAlphaShopTaskId(response = {}) {
  const values = [
    response.result?.data,
    response.result?.data?.taskId,
    response.result?.data?.task_id,
    response.result?.data?.taskID,
    response.result?.data?.id,
    response.result?.data?.task,
    response.result?.taskId,
    response.result?.task_id,
    response.result?.taskID,
    response.result?.id,
    response.data?.taskId,
    response.data?.task_id,
    response.data?.taskID,
    response.data?.id,
    response.data?.result?.data,
    response.data?.result?.data?.taskId,
    response.data?.result?.data?.task_id,
    response.data?.result?.data?.id,
    response.data?.result?.taskId,
    response.data?.result?.task_id,
    response.taskId,
    response.task_id,
    response.taskID,
    response.id,
  ];
  for (const value of values) {
    const text = alphaShopTaskIdValue(value);
    if (text) return text;
  }
  return "";
}

function getAlphaShopInquiryTaskId(candidate) {
  const result = parseJsonObject(candidate.inquiry_result_json);
  return alphaShopTaskIdValue(
    result.taskId
    || result.task_id
    || result.taskID
    || result.response?.result?.data
    || result.response?.data?.result?.data
    || result.response,
  ) || "";
}

function getAlphaShopInquiryQueryStatus(response = {}) {
  const data = response.result?.data || response.data || {};
  const taskInfo = data.taskInfo || data.task_info || {};
  const status = optionalString(taskInfo.status || data.status || data.taskStatus || data.task_status).toUpperCase();
  if (["FINISHED", "SUCCESS", "SUCCEEDED", "DONE", "COMPLETED"].includes(status)) return "replied";
  if (["FAILED", "FAIL", "CANCELED", "CANCELLED"].includes(status)) return "failed";
  return "sent";
}

function getCandidateAlphaShopOfferId(candidate) {
  return optionalString(candidate.external_offer_id)
    || extract1688OfferIdFromUrl(candidate.product_url)
    || extract1688OfferIdFromUrl(candidate.source_payload_json);
}

function buildAlphaShopInquiryBody({ pr, candidate, inquiryMessage, payload }) {
  const offerId = getCandidateAlphaShopOfferId(candidate);
  if (!offerId) throw new Error("候选商品缺少 1688 商品 ID，无法发起询盘");
  const body = {
    questionList: ["自定义"],
    requirementContent: inquiryMessage,
    isRequirementOriginal: true,
    itemList: [{ offerId }],
  };
  const qty = optionalPositiveInteger(payload.expectedOrderQuantity || payload.requestedQty || payload.qty, null)
    || optionalPositiveInteger(pr.requested_qty, null);
  if (qty) body.expectedOrderQuantity = qty;
  const addressText = optionalString(payload.addressText || payload.address);
  if (addressText) body.addressText = addressText;
  return { offerId, body };
}

async function autoInquiry1688CandidatesAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 自动询盘");
  const prId = requireString(payload.prId || payload.id, "prId");
  const pr = getPurchaseRequest(db, prId);
  const companyId = normalizeCompanyId(
    db.prepare("SELECT company_id FROM erp_accounts WHERE id = ?").get(pr.account_id)?.company_id,
    actor,
  );
  const credentials = getAlphaShopInquiryCredentials(db, companyId);
  const limit = Math.max(1, Math.min(Math.floor(Number(optionalNumber(
    payload.inquiryLimit ?? payload.candidateLimit ?? payload.autoInquiryLimit,
  ) ?? 5)), 20));
  const force = Boolean(payload.force);
  const sentWhere = force ? "" : `
    AND (
      COALESCE(candidate.inquiry_status, '') != 'sent'
      OR COALESCE(candidate.inquiry_result_json, '') NOT LIKE '%"taskId":"%'
    )
  `;
  const candidateIds = Array.isArray(payload.candidateIds)
    ? payload.candidateIds.map((id) => optionalString(id)).filter(Boolean).slice(0, 20)
    : [];
  let candidates;
  if (candidateIds.length) {
    const idParams = {};
    const placeholders = candidateIds.map((id, index) => {
      const key = `candidate_id_${index}`;
      idParams[key] = id;
      return `@${key}`;
    }).join(", ");
    candidates = db.prepare(`
      SELECT candidate.*
      FROM erp_sourcing_candidates candidate
      WHERE candidate.pr_id = @pr_id
        AND candidate.id IN (${placeholders})
        ${sentWhere}
      ORDER BY
        CASE WHEN COALESCE(candidate.external_offer_id, '') != '' THEN 0 ELSE 1 END,
        CASE candidate.status
          WHEN 'selected' THEN 0
          WHEN 'shortlisted' THEN 1
          WHEN 'candidate' THEN 2
          ELSE 9
        END,
        candidate.updated_at DESC
    `).all({ pr_id: pr.id, ...idParams });
  } else {
    candidates = db.prepare(`
    SELECT candidate.*
    FROM erp_sourcing_candidates candidate
    WHERE candidate.pr_id = @pr_id
      ${sentWhere}
    ORDER BY
      CASE WHEN COALESCE(candidate.external_offer_id, '') != '' THEN 0 ELSE 1 END,
      CASE candidate.status
        WHEN 'selected' THEN 0
        WHEN 'shortlisted' THEN 1
        WHEN 'candidate' THEN 2
        ELSE 9
      END,
      candidate.updated_at DESC
    LIMIT @limit
  `).all({ pr_id: pr.id, limit });
  }
  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE erp_sourcing_candidates
    SET inquiry_status = @inquiry_status,
        inquiry_message = @inquiry_message,
        inquiry_sent_at = @inquiry_sent_at,
        inquiry_result_json = @inquiry_result_json,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const updated = [];
  const failed = [];
  for (const candidate of candidates) {
    const before = candidate;
    const inquiryMessage = buildAutoInquiryMessage(db, pr, candidate, payload);
    let inquiryStatus = "sent";
    let inquiryResult;
    try {
      const { offerId, body } = buildAlphaShopInquiryBody({ pr, candidate, inquiryMessage, payload });
      const response = await callAlphaShopApi("/inquiry.task.submit.batchItem/1.0", body, credentials);
      const taskId = extractAlphaShopTaskId(response);
      if (!taskId) throw createAlphaShopApiError("AlphaShop \u5df2\u54cd\u5e94\uff0c\u4f46\u672a\u8fd4\u56de taskId", response);
      inquiryResult = {
        mode: "alphashop_api",
        api: "inquiry.task.submit.batchItem",
        taskId,
        externalOfferId: offerId,
        productUrl: optionalString(candidate.product_url),
        supplierName: optionalString(candidate.supplier_name),
        recordedAt: now,
        queryAfterMinutes: 20,
        response: compactAlphaShopResponse(response),
      };
    } catch (error) {
      inquiryStatus = "failed";
      inquiryResult = {
        mode: "alphashop_api",
        api: "inquiry.task.submit.batchItem",
        externalOfferId: getCandidateAlphaShopOfferId(candidate),
        productUrl: optionalString(candidate.product_url),
        supplierName: optionalString(candidate.supplier_name),
        recordedAt: now,
        failureReason: error?.message || String(error),
      };
      if (error?.alphaShopResponse) {
        inquiryResult.response = compactAlphaShopResponse(error.alphaShopResponse);
      }
    }
    updateStmt.run({
      id: candidate.id,
      inquiry_status: inquiryStatus,
      inquiry_message: inquiryMessage,
      inquiry_sent_at: now,
      inquiry_result_json: trimJsonForStorage(inquiryResult),
      updated_at: now,
    });
    const after = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidate.id);
    services.workflow.writeAudit({
      accountId: pr.account_id,
      actor,
      action: "auto_inquiry_1688",
      entityType: "sourcing_candidate",
      entityId: candidate.id,
      before,
      after,
    });
    const row = toCamelRow(after);
    row.inquiryResult = parseJsonObject(after.inquiry_result_json);
    delete row.inquiryResultJson;
    if (inquiryStatus === "sent") updated.push(row);
    else failed.push(row);
  }
  writePurchaseRequestEvent(
    db,
    pr,
    actor,
    "auto_inquiry_1688",
    updated.length || failed.length
      ? `自动询盘：成功 ${updated.length} 个，失败 ${failed.length} 个`
      : "自动询盘：没有可询盘的候选商品",
  );
  markPurchaseRequestRead(db, pr.id, actor);
  return {
    inquiryCount: updated.length,
    failedCount: failed.length,
    candidates: updated,
    failedCandidates: failed,
  };
}

function normalizeLocal1688InquiryResults(payload = {}) {
  const source = Array.isArray(payload.browserResults)
    ? payload.browserResults
    : Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.localResult?.results)
        ? payload.localResult.results
        : [];
  const map = new Map();
  for (const item of source) {
    const candidateId = optionalString(item?.candidateId || item?.id || item?.candidate_id);
    if (!candidateId) continue;
    map.set(candidateId, item || {});
  }
  return map;
}

async function recordLocal1688InquiryResultsAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 本地浏览器询盘结果");
  const prId = requireString(payload.prId || payload.id, "prId");
  const pr = getPurchaseRequest(db, prId);
  const resultByCandidateId = normalizeLocal1688InquiryResults(payload);
  const candidateIds = Array.isArray(payload.candidateIds)
    ? payload.candidateIds.map((id) => optionalString(id)).filter(Boolean).slice(0, 200)
    : Array.from(resultByCandidateId.keys()).slice(0, 200);
  if (!candidateIds.length) throw new Error("请至少选择一个候选商品");

  const idParams = {};
  const placeholders = candidateIds.map((id, index) => {
    const key = `candidate_id_${index}`;
    idParams[key] = id;
    return `@${key}`;
  }).join(", ");
  const candidates = db.prepare(`
    SELECT candidate.*
    FROM erp_sourcing_candidates candidate
    WHERE candidate.pr_id = @pr_id
      AND candidate.id IN (${placeholders})
  `).all({ pr_id: pr.id, ...idParams });

  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE erp_sourcing_candidates
    SET inquiry_status = @inquiry_status,
        inquiry_message = @inquiry_message,
        inquiry_sent_at = @inquiry_sent_at,
        inquiry_result_json = @inquiry_result_json,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const updated = [];
  const failed = [];
  for (const candidate of candidates) {
    const before = candidate;
    const browserResult = resultByCandidateId.get(candidate.id) || {};
    const sent = String(browserResult.status || "").toLowerCase() === "sent"
      || browserResult.ok === true
      || browserResult.success === true;
    const inquiryMessage = optionalString(browserResult.inquiryMessage || payload.inquiryMessage)
      || buildAutoInquiryMessage(db, pr, candidate, payload);
    const offerId = optionalString(browserResult.offerId || browserResult.externalOfferId)
      || getCandidateAlphaShopOfferId(candidate);
    const taskId = optionalString(browserResult.taskId)
      || (sent ? `local1688_${Date.now()}_${candidate.id}` : "");
    const failureReason = optionalString(
      browserResult.failureReason
      || browserResult.reason
      || browserResult.error
      || browserResult.message,
    ) || (sent ? "" : "本地 1688 浏览器未返回成功结果");
    const inquiryResult = {
      mode: "local_1688_browser",
      taskId,
      externalOfferId: offerId,
      productUrl: optionalString(browserResult.productUrl) || optionalString(candidate.product_url),
      supplierName: optionalString(candidate.supplier_name),
      recordedAt: now,
      sentAt: optionalString(browserResult.sentAt) || (sent ? now : ""),
      status: sent ? "sent" : "failed",
      confirmation: optionalString(browserResult.confirmation),
      entryText: optionalString(browserResult.entryText),
      submitText: optionalString(browserResult.submitText),
      failureReason,
      screenshotFile: optionalString(browserResult.screenshotFile),
      debugDir: optionalString(payload.localResult?.debugDir || payload.debugDir),
    };
    updateStmt.run({
      id: candidate.id,
      inquiry_status: sent ? "sent" : "failed",
      inquiry_message: inquiryMessage,
      inquiry_sent_at: optionalString(browserResult.sentAt) || now,
      inquiry_result_json: trimJsonForStorage(inquiryResult),
      updated_at: now,
    });
    const after = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidate.id);
    services.workflow.writeAudit({
      accountId: pr.account_id,
      actor,
      action: "record_local_1688_inquiry_results",
      entityType: "sourcing_candidate",
      entityId: candidate.id,
      before,
      after,
    });
    const row = toCamelRow(after);
    row.inquiryResult = parseJsonObject(after.inquiry_result_json);
    delete row.inquiryResultJson;
    if (sent) updated.push(row);
    else failed.push(row);
  }

  writePurchaseRequestEvent(
    db,
    pr,
    actor,
    "record_local_1688_inquiry_results",
    updated.length || failed.length
      ? `本地 1688 询盘：成功 ${updated.length} 个，失败 ${failed.length} 个`
      : "本地 1688 询盘：没有可记录的候选商品",
  );
  markPurchaseRequestRead(db, pr.id, actor);
  return {
    inquiryCount: updated.length,
    failedCount: failed.length,
    candidates: updated,
    failedCandidates: failed,
    localResult: payload.localResult || null,
  };
}

async function sync1688InquiryResultsAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 询盘结果同步");
  const prId = optionalString(payload.prId || payload.id);
  const candidateIds = Array.isArray(payload.candidateIds)
    ? payload.candidateIds.map((id) => optionalString(id)).filter(Boolean).slice(0, 100)
    : [];
  const where = ["COALESCE(candidate.inquiry_status, '') IN ('sent', 'pending')"];
  const params = {};
  if (prId) {
    where.push("candidate.pr_id = @pr_id");
    params.pr_id = prId;
  }
  if (candidateIds.length) {
    const placeholders = candidateIds.map((id, index) => {
      const key = `candidate_id_${index}`;
      params[key] = id;
      return `@${key}`;
    }).join(", ");
    where.push(`candidate.id IN (${placeholders})`);
  }
  const limit = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.limit) ?? 50)), 100));
  params.limit = limit * 3;
  const candidates = db.prepare(`
    SELECT
      candidate.*,
      pr.account_id,
      account.company_id
    FROM erp_sourcing_candidates candidate
    LEFT JOIN erp_purchase_requests pr ON pr.id = candidate.pr_id
    LEFT JOIN erp_accounts account ON account.id = pr.account_id
    WHERE ${where.join(" AND ")}
    ORDER BY candidate.inquiry_sent_at DESC, candidate.updated_at DESC
    LIMIT @limit
  `).all(params).filter((candidate) => getAlphaShopInquiryTaskId(candidate)).slice(0, limit);
  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE erp_sourcing_candidates
    SET inquiry_status = @inquiry_status,
        inquiry_result_json = @inquiry_result_json,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const credentialByCompany = new Map();
  const updated = [];
  const failed = [];
  for (const candidate of candidates) {
    const before = candidate;
    const taskId = getAlphaShopInquiryTaskId(candidate);
    const companyId = normalizeCompanyId(candidate.company_id, actor);
    let credentials = credentialByCompany.get(companyId);
    if (!credentials) {
      credentials = getAlphaShopInquiryCredentials(db, companyId);
      credentialByCompany.set(companyId, credentials);
    }
    const existingResult = parseJsonObject(candidate.inquiry_result_json);
    let nextStatus = "sent";
    let nextResult = existingResult;
    try {
      const response = await callAlphaShopApi("/inquiry.task.query.info/1.0", { taskId }, credentials);
      nextStatus = getAlphaShopInquiryQueryStatus(response);
      nextResult = {
        ...existingResult,
        taskId,
        queriedAt: now,
        queryResponse: compactAlphaShopResponse(response),
      };
      if (nextStatus === "failed") {
        nextResult.failureReason = alphaShopErrorMessage(response) || "AlphaShop 询盘任务失败";
      }
    } catch (error) {
      nextStatus = "failed";
      nextResult = {
        ...existingResult,
        taskId,
        queriedAt: now,
        failureReason: error?.message || String(error),
      };
    }
    updateStmt.run({
      id: candidate.id,
      inquiry_status: nextStatus,
      inquiry_result_json: trimJsonForStorage(nextResult),
      updated_at: now,
    });
    const after = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidate.id);
    services.workflow.writeAudit({
      accountId: candidate.account_id,
      actor,
      action: "sync_1688_inquiry_results",
      entityType: "sourcing_candidate",
      entityId: candidate.id,
      before,
      after,
    });
    const row = toCamelRow(after);
    row.inquiryResult = parseJsonObject(after.inquiry_result_json);
    delete row.inquiryResultJson;
    if (nextStatus === "failed") failed.push(row);
    else updated.push(row);
  }
  if (prId) {
    writePurchaseRequestEvent(
      db,
      getPurchaseRequest(db, prId),
      actor,
      "sync_1688_inquiry_results",
      candidates.length
        ? `询盘结果同步：处理 ${candidates.length} 个，失败 ${failed.length} 个`
        : "询盘结果同步：没有待同步的询盘任务",
    );
    markPurchaseRequestRead(db, prId, actor);
  }
  return {
    syncedCount: updated.length,
    failedCount: failed.length,
    candidates: updated,
    failedCandidates: failed,
  };
}

function pickPriceForQuantity(priceRanges = [], qty = 1) {
  const quantity = Math.max(1, Number(qty || 1));
  let selected = null;
  for (const range of priceRanges || []) {
    const startQuantity = Number(range?.startQuantity || 1);
    const price = optionalNumber(range?.price);
    if (price === null) continue;
    if (startQuantity <= quantity && (!selected || startQuantity >= selected.startQuantity)) {
      selected = { startQuantity, price };
    }
  }
  return selected?.price ?? null;
}

function pickSkuOption(detail = {}, payload = {}) {
  const skuOptions = Array.isArray(detail.skuOptions) ? detail.skuOptions : [];
  const externalSkuId = optionalString(payload.externalSkuId || payload.skuId);
  const externalSpecId = optionalString(payload.externalSpecId || payload.specId);
  if (externalSkuId || externalSpecId) {
    const found = skuOptions.find((sku) => (
      (!externalSkuId || sku.externalSkuId === externalSkuId)
      && (!externalSpecId || sku.externalSpecId === externalSpecId)
    ));
    if (found) return found;
  }
  return skuOptions.find((sku) => optionalNumber(sku.price) !== null) || skuOptions[0] || null;
}

function hasSyncableSkuOptions(detail = {}) {
  return Array.isArray(detail.skuOptions)
    && detail.skuOptions.some((sku) => optionalString(sku?.externalSpecId || sku?.externalSkuId));
}

function is1688ProductDetailAclError(error) {
  const message = String(error?.message || error || "");
  return error?.code === "1688_APP_ACL_DENIED"
    || /alibaba\.product\.get|AppKey is not allowed\(acl\)|not allowed\(acl\)/i.test(message);
}

function addFallback1688SkuOption(options, item = {}) {
  const externalSkuId = optionalString(
    item.externalSkuId
      || item.external_sku_id
      || item.skuId
      || item.skuID
      || item.sku_id,
  );
  const externalSpecId = optionalString(
    item.externalSpecId
      || item.external_spec_id
      || item.specId
      || item.specID
      || item.spec_id
      || item.cargoSkuId
      || item.cargoSkuID
      || item.cargo_sku_id,
  ) || externalSkuId;
  if (!externalSkuId && !externalSpecId) return;
  const key = `${externalSkuId || ""}:${externalSpecId || ""}`;
  if (options.some((option) => `${option.externalSkuId || ""}:${option.externalSpecId || ""}` === key)) return;
  options.push({
    externalSkuId: externalSkuId || externalSpecId,
    externalSpecId,
    specText: optionalString(item.specText || item.spec_text || item.specAttrs || item.spec_attrs) || externalSpecId,
    price: optionalNumber(item.price),
    stock: optionalNumber(item.stock),
    raw: item.raw || item,
  });
}

async function buildFallback1688ProductDetail(candidate = {}, offerId, payload = {}, error = null) {
  const sourcePayload = parseJsonObject(candidate.source_payload_json);
  const skuOptions = [];
  for (const item of parseJsonArray(candidate.external_sku_options_json)) {
    addFallback1688SkuOption(skuOptions, item);
  }
  addFallback1688SkuOption(skuOptions, {
    externalSkuId: payload.externalSkuId || payload.external_sku_id || candidate.external_sku_id || infer1688CandidateSkuId({ ...candidate, raw: sourcePayload }),
    externalSpecId: payload.externalSpecId || payload.external_spec_id || candidate.external_spec_id || infer1688CandidateSpecId({ ...candidate, raw: sourcePayload }),
    specText: candidate.product_title,
    price: payload.unitPrice ?? candidate.unit_price,
  });

  let webDetailError = null;
  try {
    const webSkuOptions = await fetch1688WebSkuOptions(offerId);
    for (const item of webSkuOptions) addFallback1688SkuOption(skuOptions, item);
  } catch (webError) {
    webDetailError = webError;
  }

  return {
    externalOfferId: String(offerId),
    supplierName: optionalString(candidate.supplier_name) || "1688 Supplier",
    productTitle: optionalString(candidate.product_title),
    productUrl: optionalString(candidate.product_url) || `https://detail.1688.com/offer/${offerId}.html`,
    imageUrl: optionalString(candidate.image_url),
    unitPrice: optionalNumber(payload.unitPrice) ?? optionalNumber(candidate.unit_price) ?? 0,
    moq: Math.max(1, Math.floor(Number(optionalNumber(candidate.moq) ?? 1))),
    priceRanges: parseJsonArray(candidate.external_price_ranges_json),
    skuOptions,
    raw: {
      ...sourcePayload,
      fallbackDetail: {
        source: "candidate_or_1688_web_detail",
        reason: error?.message || String(error || ""),
        webDetailError: webDetailError?.message || null,
        fetchedAt: nowIso(),
      },
    },
  };
}

function build1688ProductDetailParams(offerId, payload = {}) {
  return {
    productID: requireString(payload.productId || payload.productID || offerId, "productID"),
    webSite: optionalString(payload.webSite) || "1688",
  };
}

async function refresh1688ProductDetailAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 product detail");
  const candidateId = requireString(payload.candidateId || payload.id, "candidateId");
  const candidate = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidateId);
  if (!candidate) throw new Error(`Sourcing candidate not found: ${candidateId}`);
  const pr = getPurchaseRequest(db, candidate.pr_id);
  const offerId = requireString(payload.offerId || candidate.external_offer_id, "offerId");
  const apiParams = build1688ProductDetailParams(offerId, payload);
  let rawResponse = null;
  let detail = null;
  let usedFallbackDetail = false;
  let usedAlphaShopProductDetail = false;
  let alphaShopDetailError = null;
  const mockDetail = payload.mockDetail || payload.mockResponse || null;

  if (mockDetail) {
    rawResponse = mockDetail;
    detail = normalize1688ProductDetailResponse(rawResponse);
  } else {
    const preferAlphaShopDetail = payload.preferAlphaShopDetail !== false
      && payload.prefer_alpha_shop_detail !== false;
    if (preferAlphaShopDetail) {
      try {
        const alphaShopDetail = await runAlphaShopProductDetail({
          db,
          payload,
          actor,
          offerId,
        });
        if (hasSyncableSkuOptions(alphaShopDetail.detail)) {
          rawResponse = alphaShopDetail.rawResponse;
          detail = alphaShopDetail.detail;
          usedAlphaShopProductDetail = true;
        } else {
          alphaShopDetailError = new Error("productDetailQuery 未返回可绑定规格");
        }
      } catch (error) {
        alphaShopDetailError = error;
      }
    }

    if (!detail) {
      try {
        rawResponse = await call1688ProcurementApi({
          db,
          actor,
          accountId: candidate.account_id,
          action: "refresh_1688_product_detail",
          api: PROCUREMENT_APIS.PRODUCT_DETAIL,
          params: apiParams,
        });
        detail = normalize1688ProductDetailResponse(rawResponse);
      } catch (error) {
        if (!is1688ProductDetailAclError(error)) throw error;
        detail = await buildFallback1688ProductDetail(candidate, offerId, payload, error);
        if (detail.raw?.fallbackDetail && alphaShopDetailError) {
          detail.raw.fallbackDetail.alphaShopDetailError = alphaShopDetailError.message || String(alphaShopDetailError);
        }
        rawResponse = detail.raw;
        usedFallbackDetail = true;
      }
    }
  }
  const selectedSku = pickSkuOption(detail, {
    ...payload,
    externalSkuId: payload.externalSkuId || payload.external_sku_id || candidate.external_sku_id,
    externalSpecId: payload.externalSpecId || payload.external_spec_id || candidate.external_spec_id,
  });
  if (usedFallbackDetail && !optionalString(payload.externalSpecId || payload.external_spec_id || candidate.external_spec_id || selectedSku?.externalSpecId)) {
    const alphaShopMessage = alphaShopDetailError
      ? `productDetailQuery 也未拿到可绑定规格（${alphaShopDetailError.message || String(alphaShopDetailError)}），`
      : "";
    throw new Error(`${alphaShopMessage}当前 1688 AppKey 没有商品详情接口权限，且未能从图搜候选或 1688 页面解析到具体规格。请开通 alibaba.product.get ACL，或在供应商管理里手动填写 1688 规格ID。`);
  }
  const shouldBindMapping = payload.bindMapping !== false && payload.bind_mapping !== false;
  const explicitExternalSkuId = optionalString(payload.externalSkuId || payload.external_sku_id);
  const explicitExternalSpecId = optionalString(payload.externalSpecId || payload.external_spec_id);
  const shouldApplySelectedSpec = shouldBindMapping || explicitExternalSkuId || explicitExternalSpecId;
  const qty = Number(pr.requested_qty || candidate.moq || 1);
  const priceFromRange = pickPriceForQuantity(detail.priceRanges, qty);
  const nextUnitPrice = optionalNumber(payload.unitPrice)
    ?? optionalNumber(selectedSku?.price)
    ?? priceFromRange
    ?? optionalNumber(detail.unitPrice)
    ?? Number(candidate.unit_price || 0);
  const nextMoq = Math.max(1, Math.floor(Number(optionalNumber(detail.moq) ?? candidate.moq ?? 1)));
  const now = nowIso();

  db.prepare(`
    UPDATE erp_sourcing_candidates
    SET supplier_name = COALESCE(@supplier_name, supplier_name),
        product_title = COALESCE(@product_title, product_title),
        product_url = COALESCE(@product_url, product_url),
        image_url = COALESCE(@image_url, image_url),
        unit_price = @unit_price,
        moq = @moq,
        external_offer_id = COALESCE(@external_offer_id, external_offer_id),
        external_sku_id = COALESCE(@external_sku_id, external_sku_id),
        external_spec_id = COALESCE(@external_spec_id, external_spec_id),
        source_payload_json = @source_payload_json,
        external_detail_json = @external_detail_json,
        external_sku_options_json = @external_sku_options_json,
        external_price_ranges_json = @external_price_ranges_json,
        external_detail_fetched_at = @external_detail_fetched_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: candidate.id,
    supplier_name: optionalString(detail.supplierName),
    product_title: optionalString(detail.productTitle),
    product_url: optionalString(detail.productUrl),
    image_url: optionalString(detail.imageUrl),
    unit_price: nextUnitPrice,
    moq: nextMoq,
    external_offer_id: optionalString(detail.externalOfferId || offerId),
    external_sku_id: shouldApplySelectedSpec
      ? optionalString(explicitExternalSkuId || selectedSku?.externalSkuId || candidate.external_sku_id)
      : null,
    external_spec_id: shouldApplySelectedSpec
      ? optionalString(explicitExternalSpecId || selectedSku?.externalSpecId || candidate.external_spec_id)
      : null,
    source_payload_json: trimJsonForStorage(detail.raw || rawResponse),
    external_detail_json: trimJsonForStorage(detail.raw || rawResponse),
    external_sku_options_json: trimJsonForStorage(detail.skuOptions || [], 60000),
    external_price_ranges_json: trimJsonForStorage(detail.priceRanges || [], 60000),
    external_detail_fetched_at: now,
    updated_at: now,
  });

  const afterCandidate = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidate.id);
  const sku1688Source = shouldBindMapping
    ? upsertSku1688SourceFromCandidate(
      db,
      afterCandidate,
      getPurchaseRequest(db, candidate.pr_id),
      actor,
      { isDefault: true },
    )
    : null;
  services.workflow.writeAudit({
    accountId: candidate.account_id,
    actor,
    action: "refresh_1688_product_detail",
    entityType: "sourcing_candidate",
    entityId: candidate.id,
    before: candidate,
    after: afterCandidate,
  });
  writePurchaseRequestEvent(
    db,
    getPurchaseRequest(db, candidate.pr_id),
    actor,
    "refresh_1688_product_detail",
    `1688 product detail refreshed: ${offerId}`,
  );
  markPurchaseRequestRead(db, candidate.pr_id, actor);

  const resultCandidate = toCamelRow(afterCandidate);
  resultCandidate.externalSkuOptions = parseJsonArray(afterCandidate.external_sku_options_json);
  resultCandidate.externalPriceRanges = parseJsonArray(afterCandidate.external_price_ranges_json);
  return {
    apiKey: PROCUREMENT_APIS.PRODUCT_DETAIL.key,
    query: apiParams,
    candidate: resultCandidate,
    detail: {
      ...detail,
      usedFallbackDetail,
      usedAlphaShopProductDetail,
      raw: undefined,
    },
    sku1688Source,
    rawResponse,
  };
}

async function preview1688UrlSpecsAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 URL spec preview");
  const productUrl = optionalString(payload.productUrl || payload.product_url || payload.url);
  const offerId = requireString(
    payload.offerId
      || payload.externalOfferId
      || payload.productId
      || payload.productID
      || extract1688OfferIdFromUrl(productUrl),
    "offerId",
  );
  const apiParams = build1688ProductDetailParams(offerId, payload);
  const fallbackCandidate = {
    account_id: optionalString(payload.accountId || payload.account_id),
    supplier_name: optionalString(payload.supplierName || payload.supplier_name),
    product_title: optionalString(payload.productTitle || payload.product_title),
    product_url: productUrl || `https://detail.1688.com/offer/${offerId}.html`,
    image_url: optionalString(payload.imageUrl || payload.image_url),
    unit_price: optionalNumber(payload.unitPrice ?? payload.unit_price),
    moq: optionalNumber(payload.moq),
    external_sku_options_json: "[]",
    external_price_ranges_json: "[]",
    source_payload_json: "{}",
  };
  let rawResponse = null;
  let detail = null;
  let usedFallbackDetail = false;
  let usedAlphaShopProductDetail = false;
  let alphaShopDetailError = null;
  let officialDetailError = null;
  const mockDetail = payload.mockDetail || payload.mockResponse || null;

  if (mockDetail) {
    rawResponse = mockDetail;
    detail = normalize1688ProductDetailResponse(rawResponse);
  } else {
    const preferAlphaShopDetail = payload.preferAlphaShopDetail !== false
      && payload.prefer_alpha_shop_detail !== false;
    if (preferAlphaShopDetail) {
      try {
        const alphaShopDetail = await runAlphaShopProductDetail({
          db,
          payload,
          actor,
          offerId,
        });
        if (hasSyncableSkuOptions(alphaShopDetail.detail)) {
          rawResponse = alphaShopDetail.rawResponse;
          detail = alphaShopDetail.detail;
          usedAlphaShopProductDetail = true;
        } else {
          alphaShopDetailError = new Error("productDetailQuery 未返回可绑定规格");
        }
      } catch (error) {
        alphaShopDetailError = error;
      }
    }

    if (!detail) {
      try {
        rawResponse = await call1688ProcurementApi({
          db,
          actor,
          accountId: fallbackCandidate.account_id,
          action: "preview_1688_url_specs",
          api: PROCUREMENT_APIS.PRODUCT_DETAIL,
          params: apiParams,
        });
        detail = normalize1688ProductDetailResponse(rawResponse);
      } catch (error) {
        officialDetailError = error;
        detail = await buildFallback1688ProductDetail(fallbackCandidate, offerId, payload, error);
        if (detail.raw?.fallbackDetail) {
          if (alphaShopDetailError) {
            detail.raw.fallbackDetail.alphaShopDetailError = alphaShopDetailError.message || String(alphaShopDetailError);
          }
          detail.raw.fallbackDetail.officialDetailError = officialDetailError?.message || String(officialDetailError || "");
        }
        rawResponse = detail.raw;
        usedFallbackDetail = true;
      }
    }
  }

  if (!hasSyncableSkuOptions(detail)) {
    const alphaShopMessage = alphaShopDetailError
      ? `productDetailQuery 未拿到可绑定规格（${alphaShopDetailError.message || String(alphaShopDetailError)}），`
      : "";
    const officialMessage = officialDetailError
      ? `1688 商品详情接口也未拿到规格（${officialDetailError.message || String(officialDetailError)}）。`
      : "";
    throw new Error(`${alphaShopMessage}${officialMessage || "未能从这个 1688 地址解析到可绑定规格。"}请开通 alibaba.product.get ACL，或手动填写 1688 商品规格ID。`);
  }

  return {
    apiKey: PROCUREMENT_APIS.PRODUCT_DETAIL.key,
    query: apiParams,
    externalOfferId: offerId,
    productUrl: productUrl || optionalString(detail.productUrl) || `https://detail.1688.com/offer/${offerId}.html`,
    detail: {
      ...detail,
      externalOfferId: optionalString(detail.externalOfferId) || offerId,
      productUrl: optionalString(detail.productUrl) || productUrl || `https://detail.1688.com/offer/${offerId}.html`,
      usedFallbackDetail,
      usedAlphaShopProductDetail,
      raw: undefined,
    },
    rawResponse,
  };
}

function bind1688CandidateSpecAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 spec binding");
  const candidateId = requireString(payload.candidateId || payload.id, "candidateId");
  const candidate = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidateId);
  if (!candidate) throw new Error(`Sourcing candidate not found: ${candidateId}`);
  const pr = getPurchaseRequest(db, candidate.pr_id);
  const skuOptions = parseJsonArray(candidate.external_sku_options_json);
  const externalSpecId = require1688SpecId(
    payload.externalSpecId || payload.external_spec_id,
    "1688 spec binding",
  );
  const selectedSku = skuOptions.find((sku) => (
    String(sku.externalSpecId || sku.external_spec_id || sku.specId || sku.spec_id || "") === externalSpecId
  )) || {};
  const externalSkuId = optionalString(
    payload.externalSkuId
      || payload.external_sku_id
      || selectedSku.externalSkuId
      || selectedSku.external_sku_id
      || selectedSku.skuId
      || selectedSku.sku_id
      || candidate.external_sku_id,
  ) || externalSpecId;
  const unitPrice = optionalNumber(payload.unitPrice ?? payload.unit_price)
    ?? optionalNumber(selectedSku.price)
    ?? optionalNumber(candidate.unit_price)
    ?? 0;
  const ourQty = optionalPositiveInteger(payload.ourQty ?? payload.our_qty, 1);
  const platformQty = optionalPositiveInteger(payload.platformQty ?? payload.platform_qty, 1);
  const now = nowIso();

  db.prepare(`
    UPDATE erp_sourcing_candidates
    SET external_sku_id = @external_sku_id,
        external_spec_id = @external_spec_id,
        unit_price = @unit_price,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: candidate.id,
    external_sku_id: externalSkuId,
    external_spec_id: externalSpecId,
    unit_price: unitPrice,
    updated_at: now,
  });

  const afterCandidate = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidate.id);
  const sku1688Source = upsertSku1688SourceFromCandidate(
    db,
    afterCandidate,
    pr,
    actor,
    {
      isDefault: true,
      ourQty,
      platformQty,
      platformSkuName: selectedSku.specText || selectedSku.spec_text || externalSpecId,
      remark: `本地 ${ourQty} 件 = 1688 ${platformQty} 件`,
    },
  );
  services.workflow.writeAudit({
    accountId: candidate.account_id,
    actor,
    action: "bind_1688_candidate_spec",
    entityType: "sourcing_candidate",
    entityId: candidate.id,
    before: candidate,
    after: afterCandidate,
  });
  writePurchaseRequestEvent(
    db,
    pr,
    actor,
    "bind_1688_candidate_spec",
    `1688 spec bound: ${candidate.external_offer_id || ""}/${externalSpecId}`,
  );
  markPurchaseRequestRead(db, candidate.pr_id, actor);

  const resultCandidate = toCamelRow(afterCandidate);
  resultCandidate.externalSkuOptions = skuOptions;
  resultCandidate.externalPriceRanges = parseJsonArray(afterCandidate.external_price_ranges_json);
  return {
    candidate: resultCandidate,
    selectedSpec: {
      externalSkuId,
      externalSpecId,
      unitPrice,
      specText: selectedSku.specText || selectedSku.spec_text || null,
      ourQty,
      platformQty,
    },
    sku1688Source,
  };
}

function build1688AddressParamFromRow(row = {}) {
  const raw = parseJsonObject(row.raw_address_param_json);
  const fromRaw = Object.keys(raw).length ? raw : {};
  const addressParam = {
    ...fromRaw,
  };
  if (row.address_id) addressParam.addressId = row.address_id;
  if (row.full_name) addressParam.fullName = row.full_name;
  if (row.mobile) addressParam.mobile = row.mobile;
  if (row.phone) addressParam.phone = row.phone;
  if (row.post_code) addressParam.postCode = row.post_code;
  if (row.province_text) addressParam.provinceText = row.province_text;
  if (row.city_text) addressParam.cityText = row.city_text;
  if (row.area_text) addressParam.areaText = row.area_text;
  if (row.town_text) addressParam.townText = row.town_text;
  if (row.address) addressParam.address = row.address;
  // 兜底:1688 receiveAddress.get 只返回合并文本 addressCodeText("广东省 广州市 黄埔区"),没拆 province/city/area。
  // createOrder.preview 又要求 provinceText/cityText/areaText 非空,否则报 AddressId invalid。
  // 从 addressCodeText 拆开兜底补上。
  if (!addressParam.provinceText || !addressParam.cityText || !addressParam.areaText) {
    const text = String(addressParam.addressCodeText || raw.addressCodeText || "").trim();
    if (text) {
      const parts = text.split(/\s+/).filter(Boolean);
      if (!addressParam.provinceText && parts[0]) addressParam.provinceText = parts[0];
      if (!addressParam.cityText && parts[1]) addressParam.cityText = parts[1];
      if (!addressParam.areaText && parts[2]) addressParam.areaText = parts[2];
      if (!addressParam.townText && parts[3]) addressParam.townText = parts[3];
    }
  }
  return addressParam;
}

function create1688AddressError(code, message) {
  const error = new Error(`errorCode:${code} ${message}`);
  error.code = code;
  return error;
}

function throw1688RemoteAddressMissing() {
  throw create1688AddressError(
    "ADDRESS_REMOTE_ID_MISSING",
    "该收货地址还没有 1688 远端 ID，请到「询盘设置」点「同步 1688 地址」拉一份完整数据后重新选择再推单。",
  );
}

function queryDefault1688DeliveryAddress(db, whereSql, values = {}) {
  const usable = db.prepare(`
    SELECT *
    FROM erp_1688_delivery_addresses
    WHERE ${whereSql}
      AND status = 'active'
      AND address_id IS NOT NULL AND address_id != ''
    ORDER BY is_default DESC, updated_at DESC, created_at DESC
    LIMIT 1
  `).get(values);
  if (usable) return usable;
  const activeCount = db.prepare(`
    SELECT COUNT(1) AS count
    FROM erp_1688_delivery_addresses
    WHERE ${whereSql}
      AND status = 'active'
  `).get(values)?.count || 0;
  if (activeCount > 0) throw1688RemoteAddressMissing();
  return null;
}

function list1688DeliveryAddresses(params = {}) {
  const { db } = requireErp();
  const status = optionalString(params.status);
  const companyId = normalizeCompanyId(params.companyId || params.company_id, erpState.currentUser);
  const accountId = optionalString(params.accountId || params.account_id);
  // [OAuth 维度 2026-05-21] 加 OAuth filter；caller 通常按 OAuth 列地址（picker）。
  const purchase1688AccountId = optionalString(params.purchase1688AccountId || params.purchase_1688_account_id);
  const conditions = ["addr.company_id = @company_id"];
  const values = { company_id: companyId, status, account_id: accountId, oauth_id: purchase1688AccountId };
  if (status) conditions.push("addr.status = @status");
  if (accountId) conditions.push("addr.account_id = @account_id");
  if (purchase1688AccountId) conditions.push("addr.purchase_1688_account_id = @oauth_id");
  const rows = db.prepare(`
    SELECT addr.*, acct.name AS account_name
    FROM erp_1688_delivery_addresses addr
    LEFT JOIN erp_accounts acct ON acct.id = addr.account_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY addr.is_default DESC, addr.updated_at DESC, addr.created_at DESC
  `).all(values);
  return rows.map(to1688DeliveryAddress);
}

function get1688DeliveryAddress(db, addressId = null, companyId = DEFAULT_COMPANY_ID, accountId = null, purchase1688AccountId = null) {
  const id = optionalString(addressId);
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const normalizedAccountId = optionalString(accountId);
  const normalizedOauth = optionalString(purchase1688AccountId);
  if (id) {
    // [OAuth 维度 2026-05-21] 取消 account_id 硬校验。地址按 1688 OAuth 归属，跨 ERP
    // 店铺共用同一仓库地址是常态；resolve1688AddressParam 的 cross-OAuth fallback 兜底
    // OAuth 维度的不一致。这里只要拿到地址行就返回，跨账号判断交给上游。
    const row = db.prepare("SELECT * FROM erp_1688_delivery_addresses WHERE id = ? AND company_id = ?").get(id, normalizedCompanyId);
    if (!row) throw new Error(`1688 delivery address not found: ${id}`);
    return row;
  }
  // [OAuth 维度 2026-05-21] 默认地址查询：优先按 OAuth；OAuth 没传退回老的 account_id 路径。
  if (normalizedOauth) {
    const row = queryDefault1688DeliveryAddress(db, "company_id = @company_id AND purchase_1688_account_id = @oauth_id", {
      company_id: normalizedCompanyId,
      oauth_id: normalizedOauth,
    });
    if (row) return row;
    throw create1688AddressError(
      "ADDRESS_INACTIVE",
      "当前 1688 采购账号下没有可用的收货地址，请到「询盘设置」点「同步 1688 地址」后重新选择。",
    );
  }
  if (normalizedAccountId) {
    const row = queryDefault1688DeliveryAddress(db, "company_id = @company_id AND account_id = @account_id", {
      company_id: normalizedCompanyId,
      account_id: normalizedAccountId,
    });
    if (row) return row;
    const account = db.prepare("SELECT name FROM erp_accounts WHERE id = ?").get(normalizedAccountId);
    throw new Error(`店铺${account?.name ? `「${account.name}」` : ""}还没有绑定 1688 地址，请先到店铺维护`);
  }
  const row = queryDefault1688DeliveryAddress(db, "company_id = @company_id AND (account_id IS NULL OR account_id = '')", {
    company_id: normalizedCompanyId,
  });
  if (!row) throw new Error("1688 delivery address is not configured");
  return row;
}

function save1688DeliveryAddressAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 delivery address config");
  const now = nowIso();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const accountId = optionalString(payload.accountId || payload.account_id);
  // [OAuth 维度 2026-05-21] 新逻辑：地址按 1688 OAuth (purchase_1688_account_id) 归属，
  // 不再硬绑 ERP 店铺 (account_id)。同步路径会传 purchase1688AccountId 进来；旧 caller
  // 没传时，从 account_id 反查店铺挂的默认 OAuth 兜底。account_id 字段保留兼容旧客户端。
  let purchase1688AccountId = optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id);
  if (accountId) {
    const account = db.prepare("SELECT id, company_id, default_1688_purchase_account_id FROM erp_accounts WHERE id = ?").get(accountId);
    if (!account) throw new Error("店铺不存在，无法绑定 1688 地址");
    if (normalizeCompanyId(account.company_id, actor) !== companyId) {
      throw new Error("店铺不属于当前公司，无法绑定 1688 地址");
    }
    if (!purchase1688AccountId) {
      purchase1688AccountId = optionalString(account.default_1688_purchase_account_id);
    }
  }
  const rawAddressParam = payload.rawAddressParam || payload.addressParam || {};
  const row = {
    id: optionalString(payload.addressId || payload.id) || createId("1688_addr"),
    company_id: companyId,
    account_id: accountId || null,
    purchase_1688_account_id: purchase1688AccountId || null,
    label: requireString(payload.label || payload.name, "label"),
    full_name: requireString(payload.fullName || payload.receiverName || rawAddressParam.fullName, "fullName"),
    mobile: optionalString(payload.mobile || rawAddressParam.mobile),
    phone: optionalString(payload.phone || rawAddressParam.phone),
    post_code: optionalString(payload.postCode || rawAddressParam.postCode),
    province_text: optionalString(payload.provinceText || rawAddressParam.provinceText),
    city_text: optionalString(payload.cityText || rawAddressParam.cityText),
    area_text: optionalString(payload.areaText || rawAddressParam.areaText),
    town_text: optionalString(payload.townText || rawAddressParam.townText),
    address: requireString(payload.address || rawAddressParam.address, "address"),
    address_id: optionalString(payload.alibabaAddressId || rawAddressParam.addressId),
    raw_address_param_json: trimJsonForStorage(rawAddressParam || {}),
    is_default: payload.isDefault === false ? 0 : (payload.isDefault || payload.default ? 1 : 0),
    status: optionalString(payload.status) || "active",
    created_by: optionalString(actor.id),
    created_at: now,
    updated_at: now,
  };
  if (!row.mobile && !row.phone && !row.address_id) {
    throw new Error("mobile, phone or alibabaAddressId is required");
  }
  if (!["active", "blocked"].includes(row.status)) {
    throw new Error("Invalid 1688 delivery address status");
  }
  const existing = db.prepare("SELECT created_at, created_by FROM erp_1688_delivery_addresses WHERE id = ?").get(row.id);
  if (row.is_default) {
    // [OAuth 维度 2026-05-21] is_default 重置范围改成按 OAuth；OAuth 未知时退回旧的 account_id 范围。
    if (row.purchase_1688_account_id) {
      db.prepare("UPDATE erp_1688_delivery_addresses SET is_default = 0 WHERE company_id = ? AND purchase_1688_account_id = ? AND id != ?")
        .run(row.company_id, row.purchase_1688_account_id, row.id);
    } else if (row.account_id) {
      db.prepare("UPDATE erp_1688_delivery_addresses SET is_default = 0 WHERE company_id = ? AND account_id = ? AND id != ?")
        .run(row.company_id, row.account_id, row.id);
    } else {
      db.prepare("UPDATE erp_1688_delivery_addresses SET is_default = 0 WHERE company_id = ? AND (account_id IS NULL OR account_id = '') AND id != ?")
        .run(row.company_id, row.id);
    }
  }
  db.prepare(`
    INSERT INTO erp_1688_delivery_addresses (
      id, company_id, account_id, purchase_1688_account_id, label, full_name, mobile, phone, post_code, province_text, city_text,
      area_text, town_text, address, address_id, raw_address_param_json,
      is_default, status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @account_id, @purchase_1688_account_id, @label, @full_name, @mobile, @phone, @post_code, @province_text, @city_text,
      @area_text, @town_text, @address, @address_id, @raw_address_param_json,
      @is_default, @status, @created_by, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      account_id = excluded.account_id,
      purchase_1688_account_id = excluded.purchase_1688_account_id,
      label = excluded.label,
      full_name = excluded.full_name,
      mobile = excluded.mobile,
      phone = excluded.phone,
      post_code = excluded.post_code,
      province_text = excluded.province_text,
      city_text = excluded.city_text,
      area_text = excluded.area_text,
      town_text = excluded.town_text,
      address = excluded.address,
      address_id = excluded.address_id,
      raw_address_param_json = excluded.raw_address_param_json,
      is_default = excluded.is_default,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run({
    ...row,
    created_by: existing?.created_by || row.created_by,
    created_at: existing?.created_at || row.created_at,
  });
  return to1688DeliveryAddress(db.prepare("SELECT * FROM erp_1688_delivery_addresses WHERE id = ?").get(row.id));
}

function looksLike1688Address(item = {}) {
  return Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && (
      item.addressId
      || item.addressID
      || item.receiveAddressId
      || item.id
      || item.fullName
      || item.receiverName
      || item.receiveName
      || item.mobile
      || item.mobileNo
      || item.receiverMobile
      || item.phoneNumber
      || item.phone
      || item.address
      || item.detailAddress
      || item.addressDetail
      || item.fullAddress
    )
  );
}

function addressTextValue(value) {
  if (value === null || value === undefined) return null;
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  return optionalString(value);
}

function findFirstDeepAddressText(value, keys = [], depth = 0) {
  if (!value || depth > 8) return null;
  const keySet = new Set(keys.map((key) => String(key).toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstDeepAddressText(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, next] of Object.entries(value)) {
    if (keySet.has(String(key).toLowerCase())) {
      const text = addressTextValue(next);
      if (text) return text;
    }
  }
  for (const next of Object.values(value)) {
    const found = findFirstDeepAddressText(next, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function first1688AddressValue(raw, keys = []) {
  return findFirstDeepAddressText(raw, keys);
}

const CHINA_PROVINCE_NAMES = [
  "北京市", "天津市", "上海市", "重庆市",
  "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省",
  "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省",
  "河南省", "湖北省", "湖南省", "广东省", "海南省", "四川省",
  "贵州省", "云南省", "陕西省", "甘肃省", "青海省", "台湾省",
  "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区",
  "新疆维吾尔自治区", "香港特别行政区", "澳门特别行政区",
];

const CHINA_MUNICIPALITIES = new Set(["北京市", "天津市", "上海市", "重庆市"]);

function parseChineseRegionFromAddressText(value) {
  const source = (addressTextValue(value) || "").replace(/\s+/g, " ").trim();
  const empty = { provinceText: "", cityText: "", areaText: "", address: "" };
  if (!source) return empty;

  const compact = source.replace(/\s+/g, "");
  let provinceText = "";
  let provinceIndex = -1;
  for (const province of CHINA_PROVINCE_NAMES) {
    const index = compact.indexOf(province);
    if (index >= 0 && (provinceIndex < 0 || index < provinceIndex)) {
      provinceText = province;
      provinceIndex = index;
    }
  }
  if (!provinceText) return empty;

  const rest = compact.slice(provinceIndex + provinceText.length);
  const match = rest.match(/^(.+?(?:自治州|地区|盟|市))?(.+?(?:区|县|市|旗))?/);
  const matchedCityText = match?.[1] || "";
  const areaText = match?.[2] || "";
  const cityText = matchedCityText || (CHINA_MUNICIPALITIES.has(provinceText) ? provinceText : "");
  let address = source;
  for (const part of [provinceText, matchedCityText, areaText].filter(Boolean)) {
    address = address.replace(part, "");
  }
  address = address.replace(/\s+/g, " ").trim();
  return { provinceText, cityText, areaText, address };
}

function normalize1688RemoteAddress(item = {}, index = 0) {
  const raw = asExpandedObject(item);
  const addressId = optionalString(
    raw.addressId
    || raw.addressID
    || raw.receiveAddressId
    || raw.receive_address_id
    || raw.id,
  );
  const fullName = optionalString(
    raw.fullName
    || raw.receiverName
    || raw.receiveName
    || raw.receiver
    || raw.consignee
    || raw.contactName
    || raw.name,
  ) || "1688 Receiver";
  const provinceText = first1688AddressValue(raw, ["provinceText", "provinceName", "province", "provName"]);
  const cityText = first1688AddressValue(raw, ["cityText", "cityName", "city"]);
  const areaText = first1688AddressValue(raw, ["areaText", "areaName", "district", "districtName", "county", "countyName", "area"]);
  const townText = first1688AddressValue(raw, ["townText", "townName", "town", "streetName"]);
  const address = first1688AddressValue(raw, [
    "address", "detailAddress", "addressDetail", "detailedAddress",
    "receiverAddress", "receiveAddress", "streetAddress", "fullAddress",
  ]) || [provinceText, cityText, areaText, townText].filter(Boolean).join("");
  const mobile = first1688AddressValue(raw, [
    "mobile", "mobileNo", "mobileNumber", "mobilePhone", "phoneNumber", "phoneNum",
    "receiverMobile", "receiverMobileNo", "receiveMobile", "receiveMobileNo",
    "recipientMobile", "consigneeMobile", "contactMobile", "cellphone",
  ]);
  const phone = first1688AddressValue(raw, ["phone", "tel", "telephone", "receiverPhone", "receivePhone", "contactPhone"]);
  const postCode = first1688AddressValue(raw, ["postCode", "postcode", "postalCode", "zip", "zipCode", "post"]);
  const parsedAddress = parseChineseRegionFromAddressText(address);
  const parsedSummary = parseChineseRegionFromAddressText([
    address,
    addressTextValue(raw.fullAddress),
    addressTextValue(raw.label),
    addressTextValue(raw.alias),
    addressTextValue(raw.addressName),
  ].filter(Boolean).join(" "));
  const normalizedProvinceText = provinceText || parsedAddress.provinceText || parsedSummary.provinceText;
  const normalizedCityText = cityText || parsedAddress.cityText || parsedSummary.cityText;
  const normalizedAreaText = areaText || parsedAddress.areaText || parsedSummary.areaText;
  const normalizedAddress = parsedAddress.address
    || address
    || [normalizedProvinceText, normalizedCityText, normalizedAreaText, townText].filter(Boolean).join("");
  return {
    label: optionalString(raw.label || raw.alias || raw.addressName) || `${fullName} ${addressId || index + 1}`,
    fullName,
    mobile,
    phone,
    postCode,
    provinceText: normalizedProvinceText,
    cityText: normalizedCityText,
    areaText: normalizedAreaText,
    townText,
    address: normalizedAddress || "1688 remote address",
    alibabaAddressId: addressId,
    rawAddressParam: {
      ...raw,
      ...(addressId ? { addressId } : {}),
      fullName,
      mobile,
      phone,
      postCode,
      provinceText: normalizedProvinceText,
      cityText: normalizedCityText,
      areaText: normalizedAreaText,
      townText,
      address: normalizedAddress || raw.address,
    },
    isDefault: Boolean(raw.isDefault || raw.defaultAddress || raw.default || index === 0),
    status: "active",
  };
}

function normalize1688ReceiveAddressResponse(rawResponse = {}) {
  const expanded = asExpandedObject(rawResponse);
  const rows = findDeepArray(expanded, looksLike1688Address);
  if (!rows.length && looksLike1688Address(expanded)) return [normalize1688RemoteAddress(expanded, 0)];
  return rows.map(normalize1688RemoteAddress).filter((item) => item.address || item.alibabaAddressId);
}

function findExisting1688AddressId(db, { companyId, accountId, purchase1688AccountId, alibabaAddressId }) {
  const remoteId = optionalString(alibabaAddressId);
  if (!remoteId) return null;
  // [OAuth 维度 2026-05-21] 优先按 OAuth 匹配。同一个 OAuth 下 (address_id) 应该唯一。
  // 没传 OAuth 时退回按 account_id 兼容旧逻辑。
  const oauth = optionalString(purchase1688AccountId);
  if (oauth) {
    const row = db.prepare(`
      SELECT id
      FROM erp_1688_delivery_addresses
      WHERE company_id = @company_id
        AND purchase_1688_account_id = @oauth_id
        AND address_id = @address_id
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({ company_id: companyId, oauth_id: oauth, address_id: remoteId });
    if (row?.id) return row.id;
  }
  const row = db.prepare(`
    SELECT id
    FROM erp_1688_delivery_addresses
    WHERE company_id = @company_id
      AND COALESCE(account_id, '') = COALESCE(@account_id, '')
      AND address_id = @address_id
    ORDER BY updated_at DESC
    LIMIT 1
  `).get({
    company_id: companyId,
    account_id: optionalString(accountId) || "",
    address_id: remoteId,
  });
  return row?.id || null;
}

async function sync1688DeliveryAddressesAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 receive address sync");
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const accountId = optionalString(payload.accountId || payload.account_id);
  // [OAuth 维度 2026-05-21] 同步以 OAuth 为单位。caller 未传 OAuth 时，按 accountId
  // 反查店铺挂的默认 OAuth；都没有就让 call1688ProcurementApi 走公司默认 OAuth。
  let purchase1688AccountId = optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id);
  if (!purchase1688AccountId && accountId) {
    const acct = db.prepare("SELECT default_1688_purchase_account_id FROM erp_accounts WHERE id = ?").get(accountId);
    purchase1688AccountId = optionalString(acct?.default_1688_purchase_account_id);
  }
  if (!purchase1688AccountId) {
    purchase1688AccountId = optionalString(resolve1688AuthRowForPurchase({
      companyId,
      accountId,
    })?.id);
  }
  const params = raw1688Params(payload, {
    webSite: optionalString(payload.webSite) || "1688",
  });
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.RECEIVE_ADDRESS.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId,
    purchase1688AccountId,
    action: "sync_1688_addresses",
    api: PROCUREMENT_APIS.RECEIVE_ADDRESS,
    params,
  });
  const addresses = normalize1688ReceiveAddressResponse(rawResponse);
  let addedCount = 0;
  let updatedCount = 0;
  const saved = addresses.map((address) => {
    const existingId = findExisting1688AddressId(db, {
      companyId,
      accountId,
      purchase1688AccountId,
      alibabaAddressId: address.alibabaAddressId,
    });
    if (existingId) updatedCount += 1; else addedCount += 1;
    return save1688DeliveryAddressAction({
      db,
      actor,
      payload: {
        ...address,
        id: existingId || undefined,
        companyId,
        accountId,
        purchase1688AccountId,
      },
    });
  });
  // diff: 远端没回来的本地行打 inactive。
  // [OAuth 维度 2026-05-21] 反向反激活范围改成按 OAuth（同一个 OAuth 名下的所有
  // 地址）；OAuth 未知时退回老的 account_id 范围保持兼容。
  let deactivatedCount = 0;
  if (addresses.length > 0 && !payload.skipDeactivate) {
    const remoteAddressIds = new Set(
      addresses.map((address) => optionalString(address.alibabaAddressId)).filter(Boolean),
    );
    const localActiveRows = purchase1688AccountId
      ? db.prepare(`
        SELECT id, address_id
        FROM erp_1688_delivery_addresses
        WHERE company_id = @company_id
          AND purchase_1688_account_id = @oauth_id
          AND status = 'active'
      `).all({ company_id: companyId, oauth_id: purchase1688AccountId })
      : db.prepare(`
      SELECT id, address_id
      FROM erp_1688_delivery_addresses
      WHERE company_id = @company_id
        AND COALESCE(account_id, '') = COALESCE(@account_id, '')
        AND status = 'active'
    `).all({ company_id: companyId, account_id: accountId || "" });
    const deactivateStmt = db.prepare(`
      UPDATE erp_1688_delivery_addresses
      SET status = 'inactive', updated_at = @updated_at
      WHERE id = @id
    `);
    const now = nowIso();
    for (const row of localActiveRows) {
      const remoteId = optionalString(row.address_id);
      if (remoteId && remoteAddressIds.has(remoteId)) continue;
      deactivateStmt.run({ id: row.id, updated_at: now });
      deactivatedCount += 1;
    }
  }
  return {
    apiKey: PROCUREMENT_APIS.RECEIVE_ADDRESS.key,
    query: params,
    addressCount: saved.length,
    addresses: saved,
    addedCount,
    updatedCount,
    deactivatedCount,
    rawResponse,
  };
}

function getLatest1688AddressUpdatedAt(db, companyId) {
  const row = db.prepare(`
    SELECT MAX(updated_at) AS updated_at
    FROM erp_1688_delivery_addresses
    WHERE company_id = @company_id
      AND status = 'active'
  `).get({ company_id: companyId });
  return optionalString(row?.updated_at);
}

function shouldAutoSync1688Addresses(db, companyId) {
  const state = erpState.auto1688AddressSyncByCompany.get(companyId) || {};
  if (state.promise) return false;
  const now = Date.now();
  const lastAttemptAt = Number(state.lastAttemptAt || 0);
  if (lastAttemptAt && now - lastAttemptAt < AUTO_1688_ADDRESS_SYNC_INTERVAL_MS) return false;
  const latestUpdatedAt = getLatest1688AddressUpdatedAt(db, companyId);
  const latestMs = latestUpdatedAt ? Date.parse(latestUpdatedAt) : 0;
  return !latestMs || now - latestMs >= AUTO_1688_ADDRESS_SYNC_INTERVAL_MS;
}

function ensureDefault1688DeliveryAddresses(db, { companyId, actor = {}, wait = false } = {}) {
  const normalizedCompanyId = normalizeCompanyId(companyId, actor);
  if (!actorCan(actor, ["buyer", "manager", "admin"])) {
    return wait ? Promise.resolve(null) : null;
  }
  if (!shouldAutoSync1688Addresses(db, normalizedCompanyId)) {
    const state = erpState.auto1688AddressSyncByCompany.get(normalizedCompanyId);
    return wait && state?.promise ? state.promise : (wait ? Promise.resolve(null) : null);
  }
  const state = {
    lastAttemptAt: Date.now(),
    promise: null,
  };
  const promise = sync1688DeliveryAddressesAction({
    db,
    payload: { companyId: normalizedCompanyId },
    actor,
  })
    .catch(() => null)
    .finally(() => {
      const current = erpState.auto1688AddressSyncByCompany.get(normalizedCompanyId);
      if (current) {
        erpState.auto1688AddressSyncByCompany.set(normalizedCompanyId, {
          ...current,
          promise: null,
        });
      }
    });
  state.promise = promise;
  erpState.auto1688AddressSyncByCompany.set(normalizedCompanyId, state);
  return wait ? promise : null;
}

function getSku1688SourceCandidateForPo(db, pr, actor = {}) {
  const source = getActiveSku1688SourceRows(db, pr.account_id, pr.sku_id)[0];
  return source ? buildCandidateFromSku1688Source(db, pr, source, actor) : null;
}

function getCandidateForPo(db, pr, candidateId, actor = {}, options = {}) {
  const prId = pr.id || pr;
  if (candidateId) {
    const row = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidateId);
    if (!row) throw new Error(`Sourcing candidate not found: ${candidateId}`);
    if (row.pr_id !== prId) throw new Error("Sourcing candidate does not belong to this request");
    return row;
  }
  if (options.preferSku1688Source) {
    const sourceCandidate = getSku1688SourceCandidateForPo(db, pr, actor);
    if (sourceCandidate) return sourceCandidate;
  }
  const row = db.prepare(`
    SELECT *
    FROM erp_sourcing_candidates
    WHERE pr_id = ?
    ORDER BY
      CASE status WHEN 'selected' THEN 0 WHEN 'shortlisted' THEN 1 WHEN 'candidate' THEN 2 ELSE 9 END,
      updated_at DESC
    LIMIT 1
  `).get(prId);
  if (row) return row;

  const sourceCandidate = getSku1688SourceCandidateForPo(db, pr, actor);
  if (sourceCandidate) return sourceCandidate;

  const skuSupplier = getSkuSupplierSource(db, pr.sku_id);
  const supplierCandidate = buildCandidateFromSkuSupplier(db, pr, skuSupplier, actor);
  if (supplierCandidate) return supplierCandidate;

  throw new Error("请先添加报价反馈、绑定供应商管理记录或在商品资料维护供应商，再生成采购单");
}

function applySelected1688SpecToCandidate(candidate = {}, payload = {}) {
  const externalOfferId = optionalString(candidate.external_offer_id || candidate.externalOfferId);
  if (!externalOfferId) return candidate;
  const skuOptions = parseJsonArray(candidate.external_sku_options_json);
  const requestedSpecId = optionalString(payload.externalSpecId || payload.external_spec_id || payload.specId);
  const requestedSkuId = optionalString(payload.externalSkuId || payload.external_sku_id || payload.skuId);
  const selectedSku = skuOptions.find((sku) => (
    (!requestedSpecId || optionalString(sku.externalSpecId) === requestedSpecId)
    && (!requestedSkuId || optionalString(sku.externalSkuId) === requestedSkuId)
  )) || null;
  const externalSpecId = optionalString(
    requestedSpecId
    || selectedSku?.externalSpecId
    || candidate.external_spec_id
    || candidate.externalSpecId,
  );
  const externalSkuId = optionalString(
    requestedSkuId
    || selectedSku?.externalSkuId
    || candidate.external_sku_id
    || candidate.externalSkuId,
  );
  return {
    ...candidate,
    external_sku_id: externalSkuId,
    external_spec_id: externalSpecId,
    unit_price: optionalNumber(payload.unitPrice ?? payload.unit_price)
      ?? optionalNumber(selectedSku?.price)
      ?? optionalNumber(candidate.unit_price),
  };
}

function isSixDigitPurchaseOrderNo(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function normalizePurchaseOrderNumbers(db) {
  if (!db?.prepare) return { updated: 0 };
  const rows = db.prepare(`
    SELECT id, po_no
    FROM erp_purchase_orders
    ORDER BY COALESCE(created_at, ''), id
  `).all();
  const reserved = new Set();
  const pending = [];
  for (const row of rows) {
    const poNo = optionalString(row.po_no);
    if (isSixDigitPurchaseOrderNo(poNo) && !reserved.has(poNo)) {
      reserved.add(poNo);
    } else {
      pending.push(row);
    }
  }
  if (!pending.length) return { updated: 0 };
  let nextSerial = 1;
  const nextPoNo = () => {
    while (reserved.has(String(nextSerial).padStart(6, "0"))) nextSerial += 1;
    if (nextSerial > 999999) throw new Error("采购单号流水已超过 999999，请调整编号规则");
    const poNo = String(nextSerial).padStart(6, "0");
    reserved.add(poNo);
    nextSerial += 1;
    return poNo;
  };
  const update = db.prepare("UPDATE erp_purchase_orders SET po_no = @po_no WHERE id = @id");
  const tx = db.transaction((items) => {
    for (const row of items) update.run({ id: row.id, po_no: nextPoNo() });
  });
  tx(pending);
  return { updated: pending.length };
}

function normalizePurchaseWorkbenchPoNumbers(workbench = {}) {
  const purchaseOrders = Array.isArray(workbench.purchaseOrders) ? workbench.purchaseOrders : [];
  if (!purchaseOrders.length) return workbench;
  const reserved = new Set();
  const pending = [];
  const mappedById = new Map();
  for (const row of purchaseOrders) {
    const poNo = optionalString(row.poNo || row.po_no);
    if (isSixDigitPurchaseOrderNo(poNo) && !reserved.has(poNo)) {
      reserved.add(poNo);
      mappedById.set(row.id, poNo);
    } else {
      pending.push(row);
    }
  }
  let nextSerial = 1;
  const nextPoNo = () => {
    while (reserved.has(String(nextSerial).padStart(6, "0"))) nextSerial += 1;
    const poNo = String(nextSerial).padStart(6, "0");
    reserved.add(poNo);
    nextSerial += 1;
    return poNo;
  };
  pending
    .slice()
    .sort((left, right) => {
      const leftDate = String(left.createdAt || left.created_at || left.updatedAt || left.updated_at || "");
      const rightDate = String(right.createdAt || right.created_at || right.updatedAt || right.updated_at || "");
      return leftDate.localeCompare(rightDate) || String(left.id || "").localeCompare(String(right.id || ""));
    })
    .forEach((row) => mappedById.set(row.id, nextPoNo()));

  const nextOrders = purchaseOrders.map((row) => {
    const poNo = mappedById.get(row.id);
    if (!poNo) return row;
    return {
      ...row,
      originalPoNo: row.originalPoNo || row.poNo || row.po_no || null,
      poNo,
      po_no: row.po_no !== undefined ? poNo : row.po_no,
    };
  });
  const nextPaymentQueue = Array.isArray(workbench.paymentQueue)
    ? workbench.paymentQueue.map((row) => {
      const poNo = mappedById.get(row.poId || row.po_id);
      return poNo ? { ...row, originalPoNo: row.originalPoNo || row.poNo || row.po_no || null, poNo, po_no: row.po_no !== undefined ? poNo : row.po_no } : row;
    })
    : workbench.paymentQueue;
  return {
    ...workbench,
    purchaseOrders: nextOrders,
    paymentQueue: nextPaymentQueue,
  };
}

function normalizeJstPurchaseWorkbench(workbench = {}) {
  const purchaseOrders = Array.isArray(workbench.purchaseOrders) ? workbench.purchaseOrders : [];
  if (!purchaseOrders.length) return workbench;
  const normalizeOrder = (row = {}) => {
    const accountId = row.accountId || row.account_id;
    if (accountId !== "jst:account:default") return row;
    const raw = parseJsonObject(row.externalOrderPayloadJson || row.external_order_payload_json, {});
    const totalQty = Number(raw.qty_count || raw.total_qty || raw.enable_follow_qty || 0);
    const receivedQty = Number(raw.total_in_qty || raw.plan_arrive_qty || 0);
    const skuSummary = [raw.item_type, raw.labels].filter(Boolean).join(" / ") || "聚水潭采购单";
    const skuCodes = optionalString(raw.merge_sku_id || raw.merge_i_id);
    const next = { ...row };
    if (totalQty > 0 && Number(next.totalQty || next.total_qty || 0) <= 0) {
      next.totalQty = totalQty;
      if (next.total_qty !== undefined) next.total_qty = totalQty;
    }
    if (receivedQty > 0 && Number(next.receivedQty || next.received_qty || 0) <= 0) {
      next.receivedQty = receivedQty;
      if (next.received_qty !== undefined) next.received_qty = receivedQty;
    }
    if (!next.skuSummary && !next.sku_summary) {
      next.skuSummary = skuSummary;
      if (next.sku_summary !== undefined) next.sku_summary = skuSummary;
    }
    if (skuCodes && !next.skuCodes && !next.sku_codes) {
      next.skuCodes = skuCodes;
      if (next.sku_codes !== undefined) next.sku_codes = skuCodes;
    }
    if (!next.productNames && !next.product_names) {
      next.productNames = skuSummary;
      if (next.product_names !== undefined) next.product_names = skuSummary;
    }
    return next;
  };
  return {
    ...workbench,
    purchaseOrders: purchaseOrders.map(normalizeOrder),
  };
}

function normalizePurchaseResultPoNumbers(result = {}) {
  if (!result || typeof result !== "object") return result;
  const workbench = result.workbench ? normalizePurchaseWorkbenchPoNumbers(result.workbench) : null;
  if (!workbench) return result;
  const purchaseOrder = result.purchaseOrder?.id
    ? workbench.purchaseOrders.find((row) => row.id === result.purchaseOrder.id) || result.purchaseOrder
    : result.purchaseOrder;
  return {
    ...result,
    workbench,
    purchaseOrder,
  };
}

function getNextClientPurchaseOrderNo(workbench = {}) {
  const normalized = normalizePurchaseWorkbenchPoNumbers(workbench);
  const maxNo = (normalized.purchaseOrders || [])
    .map((row) => optionalString(row.poNo || row.po_no))
    .filter(isSixDigitPurchaseOrderNo)
    .reduce((max, value) => Math.max(max, Number(value)), 0);
  const next = maxNo + 1;
  if (next > 999999) throw new Error("采购单号流水已超过 999999，请调整编号规则");
  return String(next).padStart(6, "0");
}

function buildPurchaseOrderNo(db) {
  let nextSerial = 1;
  if (db?.prepare) {
    const rows = db.prepare(`
      SELECT po_no
      FROM erp_purchase_orders
      WHERE length(po_no) = 6
        AND po_no GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
    `).all();
    for (const row of rows) {
      const poNo = optionalString(row.po_no);
      if (!poNo) continue;
      nextSerial = Math.max(nextSerial, Number(poNo) + 1);
    }
  }
  if (nextSerial > 999999) throw new Error("采购单号流水已超过 999999，请调整编号规则");
  return String(nextSerial).padStart(6, "0");
}

function purchaseOrderNoExists(db, accountId, poNo) {
  const normalizedPoNo = optionalString(poNo);
  if (!normalizedPoNo) return false;
  const row = db.prepare(`
    SELECT id
    FROM erp_purchase_orders
    WHERE account_id = ? AND po_no = ?
    LIMIT 1
  `).get(accountId, normalizedPoNo);
  return Boolean(row?.id);
}

function resolvePurchaseOrderNo(db, accountId, requestedPoNo) {
  const requested = optionalString(requestedPoNo);
  if (requested && !purchaseOrderNoExists(db, accountId, requested)) return requested;
  let nextPoNo = buildPurchaseOrderNo(db);
  while (purchaseOrderNoExists(db, accountId, nextPoNo)) {
    const nextSerial = Number(nextPoNo) + 1;
    if (!Number.isFinite(nextSerial) || nextSerial > 999999) {
      throw new Error("采购单号流水已超过 999999，请调整编号规则");
    }
    nextPoNo = String(nextSerial).padStart(6, "0");
  }
  return nextPoNo;
}

function resolveExpectedDeliveryDate(candidate, payload = {}) {
  const explicit = optionalString(payload.expectedDeliveryDate);
  if (explicit) return explicit;
  const leadDays = Number(candidate.lead_days || 0);
  if (!Number.isFinite(leadDays) || leadDays <= 0) return null;
  const date = new Date();
  date.setDate(date.getDate() + leadDays);
  return date.toISOString().slice(0, 10);
}

// 线下手工单候选：带了单价/供应商时落一条 selected 状态的手工候选，
// 供应商名只能挂在候选上（PO 表不存名字），不填则退回空候选占位（保持旧行为）。
function buildOfflineCandidateForPo(db, pr, payload, actor) {
  const supplierId = optionalString(payload.supplierId);
  const supplierName = optionalString(payload.supplierName);
  const unitPrice = optionalNumber(payload.unitPrice);
  const logisticsFee = optionalNumber(payload.logisticsFee);
  const hasOfflineDetails = Boolean(supplierId || supplierName || unitPrice != null || logisticsFee != null);
  if (!hasOfflineDetails) {
    return { id: null, status: "selected", unit_price: 0, logistics_fee: 0, supplier_id: null };
  }
  const supplier = supplierId ? db.prepare("SELECT * FROM erp_suppliers WHERE id = ?").get(supplierId) : null;
  const now = nowIso();
  const row = {
    id: createId("source"),
    account_id: pr.account_id,
    pr_id: pr.id,
    purchase_source: supplierId ? "existing_supplier" : "other_manual",
    sourcing_method: "manual",
    supplier_id: supplierId || null,
    supplier_name: supplierName || supplier?.name || "线下供应商",
    product_title: optionalString(payload.productTitle) || null,
    product_url: null,
    image_url: null,
    unit_price: unitPrice ?? 0,
    moq: 1,
    lead_days: null,
    logistics_fee: logisticsFee ?? 0,
    remark: optionalString(payload.remark) || null,
    status: "selected",
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };
  if (!Number.isFinite(row.unit_price) || row.unit_price < 0) {
    throw new Error("unitPrice must be greater than or equal to 0");
  }
  db.prepare(`
    INSERT INTO erp_sourcing_candidates (
      id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
      product_title, product_url, image_url, unit_price, moq, lead_days,
      logistics_fee, remark, status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @purchase_source, @sourcing_method, @supplier_id, @supplier_name,
      @product_title, @product_url, @image_url, @unit_price, @moq, @lead_days,
      @logistics_fee, @remark, @status, @created_by, @created_at, @updated_at
    )
  `).run(row);
  return row;
}

function getDirectPurchaseSku(db, actor, skuInput) {
  const value = requireString(skuInput, "skuId");
  const companyId = normalizeCompanyId(null, actor);
  const row = db.prepare(`
    SELECT *
    FROM erp_skus
    WHERE company_id = @company_id
      AND status != 'deleted'
      AND (id = @value OR internal_sku_code = @value)
    LIMIT 1
  `).get({ company_id: companyId, value });
  if (!row) throw new Error(`未找到商品编码：${value}`);
  if (!optionalString(row.account_id)) {
    throw new Error(`商品编码 ${row.internal_sku_code || row.id} 还没有选择所属店铺`);
  }
  return row;
}

function normalizeDirectPurchaseLines(db, payload, actor) {
  const rawLines = Array.isArray(payload.lines)
    ? payload.lines
    : (Array.isArray(payload.items) ? payload.items : []);
  if (!rawLines.length) throw new Error("请至少添加一条采购明细");

  let accountId = optionalString(payload.accountId || payload.account_id);
  const lines = rawLines.map((line, index) => {
    const skuInput = line?.skuId
      || line?.sku_id
      || line?.internalSkuCode
      || line?.internal_sku_code
      || line?.skuCode
      || line?.sku_code;
    const sku = getDirectPurchaseSku(db, actor, skuInput);
    if (accountId && sku.account_id !== accountId) {
      throw new Error("同一张采购单里的商品必须属于同一个店铺");
    }
    accountId = sku.account_id;

    const qty = Number(optionalNumber(line?.qty ?? line?.quantity ?? line?.requestedQty ?? line?.requested_qty));
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`第 ${index + 1} 行采购数量必须是正整数`);
    }

    return {
      sku,
      qty,
      remark: null,
    };
  });

  return { accountId, lines };
}

function createDirectPurchaseOrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "创建采购单");
  const { accountId, lines } = normalizeDirectPurchaseLines(db, payload, actor);
  const now = nowIso();
  const po = {
    id: optionalString(payload.poId || payload.id) || createId("po"),
    account_id: accountId,
    pr_id: null,
    selected_candidate_id: null,
    supplier_id: null,
    po_no: resolvePurchaseOrderNo(db, accountId, payload.poNo || payload.po_no),
    status: "draft",
    payment_status: "unpaid",
    expected_delivery_date: null,
    actual_delivery_date: null,
    total_amount: 0,
    paid_amount: 0,
    freight_amount: 0,
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };

  const insertOrder = db.prepare(`
    INSERT INTO erp_purchase_orders (
      id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
      status, payment_status, expected_delivery_date, actual_delivery_date,
      total_amount, paid_amount, freight_amount, created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
      @status, @payment_status, @expected_delivery_date, @actual_delivery_date,
      @total_amount, @paid_amount, @freight_amount, @created_by, @created_at, @updated_at
    )
  `);
  const insertLine = db.prepare(`
    INSERT INTO erp_purchase_order_lines (
      id, account_id, po_id, sku_id, qty, unit_cost, logistics_fee,
      expected_qty, received_qty, remark
    )
    VALUES (
      @id, @account_id, @po_id, @sku_id, @qty, @unit_cost, @logistics_fee,
      @expected_qty, @received_qty, @remark
    )
  `);

  const write = db.transaction(() => {
    insertOrder.run(po);
    for (const line of lines) {
      insertLine.run({
        id: createId("po_line"),
        account_id: accountId,
        po_id: po.id,
        sku_id: line.sku.id,
        qty: line.qty,
        unit_cost: 0,
        logistics_fee: 0,
        expected_qty: line.qty,
        received_qty: 0,
        remark: line.remark,
      });
    }
    services.workflow.writeAudit({
      accountId: po.account_id,
      actor,
      action: "create_purchase_order",
      entityType: "purchase_order",
      entityId: po.id,
      before: null,
      after: getPurchaseOrder(db, po.id),
    });
  });
  write();

  return {
    purchaseOrder: toPurchaseOrderResult(db, po.id),
  };
}

function generatePurchaseOrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "生成采购单");
  const prId = requireString(payload.prId || payload.id, "prId");
  let pr = getPurchaseRequest(db, prId);
  const existingPo = findLatestPurchaseOrderByRequestId(db, prId);
  if (pr.status === "converted_to_po" && existingPo) {
    markPurchaseRequestRead(db, pr.id, actor);
    return {
      alreadyGenerated: true,
      purchaseOrder: toPurchaseOrderResult(db, existingPo),
    };
  }
  if (pr.status === "converted_to_po") {
    throw new Error("这个采购需求已标记为已生成采购单，请刷新采购中心后查看采购单列表");
  }
  // 线下采购：不绑定 1688 货源/候选。带了单价/供应商就落一条手工候选，
  // 让采购单直接有金额和供应商；什么都没填则退回空候选占位。
  const offlinePurchase = Boolean(payload.offlinePurchase);
  const candidate = offlinePurchase
    ? buildOfflineCandidateForPo(db, pr, payload, actor)
    : applySelected1688SpecToCandidate(
      getCandidateForPo(db, pr, optionalString(payload.candidateId), actor, {
        preferSku1688Source: Boolean(payload.preferSku1688Source || payload.preferSku1688Mapping || payload.useSku1688Source),
      }),
      payload,
    );

  if (candidate.status === "candidate" || candidate.status === "shortlisted") {
    services.purchase.selectCandidate(candidate.id, actor);
  } else if (candidate.status !== "selected") {
    throw new Error(`Cannot generate PO from candidate status: ${candidate.status}`);
  }

  if (pr.status === "submitted") {
    services.purchase.acceptRequest(prId, actor);
    pr = getPurchaseRequest(db, prId);
  }
  if (pr.status === "buyer_processing") {
    services.purchase.markRequestSourced(prId, actor);
    pr = getPurchaseRequest(db, prId);
  }

  const transition = services.workflow.transition({
    entityType: "purchase_request",
    id: pr.id,
    action: "generate_po",
    toStatus: "converted_to_po",
    actor,
  });

  const now = nowIso();
  const qty = Number(optionalNumber(payload.qty) ?? pr.requested_qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("qty must be a positive integer");
  const unitCost = Number(candidate.unit_price || 0);
  const logisticsFee = Number(candidate.logistics_fee || 0);
  const goodsAmount = qty * unitCost;
  const totalAmount = goodsAmount + logisticsFee;
  const po = {
    id: optionalString(payload.poId) || createId("po"),
    account_id: pr.account_id,
    pr_id: pr.id,
    selected_candidate_id: candidate.id,
    supplier_id: candidate.supplier_id || null,
    po_no: resolvePurchaseOrderNo(db, pr.account_id, payload.poNo || payload.po_no),
    status: "draft",
    payment_status: "unpaid",
    expected_delivery_date: resolveExpectedDeliveryDate(candidate, payload),
    actual_delivery_date: null,
    total_amount: goodsAmount,
    paid_amount: totalAmount,
    freight_amount: logisticsFee,
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_purchase_orders (
      id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
      status, payment_status, expected_delivery_date, actual_delivery_date,
      total_amount, paid_amount, freight_amount, created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
      @status, @payment_status, @expected_delivery_date, @actual_delivery_date,
      @total_amount, @paid_amount, @freight_amount, @created_by, @created_at, @updated_at
    )
  `).run(po);

  const line = {
    id: createId("po_line"),
    account_id: pr.account_id,
    po_id: po.id,
    sku_id: pr.sku_id,
    qty,
    unit_cost: unitCost,
    logistics_fee: logisticsFee,
    expected_qty: qty,
    received_qty: 0,
    remark: optionalString(payload.remark),
  };
  db.prepare(`
    INSERT INTO erp_purchase_order_lines (
      id, account_id, po_id, sku_id, qty, unit_cost, logistics_fee,
      expected_qty, received_qty, remark
    )
    VALUES (
      @id, @account_id, @po_id, @sku_id, @qty, @unit_cost, @logistics_fee,
      @expected_qty, @received_qty, @remark
    )
  `).run(line);

  const hasSelected1688Spec = Boolean(optionalString(candidate.external_spec_id || candidate.externalSpecId));
  const selected1688Source = hasSelected1688Spec
    ? upsertSku1688SourceFromCandidate(db, candidate, pr, actor, { isDefault: true })
    : null;
  const existing1688SourceRow = selected1688Source
    ? null
    : getActiveSku1688SourceRows(db, pr.account_id, pr.sku_id)[0];
  const sku1688Source = selected1688Source || (existing1688SourceRow ? toSku1688Source(existing1688SourceRow) : null);
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "create_purchase_order",
    entityType: "purchase_order",
    entityId: po.id,
    before: null,
    after: afterPo,
  });
  const latestPr = getPurchaseRequest(db, pr.id);
  writePurchaseRequestEvent(db, latestPr, actor, "generate_po", `采购生成采购单：${po.po_no}`);
  if (line.remark) addPurchaseRequestComment(db, latestPr, actor, line.remark);
  markPurchaseRequestRead(db, pr.id, actor);
  return {
    transition,
    sku1688Source,
    purchaseOrder: toPurchaseOrderResult(db, afterPo),
  };
}

// 编辑线下手工单：改单价/运费/数量/供应商，重算金额。仅限草稿(draft)未推单的手工单。
// 供应商名挂在候选上：有候选就更新，没有就新建一条并回填 selected_candidate_id。
function updateOfflinePurchaseOrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "编辑采购单");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrder(db, poId);
  if (po.status !== "draft") {
    throw new Error("只能编辑草稿状态的手工采购单");
  }
  if (optionalString(po.external_order_id)) {
    throw new Error("已推送 1688 的采购单不能在这里改价");
  }
  const lines = db.prepare(
    "SELECT * FROM erp_purchase_order_lines WHERE po_id = ? ORDER BY id ASC",
  ).all(poId);
  if (!lines.length) throw new Error("采购单没有明细行");
  const line = lines[0];

  const unitCost = optionalNumber(payload.unitPrice) ?? Number(line.unit_cost || 0);
  const logisticsFee = optionalNumber(payload.logisticsFee) ?? Number(line.logistics_fee || 0);
  const qty = optionalNumber(payload.qty) ?? Number(line.qty || 0);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("unitPrice must be greater than or equal to 0");
  if (!Number.isFinite(logisticsFee) || logisticsFee < 0) throw new Error("logisticsFee must be greater than or equal to 0");
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("qty must be a positive integer");

  const supplierId = optionalString(payload.supplierId);
  const supplier = supplierId ? db.prepare("SELECT * FROM erp_suppliers WHERE id = ?").get(supplierId) : null;
  const supplierName = optionalString(payload.supplierName) || supplier?.name || "线下供应商";
  const now = nowIso();
  const before = getPurchaseOrder(db, poId);

  let candidateId = optionalString(po.selected_candidate_id);
  if (candidateId) {
    db.prepare(`
      UPDATE erp_sourcing_candidates
      SET purchase_source = @purchase_source, supplier_id = @supplier_id, supplier_name = @supplier_name,
          unit_price = @unit_price, logistics_fee = @logistics_fee, updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: candidateId,
      purchase_source: supplierId ? "existing_supplier" : "other_manual",
      supplier_id: supplierId || null,
      supplier_name: supplierName,
      unit_price: unitCost,
      logistics_fee: logisticsFee,
      updated_at: now,
    });
  } else {
    candidateId = createId("source");
    db.prepare(`
      INSERT INTO erp_sourcing_candidates (
        id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
        product_title, product_url, image_url, unit_price, moq, lead_days,
        logistics_fee, remark, status, created_by, created_at, updated_at
      )
      VALUES (
        @id, @account_id, @pr_id, @purchase_source, @sourcing_method, @supplier_id, @supplier_name,
        @product_title, @product_url, @image_url, @unit_price, @moq, @lead_days,
        @logistics_fee, @remark, @status, @created_by, @created_at, @updated_at
      )
    `).run({
      id: candidateId,
      account_id: po.account_id,
      pr_id: po.pr_id,
      purchase_source: supplierId ? "existing_supplier" : "other_manual",
      sourcing_method: "manual",
      supplier_id: supplierId || null,
      supplier_name: supplierName,
      product_title: null,
      product_url: null,
      image_url: null,
      unit_price: unitCost,
      moq: 1,
      lead_days: null,
      logistics_fee: logisticsFee,
      remark: null,
      status: "selected",
      created_by: actor.id || null,
      created_at: now,
      updated_at: now,
    });
  }

  const goodsAmount = qty * unitCost;
  const totalAmount = goodsAmount + logisticsFee;
  db.prepare(`
    UPDATE erp_purchase_order_lines
    SET qty = @qty, expected_qty = @qty, unit_cost = @unit_cost, logistics_fee = @logistics_fee
    WHERE id = @id
  `).run({ id: line.id, qty, unit_cost: unitCost, logistics_fee: logisticsFee });

  db.prepare(`
    UPDATE erp_purchase_orders
    SET supplier_id = @supplier_id, selected_candidate_id = @candidate_id,
        total_amount = @total_amount,
        paid_amount = @paid_amount,
        freight_amount = @freight_amount,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: poId,
    supplier_id: supplierId || null,
    candidate_id: candidateId,
    total_amount: goodsAmount,
    paid_amount: totalAmount,
    freight_amount: logisticsFee,
    updated_at: now,
  });

  const afterPo = getPurchaseOrder(db, poId);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "update_offline_po",
    entityType: "purchase_order",
    entityId: poId,
    before,
    after: afterPo,
  });
  writePurchaseOrderFlowEvent(db, afterPo, actor, "update_offline_po", `线下采购单已更新：${afterPo.po_no || afterPo.id}`);
  return { purchaseOrder: toPurchaseOrderResult(db, afterPo) };
}

function getPurchaseOrderWithCandidate(db, poId) {
  const row = db.prepare(`
    SELECT
      po.*,
      candidate.external_offer_id,
      candidate.external_sku_id,
      candidate.external_spec_id,
      candidate.product_title AS candidate_product_title,
      candidate.product_url AS candidate_product_url,
      candidate.supplier_name AS candidate_supplier_name
    FROM erp_purchase_orders po
    LEFT JOIN erp_sourcing_candidates candidate ON candidate.id = po.selected_candidate_id
    WHERE po.id = ?
  `).get(poId);
  if (!row) throw new Error(`Purchase order not found: ${poId}`);
  return row;
}

function getPurchaseOrderLines(db, poId) {
  const rows = db.prepare(`
    SELECT
      line.*,
      sku.internal_sku_code,
      sku.product_name,
      sku_source.external_offer_id AS sku_1688_offer_id,
      sku_source.external_sku_id AS sku_1688_sku_id,
      sku_source.external_spec_id AS sku_1688_spec_id,
      sku_source.supplier_name AS sku_1688_supplier_name
    FROM erp_purchase_order_lines line
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    LEFT JOIN erp_sku_1688_sources sku_source ON sku_source.id = (
      SELECT source.id
      FROM erp_sku_1688_sources source
      WHERE source.account_id = line.account_id
        AND source.sku_id = line.sku_id
        AND source.status = 'active'
      ORDER BY source.is_default DESC, source.updated_at DESC, source.created_at DESC
      LIMIT 1
    )
    WHERE line.po_id = ?
    ORDER BY line.id ASC
  `).all(poId);
  return rows.map((line) => ({
    ...line,
    source_mappings: getActiveSku1688SourceRows(db, line.account_id, line.sku_id),
  }));
}

function build1688OrderCargoParamList(po, lines, payload = {}) {
  if (Array.isArray(payload.cargoParamList) && payload.cargoParamList.length) {
    return payload.cargoParamList.map((item, index) => ({
      ...item,
      offerId: requireString(item.offerId || item.offer_id, `cargoParamList[${index}].offerId`),
      specId: require1688SpecId(item.specId || item.spec_id || item.cargoSkuId || item.cargo_sku_id, `cargoParamList[${index}]`),
      quantity: optionalPositiveInteger(item.quantity, 1),
    }));
  }
  return lines.flatMap((line) => {
    const mappings = Array.isArray(line.source_mappings) && line.source_mappings.length
      ? line.source_mappings
      : [{
        external_offer_id: po.external_offer_id || line.sku_1688_offer_id,
        external_sku_id: po.external_sku_id || line.sku_1688_sku_id,
        external_spec_id: po.external_spec_id || line.sku_1688_spec_id,
        our_qty: 1,
        platform_qty: 1,
      }];
    return mappings.map((mapping) => {
      const offerId = optionalString(mapping.external_offer_id);
      if (!offerId) {
        throw new Error(`商品编码 ${line.internal_sku_code || line.sku_id} 还没有绑定供应商管理记录`);
      }
      const specId = require1688SpecId(
        mapping.external_spec_id,
        `商品编码 ${line.internal_sku_code || line.sku_id}`,
      );
      // 护栏：specId 与 skuId 同值通常意味着上游（遨虾等第三方接口）没返回真正的 cargoSkuId，
      // 1688 下单接口会拒绝。在请求送出之前就拦下，并给出明确的修复指引。
      const externalSkuId = optionalString(mapping.external_sku_id);
      if (externalSkuId && externalSkuId === specId) {
        throw new Error(
          `商品编码 ${line.internal_sku_code || line.sku_id} 的 1688 specId 与 skuId 同值（${specId}），可能不是真实 cargoSkuId；请到「供应商管理」重新「解析规格」、申请 1688 官方商品详情接口权限，或先手工到 1688 下单`,
        );
      }
      const ourQty = optionalPositiveInteger(mapping.our_qty, 1);
      const platformQty = optionalPositiveInteger(mapping.platform_qty, 1);
      return {
        offerId,
        specId,
        quantity: Math.max(1, Math.ceil(Number(line.qty || 0) * platformQty / ourQty)),
      };
    });
  });
}

function isLikely1688NumericSkuId(value) {
  const text = optionalString(value);
  return Boolean(text && /^\d{6,}$/.test(text));
}

function parse1688WebSkuOptions(html = "") {
  const options = [];
  const seen = new Set();
  const addOption = (option = {}) => {
    const specId = optionalString(option.specId);
    const skuId = optionalString(option.skuId);
    if (!specId || !skuId) return;
    const next = {
      specId,
      specAttrs: optionalString(option.specAttrs) || "",
      skuId,
    };
    const key = `${next.skuId}:${next.specId}`;
    if (!seen.has(key)) {
      seen.add(key);
      options.push(next);
    }
  };
  const text = String(html || "").replace(/\\"/g, "\"");
  const pattern = /"specId"\s*:\s*"?([^",}]+)"?[^{}]*?"specAttrs"\s*:\s*"([^"]*)"[^{}]*?"skuId"\s*:\s*"?(\d+)"?/g;
  for (const match of text.matchAll(pattern)) {
    addOption({
      specId: match[1],
      specAttrs: match[2],
      skuId: match[3],
    });
  }
  const looseObjectPattern = /\{[^{}]*(?:"specId"\s*:\s*"?([^",}]+)"?[^{}]*"skuId"\s*:\s*"?(\d+)"?|"skuId"\s*:\s*"?(\d+)"?[^{}]*"specId"\s*:\s*"?([^",}]+)"?)[^{}]*\}/g;
  for (const match of text.matchAll(looseObjectPattern)) {
    const objectText = match[0] || "";
    const attrsMatch = objectText.match(/"specAttrs"\s*:\s*"([^"]*)"/);
    addOption({
      specId: match[1] || match[4],
      skuId: match[2] || match[3],
      specAttrs: attrsMatch?.[1] || "",
    });
  }
  return options;
}

function normalize1688SkuMatchOption(option = {}) {
  if (!option || typeof option !== "object") return null;
  const skuId = optionalString(
    option.skuId
      || option.skuID
      || option.sku_id
      || option.externalSkuId
      || option.external_sku_id,
  );
  const specId = optionalString(
    option.specId
      || option.specID
      || option.spec_id
      || option.cargoSkuId
      || option.cargoSkuID
      || option.cargo_sku_id
      || option.externalSpecId
      || option.external_spec_id,
  ) || skuId;
  if (!skuId && !specId) return null;
  return {
    skuId: skuId || specId,
    specId,
    specAttrs: optionalString(
      option.specAttrs
        || option.spec_attrs
        || option.specText
        || option.spec_text
        || option.platformSkuName
        || option.platform_sku_name,
    ),
  };
}

function add1688SkuMatchOption(options, seen, option = {}, source = "cached_product_detail") {
  const normalized = normalize1688SkuMatchOption(option);
  if (!normalized?.specId) return;
  const key = `${normalized.skuId || ""}:${normalized.specId || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  options.push({ ...normalized, source });
}

function collect1688SkuMatchOptions(value, options = [], seen = new Set(), depth = 0) {
  if (!value || depth > 5) return options;
  if (Array.isArray(value)) {
    for (const item of value) {
      add1688SkuMatchOption(options, seen, item, "cached_sku_options");
      collect1688SkuMatchOptions(item, options, seen, depth + 1);
    }
    return options;
  }
  if (typeof value !== "object") return options;

  add1688SkuMatchOption(options, seen, value, "cached_sku_option");
  try {
    const detail = normalize1688ProductDetailResponse(value);
    for (const sku of detail.skuOptions || []) {
      add1688SkuMatchOption(options, seen, sku, "cached_product_detail");
    }
  } catch {}

  for (const key of ["skuOptions", "sku_infos", "skuInfos", "skuInfo", "skuList", "skus"]) {
    collect1688SkuMatchOptions(value[key], options, seen, depth + 1);
  }
  for (const key of [
    "detail",
    "productDetail",
    "productDetailForMix",
    "purchasedProductSimple",
    "rawAlphaShopResponse",
    "result",
    "data",
    "productInfo",
  ]) {
    collect1688SkuMatchOptions(value[key], options, seen, depth + 1);
  }
  return options;
}

function findCached1688SkuMatch(mapping = {}, skuId, specId) {
  const sourcePayload = parseJsonObject(mapping.source_payload_json || mapping.sourcePayload);
  const options = collect1688SkuMatchOptions(sourcePayload);
  const resolved = sourcePayload.resolved1688Sku;
  if (resolved && typeof resolved === "object") {
    add1688SkuMatchOption(options, new Set(options.map((item) => `${item.skuId || ""}:${item.specId || ""}`)), resolved, "resolved_1688_sku");
  }
  return find1688WebSkuMatch(options, skuId, specId);
}

function updateResolved1688SkuMapping(db, mapping = {}, resolved = {}) {
  const now = nowIso();
  const sourcePayload = parseJsonObject(mapping.source_payload_json);
  sourcePayload.resolved1688Sku = {
    offerId: optionalString(resolved.offerId),
    skuId: optionalString(resolved.skuId),
    specId: optionalString(resolved.specId),
    specAttrs: optionalString(resolved.specAttrs),
    resolvedAt: now,
    source: optionalString(resolved.source) || "1688_web_detail",
    webMatch: resolved.webMatch !== false,
  };
  if (mapping.id) {
    db.prepare(`
      UPDATE erp_sku_1688_sources
      SET external_sku_id = COALESCE(@external_sku_id, external_sku_id),
          external_spec_id = COALESCE(@external_spec_id, external_spec_id),
          platform_sku_name = COALESCE(@platform_sku_name, platform_sku_name),
          source_payload_json = @source_payload_json,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: mapping.id,
      external_sku_id: optionalString(resolved.skuId),
      external_spec_id: optionalString(resolved.specId),
      platform_sku_name: optionalString(resolved.specAttrs || resolved.specId),
      source_payload_json: trimJsonForStorage(sourcePayload),
      updated_at: now,
    });
  }
  mapping.external_sku_id = optionalString(resolved.skuId) || mapping.external_sku_id;
  mapping.external_spec_id = optionalString(resolved.specId) || mapping.external_spec_id;
  mapping.platform_sku_name = optionalString(resolved.specAttrs) || mapping.platform_sku_name;
  mapping.source_payload_json = trimJsonForStorage(sourcePayload);
}

function find1688WebSkuMatch(options = [], skuId, specId) {
  const normalizedSkuId = optionalString(skuId);
  const normalizedSpecId = optionalString(specId);
  return options.find((option) => normalizedSpecId && String(option.specId) === normalizedSpecId)
    || options.find((option) => normalizedSkuId && String(option.skuId) === normalizedSkuId)
    || null;
}

function preserveSelected1688Spec(db, mapping = {}, offerId, reason = "web_detail_not_matched") {
  const specId = optionalString(mapping.external_spec_id || mapping.externalSpecId);
  if (!specId) return null;
  updateResolved1688SkuMapping(db, mapping, {
    offerId,
    skuId: optionalString(mapping.external_sku_id || mapping.externalSkuId),
    specId,
    specAttrs: optionalString(mapping.platform_sku_name || mapping.platformSkuName) || specId,
    source: reason,
    webMatch: false,
  });
  return { specId };
}

function fallback1688SkuIdAsSpecId(db, mapping = {}, offerId, skuId, reason = "selected_sku_id_as_spec_id") {
  const normalizedSkuId = optionalString(skuId);
  if (!normalizedSkuId) return null;
  const specAttrs = optionalString(mapping.platform_sku_name || mapping.platformSkuName) || normalizedSkuId;
  updateResolved1688SkuMapping(db, mapping, {
    offerId,
    skuId: normalizedSkuId,
    specId: normalizedSkuId,
    specAttrs,
    source: reason,
    webMatch: false,
  });
  return {
    skuId: normalizedSkuId,
    specId: normalizedSkuId,
    specAttrs,
    source: reason,
  };
}

async function fetch1688WebSkuOptions(offerId) {
  const id = requireString(offerId, "offerId");
  if (typeof fetch !== "function") return [];
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  try {
    const response = await fetch(`https://detail.1688.com/offer/${encodeURIComponent(id)}.html`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: controller?.signal,
    });
    const html = await response.text();
    return parse1688WebSkuOptions(html);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolve1688NumericSkuMapping(db, mapping = {}) {
  const offerId = optionalString(mapping.external_offer_id || mapping.externalOfferId);
  const skuId = optionalString(mapping.external_sku_id || mapping.externalSkuId);
  const specId = optionalString(mapping.external_spec_id || mapping.externalSpecId);
  const specLooksLikeSkuId = isLikely1688NumericSkuId(specId) ? specId : null;
  const lookupSkuId = isLikely1688NumericSkuId(skuId) ? skuId : specLooksLikeSkuId;
  if (!offerId || (!lookupSkuId && !specId)) return null;
  if (specId && !specLooksLikeSkuId && (!skuId || skuId !== specId)) {
    return {
      skuId: skuId || null,
      specId,
      specAttrs: specId,
      source: "selected_spec",
    };
  }
  const cachedMatch = findCached1688SkuMatch(mapping, lookupSkuId, specId);
  if (cachedMatch?.specId) {
    updateResolved1688SkuMapping(db, mapping, {
      offerId,
      skuId: cachedMatch.skuId || lookupSkuId || skuId,
      specId: cachedMatch.specId,
      specAttrs: cachedMatch.specAttrs || specId || cachedMatch.specId,
      source: cachedMatch.source || "cached_product_detail",
      webMatch: false,
    });
    return cachedMatch;
  }
  let skuOptions = [];
  try {
    skuOptions = await fetch1688WebSkuOptions(offerId);
  } catch (error) {
    return preserveSelected1688Spec(db, mapping, offerId, "selected_spec_web_lookup_failed")
      || fallback1688SkuIdAsSpecId(db, mapping, offerId, lookupSkuId, "selected_sku_web_lookup_failed");
  }
  const matched = find1688WebSkuMatch(skuOptions, lookupSkuId, specId);
  if (!matched?.specId) {
    const preserved = preserveSelected1688Spec(db, mapping, offerId, "selected_spec_not_in_web_detail");
    if (preserved) return preserved;
    const fallback = fallback1688SkuIdAsSpecId(db, mapping, offerId, lookupSkuId, "selected_sku_not_in_web_detail");
    if (fallback) return fallback;
    throw new Error(`1688 商品 ${offerId} 的规格 ${lookupSkuId || specId} 未匹配到可下单 specId，请重新选择规格`);
  }
  updateResolved1688SkuMapping(db, mapping, {
    offerId,
    skuId: matched.skuId || lookupSkuId || skuId,
    specId: matched.specId,
    specAttrs: matched.specAttrs || specId,
    source: "1688_web_detail",
    webMatch: true,
  });
  return matched;
}

async function resolve1688OrderLineMappings(db, lines = []) {
  for (const line of lines) {
    const mappings = Array.isArray(line.source_mappings) ? line.source_mappings : [];
    for (const mapping of mappings) {
      await resolve1688NumericSkuMapping(db, mapping);
    }
  }
  return lines;
}

function resolve1688AddressParam(db, payload = {}, actor = {}, po = {}) {
  if (payload.addressParam && typeof payload.addressParam === "object") return payload.addressParam;
  const addressId = optionalString(payload.deliveryAddressId || payload.erpAddressId || payload.addressId);
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const accountId = optionalString(payload.accountId || payload.account_id || po.account_id || po.accountId);
  // [OAuth 维度 2026-05-21] 传 OAuth 给 get1688DeliveryAddress，让默认地址查询优先按 OAuth 走。
  let purchase1688AccountId = optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id || po.purchase_1688_account_id);
  if (!purchase1688AccountId && accountId) {
    const acct = db.prepare("SELECT default_1688_purchase_account_id FROM erp_accounts WHERE id = ?").get(accountId);
    purchase1688AccountId = optionalString(acct?.default_1688_purchase_account_id);
  }
  try {
    const row = get1688DeliveryAddress(db, addressId, companyId, accountId, purchase1688AccountId);
    // 推单前预校验：先在本地拦掉肯定不能成功的请求，错误码与 ALIBABA_1688_BUSINESS_ERROR_HINTS 对齐。
    const status = optionalString(row.status) || "active";
    if (status !== "active") {
      const error = new Error(
        "errorCode:ADDRESS_INACTIVE 该 1688 收货地址已失效（远端可能已被删除），请到「询盘设置」点「同步 1688 地址」后重新选择再推单。",
      );
      error.code = "ADDRESS_INACTIVE";
      throw error;
    }
    if (!optionalString(row.address_id)) {
      const error = new Error(
        "errorCode:ADDRESS_REMOTE_ID_MISSING 该收货地址还没有 1688 远端 ID，请到「询盘设置」点「同步 1688 地址」拉一份完整数据后重新选择再推单。",
      );
      error.code = "ADDRESS_REMOTE_ID_MISSING";
      throw error;
    }
    // [Cross-OAuth fallback 2026-05-21] 选的地址绑在别的 OAuth 上时，自动 fallback 到
    // 当前 OAuth 下的有效地址（同公司、active、有远端 ID，优先 isDefault 再按 updated_at）。
    const rowOauth = optionalString(row.purchase_1688_account_id);
    if (purchase1688AccountId && rowOauth && rowOauth !== purchase1688AccountId) {
      const fb = db.prepare(`
        SELECT *
        FROM erp_1688_delivery_addresses
        WHERE company_id = @company_id
          AND purchase_1688_account_id = @oauth_id
          AND status = 'active'
          AND address_id IS NOT NULL AND address_id != ''
        ORDER BY is_default DESC, updated_at DESC
        LIMIT 1
      `).get({ company_id: companyId, oauth_id: purchase1688AccountId });
      if (fb) {
        console.log(`[1688-push] cross-OAuth fallback: ${row.id} (oauth=${rowOauth}) -> ${fb.id} (oauth=${purchase1688AccountId})`);
        return build1688AddressParamFromRow(fb);
      }
      const crossErr = new Error("errorCode:ADDRESS_INACTIVE 当前 1688 采购账号下没有可用的收货地址（之前选的地址绑定在别的 OAuth 上），请到「询盘设置」点「同步 1688 地址」后重新选择。");
      crossErr.code = "ADDRESS_INACTIVE";
      throw crossErr;
    }
    return build1688AddressParamFromRow(row);
  } catch (error) {
    if (payload.mockResponse || payload.mockPreviewResponse) return null;
    throw error;
  }
}

function build1688FastCreateOrderParams(po, lines, payload = {}) {
  const cargoParamList = build1688OrderCargoParamList(po, lines, payload);
  const addressParam = payload.addressParam || null;
  if (!addressParam && !payload.dryRun && !payload.mockResponse && !payload.mockPreviewResponse) {
    throw new Error("addressParam is required before pushing a 1688 order");
  }
  const params = {
    flow: optionalString(payload.flow) || "general",
    message: optionalString(payload.message || payload.remark),
    addressParam,
    cargoParamList,
    outOrderId: optionalString(payload.outOrderId) || po.po_no,
    isvBizTypeErp: true,
    useOfficialSolution: optionalBoolean(payload.useOfficialSolution ?? payload.use_official_solution) ?? false,
  };
  if (Array.isArray(payload.useOfficialSolutionModelList) || Array.isArray(payload.use_official_solution_model_list)) {
    params.useOfficialSolutionModelList = payload.useOfficialSolutionModelList || payload.use_official_solution_model_list;
  }
  for (const key of ["tradeType", "fenxiaoChannel", "preSelectPayChannel", "instanceId"]) {
    const value = optionalString(payload[key]);
    if (value) params[key] = value;
  }
  return params;
}

function pick1688PreviewMoney(nested = {}, keys = []) {
  for (const key of keys) {
    const rawValue = nested[key];
    const number = optionalNumber(rawValue);
    if (number === null) continue;
    return /cent|fen/i.test(key) ? number / 100 : number;
  }
  return null;
}

function normalize1688OrderPreviewResponse(rawResponse = {}) {
  const result = rawResponse.result && typeof rawResponse.result === "object" ? rawResponse.result : rawResponse;
  const previewRow = Array.isArray(result.orderPreviewResuslt) ? result.orderPreviewResuslt[0] : null;
  const nested = previewRow || result.toReturn || result.data || result.preview || result;
  const amount = pick1688PreviewMoney(nested, [
    "totalAmount",
    "totalPrice",
    "sumPayment",
    "orderAmount",
    "actualPayFee",
    "totalAmountCent",
    "totalPriceCent",
    "sumPaymentCent",
    "orderAmountCent",
    "actualPayFeeCent",
    "totalAmountFen",
  ]);
  const freight = pick1688PreviewMoney(nested, [
    "freight",
    "shippingFee",
    "postFee",
    "sumCarriage",
    "carriage",
    "freightCent",
    "shippingFeeCent",
    "postFeeCent",
    "sumCarriageCent",
    "carriageCent",
    "freightFen",
  ]);
  return {
    totalAmount: amount,
    freight,
    raw: rawResponse,
  };
}

function findExternalOrderId(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findExternalOrderId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of ["orderId", "order_id", "tradeId", "trade_id", "orderid"]) {
    const candidate = value[key];
    if (candidate !== null && candidate !== undefined && candidate !== "") return String(candidate);
  }
  for (const item of Object.values(value)) {
    const found = findExternalOrderId(item, depth + 1);
    if (found) return found;
  }
  return null;
}

async function validate1688OrderPushAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 order push validation");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrderWithCandidate(db, poId);
  if (optionalString(po.external_order_id)) {
    return {
      ready: false,
      reason: "already_bound",
      message: `采购单 ${po.po_no || po.id} 已绑定 1688 订单`,
      externalOrderId: po.external_order_id,
    };
  }
  const lines = getPurchaseOrderLines(db, poId);
  if (!lines.length) throw new Error(`Purchase order has no lines: ${poId}`);
  await resolve1688OrderLineMappings(db, lines);
  const addressParam = resolve1688AddressParam(db, payload, actor, po);
  const cargoParamList = build1688OrderCargoParamList(po, lines, payload);
  if (!cargoParamList.length) {
    throw new Error("没有可推送到 1688 的商品明细，请先维护供应商管理映射");
  }
  const apiParams = build1688FastCreateOrderParams(po, lines, {
    ...payload,
    addressParam,
    cargoParamList,
  });
  return {
    ready: true,
    apiKey: PROCUREMENT_APIS.FAST_CREATE_ORDER.key,
    poId: po.id,
    poNo: po.po_no,
    cargoCount: cargoParamList.length,
    hasAddress: Boolean(addressParam),
    params: apiParams,
  };
}

async function push1688OrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 order push");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrderWithCandidate(db, poId);
  const lines = getPurchaseOrderLines(db, poId);
  if (!lines.length) throw new Error(`Purchase order has no lines: ${poId}`);
  await resolve1688OrderLineMappings(db, lines);

  const apiParams = build1688FastCreateOrderParams(po, lines, {
    ...payload,
    addressParam: resolve1688AddressParam(db, payload, actor, po),
  });
  if (payload.dryRun) {
    return {
      dryRun: true,
      apiKey: PROCUREMENT_APIS.FAST_CREATE_ORDER.key,
      params: apiParams,
    };
  }

  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "push_1688_order",
    api: PROCUREMENT_APIS.FAST_CREATE_ORDER,
    params: apiParams,
    purchase1688AccountId: optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id),
  });
  const externalOrderId = findExternalOrderId(rawResponse);
  const now = nowIso();
  let transition = null;
  if (po.status === "draft") {
    transition = services.workflow.transition({
      entityType: "purchase_order",
      id: po.id,
      action: "push_1688_order",
      toStatus: "pushed_pending_price",
      actor,
    });
  }
  db.prepare(`
    UPDATE erp_purchase_orders
    SET external_order_id = COALESCE(@external_order_id, external_order_id),
        external_order_status = @external_order_status,
        external_order_payload_json = @external_order_payload_json,
        external_order_synced_at = @external_order_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: po.id,
    external_order_id: externalOrderId,
    external_order_status: externalOrderId ? "created" : "submitted",
    external_order_payload_json: trimJsonForStorage(rawResponse),
    external_order_synced_at: now,
    updated_at: now,
  });
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "push_1688_order",
    entityType: "purchase_order",
    entityId: po.id,
    before: po,
    after: afterPo,
  });
  if (po.pr_id) {
    const pr = getPurchaseRequest(db, po.pr_id);
    writePurchaseRequestEvent(
      db,
      pr,
      actor,
      "push_1688_order",
      `1688 official order pushed: ${externalOrderId || po.po_no}`,
    );
    markPurchaseRequestRead(db, pr.id, actor);
  }
  return {
    apiKey: PROCUREMENT_APIS.FAST_CREATE_ORDER.key,
    externalOrderId,
    transition,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
  };
}

async function preview1688OrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 order preview");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrderWithCandidate(db, poId);
  const lines = getPurchaseOrderLines(db, poId);
  if (!lines.length) throw new Error(`Purchase order has no lines: ${poId}`);
  await resolve1688OrderLineMappings(db, lines);

  const apiParams = build1688FastCreateOrderParams(po, lines, {
    ...payload,
    addressParam: resolve1688AddressParam(db, payload, actor, po),
  });
  if (payload.dryRun) {
    return {
      dryRun: true,
      apiKey: PROCUREMENT_APIS.ORDER_PREVIEW.key,
      params: apiParams,
    };
  }

  const rawResponse = payload.mockPreviewResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "preview_1688_order",
    api: PROCUREMENT_APIS.ORDER_PREVIEW,
    params: apiParams,
    purchase1688AccountId: optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id),
  });
  const preview = normalize1688OrderPreviewResponse(rawResponse);
  const now = nowIso();
  db.prepare(`
    UPDATE erp_purchase_orders
    SET external_order_status = @external_order_status,
        external_order_preview_json = @external_order_preview_json,
        external_order_previewed_at = @external_order_previewed_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: po.id,
    external_order_status: "previewed",
    external_order_preview_json: trimJsonForStorage(rawResponse),
    external_order_previewed_at: now,
    updated_at: now,
  });
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "preview_1688_order",
    entityType: "purchase_order",
    entityId: po.id,
    before: po,
    after: afterPo,
  });
  if (po.pr_id) {
    const pr = getPurchaseRequest(db, po.pr_id);
    writePurchaseRequestEvent(db, pr, actor, "preview_1688_order", `1688 order preview: ${po.po_no}`);
    markPurchaseRequestRead(db, pr.id, actor);
  }
  return {
    apiKey: PROCUREMENT_APIS.ORDER_PREVIEW.key,
    preview,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
  };
}

function request1688PriceChangeAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 改价留言");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrder(db, poId);
  const now = nowIso();
  const remark = optionalString(payload.remark || payload.message) || "已发起 1688 改价沟通";
  db.prepare(`
    UPDATE erp_purchase_orders
    SET external_order_status = @external_order_status,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: po.id,
    external_order_status: "price_change_requested",
    updated_at: now,
  });
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "request_1688_price_change",
    entityType: "purchase_order",
    entityId: po.id,
    before: po,
    after: afterPo,
  });
  if (po.pr_id) {
    const pr = getPurchaseRequest(db, po.pr_id);
    writePurchaseRequestEvent(db, pr, actor, "request_1688_price_change", remark);
    markPurchaseRequestRead(db, pr.id, actor);
  }
  return {
    purchaseOrder: toCamelRow(afterPo),
  };
}

async function sync1688OrderPriceAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 订单价格同步");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrder(db, poId);
  const amount = optionalNumber(payload.amount ?? payload.totalAmount);
  if (amount === null) {
    const detailResult = await fetch1688OrderDetailForPo({
      db,
      services,
      po,
      payload,
      actor,
      action: "sync_1688_order_price",
    });
    const syncedAmount = optionalNumber(detailResult?.detail?.totalAmount);
    if (syncedAmount === null || syncedAmount < 0) {
      throw new Error("1688 订单详情没有返回可同步金额，请手动输入订单金额");
    }
    return {
      ...detailResult,
      syncedAmount,
      manual: false,
    };
  }
  if (amount < 0) throw new Error("请填写正确的 1688 订单金额");
  const now = nowIso();
  const manualFreight = optionalNumber(payload.freight ?? payload.freightAmount);
  const money = splitOrderMoney(amount, manualFreight ?? optionalNumber(po.freight_amount), amount);
  let transition = null;
  if (po.status === "pushed_pending_price") {
    transition = services.workflow.transition({
      entityType: "purchase_order",
      id: po.id,
      action: "sync_1688_order_price",
      toStatus: "pushed_pending_price",
      actor,
    });
  }
  db.prepare(`
    UPDATE erp_purchase_orders
    SET total_amount = @total_amount,
        paid_amount = @paid_amount,
        freight_amount = COALESCE(@freight_amount, freight_amount),
        external_order_status = @external_order_status,
        external_order_synced_at = @external_order_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: po.id,
    total_amount: money.goodsAmount ?? amount,
    paid_amount: money.paidAmount ?? amount,
    freight_amount: manualFreight,
    external_order_status: optionalString(payload.externalOrderStatus) || "price_synced",
    external_order_synced_at: now,
    updated_at: now,
  });
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action: "sync_1688_order_price",
    entityType: "purchase_order",
    entityId: po.id,
    before: po,
    after: afterPo,
  });
  if (po.pr_id) {
    const pr = getPurchaseRequest(db, po.pr_id);
    writePurchaseRequestEvent(db, pr, actor, "sync_1688_order_price", `1688 订单金额已同步为 ￥${amount.toFixed(2)}`);
    markPurchaseRequestRead(db, pr.id, actor);
  }
  return {
    transition,
    purchaseOrder: toCamelRow(afterPo),
    syncedAmount: amount,
    manual: true,
  };
}

function to1688DateParam(value) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value.time || value.timestamp || value.value
    : value;
  const date = input ? new Date(input) : new Date();
  const time = date.getTime();
  return Number.isFinite(time) ? { time } : null;
}

function build1688OrderListParams(payload = {}, po = {}) {
  const page = Math.max(1, Math.floor(Number(optionalNumber(payload.page) ?? 1)));
  const pageSize = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.pageSize) ?? 50)), 100));
  const createdAt = Date.parse(po.created_at || po.createdAt || "");
  const fallbackStart = Number.isFinite(createdAt) ? createdAt - 3 * 24 * 60 * 60 * 1000 : Date.now() - 3 * 24 * 60 * 60 * 1000;
  const start = to1688DateParam(payload.createStartTime || payload.startTime || fallbackStart);
  const end = to1688DateParam(payload.createEndTime || payload.endTime || Date.now() + 10 * 60 * 1000);
  const params = {
    page,
    pageSize,
    createStartTime: start,
    createEndTime: end,
  };
  for (const key of ["orderStatus", "tradeStatus", "sellerMemberId", "sellerLoginId"]) {
    const value = optionalString(payload[key]);
    if (value) params[key] = value;
  }
  return params;
}

function normalizeLooseText(value) {
  return String(value || "").trim().toLowerCase();
}

function almostEqualMoney(left, right, tolerance = 0.05) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function score1688OrderForPo(order = {}, po = {}, lines = []) {
  let score = 0;
  const reasons = [];
  const offerId = optionalString(po.external_offer_id);
  const skuId = optionalString(po.external_sku_id);
  const specId = optionalString(po.external_spec_id);
  const supplierName = normalizeLooseText(po.candidate_supplier_name || po.supplier_name);

  if (offerId && (order.productIds || []).map(String).includes(offerId)) {
    score += 50;
    reasons.push("offer_id");
  }
  if (skuId && (order.skuIds || []).map(String).includes(skuId)) {
    score += 20;
    reasons.push("sku_id");
  }
  if (specId && (order.specIds || []).map(String).includes(specId)) {
    score += 20;
    reasons.push("spec_id");
  }
  const totalQty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const orderQty = (order.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  if (totalQty > 0 && orderQty > 0 && totalQty === orderQty) {
    score += 10;
    reasons.push("qty");
  }
  if (almostEqualMoney(order.totalAmount, po.total_amount)) {
    score += 20;
    reasons.push("amount");
  }
  const orderSupplier = normalizeLooseText(order.supplierName);
  if (supplierName && orderSupplier && (supplierName.includes(orderSupplier) || orderSupplier.includes(supplierName))) {
    score += 10;
    reasons.push("supplier");
  }
  return {
    ...order,
    matchScore: score,
    matchReasons: reasons,
  };
}

function bind1688OrderToPurchaseOrder({ db, services, po, order, actor, action = "sync_1688_orders" }) {
  const now = nowIso();
  db.prepare(`
    UPDATE erp_purchase_orders
    SET external_order_id = @external_order_id,
        external_order_status = @external_order_status,
        external_order_payload_json = @external_order_payload_json,
        external_order_synced_at = @external_order_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: po.id,
    external_order_id: order.externalOrderId,
    external_order_status: optionalString(order.status) || "bound",
    external_order_payload_json: trimJsonForStorage(order.raw || order),
    external_order_synced_at: now,
    updated_at: now,
  });
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: po.account_id,
    actor,
    action,
    entityType: "purchase_order",
    entityId: po.id,
    before: po,
    after: afterPo,
  });
  if (po.pr_id) {
    const pr = getPurchaseRequest(db, po.pr_id);
    writePurchaseRequestEvent(
      db,
      pr,
      actor,
      action,
      `1688 order bound: ${order.externalOrderId}`,
    );
    markPurchaseRequestRead(db, pr.id, actor);
  }
  return afterPo;
}

async function sync1688OrdersAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin", "system"], "1688 order sync");
  const poId = requireString(payload.poId || payload.id, "poId");
  const po = getPurchaseOrderWithCandidate(db, poId);
  const lines = getPurchaseOrderLines(db, poId);
  if (!lines.length) throw new Error(`Purchase order has no lines: ${poId}`);

  const apiParams = build1688OrderListParams(payload, po);
  const rawResponse = payload.mockOrderListResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "sync_1688_orders",
    api: PROCUREMENT_APIS.ORDER_LIST,
    params: apiParams,
  });
  const orders = normalize1688BuyerOrderListResponse(rawResponse);
  const explicitOrderId = optionalString(payload.externalOrderId || payload.orderId || payload.tradeId);
  const scored = orders
    .map((order) => {
      const scoredOrder = score1688OrderForPo(order, po, lines);
      if (explicitOrderId && scoredOrder.externalOrderId === explicitOrderId) {
        return {
          ...scoredOrder,
          matchScore: scoredOrder.matchScore + 100,
          matchReasons: [...scoredOrder.matchReasons, "explicit_order_id"],
        };
      }
      return scoredOrder;
    })
    .sort((left, right) => right.matchScore - left.matchScore);

  const minScore = Math.max(1, Math.floor(Number(optionalNumber(payload.minMatchScore) ?? 50)));
  const matches = scored.filter((order) => (
    explicitOrderId ? order.externalOrderId === explicitOrderId : order.matchScore >= minScore
  ));

  let boundOrder = null;
  let afterPo = getPurchaseOrder(db, po.id);
  if (matches.length === 1) {
    boundOrder = matches[0];
    afterPo = bind1688OrderToPurchaseOrder({ db, services, po, order: boundOrder, actor });
  }

  return {
    apiKey: PROCUREMENT_APIS.ORDER_LIST.key,
    query: apiParams,
    matchStatus: boundOrder ? "bound" : (matches.length > 1 ? "needs_confirmation" : "not_found"),
    externalOrderId: boundOrder?.externalOrderId || null,
    matchedCount: matches.length,
    totalFound: orders.length,
    matches: matches.slice(0, 10).map((order) => ({
      externalOrderId: order.externalOrderId,
      status: order.status,
      supplierName: order.supplierName,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      matchScore: order.matchScore,
      matchReasons: order.matchReasons,
    })),
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
  };
}

// 自动同步 1688 订单：定时扫描已推单但未绑定外部订单号的 PO，调用 sync 进行匹配回填。
// 用 in-memory 退避避免对失败 PO 反复请求；同账号内出现授权类错误时跳过该账号余下 PO。
const ORDER_SYNC_BACKOFF_MINUTES = [0, 5, 15, 30, 60];
const orderSyncAttemptState = new Map();

function getOrderSyncBackoffMs(attempts) {
  const idx = Math.min(Math.max(attempts, 0), ORDER_SYNC_BACKOFF_MINUTES.length - 1);
  return ORDER_SYNC_BACKOFF_MINUTES[idx] * 60 * 1000;
}

function selectPoIdsForScheduledSync(db, { maxAgeHours, limit }) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  return db.prepare(`
    SELECT id, account_id, external_order_synced_at
    FROM erp_purchase_orders
    WHERE status = 'pushed_pending_price'
      AND (external_order_id IS NULL OR external_order_id = '')
      AND created_at >= @cutoff
    ORDER BY (external_order_synced_at IS NULL) DESC, external_order_synced_at ASC
    LIMIT @limit
  `).all({ cutoff, limit });
}

// 第二阶段候选：已绑定 1688 订单号、但工作流尚未走到 paid 的单。
// 为什么需要它：selectPoIdsForScheduledSync 只负责"未绑定"单的首次绑定，
// 一旦 PO 绑定了 external_order_id（或离开 pushed_pending_price），它就不再被定时任务触碰。
// 而用户的 1688 线上支付通常发生在订单已绑定之后，没有任何机制再去拉它的最新状态，
// PO 会永久卡住、必须人工点「确认付款」。这里把这些"已绑定待付款"单也纳入定时同步，
// 拉最新 1688 状态，已支付则用现有工作流自动推进到 paid（含建入库单）。
function selectBoundPoIdsForPaymentSync(db, { maxAgeHours, limit }) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  return db.prepare(`
    SELECT id, account_id, external_order_synced_at
    FROM erp_purchase_orders
    WHERE external_order_id IS NOT NULL
      AND external_order_id != ''
      AND status IN ('pushed_pending_price', 'approved_to_pay')
      AND created_at >= @cutoff
    ORDER BY (external_order_synced_at IS NULL) DESC, external_order_synced_at ASC
    LIMIT @limit
  `).all({ cutoff, limit });
}

async function runScheduledOrderSync({ maxAgeHours = 168, limit = 50, logger } = {}) {
  if (isClientMode()) return { skipped: "client_mode", processed: 0, results: [] };
  if (!erpState.db || !erpState.services) return { skipped: "erp_not_ready", processed: 0, results: [] };
  const { db, services } = requireErp();
  const candidates = selectPoIdsForScheduledSync(db, { maxAgeHours, limit });
  const boundCandidates = selectBoundPoIdsForPaymentSync(db, { maxAgeHours, limit });
  if (!candidates.length && !boundCandidates.length) return { processed: 0, results: [] };
  const log = typeof logger === "function" ? logger : () => {};
  const now = Date.now();
  const failedAccounts = new Set();
  const results = [];
  for (const row of candidates) {
    const state = orderSyncAttemptState.get(row.id) || { attempts: 0, nextAt: 0 };
    if (state.nextAt && state.nextAt > now) {
      results.push({ poId: row.id, status: "backoff_skip", nextAt: state.nextAt });
      continue;
    }
    if (row.account_id && failedAccounts.has(row.account_id)) {
      results.push({ poId: row.id, status: "account_skip" });
      continue;
    }
    try {
      const result = await sync1688OrdersAction({
        db,
        services,
        payload: { poId: row.id, includeWorkbench: false },
        actor: { id: null, role: "system", name: "auto-sync" },
      });
      if (result.matchStatus === "bound") {
        orderSyncAttemptState.delete(row.id);
        log({ event: "bound", poId: row.id, externalOrderId: result.externalOrderId });
      } else {
        const nextAttempts = state.attempts + 1;
        orderSyncAttemptState.set(row.id, {
          attempts: nextAttempts,
          nextAt: now + getOrderSyncBackoffMs(nextAttempts),
        });
        log({ event: "no_match", poId: row.id, status: result.matchStatus, attempts: nextAttempts });
      }
      results.push({
        poId: row.id,
        status: result.matchStatus,
        externalOrderId: result.externalOrderId || null,
      });
    } catch (e) {
      const nextAttempts = state.attempts + 1;
      orderSyncAttemptState.set(row.id, {
        attempts: nextAttempts,
        nextAt: now + getOrderSyncBackoffMs(nextAttempts),
      });
      const errMsg = e?.message || String(e);
      const looksLikeAuthIssue = /(权限|未授权|授权|access[\s_-]?token|oauth|unauthorized|forbidden|invalid[_\s-]?(?:token|signature))/i.test(errMsg);
      if (looksLikeAuthIssue && row.account_id) failedAccounts.add(row.account_id);
      log({ event: "error", poId: row.id, error: errMsg, attempts: nextAttempts });
      results.push({ poId: row.id, status: "error", error: errMsg });
    }
  }
  // 第二阶段：处理"已绑定 1688 订单号、尚未 paid"的单——拉最新 1688 状态，
  // 若已支付则用现有工作流（submitPaymentApproval → confirmPaymentPaid）自动推进到 paid。
  // 全程用系统 actor，不裸改 status；退避 state key 用 "pay:" 前缀与绑定阶段隔离。
  const sysActor = { id: null, role: "system", name: "auto-sync" };
  for (const row of boundCandidates) {
    const stateKey = "pay:" + row.id;
    const state = orderSyncAttemptState.get(stateKey) || { attempts: 0, nextAt: 0 };
    if (state.nextAt && state.nextAt > now) {
      results.push({ poId: row.id, status: "backoff_skip", nextAt: state.nextAt });
      continue;
    }
    if (row.account_id && failedAccounts.has(row.account_id)) {
      results.push({ poId: row.id, status: "account_skip" });
      continue;
    }
    try {
      const po = getPurchaseOrder(db, row.id);
      if (isPaidOrLaterPurchaseOrder(po)) {
        orderSyncAttemptState.delete(stateKey);
        results.push({ poId: row.id, status: "already_paid" });
        continue;
      }
      await fetch1688OrderDetailForPo({
        db,
        services,
        po,
        payload: {},
        actor: sysActor,
        action: "sync_1688_payment",
      });
      const fresh = getPurchaseOrder(db, row.id);
      const paid =
        map1688StatusToPaymentStatus(fresh.external_order_status, fresh.payment_status) === "paid" ||
        fresh.payment_status === "paid";
      if (paid) {
        let target = fresh;
        if (target.status === "pushed_pending_price") {
          services.purchase.submitPaymentApproval(row.id, sysActor);
          target = getPurchaseOrder(db, row.id);
        }
        if (target.status === "approved_to_pay" || isPaidOrLaterPurchaseOrder(target)) {
          confirmPaymentPaid({ db, services, payload: { poId: row.id }, actor: sysActor });
        }
        orderSyncAttemptState.delete(stateKey);
        log({ event: "paid_advanced", poId: row.id });
        results.push({ poId: row.id, status: "paid_advanced" });
      } else {
        const nextAttempts = state.attempts + 1;
        orderSyncAttemptState.set(stateKey, {
          attempts: nextAttempts,
          nextAt: now + getOrderSyncBackoffMs(nextAttempts),
        });
        log({ event: "not_paid_yet", poId: row.id, attempts: nextAttempts });
        results.push({ poId: row.id, status: "not_paid_yet" });
      }
    } catch (e) {
      const nextAttempts = state.attempts + 1;
      orderSyncAttemptState.set(stateKey, {
        attempts: nextAttempts,
        nextAt: now + getOrderSyncBackoffMs(nextAttempts),
      });
      const errMsg = e?.message || String(e);
      const looksLikeAuthIssue = /(权限|未授权|授权|access[\s_-]?token|oauth|unauthorized|forbidden|invalid[_\s-]?(?:token|signature))/i.test(errMsg);
      if (looksLikeAuthIssue && row.account_id) failedAccounts.add(row.account_id);
      log({ event: "error", poId: row.id, error: errMsg, attempts: nextAttempts });
      results.push({ poId: row.id, status: "error", error: errMsg });
    }
  }
  return {
    processed: candidates.length + boundCandidates.length,
    bound: results.filter((r) => r.status === "bound").length,
    paidAdvanced: results.filter((r) => r.status === "paid_advanced").length,
    results,
  };
}

function resetScheduledOrderSyncState() {
  orderSyncAttemptState.clear();
}

// 1688 消息事件重处理：把状态为 unmatched / error 的事件按原 payload 重跑一次。
// 对 unmatched 尤其有用——首轮收到消息时 PO 还没绑定 external_order_id，
// 等订单同步把 external_order_id 回填后，重跑就能命中并推进 PO 状态机。
function reprocess1688MessageEventRow(row, ctx) {
  const payload = parseJsonObject(row.payload_json) || {};
  const query = parseJsonObject(row.query_json) || {};
  const headers = parseJsonObject(row.headers_json) || {};
  const input = {
    payload,
    query,
    headers,
    bodyText: row.body_text || null,
    sourceIp: row.source_ip || null,
  };
  const normalized = normalize1688MessagePayload(input);
  return process1688MessageEvent({ db: ctx.db, services: ctx.services, input, normalized, row });
}

async function runScheduledMessageReprocess({ maxAgeHours = 168, limit = 100, logger } = {}) {
  if (isClientMode()) return { skipped: "client_mode", processed: 0, results: [] };
  if (!erpState.db || !erpState.services) return { skipped: "erp_not_ready", processed: 0, results: [] };
  const { db, services } = requireErp();
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const candidates = db.prepare(`
    SELECT * FROM erp_1688_message_events
    WHERE status IN ('error', 'unmatched')
      AND received_at >= @cutoff
    ORDER BY received_at ASC
    LIMIT @limit
  `).all({ cutoff, limit });
  if (!candidates.length) return { processed: 0, results: [] };
  const log = typeof logger === "function" ? logger : () => {};
  const results = [];
  for (const event of candidates) {
    try {
      const processResult = reprocess1688MessageEventRow(event, { db, services });
      const status = processResult.status === "processed"
        ? "processed"
        : (processResult.status === "unmatched" ? "unmatched" : "ignored");
      db.prepare(`
        UPDATE erp_1688_message_events
        SET status = @status,
            error_message = @error_message,
            processed_at = @processed_at
        WHERE id = @id
      `).run({
        id: event.id,
        status,
        error_message: processResult.reason || null,
        processed_at: nowIso(),
      });
      try { update1688MessageSubscriptionStats(db, event, status); } catch {}
      log({ event: status, id: event.id, topic: event.topic, prevStatus: event.status });
      results.push({ id: event.id, prevStatus: event.status, status });
    } catch (error) {
      const errMsg = error?.message || String(error);
      try {
        db.prepare(`
          UPDATE erp_1688_message_events
          SET status = 'error',
              error_message = @error_message,
              processed_at = @processed_at
          WHERE id = @id
        `).run({ id: event.id, error_message: errMsg, processed_at: nowIso() });
        update1688MessageSubscriptionStats(db, event, "error");
      } catch {}
      log({ event: "error", id: event.id, topic: event.topic, error: errMsg });
      results.push({ id: event.id, prevStatus: event.status, status: "error", error: errMsg });
    }
  }
  return {
    processed: candidates.length,
    promoted: results.filter((r) => r.status === "processed").length,
    results,
  };
}

const ALIBABA_1688_SELLER_MEMBER_ID_KEYS = [
  "sellerMemberId",
  "seller_member_id",
  "sellerOpenId",
  "seller_open_id",
  "supplierMemberId",
  "supplier_member_id",
  "memberId",
  "member_id",
];

const ALIBABA_1688_SELLER_LOGIN_ID_KEYS = [
  "sellerLoginId",
  "seller_login_id",
  "loginId",
  "login_id",
  "memberLoginId",
  "member_login_id",
  "wangwang",
  "wangWang",
];

function first1688SellerIdentityValue(candidates = [], keys = []) {
  for (const candidate of candidates) {
    const expanded = asExpandedObject(candidate);
    if (!expanded || !Object.keys(expanded).length) continue;
    for (const key of keys) {
      const direct = optionalString(expanded[key]);
      if (direct) return direct;
    }
    const deep = optionalString(findFirstDeepValue(expanded, keys));
    if (deep) return deep;
  }
  return null;
}

function extract1688SellerIdentity(payload = {}, source = {}) {
  const rawSourcePayload = source.sourcePayload ?? source.sourcePayloadJson ?? source.source_payload_json ?? {};
  const sourcePayload = rawSourcePayload && typeof rawSourcePayload === "object" && !Array.isArray(rawSourcePayload)
    ? rawSourcePayload
    : parseJsonObject(rawSourcePayload);
  const candidates = [
    payload,
    payload.params,
    payload.rawParams,
    payload.sellerIdentity,
    sourcePayload,
    sourcePayload.sellerIdentity,
    sourcePayload.relationUserInfo,
    sourcePayload.relationUserInfoRaw,
    sourcePayload.purchasedProductSimple,
    sourcePayload.purchasedProductSimpleRaw,
    sourcePayload.productDetailForMix,
    sourcePayload.productDetailForMixRaw,
    sourcePayload.raw,
    source,
  ];
  return {
    sellerMemberId: first1688SellerIdentityValue(candidates, ALIBABA_1688_SELLER_MEMBER_ID_KEYS),
    sellerLoginId: first1688SellerIdentityValue(candidates, ALIBABA_1688_SELLER_LOGIN_ID_KEYS),
  };
}

function has1688SellerIdentity(identity = {}) {
  return Boolean(optionalString(identity.sellerMemberId) || optionalString(identity.sellerLoginId));
}

function build1688MarketingMixConfigParams(payload = {}, source = {}) {
  const identity = extract1688SellerIdentity(payload, source);
  const sellerMemberId = optionalString(identity.sellerMemberId);
  const sellerLoginId = optionalString(identity.sellerLoginId);
  if (!sellerMemberId && !sellerLoginId) {
    throw new Error("这个供应商缺少 1688 memberId/旺旺登录名，无法识别起批规则；请先同步商品详情或补充旺旺/memberId。");
  }
  return {
    ...(sellerMemberId ? { sellerMemberId } : {}),
    ...(sellerLoginId ? { sellerLoginId } : {}),
  };
}

async function fetch1688SellerIdentityFromProductDetail({ db, payload, actor, source }) {
  const offerId = extract1688ProductId(payload, source || {});
  if (!source || !offerId) return { sellerIdentity: {}, rawResponse: null, detail: null, query: null };
  if (payload.dryRun && !payload.mockProductDetailForMix && !payload.mockProductDetailResponse) {
    return { sellerIdentity: {}, rawResponse: null, detail: null, query: null };
  }
  const query = build1688ProductDetailParams(offerId, payload);
  const rawResponse = payload.mockProductDetailForMix
    || payload.mockProductDetailResponse
    || await call1688ProcurementApi({
      db,
      actor,
      accountId: optionalString(payload.accountId || payload.account_id || source.account_id),
      action: "query_1688_mix_config_product_detail",
      api: PROCUREMENT_APIS.PRODUCT_DETAIL,
      params: query,
    });
  const detail = normalize1688ProductDetailResponse(rawResponse);
  const sellerIdentity = extract1688SellerIdentity({
    productDetailForMix: detail,
    productDetailForMixRaw: rawResponse,
  }, {
    ...source,
    source_payload_json: trimJsonForStorage({
      ...parseJsonObject(source.source_payload_json),
      productDetailForMix: detail,
      productDetailForMixRaw: rawResponse,
    }),
  });
  if (has1688SellerIdentity(sellerIdentity)) {
    patchSku1688SourcePayload(db, source.id, {
      sellerIdentity,
      productDetailForMix: detail,
      productDetailForMixRaw: rawResponse,
      productDetailForMixSyncedAt: nowIso(),
    });
  }
  return { sellerIdentity, rawResponse, detail, query };
}

function normalized1688SellerIdentity(identity = {}) {
  return {
    sellerMemberId: optionalString(identity.sellerMemberId || identity.seller_member_id || identity.memberId || identity.member_id),
    sellerLoginId: optionalString(identity.sellerLoginId || identity.seller_login_id || identity.loginId || identity.login_id),
  };
}

function normalizedSupplierName(value) {
  return optionalString(value).toLowerCase();
}

function getSourceMarketingMixCache(source = {}) {
  const sourcePayload = parseJsonObject(source.source_payload_json ?? source.sourcePayloadJson ?? source.sourcePayload);
  const mixConfig = sourcePayload.marketingMixConfig;
  if (!mixConfig || typeof mixConfig !== "object" || Array.isArray(mixConfig)) return null;
  return {
    mixConfig,
    sellerIdentity: normalized1688SellerIdentity(sourcePayload.marketingMixSellerIdentity || extract1688SellerIdentity({}, source)),
    syncedAt: optionalString(sourcePayload.marketingMixSyncedAt),
    rawResponse: sourcePayload.marketingMixRawResponse || null,
    sourcePayload,
  };
}

function sourceMatches1688Seller(source = {}, sellerIdentity = {}, supplierName = "") {
  const targetIdentity = normalized1688SellerIdentity(sellerIdentity);
  const sourceIdentity = normalized1688SellerIdentity(extract1688SellerIdentity({}, source));
  if (targetIdentity.sellerMemberId && sourceIdentity.sellerMemberId === targetIdentity.sellerMemberId) return true;
  if (
    targetIdentity.sellerLoginId
    && sourceIdentity.sellerLoginId
    && sourceIdentity.sellerLoginId.toLowerCase() === targetIdentity.sellerLoginId.toLowerCase()
  ) return true;
  const targetSupplierName = normalizedSupplierName(supplierName);
  return Boolean(targetSupplierName && normalizedSupplierName(source.supplier_name) === targetSupplierName);
}

function findCached1688MixConfig(db, source = {}, sellerIdentity = {}) {
  const supplierName = optionalString(source.supplier_name);
  const rows = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE status != 'deleted'
    ORDER BY updated_at DESC, created_at DESC
  `).all();
  for (const row of rows) {
    const cache = getSourceMarketingMixCache(row);
    if (!cache) continue;
    const cacheIdentity = has1688SellerIdentity(cache.sellerIdentity) ? cache.sellerIdentity : extract1688SellerIdentity({}, row);
    if (sourceMatches1688Seller(row, sellerIdentity, supplierName) || sourceMatches1688Seller(source, cacheIdentity, row.supplier_name)) {
      return { ...cache, source: row };
    }
  }
  return null;
}

function updateSku1688SourceMixConfig(db, sourceId, mixConfig, options = {}) {
  if (!sourceId) return null;
  const source = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  if (!source) return null;
  const sourcePayload = parseJsonObject(source.source_payload_json);
  const now = nowIso();
  const sellerIdentity = normalized1688SellerIdentity(options.sellerIdentity || extract1688SellerIdentity({}, source));
  const patch = {
    ...sourcePayload,
    marketingMixConfig: mixConfig,
    marketingMixSyncedAt: optionalString(options.syncedAt) || now,
    marketingMixSellerIdentity: sellerIdentity,
    marketingMixCacheSource: optionalString(options.cacheSource) || "api",
  };
  if (options.auto) {
    patch.marketingMixAutoAttemptedAt = optionalString(options.autoAttemptedAt) || now;
    patch.marketingMixAutoStatus = "success";
    patch.marketingMixAutoError = null;
  }
  if (options.cachedFromSourceId) patch.marketingMixCachedFromSourceId = options.cachedFromSourceId;
  if (options.rawResponse) patch.marketingMixRawResponse = options.rawResponse;
  db.prepare(`
    UPDATE erp_sku_1688_sources
    SET source_payload_json = @source_payload_json,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: source.id,
    source_payload_json: trimJsonForStorage(patch),
    updated_at: now,
  });
  return toSku1688Source(db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(source.id));
}

function updateSku1688SourceMixAutoState(db, sourceId, state = {}) {
  if (!sourceId) return null;
  return patchSku1688SourcePayload(db, sourceId, {
    marketingMixAutoAttemptedAt: optionalString(state.at) || nowIso(),
    marketingMixAutoStatus: optionalString(state.status),
    marketingMixAutoError: optionalString(state.error),
  });
}

function sync1688SupplierMixAutoState(db, source = {}, sellerIdentity = {}, state = {}) {
  const supplierName = optionalString(source.supplier_name);
  const rows = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE status != 'deleted'
    ORDER BY updated_at DESC, created_at DESC
  `).all();
  const targetRows = rows.filter((row) => sourceMatches1688Seller(row, sellerIdentity, supplierName));
  const targets = targetRows.length ? targetRows : (source?.id ? [source] : []);
  const updated = [];
  for (const target of targets) {
    const next = updateSku1688SourceMixAutoState(db, target.id, state);
    if (next) updated.push(next);
  }
  return updated;
}

function sync1688SupplierMixConfig(db, source = {}, sellerIdentity = {}, mixConfig = {}, options = {}) {
  const supplierName = optionalString(source.supplier_name);
  const rows = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE status != 'deleted'
    ORDER BY updated_at DESC, created_at DESC
  `).all();
  const targetRows = rows.filter((row) => sourceMatches1688Seller(row, sellerIdentity, supplierName));
  const targets = targetRows.length ? targetRows : (source?.id ? [source] : []);
  const updated = [];
  for (const target of targets) {
    const next = updateSku1688SourceMixConfig(db, target.id, mixConfig, {
      ...options,
      sellerIdentity,
    });
    if (next) updated.push(next);
  }
  return {
    updatedCount: updated.length,
    updatedSourceIds: updated.map((row) => row.id),
    updatedSource: source?.id ? updated.find((row) => row.id === source.id) || null : null,
  };
}

async function query1688MixConfigAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 seller mix config query");
  const sourceId = optionalString(payload.sourceId || payload.source_id || payload.id);
  const source = sourceId
    ? db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId)
    : null;
  if (sourceId && !source) throw new Error(`1688 supplier mapping not found: ${sourceId}`);

  const forceRefresh = Boolean(payload.forceRefresh || payload.force_refresh);
  let sellerIdentity = extract1688SellerIdentity(payload, source || {});
  let productDetailLookup = null;
  if (!forceRefresh && source) {
    const cached = findCached1688MixConfig(db, source, sellerIdentity);
    if (cached) {
      const cachedIdentity = has1688SellerIdentity(cached.sellerIdentity)
        ? cached.sellerIdentity
        : extract1688SellerIdentity({}, cached.source);
      const syncResult = sync1688SupplierMixConfig(db, source, cachedIdentity, cached.mixConfig, {
        syncedAt: cached.syncedAt,
        cacheSource: "cache",
        cachedFromSourceId: cached.source.id,
        auto: Boolean(payload.autoMix || payload.auto_mix),
        autoAttemptedAt: payload.autoAttemptedAt || payload.auto_attempted_at,
      });
      return {
        apiKey: PROCUREMENT_APIS.MARKETING_MIX_CONFIG.key,
        query: has1688SellerIdentity(cachedIdentity)
          ? build1688MarketingMixConfigParams({ ...payload, sellerIdentity: cachedIdentity }, source || {})
          : { sellerName: optionalString(source.supplier_name) },
        mixConfig: cached.mixConfig,
        sku1688Source: syncResult.updatedSource || (sourceId ? toSku1688Source(db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId)) : null),
        productDetailLookup,
        rawResponse: cached.rawResponse,
        cached: true,
        cachedFromSourceId: cached.source.id,
        updatedSourceCount: syncResult.updatedCount,
      };
    }
  }
  if (!has1688SellerIdentity(sellerIdentity)) {
    productDetailLookup = await fetch1688SellerIdentityFromProductDetail({ db, payload, actor, source });
    sellerIdentity = productDetailLookup.sellerIdentity || sellerIdentity;
  }
  if (!forceRefresh && source) {
    const cached = findCached1688MixConfig(db, source, sellerIdentity);
    if (cached) {
      const cachedIdentity = has1688SellerIdentity(cached.sellerIdentity)
        ? cached.sellerIdentity
        : sellerIdentity;
      const syncResult = sync1688SupplierMixConfig(db, source, cachedIdentity, cached.mixConfig, {
        syncedAt: cached.syncedAt,
        cacheSource: "cache",
        cachedFromSourceId: cached.source.id,
        auto: Boolean(payload.autoMix || payload.auto_mix),
        autoAttemptedAt: payload.autoAttemptedAt || payload.auto_attempted_at,
      });
      return {
        apiKey: PROCUREMENT_APIS.MARKETING_MIX_CONFIG.key,
        query: has1688SellerIdentity(cachedIdentity)
          ? build1688MarketingMixConfigParams({ ...payload, sellerIdentity: cachedIdentity }, source || {})
          : { sellerName: optionalString(source.supplier_name) },
        mixConfig: cached.mixConfig,
        sku1688Source: syncResult.updatedSource || (sourceId ? toSku1688Source(db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId)) : null),
        productDetailLookup,
        rawResponse: cached.rawResponse,
        cached: true,
        cachedFromSourceId: cached.source.id,
        updatedSourceCount: syncResult.updatedCount,
      };
    }
  }
  const apiParams = build1688MarketingMixConfigParams({ ...payload, sellerIdentity }, source || {});
  if (payload.dryRun) {
    return {
      dryRun: true,
      apiKey: PROCUREMENT_APIS.MARKETING_MIX_CONFIG.key,
      params: apiParams,
      productDetailLookup,
    };
  }

  const rawResponse = payload.mockMixConfigResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id || source?.account_id),
    action: "query_1688_mix_config",
    api: PROCUREMENT_APIS.MARKETING_MIX_CONFIG,
    params: apiParams,
  });
  const mixConfig = normalize1688MarketingMixConfigResponse(rawResponse);
  const syncResult = source
    ? sync1688SupplierMixConfig(db, source, sellerIdentity, mixConfig, {
      rawResponse,
      cacheSource: "api",
      auto: Boolean(payload.autoMix || payload.auto_mix),
      autoAttemptedAt: payload.autoAttemptedAt || payload.auto_attempted_at,
    })
    : { updatedSource: sourceId ? updateSku1688SourceMixConfig(db, sourceId, mixConfig, { sellerIdentity, rawResponse }) : null, updatedCount: sourceId ? 1 : 0 };
  return {
    apiKey: PROCUREMENT_APIS.MARKETING_MIX_CONFIG.key,
    query: apiParams,
    mixConfig,
    sku1688Source: syncResult.updatedSource,
    productDetailLookup,
    rawResponse,
    cached: false,
    updatedSourceCount: syncResult.updatedCount,
  };
}

async function ensure1688MixConfigOnceAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 seller mix config auto query");
  const sourceId = requireString(payload.sourceId || payload.source_id || payload.id, "sourceId");
  const source = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  if (!source) throw new Error(`1688 supplier mapping not found: ${sourceId}`);
  const sourcePayload = parseJsonObject(source.source_payload_json);
  if (sourcePayload.marketingMixConfig && typeof sourcePayload.marketingMixConfig === "object") {
    return {
      skipped: true,
      reason: "cached",
      mixConfig: sourcePayload.marketingMixConfig,
      sku1688Source: toSku1688Source(source),
    };
  }
  if (!payload.forceRefresh && !payload.force_refresh && sourcePayload.marketingMixAutoAttemptedAt) {
    return {
      skipped: true,
      reason: sourcePayload.marketingMixAutoStatus || "attempted",
      sku1688Source: toSku1688Source(source),
    };
  }

  const attemptedAt = nowIso();
  const sellerIdentity = extract1688SellerIdentity(payload, source);
  sync1688SupplierMixAutoState(db, source, sellerIdentity, {
    at: attemptedAt,
    status: "running",
    error: null,
  });

  try {
    const result = await query1688MixConfigAction({
      db,
      payload: {
        ...payload,
        autoMix: true,
        autoAttemptedAt: attemptedAt,
      },
      actor,
    });
    return {
      ...result,
      autoAttempted: true,
    };
  } catch (error) {
    const errorMessage = String(error?.message || error);
    sync1688SupplierMixAutoState(db, source, sellerIdentity, {
      at: attemptedAt,
      status: "failed",
      error: errorMessage,
    });
    return {
      ok: false,
      autoAttempted: true,
      error: errorMessage,
      sku1688Source: toSku1688Source(db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId)),
    };
  }
}

function compact1688Params(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );
}

function firstDefinedValue(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function optionalBoolean(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "open", "opened"].includes(text)) return true;
  if (["false", "0", "no", "n", "closed"].includes(text)) return false;
  return null;
}

function page1688Params(payload = {}, defaults = {}) {
  return compact1688Params({
    ...defaults,
    beginPage: optionalNumber(payload.beginPage ?? payload.page) || defaults.beginPage,
    page: optionalNumber(payload.page) || defaults.page,
    pageSize: optionalNumber(payload.pageSize) || defaults.pageSize,
    keyword: optionalString(payload.keyword) || defaults.keyword,
  });
}

function getSku1688SourceFromPayload(db, payload = {}) {
  const sourceId = optionalString(payload.sourceId || payload.source_id || payload.id);
  if (sourceId) {
    const source = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
    if (!source) throw new Error(`1688 source not found: ${sourceId}`);
    return source;
  }
  const externalOfferId = optionalString(payload.externalOfferId || payload.offerId || payload.productId || payload.productID);
  if (!externalOfferId) return null;
  const source = db.prepare(`
    SELECT *
    FROM erp_sku_1688_sources
    WHERE external_offer_id = @external_offer_id
      AND (@account_id IS NULL OR account_id = @account_id)
      AND (@sku_id IS NULL OR sku_id = @sku_id)
    ORDER BY is_default DESC, updated_at DESC, created_at DESC
    LIMIT 1
  `).get({
    external_offer_id: externalOfferId,
    account_id: optionalString(payload.accountId || payload.account_id),
    sku_id: optionalString(payload.skuId || payload.sku_id),
  });
  return source || null;
}

function patchSku1688SourcePayload(db, sourceId, patch = {}) {
  if (!sourceId) return null;
  const source = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  if (!source) return null;
  const current = parseJsonObject(source.source_payload_json);
  const now = nowIso();
  db.prepare(`
    UPDATE erp_sku_1688_sources
    SET source_payload_json = @source_payload_json,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: source.id,
    source_payload_json: trimJsonForStorage({ ...current, ...patch, updatedBy1688ActionAt: now }),
    updated_at: now,
  });
  return toSku1688Source(db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(source.id));
}

function extract1688ProductId(payload = {}, source = {}) {
  return optionalString(
    payload.productId
    || payload.productID
    || payload.offerId
    || payload.externalOfferId
    || source.external_offer_id,
  );
}

function build1688RelationSupplyParams(payload = {}) {
  return raw1688Params(payload, page1688Params(payload, {
    beginPage: 1,
    pageSize: 20,
    relationType: optionalString(payload.relationType || payload.type),
  }));
}

function build1688RelationUserInfoParams(payload = {}, source = {}) {
  const sellerLoginId = optionalString(
    payload.sellerLoginId
    || payload.loginId
    || payload.memberId
    || payload.supplierName
    || source.supplier_name,
  );
  const domain = optionalString(payload.domain || payload.shopDomain || payload.shopUrl || payload.url);
  return raw1688Params(payload, compact1688Params({
    domain,
    sellerLoginId,
    memberId: optionalString(payload.memberId),
  }));
}

function build1688ProductFollowParams(payload = {}, source = {}) {
  const productId = requireString(extract1688ProductId(payload, source), "1688 productId");
  return raw1688Params(payload, compact1688Params({
    productId,
    productID: productId,
    webSite: optionalString(payload.webSite) || "1688",
  }));
}

function build1688ProductSimpleParams(payload = {}, source = {}) {
  const productId = requireString(extract1688ProductId(payload, source), "1688 productId");
  return raw1688Params(payload, compact1688Params({
    productID: productId,
    productId,
    webSite: optionalString(payload.webSite) || "1688",
  }));
}

function orderIdsFor1688PaymentAction(db, payload = {}) {
  const purchaseOrders = getPurchaseOrdersForPayment(db, payload);
  const orderIds = Array.from(new Set([
    ...purchaseOrders.map((po) => po.external_order_id),
    ...(Array.isArray(payload.externalOrderIds) ? payload.externalOrderIds : []),
    ...(Array.isArray(payload.orderIds) ? payload.orderIds : []),
    payload.externalOrderId || payload.orderId || payload.tradeId,
  ].map((item) => optionalString(item)).filter(Boolean)));
  if (!orderIds.length) throw new Error("1688 orderId is required");
  return { purchaseOrders, orderIds };
}

function build1688PayWayParams(payload = {}, orderIds = []) {
  const orderId = orderIds[0];
  return raw1688Params(payload, compact1688Params({
    orderId,
    orderIdList: orderIds,
    webSite: optionalString(payload.webSite) || "1688",
  }));
}

function build1688ProtocolPayStatusParams(payload = {}, orderIds = []) {
  return raw1688Params(payload, compact1688Params({
    orderId: orderIds[0],
    orderIdList: orderIds.length ? orderIds : undefined,
    payChannel: optionalString(payload.payChannel || payload.channel),
    webSite: optionalString(payload.webSite) || "1688",
  }));
}

function build1688ProtocolPayPrepareParams(payload = {}, orderIds = []) {
  return raw1688Params(payload, compact1688Params({
    orderId: orderIds[0],
    orderIdList: orderIds,
    payChannel: optionalString(payload.payChannel || payload.channel),
    payWay: optionalString(payload.payWay),
    webSite: optionalString(payload.webSite) || "1688",
  }));
}

function looksLike1688Supplier(item = {}) {
  return Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && (
      item.memberId
      || item.sellerMemberId
      || item.loginId
      || item.sellerLoginId
      || item.companyName
      || item.shopName
      || item.supplierName
    )
  );
}

function normalize1688SupplierRelationResponse(rawResponse = {}) {
  const expanded = asExpandedObject(rawResponse);
  const rows = findDeepArray(expanded, looksLike1688Supplier);
  const sourceRows = rows.length ? rows : (looksLike1688Supplier(expanded) ? [expanded] : []);
  return sourceRows.map((row) => ({
    memberId: optionalString(row.memberId || row.sellerMemberId || row.member_id),
    loginId: optionalString(row.loginId || row.sellerLoginId || row.seller_login_id),
    companyName: optionalString(row.companyName || row.supplierName || row.sellerCompanyName),
    shopName: optionalString(row.shopName || row.storeName || row.wangpuName),
    shopUrl: optionalString(row.shopUrl || row.domain || row.url),
    raw: row,
  }));
}

function normalize1688PayWayResponse(rawResponse = {}) {
  const expanded = asExpandedObject(rawResponse);
  const rows = findDeepArray(expanded, (item) => hasAnyKey(item, ["payWay", "payChannel", "channel", "name", "code"]));
  return rows.map((row) => ({
    code: optionalString(row.payWay || row.payChannel || row.channel || row.code || row.id),
    name: optionalString(row.name || row.payWayName || row.channelName || row.title),
    enabled: firstDefinedValue(row.enabled, row.available, row.support, row.canUse),
    raw: row,
  }));
}

function import1688AgentCandidates({ db, services, payload, actor, products = [], auditAction }) {
  const prId = optionalString(payload.prId || payload.id);
  if (!prId || !products.length) return [];
  let pr = getPurchaseRequest(db, prId);
  return db.transaction(() => {
    if (pr.status === "submitted") {
      services.purchase.acceptRequest(prId, actor);
      pr = getPurchaseRequest(db, prId);
      writePurchaseRequestEvent(db, pr, actor, "accept_request", "Purchase request accepted");
    }
    const limit = Math.max(1, Math.min(Number(optionalNumber(payload.importLimit) ?? products.length), 20));
    const dedupeMap = loadSourcingCandidateDedupeMap(db, pr.id);
    const candidates = products.slice(0, limit)
      .map((item) => insert1688SourcingCandidate(
        db,
        services,
        pr,
        actor,
        { ...item, auditAction },
        { dedupeMap },
      ))
      .filter(Boolean);
    if (candidates.length && pr.status === "buyer_processing") {
      services.purchase.markRequestSourced(prId, actor);
      pr = getPurchaseRequest(db, prId);
    }
    writePurchaseRequestEvent(
      db,
      pr,
      actor,
      auditAction,
      candidates.length
        ? `1688 agent imported ${candidates.length} candidates`
        : "1688 agent matched candidates already exist",
    );
    markPurchaseRequestRead(db, pr.id, actor);
    return candidates;
  })();
}

async function search1688RelationSuppliersAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 relation supplier search");
  const params = build1688RelationSupplyParams(payload);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.RELATION_SUPPLY_SEARCH.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id),
    action: "search_1688_relation_suppliers",
    api: PROCUREMENT_APIS.RELATION_SUPPLY_SEARCH,
    params,
  });
  const suppliers = normalize1688SupplierRelationResponse(rawResponse);
  return { apiKey: PROCUREMENT_APIS.RELATION_SUPPLY_SEARCH.key, query: params, suppliers, rawResponse };
}

async function sync1688RelationUserInfoAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 relation supplier info");
  const source = getSku1688SourceFromPayload(db, payload);
  const params = build1688RelationUserInfoParams(payload, source || {});
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.RELATION_USER_INFO.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id || source?.account_id),
    action: "sync_1688_relation_user_info",
    api: PROCUREMENT_APIS.RELATION_USER_INFO,
    params,
  });
  const suppliers = normalize1688SupplierRelationResponse(rawResponse);
  const updatedSource = source ? patchSku1688SourcePayload(db, source.id, {
    relationUserInfo: suppliers[0] || rawResponse,
    relationUserInfoRaw: rawResponse,
  }) : null;
  return { apiKey: PROCUREMENT_APIS.RELATION_USER_INFO.key, query: params, suppliers, sku1688Source: updatedSource, rawResponse };
}

async function set1688ProductFollowAction({ db, payload, actor, follow }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], follow ? "1688 product follow" : "1688 product unfollow");
  const source = getSku1688SourceFromPayload(db, payload);
  const params = build1688ProductFollowParams(payload, source || {});
  const api = follow ? PROCUREMENT_APIS.PRODUCT_FOLLOW : PROCUREMENT_APIS.PRODUCT_UNFOLLOW;
  const action = follow ? "follow_1688_product" : "unfollow_1688_product";
  if (payload.dryRun) return { dryRun: true, apiKey: api.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id || source?.account_id),
    action,
    api,
    params,
  });
  const updatedSource = source ? patchSku1688SourcePayload(db, source.id, {
    followedAt1688: follow ? nowIso() : null,
    unfollowedAt1688: follow ? null : nowIso(),
    followResponse: rawResponse,
  }) : null;
  return { apiKey: api.key, query: params, followed: follow, sku1688Source: updatedSource, rawResponse };
}

async function sync1688PurchasedProductsAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 purchased product simple info");
  const source = getSku1688SourceFromPayload(db, payload);
  const params = build1688ProductSimpleParams(payload, source || {});
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.PRODUCT_SIMPLE_GET.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id || source?.account_id),
    action: "sync_1688_purchased_products",
    api: PROCUREMENT_APIS.PRODUCT_SIMPLE_GET,
    params,
  });
  const product = normalize1688ProductDetailResponse(rawResponse);
  const updatedSource = source ? patchSku1688SourcePayload(db, source.id, {
    purchasedProductSimple: product,
    purchasedProductSimpleRaw: rawResponse,
  }) : null;
  return { apiKey: PROCUREMENT_APIS.PRODUCT_SIMPLE_GET.key, query: params, product, sku1688Source: updatedSource, rawResponse };
}

function patch1688SourceAutoState(db, sourceId, prefix, state = {}) {
  const attemptedAtKey = `${prefix}AutoAttemptedAt`;
  const statusKey = `${prefix}AutoStatus`;
  const errorKey = `${prefix}AutoError`;
  return patchSku1688SourcePayload(db, sourceId, {
    [attemptedAtKey]: optionalString(state.at) || nowIso(),
    [statusKey]: optionalString(state.status),
    [errorKey]: optionalString(state.error),
  });
}

async function ensure1688SourcePayloadOnce({ db, payload, actor, source, dataKey, prefix, action }) {
  const sourcePayload = parseJsonObject(source.source_payload_json);
  if (sourcePayload[dataKey] && typeof sourcePayload[dataKey] === "object") {
    return {
      skipped: true,
      reason: "cached",
      sku1688Source: toSku1688Source(source),
    };
  }
  if (!payload.forceRefresh && !payload.force_refresh && sourcePayload[`${prefix}AutoAttemptedAt`]) {
    return {
      skipped: true,
      reason: sourcePayload[`${prefix}AutoStatus`] || "attempted",
      sku1688Source: toSku1688Source(source),
    };
  }

  const attemptedAt = nowIso();
  patch1688SourceAutoState(db, source.id, prefix, {
    at: attemptedAt,
    status: "running",
    error: null,
  });

  try {
    const result = await action({
      db,
      payload: {
        ...payload,
        autoAttemptedAt: attemptedAt,
      },
      actor,
    });
    const updatedSource = patch1688SourceAutoState(db, source.id, prefix, {
      at: attemptedAt,
      status: "success",
      error: null,
    });
    return {
      skipped: false,
      ok: true,
      result,
      sku1688Source: updatedSource,
    };
  } catch (error) {
    const errorMessage = String(error?.message || error);
    const updatedSource = patch1688SourceAutoState(db, source.id, prefix, {
      at: attemptedAt,
      status: "failed",
      error: errorMessage,
    });
    return {
      skipped: false,
      ok: false,
      error: errorMessage,
      sku1688Source: updatedSource,
    };
  }
}

async function ensure1688SupplierProfileOnceAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 supplier profile auto sync");
  const sourceId = requireString(payload.sourceId || payload.source_id || payload.id, "sourceId");
  let source = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  if (!source) throw new Error(`1688 supplier mapping not found: ${sourceId}`);

  const relationUserInfo = await ensure1688SourcePayloadOnce({
    db,
    payload,
    actor,
    source,
    dataKey: "relationUserInfo",
    prefix: "relationUserInfo",
    action: sync1688RelationUserInfoAction,
  });

  source = db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId);
  const purchasedProductSimple = await ensure1688SourcePayloadOnce({
    db,
    payload,
    actor,
    source,
    dataKey: "purchasedProductSimple",
    prefix: "purchasedProductSimple",
    action: sync1688PurchasedProductsAction,
  });

  return {
    relationUserInfo,
    purchasedProductSimple,
    sku1688Source: toSku1688Source(db.prepare("SELECT * FROM erp_sku_1688_sources WHERE id = ?").get(sourceId)),
  };
}

async function query1688PayWaysAction({ db, payload, actor }) {
  assertActorRole(actor, ["finance", "manager", "admin", "buyer"], "1688 pay way query");
  const { purchaseOrders, orderIds } = orderIdsFor1688PaymentAction(db, payload);
  const params = build1688PayWayParams(payload, orderIds);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.PAY_WAY_QUERY.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: purchaseOrders[0]?.account_id || optionalString(payload.accountId || payload.account_id),
    action: "query_1688_pay_ways",
    api: PROCUREMENT_APIS.PAY_WAY_QUERY,
    params,
  });
  return {
    apiKey: PROCUREMENT_APIS.PAY_WAY_QUERY.key,
    query: params,
    externalOrderIds: orderIds,
    payWays: normalize1688PayWayResponse(rawResponse),
    rawResponse,
  };
}

async function query1688ProtocolPayStatusAction({ db, payload, actor }) {
  assertActorRole(actor, ["finance", "manager", "admin", "buyer"], "1688 protocol pay status");
  let purchaseOrders = [];
  let orderIds = [];
  try {
    const resolved = orderIdsFor1688PaymentAction(db, payload);
    purchaseOrders = resolved.purchaseOrders;
    orderIds = resolved.orderIds;
  } catch {
    orderIds = [];
  }
  const params = build1688ProtocolPayStatusParams(payload, orderIds);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.PROTOCOL_PAY_IS_OPEN.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: purchaseOrders[0]?.account_id || optionalString(payload.accountId || payload.account_id),
    action: "query_1688_protocol_pay_status",
    api: PROCUREMENT_APIS.PROTOCOL_PAY_IS_OPEN,
    params,
  });
  return {
    apiKey: PROCUREMENT_APIS.PROTOCOL_PAY_IS_OPEN.key,
    query: params,
    externalOrderIds: orderIds,
    isOpen: optionalBoolean(findFirstDeepValue(asExpandedObject(rawResponse), ["isOpen", "opened", "protocolOpen", "open"])),
    rawResponse,
  };
}

async function prepare1688ProtocolPayAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["finance", "manager", "admin"], "1688 protocol pay");
  const { purchaseOrders, orderIds } = orderIdsFor1688PaymentAction(db, payload);
  const params = build1688ProtocolPayPrepareParams(payload, orderIds);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.PROTOCOL_PAY_PREPARE.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: purchaseOrders[0]?.account_id || optionalString(payload.accountId || payload.account_id),
    action: "prepare_1688_protocol_pay",
    api: PROCUREMENT_APIS.PROTOCOL_PAY_PREPARE,
    params,
  });
  const updated = purchaseOrders
    .filter((po) => orderIds.includes(String(po.external_order_id || "")))
    .map((po) => updatePurchaseOrderFrom1688Snapshot({
      db,
      services,
      po,
      order: { externalOrderId: po.external_order_id, status: "protocol_pay_prepared" },
      rawPayment: { protocolPay: rawResponse },
      action: "prepare_1688_protocol_pay",
      actor,
    }));
  return {
    apiKey: PROCUREMENT_APIS.PROTOCOL_PAY_PREPARE.key,
    query: params,
    externalOrderIds: orderIds,
    purchaseOrders: updated.map(toCamelRow),
    rawResponse,
  };
}

function build1688AgentParams(payload = {}, source = {}) {
  const productId = extract1688ProductId(payload, source);
  const keyword = optionalString(payload.keyword || payload.productName || payload.productTitle || source.product_title);
  const agentParam = compact1688Params({
    productId,
    offerId: productId,
    skuId: optionalString(payload.skuId || payload.externalSkuId || source.external_sku_id),
    specId: optionalString(payload.specId || payload.externalSpecId || source.external_spec_id),
    keyword,
    imageUrl: optionalString(payload.imageUrl || source.image_url),
    targetPrice: optionalNumber(payload.targetPrice || payload.targetUnitCost),
    quantity: optionalNumber(payload.quantity || payload.qty),
  });
  return raw1688Params(payload, payload.param ? { param: payload.param } : { param: agentParam });
}

function build1688SupplyChangeFeedbackParams(payload = {}) {
  return raw1688Params(payload, {
    param: compact1688Params({
      taskId: optionalString(payload.taskId || payload.agentTaskId || payload.requestId),
      productId: optionalString(payload.productId || payload.offerId || payload.externalOfferId),
      selectedOfferId: optionalString(payload.selectedOfferId || payload.recommendOfferId),
      feedbackType: optionalString(payload.feedbackType || payload.status || payload.result),
      feedback: optionalString(payload.feedback || payload.remark || payload.message),
    }),
  });
}

async function run1688AgentAction({ db, services, payload, actor, api, action }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 agent");
  const source = getSku1688SourceFromPayload(db, payload);
  const params = build1688AgentParams(payload, source || {});
  if (payload.dryRun) return { dryRun: true, apiKey: api.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id || source?.account_id),
    action,
    api,
    params,
  });
  const products = normalize1688SearchResponse(rawResponse);
  const candidates = import1688AgentCandidates({
    db,
    services,
    payload,
    actor,
    products,
    auditAction: action,
  });
  const updatedSource = source ? patchSku1688SourcePayload(db, source.id, {
    [action]: { rawResponse, productCount: products.length, syncedAt: nowIso() },
  }) : null;
  return {
    apiKey: api.key,
    query: params,
    productCount: products.length,
    importedCount: candidates.length,
    candidates,
    products,
    sku1688Source: updatedSource,
    rawResponse,
  };
}

async function feedback1688SupplyChangeAgentAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 supply change feedback");
  const params = build1688SupplyChangeFeedbackParams(payload);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.SUPPLY_CHANGE_DATA_FEEDBACK.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id),
    action: "feedback_1688_supply_change_agent",
    api: PROCUREMENT_APIS.SUPPLY_CHANGE_DATA_FEEDBACK,
    params,
  });
  return { apiKey: PROCUREMENT_APIS.SUPPLY_CHANGE_DATA_FEEDBACK.key, query: params, rawResponse };
}

function build1688MonitorProductParams(payload = {}, source = {}) {
  const productId = requireString(extract1688ProductId(payload, source), "1688 productId");
  return raw1688Params(payload, compact1688Params({
    productId,
    offerId: productId,
    skuId: optionalString(payload.skuId || payload.externalSkuId || source.external_sku_id),
    specId: optionalString(payload.specId || payload.externalSpecId || source.external_spec_id),
    webSite: optionalString(payload.webSite) || "1688",
  }));
}

function build1688MonitorProductListParams(payload = {}) {
  const provided = raw1688Params(payload, null);
  if (provided?.queryRequest && typeof provided.queryRequest === "object" && !Array.isArray(provided.queryRequest)) {
    return provided;
  }
  const page = Math.max(1, Math.floor(Number(
    optionalNumber(payload.pageNo ?? payload.page ?? payload.beginPage) ?? 1,
  )));
  const pageSize = Math.max(1, Math.min(Math.floor(Number(
    optionalNumber(payload.pageSize) ?? 50,
  )), 100));
  return compact1688Params({
    queryRequest: compact1688Params({
      pageNo: page,
      pageSize,
      keyword: optionalString(payload.keyword),
      productId: optionalString(payload.productId || payload.offerId || payload.externalOfferId),
    }),
  });
}

async function set1688MonitorProductAction({ db, payload, actor, add }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], add ? "1688 add monitor product" : "1688 delete monitor product");
  const source = getSku1688SourceFromPayload(db, payload);
  const params = build1688MonitorProductParams(payload, source || {});
  const api = add ? PROCUREMENT_APIS.MONITOR_PRODUCT_ADD : PROCUREMENT_APIS.MONITOR_PRODUCT_DELETE;
  const action = add ? "add_1688_monitor_product" : "delete_1688_monitor_product";
  if (payload.dryRun) return { dryRun: true, apiKey: api.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id || source?.account_id),
    action,
    api,
    params,
  });
  const updatedSource = source ? patchSku1688SourcePayload(db, source.id, {
    monitorProduct: add ? { enabled: true, params, response: rawResponse, at: nowIso() } : { enabled: false, params, response: rawResponse, at: nowIso() },
  }) : null;
  return { apiKey: api.key, query: params, monitored: add, sku1688Source: updatedSource, rawResponse };
}

async function query1688MonitorProductsAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 monitor products");
  const params = build1688MonitorProductListParams(payload);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.MONITOR_PRODUCT_LIST.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id),
    action: "query_1688_monitor_products",
    api: PROCUREMENT_APIS.MONITOR_PRODUCT_LIST,
    params,
  });
  const products = normalize1688SearchResponse(rawResponse);
  return { apiKey: PROCUREMENT_APIS.MONITOR_PRODUCT_LIST.key, query: params, products, rawResponse };
}

function asExpandedObject(value = {}) {
  const expanded = expandMessageValue(value);
  return expanded && typeof expanded === "object" ? expanded : {};
}

function findFirstDeepNumber(value, keys = []) {
  const found = findFirstDeepValue(value, keys);
  if (Array.isArray(found)) {
    for (const item of found) {
      const number = optionalNumber(item);
      if (number !== null) return number;
    }
    return null;
  }
  if (found && typeof found === "object") {
    for (const key of ["amount", "value", "price", "totalAmount", "cent"]) {
      const number = optionalNumber(found[key]);
      if (number !== null) return key === "cent" ? number / 100 : number;
    }
    return null;
  }
  return optionalNumber(found);
}

function findDeepArray(value, predicate, depth = 0) {
  if (!value || depth > 8) return [];
  if (Array.isArray(value)) {
    const objects = value.filter((item) => item && typeof item === "object");
    if (objects.length && objects.some(predicate)) return objects;
    for (const item of objects) {
      const found = findDeepArray(item, predicate, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof value !== "object") return [];
  for (const item of Object.values(value)) {
    const found = findDeepArray(item, predicate, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function hasAnyKey(item = {}, keys = []) {
  const keySet = new Set(Object.keys(item || {}).map((key) => key.toLowerCase()));
  return keys.some((key) => keySet.has(String(key).toLowerCase()));
}

function normalize1688OrderDetailResponse(rawResponse = {}, fallbackOrderId = null) {
  const expanded = asExpandedObject(rawResponse);
  const normalizedList = normalize1688BuyerOrderListResponse(expanded);
  const order = normalizedList[0] || {};
  const externalOrderId = optionalString(order.externalOrderId)
    || optionalString(findFirstDeepValue(expanded, ["orderId", "orderID", "tradeId", "tradeID", "id"]))
    || optionalString(fallbackOrderId);
  const status = optionalString(order.status)
    || optionalString(findFirstDeepValue(expanded, ["orderStatus", "tradeStatus", "baseStatus", "status"]));
  const totalAmount = optionalNumber(order.totalAmount)
    ?? findFirstDeepNumber(expanded, ["totalAmount", "sumPayment", "actualPayFee", "orderAmount", "payment", "payFee"]);
  const freight = optionalNumber(order.freight)
    ?? findFirstDeepNumber(expanded, ["freight", "postFee", "shippingFee", "carriage", "logisticsFee"]);
  const payTime = optionalString(findFirstDeepValue(expanded, ["payTime", "paymentTime", "gmtPayment"]));
  const receiver = {
    fullName: optionalString(findFirstDeepValue(expanded, ["fullName", "receiverName", "receiveName", "receiver"])),
    mobile: optionalString(findFirstDeepValue(expanded, ["mobile", "receiverMobile", "receiveMobile"])),
    phone: optionalString(findFirstDeepValue(expanded, ["phone", "receiverPhone", "receivePhone"])),
    provinceText: optionalString(findFirstDeepValue(expanded, ["provinceText", "province", "receiverProvince"])),
    cityText: optionalString(findFirstDeepValue(expanded, ["cityText", "city", "receiverCity"])),
    areaText: optionalString(findFirstDeepValue(expanded, ["areaText", "area", "district", "receiverArea"])),
    townText: optionalString(findFirstDeepValue(expanded, ["townText", "town"])),
    address: optionalString(findFirstDeepValue(expanded, ["address", "detailAddress", "receiverAddress", "receiveAddress"])),
  };
  return {
    ...order,
    externalOrderId,
    status,
    supplierName: optionalString(order.supplierName)
      || optionalString(findFirstDeepValue(expanded, ["sellerCompanyName", "sellerCompany", "supplierName", "sellerLoginId"])),
    totalAmount,
    freight,
    payTime,
    receiver,
    raw: expanded,
  };
}

function normalize1688LogisticsResponse(rawResponse = {}, externalOrderId = null) {
  const expanded = asExpandedObject(rawResponse);
  const logisticsItems = findDeepArray(expanded, (item) => hasAnyKey(item, [
    "logisticsId",
    "logisticsBillNo",
    "mailNo",
    "mailNoList",
    "logisticsCompanyName",
    "logisticsStatus",
  ])).map((item) => ({
    logisticsId: optionalString(item.logisticsId || item.id),
    logisticsBillNo: optionalString(item.logisticsBillNo || item.mailNo || item.mail_no || item.waybillNo),
    logisticsCompanyName: optionalString(item.logisticsCompanyName || item.companyName || item.logisticsCompany),
    status: optionalString(item.logisticsStatus || item.status || item.statusDesc),
    deliveredAt: optionalString(item.deliveredAt || item.signTime || item.endTime),
    raw: item,
  }));
  const traceItems = findDeepArray(expanded, (item) => hasAnyKey(item, [
    "acceptTime",
    "time",
    "traceTime",
    "text",
    "context",
    "remark",
    "eventDetail",
    "desc",
  ])).map((item) => ({
    time: optionalString(item.acceptTime || item.traceTime || item.time || item.timeStr),
    text: optionalString(item.remark || item.eventDetail || item.desc || item.description || item.context || item.text),
    raw: item,
  })).filter((item) => item.time || item.text);
  const traceError = optionalString(findFirstDeepValue(expanded, [
    "traceError",
    "errorMessage",
    "errorMsg",
    "message",
    "msg",
  ]));
  const statusText = [
    ...logisticsItems.map((item) => item.status),
    ...traceItems.map((item) => item.text),
  ].filter(Boolean).join(" ").toLowerCase();
  const signed = /签收|已收|delivered|signed|success/.test(statusText);
  const shipped = logisticsItems.length > 0 || traceItems.length > 0;
  return {
    externalOrderId: optionalString(externalOrderId)
      || optionalString(findFirstDeepValue(expanded, ["orderId", "orderID", "tradeId", "tradeID"])),
    status: signed ? "signed" : (shipped ? "shipped" : optionalString(findFirstDeepValue(expanded, ["status", "logisticsStatus"]))),
    signed,
    shipped,
    traceError,
    logisticsItems,
    traceItems,
    raw: expanded,
  };
}

function raw1688Params(payload = {}, fallback = {}) {
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params
    : null;
  const rawParams = payload.rawParams && typeof payload.rawParams === "object" && !Array.isArray(payload.rawParams)
    ? payload.rawParams
    : null;
  return params || rawParams || fallback;
}

function raw1688ParamObject(payload = {}) {
  if (payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)) return payload.params;
  if (payload.rawParams && typeof payload.rawParams === "object" && !Array.isArray(payload.rawParams)) return payload.rawParams;
  return null;
}

function structured1688InputParams(payload = {}, fallbackInput = {}) {
  const raw = raw1688ParamObject(payload);
  if (!raw) return { input: fallbackInput };
  const rawInput = raw.input && typeof raw.input === "object" && !Array.isArray(raw.input)
    ? raw.input
    : {};
  const looseInput = { ...raw };
  delete looseInput.input;
  return {
    input: {
      ...fallbackInput,
      ...looseInput,
      ...rawInput,
    },
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map((item) => optionalString(item)).filter(Boolean);
  const text = optionalString(value);
  return text ? text.split(/[,\s]+/).map((item) => optionalString(item)).filter(Boolean) : [];
}

function firstOptionalString(...values) {
  for (const value of values) {
    const text = optionalString(value);
    if (text) return text;
  }
  return "";
}

// 1688 订单子项 ID 的字段名因不同接口而异：
// - alibaba.trade.get.buyerView 详情里叫 subItemID / subItemIDString / subItemIDStr
// - 一些较新的 fastCreateOrder 响应里叫 orderEntryId / orderEntryID
// - productSnapshotUrl 也可以解出 order_entry_id query 参数
// 这里全都覆盖，且 String 字段优先（19 位 Long 精度安全）。
const ENTRY_ID_KEYS = [
  "subItemIDString",
  "subItemIDStr",
  "subItemId",
  "subItemID",
  "orderEntryIdString",
  "orderEntryIdStr",
  "orderEntryId",
  "orderEntryID",
  "order_entry_id",
  "entryId",
  "entry_id",
];

function pickEntryIdFromItem(item = {}) {
  // 优先级：
  // 1) 显式 String 类型字段（subItemIDString 等）—— 19 位 Long 精度安全
  // 2) productSnapshotUrl 里的 ?order_entry_id=（也是字符串，安全）
  // 3) 数字类型字段（可能因 JSON.parse 精度丢失，最后用）
  const stringFirstKeys = ["subItemIDString", "subItemIDStr", "orderEntryIdString", "orderEntryIdStr"];
  for (const key of stringFirstKeys) {
    const v = item[key];
    if (v !== null && v !== undefined && v !== "") return String(v);
  }
  const snapshot = optionalString(item.productSnapshotUrl);
  if (snapshot) {
    const match = snapshot.match(/[?&]order_entry_id=(\d+)/);
    if (match) return match[1];
  }
  for (const key of ENTRY_ID_KEYS) {
    const v = item[key];
    if (v !== null && v !== undefined && v !== "") return String(v);
  }
  return "";
}

function infer1688OrderEntryIds(payload = {}, po = {}) {
  const direct = normalizeStringList(
    payload.orderEntryIds
      || payload.orderEntryIdList
      || payload.input?.orderEntryIds
      || payload.input?.orderEntryIdList,
  );
  if (direct.length) return direct;
  const detail = asExpandedObject(parseJsonObject(po.external_order_detail_json));
  const payloadJson = asExpandedObject(parseJsonObject(po.external_order_payload_json));
  const directFromDetail = normalizeStringList(findFirstDeepValue(detail, ["orderEntryIds", "orderEntryIdList"]))
    .concat(normalizeStringList(findFirstDeepValue(payloadJson, ["orderEntryIds", "orderEntryIdList"])));
  if (directFromDetail.length) return Array.from(new Set(directFromDetail));
  const rows = findDeepArray({ detail, payloadJson }, (item) => (
    hasAnyKey(item, ENTRY_ID_KEYS)
    && hasAnyKey(item, ["offerId", "productId", "productID", "skuId", "skuID", "quantity", "amount", "name", "title"])
  ));
  return Array.from(new Set(rows.map(pickEntryIdFromItem).filter(Boolean)));
}

function normalize1688MaxRefundFee(rawResponse = {}) {
  return findFirstDeepNumber(asExpandedObject(rawResponse), [
    "maxRefundFee",
    "maxRefundAmount",
    "maxRefundPayment",
    "maxApplyPayment",
    "canRefundFee",
    "availableRefundFee",
    "refundPayment",
    "applyPayment",
  ]);
}

function normalize1688RefundReason(item = {}) {
  const reasonId = firstOptionalString(
    item.refundReasonId,
    item.reasonId,
    item.reasonID,
    item.refund_reason_id,
    item.id,
    item.code,
    item.value,
  );
  const label = firstOptionalString(
    item.refundReason,
    item.reason,
    item.name,
    item.label,
    item.text,
    item.content,
    item.desc,
  );
  if (!reasonId && !label) return null;
  return {
    refundReasonId: reasonId || null,
    reason: label || reasonId,
    label: label || reasonId,
    value: label || reasonId,
    raw: item,
  };
}

function looksLike1688RefundReason(item = {}) {
  return Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && (
      item.refundReasonId
      || item.reasonId
      || item.refund_reason_id
      || item.refundReason
      || item.reason
      || item.name
      || item.label
    )
  );
}

function normalize1688RefundReasons(rawResponse = {}) {
  const expanded = asExpandedObject(rawResponse);
  const rows = findDeepArray(expanded, looksLike1688RefundReason);
  const sourceRows = rows.length ? rows : (looksLike1688RefundReason(expanded) ? [expanded] : []);
  const seen = new Set();
  return sourceRows
    .map(normalize1688RefundReason)
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.refundReasonId || ""}:${item.reason || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getPurchaseOrderFor1688Action(db, payload = {}) {
  const poId = optionalString(payload.poId || payload.id);
  if (poId) return getPurchaseOrder(db, poId);
  const externalOrderId = optionalString(payload.externalOrderId || payload.orderId || payload.tradeId);
  const row = findPurchaseOrderByExternalOrderId(db, externalOrderId);
  if (!row) throw new Error("purchase order or externalOrderId is required");
  return row;
}

function build1688RefundOrderParams(payload = {}, po = {}) {
  const externalOrderId = requireString(
    payload.externalOrderId || payload.orderId || payload.tradeId || po.external_order_id,
    "externalOrderId",
  );
  return raw1688Params(payload, {
    orderId: externalOrderId,
    tradeId: externalOrderId,
    webSite: optionalString(payload.webSite) || "1688",
    refundStatus: optionalString(payload.refundStatus || payload.status) || undefined,
    page: optionalNumber(payload.page) || undefined,
    pageSize: optionalNumber(payload.pageSize) || undefined,
  });
}

function build1688RefundReasonParams(payload = {}, po = {}) {
  const externalOrderId = optionalString(payload.externalOrderId || payload.orderId || payload.tradeId || po.external_order_id);
  return structured1688InputParams(payload, {
    orderId: externalOrderId || undefined,
    tradeId: externalOrderId || undefined,
    refundType: optionalString(payload.refundType) || undefined,
    goodsStatus: optionalString(payload.goodsStatus) || undefined,
  });
}

function build1688CreateRefundParams(payload = {}, po = {}) {
  const externalOrderId = requireString(
    payload.externalOrderId || payload.orderId || payload.tradeId || po.external_order_id,
    "externalOrderId",
  );
  const amount = optionalNumber(payload.amount ?? payload.refundPayment ?? payload.applyPayment) ?? optionalNumber(po.total_amount);
  const carriageAmount = optionalNumber(
    payload.applyCarriage
      ?? payload.refundCarriage
      ?? payload.carriage
      ?? payload.freight
      ?? payload.shippingFee
      ?? payload.postFee,
  ) ?? 0;
  const orderEntryIds = infer1688OrderEntryIds(payload, po);
  const refundReasonId = optionalString(payload.refundReasonId || payload.reasonId || payload.refund_reason_id);
  // 1688 createRefund 把 orderId 当顶层 Long 参数校验，必须放在 input 外面；
  // 其余字段保留在 input 包装里，跟 SDK 文档示例一致。
  const structured = structured1688InputParams(payload, {
    orderId: externalOrderId,
    tradeId: externalOrderId,
    orderEntryIds: orderEntryIds.length ? orderEntryIds : undefined,
    orderEntryIdList: orderEntryIds.length ? orderEntryIds : undefined,
    refundPayment: amount,
    applyPayment: amount,
    applyCarriage: carriageAmount,
    refundReasonId: refundReasonId || undefined,
    reasonId: refundReasonId || undefined,
    refundReason: optionalString(payload.reason || payload.refundReason),
    reason: optionalString(payload.reason || payload.refundReason),
    description: optionalString(payload.description || payload.remark),
    goodsStatus: optionalString(payload.goodsStatus) || "received",
    refundType: optionalString(payload.refundType) || "refund",
    voucherIds: Array.isArray(payload.voucherIds) ? payload.voucherIds : undefined,
  });
  // 1688 createRefund 顶层校验的 String 参数：disputeRequest（退款类型）、goodsStatus（货物状态）。
  // 跟 input 里的同名字段一致，但必须在顶层重复一份才过 ACL。
  const disputeRequest = optionalString(payload.disputeRequest || payload.refundType) || "refund";
  const goodsStatus = optionalString(payload.goodsStatus) || "received";
  // 1688 资金类字段顶层用 Long 单位 = 分（RMB cents）。amount 是元（可带小数 6.5），
  // 这里 ×100 取整再交给顶层；input 包装内保留元单位（1688 内部处理 BigDecimal）。
  const applyPaymentCents = Number.isFinite(amount) ? Math.round(amount * 100) : null;
  const applyCarriageCents = Math.round(carriageAmount * 100);
  return {
    orderId: externalOrderId,
    // orderEntryIds 顶层（Long[] ACL 校验）+ input 内一份。
    ...(orderEntryIds.length ? { orderEntryIds } : {}),
    disputeRequest,
    goodsStatus,
    ...(applyPaymentCents !== null ? { applyPayment: applyPaymentCents, refundPayment: applyPaymentCents } : {}),
    applyCarriage: applyCarriageCents,
    ...structured,
  };
}

function build1688RefundIdParams(payload = {}, po = {}) {
  const refundId = requireString(payload.refundId || payload.refund_id || payload.id, "refundId");
  return raw1688Params(payload, {
    refundId,
    orderId: optionalString(payload.externalOrderId || payload.orderId || po.external_order_id) || undefined,
    webSite: optionalString(payload.webSite) || "1688",
  });
}

function build1688ReturnGoodsParams(payload = {}, po = {}) {
  const refundId = requireString(payload.refundId || payload.refund_id || payload.id, "refundId");
  return raw1688Params(payload, {
    refundId,
    orderId: optionalString(payload.externalOrderId || payload.orderId || po.external_order_id) || undefined,
    logisticsCompanyNo: optionalString(payload.logisticsCompanyNo || payload.companyNo),
    logisticsBillNo: optionalString(payload.logisticsBillNo || payload.trackingNo || payload.mailNo),
    description: optionalString(payload.description || payload.remark),
  });
}

function upsert1688RefundRow(db, { po = {}, refund = {}, actor = {}, operationLog = null } = {}) {
  const now = nowIso();
  const refundId = optionalString(refund.refundId || refund.refund_id);
  const existing = refundId
    ? db.prepare("SELECT * FROM erp_1688_refunds WHERE refund_id = ?").get(refundId)
    : null;
  const row = {
    id: existing?.id || createId("1688_refund"),
    account_id: optionalString(po.account_id || refund.accountId || refund.account_id),
    po_id: optionalString(po.id || refund.poId || refund.po_id),
    external_order_id: optionalString(refund.externalOrderId || refund.external_order_id || po.external_order_id),
    refund_id: refundId,
    refund_status: optionalString(refund.status || refund.refundStatus || refund.refund_status),
    refund_type: optionalString(refund.refundType || refund.refund_type),
    refund_reason: optionalString(refund.reason || refund.refundReason || refund.refund_reason),
    refund_amount: optionalNumber(refund.amount ?? refund.refundAmount ?? refund.refundPayment),
    currency: optionalString(refund.currency) || "CNY",
    raw_payload_json: trimJsonForStorage(refund.raw || refund),
    operation_log_json: trimJsonForStorage(operationLog || parseJsonArray(existing?.operation_log_json)),
    created_by: optionalString(existing?.created_by || actor.id),
    created_at: existing?.created_at || now,
    updated_at: now,
    synced_at: now,
  };
  db.prepare(`
    INSERT INTO erp_1688_refunds (
      id, account_id, po_id, external_order_id, refund_id, refund_status,
      refund_type, refund_reason, refund_amount, currency, raw_payload_json,
      operation_log_json, created_by, created_at, updated_at, synced_at
    )
    VALUES (
      @id, @account_id, @po_id, @external_order_id, @refund_id, @refund_status,
      @refund_type, @refund_reason, @refund_amount, @currency, @raw_payload_json,
      @operation_log_json, @created_by, @created_at, @updated_at, @synced_at
    )
    ON CONFLICT(refund_id) DO UPDATE SET
      account_id = COALESCE(excluded.account_id, account_id),
      po_id = COALESCE(excluded.po_id, po_id),
      external_order_id = COALESCE(excluded.external_order_id, external_order_id),
      refund_status = COALESCE(excluded.refund_status, refund_status),
      refund_type = COALESCE(excluded.refund_type, refund_type),
      refund_reason = COALESCE(excluded.refund_reason, refund_reason),
      refund_amount = COALESCE(excluded.refund_amount, refund_amount),
      currency = COALESCE(excluded.currency, currency),
      raw_payload_json = excluded.raw_payload_json,
      operation_log_json = excluded.operation_log_json,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
  `).run(row);
  return db.prepare("SELECT * FROM erp_1688_refunds WHERE id = ?").get(row.id)
    || (refundId ? db.prepare("SELECT * FROM erp_1688_refunds WHERE refund_id = ?").get(refundId) : null)
    || row;
}

function markPurchaseOrderRefundSynced({ db, services, po, actor, externalStatus = "refund_synced", paymentStatus = "partial_refund" }) {
  const before = getPurchaseOrder(db, po.id);
  const now = nowIso();
  db.prepare(`
    UPDATE erp_purchase_orders
    SET external_order_status = @external_order_status,
        payment_status = @payment_status,
        external_order_synced_at = @external_order_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: before.id,
    external_order_status: externalStatus,
    payment_status: paymentStatus || before.payment_status,
    external_order_synced_at: now,
    updated_at: now,
  });
  const after = getPurchaseOrder(db, before.id);
  services.workflow.writeAudit({
    accountId: after.account_id || before.account_id,
    actor,
    action: "sync_1688_refund_status",
    entityType: "purchase_order",
    entityId: before.id,
    before,
    after,
  });
  if (after.pr_id) {
    writePurchaseRequestEvent(db, getPurchaseRequest(db, after.pr_id), actor, "sync_1688_refund_status", "1688 退款售后状态已同步");
  }
  return after;
}

async function get1688RefundReasonsAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund reasons");
  const po = payload.poId || payload.id || payload.externalOrderId ? getPurchaseOrderFor1688Action(db, payload) : {};
  const params = build1688RefundReasonParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.REFUND_REASON_LIST.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || po.account_id),
    action: "get_1688_refund_reasons",
    api: PROCUREMENT_APIS.REFUND_REASON_LIST,
    params,
  });
  const refundReasons = normalize1688RefundReasons(rawResponse);
  return { apiKey: PROCUREMENT_APIS.REFUND_REASON_LIST.key, query: params, refundReasons, rawResponse };
}

async function get1688MaxRefundFeeAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 max refund fee");
  const po = getPurchaseOrderFor1688Action(db, payload);
  const orderEntryIds = infer1688OrderEntryIds(payload, po);
  const params = structured1688InputParams(payload, {
    orderId: requireString(payload.externalOrderId || payload.orderId || po.external_order_id, "externalOrderId"),
    orderEntryIds: orderEntryIds.length ? orderEntryIds : undefined,
  });
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.MAX_REFUND_FEE.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "get_1688_max_refund_fee",
    api: PROCUREMENT_APIS.MAX_REFUND_FEE,
    params,
  });
  const maxRefundFee = normalize1688MaxRefundFee(rawResponse);
  return { apiKey: PROCUREMENT_APIS.MAX_REFUND_FEE.key, query: params, maxRefundFee, rawResponse };
}

async function upload1688RefundVoucherAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund voucher upload");
  const params = raw1688Params(payload, {
    voucher: payload.voucher,
    imageBase64: payload.imageBase64,
    fileName: optionalString(payload.fileName),
  });
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.REFUND_VOUCHER_UPLOAD.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId),
    action: "upload_1688_refund_voucher",
    api: PROCUREMENT_APIS.REFUND_VOUCHER_UPLOAD,
    params,
  });
  return { apiKey: PROCUREMENT_APIS.REFUND_VOUCHER_UPLOAD.key, query: params, rawResponse };
}

async function create1688RefundAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund create");
  const po = getPurchaseOrderFor1688Action(db, payload);
  const params = build1688CreateRefundParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.CREATE_REFUND.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "create_1688_refund",
    api: PROCUREMENT_APIS.CREATE_REFUND,
    params,
  });
  const refunds = normalize1688RefundListResponse(rawResponse);
  const savedRefunds = (refunds.length ? refunds : [{
    externalOrderId: po.external_order_id,
    status: "created",
    reason: params.input?.refundReason || params.input?.reason,
    amount: params.input?.refundPayment || params.input?.applyPayment,
    raw: rawResponse,
  }]).map((refund) => upsert1688RefundRow(db, { po, refund, actor }));
  const purchaseOrder = markPurchaseOrderRefundSynced({
    db,
    services,
    po,
    actor,
    externalStatus: "refund_requested",
    paymentStatus: "partial_refund",
  });
  return {
    apiKey: PROCUREMENT_APIS.CREATE_REFUND.key,
    query: params,
    refunds: savedRefunds.map(toCamelRow),
    purchaseOrder: toCamelRow(purchaseOrder),
    rawResponse,
  };
}

async function sync1688RefundsAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund sync");
  const po = getPurchaseOrderFor1688Action(db, payload);
  const params = build1688RefundOrderParams(payload, po);
  const api = payload.byOrderDetail ? PROCUREMENT_APIS.REFUND_BY_ORDER : PROCUREMENT_APIS.REFUND_LIST;
  if (payload.dryRun) return { dryRun: true, apiKey: api.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "sync_1688_refunds",
    api,
    params,
  });
  const refunds = normalize1688RefundListResponse(rawResponse);
  const savedRefunds = refunds.map((refund) => upsert1688RefundRow(db, { po, refund, actor }));
  const purchaseOrder = refunds.length
    ? markPurchaseOrderRefundSynced({ db, services, po, actor })
    : getPurchaseOrder(db, po.id);
  return {
    apiKey: api.key,
    query: params,
    refunds: savedRefunds.map(toCamelRow),
    refundCount: savedRefunds.length,
    purchaseOrder: toCamelRow(purchaseOrder),
    rawResponse,
  };
}

async function sync1688RefundDetailAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund detail");
  const po = payload.poId || payload.externalOrderId ? getPurchaseOrderFor1688Action(db, payload) : {};
  const params = build1688RefundIdParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.REFUND_DETAIL.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || po.account_id),
    action: "sync_1688_refund_detail",
    api: PROCUREMENT_APIS.REFUND_DETAIL,
    params,
  });
  const refunds = normalize1688RefundListResponse(rawResponse);
  const savedRefunds = (refunds.length ? refunds : [{ refundId: params.refundId, raw: rawResponse }])
    .map((refund) => upsert1688RefundRow(db, { po, refund, actor }));
  if (po.id && savedRefunds.length) markPurchaseOrderRefundSynced({ db, services, po, actor });
  return { apiKey: PROCUREMENT_APIS.REFUND_DETAIL.key, query: params, refunds: savedRefunds.map(toCamelRow), rawResponse };
}

async function sync1688RefundOperationsAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund operations");
  const po = payload.poId || payload.externalOrderId ? getPurchaseOrderFor1688Action(db, payload) : {};
  const params = build1688RefundIdParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.REFUND_OPERATION_LIST.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || po.account_id),
    action: "sync_1688_refund_operations",
    api: PROCUREMENT_APIS.REFUND_OPERATION_LIST,
    params,
  });
  const refund = upsert1688RefundRow(db, {
    po,
    refund: { refundId: params.refundId, raw: rawResponse },
    actor,
    operationLog: rawResponse,
  });
  return { apiKey: PROCUREMENT_APIS.REFUND_OPERATION_LIST.key, query: params, refund: toCamelRow(refund), rawResponse };
}

async function submit1688ReturnGoodsAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 refund return goods");
  const po = payload.poId || payload.externalOrderId ? getPurchaseOrderFor1688Action(db, payload) : {};
  const params = build1688ReturnGoodsParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.REFUND_RETURN_GOODS.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || po.account_id),
    action: "submit_1688_return_goods",
    api: PROCUREMENT_APIS.REFUND_RETURN_GOODS,
    params,
  });
  const refund = upsert1688RefundRow(db, {
    po,
    refund: {
      refundId: params.refundId,
      externalOrderId: params.orderId,
      status: "return_goods_submitted",
      raw: rawResponse,
    },
    actor,
  });
  if (po.id) markPurchaseOrderRefundSynced({ db, services, po, actor, externalStatus: "refund_return_goods_submitted" });
  return { apiKey: PROCUREMENT_APIS.REFUND_RETURN_GOODS.key, query: params, refund: toCamelRow(refund), rawResponse };
}

async function list1688OfflineLogisticsCompaniesAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 offline logistics companies");
  const params = raw1688Params(payload, {
    keyword: optionalString(payload.keyword),
  });
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.OFFLINE_LOGISTIC_COMPANY_LIST.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId),
    action: "list_1688_offline_logistics_companies",
    api: PROCUREMENT_APIS.OFFLINE_LOGISTIC_COMPANY_LIST,
    params,
  });
  return { apiKey: PROCUREMENT_APIS.OFFLINE_LOGISTIC_COMPANY_LIST.key, query: params, rawResponse };
}

function build1688OrderIdParams(payload = {}, po = {}) {
  const orderId = requireString(
    payload.externalOrderId
      || payload.orderId
      || payload.tradeId
      || po.external_order_id
      || po.externalOrderId,
    "1688 orderId",
  );
  return {
    webSite: Number(optionalNumber(payload.webSite) ?? 1688),
    orderId,
  };
}

function build1688CancelOrderParams(payload = {}, po = {}) {
  const orderId = build1688OrderIdParams(payload, po).orderId;
  return {
    webSite: Number(optionalNumber(payload.webSite) ?? 1688),
    tradeID: orderId,
    cancelReason: optionalString(payload.cancelReason) || "other",
    remark: optionalString(payload.remark) || "ERP取消未付款1688订单",
  };
}

function build1688PaymentUrlParams(payload = {}, orderIds = []) {
  const ids = orderIds.map((item) => optionalString(item)).filter(Boolean);
  if (!ids.length) throw new Error("请先选择至少一个已绑定的 1688 订单");
  const params = { orderIdList: ids };
  for (const key of ["payChannel", "payWay", "returnUrl", "buyerLoginId"]) {
    const value = optionalString(payload[key]);
    if (value) params[key] = value;
  }
  return raw1688Params(payload, params);
}

function extract1688PaymentUrl(rawResponse = {}) {
  return optionalString(findFirstDeepValue(asExpandedObject(rawResponse), [
    "payUrl",
    "paymentUrl",
    "alipayUrl",
    "cashierUrl",
    "redirectUrl",
    "url",
  ]));
}

function findFirstDeepRawValue(value, keys = [], depth = 0) {
  if (!value || depth > 8) return null;
  const keySet = new Set(keys.map((key) => String(key).toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstDeepRawValue(item, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, next] of Object.entries(value)) {
    if (keySet.has(String(key).toLowerCase()) && next !== null && next !== undefined && next !== "") {
      return next;
    }
  }
  for (const next of Object.values(value)) {
    const found = findFirstDeepRawValue(next, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function normalize1688OrderIdList(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.map((item) => optionalString(item)).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (/^\[.*\]$/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((item) => optionalString(item)).filter(Boolean);
      } catch {
        // Fall through to delimiter parsing.
      }
    }
    return trimmed.split(/[,\s]+/).map((item) => optionalString(item)).filter(Boolean);
  }
  return [optionalString(value)].filter(Boolean);
}

function extract1688PaymentFailureOrderIds(rawResponse = {}) {
  return normalize1688OrderIdList(findFirstDeepRawValue(asExpandedObject(rawResponse), [
    "payFailureOrderList",
    "pay_failure_order_list",
    "failureOrderList",
    "failedOrderIds",
  ]));
}

function map1688StatusToLocal(status, currentStatus, logistics = {}) {
  const text = String(status || "").toUpperCase();
  const current = optionalString(currentStatus);
  if (["closed", "cancelled", "inbounded"].includes(current)) return null;
  if (/CANCEL|TERMINATED|CLOSE/.test(text)) return "cancelled";
  if (logistics.signed) return "arrived";
  if (/CONFIRM_?RECEIVE|RECEIVEGOODS|RECEIVED|SIGNED/.test(text)) return "arrived";
  if (/WAIT_?BUYER_?RECEIVE|SELLER_?SEND|SHIPPED|SENDGOODS/.test(text) || logistics.shipped) return "shipped";
  if (/WAIT_?SELLER_?SEND|PAID|PAYED|WAIT_?SELLER_?DELIVER|SUCCESS/.test(text)) return "paid";
  if (/WAIT_?BUYER_?PAY|UNPAID|CREATED|PREVIEW/.test(text)) {
    return current === "draft" ? "pushed_pending_price" : null;
  }
  return null;
}

function map1688StatusToPaymentStatus(status, currentPaymentStatus) {
  const text = String(status || "").toUpperCase();
  if (/WAIT_?SELLER_?SEND|WAIT_?BUYER_?RECEIVE|PAID|PAYED|SUCCESS|SELLER_?SEND|SHIPPED/.test(text)) return "paid";
  return null;
}

function updatePurchaseOrderFrom1688Snapshot({
  db,
  services,
  po,
  order = {},
  logistics = null,
  paymentUrl = null,
  rawDetail = null,
  rawLogistics = null,
  rawPayment = null,
  action,
  actor,
  forceCancel = false,
}) {
  const before = getPurchaseOrder(db, po.id);
  const now = nowIso();
  const nextStatus = forceCancel ? "cancelled" : map1688StatusToLocal(order.status, before.status, logistics || {});
  const nextPaymentStatus = map1688StatusToPaymentStatus(order.status, before.payment_status);
  const rawDetailRoot = rawDetail?.result || rawDetail || {};
  const rawDetailBaseInfo = rawDetailRoot.baseInfo || rawDetailRoot;
  const snapshotFreight = optionalNumber(
    order.freight
      ?? order.freightAmount
      ?? order.shippingFee
      ?? rawDetailBaseInfo?.shippingFee
      ?? rawDetailBaseInfo?.postFee
      ?? before.freight_amount,
  );
  const snapshotPaidAmount = optionalNumber(order.totalAmount);
  const money = snapshotPaidAmount === null
    ? { goodsAmount: null, paidAmount: null, freightAmount: snapshotFreight }
    : splitOrderMoney(snapshotPaidAmount, snapshotFreight, before.total_amount);
  const payloadJson = {
    ...(parseJsonObject(before.external_order_payload_json) || {}),
    ...(rawPayment ? { payment: rawPayment } : {}),
    ...(paymentUrl ? { paymentUrl } : {}),
    ...(rawDetail ? { lastDetail: rawDetail } : {}),
    ...(rawLogistics ? { logistics: rawLogistics } : {}),
  };
  db.prepare(`
    UPDATE erp_purchase_orders
    SET status = @status,
        payment_status = @payment_status,
        total_amount = COALESCE(@total_amount, total_amount),
        paid_amount = COALESCE(@paid_amount, paid_amount),
        freight_amount = COALESCE(@freight_amount, freight_amount),
        external_order_id = COALESCE(@external_order_id, external_order_id),
        external_order_status = COALESCE(@external_order_status, external_order_status),
        external_order_payload_json = @external_order_payload_json,
        external_order_synced_at = @external_order_synced_at,
        external_payment_url = COALESCE(@external_payment_url, external_payment_url),
        external_payment_url_synced_at = COALESCE(@external_payment_url_synced_at, external_payment_url_synced_at),
        external_order_detail_json = COALESCE(@external_order_detail_json, external_order_detail_json),
        external_order_detail_synced_at = COALESCE(@external_order_detail_synced_at, external_order_detail_synced_at),
        external_logistics_json = COALESCE(@external_logistics_json, external_logistics_json),
        external_logistics_synced_at = COALESCE(@external_logistics_synced_at, external_logistics_synced_at),
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: before.id,
    status: nextStatus || before.status,
    payment_status: nextPaymentStatus || before.payment_status,
    total_amount: money.goodsAmount,
    paid_amount: money.paidAmount,
    freight_amount: money.freightAmount,
    external_order_id: optionalString(order.externalOrderId),
    external_order_status: forceCancel ? "cancelled" : optionalString(order.status),
    external_order_payload_json: trimJsonForStorage(payloadJson),
    external_order_synced_at: now,
    external_payment_url: paymentUrl,
    external_payment_url_synced_at: paymentUrl ? now : null,
    // rawDetail 来自不同 action：fetch_1688_order_detail 是完整订单详情（含 productItems），
    // 而 add_memo/add_feedback 等只带某次操作的 snapshot。直接覆盖会把订单详情擦掉，
    // 后续 createRefund 取不到 orderEntryIds。这里改成合并：保留旧字段，新字段覆盖同名键。
    external_order_detail_json: rawDetail
      ? trimJsonForStorage({
          ...(parseJsonObject(before.external_order_detail_json) || {}),
          ...rawDetail,
        })
      : null,
    external_order_detail_synced_at: rawDetail ? now : null,
    external_logistics_json: rawLogistics ? trimJsonForStorage(rawLogistics) : null,
    external_logistics_synced_at: rawLogistics ? now : null,
    updated_at: now,
  });
  const after = getPurchaseOrder(db, before.id);
  services.workflow.writeAudit({
    accountId: before.account_id,
    actor,
    action,
    entityType: "purchase_order",
    entityId: before.id,
    before,
    after,
  });
  if (before.pr_id) {
    const eventText = action === "get_1688_payment_url"
      ? "1688 支付链接已同步"
      : action === "sync_1688_logistics"
        ? "1688 物流信息已同步"
        : action === "cancel_1688_order"
          ? "1688 订单已取消"
          : "1688 订单详情已同步";
    writePurchaseRequestEvent(db, getPurchaseRequest(db, before.pr_id), actor, action, eventText);
    markPurchaseRequestRead(db, before.pr_id, actor);
  }
  return after;
}

async function fetch1688OrderDetailForPo({ db, services, po, payload, actor, action = "fetch_1688_order_detail" }) {
  const apiParams = build1688OrderIdParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.ORDER_DETAIL.key, params: apiParams };
  const rawResponse = payload.mockDetailResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action,
    api: PROCUREMENT_APIS.ORDER_DETAIL,
    params: apiParams,
  });
  const detail = normalize1688OrderDetailResponse(rawResponse, apiParams.orderId);
  const afterPo = po.id ? updatePurchaseOrderFrom1688Snapshot({
    db,
    services,
    po,
    order: detail,
    rawDetail: rawResponse,
    action,
    actor,
  }) : null;
  return {
    apiKey: PROCUREMENT_APIS.ORDER_DETAIL.key,
    query: apiParams,
    detail,
    purchaseOrder: afterPo ? toCamelRow(afterPo) : null,
    rawResponse,
  };
}

async function fetch1688OrderDetailAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin", "finance", "warehouse"], "1688 订单详情同步");
  const po = getPurchaseOrder(db, requireString(payload.poId || payload.id, "poId"));
  return fetch1688OrderDetailForPo({ db, services, po, payload, actor });
}

async function sync1688LogisticsAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin", "warehouse"], "1688 物流同步");
  const po = getPurchaseOrder(db, requireString(payload.poId || payload.id, "poId"));
  const apiParams = build1688OrderIdParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.LOGISTICS_INFO.key, params: apiParams };
  const rawResponse = payload.mockLogisticsResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "sync_1688_logistics",
    api: PROCUREMENT_APIS.LOGISTICS_INFO,
    params: apiParams,
  });
  const logistics = normalize1688LogisticsResponse(rawResponse, apiParams.orderId);
  let traceResponse = null;
  if (payload.includeTrace !== false) {
    try {
      traceResponse = payload.mockTraceResponse || await call1688ProcurementApi({
        db,
        actor,
        accountId: po.account_id,
        action: "sync_1688_logistics_trace",
        api: PROCUREMENT_APIS.LOGISTICS_TRACE,
        params: apiParams,
      });
      const trace = normalize1688LogisticsResponse(traceResponse, apiParams.orderId);
      logistics.traceItems = trace.traceItems.length ? trace.traceItems : logistics.traceItems;
      logistics.signed = logistics.signed || trace.signed;
      logistics.shipped = logistics.shipped || trace.shipped;
      logistics.status = logistics.signed ? "signed" : logistics.status;
    } catch (error) {
      logistics.traceError = error?.message || String(error);
    }
  }
  const afterPo = updatePurchaseOrderFrom1688Snapshot({
    db,
    services,
    po,
    order: { externalOrderId: apiParams.orderId, status: logistics.status },
    logistics,
    rawLogistics: { info: rawResponse, trace: traceResponse },
    action: "sync_1688_logistics",
    actor,
  });
  return {
    apiKey: PROCUREMENT_APIS.LOGISTICS_INFO.key,
    query: apiParams,
    logistics,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
    traceResponse,
  };
}

function getPurchaseOrdersForPayment(db, payload = {}) {
  const poIds = [
    ...(Array.isArray(payload.poIds) ? payload.poIds : []),
    payload.poId || payload.id,
  ].map((item) => optionalString(item)).filter(Boolean);
  if (!poIds.length) return [];
  const placeholders = poIds.map(() => "?").join(", ");
  return db.prepare(`SELECT * FROM erp_purchase_orders WHERE id IN (${placeholders})`).all(poIds);
}

function get1688PaymentErrorText(error) {
  const payload = error?.payload || error?.response || {};
  return optionalString(firstDefinedValue(
    error?.message,
    payload.erroMsg,
    payload.errorMsg,
    payload.error_msg,
    payload.errorMessage,
    payload.message,
    payload.msg,
    payload.error,
  )) || String(error || "");
}

function isRecoverable1688BatchPaymentError(error) {
  const text = get1688PaymentErrorText(error);
  return /订单不存在|不是待支付|待支付状态|待付款|createAliPayUrl|ORDER_NOT_PAY|ORDER_HAS_PAID|已付款|已取消|无权限/i.test(text);
}

async function request1688PaymentUrl({ db, payload, actor, accountId, orderIds }) {
  const apiParams = build1688PaymentUrlParams(payload, orderIds);
  const rawResponse = payload.mockPaymentResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId,
    action: "get_1688_payment_url",
    api: PROCUREMENT_APIS.PAYMENT_URL,
    params: apiParams,
    purchase1688AccountId: optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id),
  });
  const paymentUrl = extract1688PaymentUrl(rawResponse);
  if (!paymentUrl) {
    const error = new Error("1688 没有返回支付链接，请检查订单是否待付款");
    error.payload = rawResponse;
    error.requestParams = apiParams;
    throw error;
  }
  return {
    apiParams,
    rawResponse,
    paymentUrl,
    payFailureOrderIds: extract1688PaymentFailureOrderIds(rawResponse),
  };
}

async function recover1688PaymentUrlBySingleOrders({ db, payload, actor, accountId, orderIds }) {
  const attempts = [];
  for (const orderId of orderIds) {
    try {
      const result = await request1688PaymentUrl({
        db,
        payload,
        actor,
        accountId,
        orderIds: [orderId],
      });
      attempts.push({
        orderId,
        ok: true,
        paymentUrl: result.paymentUrl,
        rawResponse: result.rawResponse,
      });
    } catch (error) {
      attempts.push({
        orderId,
        ok: false,
        error: get1688PaymentErrorText(error),
        errorCode: optionalString(error?.errorCode || error?.payload?.errorCode || error?.payload?.error_code || error?.payload?.code),
      });
    }
  }

  const payableAttempts = attempts.filter((item) => item.ok && item.paymentUrl);
  if (!payableAttempts.length) {
    const failureText = attempts
      .map((item) => `${item.orderId}: ${item.error || "不可付款"}`)
      .join("; ");
    const error = new Error(`1688 没有可付款订单。${failureText}`);
    error.partialPaymentFailures = attempts;
    throw error;
  }

  const payableOrderIds = payableAttempts.map((item) => item.orderId);
  if (payableOrderIds.length > 1) {
    try {
      const grouped = await request1688PaymentUrl({
        db,
        payload,
        actor,
        accountId,
        orderIds: payableOrderIds,
      });
      return {
        ...grouped,
        paymentUrlSource: "batch_partial",
        payableOrderIds,
        paymentUrls: payableAttempts.map((item) => ({ orderId: item.orderId, paymentUrl: item.paymentUrl })),
        partialPaymentFailures: attempts.filter((item) => !item.ok),
      };
    } catch (error) {
      return {
        apiParams: build1688PaymentUrlParams(payload, payableOrderIds),
        rawResponse: {
          singleOrderPaymentAttempts: attempts,
          groupedPaymentError: get1688PaymentErrorText(error),
        },
        paymentUrl: payableAttempts[0].paymentUrl,
        paymentUrlSource: "individual",
        payableOrderIds,
        paymentUrls: payableAttempts.map((item) => ({ orderId: item.orderId, paymentUrl: item.paymentUrl })),
        partialPaymentFailures: attempts.filter((item) => !item.ok),
      };
    }
  }

  return {
    apiParams: build1688PaymentUrlParams(payload, payableOrderIds),
    rawResponse: payableAttempts[0].rawResponse,
    paymentUrl: payableAttempts[0].paymentUrl,
    paymentUrlSource: "individual",
    payableOrderIds,
    paymentUrls: payableAttempts.map((item) => ({ orderId: item.orderId, paymentUrl: item.paymentUrl })),
    partialPaymentFailures: attempts.filter((item) => !item.ok),
  };
}

async function get1688PaymentUrlAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["finance", "manager", "admin", "buyer"], "1688 支付链接");
  const purchaseOrders = getPurchaseOrdersForPayment(db, payload);
  const orderIds = Array.from(new Set([
    ...purchaseOrders.map((po) => po.external_order_id),
    ...(Array.isArray(payload.externalOrderIds) ? payload.externalOrderIds : []),
    payload.externalOrderId || payload.orderId,
  ].map((item) => optionalString(item)).filter(Boolean)));
  const apiParams = build1688PaymentUrlParams(payload, orderIds);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.PAYMENT_URL.key, params: apiParams };
  const accountId = purchaseOrders[0]?.account_id || optionalString(payload.accountId);
  let paymentResult;
  try {
    paymentResult = await request1688PaymentUrl({ db, payload, actor, accountId, orderIds });
  } catch (error) {
    if (orderIds.length <= 1 || !isRecoverable1688BatchPaymentError(error)) throw error;
    paymentResult = await recover1688PaymentUrlBySingleOrders({ db, payload, actor, accountId, orderIds });
  }
  const paymentUrl = paymentResult.paymentUrl;
  const payFailureOrderIds = Array.isArray(paymentResult.payFailureOrderIds) ? paymentResult.payFailureOrderIds : [];
  const payFailureOrderIdSet = new Set(payFailureOrderIds);
  const payableOrderIds = Array.isArray(paymentResult.payableOrderIds) && paymentResult.payableOrderIds.length
    ? paymentResult.payableOrderIds
    : (payFailureOrderIdSet.size ? orderIds.filter((orderId) => !payFailureOrderIdSet.has(orderId)) : orderIds);
  if (!payableOrderIds.length) throw new Error("1688 没有可付款订单，请检查订单是否待付款");
  const officialPartialFailures = payFailureOrderIds.map((orderId) => ({
    orderId,
    ok: false,
    error: "1688 返回该订单未生成支付链接",
  }));
  const partialPaymentFailures = [
    ...(paymentResult.partialPaymentFailures || []),
    ...officialPartialFailures.filter((failure) => !(
      paymentResult.partialPaymentFailures || []
    ).some((item) => String(item.orderId) === String(failure.orderId))),
  ];
  const updated = purchaseOrders
    .filter((po) => payableOrderIds.includes(String(po.external_order_id || "")))
    .map((po) => updatePurchaseOrderFrom1688Snapshot({
      db,
      services,
      po,
      order: { externalOrderId: po.external_order_id, status: po.external_order_status },
      paymentUrl,
      rawPayment: paymentResult.rawResponse,
      action: "get_1688_payment_url",
      actor,
    }));
  return {
    apiKey: PROCUREMENT_APIS.PAYMENT_URL.key,
    query: paymentResult.apiParams,
    paymentUrl,
    paymentUrlSource: paymentResult.paymentUrlSource || "batch",
    paymentUrls: paymentResult.paymentUrls || [],
    partialPaymentFailures,
    externalOrderIds: orderIds,
    payableOrderIds,
    purchaseOrders: updated.map(toCamelRow),
    rawResponse: paymentResult.rawResponse,
  };
}

// 1688 表示订单不存在/找不到的错误码集合。命中这些错误码时，
// 取消操作不算失败，按"远端已经没了"处理：本地强制清绑 + 置取消。
const ALIBABA_1688_ORDER_GONE_ERROR_CODES = [
  "ORDER_NOT_EXIST",
  "ORDER_NOT_FOUND",
  "ORDER_HAS_CANCELED",
  "ORDER_HAS_CANCELLED",
  "ORDER_NOT_FIND",
];

function is1688OrderGoneError(error) {
  const message = String(error?.message || error || "");
  const code = String(error?.errorCode || error?.payload?.error_code || error?.payload?.errorCode || "");
  if (ALIBABA_1688_ORDER_GONE_ERROR_CODES.includes(code)) return true;
  for (const c of ALIBABA_1688_ORDER_GONE_ERROR_CODES) {
    if (message.includes(`errorCode:${c}`) || message.includes(`"errorCode":"${c}"`) || message.includes(c)) return true;
  }
  if (/无法根据订单ID获取订单|订单不存在|订单已取消|订单已经取消|该订单已经取消|订单已关闭/.test(message)) return true;
  return false;
}

async function cancel1688OrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "取消 1688 订单");
  const po = getPurchaseOrder(db, requireString(payload.poId || payload.id, "poId"));
  const apiParams = build1688CancelOrderParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.CANCEL_ORDER.key, params: apiParams };
  let rawResponse;
  let remoteAlreadyGone = false;
  try {
    rawResponse = payload.mockCancelResponse || payload.mockResponse || await call1688ProcurementApi({
      db,
      actor,
      accountId: po.account_id,
      action: "cancel_1688_order",
      api: PROCUREMENT_APIS.CANCEL_ORDER,
      params: apiParams,
    });
  } catch (error) {
    if (!is1688OrderGoneError(error)) throw error;
    // 远端早就不在了：把这次"取消失败"当成"远端已不存在"，本地强制清掉。
    remoteAlreadyGone = true;
    rawResponse = {
      orphanCleared: true,
      reason: "remote_order_not_exist",
      remoteError: {
        message: error?.message || String(error),
        errorCode: error?.errorCode || null,
        payload: error?.payload || null,
      },
      at: nowIso(),
    };
  }
  const afterPo = updatePurchaseOrderFrom1688Snapshot({
    db,
    services,
    po,
    order: {
      externalOrderId: apiParams.tradeID,
      status: remoteAlreadyGone ? "orphan_cleared" : "cancelled",
    },
    rawDetail: { cancel: rawResponse },
    action: "cancel_1688_order",
    actor,
    forceCancel: true,
  });
  return {
    apiKey: PROCUREMENT_APIS.CANCEL_ORDER.key,
    query: apiParams,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
    orphanCleared: remoteAlreadyGone,
  };
}

function build1688OrderMemoParams(payload = {}, po = {}) {
  const orderId = build1688OrderIdParams(payload, po).orderId;
  const remark = requireString(payload.memo || payload.remark || payload.message, "memo");
  const tradeMemoParam = {
    webSite: Number(optionalNumber(payload.webSite) ?? 1688),
    orderId,
    remark,
  };
  const remarkIcon = optionalString(payload.remarkIcon || payload.icon);
  if (remarkIcon) tradeMemoParam.remarkIcon = remarkIcon;
  // 1688 trade APIs 要求 orderId 在顶层做 Long 类型 ACL 校验，
  // 同时复合对象 tradeMemoParam 给业务字段使用。两处都要带。
  return raw1688Params(payload, { orderId, tradeMemoParam });
}

function build1688OrderFeedbackParams(payload = {}, po = {}) {
  const orderId = build1688OrderIdParams(payload, po).orderId;
  const feedback = requireString(payload.feedback || payload.message || payload.remark, "feedback");
  const tradeFeedbackParam = {
    webSite: Number(optionalNumber(payload.webSite) ?? 1688),
    orderId,
    feedback,
  };
  // orderId 顶层 + 复合对象，跟 memo / createRefund 同模式。
  return raw1688Params(payload, { orderId, tradeFeedbackParam });
}

function build1688ConfirmReceiveGoodsParams(payload = {}, po = {}) {
  const orderId = build1688OrderIdParams(payload, po).orderId;
  const orderEntryIds = infer1688OrderEntryIds(payload, po);
  return raw1688Params(payload, {
    webSite: Number(optionalNumber(payload.webSite) ?? 1688),
    orderId,
    // 1688 confirmReceiveGoods 顶层也要 orderEntryIds (Long[])。
    ...(orderEntryIds.length ? { orderEntryIds } : {}),
  });
}

async function add1688OrderMemoAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 order memo");
  const po = getPurchaseOrderFor1688Action(db, payload);
  const params = build1688OrderMemoParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.ORDER_MEMO_ADD.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "add_1688_order_memo",
    api: PROCUREMENT_APIS.ORDER_MEMO_ADD,
    params,
  });
  const afterPo = updatePurchaseOrderFrom1688Snapshot({
    db,
    services,
    po,
    order: { externalOrderId: params.orderId, status: "memo_modified" },
    rawDetail: { orderMemo: { params, response: rawResponse, at: nowIso() } },
    action: "add_1688_order_memo",
    actor,
  });
  return {
    apiKey: PROCUREMENT_APIS.ORDER_MEMO_ADD.key,
    query: params,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
  };
}

async function add1688OrderFeedbackAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 order feedback");
  const po = getPurchaseOrderFor1688Action(db, payload);
  const params = build1688OrderFeedbackParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.ORDER_FEEDBACK_ADD.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "add_1688_order_feedback",
    api: PROCUREMENT_APIS.ORDER_FEEDBACK_ADD,
    params,
  });
  const afterPo = updatePurchaseOrderFrom1688Snapshot({
    db,
    services,
    po,
    order: { externalOrderId: params.orderId, status: "feedback_added" },
    rawDetail: { orderFeedback: { params, response: rawResponse, at: nowIso() } },
    action: "add_1688_order_feedback",
    actor,
  });
  return {
    apiKey: PROCUREMENT_APIS.ORDER_FEEDBACK_ADD.key,
    query: params,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
  };
}

async function confirm1688ReceiveGoodsAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin", "warehouse"], "1688 confirm receive goods");
  const po = getPurchaseOrderFor1688Action(db, payload);
  const params = build1688ConfirmReceiveGoodsParams(payload, po);
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.CONFIRM_RECEIVE_GOODS.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: po.account_id,
    action: "confirm_1688_receive_goods",
    api: PROCUREMENT_APIS.CONFIRM_RECEIVE_GOODS,
    params,
  });
  const afterPo = updatePurchaseOrderFrom1688Snapshot({
    db,
    services,
    po,
    order: { externalOrderId: params.orderId, status: "received" },
    rawDetail: { receiveGoods: { params, response: rawResponse, at: nowIso() } },
    action: "confirm_1688_receive_goods",
    actor,
  });
  return {
    apiKey: PROCUREMENT_APIS.CONFIRM_RECEIVE_GOODS.key,
    query: params,
    purchaseOrder: toCamelRow(afterPo),
    rawResponse,
  };
}

function findSku1688SourceForOrderLine(db, line = {}, accountId = null) {
  const productId = optionalString(line.productId || line.offerId || line.externalOfferId);
  if (!productId) return null;
  const rows = db.prepare(`
    SELECT source.*, sku.internal_sku_code, sku.product_name
    FROM erp_sku_1688_sources source
    JOIN erp_skus sku ON sku.id = source.sku_id
    WHERE source.status = 'active'
      AND source.external_offer_id = @external_offer_id
      ${accountId ? "AND source.account_id = @account_id" : ""}
    ORDER BY source.is_default DESC, source.updated_at DESC, source.created_at DESC
  `).all({
    external_offer_id: productId,
    account_id: accountId,
  });
  const skuId = optionalString(line.skuId);
  const specId = optionalString(line.specId);
  return rows
    .map((row) => {
      let score = 0;
      if (skuId && row.external_sku_id === skuId) score += 20;
      if (specId && row.external_spec_id === specId) score += 20;
      if (!row.external_sku_id && !row.external_spec_id) score += 1;
      return { ...row, matchScore: score };
    })
    .sort((left, right) => right.matchScore - left.matchScore)[0] || null;
}

function buildPoNoFrom1688Order(db) {
  return buildPurchaseOrderNo(db);
}

function createPurchaseOrderFrom1688Order({ db, services, order, payload = {}, actor }) {
  const externalOrderId = requireString(order.externalOrderId || payload.externalOrderId, "externalOrderId");
  const existing = findPurchaseOrderByExternalOrderId(db, externalOrderId);
  if (existing) return { purchaseOrder: existing, created: false, reason: "exists" };
  const accountId = optionalString(payload.accountId || payload.account_id);
  const lines = Array.isArray(order.lines) ? order.lines : [];
  if (!lines.length) throw new Error(`1688订单 ${externalOrderId} 没有可识别商品明细，不能自动生成采购单`);
  const mappedLines = lines.map((line) => ({ line, source: findSku1688SourceForOrderLine(db, line, accountId) }));
  const missing = mappedLines.filter((item) => !item.source);
  if (missing.length && !payload.allowPartial) {
    throw new Error(`1688订单 ${externalOrderId} 有 ${missing.length} 个商品未匹配本地SKU，请先维护1688映射`);
  }
  const usableLines = mappedLines.filter((item) => item.source);
  if (!usableLines.length) throw new Error(`1688订单 ${externalOrderId} 没有匹配到本地SKU`);
  const finalAccountId = accountId || usableLines[0].source.account_id;
  const totalQty = usableLines.reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item.line.quantity || 1))), 0);
  const sourceGoodsAmount = usableLines.reduce((sum, item) => (
    sum + Math.max(1, Math.floor(Number(item.line.quantity || 1))) * Number(item.source.unit_price || 0)
  ), 0);
  const money = splitOrderMoney(order.totalAmount, order.freight, sourceGoodsAmount);
  const totalAmount = money.goodsAmount ?? sourceGoodsAmount;
  const paidAmount = money.paidAmount ?? roundMoney(totalAmount + money.freightAmount);
  const unitFallback = totalQty > 0 && totalAmount > 0 ? totalAmount / totalQty : 0;
  const now = nowIso();
  const po = {
    id: optionalString(payload.poId) || createId("po"),
    account_id: finalAccountId,
    pr_id: null,
    selected_candidate_id: null,
    supplier_id: null,
    po_no: optionalString(payload.poNo) || buildPoNoFrom1688Order(db),
    status: map1688StatusToLocal(order.status, "draft", {}) || "draft",
    payment_status: map1688StatusToPaymentStatus(order.status, "unpaid") || "unpaid",
    expected_delivery_date: null,
    actual_delivery_date: null,
    total_amount: totalAmount,
    paid_amount: paidAmount,
    freight_amount: money.freightAmount,
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
    external_order_id: externalOrderId,
    external_order_status: optionalString(order.status) || "imported",
    external_order_payload_json: trimJsonForStorage(order.raw || order),
    external_order_synced_at: now,
    external_order_detail_json: trimJsonForStorage(order.raw || order),
    external_order_detail_synced_at: now,
  };
  db.prepare(`
    INSERT INTO erp_purchase_orders (
      id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
      status, payment_status, expected_delivery_date, actual_delivery_date,
      total_amount, paid_amount, freight_amount, created_by, created_at, updated_at,
      external_order_id, external_order_status, external_order_payload_json,
      external_order_synced_at, external_order_detail_json, external_order_detail_synced_at
    )
    VALUES (
      @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
      @status, @payment_status, @expected_delivery_date, @actual_delivery_date,
      @total_amount, @paid_amount, @freight_amount, @created_by, @created_at, @updated_at,
      @external_order_id, @external_order_status, @external_order_payload_json,
      @external_order_synced_at, @external_order_detail_json, @external_order_detail_synced_at
    )
  `).run(po);
  const lineDrafts = usableLines.map((item) => {
    const qty = Math.max(1, Math.floor(Number(item.line.quantity || 1)));
    const unitCost = optionalNumber(item.source.unit_price) ?? unitFallback;
    return {
      item,
      qty,
      unitCost,
      amount: moneyOrZero(qty * unitCost),
    };
  });
  const allocatedFreight = allocateMoneyByWeight(money.freightAmount, lineDrafts.map((line) => line.amount));
  lineDrafts.forEach((line, index) => {
    db.prepare(`
      INSERT INTO erp_purchase_order_lines (
        id, account_id, po_id, sku_id, qty, unit_cost, logistics_fee,
        expected_qty, received_qty, remark
      )
      VALUES (
        @id, @account_id, @po_id, @sku_id, @qty, @unit_cost, @logistics_fee,
        @expected_qty, @received_qty, @remark
      )
    `).run({
      id: createId("po_line"),
      account_id: finalAccountId,
      po_id: po.id,
      sku_id: line.item.source.sku_id,
      qty: line.qty,
      unit_cost: line.unitCost,
      logistics_fee: allocatedFreight[index] || 0,
      expected_qty: line.qty,
      received_qty: 0,
      remark: line.item.line.title || line.item.source.product_title || null,
    });
  });
  const afterPo = getPurchaseOrder(db, po.id);
  services.workflow.writeAudit({
    accountId: finalAccountId,
    actor,
    action: "generate_po_from_1688_order",
    entityType: "purchase_order",
    entityId: po.id,
    before: null,
    after: afterPo,
  });
  return { purchaseOrder: afterPo, created: true, missingCount: missing.length };
}

function normalizeImported1688Order(input = {}) {
  return normalize1688OrderDetailResponse(input.raw || input, input.externalOrderId);
}

async function import1688OrdersAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "同步 1688 后台订单");
  const apiParams = build1688OrderListParams(payload, {});
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.ORDER_LIST.key, params: apiParams };
  const rawResponse = payload.mockOrderListResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: optionalString(payload.accountId || payload.account_id),
    purchase1688AccountId: optionalString(payload.purchase1688AccountId || payload.purchase_1688_account_id),
    action: "import_1688_orders",
    api: PROCUREMENT_APIS.ORDER_LIST,
    params: apiParams,
  });
  const orders = normalize1688BuyerOrderListResponse(rawResponse);
  const imported = [];
  for (const order of orders) {
    const existing = findPurchaseOrderByExternalOrderId(db, order.externalOrderId);
    let localPo = existing;
    let generated = false;
    let error = null;
    if (existing) {
      localPo = updatePurchaseOrderFrom1688Snapshot({
        db,
        services,
        po: existing,
        order,
        rawDetail: order.raw || order,
        action: "import_1688_orders",
        actor,
      });
    } else if (payload.autoGenerate) {
      try {
        const result = createPurchaseOrderFrom1688Order({ db, services, order, payload, actor });
        localPo = result.purchaseOrder;
        generated = Boolean(result.created);
      } catch (nextError) {
        error = nextError?.message || String(nextError);
      }
    }
    imported.push({
      ...order,
      localPoId: localPo?.id || null,
      localPoNo: localPo?.po_no || null,
      generated,
      error,
    });
  }
  return {
    apiKey: PROCUREMENT_APIS.ORDER_LIST.key,
    query: apiParams,
    importedCount: imported.length,
    generatedCount: imported.filter((item) => item.generated).length,
    orders: imported,
    rawResponse,
  };
}

async function generatePoFrom1688OrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 后台订单生成采购单");
  let order = payload.order ? normalizeImported1688Order(payload.order) : null;
  if (!order?.externalOrderId) {
    const detail = await fetch1688OrderDetailForPo({
      db,
      services,
      po: { external_order_id: optionalString(payload.externalOrderId || payload.orderId), account_id: optionalString(payload.accountId) },
      payload,
      actor,
      action: "fetch_1688_order_for_generate_po",
    });
    order = detail.detail;
  }
  const result = createPurchaseOrderFrom1688Order({ db, services, order, payload, actor });
  return {
    purchaseOrder: toCamelRow(result.purchaseOrder),
    created: result.created,
    missingCount: result.missingCount || 0,
  };
}

async function link1688OrderToPoAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "关联 1688 后台订单");
  const po = getPurchaseOrderWithCandidate(db, requireString(payload.poId || payload.id, "poId"));
  let order = payload.order ? normalizeImported1688Order(payload.order) : null;
  if (!order?.externalOrderId) {
    const detail = await fetch1688OrderDetailForPo({
      db,
      services,
      po,
      payload,
      actor,
      action: "fetch_1688_order_for_link_po",
    });
    order = detail.detail;
  }
  const afterPo = bind1688OrderToPurchaseOrder({ db, services, po, order, actor, action: "link_1688_order_to_po" });
  return { purchaseOrder: toCamelRow(afterPo), order };
}

function getPurchaseWorkbenchForAction(payload = {}, actor = {}) {
  if (payload.includeWorkbench === false || payload.skipWorkbench || payload.noWorkbench) return null;
  const action = optionalString(payload.action);
  const defaults = action === "create_pr" || action === "create_purchase_request"
    ? {
      includeRequestDetails: false,
      includeOptions: false,
      include1688Meta: false,
    }
    : {};
  return getPurchaseWorkbench({
    limit: payload.limit,
    accountId: payload.accountId || payload.account_id,
    includeRequestDetails: payload.includeRequestDetails ?? defaults.includeRequestDetails,
    includeOptions: payload.includeOptions ?? defaults.includeOptions,
    include1688Meta: payload.include1688Meta ?? defaults.include1688Meta,
    detailPrId: payload.detailPrId || payload.detail_pr_id || payload.prId || payload.pr_id,
    user: actor,
  });
}

async function performPurchaseAction(payload = {}, actorInput = {}) {
  const { db, services } = requireErp();
  const action = requireString(payload.action, "action");
  const actor = normalizeActor(actorInput);

  if (action === "source_1688_keyword") {
    const result = await source1688KeywordAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "source_1688_image") {
    const __td0 = Date.now();
    const result = await source1688ImageAction({ db, services, payload, actor });
    const resultLen = JSON.stringify(result || {}).length;
    console.error(`[source_1688_image dispatch t=${Date.now() - __td0}ms] action ok, resultBytes=${resultLen}`);
    try {
      broadcastPurchaseUpdate(action, sanitizeAlphaShopPayload(payload), actor, result);
    } catch (e) {
      console.error(`[source_1688_image dispatch t=${Date.now() - __td0}ms] broadcast failed: ${e?.message}`);
    }
    // 跟其他 action（source_1688_keyword 等）保持一致：默认带 workbench；客户端可以
    // 用 includeWorkbench:false / skipWorkbench:true 关掉。这样客户端拿到 action 响应
    // 时就有最新的 workbench，不需要再发第二次 /api/purchase/workbench（之前那次会把
    // 9MB+ 的全量 workbench 串两遍 IPC + 走 https，触发 IPC 120s 超时）。
    const workbench = getPurchaseWorkbenchForAction(payload, actor);
    const totalLen = JSON.stringify({ action, result, workbench }).length;
    console.error(`[source_1688_image dispatch t=${Date.now() - __td0}ms] returning, totalBytes=${totalLen}`);
    return { action, result, workbench };
  }

  if (action === "preview_1688_url_specs") {
    const result = await preview1688UrlSpecsAction({ db, payload, actor });
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "refresh_1688_product_detail") {
    const result = await refresh1688ProductDetailAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "bind_1688_candidate_spec") {
    const result = bind1688CandidateSpecAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "save_1688_address") {
    const result = save1688DeliveryAddressAction({ db, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "sync_1688_addresses") {
    const result = await sync1688DeliveryAddressesAction({ db, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "configure_1688_message_subscriptions") {
    const result = configure1688MessageSubscriptionsAction({ db, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  // === Multi 1688 采购账号管理（v0.2.8+）===

  if (action === "list_1688_purchase_accounts") {
    assertActorRole(actor, ["admin", "manager", "buyer"], "1688 采购账号列表");
    const result = list1688PurchaseAccounts(actor?.companyId);
    return { action, result, workbench: {} };
  }

  if (action === "delete_1688_purchase_account") {
    const result = delete1688PurchaseAccount({
      id: payload.id,
      companyId: actor?.companyId,
    }, actor);
    broadcastPurchaseUpdate(action, payload, actor, result);
    return { action, result, workbench: {} };
  }

  if (action === "update_1688_purchase_account" || action === "update_1688_purchase_account_label") {
    const result = update1688PurchaseAccount({
      id: payload.id,
      label: payload.label,
      status: payload.status,
      companyId: actor?.companyId,
    }, actor);
    broadcastPurchaseUpdate(action, payload, actor, result);
    return { action, result, workbench: {} };
  }

  if (action === "set_account_default_1688_purchase" || action === "set_default_1688_purchase_account") {
    const result = setAccount1688DefaultPurchase({
      accountId: payload.accountId,
      default1688AccountId: payload.default1688AccountId,
      companyId: actor?.companyId,
    }, actor);
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "preview_1688_order") {
    const result = await preview1688OrderAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "validate_1688_order_push") {
    const result = await validate1688OrderPushAction({ db, payload, actor });
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "push_1688_order") {
    const result = await push1688OrderAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "sync_1688_orders") {
    const result = await sync1688OrdersAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  if (action === "query_1688_mix_config") {
    const result = await query1688MixConfigAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  const async1688RefundActions = {
    get_1688_refund_reasons: get1688RefundReasonsAction,
    get_1688_max_refund_fee: get1688MaxRefundFeeAction,
    upload_1688_refund_voucher: upload1688RefundVoucherAction,
    create_1688_refund: create1688RefundAction,
    sync_1688_refunds: sync1688RefundsAction,
    sync_1688_refund_detail: sync1688RefundDetailAction,
    sync_1688_refund_operations: sync1688RefundOperationsAction,
    submit_1688_return_goods: submit1688ReturnGoodsAction,
    list_1688_offline_logistics_companies: list1688OfflineLogisticsCompaniesAction,
  };
  if (async1688RefundActions[action]) {
    const result = await async1688RefundActions[action]({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  const async1688OrderActions = {
    auto_inquiry_1688: autoInquiry1688CandidatesAction,
    record_local_1688_inquiry_results: recordLocal1688InquiryResultsAction,
    sync_1688_inquiry_results: sync1688InquiryResultsAction,
    search_1688_relation_suppliers: search1688RelationSuppliersAction,
    sync_1688_relation_user_info: sync1688RelationUserInfoAction,
    follow_1688_product: (args) => set1688ProductFollowAction({ ...args, follow: true }),
    unfollow_1688_product: (args) => set1688ProductFollowAction({ ...args, follow: false }),
    sync_1688_purchased_products: sync1688PurchasedProductsAction,
    ensure_1688_supplier_profile_once: ensure1688SupplierProfileOnceAction,
    get_1688_payment_url: get1688PaymentUrlAction,
    query_1688_pay_ways: query1688PayWaysAction,
    query_1688_protocol_pay_status: query1688ProtocolPayStatusAction,
    prepare_1688_protocol_pay: prepare1688ProtocolPayAction,
    fetch_1688_order_detail: fetch1688OrderDetailAction,
    sync_1688_logistics: sync1688LogisticsAction,
    sync_1688_order_price: sync1688OrderPriceAction,
    import_1688_orders: import1688OrdersAction,
    generate_po_from_1688_order: generatePoFrom1688OrderAction,
    link_1688_order_to_po: link1688OrderToPoAction,
    cancel_1688_order: cancel1688OrderAction,
    add_1688_order_memo: add1688OrderMemoAction,
    add_1688_order_feedback: add1688OrderFeedbackAction,
    confirm_1688_receive_goods: confirm1688ReceiveGoodsAction,
    run_1688_supply_change_agent: (args) => run1688AgentAction({
      ...args,
      api: PROCUREMENT_APIS.SUPPLY_CHANGE_AGENT,
      action: "run_1688_supply_change_agent",
    }),
    feedback_1688_supply_change_agent: feedback1688SupplyChangeAgentAction,
    add_1688_monitor_product: (args) => set1688MonitorProductAction({ ...args, add: true }),
    delete_1688_monitor_product: (args) => set1688MonitorProductAction({ ...args, add: false }),
    query_1688_monitor_products: query1688MonitorProductsAction,
    run_1688_deep_search_agent: (args) => run1688AgentAction({
      ...args,
      api: PROCUREMENT_APIS.DEEP_SEARCH_AGENT,
      action: "run_1688_deep_search_agent",
    }),
    ensure_1688_mix_config_once: ensure1688MixConfigOnceAction,
  };
  if (async1688OrderActions[action]) {
    const result = await async1688OrderActions[action]({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, payload, actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
  }

  const run = db.transaction(() => {
    switch (action) {
      case "create_pr":
      case "create_purchase_request": {
        return createPurchaseRequestAction({ db, services, payload, actor });
      }
      case "add_comment": {
        const pr = getPurchaseRequest(db, requireString(payload.prId || payload.id, "prId"));
        const imageUrls = saveErpImageUploads(db, payload, "purchase-comments");
        const text = optionalString(payload.body || payload.comment);
        const imageLines = imageUrls.map((url) => `图片：${url}`);
        const body = [text, ...imageLines].filter(Boolean).join("\n");
        const comment = addPurchaseRequestComment(db, pr, actor, body);
        return { comment: toCamelRow(comment) };
      }
      case "mark_read": {
        const pr = getPurchaseRequest(db, requireString(payload.prId || payload.id, "prId"));
        return { lastReadAt: markPurchaseRequestRead(db, pr.id, actor) };
      }
      case "accept_pr": {
        const prId = requireString(payload.prId || payload.id, "prId");
        const transition = services.purchase.acceptRequest(prId, actor);
        writePurchaseRequestEvent(db, getPurchaseRequest(db, prId), actor, "accept_request", "采购接收需求");
        markPurchaseRequestRead(db, prId, actor);
        return transition;
      }
      case "mark_sourced": {
        const prId = requireString(payload.prId || payload.id, "prId");
        const transition = services.purchase.markRequestSourced(prId, actor);
      writePurchaseRequestEvent(db, getPurchaseRequest(db, prId), actor, "mark_sourced", "采购已找到货源");
        markPurchaseRequestRead(db, prId, actor);
        return transition;
      }
      case "cancel_pr": {
        const prId = requireString(payload.prId || payload.id, "prId");
        const transition = services.workflow.transition({
          entityType: "purchase_request",
          id: prId,
          action: "cancel_pr",
          toStatus: "cancelled",
          actor,
        });
        writePurchaseRequestEvent(db, getPurchaseRequest(db, prId), actor, "cancel_request", "采购单已删除");
        markPurchaseRequestRead(db, prId, actor);
        return transition;
      }
      case "quote_feedback":
      case "add_sourcing_candidate": {
        return addSourcingCandidateAction({ db, services, payload, actor });
      }
      case "save_purchase_settings": {
        return savePurchaseSettingsAction({ db, payload, actor });
      }
      case "upsert_sku_1688_source": {
        return {
          sku1688Source: upsertSku1688SourceRow(db, payload, actor),
        };
      }
      case "delete_sku_1688_source": {
        return deleteSku1688SourceRow(db, payload, actor);
      }
      case "create_direct_po": {
        return createDirectPurchaseOrderAction({ db, services, payload, actor });
      }
      case "generate_po": {
        return generatePurchaseOrderAction({ db, services, payload, actor });
      }
      case "delete_po": {
        return deletePurchaseOrderAction({ db, services, payload, actor });
      }
      case "update_offline_po": {
        return updateOfflinePurchaseOrderAction({ db, services, payload, actor });
      }
      case "request_1688_price_change": {
        return request1688PriceChangeAction({ db, services, payload, actor });
      }
      case "sync_1688_order_price": {
        return sync1688OrderPriceAction({ db, services, payload, actor });
      }
      case "submit_payment_approval": {
        const poId = requireString(payload.poId || payload.id, "poId");
        const po = getPurchaseOrder(db, poId);
        if (isPaymentSubmittedPurchaseOrder(po)) {
          const targetPaymentStatus = isPaidOrLaterPurchaseOrder(po) ? "paid" : "approved";
          const paymentApproval = ensurePaymentApprovalForPo({
            db,
            services,
            po,
            payload,
            actor,
            status: targetPaymentStatus,
          });
          return {
            transition: noOpPurchaseOrderTransition(po, "submit_payment_approval"),
            paymentApproval: toCamelRow(paymentApproval),
            purchaseOrder: toPurchaseOrderResult(db, po.id),
            idempotent: true,
          };
        }
        const transition = services.purchase.submitPaymentApproval(poId, actor);
        const paymentApproval = createPaymentApprovalForPo({
          db,
          services,
          po,
          payload,
          actor,
        });
        return {
          transition,
          paymentApproval: toCamelRow(paymentApproval),
        };
      }
      case "approve_payment": {
        const paymentApproval = approvePaymentApproval({
          db,
          services,
          payload,
          actor,
        });
        return { paymentApproval: toCamelRow(paymentApproval) };
      }
      case "confirm_paid": {
        const paymentApproval = confirmPaymentPaid({
          db,
          services,
          payload,
          actor,
        });
        return { paymentApproval: toCamelRow(paymentApproval) };
      }
      case "rollback_po_status": {
        return rollbackPurchaseOrderStatusAction({
          db,
          services,
          payload,
          actor,
        });
      }
      default:
        throw new Error(`Unsupported purchase action: ${action}`);
    }
  });

  const result = run();
  broadcastPurchaseUpdate(action, payload, actor, result);
  return {
    action,
    result,
    workbench: getPurchaseWorkbenchForAction(payload, actor),
  };
}

// 把 PO 上同步过来的 1688 物流信息解出关键字段，方便仓库列表直接展示。
function extractInboundLogisticsSummary(externalLogisticsJson) {
  const obj = parseJsonObject(externalLogisticsJson);
  if (!obj || typeof obj !== "object") return null;
  // 1688 alibaba.trade.getLogisticsInfos.buyerView 的 result.logisticsItems[0]
  const items = findFirstDeepValue(obj, ["logisticsItems", "logisticsInfos", "items"]);
  const item = Array.isArray(items) ? items[0] : (items && typeof items === "object" ? items : null);
  const companyName = optionalString(
    findFirstDeepValue(obj, ["logisticsCompanyName", "logisticsName", "companyName"])
    || (item && (item.logisticsCompanyName || item.companyName)),
  );
  const billNo = optionalString(
    findFirstDeepValue(obj, ["logisticsBillNo", "mailNo", "trackingNo", "billNo"])
    || (item && (item.logisticsBillNo || item.mailNo)),
  );
  if (!companyName && !billNo) return null;
  return {
    companyName: companyName || null,
    billNo: billNo || null,
  };
}

function normalizeInboundLogisticsTraceItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: optionalString(item.id) || `trace-${index + 1}`,
      time: optionalString(item.time || item.acceptTime || item.traceTime || item.timeStr),
      text: optionalString(item.text || item.remark || item.eventDetail || item.desc || item.description || item.context),
    }))
    .filter((item) => item.time || item.text)
    .sort((left, right) => String(right.time || "").localeCompare(String(left.time || "")));
}

function normalizeInboundLogisticsItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: optionalString(item.logisticsId || item.id) || `logistics-${index + 1}`,
      companyName: optionalString(item.logisticsCompanyName || item.companyName || item.logisticsCompany),
      billNo: optionalString(item.logisticsBillNo || item.mailNo || item.mail_no || item.waybillNo),
      status: optionalString(item.status || item.logisticsStatus || item.statusDesc),
      deliveredAt: optionalString(item.deliveredAt || item.signTime || item.endTime),
    }))
    .filter((item) => item.companyName || item.billNo || item.status || item.deliveredAt);
}

function extractInboundLogisticsDetail(row = {}) {
  const externalLogisticsJson = row.po_external_logistics_json || row.external_logistics_json;
  const hasExternalLogistics = Boolean(optionalString(externalLogisticsJson));
  const externalLogistics = hasExternalLogistics ? parseJsonObject(externalLogisticsJson) : null;
  const jstRemark = parseJsonObject(row.remark, null);
  const normalized = hasExternalLogistics
    ? normalize1688LogisticsResponse(externalLogistics, row.external_order_id)
    : null;
  const summary = hasExternalLogistics ? extractInboundLogisticsSummary(externalLogisticsJson) : null;
  const logisticsItems = normalizeInboundLogisticsItems(normalized?.logisticsItems || []);
  const primaryLogistics = logisticsItems[0] || {};
  const companyName = optionalString(
    summary?.companyName
    || primaryLogistics.companyName
    || jstRemark?.logisticsCompany
    || jstRemark?.logistics_company,
  );
  const billNo = optionalString(
    summary?.billNo
    || primaryLogistics.billNo
    || jstRemark?.trackingNo
    || jstRemark?.tracking_no
    || jstRemark?.logisticsBillNo,
  );
  return {
    receiptId: row.id || null,
    receiptNo: row.receipt_no || null,
    poId: row.po_id || null,
    poNo: row.po_no || null,
    supplierName: row.supplier_name || null,
    companyName: companyName || null,
    billNo: billNo || null,
    status: normalized?.status || primaryLogistics.status || null,
    signed: Boolean(normalized?.signed),
    shipped: Boolean(normalized?.shipped || normalized?.traceItems?.length || logisticsItems.length),
    source: hasExternalLogistics ? "1688" : (jstRemark?.source === "jushuitan" ? "jushuitan" : "local"),
    syncedAt: row.po_external_logistics_synced_at || null,
    traceError: optionalString(normalized?.traceError || (externalLogistics && findFirstDeepValue(externalLogistics, ["traceError", "errorMessage", "errorMsg"]))),
    logisticsItems,
    traceItems: normalizeInboundLogisticsTraceItems(normalized?.traceItems || []),
  };
}

function toInboundReceipt(row) {
  const camel = toCamelRow(row);
  const jstRemark = parseJsonObject(row?.remark, null);
  if (jstRemark?.source === "jushuitan") {
    const totalQty = Number(jstRemark.totalQty || 0);
    if (totalQty > 0 && Number(camel.expectedQty || 0) <= 0) camel.expectedQty = totalQty;
    if (totalQty > 0 && Number(camel.receivedQty || 0) <= 0) camel.receivedQty = totalQty;
    if (jstRemark.warehouse && !camel.warehouseName) camel.warehouseName = jstRemark.warehouse;
    camel.sourceStatus = jstRemark.sourceStatus || jstRemark.status || null;
    camel.sourceFinancialStatus = jstRemark.sourceFinancialStatus || null;
    camel.sourceRemark = jstRemark.sourceRemark || null;
    if (!camel.skuSummary) camel.skuSummary = jstRemark.warehouse ? `聚水潭入库 / ${jstRemark.warehouse}` : "聚水潭入库";
    if (!camel.logistics && (jstRemark.logisticsCompany || jstRemark.trackingNo)) {
      camel.logistics = {
        companyName: jstRemark.logisticsCompany || null,
        billNo: jstRemark.trackingNo || null,
      };
    }
  } else if (jstRemark?.source === "jushuitan_purchasein_export") {
    const totalQty = Number(jstRemark.totalQty || jstRemark.sourceTotalQty || 0);
    if (totalQty > 0 && Number(camel.expectedQty || 0) <= 0) camel.expectedQty = totalQty;
    if (totalQty > 0 && Number(camel.receivedQty || 0) <= 0) camel.receivedQty = totalQty;
    if (jstRemark.warehouse && !camel.warehouseName) camel.warehouseName = jstRemark.warehouse;
    camel.sourceStatus = jstRemark.sourceStatus || jstRemark.status || null;
    camel.sourceFinancialStatus = jstRemark.sourceFinancialStatus || null;
    camel.sourceRemark = jstRemark.sourceRemark || null;
    if (!camel.skuSummary) camel.skuSummary = jstRemark.warehouse ? `聚水潭入库 / ${jstRemark.warehouse}` : "聚水潭入库";
    if (!camel.logistics && (jstRemark.logisticsCompany || jstRemark.trackingNo)) {
      camel.logistics = {
        companyName: jstRemark.logisticsCompany || null,
        billNo: jstRemark.trackingNo || null,
      };
    }
  }
  if (row?.po_external_logistics_json) {
    const normalizedLogistics = normalize1688LogisticsResponse(
      parseJsonObject(row.po_external_logistics_json),
      row.po_external_order_id || row.external_order_id,
    );
    const summary = extractInboundLogisticsSummary(row.po_external_logistics_json);
    if (summary) camel.logistics = summary;
    camel.logisticsStatus = normalizedLogistics.status || null;
    camel.logisticsSource = "1688";
    camel.logisticsSyncedAt = row.po_external_logistics_synced_at || null;
    camel.logisticsTraceError = optionalString(
      normalizedLogistics.traceError
      || findFirstDeepValue(parseJsonObject(row.po_external_logistics_json), ["traceError", "errorMessage", "errorMsg"]),
    ) || null;
    camel.logisticsHasTrace = normalizedLogistics.traceItems.length > 0 ? 1 : 0;
    delete camel.poExternalLogisticsJson;
    delete camel.poExternalLogisticsSyncedAt;
    delete camel.poExternalOrderId;
  }
  return camel;
}

const WAREHOUSE_EVENT_LABELS = Object.freeze({
  auto_create_inbound_receipt: "生成入库单",
  register_arrival: "确认到仓",
  confirm_count: "确认实收",
  confirm_inbound: "确认入库",
  mark_quantity_mismatch: "标记数量异常",
  mark_damaged: "标记破损异常",
  mark_inbound_exception: "标记入库异常",
  resolve_inbound_exception: "异常处理完成",
  create_batches: "创建批次",
  mark_arrived: "采购到仓",
  mark_inbounded: "完成入库",
});

const INBOUND_STATUS_TEXT = Object.freeze({
  pending_arrival: "待到货",
  arrived: "已到仓",
  counted: "已核数",
  inbounded_pending_qc: "已入库",
  quantity_mismatch: "数量异常",
  damaged: "破损异常",
  exception: "异常",
  cancelled: "已取消",
});

function inboundStatusText(status) {
  return INBOUND_STATUS_TEXT[status] || status || "-";
}

function getInboundReceiptTimeline(db, receiptId) {
  const receipt = db.prepare(`
    SELECT receipt.id, receipt.receipt_no, receipt.po_id, po.pr_id
    FROM erp_inbound_receipts receipt
    LEFT JOIN erp_purchase_orders po ON po.id = receipt.po_id
    WHERE receipt.id = ?
  `).get(receiptId);
  if (!receipt) return [];

  const events = [];
  const auditRows = db.prepare(`
    SELECT audit.id, audit.action, audit.actor_role, audit.before_json, audit.after_json,
           audit.created_at, actor.name AS actor_name
    FROM erp_audit_logs audit
    LEFT JOIN erp_users actor ON actor.id = audit.actor_id
    WHERE audit.entity_type = 'inbound_receipt'
      AND audit.entity_id = ?
    ORDER BY audit.created_at ASC
    LIMIT 80
  `).all(receiptId);

  for (const row of auditRows) {
    const before = parseJsonObject(row.before_json, null);
    const after = parseJsonObject(row.after_json, null);
    const beforeStatus = inboundStatusText(before?.status);
    const afterStatus = inboundStatusText(after?.status);
    events.push({
      id: row.id,
      source: "audit",
      eventType: row.action,
      label: WAREHOUSE_EVENT_LABELS[row.action] || row.action,
      message: beforeStatus !== afterStatus
        ? `${beforeStatus} -> ${afterStatus}`
        : (WAREHOUSE_EVENT_LABELS[row.action] || row.action),
      actorName: row.actor_name || null,
      actorRole: row.actor_role || null,
      createdAt: row.created_at,
    });
  }

  if (receipt.pr_id) {
    const eventRows = db.prepare(`
      SELECT id, event_type, message, actor_name, actor_role, created_at
      FROM erp_purchase_request_events
      WHERE pr_id = ?
        AND event_type IN (
          'auto_create_inbound_receipt',
          'register_arrival',
          'confirm_count',
          'confirm_inbound',
          'mark_quantity_mismatch',
          'mark_damaged',
          'mark_inbound_exception',
          'resolve_inbound_exception',
          'create_batches',
          'mark_arrived',
          'mark_inbounded'
        )
      ORDER BY created_at ASC
      LIMIT 80
    `).all(receipt.pr_id);
    for (const row of eventRows) {
      events.push({
        id: row.id,
        source: "flow",
        eventType: row.event_type,
        label: WAREHOUSE_EVENT_LABELS[row.event_type] || row.event_type,
        message: row.message,
        actorName: row.actor_name || null,
        actorRole: row.actor_role || null,
        createdAt: row.created_at,
      });
    }
  }

  return events
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
    .slice(-30);
}

const WAREHOUSE_EXCEPTION_STATUSES = Object.freeze(["quantity_mismatch", "damaged", "exception"]);
const WAREHOUSE_ACTIONABLE_STATUSES = Object.freeze(["pending_arrival", "arrived", "counted", ...WAREHOUSE_EXCEPTION_STATUSES]);
const WAREHOUSE_EXCEPTION_STATUS_SQL = "('quantity_mismatch', 'damaged', 'exception')";
const WAREHOUSE_ACTIONABLE_STATUS_SQL = "('pending_arrival', 'arrived', 'counted', 'quantity_mismatch', 'damaged', 'exception')";
const WAREHOUSE_RECEIPT_DATE_EXPR = "datetime(COALESCE(NULLIF(receipt.received_at, ''), receipt.updated_at, receipt.created_at))";
const WAREHOUSE_RECEIPT_OVERDUE_HOURS = 24;
const INBOUND_RECEIPT_EDIT_STATUSES = new Set([
  "jst_pending_inbound",
  "pending_arrival",
  "arrived",
  "counted",
  "inbounded_pending_qc",
  "quantity_mismatch",
  "damaged",
  "exception",
  "cancelled",
]);
const INBOUND_SOURCE_STATUS_BY_STATUS = {
  jst_pending_inbound: "待入库",
  pending_arrival: "待到货",
  arrived: "已到仓",
  counted: "已核数",
  inbounded_pending_qc: "已入库",
  quantity_mismatch: "数量异常",
  damaged: "破损异常",
  exception: "异常",
  cancelled: "已取消",
};

function getWarehouseWorkbench(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId);
  const rawInboundReceiptStatus = params.inboundReceiptStatus
    ?? params.inbound_receipt_status
    ?? params.receiptStatus
    ?? params.receipt_status
    ?? params.status;
  const inboundReceiptKeyword = optionalString(
    params.inboundReceiptKeyword
    ?? params.inbound_receipt_keyword
    ?? params.receiptKeyword
    ?? params.receipt_keyword
    ?? params.keyword
    ?? params.search,
  );
  const inboundReceiptSupplier = optionalString(
    params.inboundReceiptSupplier
    ?? params.inbound_receipt_supplier
    ?? params.receiptSupplier
    ?? params.receipt_supplier
    ?? params.supplier,
  );
  const inboundReceiptDateFrom = optionalString(
    params.inboundReceiptDateFrom
    ?? params.inbound_receipt_date_from
    ?? params.receiptDateFrom
    ?? params.receipt_date_from
    ?? params.dateFrom
    ?? params.date_from,
  );
  const inboundReceiptDateTo = optionalString(
    params.inboundReceiptDateTo
    ?? params.inbound_receipt_date_to
    ?? params.receiptDateTo
    ?? params.receipt_date_to
    ?? params.dateTo
    ?? params.date_to,
  );
  const inboundReceiptIssue = optionalString(
    params.inboundReceiptIssue
    ?? params.inbound_receipt_issue
    ?? params.receiptIssue
    ?? params.receipt_issue
    ?? params.issue,
  );
  const inboundReceiptScope = optionalString(
    params.inboundReceiptScope
    ?? params.inbound_receipt_scope
    ?? params.receiptScope
    ?? params.receipt_scope
    ?? params.scope,
  );
  const rawInboundReceiptLimit = params.inboundReceiptLimit
    ?? params.inbound_receipt_limit
    ?? params.receiptLimit
    ?? params.receipt_limit
    ?? params.limit;
  const hasInboundReceiptLimit = rawInboundReceiptLimit !== undefined
    && rawInboundReceiptLimit !== null
    && rawInboundReceiptLimit !== ""
    && Number(rawInboundReceiptLimit) > 0;
  const inboundReceiptLimit = hasInboundReceiptLimit ? Math.min(normalizeLimit(rawInboundReceiptLimit, 20), 50) : 20;
  const inboundReceiptOffset = normalizeOffset(
    params.inboundReceiptOffset || params.inbound_receipt_offset || params.receiptOffset || params.receipt_offset || params.offset,
  );
  const rawInventoryBatchLimit = params.inventoryBatchLimit
    ?? params.inventory_batch_limit
    ?? params.batchLimit
    ?? params.batch_limit;
  const inventoryBatchLimit = Math.min(normalizeLimit(rawInventoryBatchLimit, 20), 500);
  const inventoryBatchOffset = normalizeOffset(
    params.inventoryBatchOffset || params.inventory_batch_offset || params.batchOffset || params.batch_offset,
  );
  const inboundReceiptLimitClause = "LIMIT @receipt_limit OFFSET @receipt_offset";
  const inventoryBatchLimitClause = "LIMIT @batch_limit OFFSET @batch_offset";
  const receiptWhereAccount = accountId ? "WHERE receipt.account_id = @account_id" : "";
  const batchWhereAccount = accountId ? "WHERE batch.account_id = @account_id" : "";
  const receiptStatuses = Array.isArray(rawInboundReceiptStatus)
    ? rawInboundReceiptStatus
    : String(rawInboundReceiptStatus || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const receiptWhereParts = [];
  const baseParams = {
    account_id: accountId,
    receipt_keyword: inboundReceiptKeyword ? `%${inboundReceiptKeyword}%` : null,
    receipt_supplier: inboundReceiptSupplier ? `%${inboundReceiptSupplier}%` : null,
    receipt_date_from: inboundReceiptDateFrom || null,
    receipt_date_to: inboundReceiptDateTo || null,
    receipt_overdue_hours: WAREHOUSE_RECEIPT_OVERDUE_HOURS,
    receipt_limit: inboundReceiptLimit,
    receipt_offset: inboundReceiptOffset,
    batch_limit: inventoryBatchLimit,
    batch_offset: inventoryBatchOffset,
  };
  if (accountId) receiptWhereParts.push("receipt.account_id = @account_id");
  if (receiptStatuses.length) {
    const statusPlaceholders = [];
    receiptStatuses.forEach((status, index) => {
      const key = `receipt_status_${index}`;
      statusPlaceholders.push(`@${key}`);
      baseParams[key] = status;
    });
    receiptWhereParts.push(`receipt.status IN (${statusPlaceholders.join(", ")})`);
  }
  if (inboundReceiptKeyword) {
    receiptWhereParts.push(`(
      receipt.receipt_no LIKE @receipt_keyword
      OR receipt.id LIKE @receipt_keyword
      OR po.po_no LIKE @receipt_keyword
      OR po.id LIKE @receipt_keyword
      OR supplier.name LIKE @receipt_keyword
      OR sku.internal_sku_code LIKE @receipt_keyword
      OR sku.product_name LIKE @receipt_keyword
      OR receipt.remark LIKE @receipt_keyword
      OR po.external_logistics_json LIKE @receipt_keyword
    )`);
  }
  if (inboundReceiptSupplier) {
    receiptWhereParts.push("supplier.name LIKE @receipt_supplier");
  }
  if (inboundReceiptDateFrom) {
    receiptWhereParts.push(`${WAREHOUSE_RECEIPT_DATE_EXPR} >= datetime(@receipt_date_from)`);
  }
  if (inboundReceiptDateTo) {
    receiptWhereParts.push(`${WAREHOUSE_RECEIPT_DATE_EXPR} <= datetime(@receipt_date_to)`);
  }
  if (inboundReceiptIssue === "damaged") {
    receiptWhereParts.push("EXISTS (SELECT 1 FROM erp_inbound_receipt_lines issue_line WHERE issue_line.receipt_id = receipt.id AND COALESCE(issue_line.damaged_qty, 0) > 0)");
  } else if (inboundReceiptIssue === "shortage") {
    receiptWhereParts.push("EXISTS (SELECT 1 FROM erp_inbound_receipt_lines issue_line WHERE issue_line.receipt_id = receipt.id AND COALESCE(issue_line.shortage_qty, 0) > 0)");
  } else if (inboundReceiptIssue === "over") {
    receiptWhereParts.push("EXISTS (SELECT 1 FROM erp_inbound_receipt_lines issue_line WHERE issue_line.receipt_id = receipt.id AND COALESCE(issue_line.over_qty, 0) > 0)");
  } else if (inboundReceiptIssue === "mismatch") {
    receiptWhereParts.push("EXISTS (SELECT 1 FROM erp_inbound_receipt_lines issue_line WHERE issue_line.receipt_id = receipt.id AND (COALESCE(issue_line.shortage_qty, 0) > 0 OR COALESCE(issue_line.over_qty, 0) > 0 OR COALESCE(issue_line.damaged_qty, 0) > 0))");
  }
  if (inboundReceiptScope === "actionable") {
    receiptWhereParts.push(`receipt.status IN (${WAREHOUSE_ACTIONABLE_STATUSES.map((status, index) => {
      const key = `receipt_scope_status_${index}`;
      baseParams[key] = status;
      return `@${key}`;
    }).join(", ")})`);
  } else if (inboundReceiptScope === "today") {
    receiptWhereParts.push(`date(${WAREHOUSE_RECEIPT_DATE_EXPR}, 'localtime') = date('now', 'localtime')`);
  } else if (inboundReceiptScope === "overdue") {
    receiptWhereParts.push(`receipt.status IN (${WAREHOUSE_ACTIONABLE_STATUSES.map((status, index) => {
      const key = `receipt_overdue_status_${index}`;
      baseParams[key] = status;
      return `@${key}`;
    }).join(", ")})`);
    receiptWhereParts.push(`((julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24) >= @receipt_overdue_hours`);
  }
  const receiptWhereClause = receiptWhereParts.length ? `WHERE ${receiptWhereParts.join(" AND ")}` : "";

  const receiptSummary = db.prepare(`
    SELECT
      COUNT(DISTINCT receipt.id) AS inbound_receipt_count,
      COUNT(DISTINCT CASE WHEN receipt.status = 'pending_arrival' THEN receipt.id END) AS pending_arrival_count,
      COUNT(DISTINCT CASE WHEN receipt.status = 'arrived' THEN receipt.id END) AS arrived_count,
      COUNT(DISTINCT CASE WHEN receipt.status = 'counted' THEN receipt.id END) AS counted_count,
      COUNT(DISTINCT CASE WHEN receipt.status = 'inbounded_pending_qc' THEN receipt.id END) AS inbounded_pending_qc_count,
      COUNT(DISTINCT CASE WHEN receipt.status IN ${WAREHOUSE_EXCEPTION_STATUS_SQL} THEN receipt.id END) AS exception_count,
      COUNT(DISTINCT CASE WHEN receipt.status = 'cancelled' THEN receipt.id END) AS cancelled_count,
      COUNT(DISTINCT CASE WHEN receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL} THEN receipt.id END) AS actionable_count,
      COUNT(DISTINCT CASE WHEN date(${WAREHOUSE_RECEIPT_DATE_EXPR}, 'localtime') = date('now', 'localtime') THEN receipt.id END) AS today_receipt_count,
      COUNT(DISTINCT CASE WHEN receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL}
        AND ((julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24) >= @receipt_overdue_hours
        THEN receipt.id END) AS overdue_receipt_count,
      COUNT(DISTINCT CASE WHEN receipt.status IN ${WAREHOUSE_EXCEPTION_STATUS_SQL}
        OR (receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL}
          AND ((julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24) >= @receipt_overdue_hours)
        THEN receipt.id END) AS urgent_receipt_count,
      COUNT(DISTINCT CASE WHEN COALESCE(line.shortage_qty, 0) > 0 OR COALESCE(line.over_qty, 0) > 0 OR COALESCE(line.damaged_qty, 0) > 0 THEN receipt.id END) AS issue_receipt_count,
      COALESCE(SUM(line.received_qty), 0) AS received_qty
    FROM erp_inbound_receipts receipt
    LEFT JOIN erp_inbound_receipt_lines line ON line.receipt_id = receipt.id
    ${receiptWhereAccount}
  `).get(baseParams) || {};
  const receiptListSummary = db.prepare(`
    SELECT COUNT(DISTINCT receipt.id) AS inbound_receipt_count
    FROM erp_inbound_receipts receipt
    LEFT JOIN erp_purchase_orders po ON po.id = receipt.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_inbound_receipt_lines line ON line.receipt_id = receipt.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${receiptWhereClause}
  `).get(baseParams) || {};
  const inventoryBatchSummary = db.prepare(`
    SELECT COUNT(*) AS inventory_batch_count
    FROM erp_inventory_batches batch
    ${batchWhereAccount}
  `).get(baseParams) || {};

  const inboundReceipts = db.prepare(`
    SELECT
      receipt.*,
      acct.name AS account_name,
      po.po_no,
      po.status AS po_status,
      supplier.name AS supplier_name,
      operator.name AS operator_name,
      COUNT(line.id) AS line_count,
      COALESCE(SUM(line.expected_qty), 0) AS expected_qty,
      COALESCE(SUM(line.received_qty), 0) AS received_qty,
      COALESCE(SUM(line.damaged_qty), 0) AS damaged_qty,
      COALESCE(SUM(line.shortage_qty), 0) AS shortage_qty,
      COALESCE(SUM(line.over_qty), 0) AS over_qty,
      SUM(CASE WHEN line.batch_id IS NOT NULL THEN 1 ELSE 0 END) AS batch_line_count,
      (
        SELECT sku_first.internal_sku_code
        FROM erp_inbound_receipt_lines line_first
        LEFT JOIN erp_skus sku_first ON sku_first.id = line_first.sku_id
        WHERE line_first.receipt_id = receipt.id
          AND COALESCE(sku_first.internal_sku_code, '') != ''
        ORDER BY line_first.id ASC
        LIMIT 1
      ) AS sku_code,
      (
        SELECT sku_first.product_name
        FROM erp_inbound_receipt_lines line_first
        LEFT JOIN erp_skus sku_first ON sku_first.id = line_first.sku_id
        WHERE line_first.receipt_id = receipt.id
          AND COALESCE(sku_first.product_name, '') != ''
        ORDER BY line_first.id ASC
        LIMIT 1
      ) AS product_name,
      (
        SELECT sku_first.image_url
        FROM erp_inbound_receipt_lines line_first
        LEFT JOIN erp_skus sku_first ON sku_first.id = line_first.sku_id
        WHERE line_first.receipt_id = receipt.id
          AND COALESCE(sku_first.image_url, '') != ''
        ORDER BY line_first.id ASC
        LIMIT 1
      ) AS product_image_url,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code) AS sku_summary,
      CASE
        WHEN receipt.remark LIKE '%jushuitan_purchasein_export%' THEN NULL
        ELSE po.external_logistics_json
      END AS po_external_logistics_json,
      po.external_logistics_synced_at AS po_external_logistics_synced_at,
      po.external_order_id AS po_external_order_id,
      ROUND(MAX(0, (julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24), 1) AS age_hours,
      CASE WHEN date(${WAREHOUSE_RECEIPT_DATE_EXPR}, 'localtime') = date('now', 'localtime') THEN 1 ELSE 0 END AS is_today,
      CASE WHEN receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL}
        AND ((julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24) >= @receipt_overdue_hours
        THEN 1 ELSE 0 END AS is_overdue,
      CASE
        WHEN receipt.status IN ${WAREHOUSE_EXCEPTION_STATUS_SQL} THEN 0
        WHEN receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL}
          AND ((julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24) >= @receipt_overdue_hours THEN 1
        WHEN receipt.status = 'counted' THEN 2
        WHEN receipt.status = 'arrived' THEN 3
        WHEN receipt.status = 'pending_arrival' THEN 4
        WHEN receipt.status = 'inbounded_pending_qc' THEN 8
        ELSE 9
      END AS priority_rank,
      CASE
        WHEN receipt.status IN ${WAREHOUSE_EXCEPTION_STATUS_SQL} THEN '异常优先'
        WHEN receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL}
          AND ((julianday('now') - julianday(${WAREHOUSE_RECEIPT_DATE_EXPR})) * 24) >= @receipt_overdue_hours THEN '超期优先'
        WHEN receipt.status = 'counted' THEN '可入库'
        WHEN receipt.status = 'arrived' THEN '待核数'
        WHEN receipt.status = 'pending_arrival' THEN '待到货'
        WHEN receipt.status = 'inbounded_pending_qc' THEN '已入库'
        WHEN receipt.status = 'cancelled' THEN '已取消'
        ELSE '待跟进'
      END AS priority_label,
      CASE
        WHEN receipt.status IN ${WAREHOUSE_EXCEPTION_STATUS_SQL} THEN 'resolve_exception'
        WHEN receipt.status = 'pending_arrival' THEN 'confirm_arrival'
        WHEN receipt.status = 'arrived' THEN 'confirm_count'
        WHEN receipt.status = 'counted' THEN 'confirm_inbound'
        WHEN receipt.status = 'inbounded_pending_qc' THEN 'qc_pending'
        ELSE 'view_detail'
      END AS next_action_key,
      CASE
        WHEN receipt.status IN ${WAREHOUSE_EXCEPTION_STATUS_SQL} THEN '填写说明后入库'
        WHEN receipt.status = 'pending_arrival' THEN '确认到仓'
        WHEN receipt.status = 'arrived' THEN '核对实收数量'
        WHEN receipt.status = 'counted' THEN '确认入库'
        WHEN receipt.status = 'inbounded_pending_qc' THEN '进入质检'
        ELSE '查看明细'
      END AS next_action_label
    FROM erp_inbound_receipts receipt
    LEFT JOIN erp_accounts acct ON acct.id = receipt.account_id
    LEFT JOIN erp_purchase_orders po ON po.id = receipt.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_users operator ON operator.id = receipt.operator_id
    LEFT JOIN erp_inbound_receipt_lines line ON line.receipt_id = receipt.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${receiptWhereClause}
    GROUP BY receipt.id
    ORDER BY
      priority_rank ASC,
      CASE WHEN receipt.status IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL} THEN ${WAREHOUSE_RECEIPT_DATE_EXPR} END ASC,
      CASE WHEN receipt.status NOT IN ${WAREHOUSE_ACTIONABLE_STATUS_SQL} THEN ${WAREHOUSE_RECEIPT_DATE_EXPR} END DESC,
      receipt.updated_at DESC
    ${inboundReceiptLimitClause}
  `).all(baseParams).map(toInboundReceipt);

  const inventoryBatches = db.prepare(`
    SELECT
      batch.*,
      sku.internal_sku_code,
      sku.product_name,
      receipt.receipt_no,
      po.po_no,
      supplier.name AS supplier_name
    FROM erp_inventory_batches batch
    LEFT JOIN erp_skus sku ON sku.id = batch.sku_id
    LEFT JOIN erp_inbound_receipts receipt ON receipt.id = batch.inbound_receipt_id
    LEFT JOIN erp_purchase_orders po ON po.id = batch.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    ${batchWhereAccount}
    ORDER BY batch.created_at DESC
    ${inventoryBatchLimitClause}
  `).all(baseParams).map(toCamelRow);

  const summary = {
    inboundReceiptCount: Number(receiptSummary.inbound_receipt_count || 0),
    pendingArrivalCount: Number(receiptSummary.pending_arrival_count || 0),
    arrivedCount: Number(receiptSummary.arrived_count || 0),
    countedCount: Number(receiptSummary.counted_count || 0),
    inboundedPendingQcCount: Number(receiptSummary.inbounded_pending_qc_count || 0),
    exceptionCount: Number(receiptSummary.exception_count || 0),
    cancelledCount: Number(receiptSummary.cancelled_count || 0),
    actionableCount: Number(receiptSummary.actionable_count || 0),
    todayReceiptCount: Number(receiptSummary.today_receipt_count || 0),
    overdueReceiptCount: Number(receiptSummary.overdue_receipt_count || 0),
    issueReceiptCount: Number(receiptSummary.issue_receipt_count || 0),
    inventoryBatchCount: Number(inventoryBatchSummary.inventory_batch_count || 0),
    receivedQty: Number(receiptSummary.received_qty || 0),
  };

  return {
    generatedAt: nowIso(),
    summary,
    inboundReceiptPage: {
      limit: inboundReceiptLimit,
      offset: inboundReceiptOffset,
      total: Number(receiptListSummary.inbound_receipt_count || 0),
    },
    inventoryBatchPage: {
      limit: inventoryBatchLimit,
      offset: inventoryBatchOffset,
      total: Number(inventoryBatchSummary.inventory_batch_count || 0),
    },
    inboundReceipts,
    inventoryBatches,
  };
}

function normalizeJstWarehouseWorkbench(workbench = {}) {
  const inboundReceipts = Array.isArray(workbench.inboundReceipts) ? workbench.inboundReceipts : [];
  if (!inboundReceipts.length) return workbench;
  const normalizedReceipts = inboundReceipts.map((row = {}) => {
    const accountId = row.accountId || row.account_id;
    const jstRemark = parseJsonObject(row.remark, null);
    if (accountId !== "jst:account:default" && jstRemark?.source !== "jushuitan") return row;
    const totalQty = Number(jstRemark?.totalQty || jstRemark?.total_qty || 0);
    const next = { ...row };
    if (totalQty > 0 && Number(next.expectedQty || next.expected_qty || 0) <= 0) {
      next.expectedQty = totalQty;
      if (next.expected_qty !== undefined) next.expected_qty = totalQty;
    }
    if (totalQty > 0 && Number(next.receivedQty || next.received_qty || 0) <= 0) {
      next.receivedQty = totalQty;
      if (next.received_qty !== undefined) next.received_qty = totalQty;
    }
    if (!next.skuSummary && !next.sku_summary) {
      const skuSummary = jstRemark?.warehouse ? `聚水潭入库 / ${jstRemark.warehouse}` : "聚水潭入库";
      next.skuSummary = skuSummary;
      if (next.sku_summary !== undefined) next.sku_summary = skuSummary;
    }
    if (jstRemark?.warehouse && !next.warehouseName && !next.warehouse_name) {
      next.warehouseName = jstRemark.warehouse;
      if (next.warehouse_name !== undefined) next.warehouse_name = jstRemark.warehouse;
    }
    if (!next.logistics && (jstRemark?.logisticsCompany || jstRemark?.trackingNo)) {
      next.logistics = {
        companyName: jstRemark.logisticsCompany || null,
        billNo: jstRemark.trackingNo || null,
      };
    }
    return next;
  });
  const summary = {
    ...(workbench.summary || {}),
    receivedQty: normalizedReceipts.reduce((sum, item) => sum + Number(item.receivedQty || item.received_qty || 0), 0),
  };
  return {
    ...workbench,
    summary,
    inboundReceipts: normalizedReceipts,
  };
}

function getInboundReceipt(db, receiptId) {
  const row = db.prepare("SELECT * FROM erp_inbound_receipts WHERE id = ?").get(receiptId);
  if (!row) throw new Error(`Inbound receipt not found: ${receiptId}`);
  return row;
}

function buildBatchCode(receiptNo, line, index) {
  const safeReceiptNo = String(receiptNo || "INBOUND").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40);
  const safeLine = String(line.id || index + 1).replace(/[^A-Za-z0-9_-]+/g, "-").slice(-8);
  return `${safeReceiptNo}-B${String(index + 1).padStart(2, "0")}-${safeLine}`;
}

function getPurchaseOrderLineFreightAllocations(db, poId) {
  if (!poId) return new Map();
  const po = db.prepare("SELECT freight_amount FROM erp_purchase_orders WHERE id = ?").get(poId);
  const lines = db.prepare(`
    SELECT id, qty, unit_cost, logistics_fee
    FROM erp_purchase_order_lines
    WHERE po_id = ?
    ORDER BY id ASC
  `).all(poId);
  if (!lines.length) return new Map();
  const orderFreight = optionalNumber(po?.freight_amount);
  const lineFreightTotal = moneyOrZero(lines.reduce((sum, line) => sum + Number(line.logistics_fee || 0), 0));
  const freightToAllocate = orderFreight !== null && orderFreight > 0 ? orderFreight : lineFreightTotal;
  if (!freightToAllocate) return new Map(lines.map((line) => [line.id, Number(line.logistics_fee || 0)]));
  const weights = lines.map((line) => moneyOrZero(Number(line.qty || 0) * Number(line.unit_cost || 0)));
  const allocated = allocateMoneyByWeight(freightToAllocate, weights);
  return new Map(lines.map((line, index) => [line.id, allocated[index] || 0]));
}

function getInboundLinesForBatchCreation(db, receiptId) {
  const rows = db.prepare(`
    SELECT
      line.*,
      po_line.po_id AS po_line_po_id,
      po_line.qty AS po_qty,
      po_line.unit_cost AS po_unit_cost,
      po_line.logistics_fee AS po_logistics_fee
    FROM erp_inbound_receipt_lines line
    LEFT JOIN erp_purchase_order_lines po_line ON po_line.id = line.po_line_id
    WHERE line.receipt_id = ?
    ORDER BY line.id ASC
  `).all(receiptId);
  const allocationByPo = new Map();
  return rows.map((line) => {
    const poId = optionalString(line.po_line_po_id);
    if (!poId) return line;
    if (!allocationByPo.has(poId)) {
      allocationByPo.set(poId, getPurchaseOrderLineFreightAllocations(db, poId));
    }
    const allocation = allocationByPo.get(poId);
    return {
      ...line,
      po_allocated_logistics_fee: allocation.get(line.po_line_id) ?? Number(line.po_logistics_fee || 0),
    };
  });
}

function calculateLineLandedCost(line) {
  const unitCost = Number(line.po_unit_cost || 0);
  const logisticsFee = Number(line.po_allocated_logistics_fee ?? line.po_logistics_fee ?? 0);
  const qty = Number(line.po_qty || line.expected_qty || line.received_qty || 0);
  if (qty > 0) return unitCost + (logisticsFee / qty);
  return unitCost;
}

function createBatchesForReceipt({ db, services, receipt, actor }) {
  const lines = getInboundLinesForBatchCreation(db, receipt.id);
  const pendingLines = lines.filter((line) => !line.batch_id && Number(line.received_qty || 0) > 0);
  if (!pendingLines.length) {
    throw new Error("No inbound lines are available for batch creation");
  }

  services.inventory.markBatchesCreated(receipt.id, actor);
  const batches = [];
  pendingLines.forEach((line, index) => {
    const batch = services.inventory.createBatchFromInbound({
      accountId: receipt.account_id,
      batchCode: buildBatchCode(receipt.receipt_no, line, index),
      skuId: line.sku_id,
      poId: receipt.po_id,
      inboundReceiptId: receipt.id,
      receivedQty: line.received_qty,
      unitLandedCost: calculateLineLandedCost(line),
      locationCode: optionalString(line.locationCode),
      actor,
    });

    db.prepare(`
      UPDATE erp_inbound_receipt_lines
      SET batch_id = @batch_id
      WHERE id = @id
    `).run({
      id: line.id,
      batch_id: batch.id,
    });

    batches.push(toCamelRow(batch));
  });

  if (receipt.po_id) {
    syncPurchaseReceivedQtyFromInbound(db, receipt.po_id);
    let po = getPurchaseOrder(db, receipt.po_id);
    if (["paid", "supplier_processing", "shipped"].includes(po.status)) {
      try {
        services.purchase.markArrived(po.id, actor);
        po = getPurchaseOrder(db, receipt.po_id);
        writePurchaseOrderFlowEvent(db, po, actor, "mark_arrived", `采购单已到仓：${po.po_no || po.id}`);
      } catch {}
    }
    const qtySummary = getPurchaseOrderQtySummary(db, po.id);
    if (po.status === "arrived" && qtySummary.totalQty > 0 && qtySummary.receivedQty >= qtySummary.totalQty) {
      services.purchase.markInbounded(po.id, actor);
      po = getPurchaseOrder(db, receipt.po_id);
      writePurchaseOrderFlowEvent(db, po, actor, "mark_inbounded", `采购单已完成入库：${po.po_no || po.id}`);
    }
  }

  writeInboundReceiptFlowEvent(
    db,
    receipt,
    actor,
    "create_batches",
    `仓库创建入库批次：${receipt.receipt_no || receipt.id}（${batches.length} 个）`,
  );

  return batches;
}

function syncInboundLineExpectedQty(db, receiptId) {
  db.prepare(`
    UPDATE erp_inbound_receipt_lines
    SET expected_qty = COALESCE(
      (SELECT pol.qty FROM erp_purchase_order_lines pol WHERE pol.id = erp_inbound_receipt_lines.po_line_id),
      expected_qty
    )
    WHERE receipt_id = ?
  `).run(receiptId);
}

function fillInboundLineReceivedQty(db, receiptId) {
  db.prepare(`
    UPDATE erp_inbound_receipt_lines
    SET received_qty = CASE WHEN COALESCE(received_qty, 0) > 0 THEN received_qty ELSE COALESCE(expected_qty, 0) END
    WHERE receipt_id = ?
  `).run(receiptId);
}

function syncPurchaseReceivedQtyFromInbound(db, poId) {
  if (!poId) return;
  db.prepare(`
    UPDATE erp_purchase_order_lines
    SET received_qty = COALESCE((
      SELECT SUM(line.received_qty)
      FROM erp_inbound_receipt_lines line
      JOIN erp_inbound_receipts receipt ON receipt.id = line.receipt_id
      WHERE line.po_line_id = erp_purchase_order_lines.id
        AND receipt.status IN ('counted', 'inbounded_pending_qc', 'quantity_mismatch', 'damaged', 'exception')
    ), 0)
    WHERE po_id = ?
  `).run(poId);
}

function getInboundReceiptIssueSummary(db, receiptId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(shortage_qty), 0) AS shortage_qty,
      COALESCE(SUM(over_qty), 0) AS over_qty,
      COALESCE(SUM(damaged_qty), 0) AS damaged_qty
    FROM erp_inbound_receipt_lines
    WHERE receipt_id = ?
  `).get(receiptId) || {};
  return {
    shortageQty: Number(row.shortage_qty || 0),
    overQty: Number(row.over_qty || 0),
    damagedQty: Number(row.damaged_qty || 0),
  };
}

function hasInboundReceiptIssue(issue = {}) {
  return Number(issue.shortageQty || 0) > 0
    || Number(issue.overQty || 0) > 0
    || Number(issue.damagedQty || 0) > 0;
}

function syncPurchaseAfterInboundReceipt(db, services, receipt, actor, options = {}) {
  if (!receipt?.po_id) return;
  syncPurchaseReceivedQtyFromInbound(db, receipt.po_id);
  let po = getPurchaseOrder(db, receipt.po_id);
  if (["paid", "supplier_processing", "shipped"].includes(po.status)) {
    try {
      services.purchase.markArrived(po.id, actor);
      po = getPurchaseOrder(db, receipt.po_id);
      writePurchaseOrderFlowEvent(db, po, actor, "mark_arrived", `采购单已到仓：${po.po_no || po.id}`);
    } catch {}
  }
  if (!options.allowMarkInbounded) return;
  const qtySummary = getPurchaseOrderQtySummary(db, po.id);
  if (po.status === "arrived" && qtySummary.totalQty > 0 && qtySummary.receivedQty >= qtySummary.totalQty) {
    services.purchase.markInbounded(po.id, actor);
    po = getPurchaseOrder(db, receipt.po_id);
    writePurchaseOrderFlowEvent(db, po, actor, "mark_inbounded", `采购单已完成入库：${po.po_no || po.id}`);
  }
}

function completeInboundReceiptWithoutBatch({ db, services, receipt, actor }) {
  let current = receipt;
  let batches = [];
  if (current.status === "pending_arrival") {
    services.inventory.registerArrival(current.id, actor);
    writeInboundReceiptFlowEvent(db, current, actor, "register_arrival", `仓库确认到仓：${current.receipt_no || current.id}`);
    current = getInboundReceipt(db, current.id);
  }
  if (current.status === "arrived") {
    services.inventory.confirmCount(current.id, actor);
    writeInboundReceiptFlowEvent(db, current, actor, "confirm_count", `仓库确认实收：${current.receipt_no || current.id}`);
    current = getInboundReceipt(db, current.id);
  }
  const issue = getInboundReceiptIssueSummary(db, current.id);
  if (hasInboundReceiptIssue(issue)) {
    if (Number(issue.damagedQty || 0) > 0) {
      services.inventory.markDamaged(current.id, actor);
      writeInboundReceiptFlowEvent(db, current, actor, "mark_damaged", `入库发现破损：${current.receipt_no || current.id}`);
    } else {
      services.inventory.markQuantityMismatch(current.id, actor);
      writeInboundReceiptFlowEvent(db, current, actor, "mark_quantity_mismatch", `入库数量异常：${current.receipt_no || current.id}`);
    }
    current = getInboundReceipt(db, current.id);
    syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: false });
    return { receipt: toCamelRow(current), batches: [], issue };
  }
  if (current.status === "counted") {
    writeInboundReceiptFlowEvent(db, current, actor, "confirm_inbound", `仓库确认入库：${current.receipt_no || current.id}`);
    batches = createBatchesForReceipt({ db, services, receipt: current, actor });
    current = getInboundReceipt(db, current.id);
  }

  syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: true });

  return { receipt: toCamelRow(current), batches };
}

function registerInboundReceiptArrivalWithoutBatch({ db, services, receipt, actor }) {
  let current = receipt;
  if (current.status !== "pending_arrival") {
    return { receipt: toCamelRow(current), batches: [] };
  }
  services.inventory.registerArrival(current.id, actor);
  writeInboundReceiptFlowEvent(db, current, actor, "register_arrival", `仓库确认到仓：${current.receipt_no || current.id}`);
  current = getInboundReceipt(db, current.id);
  syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: false });
  return { receipt: toCamelRow(current), batches: [] };
}

function confirmInboundReceiptCountWithoutBatch({ db, services, receipt, actor }) {
  let current = receipt;
  if (current.status !== "arrived") {
    throw new Error("请先确认到仓后再核数");
  }
  services.inventory.confirmCount(current.id, actor);
  writeInboundReceiptFlowEvent(db, current, actor, "confirm_count", `仓库确认实收：${current.receipt_no || current.id}`);
  current = getInboundReceipt(db, current.id);
  const issue = getInboundReceiptIssueSummary(db, current.id);
  if (hasInboundReceiptIssue(issue)) {
    if (Number(issue.damagedQty || 0) > 0) {
      services.inventory.markDamaged(current.id, actor);
      writeInboundReceiptFlowEvent(db, current, actor, "mark_damaged", `入库发现破损：${current.receipt_no || current.id}`);
    } else {
      services.inventory.markQuantityMismatch(current.id, actor);
      writeInboundReceiptFlowEvent(db, current, actor, "mark_quantity_mismatch", `入库数量异常：${current.receipt_no || current.id}`);
    }
    current = getInboundReceipt(db, current.id);
    syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: false });
    return { receipt: toCamelRow(current), batches: [], issue };
  }
  syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: false });
  return { receipt: toCamelRow(current), batches: [], issue };
}

function confirmInboundReceiptFinalWithoutBatch({ db, services, receipt, actor }) {
  let current = receipt;
  if (current.status !== "counted") {
    throw new Error("请先完成核数后再确认入库");
  }
  const issue = getInboundReceiptIssueSummary(db, current.id);
  if (hasInboundReceiptIssue(issue)) {
    if (Number(issue.damagedQty || 0) > 0) {
      services.inventory.markDamaged(current.id, actor);
      writeInboundReceiptFlowEvent(db, current, actor, "mark_damaged", `入库发现破损：${current.receipt_no || current.id}`);
    } else {
      services.inventory.markQuantityMismatch(current.id, actor);
      writeInboundReceiptFlowEvent(db, current, actor, "mark_quantity_mismatch", `入库数量异常：${current.receipt_no || current.id}`);
    }
    current = getInboundReceipt(db, current.id);
    syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: false });
    return { receipt: toCamelRow(current), batches: [], issue };
  }
  writeInboundReceiptFlowEvent(db, current, actor, "confirm_inbound", `仓库确认入库：${current.receipt_no || current.id}`);
  const batches = createBatchesForReceipt({ db, services, receipt: current, actor });
  current = getInboundReceipt(db, current.id);
  syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: true });
  return { receipt: toCamelRow(current), batches };
}

function advanceInboundReceiptOneStepWithoutBatch({ db, services, receipt, actor }) {
  const current = receipt;
  if (current.status === "pending_arrival") {
    return registerInboundReceiptArrivalWithoutBatch({ db, services, receipt: current, actor });
  }
  if (current.status === "arrived") {
    syncInboundLineExpectedQty(db, current.id);
    fillInboundLineReceivedQty(db, current.id);
    return confirmInboundReceiptCountWithoutBatch({
      db,
      services,
      receipt: getInboundReceipt(db, current.id),
      actor,
    });
  }
  if (current.status === "counted") {
    return confirmInboundReceiptFinalWithoutBatch({ db, services, receipt: current, actor });
  }
  throw new Error(`${current.status || "当前状态"}不可批量处理`);
}

function resolveInboundExceptionWithoutBatch({ db, services, receipt, actor, resolutionRemark }) {
  let current = receipt;
  if (!["quantity_mismatch", "damaged", "exception"].includes(current.status)) {
    return completeInboundReceiptWithoutBatch({ db, services, receipt: current, actor });
  }
  const remark = requireString(resolutionRemark, "处理说明").slice(0, 500);
  services.inventory.resolveInboundException(current.id, actor);
  writeInboundReceiptFlowEvent(
    db,
    current,
    actor,
    "resolve_inbound_exception",
    `入库异常已处理：${current.receipt_no || current.id}（${remark}）`,
  );
  current = getInboundReceipt(db, current.id);
  syncPurchaseAfterInboundReceipt(db, services, current, actor, { allowMarkInbounded: true });
  return {
    receipt: toCamelRow(current),
    batches: [],
    issue: getInboundReceiptIssueSummary(db, current.id),
  };
}

function normalizeInboundEditQty(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : Math.max(0, Math.floor(Number(fallback || 0)));
}

function normalizeInboundReceiptEditStatus(value, fallback) {
  const status = optionalString(value || fallback);
  if (!INBOUND_RECEIPT_EDIT_STATUSES.has(status)) {
    throw new Error(`不支持的入库单状态: ${status || "空"}`);
  }
  return status;
}

function updateInboundReceiptManual({ db, receipt, payload = {}, actor = {} }) {
  assertActorRole(actor, ["warehouse", "manager", "admin"], "修改入库单");
  const now = nowIso();
  const nextStatus = normalizeInboundReceiptEditStatus(payload.status, receipt.status);
  const hasReceivedAt = payload.receivedAt !== undefined || payload.received_at !== undefined;
  const receivedAt = hasReceivedAt ? optionalString(payload.receivedAt ?? payload.received_at) : (receipt.received_at || null);
  const warehouseName = payload.warehouseName !== undefined || payload.warehouse_name !== undefined
    ? optionalString(payload.warehouseName || payload.warehouse_name)
    : undefined;
  const logisticsCompany = payload.logisticsCompany !== undefined || payload.logistics_company !== undefined
    ? optionalString(payload.logisticsCompany || payload.logistics_company)
    : undefined;
  const trackingNo = payload.trackingNo !== undefined || payload.tracking_no !== undefined
    ? optionalString(payload.trackingNo || payload.tracking_no)
    : undefined;
  const sourceStatus = payload.sourceStatus !== undefined || payload.source_status !== undefined
    ? optionalString(payload.sourceStatus || payload.source_status)
    : undefined;
  const sourceRemark = payload.sourceRemark !== undefined || payload.source_remark !== undefined
    ? optionalString(payload.sourceRemark || payload.source_remark)
    : undefined;
  const remark = parseJsonObject(receipt.remark, {});
  if (remark.sourceStatus && !remark.sourceOriginalStatus) remark.sourceOriginalStatus = remark.sourceStatus;
  if (sourceStatus !== undefined) {
    remark.sourceStatus = sourceStatus;
  } else if (remark.source) {
    remark.sourceStatus = INBOUND_SOURCE_STATUS_BY_STATUS[nextStatus] || remark.sourceStatus || null;
  }
  if (sourceRemark !== undefined) remark.sourceRemark = sourceRemark;
  if (warehouseName !== undefined) remark.warehouse = warehouseName || JUSHUITAN_WAREHOUSE_NAME;
  if (logisticsCompany !== undefined) remark.logisticsCompany = logisticsCompany;
  if (trackingNo !== undefined) remark.trackingNo = trackingNo;
  remark.editedAt = now;
  remark.editedBy = actor?.name || actor?.id || actor?.role || "unknown";

  const linesPayload = Array.isArray(payload.lines) ? payload.lines : [];
  if (linesPayload.length) {
    const batchCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM erp_inbound_receipt_lines
      WHERE receipt_id = ? AND batch_id IS NOT NULL
    `).get(receipt.id)?.count || 0;
    if (Number(batchCount || 0) > 0) {
      throw new Error("该入库单已生成库存批次，不能直接修改数量，请先走库存调整");
    }
    const existingLines = db.prepare(`
      SELECT id, expected_qty, received_qty, damaged_qty
      FROM erp_inbound_receipt_lines
      WHERE receipt_id = ?
    `).all(receipt.id);
    const existingLineIds = new Set(existingLines.map((line) => line.id));
    const updateLine = db.prepare(`
      UPDATE erp_inbound_receipt_lines
      SET expected_qty = @expected_qty,
          received_qty = @received_qty,
          damaged_qty = @damaged_qty,
          shortage_qty = @shortage_qty,
          over_qty = @over_qty
      WHERE id = @id AND receipt_id = @receipt_id
    `);
    for (const line of linesPayload) {
      const id = optionalString(line.id);
      if (!id || !existingLineIds.has(id)) continue;
      const expectedQty = normalizeInboundEditQty(line.expectedQty ?? line.expected_qty, 0);
      const receivedQty = normalizeInboundEditQty(line.receivedQty ?? line.received_qty, expectedQty);
      const damagedQty = normalizeInboundEditQty(line.damagedQty ?? line.damaged_qty, 0);
      updateLine.run({
        id,
        receipt_id: receipt.id,
        expected_qty: expectedQty,
        received_qty: receivedQty,
        damaged_qty: damagedQty,
        shortage_qty: Math.max(0, expectedQty - receivedQty),
        over_qty: Math.max(0, receivedQty - expectedQty),
      });
    }
  }

  db.prepare(`
    UPDATE erp_inbound_receipts
    SET status = @status,
        received_at = @received_at,
        operator_id = @operator_id,
        remark = @remark,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: receipt.id,
    status: nextStatus,
    received_at: receivedAt,
    operator_id: actor?.id || receipt.operator_id || null,
    remark: JSON.stringify(remark),
    updated_at: now,
  });
  writeInboundReceiptFlowEvent(
    db,
    receipt,
    actor,
    "manual_update",
    `手动修改入库单：${receipt.receipt_no || receipt.id}`,
  );
  return {
    receipt: toCamelRow(getInboundReceipt(db, receipt.id)),
    lines: db.prepare(`
      SELECT line.id, line.receipt_id, line.po_line_id, line.sku_id,
             line.expected_qty, line.received_qty, line.damaged_qty,
             line.shortage_qty, line.over_qty,
             sku.internal_sku_code, sku.product_name,
             sku.image_url AS sku_image_url,
             sku.color_spec,
             po_line.unit_cost,
             po_line.logistics_fee
      FROM erp_inbound_receipt_lines line
      LEFT JOIN erp_skus sku ON sku.id = line.sku_id
      LEFT JOIN erp_purchase_order_lines po_line ON po_line.id = line.po_line_id
      WHERE line.receipt_id = ?
      ORDER BY line.id ASC
    `).all(receipt.id).map(toCamelRow),
    timeline: getInboundReceiptTimeline(db, receipt.id),
  };
}

function performWarehouseAction(payload = {}, actorInput = {}) {
  const { db, services } = requireErp();
  const action = requireString(payload.action, "action");
  const actor = normalizeActor(actorInput);

  const run = db.transaction(() => {
    switch (action) {
      case "register_arrival": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        return registerInboundReceiptArrivalWithoutBatch({
          db,
          services,
          receipt: getInboundReceipt(db, receiptId),
          actor,
        });
      }
      case "confirm_count": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        // 入库数量以"采购单数量"为准：先把 expected_qty 同步成 po_line.qty 的最新值。
        syncInboundLineExpectedQty(db, receiptId);
        // 如果前端提供了精细到行的数量（部分入库 / 短少 / 多到 / 破损），按行更新；
        // 否则按 expected 自动充满（旧的简化路径）。
        const linesPayload = Array.isArray(payload.lines) ? payload.lines : null;
        if (linesPayload && linesPayload.length) {
          const updateLine = db.prepare(`
            UPDATE erp_inbound_receipt_lines
            SET received_qty = @received_qty,
                damaged_qty = @damaged_qty,
                shortage_qty = @shortage_qty,
                over_qty = @over_qty
            WHERE id = @id AND receipt_id = @receipt_id
          `);
          for (const ln of linesPayload) {
            const lineId = optionalString(ln.id);
            if (!lineId) continue;
            const expectedRow = db.prepare(
              "SELECT expected_qty FROM erp_inbound_receipt_lines WHERE id = ? AND receipt_id = ?"
            ).get(lineId, receiptId);
            const expected = Math.max(0, Math.floor(Number(expectedRow?.expected_qty || 0)));
            const received = Math.max(0, Math.floor(Number(ln.received_qty ?? 0)));
            const damaged = Math.max(0, Math.floor(Number(ln.damaged_qty ?? 0)));
            const shortage = Math.max(0, expected - received);
            const over = Math.max(0, received - expected);
            updateLine.run({
              id: lineId,
              receipt_id: receiptId,
              received_qty: received,
              damaged_qty: damaged,
              shortage_qty: shortage,
              over_qty: over,
            });
          }
        } else {
          fillInboundLineReceivedQty(db, receiptId);
        }
        return confirmInboundReceiptCountWithoutBatch({
          db,
          services,
          receipt: getInboundReceipt(db, receiptId),
          actor,
        });
      }
      case "confirm_inbound": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        return confirmInboundReceiptFinalWithoutBatch({
          db,
          services,
          receipt: getInboundReceipt(db, receiptId),
          actor,
        });
      }
      case "confirm_inbound_bulk": {
        const receiptIds = Array.from(new Set(
          (Array.isArray(payload.receiptIds) ? payload.receiptIds : [])
            .map((id) => optionalString(id))
            .filter(Boolean),
        ));
        if (!receiptIds.length) throw new Error("请选择要入库的单据");
        const receipts = [];
        const actionCounts = { register_arrival: 0, confirm_count: 0, confirm_inbound: 0 };
        receiptIds.forEach((receiptId) => {
          const before = getInboundReceipt(db, receiptId);
          if (before.status === "pending_arrival") actionCounts.register_arrival += 1;
          if (before.status === "arrived") actionCounts.confirm_count += 1;
          if (before.status === "counted") actionCounts.confirm_inbound += 1;
          const result = advanceInboundReceiptOneStepWithoutBatch({
            db,
            services,
            receipt: before,
            actor,
          });
          receipts.push(result.receipt);
        });
        return { receipts, count: receipts.length, actionCounts, batches: [] };
      }
      case "resolve_inbound_exception": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        return resolveInboundExceptionWithoutBatch({
          db,
          services,
          receipt: getInboundReceipt(db, receiptId),
          actor,
          resolutionRemark: payload.resolutionRemark || payload.resolution_remark || payload.remark,
        });
      }
      case "update_inbound_receipt": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        return updateInboundReceiptManual({
          db,
          receipt: getInboundReceipt(db, receiptId),
          payload,
          actor,
        });
      }
      case "get_inbound_lines": {
        // 给前端拉某入库单的明细行，用于"按实数入库"Modal 渲染。
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        const lines = db.prepare(`
          SELECT line.id, line.receipt_id, line.po_line_id, line.sku_id,
                 line.expected_qty, line.received_qty, line.damaged_qty,
                 line.shortage_qty, line.over_qty,
                 sku.internal_sku_code, sku.product_name,
                 sku.image_url AS sku_image_url,
                 sku.color_spec,
                 po_line.unit_cost,
                 po_line.logistics_fee,
                 source.external_offer_id
          FROM erp_inbound_receipt_lines line
          LEFT JOIN erp_skus sku ON sku.id = line.sku_id
          LEFT JOIN erp_purchase_order_lines po_line ON po_line.id = line.po_line_id
          LEFT JOIN erp_sku_1688_sources source ON source.id = (
            SELECT source_one.id
            FROM erp_sku_1688_sources source_one
            WHERE source_one.account_id = line.account_id
              AND source_one.sku_id = line.sku_id
              AND source_one.status = 'active'
            ORDER BY source_one.is_default DESC, source_one.updated_at DESC, source_one.created_at DESC
            LIMIT 1
          )
          WHERE line.receipt_id = ?
          ORDER BY line.id ASC
        `).all(receiptId);
        return {
          lines: lines.map(toCamelRow),
          timeline: getInboundReceiptTimeline(db, receiptId),
        };
      }
      case "get_inbound_logistics": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        const receipt = db.prepare(`
          SELECT
            receipt.id, receipt.receipt_no, receipt.po_id, receipt.remark,
            po.po_no, po.external_order_id,
            po.external_logistics_json AS po_external_logistics_json,
            po.external_logistics_synced_at AS po_external_logistics_synced_at,
            supplier.name AS supplier_name
          FROM erp_inbound_receipts receipt
          LEFT JOIN erp_purchase_orders po ON po.id = receipt.po_id
          LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
          WHERE receipt.id = ?
          LIMIT 1
        `).get(receiptId);
        if (!receipt) throw new Error(`Inbound receipt not found: ${receiptId}`);
        return {
          logistics: extractInboundLogisticsDetail(receipt),
        };
      }
      case "create_batches": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        syncInboundLineExpectedQty(db, receiptId);
        fillInboundLineReceivedQty(db, receiptId);
        return completeInboundReceiptWithoutBatch({
          db,
          services,
          receipt: getInboundReceipt(db, receiptId),
          actor,
        });
      }
      default:
        throw new Error(`Unsupported warehouse action: ${action}`);
    }
  });

  const result = run();
  if (action === "get_inbound_lines" || action === "get_inbound_logistics") {
    return {
      action,
      result,
    };
  }
  return {
    action,
    result,
    workbench: getWarehouseWorkbench(payload),
  };
}

function getQcWorkbench(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId);
  const limit = normalizeLimit(params.limit, 50);
  const batchWhereAccount = accountId ? "AND batch.account_id = @account_id" : "";
  const inspectionWhereAccount = accountId ? "WHERE qc.account_id = @account_id" : "";
  const baseParams = {
    account_id: accountId,
    limit,
  };

  const pendingBatches = db.prepare(`
    SELECT
      batch.*,
      sku.internal_sku_code,
      sku.product_name,
      receipt.receipt_no,
      po.po_no,
      supplier.name AS supplier_name,
      qc.id AS qc_id,
      qc.status AS qc_status_value,
      qc.suggested_sample_qty,
      qc.actual_sample_qty,
      qc.defective_qty AS qc_defective_qty,
      qc.defect_rate,
      qc.release_qty,
      qc.blocked_qty AS qc_blocked_qty,
      qc.rework_qty AS qc_rework_qty,
      inspector.name AS inspector_name
    FROM erp_inventory_batches batch
    LEFT JOIN erp_skus sku ON sku.id = batch.sku_id
    LEFT JOIN erp_inbound_receipts receipt ON receipt.id = batch.inbound_receipt_id
    LEFT JOIN erp_purchase_orders po ON po.id = batch.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_qc_inspections qc ON qc.id = (
      SELECT latest.id
      FROM erp_qc_inspections latest
      WHERE latest.batch_id = batch.id
      ORDER BY latest.updated_at DESC
      LIMIT 1
    )
    LEFT JOIN erp_users inspector ON inspector.id = qc.inspector_id
    WHERE (
      batch.qc_status = 'pending'
      OR qc.status IN ('pending_qc', 'in_progress')
    )
    ${batchWhereAccount}
    ORDER BY
      CASE COALESCE(qc.status, batch.qc_status)
        WHEN 'in_progress' THEN 0
        WHEN 'pending_qc' THEN 1
        WHEN 'pending' THEN 2
        ELSE 9
      END,
      batch.created_at DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const inspections = db.prepare(`
    SELECT
      qc.*,
      sku.internal_sku_code,
      sku.product_name,
      batch.batch_code,
      batch.received_qty,
      batch.available_qty,
      batch.blocked_qty AS batch_blocked_qty,
      batch.qc_status AS batch_qc_status,
      inspector.name AS inspector_name
    FROM erp_qc_inspections qc
    LEFT JOIN erp_inventory_batches batch ON batch.id = qc.batch_id
    LEFT JOIN erp_skus sku ON sku.id = qc.sku_id
    LEFT JOIN erp_users inspector ON inspector.id = qc.inspector_id
    ${inspectionWhereAccount}
    ORDER BY
      CASE qc.status
        WHEN 'pending_qc' THEN 0
        WHEN 'in_progress' THEN 1
        WHEN 'partial_passed' THEN 2
        WHEN 'failed' THEN 3
        WHEN 'passed_with_observation' THEN 4
        WHEN 'passed' THEN 5
        ELSE 9
      END,
      qc.updated_at DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const summary = {
    pendingBatchCount: pendingBatches.length,
    inspectionCount: inspections.length,
    inProgressCount: inspections.filter((item) => item.status === "in_progress").length,
    pendingQcCount: inspections.filter((item) => item.status === "pending_qc").length,
    completedCount: inspections.filter((item) => (
      ["passed", "passed_with_observation", "partial_passed", "failed", "rework_required"].includes(item.status)
    )).length,
    blockedQty: pendingBatches.reduce((sum, item) => sum + Number(item.blockedQty || 0), 0),
  };

  return {
    generatedAt: nowIso(),
    summary,
    pendingBatches,
    inspections,
  };
}

function getInventoryBatch(db, batchId) {
  const row = db.prepare("SELECT * FROM erp_inventory_batches WHERE id = ?").get(batchId);
  if (!row) throw new Error(`Inventory batch not found: ${batchId}`);
  return row;
}

function getQcInspection(db, qcId) {
  const row = db.prepare("SELECT * FROM erp_qc_inspections WHERE id = ?").get(qcId);
  if (!row) throw new Error(`QC inspection not found: ${qcId}`);
  return row;
}

function findLatestQcInspectionForBatch(db, batchId) {
  return db.prepare(`
    SELECT *
    FROM erp_qc_inspections
    WHERE batch_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(batchId) || null;
}

function suggestedSampleQtyForBatch(batch) {
  const receivedQty = Number(batch.received_qty || 0);
  if (receivedQty <= 0) return 0;
  return Math.max(1, Math.min(20, Math.ceil(receivedQty * 0.1)));
}

function createQcInspectionForBatch({ db, services, batch, actor }) {
  const now = nowIso();
  const row = {
    id: createId("qc"),
    account_id: batch.account_id,
    batch_id: batch.id,
    sku_id: batch.sku_id,
    status: "pending_qc",
    suggested_sample_qty: suggestedSampleQtyForBatch(batch),
    actual_sample_qty: 0,
    defective_qty: 0,
    defect_rate: 0,
    defect_types_json: "[]",
    release_qty: 0,
    blocked_qty: 0,
    rework_qty: 0,
    photos_json: "[]",
    inspector_id: actor.id || null,
    remark: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_qc_inspections (
      id, account_id, batch_id, sku_id, status, suggested_sample_qty,
      actual_sample_qty, defective_qty, defect_rate, defect_types_json,
      release_qty, blocked_qty, rework_qty, photos_json, inspector_id,
      remark, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @batch_id, @sku_id, @status, @suggested_sample_qty,
      @actual_sample_qty, @defective_qty, @defect_rate, @defect_types_json,
      @release_qty, @blocked_qty, @rework_qty, @photos_json, @inspector_id,
      @remark, @created_at, @updated_at
    )
  `).run(row);

  const after = getQcInspection(db, row.id);
  services.workflow.writeAudit({
    accountId: after.account_id,
    actor,
    action: "create_qc_inspection",
    entityType: "qc_inspection",
    entityId: after.id,
    before: null,
    after,
  });
  return after;
}

function getOrCreateQcInspection({ db, services, payload, actor }) {
  const qcId = optionalString(payload.qcId || payload.id);
  if (qcId) return getQcInspection(db, qcId);

  const batchId = requireString(payload.batchId, "batchId");
  const existing = findLatestQcInspectionForBatch(db, batchId);
  if (existing) return existing;

  const batch = getInventoryBatch(db, batchId);
  if (batch.qc_status !== "pending") {
    throw new Error(`Batch is not pending QC: ${batch.qc_status}`);
  }
  return createQcInspectionForBatch({
    db,
    services,
    batch,
    actor,
  });
}

function performQcAction(payload = {}, actorInput = {}) {
  const { db, services } = requireErp();
  const action = requireString(payload.action, "action");
  const actor = normalizeActor(actorInput);

  const run = db.transaction(() => {
    switch (action) {
      case "start_qc": {
        const inspection = getOrCreateQcInspection({ db, services, payload, actor });
        if (inspection.status === "in_progress") return { inspection: toCamelRow(inspection) };
        const transition = services.qc.startInspection(inspection.id, actor);
        return { transition };
      }
      case "submit_qc_percent": {
        let inspection = getOrCreateQcInspection({ db, services, payload, actor });
        if (inspection.status === "pending_qc") {
          services.qc.startInspection(inspection.id, actor);
          inspection = getQcInspection(db, inspection.id);
        }
        const result = services.qc.submitByPercent({
          id: inspection.id,
          actualSampleQty: Number(payload.actualSampleQty),
          defectiveQty: Number(payload.defectiveQty),
          remark: optionalString(payload.remark),
          actor,
        });
        return {
          decision: {
            defectRate: result.defectRate,
            recommendedStatus: result.recommendedStatus,
            priority: result.priority || null,
          },
          releasePlan: result.releasePlan,
          batch: toCamelRow(result.batch),
          transition: result.transition,
        };
      }
      default:
        throw new Error(`Unsupported QC action: ${action}`);
    }
  });

  const result = run();
  return {
    action,
    result,
    workbench: getQcWorkbench({ limit: payload.limit }),
  };
}

function getOutboundWorkbench(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId);
  const limit = normalizeLimit(params.limit, 50);
  const batchWhereAccount = accountId ? "AND batch.account_id = @account_id" : "";
  const shipmentWhereAccount = accountId ? "WHERE shipment.account_id = @account_id" : "";
  const baseParams = {
    account_id: accountId,
    limit,
  };

  const availableBatches = db.prepare(`
    SELECT
      batch.*,
      sku.internal_sku_code,
      sku.product_name,
      receipt.receipt_no,
      po.po_no,
      supplier.name AS supplier_name
    FROM erp_inventory_batches batch
    LEFT JOIN erp_skus sku ON sku.id = batch.sku_id
    LEFT JOIN erp_inbound_receipts receipt ON receipt.id = batch.inbound_receipt_id
    LEFT JOIN erp_purchase_orders po ON po.id = batch.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    WHERE batch.available_qty > 0
      AND batch.qc_status IN ('passed', 'passed_with_observation', 'partial_passed')
      ${batchWhereAccount}
    ORDER BY batch.updated_at DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const outboundShipments = db.prepare(`
    SELECT
      shipment.*,
      sku.internal_sku_code,
      sku.product_name,
      batch.batch_code,
      batch.available_qty AS batch_available_qty,
      batch.reserved_qty AS batch_reserved_qty,
      warehouse_user.name AS warehouse_operator_name,
      confirmed_user.name AS confirmed_by_name
    FROM erp_outbound_shipments shipment
    LEFT JOIN erp_skus sku ON sku.id = shipment.sku_id
    LEFT JOIN erp_inventory_batches batch ON batch.id = shipment.batch_id
    LEFT JOIN erp_users warehouse_user ON warehouse_user.id = shipment.warehouse_operator_id
    LEFT JOIN erp_users confirmed_user ON confirmed_user.id = shipment.confirmed_by
    ${shipmentWhereAccount}
    ORDER BY
      CASE shipment.status
        WHEN 'pending_warehouse' THEN 0
        WHEN 'picking' THEN 1
        WHEN 'packed' THEN 2
        WHEN 'shipped_out' THEN 3
        WHEN 'pending_ops_confirm' THEN 4
        WHEN 'draft' THEN 5
        WHEN 'confirmed' THEN 6
        ELSE 9
      END,
      shipment.updated_at DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const summary = {
    availableBatchCount: availableBatches.length,
    availableQty: availableBatches.reduce((sum, item) => sum + Number(item.availableQty || 0), 0),
    outboundShipmentCount: outboundShipments.length,
    pendingWarehouseCount: outboundShipments.filter((item) => item.status === "pending_warehouse").length,
    pickingCount: outboundShipments.filter((item) => item.status === "picking").length,
    packedCount: outboundShipments.filter((item) => item.status === "packed").length,
    pendingOpsConfirmCount: outboundShipments.filter((item) => item.status === "pending_ops_confirm").length,
    confirmedCount: outboundShipments.filter((item) => item.status === "confirmed").length,
  };

  return {
    generatedAt: nowIso(),
    summary,
    availableBatches,
    outboundShipments,
  };
}

function getOutboundShipment(db, outboundId) {
  const row = db.prepare("SELECT * FROM erp_outbound_shipments WHERE id = ?").get(outboundId);
  if (!row) throw new Error(`Outbound shipment not found: ${outboundId}`);
  return row;
}

function buildShipmentNo() {
  const stamp = new Date().toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `OUT-${stamp}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function readFlatField(primary = {}, fallback = {}, keys = []) {
  for (const key of keys) {
    if (primary && Object.prototype.hasOwnProperty.call(primary, key)) return primary[key];
  }
  for (const key of keys) {
    if (fallback && Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
  }
  return null;
}

function positiveInteger(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.floor(number);
  return integer > 0 ? integer : fallback;
}

function normalizeTemuStockOrderPayload(payload = {}) {
  const stockOrder = payload.stockOrder && typeof payload.stockOrder === "object"
    ? payload.stockOrder
    : {};
  const readString = (keys) => optionalString(readFlatField(stockOrder, payload, keys));
  const readNumber = (keys) => positiveInteger(readFlatField(stockOrder, payload, keys));
  const demandQty = readNumber(["demandQty", "demand_qty", "quantity", "qty", "purchaseQuantity", "purchase_quantity"]);
  const deliveredQty = readNumber(["deliveredQty", "delivered_qty", "deliveredQuantity", "delivered_quantity"], 0) || 0;
  const requestedQty = positiveInteger(payload.qty || payload.quantity, demandQty);
  return {
    stockOrderNo: readString(["stockOrderNo", "stock_order_no", "subPurchaseOrderSn", "sub_purchase_order_sn", "purchaseOrderSn", "purchase_order_sn"]),
    deliveryOrderSn: readString(["deliveryOrderSn", "delivery_order_sn", "deliveryOrderNo", "delivery_order_no"]),
    deliveryBatchSn: readString(["deliveryBatchSn", "delivery_batch_sn", "deliveryBatchNo", "delivery_batch_no"]),
    skcId: readString(["skcId", "skc_id", "productSkcId", "product_skc_id"]),
    skuId: readString(["skuId", "sku_id", "productSkuId", "product_sku_id"]),
    productId: readString(["productId", "product_id", "productSpuId", "product_spu_id", "spuId", "spu_id"]),
    skuExtCode: readString(["skuExtCode", "sku_ext_code", "internalSkuCode", "internal_sku_code", "supplierSkuCode", "supplier_sku_code"]),
    productName: readString(["productName", "product_name", "goodsName", "goods_name", "title"]),
    specName: readString(["specName", "spec_name", "skuSpecName", "sku_spec_name", "colorSpec", "color_spec"]),
    mallId: readString(["mallId", "mall_id"]),
    demandQty,
    deliveredQty,
    qty: requestedQty,
  };
}

function findTemuOutboundSku(db, { accountId, skcId, skuId, productId, skuExtCode }) {
  const account = db.prepare("SELECT id, company_id FROM erp_accounts WHERE id = ?").get(accountId);
  if (!account) throw new Error("ERP 店铺不存在，无法承接云端备货单");
  const matches = [];
  if (skcId) matches.push("sku.temu_skc_id = @skc_id");
  if (skuId) matches.push("sku.temu_sku_id = @sku_id");
  if (productId) matches.push("sku.temu_product_id = @product_id");
  if (skuExtCode) matches.push("sku.internal_sku_code = @sku_ext_code");
  if (!matches.length) {
    throw new Error("云端备货单缺少 SKC/SKU/商品编码，无法匹配本地商品");
  }
  const params = {
    account_id: account.id,
    company_id: account.company_id,
    skc_id: skcId,
    sku_id: skuId,
    product_id: productId,
    sku_ext_code: skuExtCode,
  };
  const matchSql = `(${matches.join(" OR ")})`;
  const accountSku = db.prepare(`
    SELECT sku.*
    FROM erp_skus sku
    WHERE sku.account_id = @account_id
      AND sku.status != 'deleted'
      AND ${matchSql}
    ORDER BY sku.updated_at DESC, sku.created_at DESC
    LIMIT 1
  `).get(params);
  if (accountSku) return accountSku;
  const companySku = db.prepare(`
    SELECT sku.*
    FROM erp_skus sku
    WHERE sku.account_id IS NULL
      AND sku.company_id = @company_id
      AND sku.status != 'deleted'
      AND ${matchSql}
    ORDER BY sku.updated_at DESC, sku.created_at DESC
    LIMIT 1
  `).get(params);
  if (companySku) return companySku;
  throw new Error("未找到可承接该云端备货单的本地商品，请先在商品资料补齐 Temu SKC/SKU/商品编码");
}

function findTemuOutboundBatch(db, { accountId, skuId, qty }) {
  const batch = db.prepare(`
    SELECT *
    FROM erp_inventory_batches
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND available_qty >= @qty
      AND qc_status IN ('passed', 'passed_with_observation', 'partial_passed')
    ORDER BY received_at ASC, created_at ASC
    LIMIT 1
  `).get({
    account_id: accountId,
    sku_id: skuId,
    qty,
  });
  if (batch) return batch;
  const stock = db.prepare(`
    SELECT COALESCE(SUM(available_qty), 0) AS available_qty
    FROM erp_inventory_batches
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND qc_status IN ('passed', 'passed_with_observation', 'partial_passed')
  `).get({
    account_id: accountId,
    sku_id: skuId,
  });
  throw new Error(`可用库存不足，当前可用 ${Number(stock?.available_qty || 0)}，需要 ${qty}`);
}

function selectTemuOutboundBatches(db, { accountId, skuId, qty }) {
  const rows = db.prepare(`
    SELECT *
    FROM erp_inventory_batches
    WHERE account_id = @account_id
      AND sku_id = @sku_id
      AND available_qty > 0
      AND qc_status IN ('passed', 'passed_with_observation', 'partial_passed')
    ORDER BY received_at ASC, created_at ASC, id ASC
  `).all({
    account_id: accountId,
    sku_id: skuId,
  });
  let remaining = qty;
  let availableQty = 0;
  const batches = [];
  for (const row of rows) {
    const available = Math.max(0, Math.floor(Number(row.available_qty || 0)));
    availableQty += available;
    if (remaining <= 0) continue;
    const take = Math.min(available, remaining);
    if (take > 0) {
      batches.push({ batch: row, qty: take });
      remaining -= take;
    }
  }
  return {
    availableQty,
    batches,
    shortageQty: Math.max(0, remaining),
  };
}

function buildTemuOutboundIdentityConditions(stockOrder = {}) {
  const conditions = [];
  const params = {
    temu_stock_order_no: stockOrder.stockOrderNo,
    temu_delivery_order_sn: stockOrder.deliveryOrderSn,
    temu_delivery_batch_sn: stockOrder.deliveryBatchSn,
  };
  if (stockOrder.stockOrderNo) conditions.push("shipment.temu_stock_order_no = @temu_stock_order_no");
  if (stockOrder.deliveryOrderSn) conditions.push("shipment.temu_delivery_order_sn = @temu_delivery_order_sn");
  if (stockOrder.deliveryBatchSn) conditions.push("shipment.temu_delivery_batch_sn = @temu_delivery_batch_sn");
  return { conditions, params };
}

function getExistingTemuOutboundShipments(db, { accountId = null, skuId = null, stockOrder }) {
  const { conditions, params } = buildTemuOutboundIdentityConditions(stockOrder);
  if (!conditions.length) return [];
  if (accountId) params.account_id = accountId;
  if (skuId) params.sku_id = skuId;
  const scope = [];
  if (accountId) scope.push("shipment.account_id = @account_id");
  if (skuId) scope.push("shipment.sku_id = @sku_id");
  return db.prepare(`
    SELECT
      shipment.*,
      batch.batch_code,
      batch.available_qty AS batch_available_qty,
      batch.reserved_qty AS batch_reserved_qty
    FROM erp_outbound_shipments shipment
    LEFT JOIN erp_inventory_batches batch ON batch.id = shipment.batch_id
    WHERE shipment.status != 'cancelled'
      ${scope.length ? `AND ${scope.join(" AND ")}` : ""}
      AND (${conditions.join(" OR ")})
    ORDER BY shipment.created_at ASC, shipment.id ASC
  `).all(params);
}

function previewTemuStockOrderOutbound({ db, payload }) {
  const accountId = requireString(payload.accountId || payload.account_id, "accountId");
  const stockOrder = normalizeTemuStockOrderPayload(payload);
  const requestedQty = positiveInteger(payload.qty || payload.quantity, stockOrder.qty);
  if (!requestedQty) throw new Error("出库数量必须大于 0");
  const demandRemainingQty = stockOrder.demandQty
    ? Math.max(0, Number(stockOrder.demandQty || 0) - Number(stockOrder.deliveredQty || 0))
    : null;
  if (demandRemainingQty !== null && requestedQty > demandRemainingQty) {
    throw new Error(`出库数量不能超过 Temu 剩余需求：${demandRemainingQty}`);
  }
  const existingRowsAcrossAccounts = getExistingTemuOutboundShipments(db, { stockOrder });
  const existingQtyAcrossAccounts = existingRowsAcrossAccounts.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  if (existingQtyAcrossAccounts >= requestedQty) {
    return {
      stockOrder,
      requestedQty,
      demandRemainingQty,
      matchedSku: null,
      existingQty: existingQtyAcrossAccounts,
      remainingQty: 0,
      existingShipments: existingRowsAcrossAccounts.map(toCamelRow),
      availableQty: 0,
      shortageQty: 0,
      allocationPlan: [],
    };
  }
  const sku = findTemuOutboundSku(db, {
    accountId,
    skcId: stockOrder.skcId,
    skuId: stockOrder.skuId,
    productId: stockOrder.productId,
    skuExtCode: stockOrder.skuExtCode,
  });
  const existingRows = existingRowsAcrossAccounts.length
    ? existingRowsAcrossAccounts
    : getExistingTemuOutboundShipments(db, { accountId, skuId: sku.id, stockOrder });
  const existingQty = existingRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const remainingQty = Math.max(0, requestedQty - existingQty);
  const allocation = remainingQty > 0
    ? selectTemuOutboundBatches(db, { accountId, skuId: sku.id, qty: remainingQty })
    : { availableQty: 0, batches: [], shortageQty: 0 };
  return {
    stockOrder,
    requestedQty,
    demandRemainingQty,
    matchedSku: toCamelRow(sku),
    existingQty,
    remainingQty,
    existingShipments: existingRows.map(toCamelRow),
    availableQty: allocation.availableQty,
    shortageQty: allocation.shortageQty,
    allocationPlan: allocation.batches.map((item) => ({
      batch: toCamelRow(item.batch),
      qty: item.qty,
    })),
  };
}

function createOutboundPlan({ db, services, payload, actor }) {
  const batchId = requireString(payload.batchId, "batchId");
  const batch = getInventoryBatch(db, batchId);
  const qty = Math.max(1, Math.floor(Number(payload.qty || payload.quantity || 0)));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("qty must be greater than 0");
  if (Number(batch.available_qty || 0) < qty) {
    throw new Error(`Insufficient available inventory: ${batch.available_qty} < ${qty}`);
  }
  if (["pending", "failed"].includes(batch.qc_status)) {
    throw new Error(`Batch cannot outbound while qc_status is ${batch.qc_status}`);
  }

  const now = nowIso();
  const row = {
    id: optionalString(payload.outboundId) || createId("outbound"),
    account_id: batch.account_id,
    shipment_no: optionalString(payload.shipmentNo) || buildShipmentNo(),
    sku_id: batch.sku_id,
    batch_id: batch.id,
    qty,
    boxes: optionalNumber(payload.boxes),
    status: "draft",
    logistics_provider: optionalString(payload.logisticsProvider),
    tracking_no: optionalString(payload.trackingNo),
    photos_json: "[]",
    warehouse_operator_id: null,
    shipped_at: null,
    confirmed_by: null,
    confirmed_at: null,
    remark: optionalString(payload.remark),
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_outbound_shipments (
      id, account_id, shipment_no, sku_id, batch_id, qty, boxes, status,
      logistics_provider, tracking_no, photos_json, warehouse_operator_id,
      shipped_at, confirmed_by, confirmed_at, remark, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @shipment_no, @sku_id, @batch_id, @qty, @boxes, @status,
      @logistics_provider, @tracking_no, @photos_json, @warehouse_operator_id,
      @shipped_at, @confirmed_by, @confirmed_at, @remark, @created_at, @updated_at
    )
  `).run(row);

  const beforeSubmit = getOutboundShipment(db, row.id);
  services.workflow.writeAudit({
    accountId: beforeSubmit.account_id,
    actor,
    action: "create_outbound_plan",
    entityType: "outbound_shipment",
    entityId: beforeSubmit.id,
    before: null,
    after: beforeSubmit,
  });

  const transition = services.outbound.submitOutbound(beforeSubmit.id, actor);
  const afterSubmit = getOutboundShipment(db, row.id);
  writeOutboundFlowEvent(db, afterSubmit, actor, "create_outbound_plan", `运营创建出库计划：${afterSubmit.shipment_no || afterSubmit.id}`);
  writeOutboundFlowEvent(db, afterSubmit, actor, "submit_outbound", `出库计划已提交仓库：${afterSubmit.shipment_no || afterSubmit.id}`);
  return {
    transition,
    shipment: toCamelRow(afterSubmit),
  };
}

function createOutboundPlanFromTemuStockOrder({ db, services, payload, actor }) {
  const preview = previewTemuStockOrderOutbound({ db, payload });
  const stockOrder = preview.stockOrder;
  if (preview.remainingQty <= 0) {
    return {
      ...preview,
      idempotent: true,
      createdQty: 0,
      shipments: preview.existingShipments,
      shipment: preview.existingShipments[0] || null,
    };
  }
  if (preview.shortageQty > 0) {
    throw new Error(`可用库存不足，当前可用 ${preview.availableQty}，还缺 ${preview.shortageQty}`);
  }
  const sourceLabel = stockOrder.stockOrderNo || stockOrder.deliveryOrderSn || stockOrder.deliveryBatchSn || stockOrder.skcId || "云端备货单";
  const remark = optionalString(payload.remark) || `Temu 云端备货单 ${sourceLabel}`;
  const shipments = [];
  for (const [index, item] of preview.allocationPlan.entries()) {
    const result = createOutboundPlan({
      db,
      services,
      payload: {
        ...payload,
        outboundId: preview.allocationPlan.length === 1 ? payload.outboundId : undefined,
        batchId: item.batch.id,
        qty: item.qty,
        boxes: preview.allocationPlan.length === 1 ? positiveInteger(payload.boxes, 1) : 1,
        remark: preview.allocationPlan.length === 1 ? remark : `${remark} / 批次 ${index + 1}`,
      },
      actor,
    });
    const now = nowIso();
    db.prepare(`
      UPDATE erp_outbound_shipments
      SET temu_stock_order_no = @temu_stock_order_no,
          temu_delivery_order_sn = @temu_delivery_order_sn,
          temu_delivery_batch_sn = @temu_delivery_batch_sn,
          temu_sync_status = @temu_sync_status,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: result.shipment.id,
      temu_stock_order_no: stockOrder.stockOrderNo,
      temu_delivery_order_sn: stockOrder.deliveryOrderSn,
      temu_delivery_batch_sn: stockOrder.deliveryBatchSn,
      temu_sync_status: "cloud_stock_order_outbound_created",
      updated_at: now,
    });
    const linked = getOutboundShipment(db, result.shipment.id);
    writeOutboundFlowEvent(
      db,
      linked,
      actor,
      "link_temu_stock_order",
      `已关联 Temu 云端备货单：${sourceLabel}`,
    );
    shipments.push(toCamelRow(linked));
  }
  return {
    ...preview,
    idempotent: false,
    createdQty: shipments.reduce((sum, row) => sum + Number(row.qty || 0), 0),
    shipments: [...preview.existingShipments, ...shipments],
    createdShipments: shipments,
    shipment: shipments[0] || null,
  };
}

function performOutboundAction(payload = {}, actorInput = {}) {
  const { db, services } = requireErp();
  const action = requireString(payload.action, "action");
  const actor = normalizeActor(actorInput);

  const run = db.transaction(() => {
    switch (action) {
      case "create_outbound_plan":
        return createOutboundPlan({ db, services, payload, actor });
      case "preview_temu_stock_order_outbound":
        return previewTemuStockOrderOutbound({ db, payload });
      case "create_outbound_plan_from_temu_stock_order":
        return createOutboundPlanFromTemuStockOrder({ db, services, payload, actor });
      case "start_picking": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        const transition = services.outbound.startPicking(outboundId, actor);
        const shipment = getOutboundShipment(db, outboundId);
        writeOutboundFlowEvent(db, shipment, actor, "start_picking", `仓库开始拣货：${shipment.shipment_no || shipment.id}`);
        return transition;
      }
      case "mark_packed": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        const transition = services.outbound.markPacked(outboundId, actor, {
          boxes: optionalNumber(payload.boxes),
          photos: [],
        });
        const shipment = getOutboundShipment(db, outboundId);
        writeOutboundFlowEvent(db, shipment, actor, "mark_packed", `仓库打包完成：${shipment.shipment_no || shipment.id}`);
        return transition;
      }
      case "confirm_shipped_out": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        const shipTransition = services.outbound.confirmShippedOut(outboundId, actor, {
          logisticsProvider: optionalString(payload.logisticsProvider),
          trackingNo: optionalString(payload.trackingNo),
        });
        const shipped = getOutboundShipment(db, outboundId);
        writeOutboundFlowEvent(db, shipped, actor, "confirm_shipped_out", `仓库确认发出：${shipped.shipment_no || shipped.id}`);
        const confirmRequest = services.outbound.requestOperationsConfirm(outboundId, actor);
        const pendingConfirm = getOutboundShipment(db, outboundId);
        writeOutboundFlowEvent(db, pendingConfirm, actor, "request_ops_confirm", `出库等待运营确认：${pendingConfirm.shipment_no || pendingConfirm.id}`);
        return {
          shipTransition,
          confirmRequest,
        };
      }
      case "confirm_outbound_done": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        const transition = services.outbound.confirmDone(outboundId, actor);
        const shipment = getOutboundShipment(db, outboundId);
        writeOutboundFlowEvent(db, shipment, actor, "confirm_outbound_done", `运营确认出库完成：${shipment.shipment_no || shipment.id}`);
        return transition;
      }
      default:
        throw new Error(`Unsupported outbound action: ${action}`);
    }
  });

  const result = run();
  return {
    action,
    result,
    workbench: getOutboundWorkbench({ limit: payload.limit }),
  };
}

function toWorkItem(row) {
  const next = toCamelRow(row);
  next.evidence = parseJsonArray(row.evidence_json);
  delete next.evidenceJson;
  return next;
}

function normalizeWorkItemActor(actorInput = {}) {
  return {
    id: optionalString(actorInput.id),
    role: optionalString(actorInput.role) || "admin",
  };
}

function listWorkItemsForUser(params = {}, user = erpState.currentUser) {
  const { services } = requireErp();
  return services.workItem.list(scopeWorkItemParamsForUser(params, user)).map(toWorkItem);
}

function listWorkItems(params = {}) {
  return listWorkItemsForUser(params, erpState.currentUser);
}

function getWorkItemStatsForUser(params = {}, user = erpState.currentUser) {
  const { services } = requireErp();
  return services.workItem.getStats(scopeWorkItemParamsForUser(params, user));
}

function getWorkItemStats(params = {}) {
  return getWorkItemStatsForUser(params, erpState.currentUser);
}

function generateWorkItemsForUser(payload = {}, user = erpState.currentUser) {
  const { services } = requireErp();
  const actor = user
    ? { id: user.id, role: user.role }
    : normalizeWorkItemActor(payload.actor);
  const result = services.workItem.generateFromCurrentState(payload, actor);
  const scopedParams = scopeWorkItemParamsForUser(payload, user);
  return {
    ...result,
    items: services.workItem.list({
      ...scopedParams,
      activeOnly: true,
      limit: payload.limit || 100,
    }).map(toWorkItem),
    stats: services.workItem.getStats(scopedParams),
  };
}

function generateWorkItems(payload = {}) {
  return generateWorkItemsForUser(payload, erpState.currentUser);
}

function updateWorkItemStatusForUser(payload = {}, user = erpState.currentUser) {
  const { services } = requireErp();
  const actor = user
    ? { id: user.id, role: user.role }
    : normalizeWorkItemActor(payload.actor);
  const id = requireString(payload.id || payload.workItemId, "workItemId");
  const status = requireString(payload.status, "status");
  return toWorkItem(services.workItem.updateStatus(id, status, actor, payload.remark));
}

function updateWorkItemStatus(payload = {}) {
  return updateWorkItemStatusForUser(payload, erpState.currentUser);
}

function transitionWorkflow(payload = {}) {
  const { services } = requireErp();
  return services.workflow.transition({
    entityType: payload.entityType,
    id: payload.id,
    action: payload.action,
    toStatus: payload.toStatus,
    actor: payload.actor,
    patch: payload.patch,
  });
}

function assertHostMode(featureName = "该功能") {
  if (isClientMode()) {
    throw new Error(`${featureName}只能在主控端使用`);
  }
}

function shouldUseClientRuntime() {
  return isClientMode() || !erpState.db || !erpState.services;
}

function ensureClientRuntime() {
  if (!isClientMode()) {
    setClientMode({ serverUrl: HK_SERVER_URL });
  }
}

async function requestRemotePurchaseWorkbench(params = {}) {
  ensureClientRuntime();
  let payload;
  try {
    payload = await remoteRequest("/api/purchase/workbench", {
      method: "POST",
      body: params,
      timeoutMs: 120000,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (!statusCode || ![404, 405, 502].includes(statusCode)) throw error;
    // 0.3.25锛歠allback 涔熷甫涓婂師濮?params锛岄伩鍏嶈€?body=绌烘椂鏈嶅姟鍣ㄦ寜 default锛坕ncludeOptions=true,
    // include1688Meta=true锛夎繑鍥?4.6MB 鍏ㄩ噺鍖咃紝璺ㄦ捣鎾戠垎 timeout銆佹寜閽崱 3-10 绉掋€?
    payload = await remoteRequest("/api/purchase/workbench", { method: "POST", body: params, timeoutMs: 120000 });
  }
  return enrichPurchaseWorkbenchWithLocalLineItems(
    normalizePurchaseWorkbenchPoNumbers(normalizeJstPurchaseWorkbench(payload.workbench || {})),
  );
}

async function getPurchaseWorkbenchRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    let payload;
    try {
      payload = await remoteRequest("/api/purchase/workbench", {
        method: "POST",
        body: params,
        timeoutMs: 120000,
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      if (!statusCode || ![404, 405, 502].includes(statusCode)) throw error;
      // 0.3.25：fallback 也带上原始 params，避免老 body=空时服务器按 default（includeOptions=true,
      // include1688Meta=true）返回 4.6MB 全量包，跨海撑爆 timeout、按钮卡 3-10 秒。
      payload = await remoteRequest("/api/purchase/workbench", { method: "POST", body: params, timeoutMs: 120000 });
    }
    return enrichPurchaseWorkbenchWithLocalLineItems(
      normalizePurchaseWorkbenchPoNumbers(normalizeJstPurchaseWorkbench(payload.workbench || {})),
    );
  }
  return getPurchaseWorkbench(params);
}

function toRemoteImageSearchMockResult(item = {}) {
  return {
    offerId: optionalString(item.externalOfferId || item.offerId || item.id),
    skuId: optionalString(item.externalSkuId || item.skuId),
    specId: optionalString(item.externalSpecId || item.specId),
    supplierName: optionalString(item.supplierName),
    productTitle: optionalString(item.productTitle || item.title || item.subject),
    productUrl: optionalString(item.productUrl || item.offerUrl),
    imageUrl: optionalString(item.imageUrl || item.imgUrl),
    price: optionalNumber(item.unitPrice ?? item.price),
    moq: optionalNumber(item.moq ?? item.minOrderQuantity),
    leadDays: optionalNumber(item.leadDays),
    logisticsFee: optionalNumber(item.logisticsFee),
    raw: item.raw || item,
  };
}

function buildClientImageSearchEmptyPayload(payload = {}, localImageSearch = {}) {
  return {
    ...payload,
    imageDataUrl: undefined,
    imageData: undefined,
    mockResults: [],
    localImageSearch: {
      source: "client_image_presearch_empty",
      totalFound: 0,
      ...localImageSearch,
    },
  };
}

async function buildClientImageSearchMockResults(payload = {}) {
  if (payload.action !== "source_1688_image" || Array.isArray(payload.mockResults)) return null;
  // 客户端预搜默认开启（v0.2.13 起）。原因：
  //   1) 主控端走 alphashop imageSearchProduct 时，对非阿里 CDN 的 imgUrl 总是返回空
  //      数组（实测把 `https://erp.temu.chat/uploads/...` 喂进去拿到 0 个商品）。
  //   2) 主控端云 IP 又被 1688 mtop 反爬列入 cloud_ip_bl，直接走网页搜款也是 deny。
  //   3) 客户端宽带 IP 不在反爬黑名单，1688 mtop putImage + searchOffer 都能通。
  // 想强制关闭可以设 ERP_CLIENT_IMAGE_PRESEARCH=0。
  if (process.env.ERP_CLIENT_IMAGE_PRESEARCH === "0") return null;
  const beginPage = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.beginPage) ?? 1)), 10));
  const importLimit = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.importLimit) ?? 10)), 20));
  const pageSize = Math.max(1, Math.min(importLimit, 50));
  const parsedUpload = parseErpImageDataUrl(payload);
  const imgUrl = optionalString(payload.imgUrl || payload.imageUrl);

  // 全流程 30s 硬上限：fetch image → 1688 mtop putImage → searchOffer。
  // 任意一步慢/挂（用户 IP 偶尔被 1688 反爬刷出 deny_h5、token 接口卡住等）超过 30s
  // 就放弃预搜，让主控端 fallback 走 alphashop。alphashop 对外站图返回空数组但 1-2 秒
  // 就回，至少不会撞 IPC 120s 超时。两台电脑一台行一台不行多半就是这个。
  const MTOP_BUDGET_MS = 20000;
  const TOTAL_PRESEARCH_BUDGET_MS = 45000;
  const t0 = Date.now();
  function elapsedMs() {
    return Date.now() - t0;
  }
  function remainingTotalBudget() {
    return Math.max(0, TOTAL_PRESEARCH_BUDGET_MS - elapsedMs());
  }
  function remainingMtopBudget() {
    return Math.max(0, Math.min(MTOP_BUDGET_MS - elapsedMs(), remainingTotalBudget()));
  }
  function timeoutSentinel(label, budgetMs) {
    const timeoutMs = Math.max(1, budgetMs);
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`client image presearch timeout at ${label}`)), timeoutMs);
    });
  }

  let imageBuffer = parsedUpload?.buffer || null;
  if (!imageBuffer && imgUrl) {
    try {
      const fetchBudget = Math.max(1500, Math.min(8000, remainingMtopBudget() || remainingTotalBudget()));
      imageBuffer = await Promise.race([
        fetchImageBuffer(imgUrl),
        timeoutSentinel("fetchImageBuffer", fetchBudget),
      ]);
    } catch (e) {
      console.error(`[buildClientImageSearchMockResults] fetch image failed: ${e?.message || e}`);
      return null;
    }
  }
  if (!imageBuffer?.length) return null;

  let localResult = null;
  let mtopError = null;
  const mtopBudget = remainingMtopBudget();
  if (mtopBudget >= 1500) {
    try {
      localResult = await Promise.race([
        run1688WebImageSearch({
          imageBuffer,
          beginPage,
          pageSize,
          timeoutMs: Math.min(mtopBudget, 12000),
        }),
        timeoutSentinel("run1688WebImageSearch", mtopBudget),
      ]);
    } catch (e) {
      mtopError = e;
      console.error(`[buildClientImageSearchMockResults] 1688 mtop failed in ${elapsedMs()}ms: ${e?.message || e}`);
    }
  }

  // mtop 拿到候选直接用
  if (localResult && Array.isArray(localResult.products) && localResult.products.length > 0) {
    return {
      ...payload,
      imageDataUrl: undefined,
      imageData: undefined,
      mockResults: localResult.products.map(toRemoteImageSearchMockResult),
      localImageSearch: {
        source: "1688_web_image_client",
        imageId: localResult.imageId,
        totalFound: localResult.products.length,
        elapsedMs: elapsedMs(),
      },
    };
  }

  // mtop 失败 / 命中反爬 / 0 候选 → 尝试 Playwright 真 Chrome 走 1688 air 图搜
  // 这是「家用 IP 被 1688 反爬黑名单标记」场景下唯一靠谱的根因解：
  // 真 Chrome + 用户登录态 cookies + 真实 fingerprint，跟正常用户访问一样。
  // 客户端 (electron 主进程) 才有 workerInvoker；主控端 (Linux 服务器，没图形界面跑不了 Chrome)
  // 没有 workerInvoker，会跳过这步直接 fallback alphashop。
  if (erpState.workerInvoker && imgUrl) {
    const browserBudget = Math.min(remainingTotalBudget(), 25000);
    if (browserBudget >= 8000) {
      console.error(`[buildClientImageSearchMockResults] mtop failed, falling back to Playwright air image search (budget=${browserBudget}ms)`);
      try {
        const browserResult = await erpState.workerInvoker(
          "search_1688_image",
          { imgUrl, limit: pageSize, timeoutMs: browserBudget },
          { timeoutMs: browserBudget + 5000 },
        );
        if (browserResult && browserResult.ok && Array.isArray(browserResult.offers) && browserResult.offers.length) {
          return {
            ...payload,
            imageDataUrl: undefined,
            imageData: undefined,
            mockResults: browserResult.offers.map(toRemoteImageSearchMockResult),
            localImageSearch: {
              source: browserResult.source || "1688_air_image_browser",
              totalFound: browserResult.offers.length,
              elapsedMs: elapsedMs(),
            },
          };
        }
        if (browserResult?.captcha || browserResult?.needsLogin) {
          // 故意把这条错误透传到上层，前端 message.error 时用户能看到要去解滑块/登录
          throw new Error(browserResult.error || "1688 真 Chrome 图搜需要人工干预");
        }
      } catch (e) {
        console.error(`[buildClientImageSearchMockResults] Playwright fallback failed: ${e?.message || e}`);
        // 原始 mtop 错误更重要的话往上抛；否则继续 fallback 主控端
        if (/captcha|punish|需要人工|需要|登录|人机|滑块|拼图/.test(String(e?.message || ""))) throw e;
      }
    }
  }

  // 最后兜底：让主控端跑 alphashop（外站图永远 0 个，但至少返回快）
  if (erpState.workerInvoker && imgUrl && process.env.ERP_CLIENT_IMAGE_SERVER_FALLBACK !== "1") {
    return buildClientImageSearchEmptyPayload(payload, {
      source: "client_image_presearch_empty",
      elapsedMs: elapsedMs(),
      emptyReason: "这张图没有搜到候选；如果浏览器里弹出 1688 登录或滑块，请先完成后再重试。",
      mtopError: optionalString(mtopError?.message || mtopError),
    });
  }
  return null;
}

function getClientRuntimeActor() {
  return getRuntimeStatus().currentUser || erpState.currentUser || {};
}

function getClientLocalAlphaShopCredentials(payload = {}) {
  const actor = getClientRuntimeActor();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const payloadAccessKey = normalizeAlphaShopAccessKey(payload.accessKey || payload.ak);
  const payloadSecretKey = normalizeAlphaShopSecretKey(payload.secretKey || payload.sk);
  const envAccessKey = normalizeAlphaShopAccessKey(process.env.ALPHASHOP_ACCESS_KEY || process.env.ERP_ALPHASHOP_ACCESS_KEY);
  const envSecretKey = normalizeAlphaShopSecretKey(process.env.ALPHASHOP_SECRET_KEY || process.env.ERP_ALPHASHOP_SECRET_KEY);
  let purchaseAccessKey = "";
  let purchaseSecretKey = "";
  let imageSearchAccessKey = "";
  let imageSearchSecretKey = "";
  let db = null;
  try {
    if (hasExistingErpDatabase({ userDataDir: erpState.userDataDir })) {
      db = openErpDatabase({ userDataDir: erpState.userDataDir });
      if (tableHasColumn(db, "erp_purchase_settings", "alphashop_access_key")) {
        const purchaseRow = db.prepare(`
          SELECT alphashop_access_key, alphashop_secret_key
          FROM erp_purchase_settings
          WHERE company_id = ?
          LIMIT 1
        `).get(companyId);
        purchaseAccessKey = normalizeAlphaShopAccessKey(purchaseRow?.alphashop_access_key);
        purchaseSecretKey = normalizeAlphaShopSecretKey(purchaseRow?.alphashop_secret_key);
      }
      const imageSearchRow = getAlphaShopSettingsRow(db, companyId);
      imageSearchAccessKey = normalizeAlphaShopAccessKey(imageSearchRow?.access_key);
      imageSearchSecretKey = normalizeAlphaShopSecretKey(imageSearchRow?.secret_key);
    }
  } catch {
    // Client mode can still use payload/env credentials if the local DB is unavailable.
  } finally {
    try {
      db?.close?.();
    } catch {}
  }

  const accessKey = payloadAccessKey || purchaseAccessKey || imageSearchAccessKey || envAccessKey;
  const secretKey = payloadSecretKey || purchaseSecretKey || imageSearchSecretKey || envSecretKey;
  if (!accessKey || !secretKey) {
    throw new Error("请先在本机配置 AlphaShop productDetailQuery 密钥，再同步 1688 规格");
  }
  return { accessKey, secretKey, companyId };
}

function alphaShopDetailTo1688MockDetail(detail = {}, rawResponse = {}) {
  const skuInfos = (Array.isArray(detail.skuOptions) ? detail.skuOptions : []).map((sku) => ({
    skuId: optionalString(sku.externalSkuId || sku.skuId || sku.id),
    // specId 必须来自真实 spec/cargoSku 字段，不再回退到 skuId（与 alphaShopMcpClient 一致，避免 1688 下单时被拒）。
    specId: optionalString(sku.externalSpecId || sku.specId || sku.cargoSkuId),
    attributes: Array.isArray(sku.attributes) && sku.attributes.length
      ? sku.attributes
      : String(sku.specText || "")
        .split(";")
        .map((part) => {
          const [name, ...valueParts] = String(part || "").split(":");
          return {
            name: optionalString(name) || "",
            value: optionalString(valueParts.join(":")) || optionalString(part) || "",
          };
        })
        .filter((item) => item.name || item.value),
    price: optionalNumber(sku.price),
    stock: optionalNumber(sku.stock),
    amountOnSale: optionalNumber(sku.stock),
    raw: sku.raw || sku,
  }));
  const priceRanges = Array.isArray(detail.priceRanges) ? detail.priceRanges : [];
  const productID = optionalString(detail.externalOfferId || detail.productId || detail.offerId);
  const productInfo = {
    productID,
    productId: productID,
    offerId: productID,
    subject: optionalString(detail.productTitle || detail.title),
    productTitle: optionalString(detail.productTitle || detail.title),
    supplierName: optionalString(detail.supplierName),
    productUrl: optionalString(detail.productUrl) || (productID ? `https://detail.1688.com/offer/${productID}.html` : null),
    imageUrl: optionalString(detail.imageUrl),
    imageUrls: optionalString(detail.imageUrl) ? [optionalString(detail.imageUrl)] : [],
    price: optionalNumber(detail.unitPrice),
    minPrice: optionalNumber(detail.unitPrice),
    moq: optionalNumber(detail.moq),
    minOrderQuantity: optionalNumber(detail.moq),
    priceRanges,
    skuInfos,
    saleInfo: {
      minOrderQuantity: optionalNumber(detail.moq),
      priceRanges,
    },
    rawAlphaShopResponse: rawResponse,
  };
  return {
    result: {
      data: {
        productInfo,
      },
    },
  };
}

async function buildClientProductDetailMockPayload(payload = {}) {
  if (!["refresh_1688_product_detail", "preview_1688_url_specs"].includes(payload.action)) return null;
  if (payload.mockDetail || payload.mockResponse) return payload;
  if (payload.preferAlphaShopDetail === false || payload.prefer_alpha_shop_detail === false) return payload;
  const productUrl = optionalString(payload.productUrl || payload.product_url || payload.url);
  const offerId = requireString(
    payload.offerId
      || payload.externalOfferId
      || payload.productId
      || payload.productID
      || extract1688OfferIdFromUrl(productUrl),
    "offerId",
  );
  // 本机如果没有 AlphaShop 密钥（客户端模式新装机器很常见），不要直接抛错
  // 阻断整个流程；改成"走远端"——把 payload 原样发给 ERP 服务器，让服务器
  // 用它自己配的 AlphaShop 密钥去查。服务器没配则会回它自己的错。
  let credentials;
  try {
    credentials = getClientLocalAlphaShopCredentials(payload);
  } catch {
    return { ...payload, offerId, productId: offerId, productID: offerId };
  }
  const alphaShopDetail = await alphaShopProductDetailQuery({
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
    productId: offerId,
    timeoutMs: 120000,
  });
  if (!hasSyncableSkuOptions(alphaShopDetail.detail)) {
    throw new Error("productDetailQuery 未返回可绑定规格，请换一个 1688 候选商品或检查遨虾接口返回");
  }
  return {
    ...payload,
    offerId,
    productId: offerId,
    productID: offerId,
    mockDetail: alphaShopDetailTo1688MockDetail(alphaShopDetail.detail, alphaShopDetail.rawResponse),
    clientAlphaShopProductDetail: {
      source: "productDetailQuery",
      skuOptionCount: alphaShopDetail.detail.skuOptions.length,
    },
  };
}

function isUnsupportedRemotePurchaseAction(error) {
  const message = String(error?.message || error?.payload?.error || error || "");
  return /Unsupported purchase action|unsupported.*action|不支持.*操作/i.test(message);
}

// 通过本地 Worker（带登录态浏览器）拉取 1688 商品页里的真实 SKU 三元组（specId/skuId/specAttrs）。
// 这是绕过 1688 反爬 + 遨虾不返 cargoSpecId 的唯一可靠路径。worker.mjs 暴露 action="extract_1688_skus"。
async function tryExtract1688SkusViaWorker(offerId) {
  if (!erpState.workerInvoker || !offerId) return null;
  try {
    const workerResult = await erpState.workerInvoker(
      "extract_1688_skus",
      { offerId: String(offerId) },
      { timeoutMs: 60000 },
    );
    if (!workerResult || !Array.isArray(workerResult.skus) || !workerResult.skus.length) {
      return null;
    }
    return workerResult;
  } catch (error) {
    console.error("[preview_1688_url_specs] worker extract_1688_skus failed:", String(error?.message || error));
    return null;
  }
}

// 把 worker 抽到的真实 SKU 列表组装成前端「解析规格」对话框期望的 detail 结构。
function build1688DetailFromWorkerSkus(workerResult, offerId, payload = {}) {
  const skuOptions = workerResult.skus.map((sku) => {
    const specText = optionalString(sku.specAttrs);
    return {
      externalSkuId: optionalString(sku.skuId),
      externalSpecId: optionalString(sku.specId),
      specText: specText || optionalString(sku.specId),
      attributes: specText
        ? specText.split(/[;；]/).map((part) => {
          const [name, ...rest] = String(part || "").split(":");
          return {
            name: optionalString(name) || "",
            value: optionalString(rest.join(":")) || optionalString(part) || "",
          };
        }).filter((item) => item.name || item.value)
        : [],
      price: null,
      stock: null,
      raw: sku,
    };
  });
  const productUrl = optionalString(workerResult.url || payload.productUrl) || `https://detail.1688.com/offer/${offerId}.html`;
  return {
    externalOfferId: offerId,
    supplierName: optionalString(workerResult.supplierName) || optionalString(payload.supplierName) || "1688 Supplier",
    productTitle: optionalString(workerResult.productTitle) || optionalString(payload.productTitle),
    productUrl,
    imageUrl: optionalString(workerResult.imageUrl) || optionalString(payload.imageUrl),
    unitPrice: optionalNumber(payload.unitPrice),
    moq: optionalNumber(payload.moq) ?? 1,
    skuOptions,
    usedFallbackDetail: false,
    usedAlphaShopProductDetail: false,
    usedWorkerWebDetail: true,
  };
}

async function performClientPreview1688UrlSpecs(payload = {}) {
  // 第一优先：本地 Worker（带 1688 登录态浏览器）抓真 specId。
  // 这是唯一能拿到 1688 fastCreateOrder 接受的 cargoSpecId 的路径——
  // 主控端裸 fetch 1688 详情页会被反爬挡住，遨虾接口只返 skuId。
  {
    const productUrlInput = optionalString(payload.productUrl || payload.product_url || payload.url);
    const offerIdInput = optionalString(
      payload.externalOfferId
        || payload.offerId
        || payload.productId
        || payload.productID
        || extract1688OfferIdFromUrl(productUrlInput),
    );
    if (offerIdInput) {
      const workerResult = await tryExtract1688SkusViaWorker(offerIdInput);
      if (workerResult) {
        const detail = build1688DetailFromWorkerSkus(workerResult, offerIdInput, payload);
        const finalProductUrl = detail.productUrl;
        return {
          action: "preview_1688_url_specs",
          result: {
            apiKey: "worker:1688-web-detail",
            query: { offerId: offerIdInput, productUrl: finalProductUrl },
            externalOfferId: offerIdInput,
            productUrl: finalProductUrl,
            detail,
            workerWebDetail: {
              source: "worker_1688_web_detail",
              skuOptionCount: detail.skuOptions.length,
              specIdHits: workerResult.specIdHits,
              htmlLen: workerResult.htmlLen,
            },
          },
          workbench: {},
        };
      }
    }
  }

  // 第二优先：主控端官方接口（多数情况会因 ACL 不足 / 反爬 失败）。
  try {
    const response = await remoteRequest("/api/purchase/action", {
      method: "POST",
      body: payload,
      timeoutMs: 120000,
    });
    return normalizePurchaseResultPoNumbers(response.result);
  } catch (error) {
    if (!isUnsupportedRemotePurchaseAction(error)) throw error;
  }

  const fallbackPayload = await buildClientProductDetailMockPayload({
    ...payload,
    action: "preview_1688_url_specs",
  });
  const productUrl = optionalString(fallbackPayload.productUrl || fallbackPayload.product_url || fallbackPayload.url);
  const offerId = requireString(
    fallbackPayload.offerId
      || fallbackPayload.externalOfferId
      || fallbackPayload.productId
      || fallbackPayload.productID
      || extract1688OfferIdFromUrl(productUrl),
    "offerId",
  );
  const rawResponse = fallbackPayload.mockDetail || fallbackPayload.mockResponse;
  const detail = normalize1688ProductDetailResponse(rawResponse);
  if (!hasSyncableSkuOptions(detail)) {
    throw new Error("productDetailQuery 未返回可绑定规格，请换一个 1688 地址或检查遨虾接口返回");
  }
  const finalProductUrl = productUrl || optionalString(detail.productUrl) || `https://detail.1688.com/offer/${offerId}.html`;
  return {
    action: "preview_1688_url_specs",
    result: {
      apiKey: PROCUREMENT_APIS.PRODUCT_DETAIL.key,
      query: build1688ProductDetailParams(offerId, fallbackPayload),
      externalOfferId: offerId,
      productUrl: finalProductUrl,
      detail: {
        ...detail,
        externalOfferId: optionalString(detail.externalOfferId) || offerId,
        productUrl: optionalString(detail.productUrl) || finalProductUrl,
        usedFallbackDetail: false,
        usedAlphaShopProductDetail: true,
        raw: undefined,
      },
      rawResponse,
      clientAlphaShopProductDetail: fallbackPayload.clientAlphaShopProductDetail,
    },
    workbench: {},
  };
}

async function performClientBind1688CandidateSpec(payload = {}) {
  try {
    const response = await remoteRequest("/api/purchase/action", {
      method: "POST",
      body: payload,
      timeoutMs: 120000,
    });
    return response.result;
  } catch (error) {
    if (!isUnsupportedRemotePurchaseAction(error)) throw error;
  }

  const fallbackPayload = await buildClientProductDetailMockPayload({
    ...payload,
    action: "refresh_1688_product_detail",
    bindMapping: true,
  });
  const refreshResponse = await remoteRequest("/api/purchase/action", {
    method: "POST",
    body: fallbackPayload,
    timeoutMs: 120000,
  });
  return {
    ...(refreshResponse.result || {}),
    bindFallback: "refresh_1688_product_detail",
  };
}

async function performPurchaseActionRuntime(payload = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    if (payload?.action === "preview_1688_url_specs") {
      return performClientPreview1688UrlSpecs(payload);
    }
    if (payload?.action === "bind_1688_candidate_spec") {
      return performClientBind1688CandidateSpec(payload);
    }
    let remotePayload = payload;
    if ((payload?.action === "generate_po" || payload?.action === "generate_purchase_order") && !optionalString(payload.poNo || payload.po_no)) {
      try {
        // 0.3.25 性能：只为挑下一个空闲 PO 号，不需要 SKU/supplier options 或 1688 元数据。
        // 老版本默认拉 4.6MB workbench，每次「生成采购单」按钮慢 3-10 秒；关掉 options
        // + 1688Meta 后只剩 PR/PO 表，~50KB 跨海。
        const current = await remoteRequest("/api/purchase/workbench", {
          method: "POST",
          body: { limit: 500, includeRequestDetails: false, includeOptions: false, include1688Meta: false },
        });
        remotePayload = {
          ...remotePayload,
          poNo: getNextClientPurchaseOrderNo(current.workbench || {}),
        };
      } catch {}
    }
    try {
      remotePayload = await buildClientImageSearchMockResults(remotePayload) || remotePayload;
    } catch (error) {
      if (payload?.action === "source_1688_image") throw error;
    }
    if (payload?.action === "refresh_1688_product_detail") {
      remotePayload = await buildClientProductDetailMockPayload(remotePayload) || remotePayload;
    }
    let response;
    try {
      response = await remoteRequest("/api/purchase/action", {
        method: "POST",
        body: remotePayload,
        timeoutMs: payload?.action === "source_1688_image" ? 45000 : 120000,
      });
    } catch (error) {
      if (payload?.action !== "cancel_1688_order" || !is1688OrderGoneError(error)) throw error;
      response = await remoteRequest("/api/purchase/action", {
        method: "POST",
        body: {
          ...remotePayload,
          mockCancelResponse: {
            success: true,
            alreadyCancelled: true,
            reason: "remote_order_already_cancelled",
            remoteError: error?.payload || { message: error?.message || String(error) },
            at: nowIso(),
          },
        },
        timeoutMs: 120000,
      });
    }
    return normalizePurchaseResultPoNumbers(response.result);
  }
  const actor = getCurrentSessionActor(payload?.actor || {});
  return performPurchaseAction(payload || {}, actor);
}

async function getWarehouseWorkbenchRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/warehouse/workbench", {
      method: "POST",
      body: params,
      timeoutMs: 120000,
    });
    return normalizeJstWarehouseWorkbench(payload.workbench || {});
  }
  return getWarehouseWorkbench(params);
}

async function performWarehouseActionRuntime(payload = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/warehouse/action", {
      method: "POST",
      body: payload,
    });
    return response.result;
  }
  const actor = getCurrentSessionActor(payload?.actor || {});
  return performWarehouseAction(payload || {}, actor);
}

async function getQcWorkbenchRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/qc/workbench");
    return payload.workbench || {};
  }
  return getQcWorkbench(params);
}

async function performQcActionRuntime(payload = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/qc/action", {
      method: "POST",
      body: payload,
    });
    return response.result;
  }
  const actor = getCurrentSessionActor(payload?.actor || {});
  return performQcAction(payload || {}, actor);
}

async function getOutboundWorkbenchRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/outbound/workbench");
    return payload.workbench || {};
  }
  return getOutboundWorkbench(params);
}

async function performOutboundActionRuntime(payload = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/outbound/action", {
      method: "POST",
      body: payload,
    });
    return response.result;
  }
  const actor = getCurrentSessionActor(payload?.actor || {});
  return performOutboundAction(payload || {}, actor);
}

async function listWorkItemsRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/work-items/list", {
      method: "POST",
      body: params,
    });
    return payload.items || [];
  }
  return listWorkItems(params);
}

async function getWorkItemStatsRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/work-items/stats", {
      method: "POST",
      body: params,
    });
    return payload.stats || {};
  }
  return getWorkItemStats(params);
}

async function generateWorkItemsRuntime(payload = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/work-items/generate", {
      method: "POST",
      body: payload,
    });
    return response.result;
  }
  return generateWorkItems(payload);
}

async function updateWorkItemStatusRuntime(payload = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/work-items/update-status", {
      method: "POST",
      body: payload,
    });
    return response.item;
  }
  return updateWorkItemStatus(payload);
}

async function listUsersRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/users/list", {
      method: "POST",
      body: params,
    });
    return payload.users || [];
  }
  return listUsers({
    ...params,
    companyId: optionalString(params.companyId || params.company_id) || erpState.currentUser?.companyId || undefined,
  });
}

async function upsertUserRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/users/upsert", {
      method: "POST",
      body: payload,
    });
    return response.user;
  }
  assertRoleIfLoggedIn(["admin", "manager"]);
  return upsertUserAndBroadcast(payload, actor);
}

async function getMasterDataWorkbenchRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const payload = await remoteRequest("/api/master-data/workbench", {
      method: "POST",
      body: params,
      timeoutMs: 60000,
    });
    return payload.workbench || {};
  }
  const scopedParams = {
    ...(params || {}),
    companyId: optionalString(params.companyId || params.company_id) || erpState.currentUser?.companyId || undefined,
  };
  const { db } = requireErp();
  const actor = erpState.currentUser || {};
  await ensureDefault1688DeliveryAddresses(db, {
    companyId: scopedParams.companyId,
    actor,
    wait: true,
  });
  return {
    accounts: listAccounts(scopedParams),
    suppliers: listSuppliers(scopedParams),
    skus: listSkus(scopedParams),
    alibaba1688Addresses: list1688DeliveryAddresses({ status: "active", companyId: scopedParams.companyId }),
  };
}

async function listAccountsRuntime(params = {}) {
  // 0.3.23 修 N+1：client mode 透传 part 给主控，让 master-data/workbench
  // 只返回 accounts 这一段（68 条 vs 52MB 全量），避免每次 list IPC 都拉
  // accounts+suppliers+skus 三套响应把 main process IPC 卡死。
  // host mode 下 getMasterDataWorkbenchRuntime 走本地 SQL，全量查询很快，
  // 多查的两项忽略即可，不影响性能。
  const workbench = await getMasterDataWorkbenchRuntime({ ...params, part: "accounts" });
  return workbench.accounts || [];
}

async function upsertAccountRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...payload,
        action: "upsert_account",
      },
    });
    return response.result;
  }
  assertRoleIfLoggedIn(["admin", "manager"]);
  return upsertAccount(payload || {}, actor);
}

async function deleteAccountRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...payload,
        action: "delete_account",
      },
    });
    return response.result;
  }
  assertRoleIfLoggedIn(["admin", "manager"]);
  return deleteAccount(payload || {}, actor);
}

async function listSuppliersRuntime(params = {}) {
  // 0.3.23 修 N+1：见 listAccountsRuntime 注释。
  const workbench = await getMasterDataWorkbenchRuntime({ ...params, part: "suppliers" });
  return workbench.suppliers || [];
}

async function createSupplierRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...payload,
        action: "create_supplier",
      },
    });
    return response.result;
  }
  assertRoleIfLoggedIn(["admin", "manager", "buyer"]);
  return createSupplier(payload || {}, actor);
}

async function importFeishuSupplierRowsOnce(rawRows = [], payload = {}, actor = {}) {
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const existingSuppliers = await listSuppliersRuntime({ companyId, limit: 10000 });
  const supplierByCode = new Map();
  const supplierByName = new Map();

  for (const supplier of existingSuppliers) {
    const codeKey = optionalString(supplier.supplierCode)?.toLowerCase();
    const nameKey = optionalString(supplier.name)?.toLowerCase();
    if (codeKey && !supplierByCode.has(codeKey)) supplierByCode.set(codeKey, supplier);
    if (nameKey && !supplierByName.has(nameKey)) supplierByName.set(nameKey, supplier);
  }

  const errors = [];
  let imported = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let index = 0; index < rawRows.length; index += 1) {
    const rowNumber = index + Number(payload.rowNumberBase || payload.row_number_base || 2);
    const normalized = normalizeFeishuSupplierImportRow(rawRows[index]);
    if (!normalized.name) {
      skipped += 1;
      errors.push({ row: rowNumber, reason: "缺少供应商名称" });
      continue;
    }

    const codeKey = optionalString(normalized.supplierCode)?.toLowerCase();
    const nameKey = optionalString(normalized.name)?.toLowerCase();
    const existing = (codeKey && supplierByCode.get(codeKey)) || (nameKey && supplierByName.get(nameKey)) || null;
    const supplierId = existing?.id || stableFeishuSupplierId(companyId, normalized.supplierCode || normalized.name);
    const supplierPayload = {
      id: supplierId,
      companyId,
      supplierCode: normalized.supplierCode || existing?.supplierCode || "",
      name: normalized.name || existing?.name,
      contactName: normalized.contactName || existing?.contactName || "",
      phone: normalized.phone || existing?.phone || "",
      wechat: normalized.wechat || existing?.wechat || "",
      address: normalized.address || existing?.address || "",
      categories: normalized.categories.length ? normalized.categories : (existing?.categories || []),
      supplierLevel: normalized.supplierLevel || existing?.supplierLevel || "standard",
      paymentTerms: normalized.paymentTerms || existing?.paymentTerms || "",
      leadDays: normalized.leadDays ?? existing?.leadDays ?? null,
      taxRate: normalized.taxRate ?? existing?.taxRate ?? null,
      settlementCurrency: existing?.settlementCurrency || "CNY",
      remark: normalized.remark || existing?.remark || "",
      status: normalized.status || existing?.status || "active",
    };

    try {
      const saved = await createSupplierRuntime(supplierPayload, actor);
      imported += 1;
      if (existing) {
        updated += 1;
      } else {
        created += 1;
        const savedCodeKey = optionalString(saved?.supplierCode || supplierPayload.supplierCode)?.toLowerCase();
        const savedNameKey = optionalString(saved?.name || supplierPayload.name)?.toLowerCase();
        if (savedCodeKey) supplierByCode.set(savedCodeKey, saved || supplierPayload);
        if (savedNameKey) supplierByName.set(savedNameKey, saved || supplierPayload);
      }
    } catch (error) {
      skipped += 1;
      errors.push({ row: rowNumber, reason: error?.message || String(error) });
    }
  }

  return {
    source: "feishu",
    sourceUrl: optionalString(payload.sourceUrl || payload.source_url) || null,
    filePath: optionalString(payload.filePath || payload.file_path) || null,
    total: rawRows.length,
    imported,
    created,
    updated,
    skipped,
    errors: errors.slice(0, 30),
  };
}

async function importFeishuSuppliersOnceRuntime(payload = {}, actor = {}) {
  assertRoleIfLoggedIn(["admin", "buyer"]);
  const filePath = requireString(payload.filePath || payload.file_path, "filePath");
  const rawRows = readSupplierImportRowsFromSpreadsheet(filePath);
  return importFeishuSupplierRowsOnce(rawRows, { ...payload, filePath }, actor);
}

async function importFeishuSuppliersFromExtensionRuntime(payload = {}, actor = {}) {
  assertHostMode("Feishu extension ingest");
  const rows = extractFeishuSupplierRowsFromExtensionPayload(payload);
  return importFeishuSupplierRowsOnce(rows, {
    ...payload,
    sourceUrl: optionalString(payload.sourceUrl || payload.source_url) || FEISHU_SUPPLIER_BASE_URL,
    rowNumberBase: 1,
  }, actor && actor.role ? actor : { role: "admin", companyId: payload.companyId || payload.company_id || DEFAULT_COMPANY_ID });
}

async function listSkusRuntime(params = {}) {
  // client 模式：优先读本地 cache.db（秒返回），后台 fire-and-forget 增量同步；
  // 缓存未建（首次）先走服务器分页返回，后台再全量建 cache。host 模式直接走本地 SQL。
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    try {
      const cached = skuCache.getCachedSkus(params);
      if (cached) {
        // 缓存命中：立即返回，后台悄悄追增量（不阻塞 UI），失败静默。
        void skuCache.triggerSync({ mode: "incremental" }).catch(() => {});
        return cached;
      }
      // 缓存空（首次/损坏）：不等 2w+ SKU 全量 cache 建完，避免服务器模式首屏一直 0。
      void skuCache.triggerSync({ mode: "full" })
        .then(() => skuCache.triggerReconcile().catch(() => {}))
        .catch(() => {});
    } catch {
      // 缓存损坏 / 同步异常 → 降级回跨海全量，保证不阻塞。
    }
  }
  // 0.3.23 修 N+1：见 listAccountsRuntime 注释。
  const workbench = await getMasterDataWorkbenchRuntime({ ...params, part: "skus" });
  return workbench.skus || [];
}

async function listSkuStockDetailsRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    try {
      const payload = await remoteRequest("/api/master-data/sku-stock-details", {
        method: "POST",
        body: params,
        timeoutMs: 60000,
      });
      return payload.result || payload.stockDetails || payload;
    } catch (error) {
      if (error?.statusCode && error.statusCode !== 404) throw error;
    }
  }
  return listSkuStockDetails(params);
}

async function listMappingsRuntime(params = {}) {
  // client 模式：优先读本地 cache.db（秒返回），后台 fire-and-forget 增量同步；
  // 缓存未建（首次）则同步等一次全量再返回。host 模式直接走本地 SQL。
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    try {
      const cached = mappingCache.getCachedMappings(params);
      if (cached) {
        void mappingCache.triggerSync({ mode: "incremental" }).catch(() => {});
        return cached;
      }
      await mappingCache.triggerSync({ mode: "full" });
      void mappingCache.triggerReconcile().catch(() => {});
      const afterFull = mappingCache.getCachedMappings(params);
      if (afterFull) return afterFull;
    } catch {
      // 缓存损坏 / 同步异常 → 降级回跨海全量，保证不阻塞。
    }
    // client 降级：先试映射端点；老服务器(尚未 patch /api/master-data/mappings，返回 404)
    // 回退到 purchase workbench 的 sku1688Sources，保证供应商管理在服务器升级前也能用。
    try {
      const payload = await remoteRequest("/api/master-data/mappings", {
        method: "POST",
        body: { limit: 100000 },
      });
      return (payload && payload.mappings) || [];
    } catch (error) {
      if (error?.statusCode === 404 || /not found/i.test(error?.message || "")) {
        const wb = await remoteRequest("/api/purchase/workbench", {
          method: "POST",
          body: { limit: 100000, includeRequestDetails: false, include1688Meta: false },
        });
        return (wb && wb.sku1688Sources) || [];
      }
      throw error;
    }
  }
  // host 模式：本地 SQL 全量。
  return listSku1688Sources({
    ...params,
    companyId: params.companyId || erpState.currentUser?.companyId,
    limit: params.limit || 100000,
  });
}

// 供应商管理「已绑定」Tab 服务端分页：返回 { rows, total }。一次调用同时拿当页和总数，
// 避免 list / count 分两个 IPC 出现游标竞态。client 走本地 cache.db 分页，host 走本地 SQL。
async function listMappingsPageRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    try {
      // 首页等一次增量同步保证数据新鲜（无游标自动转全量建基线）；翻页后台静默追增量。
      if (!Number(params.offset)) await mappingCache.triggerSync({ mode: "incremental" });
      else void mappingCache.triggerSync({ mode: "incremental" }).catch(() => {});
      void mappingCache.triggerReconcile().catch(() => {});
      const rows = mappingCache.getCachedMappings(params);
      const total = mappingCache.getCachedMappingsCount(params);
      if (rows !== null && total !== null) return { rows, total };
    } catch {
      // 缓存损坏 / 同步异常 → 降级跨海全量，本地切片返回。
    }
    const payload = await remoteRequest("/api/master-data/mappings", { method: "POST", body: { limit: 100000 } });
    const all = (payload && payload.mappings) || [];
    const offset = Math.max(0, Number(params.offset) || 0);
    const limit = Math.max(1, Number(params.limit) || 500);
    return { rows: all.slice(offset, offset + limit), total: all.length };
  }
  const companyId = params.companyId || erpState.currentUser?.companyId;
  return {
    rows: listSku1688Sources({ ...params, companyId, limit: params.limit || 500 }),
    total: countSku1688Sources({ ...params, companyId }),
  };
}

// 供应商管理「未绑定」Tab 服务端分页：返回 { rows, total }。未绑定 = sku 减去 mapping，
// 依赖 sku_cache 与 mapping_cache 两份本地缓存，首页同时等两者就绪后再求差。
async function listUnmappedSkusPageRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    try {
      if (!Number(params.offset)) {
        await skuCache.triggerSync({ mode: "incremental" });
        await mappingCache.triggerSync({ mode: "incremental" });
      } else {
        void skuCache.triggerSync({ mode: "incremental" }).catch(() => {});
        void mappingCache.triggerSync({ mode: "incremental" }).catch(() => {});
      }
      const rows = skuCache.getCachedUnmappedSkus(params);
      const total = skuCache.getCachedUnmappedSkusCount(params);
      if (rows !== null && total !== null) return { rows, total };
    } catch {
      // 双表求差依赖本地缓存，跨海无对应接口；降级返回空，前端提示刷新。
    }
    return { rows: [], total: 0 };
  }
  const companyId = params.companyId || erpState.currentUser?.companyId;
  return {
    rows: listSkus({ ...params, companyId, unmappedOnly: true, limit: params.limit || 500 }),
    total: countUnmappedSkus({ ...params, companyId }),
  };
}

async function createSkuRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...payload,
        action: "create_sku",
      },
    });
    return response.result;
  }
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return createSku(payload || {}, actor);
}

async function saveSkuBundleRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...payload,
        action: "save_sku_bundle",
      },
    });
    void skuCache.triggerSync({ mode: "incremental" }).catch(() => {});
    return response.result;
  }
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return saveSkuBundle(payload || {}, actor);
}

async function listSkuBundleComponentsRuntime(params = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...params,
        action: "list_sku_bundle_components",
      },
    });
    return response.result || [];
  }
  return listSkuBundleComponents(params || {});
}

async function deleteSkuRuntime(payload = {}, actor = {}) {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const response = await remoteRequest("/api/master-data/action", {
      method: "POST",
      body: {
        ...payload,
        action: "delete_sku",
      },
    });
    return response.result;
  }
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return deleteSku(payload || {}, actor);
}

function getLanServiceStatus() {
  if (shouldUseClientRuntime()) {
    ensureClientRuntime();
    const runtime = getRuntimeStatus();
    return {
      running: Boolean(runtime.serverUrl),
      port: runtime.serverUrl ? Number(new URL(runtime.serverUrl).port || 80) : 0,
      bindAddress: "remote",
      startedAt: null,
      localUrl: runtime.serverUrl,
      primaryUrl: runtime.serverUrl,
      lanUrls: runtime.serverUrl ? [runtime.serverUrl] : [],
      routes: [],
      authMode: "client-session",
      sessionCount: runtime.connected ? 1 : 0,
      lastError: null,
      clientMode: true,
    };
  }
  return getLanStatus();
}

function startLanService(payload = {}) {
  assertHostMode("局域网服务");
  requireErp();
  return startLanServer({
    port: Number(payload.port) || undefined,
    bindAddress: optionalString(payload.bindAddress) || undefined,
    db: erpState.db,
    getErpStatus,
    getPurchaseWorkbench,
    getWarehouseWorkbench,
    getQcWorkbench,
    getOutboundWorkbench,
    performPurchaseAction,
    performWarehouseAction,
    performQcAction,
    performOutboundAction,
    listWorkItems: listWorkItemsForUser,
    getWorkItemStats: getWorkItemStatsForUser,
    generateWorkItems: generateWorkItemsForUser,
    updateWorkItemStatus: updateWorkItemStatusForUser,
    listCompanies,
    getPermissionProfile,
    upsertRolePermission,
    upsertUserResourceScope,
    listAccounts,
    upsertAccount,
    deleteAccount,
    listSuppliers,
    createSupplier,
    listSkus,
    listSkuStockDetails,
    listSku1688Sources,
    createSku,
    deleteSku,
    saveSkuBundle,
    listSkuBundleComponents,
    sessionStore: createLanSessionStore(),
    verifyLogin: verifyLanLogin,
    validateSessionUser: validateLanSessionUser,
    listUsers,
    upsertUser: upsertUserAndBroadcast,
    get1688AuthStatus,
    upsert1688AuthConfig,
    save1688ManualToken,
    create1688AuthorizeUrl,
    complete1688OAuth,
    refresh1688AccessToken,
    receive1688Message,
    list1688PurchaseAccounts,
    ingestJushuitanExtensionBatch,
  });
}

function bootstrapAdminFromEnv(env = process.env) {
  if (countUsers() > 0) {
    return {
      created: false,
      reason: "users_exist",
    };
  }

  const name = optionalString(env.ERP_ADMIN_NAME);
  const accessCode = optionalString(env.ERP_ADMIN_CODE);
  if (!name || !accessCode) {
    return {
      created: false,
      reason: "missing_env",
      message: "Set ERP_ADMIN_NAME and ERP_ADMIN_CODE before first start to bootstrap the admin account.",
    };
  }

  if (env.ERP_COMPANY_NAME || env.ERP_COMPANY_CODE) {
    upsertCompany({
      id: DEFAULT_COMPANY_ID,
      name: optionalString(env.ERP_COMPANY_NAME) || DEFAULT_COMPANY_NAME,
      code: optionalString(env.ERP_COMPANY_CODE) || DEFAULT_COMPANY_CODE,
      status: "active",
    });
  }
  createBootstrapAdmin({ name, accessCode });
  return {
    created: true,
    name,
  };
}

function getAuto1688OrderSyncIntervalMs(env = process.env) {
  const value = Number(env.ERP_AUTO_1688_ORDER_SYNC_INTERVAL_MS);
  if (Number.isFinite(value) && value > 0) return Math.max(60 * 1000, Math.floor(value));
  return AUTO_1688_ORDER_SYNC_INTERVAL_MS;
}

function isAuto1688OrderSyncDisabled(env = process.env) {
  return ["0", "false", "off", "disabled"].includes(
    String(env.ERP_AUTO_1688_ORDER_SYNC || "").trim().toLowerCase(),
  );
}

async function runAuto1688OrderSyncOnce() {
  if (erpState.auto1688OrderSyncRunning) return null;
  erpState.auto1688OrderSyncRunning = true;
  try {
    const accounts = list1688PurchaseAccounts(DEFAULT_COMPANY_ID).accounts
      .filter((account) => account.status !== "disabled" && account.authorized);
    const targets = accounts.length ? accounts : [{ id: null, label: "" }];
    const results = [];
    for (const account of targets) {
      try {
        const result = await performPurchaseAction({
          action: "import_1688_orders",
          pageSize: 50,
          autoGenerate: false,
          limit: 200,
          includeWorkbench: false,
          ...(account.id ? { purchase1688AccountId: account.id } : {}),
        }, { role: "admin" });
        results.push({
          purchase1688AccountId: account.id || null,
          label: account.label || account.memberId || account.appKey || "",
          status: "success",
          importedCount: Number(result?.result?.importedCount || 0),
        });
      } catch (error) {
        results.push({
          purchase1688AccountId: account.id || null,
          label: account.label || account.memberId || account.appKey || "",
          status: "failed",
          error: error?.message || String(error),
        });
      }
    }
    return {
      accountCount: targets.length,
      results,
    };
  } finally {
    erpState.auto1688OrderSyncRunning = false;
  }
}

function startAuto1688OrderSync(env = process.env) {
  if (isAuto1688OrderSyncDisabled(env) || erpState.auto1688OrderSyncTimer) return null;
  const intervalMs = getAuto1688OrderSyncIntervalMs(env);
  const startDelayMs = Math.min(AUTO_1688_ORDER_SYNC_START_DELAY_MS, intervalMs);
  const tick = () => {
    void runAuto1688OrderSyncOnce();
  };
  erpState.auto1688OrderSyncTimer = setInterval(tick, intervalMs);
  if (typeof erpState.auto1688OrderSyncTimer.unref === "function") {
    erpState.auto1688OrderSyncTimer.unref();
  }
  const startTimer = setTimeout(tick, startDelayMs);
  if (typeof startTimer.unref === "function") {
    startTimer.unref();
  }
  return { intervalMs, startDelayMs };
}

function stopAuto1688OrderSync() {
  if (!erpState.auto1688OrderSyncTimer) return;
  clearInterval(erpState.auto1688OrderSyncTimer);
  erpState.auto1688OrderSyncTimer = null;
  erpState.auto1688OrderSyncRunning = false;
}

async function startErpHeadlessServer(options = {}) {
  const env = options.env || process.env;
  erpState.userDataDir = options.userDataDir || erpState.userDataDir || env.TEMU_USER_DATA || env.APP_USER_DATA || null;
  const initResult = initializeHostErp({
    userDataDir: erpState.userDataDir,
    dataDir: options.dataDir || env.ERP_DATA_DIR,
    dbPath: options.dbPath || env.ERP_DB_PATH,
  });
  const bootstrap = bootstrapAdminFromEnv(env);
  const lanStatus = await startLanServer({
    port: Number(options.port || env.ERP_PORT) || DEFAULT_LAN_PORT,
    bindAddress: optionalString(options.bindAddress || env.ERP_BIND_ADDRESS) || DEFAULT_BIND_ADDRESS,
    db: erpState.db,
    getErpStatus,
    getPurchaseWorkbench,
    getWarehouseWorkbench,
    getQcWorkbench,
    getOutboundWorkbench,
    performPurchaseAction,
    performWarehouseAction,
    performQcAction,
    performOutboundAction,
    listWorkItems: listWorkItemsForUser,
    getWorkItemStats: getWorkItemStatsForUser,
    generateWorkItems: generateWorkItemsForUser,
    updateWorkItemStatus: updateWorkItemStatusForUser,
    listCompanies,
    getPermissionProfile,
    upsertRolePermission,
    upsertUserResourceScope,
    listAccounts,
    upsertAccount,
    deleteAccount,
    listSuppliers,
    createSupplier,
    listSkus,
    listSkuStockDetails,
    listSku1688Sources,
    createSku,
    deleteSku,
    saveSkuBundle,
    listSkuBundleComponents,
    sessionStore: createLanSessionStore(),
    verifyLogin: verifyLanLogin,
    validateSessionUser: validateLanSessionUser,
    listUsers,
    upsertUser: upsertUserAndBroadcast,
    get1688AuthStatus,
    upsert1688AuthConfig,
    save1688ManualToken,
    create1688AuthorizeUrl,
    complete1688OAuth,
    refresh1688AccessToken,
    receive1688Message,
    list1688PurchaseAccounts,
    ingestJushuitanExtensionBatch,
  });
  const auto1688OrderSync = startAuto1688OrderSync(env);

  return {
    initResult,
    bootstrap,
    lanStatus,
    auto1688OrderSync,
  };
}

function stopLanService() {
  assertHostMode("局域网服务");
  return stopLanServer();
}

function getJushuitanService() {
  const { services } = requireErp();
  if (!services?.jushuitan) throw new Error("聚水潭数据服务未初始化");
  return services.jushuitan;
}

function getJushuitanActor(actorInput = {}) {
  const actor = getCurrentSessionActor(actorInput || {});
  if (!actor.role) return { role: "admin" };
  return actor;
}

function ingestJushuitanExtensionBatch(payload = {}, actor = {}) {
  assertHostMode("Extension ingest");
  const items = Array.isArray(payload.items) ? payload.items : [];
  const feishuItems = items.filter(looksLikeFeishuSupplierSource);
  const otherItems = items.filter((item) => !looksLikeFeishuSupplierSource(item));
  const nextActor = actor && actor.role ? actor : { role: "admin", companyId: payload.companyId || payload.company_id || DEFAULT_COMPANY_ID };
  const result = {
    source: "extension",
    feishu: null,
    jushuitan: null,
  };

  if (feishuItems.length || looksLikeFeishuSupplierSource(payload)) {
    result.feishu = importFeishuSuppliersFromExtensionRuntime({
      ...payload,
      items: feishuItems.length ? feishuItems : items,
    }, nextActor);
  }

  if (otherItems.length || (!feishuItems.length && !looksLikeFeishuSupplierSource(payload))) {
    const service = getJushuitanService();
    result.jushuitan = service.ingestExtensionBatch({
      ...payload,
      items: otherItems.length ? otherItems : items,
    }, nextActor);
  }

  return Promise.all([
    Promise.resolve(result.feishu),
    Promise.resolve(result.jushuitan),
  ]).then(([feishu, jushuitan]) => ({
    source: "extension",
    feishu,
    jushuitan,
    imported: Number(feishu?.imported || 0),
    created: Number(feishu?.created || 0),
    updated: Number(feishu?.updated || 0),
    skipped: Number(feishu?.skipped || 0),
  }));
}

function getJushuitanStatusRuntime(params = {}) {
  assertHostMode("聚水潭数据导入");
  return getJushuitanService().getAuthStatus(getJushuitanActor(params.actor || {}));
}

function saveJushuitanSourceRuntime(payload = {}) {
  assertHostMode("聚水潭数据导入");
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return getJushuitanService().saveSource(payload, getJushuitanActor(payload.actor || {}));
}

function importJushuitanFileRuntime(payload = {}) {
  assertHostMode("聚水潭数据导入");
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return getJushuitanService().importFile(payload, getJushuitanActor(payload.actor || {}));
}

function openJushuitanWebCollectorRuntime(payload = {}) {
  assertHostMode("聚水潭网页采集");
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return getJushuitanService().openWebCollector(payload, getJushuitanActor(payload.actor || {}));
}

function collectJushuitanWebPageRuntime(payload = {}) {
  assertHostMode("聚水潭网页采集");
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return getJushuitanService().collectWebPage(payload, getJushuitanActor(payload.actor || {}));
}

function closeJushuitanWebCollectorRuntime(payload = {}) {
  assertHostMode("聚水潭网页采集");
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return getJushuitanService().closeWebCollector(payload, getJushuitanActor(payload.actor || {}));
}

function syncJushuitanOperationalRuntime(payload = {}) {
  assertHostMode("Jushuitan operational bridge");
  assertRoleIfLoggedIn(["admin", "manager", "operations"]);
  return getJushuitanService().syncToOperationalTables(payload, getJushuitanActor(payload.actor || {}));
}

function listJushuitanJobsRuntime(params = {}) {
  assertHostMode("聚水潭数据导入");
  return getJushuitanService().listJobs(params, getJushuitanActor(params.actor || {}));
}

function listJushuitanRawRuntime(params = {}) {
  assertHostMode("聚水潭数据导入");
  return getJushuitanService().listRawRecords(params, getJushuitanActor(params.actor || {}));
}

// 0.3.22 诊断：把高频出问题的 IPC handler 包一层 try/catch + 超时 + 落本地日志。
//   - 把 "reply was never sent"（promise 永不 settle）变成具体超时错误传给 renderer
//   - 错误同时写到 <userData>/diagnostics/erp-ipc.log，现场可直接拷回查堆栈
// 只在 registerErpIpcHandlers 内被用到，因此本函数定义紧跟在它之前。
function wrapErpHandler(name, fn, { timeoutMs = 180000 } = {}) {
  return async (event, ...args) => {
    const t0 = Date.now();
    let timer = null;
    try {
      return await Promise.race([
        Promise.resolve().then(() => fn(event, ...args)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`handler timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
          if (timer.unref) timer.unref();
        }),
      ]);
    } catch (error) {
      const elapsedMs = Date.now() - t0;
      const message = error?.message || String(error);
      const stack = error?.stack || "";
      try {
        console.error(`[ERP-IPC] ${name} failed in ${elapsedMs}ms: ${message}\n${stack}`);
      } catch {}
      try {
        if (erpState.userDataDir) {
          const dir = path.join(erpState.userDataDir, "diagnostics");
          fs.mkdirSync(dir, { recursive: true });
          const line = `[${new Date().toISOString()}] ${name} ${elapsedMs}ms ${message}\n${stack}\n\n`;
          fs.appendFileSync(path.join(dir, "erp-ipc.log"), line);
        }
      } catch {}
      const wrapped = new Error(`[${name}] ${message}`);
      wrapped.cause = error;
      throw wrapped;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

function registerErpIpcHandlers(ipcMain) {
  ipcMain.on("erp:events:subscribe", (event) => subscribeRendererEvents(event.sender));
  ipcMain.on("erp:events:unsubscribe", (event) => unsubscribeRendererEvents(event.sender));
  ipcMain.handle("erp:get-status", () => getErpStatus());
  ipcMain.handle("erp:run-migrations", () => {
    assertHostMode("Migration");
    return rerunMigrations();
  });
  ipcMain.handle("erp:sync-temu-sales", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest("/api/temu/sales-sync", {
          method: "POST",
          body: payload || {},
        });
      }
      requireErp();
      const { TemuSalesBridge } = require("./services/temuSalesBridge.cjs");
      const bridge = new TemuSalesBridge({ db: erpState.db });
      const result = bridge.sync(payload || {});
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle("erp:get-enums", () => enums);
  ipcMain.handle("erp:auth:get-status", () => getAuthStatus());
  ipcMain.handle("erp:auth:get-current-user", async () => {
    const status = await getAuthStatus();
    return status.currentUser || null;
  });
  ipcMain.handle("erp:auth:create-first-admin", (_event, payload) => createFirstAdmin(payload || {}));
  ipcMain.handle("erp:auth:login", (_event, payload) => loginElectronUser(payload || {}));
  ipcMain.handle("erp:auth:logout", () => logoutElectronUser());
  ipcMain.handle("erp:client:get-status", () => getClientRuntimeStatus());
  ipcMain.handle("erp:client:set-host-mode", () => switchToHostMode());
  ipcMain.handle("erp:client:set-client-mode", (_event, payload) => switchToClientMode(payload || {}));
  ipcMain.handle("erp:client:discover", (_event, payload) => discoverControllers(payload || {}));
  ipcMain.handle("erp:company:list", (_event, params) => {
    assertHostMode("公司管理");
    return listCompanies(params || {});
  });
  ipcMain.handle("erp:company:upsert", (_event, payload) => {
    assertHostMode("公司管理");
    assertRoleIfLoggedIn(["admin", "manager"]);
    return upsertCompany(payload || {});
  });
  ipcMain.handle("erp:account:list", wrapErpHandler("erp:account:list", (_event, params) => listAccountsRuntime(params || {})));
  ipcMain.handle("erp:account:upsert", (_event, payload) => upsertAccountRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:account:delete", (_event, payload) => deleteAccountRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:user:list", (_event, params) => {
    if (!shouldUseClientRuntime()) assertHostMode("用户管理");
    return listUsersRuntime(params || {});
  });
  ipcMain.handle("erp:user:upsert", (_event, payload) => {
    if (!shouldUseClientRuntime()) assertHostMode("用户管理");
    return upsertUserRuntime(payload || {}, erpState.currentUser || {});
  });
  ipcMain.handle("erp:permission:get-profile", () => {
    if (shouldUseClientRuntime()) {
      ensureClientRuntime();
      return remoteRequest("/api/permissions/profile");
    }
    assertHostMode("权限档案");
    return getPermissionProfile(erpState.currentUser);
  });
  ipcMain.handle("erp:permission:upsert-role", (_event, payload) => {
    assertHostMode("角色权限");
    assertRoleIfLoggedIn(["admin", "manager"]);
    return upsertRolePermission(payload || {}, erpState.currentUser || {});
  });
  ipcMain.handle("erp:permission:upsert-scope", (_event, payload) => {
    assertHostMode("资源权限");
    assertRoleIfLoggedIn(["admin", "manager"]);
    return upsertUserResourceScope(payload || {}, erpState.currentUser || {});
  });
  ipcMain.handle("erp:supplier:list", wrapErpHandler("erp:supplier:list", (_event, params) => listSuppliersRuntime(params || {})));
  ipcMain.handle("erp:supplier:create", (_event, payload) => createSupplierRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:supplier:import-feishu-once", (_event, payload) => importFeishuSuppliersOnceRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:sku:list", (_event, params) => listSkusRuntime(params || {}));
  ipcMain.handle("erp:sku:stock-details", (_event, params) => listSkuStockDetailsRuntime(params || {}));
  ipcMain.handle("erp:sku:create", (_event, payload) => createSkuRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:sku:delete", (_event, payload) => deleteSkuRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:sku:bundle-save", (_event, payload) => saveSkuBundleRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:sku:bundle-components", (_event, params) => listSkuBundleComponentsRuntime(params || {}));
  // 供应商管理「未绑定」Tab 服务端分页：返回 { rows, total }。
  ipcMain.handle("erp:sku:unmapped-page", (_event, params) => listUnmappedSkusPageRuntime(params || {}));
  // 商品资料本地缓存（client 模式）：手动强刷 + 状态查询。
  ipcMain.handle("erp:sku:sync", (_event, options) => skuCache.triggerSync(options || {}));
  ipcMain.handle("erp:sku:cache-status", (_event, options) => skuCache.getCacheStatus(options || {}));
  ipcMain.handle("erp:mapping:list", (_event, params) => listMappingsRuntime(params || {}));
  // 供应商管理「已绑定」Tab 服务端分页：返回 { rows, total }。
  ipcMain.handle("erp:mapping:page", (_event, params) => listMappingsPageRuntime(params || {}));
  ipcMain.handle("erp:mapping:sync", (_event, options) => mappingCache.triggerSync(options || {}));
  ipcMain.handle("erp:mapping:cache-status", (_event, options) => mappingCache.getCacheStatus(options || {}));
  ipcMain.handle("erp:purchase:workbench", wrapErpHandler("erp:purchase:workbench", (_event, params) => getPurchaseWorkbenchRuntime(params || {})));
  ipcMain.handle("erp:purchase:action", (_event, payload) => performPurchaseActionRuntime(payload || {}));
  ipcMain.handle("erp:warehouse:workbench", (_event, params) => getWarehouseWorkbenchRuntime(params || {}));
  ipcMain.handle("erp:warehouse:action", (_event, payload) => performWarehouseActionRuntime(payload || {}));
  ipcMain.handle("erp:qc:workbench", (_event, params) => getQcWorkbenchRuntime(params || {}));
  ipcMain.handle("erp:qc:action", (_event, payload) => performQcActionRuntime(payload || {}));
  ipcMain.handle("erp:outbound:workbench", (_event, params) => getOutboundWorkbenchRuntime(params || {}));
  ipcMain.handle("erp:outbound:action", (_event, payload) => performOutboundActionRuntime(payload || {}));
  ipcMain.handle("erp:workItem:list", (_event, params) => listWorkItemsRuntime(params || {}));
  ipcMain.handle("erp:workItem:stats", (_event, params) => getWorkItemStatsRuntime(params || {}));
  ipcMain.handle("erp:workItem:generate", (_event, payload) => generateWorkItemsRuntime(payload || {}));
  ipcMain.handle("erp:workItem:update-status", (_event, payload) => updateWorkItemStatusRuntime(payload || {}));
  ipcMain.handle("erp:workflow:can-transition", (_event, payload) => canTransition(payload || {}));
  ipcMain.handle("erp:workflow:transition", (_event, payload) => transitionWorkflow(payload || {}));
  ipcMain.handle("erp:qc:decide", (_event, payload) => decideQCResult(payload || {}));
  ipcMain.handle("erp:lan:get-status", () => getLanServiceStatus());
  ipcMain.handle("erp:lan:start", (_event, payload) => startLanService(payload || {}));
  ipcMain.handle("erp:lan:stop", () => stopLanService());
  ipcMain.handle("erp:jushuitan:get-status", (_event, params) => getJushuitanStatusRuntime(params || {}));
  ipcMain.handle("erp:jushuitan:save-source", (_event, payload) => saveJushuitanSourceRuntime(payload || {}));
  ipcMain.handle("erp:jushuitan:import-file", (_event, payload) => importJushuitanFileRuntime(payload || {}));
  ipcMain.handle("erp:jushuitan:open-web-collector", (_event, payload) => openJushuitanWebCollectorRuntime(payload || {}));
  ipcMain.handle("erp:jushuitan:collect-web-page", (_event, payload) => collectJushuitanWebPageRuntime(payload || {}));
  ipcMain.handle("erp:jushuitan:close-web-collector", (_event, payload) => closeJushuitanWebCollectorRuntime(payload || {}));
  ipcMain.handle("erp:jushuitan:sync-operational", (_event, payload) => syncJushuitanOperationalRuntime(payload || {}));
  ipcMain.handle("erp:jushuitan:list-jobs", (_event, params) => listJushuitanJobsRuntime(params || {}));
  ipcMain.handle("erp:jushuitan:list-raw", (_event, params) => listJushuitanRawRuntime(params || {}));
  ipcMain.handle("erp:diagnostics:probe-1688-mtop", (_event, payload) => probe1688MtopFromClient(payload || {}));
}

// 在客户端本机依次探 4 个 1688 mtop 端点 + 主控端 health。
// 每步独立 12s 上限。返回结构：[{ name, url, elapsedMs, status, ok, error, antiBot, bodyPreview }, ...]
async function probe1688MtopFromClient(options = {}) {
  const fetchImpl = (typeof fetch === "function" ? fetch : (await import("undici")).fetch);
  const stepTimeoutMs = Number(options.stepTimeoutMs) || 12000;
  const probes = [
    {
      name: "01-erp-health",
      url: `${HK_SERVER_URL}/health`,
    },
    {
      name: "02-mmstat-cna",
      url: `https://log.mmstat.com/eg.js?t=${Date.now()}`,
      headers: { Referer: "https://www.1688.com/" },
    },
    {
      name: "03-mtop-token",
      url: `https://h5api.m.1688.com/h5/mtop.ovs.traffic.landing.seotaglist.queryhotsearchword/1.0/?jsv=2.7.2&appKey=12574478&t=${Date.now()}&api=mtop.ovs.traffic.landing.seotaglist.queryHotSearchWord&v=1.0&type=jsonp&dataType=jsonp&callback=mtopjsonp1&preventFallback=true&data=%7B%7D`,
    },
    {
      name: "04-search-image",
      url: "https://search.1688.com/service/imageSearchOfferResultViewService?tab=imageSearch&imageId=test&beginPage=1&pageSize=10",
      headers: { Origin: "https://s.1688.com", Referer: "https://s.1688.com/" },
    },
  ];
  const results = [];
  for (const probe of probes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), stepTimeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetchImpl(probe.url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "*/*",
          ...(probe.headers || {}),
        },
        signal: controller.signal,
      });
      const text = await res.text();
      const elapsedMs = Date.now() - t0;
      const antiBot = /rgv587_flag|deny_h5|punish/i.test(text);
      results.push({
        name: probe.name,
        url: probe.url.split("?")[0],
        elapsedMs,
        status: res.status,
        ok: res.ok && !antiBot,
        antiBot,
        bodyPreview: text.slice(0, 240).replace(/\s+/g, " "),
      });
    } catch (e) {
      const elapsedMs = Date.now() - t0;
      results.push({
        name: probe.name,
        url: probe.url.split("?")[0],
        elapsedMs,
        status: 0,
        ok: false,
        error: `${e?.code || ""} ${e?.message || e}`.trim(),
        causeError: e?.cause ? `${e.cause.code || ""} ${e.cause.message || e.cause}`.trim() : "",
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    timestamp: new Date().toISOString(),
    probes: results,
  };
}

function closeErp() {
  stopAuto1688OrderSync();
  stopLanServer().catch(() => {});
  if (erpState.db) {
    try { erpState.db.close(); } catch {}
  }
  erpState.db = null;
  erpState.services = null;
  erpState.initResult = null;
  erpState.initError = null;
  erpState.currentUser = null;
}

module.exports = {
  initializeErp,
  getErpStatus,
  startErpHeadlessServer,
  registerErpIpcHandlers,
  closeErp,
  runScheduledOrderSync,
  resetScheduledOrderSyncState,
  runScheduledMessageReprocess,
};
