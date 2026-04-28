const crypto = require("crypto");
const fs = require("fs");
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
  remoteRequest,
  setClientMode,
  setHostMode,
} = require("./clientRuntime.cjs");

const erpState = {
  db: null,
  services: null,
  initResult: null,
  initError: null,
  currentUser: null,
  userDataDir: null,
};

const PURCHASE_UPDATE_CHANNEL = "erp:purchase:update";
const USER_UPDATE_CHANNEL = "erp:user:update";
const rendererEventSubscribers = new Set();
const BROADCAST_PURCHASE_ACTIONS = new Set([
  "create_pr",
  "create_purchase_request",
  "add_comment",
  "accept_pr",
  "mark_sourced",
  "quote_feedback",
  "add_sourcing_candidate",
  "generate_po",
  "submit_payment_approval",
  "approve_payment",
  "confirm_paid",
]);

const ACCESS_CODE_ITERATIONS = 120000;
const ACCESS_CODE_KEY_LENGTH = 32;
const ACCESS_CODE_DIGEST = "sha256";
const VALID_USER_ROLES = new Set(["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"]);
const VALID_USER_STATUSES = new Set(["active", "blocked"]);

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
  };
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
  return erpState;
}

function rerunMigrations() {
  const state = requireErp();
  const result = runMigrations({
    db: state.db,
  });
  state.initResult = result;
  state.initError = null;
  return getErpStatus();
}

function listAccounts(params = {}) {
  const { db } = requireErp();
  const rows = db.prepare(`
    SELECT *
    FROM erp_accounts
    ORDER BY updated_at DESC, created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toCamelRow);
}

function upsertAccount(payload = {}) {
  const { db } = requireErp();
  const now = nowIso();
  const row = {
    id: optionalString(payload.id) || createId("acct"),
    name: requireString(payload.name, "name"),
    phone: optionalString(payload.phone),
    status: optionalString(payload.status) || "offline",
    source: optionalString(payload.source) || "manual",
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_accounts (id, name, phone, status, source, created_at, updated_at)
    VALUES (@id, @name, @phone, @status, @source, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      status = excluded.status,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(row);

  return toCamelRow(db.prepare("SELECT * FROM erp_accounts WHERE id = ?").get(row.id));
}

function listUsers(params = {}) {
  const { db } = requireErp();
  const rows = db.prepare(`
    SELECT id, name, role, status,
           CASE WHEN access_code_hash IS NOT NULL AND access_code_hash != '' THEN 1 ELSE 0 END AS has_access_code,
           created_at, updated_at
    FROM erp_users
    ORDER BY updated_at DESC, created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toPublicUser);
}

function upsertUser(payload = {}) {
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
  const existing = db.prepare("SELECT id FROM erp_users WHERE id = ?").get(id);
  if (!existing && !accessCodeHash) {
    throw new Error("Access code is required for new users");
  }
  const row = {
    id,
    name: requireString(payload.name, "name"),
    role,
    status,
    access_code_hash: accessCodeHash,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_users (id, name, role, status, access_code_hash, created_at, updated_at)
    VALUES (@id, @name, @role, @status, @access_code_hash, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      status = excluded.status,
      access_code_hash = COALESCE(excluded.access_code_hash, erp_users.access_code_hash),
      updated_at = excluded.updated_at
  `).run(row);

  return toPublicUser(db.prepare(`
    SELECT id, name, role, status,
           CASE WHEN access_code_hash IS NOT NULL AND access_code_hash != '' THEN 1 ELSE 0 END AS has_access_code,
           created_at, updated_at
    FROM erp_users
    WHERE id = ?
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
    SELECT id, name, role, status
    FROM erp_users
    WHERE id = ?
    LIMIT 1
  `).get(id);
  if (!row || row.status !== "active") return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
  };
}

function verifyLanLogin(payload = {}) {
  const { db } = requireErp();
  const login = optionalString(payload.login);
  const accessCode = optionalString(payload.accessCode);
  if (!login || !accessCode) {
    return null;
  }

  const row = db.prepare(`
    SELECT id, name, role, status, access_code_hash
    FROM erp_users
    WHERE id = @login OR name = @login
    LIMIT 1
  `).get({ login });

  if (!row || row.status !== "active" || !row.access_code_hash) {
    return null;
  }
  if (!verifyAccessCode(accessCode, row.access_code_hash)) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
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
  const user = upsertUser({
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
  const rows = db.prepare(`
    SELECT *
    FROM erp_suppliers
    ORDER BY updated_at DESC, created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    limit: normalizeLimit(params.limit),
    offset: normalizeOffset(params.offset),
  });
  return rows.map(toSupplier);
}

function createSupplier(payload = {}) {
  const { db } = requireErp();
  const now = nowIso();
  const row = {
    id: optionalString(payload.id) || createId("supplier"),
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
      id, name, contact_name, phone, wechat, address, categories_json,
      status, created_at, updated_at
    )
    VALUES (
      @id, @name, @contact_name, @phone, @wechat, @address,
      @categories_json, @status, @created_at, @updated_at
    )
  `).run(row);

  return toSupplier(db.prepare("SELECT * FROM erp_suppliers WHERE id = ?").get(row.id));
}

function listSkus(params = {}) {
  const { db } = requireErp();
  const accountId = optionalString(params.accountId);
  const rows = accountId
    ? db.prepare(`
      SELECT *
      FROM erp_skus
      WHERE account_id = @account_id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({
      account_id: accountId,
      limit: normalizeLimit(params.limit),
      offset: normalizeOffset(params.offset),
    })
    : db.prepare(`
      SELECT *
      FROM erp_skus
      ORDER BY updated_at DESC, created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({
      limit: normalizeLimit(params.limit),
      offset: normalizeOffset(params.offset),
    });

  return rows.map(toCamelRow);
}

function createSku(payload = {}) {
  const { db } = requireErp();
  const now = nowIso();
  const row = {
    id: optionalString(payload.id) || createId("sku"),
    account_id: requireString(payload.accountId, "accountId"),
    internal_sku_code: requireString(payload.internalSkuCode, "internalSkuCode"),
    temu_sku_id: optionalString(payload.temuSkuId),
    temu_product_id: optionalString(payload.temuProductId),
    temu_skc_id: optionalString(payload.temuSkcId),
    product_name: requireString(payload.productName, "productName"),
    category: optionalString(payload.category),
    image_url: optionalString(payload.imageUrl),
    supplier_id: optionalString(payload.supplierId),
    status: optionalString(payload.status) || "active",
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_skus (
      id, account_id, internal_sku_code, temu_sku_id, temu_product_id,
      temu_skc_id, product_name, category, image_url, supplier_id,
      status, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @internal_sku_code, @temu_sku_id, @temu_product_id,
      @temu_skc_id, @product_name, @category, @image_url, @supplier_id,
      @status, @created_at, @updated_at
    )
  `).run(row);

  return toCamelRow(db.prepare("SELECT * FROM erp_skus WHERE id = ?").get(row.id));
}

function toPurchaseRequest(row) {
  const next = toCamelRow(row);
  next.evidence = parseJsonArray(row.evidence_json);
  delete next.evidenceJson;
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
  const accountId = optionalString(params.accountId);
  const limit = normalizeLimit(params.limit, 50);
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
      requester.name AS requested_by_name,
      COUNT(candidate.id) AS candidate_count,
      SUM(CASE WHEN candidate.status = 'selected' THEN 1 ELSE 0 END) AS selected_candidate_count
    FROM erp_purchase_requests pr
    LEFT JOIN erp_accounts acct ON acct.id = pr.account_id
    LEFT JOIN erp_skus sku ON sku.id = pr.sku_id
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
  const candidatesByPr = new Map();
  const commentsByPr = new Map();
  const eventsByPr = new Map();
  const unreadByPr = new Map();

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
  const unreadStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT author_id AS source_user_id, created_at
      FROM erp_purchase_request_comments
      WHERE pr_id = @pr_id
      UNION ALL
      SELECT actor_id AS source_user_id, created_at
      FROM erp_purchase_request_events
      WHERE pr_id = @pr_id
    ) item
    LEFT JOIN erp_purchase_request_reads read_state
      ON read_state.pr_id = @pr_id AND read_state.user_id = @user_id
    WHERE item.created_at > COALESCE(read_state.last_read_at, '')
      AND COALESCE(item.source_user_id, '') != @user_id
  `);

  for (const pr of purchaseRequests) {
    const candidates = candidateStmt.all(pr.id).map((row) => {
      const next = toCamelRow(row);
      next.supplierName = next.supplierName || next.linkedSupplierName || "";
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

    candidatesByPr.set(pr.id, candidates);
    commentsByPr.set(pr.id, comments);
    eventsByPr.set(pr.id, events);
    unreadByPr.set(pr.id, currentUserId
      ? Number(unreadStmt.get({ pr_id: pr.id, user_id: currentUserId })?.count || 0)
      : 0);
    pr.candidates = candidates;
    pr.comments = comments;
    pr.events = events;
    pr.timeline = timeline;
    pr.unreadCount = unreadByPr.get(pr.id);
  }

  const purchaseOrders = db.prepare(`
    SELECT
      po.*,
      acct.name AS account_name,
      supplier.name AS supplier_name,
      pr.status AS pr_status,
      GROUP_CONCAT(DISTINCT sku.internal_sku_code || ' ' || sku.product_name) AS sku_summary,
      COUNT(DISTINCT line.id) AS line_count,
      COALESCE(SUM(line.qty), 0) AS total_qty,
      COALESCE(SUM(line.received_qty), 0) AS received_qty
    FROM erp_purchase_orders po
    LEFT JOIN erp_accounts acct ON acct.id = po.account_id
    LEFT JOIN erp_suppliers supplier ON supplier.id = po.supplier_id
    LEFT JOIN erp_purchase_requests pr ON pr.id = po.pr_id
    LEFT JOIN erp_purchase_order_lines line ON line.po_id = po.id
    LEFT JOIN erp_skus sku ON sku.id = line.sku_id
    ${poWhereAccount}
    GROUP BY po.id
    ORDER BY
      CASE po.status
        WHEN 'pending_finance_approval' THEN 0
        WHEN 'approved_to_pay' THEN 1
        WHEN 'paid' THEN 2
        WHEN 'supplier_processing' THEN 3
        WHEN 'shipped' THEN 4
        WHEN 'arrived' THEN 5
        WHEN 'draft' THEN 6
        WHEN 'inbounded' THEN 7
        WHEN 'closed' THEN 8
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
    unreadPurchaseRequestCount: purchaseRequests.reduce((sum, item) => (
      sum + Number(item.unreadCount || 0)
    ), 0),
  };

  const skuOptions = db.prepare(`
    SELECT id, internal_sku_code, product_name, account_id
    FROM erp_skus
    ${accountId ? "WHERE account_id = @account_id" : ""}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 500
  `).all(accountId ? baseParams : {}).map(toCamelRow);

  const supplierOptions = db.prepare(`
    SELECT id, name
    FROM erp_suppliers
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 500
  `).all().map(toCamelRow);

  return {
    generatedAt: nowIso(),
    summary,
    purchaseRequests,
    purchaseOrders,
    paymentApprovals,
    paymentQueue,
    skuOptions,
    supplierOptions,
  };
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
  const row = {
    id: optionalString(payload.paymentApprovalId) || createId("pay"),
    account_id: po.account_id,
    po_id: po.id,
    amount,
    status: "pending",
    requested_by: actor.id || null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO erp_payment_approvals (
      id, account_id, po_id, amount, status, requested_by, created_at, updated_at
    )
    VALUES (
      @id, @account_id, @po_id, @amount, @status, @requested_by, @created_at, @updated_at
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

  const accountId = optionalString(payload.accountId) || sku.account_id;
  const now = nowIso();
  const row = {
    id: optionalString(payload.id) || createId("pr"),
    account_id: accountId,
    sku_id: skuId,
    requested_by: actor.id || null,
    reason: requireString(payload.reason, "reason"),
    requested_qty: Number(requireString(payload.requestedQty, "requestedQty")),
    target_unit_cost: optionalNumber(payload.targetUnitCost),
    expected_arrival_date: optionalString(payload.expectedArrivalDate),
    evidence_json: JSON.stringify(parseEvidenceList(payload)),
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

function getCandidateForPo(db, prId, candidateId) {
  if (candidateId) {
    const row = db.prepare("SELECT * FROM erp_sourcing_candidates WHERE id = ?").get(candidateId);
    if (!row) throw new Error(`Sourcing candidate not found: ${candidateId}`);
    if (row.pr_id !== prId) throw new Error("Sourcing candidate does not belong to this request");
    return row;
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
  if (!row) throw new Error("请先添加报价反馈，再生成采购单");
  return row;
}

function buildPurchaseOrderNo() {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `PO-${stamp}-${createId("").replace(/^_?/, "").slice(-8).toUpperCase()}`;
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
  const candidate = getCandidateForPo(db, prId, optionalString(payload.candidateId));

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
    po_no: optionalString(payload.poNo) || buildPurchaseOrderNo(),
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
    purchaseOrder: toCamelRow(afterPo),
  };
}

function performPurchaseAction(payload = {}, actorInput = {}) {
  const { db, services } = requireErp();
  const action = requireString(payload.action, "action");
  const actor = normalizeActor(actorInput);

  const run = db.transaction(() => {
    switch (action) {
      case "create_pr":
      case "create_purchase_request": {
        return createPurchaseRequestAction({ db, services, payload, actor });
      }
      case "add_comment": {
        const pr = getPurchaseRequest(db, requireString(payload.prId || payload.id, "prId"));
        const comment = addPurchaseRequestComment(db, pr, actor, payload.body || payload.comment);
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
        writePurchaseRequestEvent(db, getPurchaseRequest(db, prId), actor, "mark_sourced", "采购标记已寻源");
        markPurchaseRequestRead(db, prId, actor);
        return transition;
      }
      case "quote_feedback":
      case "add_sourcing_candidate": {
        return addSourcingCandidateAction({ db, services, payload, actor });
      }
      case "generate_po": {
        return generatePurchaseOrderAction({ db, services, payload, actor });
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
      default:
        throw new Error(`Unsupported purchase action: ${action}`);
    }
  });

  const result = run();
  broadcastPurchaseUpdate(action, payload, actor, result);
  return {
    action,
    result,
    workbench: getPurchaseWorkbench({ limit: payload.limit, user: actor }),
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
    const payload = await remoteRequest("/api/purchase/workbench");
    return payload.workbench || {};
  }
  return getPurchaseWorkbench(params);
}

async function performPurchaseActionRuntime(payload = {}) {
  if (isClientMode()) {
    const response = await remoteRequest("/api/purchase/action", {
      method: "POST",
      body: payload,
    });
    return response.result;
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
  return listUsers(params);
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
    verifyLogin: verifyLanLogin,
    validateSessionUser: validateLanSessionUser,
    listUsers,
    upsertUser: upsertUserAndBroadcast,
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

  createFirstAdmin({ name, accessCode });
  return {
    created: true,
    name,
  };
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
    verifyLogin: verifyLanLogin,
    validateSessionUser: validateLanSessionUser,
    listUsers,
    upsertUser: upsertUserAndBroadcast,
  });

  return {
    initResult,
    bootstrap,
    lanStatus,
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
  ipcMain.handle("erp:account:list", (_event, params) => {
    assertHostMode("账号管理");
    return listAccounts(params || {});
  });
  ipcMain.handle("erp:account:upsert", (_event, payload) => {
    assertHostMode("账号管理");
    assertRoleIfLoggedIn(["admin", "manager"]);
    return upsertAccount(payload || {});
  });
  ipcMain.handle("erp:user:list", (_event, params) => {
    if (!isClientMode()) assertHostMode("用户管理");
    return listUsersRuntime(params || {});
  });
  ipcMain.handle("erp:user:upsert", (_event, payload) => {
    if (!isClientMode()) assertHostMode("用户管理");
    return upsertUserRuntime(payload || {}, erpState.currentUser || {});
  });
  ipcMain.handle("erp:supplier:list", (_event, params) => {
    assertHostMode("供应商管理");
    return listSuppliers(params || {});
  });
  ipcMain.handle("erp:supplier:create", (_event, payload) => {
    assertHostMode("供应商管理");
    assertRoleIfLoggedIn(["admin", "manager", "buyer"]);
    return createSupplier(payload || {});
  });
  ipcMain.handle("erp:sku:list", (_event, params) => {
    assertHostMode("SKU 管理");
    return listSkus(params || {});
  });
  ipcMain.handle("erp:sku:create", (_event, payload) => {
    assertHostMode("SKU 管理");
    assertRoleIfLoggedIn(["admin", "manager", "operations"]);
    return createSku(payload || {});
  });
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
};
