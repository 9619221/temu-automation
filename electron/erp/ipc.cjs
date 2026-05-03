const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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
  "upsert_sku_1688_source",
  "delete_sku_1688_source",
  "bind_1688_candidate_spec",
  "validate_1688_order_push",
  "preview_1688_order",
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
]);

const ACCESS_CODE_ITERATIONS = 120000;
const ACCESS_CODE_KEY_LENGTH = 32;
const ACCESS_CODE_DIGEST = "sha256";
const VALID_USER_ROLES = new Set(["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"]);
const VALID_USER_STATUSES = new Set(["active", "blocked"]);
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
  return String(key).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
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
  return Math.max(1, Math.min(Math.floor(number), 500));
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
  configureClientRuntime({ userDataDir: erpState.userDataDir });

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

  if (runtime.mode === "unset" && !hasExistingErpDatabase(options)) {
    erpState.initResult = {
      mode: "unset",
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
    setHostMode();
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
  const conditions = [];
  if (companyId) conditions.push("acct.company_id = @company_id");
  if (!includeDeleted) conditions.push("acct.status != 'deleted'");
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
        ORDER BY latest_addr.is_default DESC, latest_addr.updated_at DESC, latest_addr.created_at DESC
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
    updatedAt: row?.updated_at || "",
  };
}

function get1688AuthStatus(actor = erpState.currentUser) {
  requireErp();
  return to1688AuthStatus(get1688AuthRow(normalizeCompanyId(actor?.companyId || actor?.company_id, null)));
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
  const existing = get1688AuthRow(companyId);
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
  const row = {
    id: existing?.id || companySettingId(companyId),
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
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_1688_auth_settings (
      id, company_id, app_key, app_secret, redirect_uri, access_token, refresh_token,
      member_id, ali_id, resource_owner, token_payload_json,
      access_token_expires_at, refresh_token_expires_at, authorized_at,
      created_at, updated_at
    )
    VALUES (
      @id, @company_id, @app_key, @app_secret, @redirect_uri, @access_token, @refresh_token,
      @member_id, @ali_id, @resource_owner, @token_payload_json,
      @access_token_expires_at, @refresh_token_expires_at, @authorized_at,
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
      updated_at = excluded.updated_at
  `).run(row);

  return to1688AuthStatus(db.prepare("SELECT * FROM erp_1688_auth_settings WHERE id = ?").get(row.id));
}

function save1688ManualToken(payload = {}, actor = {}) {
  const { db } = requireErp();
  const hasCredentialInput = payload.appKey || payload.app_key || payload.appSecret || payload.app_secret || payload.redirectUri || payload.redirect_uri;
  if (hasCredentialInput) {
    upsert1688AuthConfig(payload, actor);
  }
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const setting = get1688AuthRow(companyId);
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
  return to1688AuthStatus(get1688AuthRow(companyId));
}

function create1688AuthorizeUrl(payload = {}, actor = {}) {
  if (payload.appKey || payload.app_key || payload.appSecret || payload.app_secret || payload.redirectUri || payload.redirect_uri) {
    upsert1688AuthConfig(payload, actor);
  }
  const { db } = requireErp();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const setting = get1688AuthRow(companyId);
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
    redirect_after: "/1688",
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
  const setting = get1688AuthRow(companyId);
  if (!setting?.app_key || !setting?.app_secret || !setting?.redirect_uri) {
    throw new Error("1688 authorization config is missing");
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
  return to1688AuthStatus(get1688AuthRow(companyId));
}

async function refresh1688AccessToken(actor = {}) {
  const { db } = requireErp();
  const companyId = normalizeCompanyId(actor?.companyId || actor?.company_id, null);
  const setting = get1688AuthRow(companyId);
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
  return to1688AuthStatus(get1688AuthRow(companyId));
}

function shouldRefresh1688AccessToken(row) {
  if (!row?.access_token || !row?.refresh_token || !row?.access_token_expires_at) return false;
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 5 * 60 * 1000;
}

async function getReady1688Credentials(actor = {}) {
  const companyId = normalizeCompanyId(actor?.companyId || actor?.company_id, null);
  let setting = get1688AuthRow(companyId);
  if (shouldRefresh1688AccessToken(setting)) {
    await refresh1688AccessToken(actor);
    setting = get1688AuthRow(companyId);
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
  };
}

function trimJsonForStorage(value, maxLength = 60000) {
  const text = JSON.stringify(value ?? {});
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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

async function call1688ProcurementApi({ db, actor, accountId, action, api, params }) {
  const credentials = await getReady1688Credentials(actor);
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
  if (isClientMode()) {
    const status = await remoteAuthStatus();
    erpState.currentUser = status.currentUser || null;
    return status;
  }
  return getLocalAuthStatus();
}

function createFirstAdmin(payload = {}) {
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

function ensureHostModeForLogin() {
  if (isClientMode()) {
    setHostMode();
    erpState.currentUser = null;
  }
  if (!erpState.db) {
    setHostMode();
    initializeHostErp({ userDataDir: erpState.userDataDir });
  }
}

async function loginElectronUser(payload = {}) {
  if (payload.serverUrl || isClientMode()) {
    const status = await remoteLogin(payload);
    erpState.currentUser = status.currentUser || null;
    return status;
  }
  ensureHostModeForLogin();
  const user = verifyLanLogin(payload);
  if (!user) throw new Error("用户名或访问码错误");
  erpState.currentUser = user;
  if (user.role === "admin") {
    try {
      await startLanService({});
    } catch (error) {
      console.warn("[ERP] Admin controller service start failed:", error?.message || error);
    }
  }
  return getLocalAuthStatus();
}

async function logoutElectronUser() {
  if (isClientMode()) {
    const status = await remoteLogout();
    erpState.currentUser = null;
    return status;
  }
  erpState.currentUser = null;
  return getLocalAuthStatus();
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
  const whereCompany = companyId ? "WHERE company_id = @company_id" : "";
  const rows = db.prepare(`
    SELECT *
    FROM erp_suppliers
    ${whereCompany}
    ORDER BY updated_at DESC, created_at DESC
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
    name: requireString(payload.name, "name"),
    contact_name: optionalString(payload.contactName),
    phone: optionalString(payload.phone),
    wechat: optionalString(payload.wechat),
    address: optionalString(payload.address),
    categories_json: JSON.stringify(Array.isArray(payload.categories) ? payload.categories : []),
    status: optionalString(payload.status) || "active",
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_suppliers (
      id, company_id, name, contact_name, phone, wechat, address, categories_json,
      status, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @name, @contact_name, @phone, @wechat, @address,
      @categories_json, @status, @created_at, @updated_at
    )
  `).run(row);

  return toSupplier(db.prepare("SELECT * FROM erp_suppliers WHERE id = ?").get(row.id));
}

function listSkus(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId || params.account_id);
  const companyId = optionalString(params.companyId || params.company_id);
  const includeDeleted = Boolean(params.includeDeleted || params.include_deleted);
  const conditions = [];
  if (accountId) conditions.push("(sku.account_id = @account_id OR sku.account_id IS NULL)");
  if (companyId) conditions.push("sku.company_id = @company_id");
  if (!includeDeleted) conditions.push("sku.status != 'deleted'");
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      sku.*,
      acct.name AS account_name,
      supplier.name AS system_supplier_name,
      COALESCE(inv.actual_stock_qty, 0) AS actual_stock_qty,
      inv.location_codes AS warehouse_location,
      COALESCE(inv.weighted_unit_landed_cost, source.unit_price) AS cost_price,
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
    LEFT JOIN erp_accounts acct ON acct.id = sku.account_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = sku.supplier_id
    LEFT JOIN (
      SELECT account_id, sku_id, COUNT(*) AS source_count
      FROM erp_sku_1688_sources
      WHERE status = 'active'
      GROUP BY account_id, sku_id
    ) source_count ON source_count.account_id = sku.account_id AND source_count.sku_id = sku.id
    LEFT JOIN (
      SELECT
        account_id,
        sku_id,
        SUM(available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) AS actual_stock_qty,
        GROUP_CONCAT(DISTINCT CASE
          WHEN (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) > 0 THEN NULLIF(location_code, '')
          ELSE NULL
        END) AS location_codes,
        CASE
          WHEN SUM(available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty) > 0 THEN
            SUM(unit_landed_cost * (available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty))
            / SUM(available_qty + reserved_qty + blocked_qty + defective_qty + rework_qty)
          ELSE NULL
        END AS weighted_unit_landed_cost
      FROM erp_inventory_batches
      GROUP BY account_id, sku_id
    ) inv ON inv.account_id = sku.account_id AND inv.sku_id = sku.id
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
  const internalSkuCode = optionalString(payload.internalSkuCode || payload.internal_sku_code)
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
    id: optionalString(payload.id) || createId("sku"),
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
    status: optionalString(payload.status) || "active",
    created_by: optionalString(payload.createdBy || payload.created_by || actor?.id),
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_skus (
      id, company_id, account_id, internal_sku_code, temu_sku_id, temu_product_id,
      temu_skc_id, product_name, color_spec, category, image_url, supplier_id,
      status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @account_id, @internal_sku_code, @temu_sku_id, @temu_product_id,
      @temu_skc_id, @product_name, @color_spec, @category, @image_url, @supplier_id,
      @status, @created_by, @created_at, @updated_at
    )
  `).run(row);

  return toCamelRow(db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(row.id));
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
    db.prepare("DELETE FROM erp_skus WHERE id = ?").run(skuId);
  })();

  return {
    id: skuId,
    deleted: true,
  };
}

function toSku1688Source(row) {
  if (!row) return null;
  const next = toCamelRow(row);
  next.isDefault = Boolean(row.is_default);
  next.ourQty = Number(row.our_qty || 1);
  next.platformQty = Number(row.platform_qty || 1);
  next.ratioText = `${next.ourQty}:${next.platformQty}`;
  next.sourcePayload = parseJsonObject(row.source_payload_json);
  delete next.sourcePayloadJson;
  return next;
}

function toSkuOptionRow(row) {
  const next = toCamelRow(row);
  next.procurementSourceCount = Number(row.procurement_source_count || 0);
  next.actualStockQty = Number(row.actual_stock_qty || 0);
  next.warehouseLocation = row.warehouse_location || "";
  next.costPrice = row.cost_price === null || row.cost_price === undefined ? null : Number(row.cost_price);
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
  const conditions = [];
  const values = {
    account_id: accountId,
    sku_id: skuId,
    status: optionalString(params.status),
    limit: normalizeLimit(params.limit, 500),
    offset: normalizeOffset(params.offset),
  };
  if (accountId) conditions.push("source.account_id = @account_id");
  if (skuId) conditions.push("source.sku_id = @sku_id");
  if (values.status) conditions.push("source.status = @status");
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
    our_qty: optionalPositiveInteger(payload.ourQty ?? payload.our_qty, 1),
    platform_qty: optionalPositiveInteger(payload.platformQty ?? payload.platform_qty, 1),
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
  if (!Number.isInteger(row.our_qty) || row.our_qty <= 0 || !Number.isInteger(row.platform_qty) || row.platform_qty <= 0) {
    throw new Error("1688 mapping ratio must be positive integers");
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
      @lead_days, @logistics_fee, @our_qty, @platform_qty, @status, @is_default, @remark, @source_payload_json,
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
      our_qty = excluded.our_qty,
      platform_qty = excluded.platform_qty,
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

function upsertSku1688SourceFromCandidate(db, candidate = {}, pr = {}, actor = {}, options = {}) {
  const externalOfferId = optionalString(candidate.external_offer_id || candidate.externalOfferId);
  if (!externalOfferId || !pr?.sku_id) return null;
  const sourcePayload = parseJsonObject(candidate.source_payload_json) || parseJsonObject(candidate.external_detail_json);
  const inferredCandidate = {
    ...candidate,
    raw: sourcePayload,
  };
  const externalSpecId = require1688SpecId(
    candidate.external_spec_id || candidate.externalSpecId || infer1688CandidateSpecId(inferredCandidate),
    "候选货源",
  );
  const externalSkuId = optionalString(candidate.external_sku_id || candidate.externalSkuId || infer1688CandidateSkuId(inferredCandidate));
  return upsertSku1688SourceRow(db, {
    accountId: candidate.account_id || pr.account_id,
    skuId: pr.sku_id,
    mappingGroupId: candidate.mapping_group_id || candidate.mappingGroupId || `map_${pr.sku_id}_${externalOfferId}_${externalSpecId}`,
    externalOfferId,
    externalSkuId,
    externalSpecId,
    platformSkuName: options.platformSkuName || options.platform_sku_name || candidate.platform_sku_name || candidate.platformSkuName || externalSpecId || externalSkuId,
    supplierName: candidate.supplier_name || candidate.supplierName,
    productTitle: candidate.product_title || candidate.productTitle,
    productUrl: candidate.product_url || candidate.productUrl,
    imageUrl: candidate.image_url || candidate.imageUrl,
    unitPrice: candidate.unit_price ?? candidate.unitPrice,
    moq: candidate.moq,
    leadDays: candidate.lead_days ?? candidate.leadDays,
    logisticsFee: candidate.logistics_fee ?? candidate.logisticsFee,
    ourQty: optionalPositiveInteger(options.ourQty ?? options.our_qty ?? candidate.our_qty ?? candidate.ourQty, 1),
    platformQty: optionalPositiveInteger(options.platformQty ?? options.platform_qty ?? candidate.platform_qty ?? candidate.platformQty, 1),
    sourcePayload,
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
  return {
    id: row?.id || id || null,
    name: row?.name || null,
    role: row?.role || optionalString(actor.role),
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
  const includeRequestDetails = params.includeRequestDetails !== false && params.include_request_details !== false;
  const includeOptions = params.includeOptions !== false && params.include_options !== false;
  const include1688Meta = params.include1688Meta !== false && params.include_1688_meta !== false;
  const detailPrId = optionalString(params.detailPrId || params.detail_pr_id || params.prId || params.pr_id);
  const whereAccount = accountId ? "WHERE pr.account_id = @account_id" : "";
  const poWhereAccount = accountId ? "WHERE po.account_id = @account_id" : "";
  const paymentWhereAccount = accountId ? "AND po.account_id = @account_id" : "";
  const baseParams = {
    account_id: accountId,
    limit,
  };

  const purchaseRequests = db.prepare(`
    SELECT
      pr.*,
      acct.name AS account_name,
      sku.internal_sku_code,
      sku.product_name,
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
      ) AS primary_mapping_offer_id
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
        next.sourcePayload = parseJsonObject(row.source_payload_json);
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
          actorName: item.actorName,
          actorRole: item.actorRole,
          message: item.message,
          eventType: item.eventType,
          createdAt: item.createdAt,
        })),
        ...comments.map((item) => ({
          id: item.id,
          kind: "comment",
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

  const purchaseOrders = db.prepare(`
    SELECT
      po.*,
      acct.name AS account_name,
      supplier.name AS supplier_name,
      creator.name AS created_by_name,
      pr.status AS pr_status,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code) AS sku_codes,
      GROUP_CONCAT(DISTINCT sku.product_name) AS product_names,
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
      ) AS latest_refund_amount
    FROM erp_purchase_orders po
    LEFT JOIN erp_accounts acct ON acct.id = po.account_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_users creator ON creator.id = po.created_by
    LEFT JOIN erp_purchase_requests pr ON pr.id = po.pr_id
    LEFT JOIN erp_purchase_order_lines line ON line.po_id = po.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${poWhereAccount}
    GROUP BY po.id
    ORDER BY
      CASE po.status
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
      po.updated_at DESC
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

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

  const summary = {
    purchaseRequestCount: purchaseRequests.length,
    pendingPurchaseRequestCount: purchaseRequests.filter((item) => (
      ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(item.status)
    )).length,
    purchaseOrderCount: purchaseOrders.length,
    openPurchaseOrderCount: purchaseOrders.filter((item) => (
      !["closed", "cancelled"].includes(item.status)
    )).length,
    paymentApprovalCount: paymentApprovals.length,
    paymentQueueCount: paymentQueue.length,
    paymentQueueAmount: paymentQueue.reduce((sum, item) => (
      sum + Number(item.paymentAmount ?? item.totalAmount ?? 0)
    ), 0),
    refundOrderCount: purchaseOrders.filter((item) => Number(item.refundCount || 0) > 0).length,
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
    purchaseOrders,
    paymentApprovals,
    paymentQueue,
    purchaseSettings,
  };
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

function createPaymentApprovalForPo({ db, services, po, payload, actor }) {
  const now = nowIso();
  const amount = optionalNumber(payload.amount) ?? Number(po.total_amount || 0);
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
  return after;
}

function confirmPaymentPaid({ db, services, payload, actor }) {
  const before = getLatestPaymentApproval(db, payload);
  if (before.status !== "approved") {
    throw new Error(`Payment approval is not approved: ${before.status}`);
  }

  services.purchase.confirmPaid(before.po_id, actor);
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
  if (status !== "draft") blockers.push(`当前状态为 ${status || "-"}`);
  if (paymentStatus !== "unpaid") blockers.push(`付款状态为 ${paymentStatus}`);
  if (has1688OrderTrace(po)) blockers.push("已有 1688 订单记录");
  if (getPurchaseOrderReceivedQty(db, po.id) > 0) blockers.push("已有入库数量");
  const paymentApprovalCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_payment_approvals WHERE po_id = ?").get(po.id)?.count || 0);
  if (paymentApprovalCount > 0) blockers.push("已有付款审批记录");
  const inboundReceiptCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_inbound_receipts WHERE po_id = ?").get(po.id)?.count || 0);
  if (inboundReceiptCount > 0) blockers.push("已有入库单");
  const inboundLineCount = countPurchaseOrderInboundLineRefs(db, po.id);
  if (inboundLineCount > 0) blockers.push("已有入库明细");
  const batchCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_inventory_batches WHERE po_id = ?").get(po.id)?.count || 0);
  if (batchCount > 0) blockers.push("已有库存批次");
  const refundCount = Number(db.prepare("SELECT COUNT(*) AS count FROM erp_1688_refunds WHERE po_id = ?").get(po.id)?.count || 0);
  if (refundCount > 0) blockers.push("已有售后记录");
  if (blockers.length) {
    throw new Error(`采购单不能删除：${blockers.join("、")}`);
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
      id, account_id, sku_id, requested_by, reason, requested_qty,
      target_unit_cost, expected_arrival_date, evidence_json, status, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @sku_id, @requested_by, @reason, @requested_qty,
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
  return toCamelRow(afterCandidate);
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
  return (configured || "https://erp.temu.chat").replace(/\/+$/, "");
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
    timeoutMs: 120000,
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

async function run1688WebImageSearch({ imageBuffer, beginPage, pageSize = 10 }) {
  const raw = await imageSearch1688Web({
    imageBuffer,
    beginPage,
    pageSize,
    timeoutMs: 120000,
  });
  return {
    imageId: raw.imageId,
    rawResponse: raw.rawResponse,
    products: Array.isArray(raw.products) ? raw.products : [],
  };
}

async function source1688ImageAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 image sourcing");
  const prId = requireString(payload.prId || payload.id, "prId");
  let pr = getPurchaseRequest(db, prId);
  const beginPage = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.beginPage) ?? 1)), 10));
  const importLimit = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.importLimit) ?? 10)), 20));
  const pageSize = Math.max(1, Math.min(importLimit, 50));
  const mockResults = Array.isArray(payload.mockResults) ? payload.mockResults : null;
  const { imgUrl, imageBuffer } = mockResults
    ? { imgUrl: optionalString(payload.imgUrl || payload.imageUrl), imageBuffer: null }
    : await resolveImageSearchAsset(db, payload, pr);

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
      } catch (error) {
        conversionError = error;
      }
    }

    try {
      if (normalized.length === 0 && imageBuffer?.length) {
        const webImageSearch = await run1688WebImageSearch({
          imageBuffer,
          beginPage,
          pageSize,
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
      }
    } catch (error) {
      searchError = error;
      if (!rawResponse) throw error;
    }
  }
  const emptyReason = normalized.length === 0 ? buildImageSearchEmptyReason(conversionError || searchError) : "";
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
  return addressParam;
}

function list1688DeliveryAddresses(params = {}) {
  const { db } = requireErp();
  const status = optionalString(params.status);
  const companyId = normalizeCompanyId(params.companyId || params.company_id, erpState.currentUser);
  const accountId = optionalString(params.accountId || params.account_id);
  const conditions = ["addr.company_id = @company_id"];
  const values = { company_id: companyId, status, account_id: accountId };
  if (status) conditions.push("addr.status = @status");
  if (accountId) conditions.push("addr.account_id = @account_id");
  const rows = db.prepare(`
    SELECT addr.*, acct.name AS account_name
    FROM erp_1688_delivery_addresses addr
    LEFT JOIN erp_accounts acct ON acct.id = addr.account_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY addr.is_default DESC, addr.updated_at DESC, addr.created_at DESC
  `).all(values);
  return rows.map(to1688DeliveryAddress);
}

function get1688DeliveryAddress(db, addressId = null, companyId = DEFAULT_COMPANY_ID, accountId = null) {
  const id = optionalString(addressId);
  const normalizedCompanyId = normalizeCompanyId(companyId, null);
  const normalizedAccountId = optionalString(accountId);
  if (id) {
    const row = db.prepare("SELECT * FROM erp_1688_delivery_addresses WHERE id = ? AND company_id = ?").get(id, normalizedCompanyId);
    if (!row) throw new Error(`1688 delivery address not found: ${id}`);
    const rowAccountId = optionalString(row.account_id);
    if (normalizedAccountId && rowAccountId && rowAccountId !== normalizedAccountId) {
      throw new Error("1688 delivery address does not belong to this store");
    }
    return row;
  }
  if (normalizedAccountId) {
    const row = db.prepare(`
      SELECT *
      FROM erp_1688_delivery_addresses
      WHERE company_id = @company_id
        AND (
          account_id = @account_id
          OR account_id IS NULL
          OR account_id = ''
        )
        AND status = 'active'
      ORDER BY
        CASE
          WHEN account_id = @account_id AND COALESCE(address_id, '') != '' THEN 0
          WHEN (account_id IS NULL OR account_id = '') AND COALESCE(address_id, '') != '' THEN 1
          WHEN account_id = @account_id THEN 2
          ELSE 3
        END,
        is_default DESC,
        updated_at DESC,
        created_at DESC
      LIMIT 1
    `).get({ company_id: normalizedCompanyId, account_id: normalizedAccountId });
    if (row) return row;
    const account = db.prepare("SELECT name FROM erp_accounts WHERE id = ?").get(normalizedAccountId);
    throw new Error(`店铺${account?.name ? `「${account.name}」` : ""}还没有绑定 1688 地址，请先到店铺维护`);
  }
  const row = db.prepare(`
    SELECT *
    FROM erp_1688_delivery_addresses
    WHERE company_id = @company_id
      AND (account_id IS NULL OR account_id = '')
      AND status = 'active'
    ORDER BY is_default DESC, updated_at DESC, created_at DESC
    LIMIT 1
  `).get({ company_id: normalizedCompanyId });
  if (!row) throw new Error("1688 delivery address is not configured");
  return row;
}

function save1688DeliveryAddressAction({ db, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "1688 delivery address config");
  const now = nowIso();
  const companyId = normalizeCompanyId(payload.companyId || payload.company_id, actor);
  const accountId = optionalString(payload.accountId || payload.account_id);
  if (accountId) {
    const account = db.prepare("SELECT id, company_id FROM erp_accounts WHERE id = ?").get(accountId);
    if (!account) throw new Error("店铺不存在，无法绑定 1688 地址");
    if (normalizeCompanyId(account.company_id, actor) !== companyId) {
      throw new Error("店铺不属于当前公司，无法绑定 1688 地址");
    }
  }
  const rawAddressParam = payload.rawAddressParam || payload.addressParam || {};
  const row = {
    id: optionalString(payload.addressId || payload.id) || createId("1688_addr"),
    company_id: companyId,
    account_id: accountId || null,
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
    if (row.account_id) {
      db.prepare("UPDATE erp_1688_delivery_addresses SET is_default = 0 WHERE company_id = ? AND account_id = ? AND id != ?")
        .run(row.company_id, row.account_id, row.id);
    } else {
      db.prepare("UPDATE erp_1688_delivery_addresses SET is_default = 0 WHERE company_id = ? AND (account_id IS NULL OR account_id = '') AND id != ?")
        .run(row.company_id, row.id);
    }
  }
  db.prepare(`
    INSERT INTO erp_1688_delivery_addresses (
      id, company_id, account_id, label, full_name, mobile, phone, post_code, province_text, city_text,
      area_text, town_text, address, address_id, raw_address_param_json,
      is_default, status, created_by, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @account_id, @label, @full_name, @mobile, @phone, @post_code, @province_text, @city_text,
      @area_text, @town_text, @address, @address_id, @raw_address_param_json,
      @is_default, @status, @created_by, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      account_id = excluded.account_id,
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

function findExisting1688AddressId(db, { companyId, accountId, alibabaAddressId }) {
  const remoteId = optionalString(alibabaAddressId);
  if (!remoteId) return null;
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
  const params = raw1688Params(payload, {
    webSite: optionalString(payload.webSite) || "1688",
  });
  if (payload.dryRun) return { dryRun: true, apiKey: PROCUREMENT_APIS.RECEIVE_ADDRESS.key, params };
  const rawResponse = payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId,
    action: "sync_1688_addresses",
    api: PROCUREMENT_APIS.RECEIVE_ADDRESS,
    params,
  });
  const addresses = normalize1688ReceiveAddressResponse(rawResponse);
  const saved = addresses.map((address) => {
    const existingId = findExisting1688AddressId(db, {
      companyId,
      accountId,
      alibabaAddressId: address.alibabaAddressId,
    });
    return save1688DeliveryAddressAction({
      db,
      actor,
      payload: {
        ...address,
        id: existingId || undefined,
        companyId,
        accountId,
      },
    });
  });
  return {
    apiKey: PROCUREMENT_APIS.RECEIVE_ADDRESS.key,
    query: params,
    addressCount: saved.length,
    addresses: saved,
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

function resolveExpectedDeliveryDate(candidate, payload = {}) {
  const explicit = optionalString(payload.expectedDeliveryDate);
  if (explicit) return explicit;
  const leadDays = Number(candidate.lead_days || 0);
  if (!Number.isFinite(leadDays) || leadDays <= 0) return null;
  const date = new Date();
  date.setDate(date.getDate() + leadDays);
  return date.toISOString().slice(0, 10);
}

function generatePurchaseOrderAction({ db, services, payload, actor }) {
  assertActorRole(actor, ["buyer", "manager", "admin"], "生成采购单");
  const prId = requireString(payload.prId || payload.id, "prId");
  let pr = getPurchaseRequest(db, prId);
  const candidate = applySelected1688SpecToCandidate(
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
  const totalAmount = qty * unitCost + logisticsFee;
  const po = {
    id: optionalString(payload.poId) || createId("po"),
    account_id: pr.account_id,
    pr_id: pr.id,
    selected_candidate_id: candidate.id,
    supplier_id: candidate.supplier_id || null,
    po_no: optionalString(payload.poNo) || buildPurchaseOrderNo(db),
    status: "draft",
    payment_status: "unpaid",
    expected_delivery_date: resolveExpectedDeliveryDate(candidate, payload),
    actual_delivery_date: null,
    total_amount: totalAmount,
    created_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_purchase_orders (
      id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
      status, payment_status, expected_delivery_date, actual_delivery_date,
      total_amount, created_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
      @status, @payment_status, @expected_delivery_date, @actual_delivery_date,
      @total_amount, @created_by, @created_at, @updated_at
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
    purchaseOrder: toCamelRow(afterPo),
  };
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
  const lookupSkuId = isLikely1688NumericSkuId(skuId) ? skuId : null;
  if (!offerId || (!lookupSkuId && !specId)) return null;
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
  try {
    const row = get1688DeliveryAddress(db, addressId, companyId, accountId);
    return build1688AddressParamFromRow(row);
  } catch (error) {
    if (payload.dryRun || payload.mockResponse || payload.mockPreviewResponse) return null;
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
        external_order_status = @external_order_status,
        external_order_synced_at = @external_order_synced_at,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: po.id,
    total_amount: amount,
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

async function runScheduledOrderSync({ maxAgeHours = 168, limit = 50, logger } = {}) {
  if (isClientMode()) return { skipped: "client_mode", processed: 0, results: [] };
  if (!erpState.db || !erpState.services) return { skipped: "erp_not_ready", processed: 0, results: [] };
  const { db, services } = requireErp();
  const candidates = selectPoIdsForScheduledSync(db, { maxAgeHours, limit });
  if (!candidates.length) return { processed: 0, results: [] };
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
  return {
    processed: candidates.length,
    bound: results.filter((r) => r.status === "bound").length,
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
    "remark",
    "eventDetail",
    "desc",
  ])).map((item) => ({
    time: optionalString(item.acceptTime || item.traceTime || item.time || item.timeStr),
    text: optionalString(item.remark || item.eventDetail || item.desc || item.description || item.context),
    raw: item,
  })).filter((item) => item.time || item.text);
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
  return {
    orderId: externalOrderId,
    // orderEntryIds 顶层（Long[] ACL 校验）+ input 内一份。
    ...(orderEntryIds.length ? { orderEntryIds } : {}),
    disputeRequest,
    goodsStatus,
    ...(applyPaymentCents !== null ? { applyPayment: applyPaymentCents, refundPayment: applyPaymentCents } : {}),
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

function map1688StatusToLocal(status, currentStatus, logistics = {}) {
  const text = String(status || "").toUpperCase();
  const current = optionalString(currentStatus);
  if (["closed", "cancelled", "inbounded"].includes(current)) return null;
  if (/CANCEL|TERMINATED|CLOSE/.test(text)) return "cancelled";
  if (logistics.signed) return "arrived";
  if (/CONFIRM_RECEIVE|RECEIVEGOODS|RECEIVED|SIGNED/.test(text)) return "arrived";
  if (/WAIT_BUYER_RECEIVE|SELLER_SEND|SHIPPED|SENDGOODS/.test(text) || logistics.shipped) return "shipped";
  if (/WAIT_SELLER_SEND|PAID|PAYED|WAIT_SELLER_DELIVER|SUCCESS/.test(text)) return "paid";
  if (/WAIT_BUYER_PAY|UNPAID|CREATED|PREVIEW/.test(text)) {
    return current === "draft" ? "pushed_pending_price" : null;
  }
  return null;
}

function map1688StatusToPaymentStatus(status, currentPaymentStatus) {
  const text = String(status || "").toUpperCase();
  if (/WAIT_SELLER_SEND|WAIT_BUYER_RECEIVE|PAID|PAYED|SUCCESS|SELLER_SEND|SHIPPED/.test(text)) return "paid";
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
    total_amount: optionalNumber(order.totalAmount),
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
  const rawResponse = payload.mockPaymentResponse || payload.mockResponse || await call1688ProcurementApi({
    db,
    actor,
    accountId: purchaseOrders[0]?.account_id || optionalString(payload.accountId),
    action: "get_1688_payment_url",
    api: PROCUREMENT_APIS.PAYMENT_URL,
    params: apiParams,
  });
  const paymentUrl = extract1688PaymentUrl(rawResponse);
  if (!paymentUrl) throw new Error("1688 没有返回支付链接，请检查订单是否待付款");
  const updated = purchaseOrders
    .filter((po) => orderIds.includes(String(po.external_order_id || "")))
    .map((po) => updatePurchaseOrderFrom1688Snapshot({
      db,
      services,
      po,
      order: { externalOrderId: po.external_order_id, status: po.external_order_status },
      paymentUrl,
      rawPayment: rawResponse,
      action: "get_1688_payment_url",
      actor,
    }));
  return {
    apiKey: PROCUREMENT_APIS.PAYMENT_URL.key,
    query: apiParams,
    paymentUrl,
    externalOrderIds: orderIds,
    purchaseOrders: updated.map(toCamelRow),
    rawResponse,
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
  if (/无法根据订单ID获取订单|订单不存在|订单已取消|订单已关闭/.test(message)) return true;
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
  const totalAmount = optionalNumber(order.totalAmount) ?? usableLines.reduce((sum, item) => (
    sum + Math.max(1, Math.floor(Number(item.line.quantity || 1))) * Number(item.source.unit_price || 0)
  ), 0);
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
      total_amount, created_by, created_at, updated_at,
      external_order_id, external_order_status, external_order_payload_json,
      external_order_synced_at, external_order_detail_json, external_order_detail_synced_at
    )
    VALUES (
      @id, @account_id, @pr_id, @selected_candidate_id, @supplier_id, @po_no,
      @status, @payment_status, @expected_delivery_date, @actual_delivery_date,
      @total_amount, @created_by, @created_at, @updated_at,
      @external_order_id, @external_order_status, @external_order_payload_json,
      @external_order_synced_at, @external_order_detail_json, @external_order_detail_synced_at
    )
  `).run(po);
  usableLines.forEach((item, index) => {
    const qty = Math.max(1, Math.floor(Number(item.line.quantity || 1)));
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
      sku_id: item.source.sku_id,
      qty,
      unit_cost: optionalNumber(item.source.unit_price) ?? unitFallback,
      logistics_fee: index === 0 ? (optionalNumber(order.freight) ?? 0) : 0,
      expected_qty: qty,
      received_qty: 0,
      remark: item.line.title || item.source.product_title || null,
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
  return getPurchaseWorkbench({
    limit: payload.limit,
    accountId: payload.accountId || payload.account_id,
    includeRequestDetails: payload.includeRequestDetails,
    includeOptions: payload.includeOptions,
    include1688Meta: payload.include1688Meta,
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
    const result = await source1688ImageAction({ db, services, payload, actor });
    broadcastPurchaseUpdate(action, sanitizeAlphaShopPayload(payload), actor, result);
    return {
      action,
      result,
      workbench: getPurchaseWorkbenchForAction(payload, actor),
    };
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
      case "generate_po": {
        return generatePurchaseOrderAction({ db, services, payload, actor });
      }
      case "delete_po": {
        return deletePurchaseOrderAction({ db, services, payload, actor });
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

function toInboundReceipt(row) {
  return toCamelRow(row);
}

function getWarehouseWorkbench(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId);
  const limit = normalizeLimit(params.limit, 50);
  const receiptWhereAccount = accountId ? "WHERE receipt.account_id = @account_id" : "";
  const batchWhereAccount = accountId ? "WHERE batch.account_id = @account_id" : "";
  const baseParams = {
    account_id: accountId,
    limit,
  };

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
      GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary
    FROM erp_inbound_receipts receipt
    LEFT JOIN erp_accounts acct ON acct.id = receipt.account_id
    LEFT JOIN erp_purchase_orders po ON po.id = receipt.po_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_users operator ON operator.id = receipt.operator_id
    LEFT JOIN erp_inbound_receipt_lines line ON line.receipt_id = receipt.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${receiptWhereAccount}
    GROUP BY receipt.id
    ORDER BY
      CASE receipt.status
        WHEN 'pending_arrival' THEN 0
        WHEN 'arrived' THEN 1
        WHEN 'counted' THEN 2
        WHEN 'inbounded_pending_qc' THEN 3
        WHEN 'quantity_mismatch' THEN 4
        WHEN 'damaged' THEN 5
        ELSE 9
      END,
      receipt.updated_at DESC
    LIMIT @limit
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
    LIMIT @limit
  `).all(baseParams).map(toCamelRow);

  const summary = {
    inboundReceiptCount: inboundReceipts.length,
    pendingArrivalCount: inboundReceipts.filter((item) => item.status === "pending_arrival").length,
    arrivedCount: inboundReceipts.filter((item) => item.status === "arrived").length,
    countedCount: inboundReceipts.filter((item) => item.status === "counted").length,
    inboundedPendingQcCount: inboundReceipts.filter((item) => item.status === "inbounded_pending_qc").length,
    inventoryBatchCount: inventoryBatches.length,
    receivedQty: inboundReceipts.reduce((sum, item) => sum + Number(item.receivedQty || 0), 0),
  };

  return {
    generatedAt: nowIso(),
    summary,
    inboundReceipts,
    inventoryBatches,
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

function getInboundLinesForBatchCreation(db, receiptId) {
  return db.prepare(`
    SELECT
      line.*,
      po_line.qty AS po_qty,
      po_line.unit_cost AS po_unit_cost,
      po_line.logistics_fee AS po_logistics_fee
    FROM erp_inbound_receipt_lines line
    LEFT JOIN erp_purchase_order_lines po_line ON po_line.id = line.po_line_id
    WHERE line.receipt_id = ?
    ORDER BY line.id ASC
  `).all(receiptId);
}

function calculateLineLandedCost(line) {
  const unitCost = Number(line.po_unit_cost || 0);
  const logisticsFee = Number(line.po_logistics_fee || 0);
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

    if (line.po_line_id) {
      db.prepare(`
        UPDATE erp_purchase_order_lines
        SET received_qty = received_qty + @received_qty
        WHERE id = @po_line_id
      `).run({
        po_line_id: line.po_line_id,
        received_qty: line.received_qty,
      });
    }

    batches.push(toCamelRow(batch));
  });

  if (receipt.po_id) {
    const po = getPurchaseOrder(db, receipt.po_id);
    if (po.status === "arrived") {
      services.purchase.markInbounded(po.id, actor);
    }
  }

  return batches;
}

function performWarehouseAction(payload = {}, actorInput = {}) {
  const { db, services } = requireErp();
  const action = requireString(payload.action, "action");
  const actor = normalizeActor(actorInput);

  const run = db.transaction(() => {
    switch (action) {
      case "register_arrival": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        const receipt = getInboundReceipt(db, receiptId);
        const transition = services.inventory.registerArrival(receiptId, actor);
        let poTransition = null;
        if (receipt.po_id) {
          const po = getPurchaseOrder(db, receipt.po_id);
          if (po.status === "shipped") {
            poTransition = services.purchase.markArrived(po.id, actor);
          }
        }
        return { transition, poTransition };
      }
      case "confirm_count": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        return services.inventory.confirmCount(receiptId, actor);
      }
      case "create_batches": {
        const receiptId = requireString(payload.receiptId || payload.id, "receiptId");
        const receipt = getInboundReceipt(db, receiptId);
        const batches = createBatchesForReceipt({
          db,
          services,
          receipt,
          actor,
        });
        return { batches };
      }
      default:
        throw new Error(`Unsupported warehouse action: ${action}`);
    }
  });

  const result = run();
  return {
    action,
    result,
    workbench: getWarehouseWorkbench({ limit: payload.limit }),
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
  return {
    transition,
    shipment: toCamelRow(getOutboundShipment(db, row.id)),
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
      case "start_picking": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        return services.outbound.startPicking(outboundId, actor);
      }
      case "mark_packed": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        return services.outbound.markPacked(outboundId, actor, {
          boxes: optionalNumber(payload.boxes),
          photos: [],
        });
      }
      case "confirm_shipped_out": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        const shipTransition = services.outbound.confirmShippedOut(outboundId, actor, {
          logisticsProvider: optionalString(payload.logisticsProvider),
          trackingNo: optionalString(payload.trackingNo),
        });
        const confirmRequest = services.outbound.requestOperationsConfirm(outboundId, actor);
        return {
          shipTransition,
          confirmRequest,
        };
      }
      case "confirm_outbound_done": {
        const outboundId = requireString(payload.outboundId || payload.id, "outboundId");
        return services.outbound.confirmDone(outboundId, actor);
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

async function getPurchaseWorkbenchRuntime(params = {}) {
  if (isClientMode()) {
    let payload;
    try {
      payload = await remoteRequest("/api/purchase/workbench", {
        method: "POST",
        body: params,
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      if (!statusCode || ![404, 405, 502].includes(statusCode)) throw error;
      payload = await remoteRequest("/api/purchase/workbench");
    }
    return normalizePurchaseWorkbenchPoNumbers(payload.workbench || {});
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

async function buildClientImageSearchMockResults(payload = {}) {
  if (payload.action !== "source_1688_image" || Array.isArray(payload.mockResults)) return null;
  const beginPage = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.beginPage) ?? 1)), 10));
  const importLimit = Math.max(1, Math.min(Math.floor(Number(optionalNumber(payload.importLimit) ?? 10)), 20));
  const pageSize = Math.max(1, Math.min(importLimit, 50));
  const parsedUpload = parseErpImageDataUrl(payload);
  const imgUrl = optionalString(payload.imgUrl || payload.imageUrl);
  const imageBuffer = parsedUpload?.buffer || (imgUrl ? await fetchImageBuffer(imgUrl) : null);
  if (!imageBuffer?.length) return null;
  const localResult = await run1688WebImageSearch({
    imageBuffer,
    beginPage,
    pageSize,
  });
  return {
    ...payload,
    imageDataUrl: undefined,
    imageData: undefined,
    mockResults: (localResult.products || []).map(toRemoteImageSearchMockResult),
    localImageSearch: {
      source: "1688_web_image_client",
      imageId: localResult.imageId,
      totalFound: localResult.products?.length || 0,
    },
  };
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
    specId: optionalString(sku.externalSpecId || sku.specId || sku.cargoSkuId || sku.externalSkuId),
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
  const credentials = getClientLocalAlphaShopCredentials(payload);
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

async function performClientPreview1688UrlSpecs(payload = {}) {
  try {
    const response = await remoteRequest("/api/purchase/action", {
      method: "POST",
      body: payload,
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
  });
  return {
    ...(refreshResponse.result || {}),
    bindFallback: "refresh_1688_product_detail",
  };
}

async function performPurchaseActionRuntime(payload = {}) {
  if (isClientMode()) {
    if (payload?.action === "preview_1688_url_specs") {
      return performClientPreview1688UrlSpecs(payload);
    }
    if (payload?.action === "bind_1688_candidate_spec") {
      return performClientBind1688CandidateSpec(payload);
    }
    let remotePayload = payload;
    if ((payload?.action === "generate_po" || payload?.action === "generate_purchase_order") && !optionalString(payload.poNo || payload.po_no)) {
      try {
        const current = await remoteRequest("/api/purchase/workbench", {
          method: "POST",
          body: { limit: 500, includeRequestDetails: false },
        });
        remotePayload = {
          ...remotePayload,
          poNo: getNextClientPurchaseOrderNo(current.workbench || {}),
        };
      } catch {}
    }
    try {
      remotePayload = await buildClientImageSearchMockResults(remotePayload) || remotePayload;
    } catch {}
    if (payload?.action === "refresh_1688_product_detail") {
      remotePayload = await buildClientProductDetailMockPayload(remotePayload) || remotePayload;
    }
    const response = await remoteRequest("/api/purchase/action", {
      method: "POST",
      body: remotePayload,
    });
    return normalizePurchaseResultPoNumbers(response.result);
  }
  const actor = getCurrentSessionActor(payload?.actor || {});
  return performPurchaseAction(payload || {}, actor);
}

async function getWarehouseWorkbenchRuntime(params = {}) {
  if (isClientMode()) {
    const payload = await remoteRequest("/api/warehouse/workbench");
    return payload.workbench || {};
  }
  return getWarehouseWorkbench(params);
}

async function performWarehouseActionRuntime(payload = {}) {
  if (isClientMode()) {
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
  if (isClientMode()) {
    const payload = await remoteRequest("/api/qc/workbench");
    return payload.workbench || {};
  }
  return getQcWorkbench(params);
}

async function performQcActionRuntime(payload = {}) {
  if (isClientMode()) {
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
  if (isClientMode()) {
    const payload = await remoteRequest("/api/outbound/workbench");
    return payload.workbench || {};
  }
  return getOutboundWorkbench(params);
}

async function performOutboundActionRuntime(payload = {}) {
  if (isClientMode()) {
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
  if (isClientMode()) {
    const payload = await remoteRequest("/api/work-items/list", {
      method: "POST",
      body: params,
    });
    return payload.items || [];
  }
  return listWorkItems(params);
}

async function getWorkItemStatsRuntime(params = {}) {
  if (isClientMode()) {
    const payload = await remoteRequest("/api/work-items/stats", {
      method: "POST",
      body: params,
    });
    return payload.stats || {};
  }
  return getWorkItemStats(params);
}

async function generateWorkItemsRuntime(payload = {}) {
  if (isClientMode()) {
    const response = await remoteRequest("/api/work-items/generate", {
      method: "POST",
      body: payload,
    });
    return response.result;
  }
  return generateWorkItems(payload);
}

async function updateWorkItemStatusRuntime(payload = {}) {
  if (isClientMode()) {
    const response = await remoteRequest("/api/work-items/update-status", {
      method: "POST",
      body: payload,
    });
    return response.item;
  }
  return updateWorkItemStatus(payload);
}

async function listUsersRuntime(params = {}) {
  if (isClientMode()) {
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
  if (isClientMode()) {
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
  if (isClientMode()) {
    const payload = await remoteRequest("/api/master-data/workbench", {
      method: "POST",
      body: params,
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
  const workbench = await getMasterDataWorkbenchRuntime(params);
  return workbench.accounts || [];
}

async function upsertAccountRuntime(payload = {}, actor = {}) {
  if (isClientMode()) {
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
  if (isClientMode()) {
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
  const workbench = await getMasterDataWorkbenchRuntime(params);
  return workbench.suppliers || [];
}

async function createSupplierRuntime(payload = {}, actor = {}) {
  if (isClientMode()) {
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

async function listSkusRuntime(params = {}) {
  const workbench = await getMasterDataWorkbenchRuntime(params);
  return workbench.skus || [];
}

async function createSkuRuntime(payload = {}, actor = {}) {
  if (isClientMode()) {
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

async function deleteSkuRuntime(payload = {}, actor = {}) {
  if (isClientMode()) {
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
  if (isClientMode()) {
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
    createSku,
    deleteSku,
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
  createFirstAdmin({ name, accessCode });
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
    return await performPurchaseAction({
      action: "import_1688_orders",
      pageSize: 50,
      autoGenerate: false,
      limit: 200,
    }, { role: "admin" });
  } catch {
    return null;
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
    createSku,
    deleteSku,
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

function registerErpIpcHandlers(ipcMain) {
  ipcMain.on("erp:events:subscribe", (event) => subscribeRendererEvents(event.sender));
  ipcMain.on("erp:events:unsubscribe", (event) => unsubscribeRendererEvents(event.sender));
  ipcMain.handle("erp:get-status", () => getErpStatus());
  ipcMain.handle("erp:run-migrations", () => {
    assertHostMode("Migration");
    return rerunMigrations();
  });
  ipcMain.handle("erp:get-enums", () => enums);
  ipcMain.handle("erp:auth:get-status", () => getAuthStatus());
  ipcMain.handle("erp:auth:get-current-user", () => (
    isClientMode() ? (getRuntimeStatus().currentUser || null) : erpState.currentUser
  ));
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
  ipcMain.handle("erp:account:list", (_event, params) => listAccountsRuntime(params || {}));
  ipcMain.handle("erp:account:upsert", (_event, payload) => upsertAccountRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:account:delete", (_event, payload) => deleteAccountRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:user:list", (_event, params) => {
    if (!isClientMode()) assertHostMode("用户管理");
    return listUsersRuntime(params || {});
  });
  ipcMain.handle("erp:user:upsert", (_event, payload) => {
    if (!isClientMode()) assertHostMode("用户管理");
    return upsertUserRuntime(payload || {}, erpState.currentUser || {});
  });
  ipcMain.handle("erp:permission:get-profile", () => {
    if (!isClientMode()) assertHostMode("权限档案");
    if (isClientMode()) return remoteRequest("/api/permissions/profile");
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
  ipcMain.handle("erp:supplier:list", (_event, params) => listSuppliersRuntime(params || {}));
  ipcMain.handle("erp:supplier:create", (_event, payload) => createSupplierRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:sku:list", (_event, params) => listSkusRuntime(params || {}));
  ipcMain.handle("erp:sku:create", (_event, payload) => createSkuRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:sku:delete", (_event, payload) => deleteSkuRuntime(payload || {}, erpState.currentUser || {}));
  ipcMain.handle("erp:purchase:workbench", (_event, params) => getPurchaseWorkbenchRuntime(params || {}));
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
