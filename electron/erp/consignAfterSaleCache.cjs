// 送仓售后历史本地缓存 + 增量同步引擎（client 模式专用）。
//
// 跟 purchaseReturnCache 同构（双表：单头 + 明细，两端独立 sync_meta），只是字段
// 维度不同：单头主键 as_id（聚水潭售后单号），明细主键 asi_id。
//
// 关键设计：
//   - company 分区；单飞锁（head / item 独立 key 可并行）。
//   - cursor 回退 1s 防边界漏。
//   - 软删 includeDeleted + 硬删 ids 对账两路。
//   - cache.db 打不开 / 端点 404 静默降级。

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getErpDataDir, queryAll, queryOne, execute, execSql, withTransaction } = require("../db/connection.cjs");
const clientRuntime = require("./clientRuntime.cjs");

const FULL_PAGE_HEAD = 1000;
const FULL_PAGE_ITEM = 2000;
const INCR_PAGE = 2000;

let cacheDb = null;
let userDataDir = null;
const syncLocks = new Map();

function configureConsignAfterSaleCache(options = {}) {
  userDataDir = options.userDataDir || userDataDir || null;
}

function nowIso() {return new Date().toISOString();}

function optionalString(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "";
}

function getCurrentCompanyId() {
  try {
    return optionalString(clientRuntime.getRuntimeStatus()?.currentUser?.companyId) || null;
  } catch {
    return null;
  }
}

function shiftBack1s(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t - 1000).toISOString();
}

function getCacheDbPath() {
  return path.join(getErpDataDir({ userDataDir }), "cache.db");
}

async function openCacheDb() {
  if (cacheDb) return cacheDb;
  const dbPath = getCacheDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  await execSql(db, `
    CREATE TABLE IF NOT EXISTS consign_after_sale_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      as_id INTEGER NOT NULL,
      status_internal TEXT,
      as_date TEXT,
      shop_name TEXT,
      status TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_cas_cache_date ON consign_after_sale_cache(company_id, as_date);
    CREATE INDEX IF NOT EXISTS idx_cas_cache_updated ON consign_after_sale_cache(company_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_cas_cache_shop ON consign_after_sale_cache(company_id, shop_name);
    CREATE INDEX IF NOT EXISTS idx_cas_cache_status ON consign_after_sale_cache(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_cas_cache_as_id ON consign_after_sale_cache(company_id, as_id);

    CREATE TABLE IF NOT EXISTS consign_after_sale_item_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      as_id INTEGER NOT NULL,
      asi_id INTEGER NOT NULL,
      sku_id TEXT,
      status_internal TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_cas_item_cache_as ON consign_after_sale_item_cache(company_id, as_id);
    CREATE INDEX IF NOT EXISTS idx_cas_item_cache_updated ON consign_after_sale_item_cache(company_id, updated_at);

    CREATE TABLE IF NOT EXISTS consign_after_sale_sync_meta (
      company_id TEXT NOT NULL,
      source TEXT NOT NULL,            -- 'head' | 'item'
      cursor TEXT,
      last_full_at TEXT,
      last_sync_at TEXT,
      last_reconcile_at TEXT,
      PRIMARY KEY (company_id, source)
    );
  `);
  cacheDb = db;
  return db;
}

function closeCacheDb() {
  if (cacheDb) {
    try {cacheDb.close();} catch {/* ignore */}
    cacheDb = null;
  }
}

async function getMeta(companyId, source) {
  const db = openCacheDb();
  return (await queryOne(db, "SELECT * FROM consign_after_sale_sync_meta WHERE company_id = ? AND source = ?", [companyId, source])) || null;
}

async function setMeta(companyId, source, fields = {}) {
  const db = openCacheDb();
  await execute(db, `
    INSERT INTO consign_after_sale_sync_meta (company_id, source, cursor, last_full_at, last_sync_at, last_reconcile_at)
    VALUES (@company_id, @source, @cursor, @last_full_at, @last_sync_at, @last_reconcile_at)
    ON CONFLICT(company_id, source) DO UPDATE SET
      cursor = COALESCE(@cursor, cursor),
      last_full_at = COALESCE(@last_full_at, last_full_at),
      last_sync_at = COALESCE(@last_sync_at, last_sync_at),
      last_reconcile_at = COALESCE(@last_reconcile_at, last_reconcile_at)
  `, {
    company_id: companyId,
    source,
    cursor: fields.cursor != null ? fields.cursor : null,
    last_full_at: fields.lastFullAt != null ? fields.lastFullAt : null,
    last_sync_at: fields.lastSyncAt != null ? fields.lastSyncAt : null,
    last_reconcile_at: fields.lastReconcileAt != null ? fields.lastReconcileAt : null
  });
}

async function isCachePopulated(companyId) {
  if (!companyId) return false;
  try {
    const db = openCacheDb();
    const row = await queryOne(db, "SELECT 1 FROM consign_after_sale_cache WHERE company_id = ? LIMIT 1", [companyId]);
    return Boolean(row);
  } catch {
    return false;
  }
}

function buildHeadConditions(params, args) {
  const conditions = ["company_id = @company_id", "status_internal != 'deleted'"];
  const shopName = optionalString(params.shopName || params.shop_name);
  if (shopName) {
    conditions.push("shop_name = @shop_name");
    args.shop_name = shopName;
  }
  const statusFilter = optionalString(params.status);
  if (statusFilter) {
    conditions.push("status = @status_filter");
    args.status_filter = statusFilter;
  }
  const dateFrom = optionalString(params.dateFrom || params.date_from);
  if (dateFrom) {
    conditions.push("as_date >= @date_from");
    args.date_from = dateFrom;
  }
  const dateTo = optionalString(params.dateTo || params.date_to);
  if (dateTo) {
    conditions.push("as_date <= @date_to");
    args.date_to = dateTo;
  }
  const search = optionalString(params.search || params.q);
  if (search) {
    conditions.push("payload_json LIKE @search");
    args.search = `%${search}%`;
  }
  return conditions;
}

async function getCachedConsignAfterSales(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {db = openCacheDb();} catch {return null;}
  if (!isCachePopulated(companyId)) return null;
  const args = { company_id: companyId };
  const conditions = buildHeadConditions(params, args);
  const limit = Math.max(1, Math.min(Number(params.limit) || 100000, 500000));
  const offset = Math.max(0, Number(params.offset) || 0);
  const rows = await queryAll(db, `
    SELECT payload_json FROM consign_after_sale_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY as_date DESC, as_id DESC
    LIMIT @limit OFFSET @offset
  `, { ...args, limit, offset });
  return rows.map((row) => JSON.parse(row.payload_json));
}

async function getCachedConsignAfterSalesCount(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {db = openCacheDb();} catch {return null;}
  if (!isCachePopulated(companyId)) return null;
  const args = { company_id: companyId };
  const conditions = buildHeadConditions(params, args);
  const row = await queryOne(db, `SELECT COUNT(*) AS c FROM consign_after_sale_cache WHERE ${conditions.join(" AND ")}`, [args]);
  return row ? row.c : 0;
}

async function getCachedConsignAfterSaleItems(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {db = openCacheDb();} catch {return null;}
  const asId = params.asId != null ? Number(params.asId) : null;
  const asIdsRaw = Array.isArray(params.asIds) ? params.asIds.map(Number).filter(Number.isFinite) : null;
  const conditions = ["company_id = @company_id", "status_internal != 'deleted'"];
  const args = { company_id: companyId };
  if (Number.isFinite(asId)) {
    conditions.push("as_id = @as_id");
    args.as_id = asId;
  } else if (asIdsRaw && asIdsRaw.length) {
    const placeholders = asIdsRaw.map((_, idx) => `@as_${idx}`);
    asIdsRaw.forEach((v, idx) => {args[`as_${idx}`] = v;});
    conditions.push(`as_id IN (${placeholders.join(", ")})`);
  }
  const rows = await queryAll(db, `
    SELECT payload_json FROM consign_after_sale_item_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY as_id DESC, asi_id ASC
  `, [args]);
  return rows.map((row) => JSON.parse(row.payload_json));
}

async function upsertHeads(companyId, rows) {
  if (!rows.length) return;
  const db = openCacheDb();
  const now = nowIso();
























  await withTransaction(db, async (txDb) => {const items =














































    rows;for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO consign_after_sale_cache (company_id, id, as_id, status_internal, as_date, shop_name, status, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @as_id, @status_internal, @as_date, @shop_name, @status, @updated_at, @payload, @cached_at)
    ON CONFLICT(company_id, id) DO UPDATE SET
      as_id = @as_id, status_internal = @status_internal, as_date = @as_date,
      shop_name = @shop_name, status = @status, updated_at = @updated_at,
      payload_json = @payload, cached_at = @cached_at
  `, { company_id: companyId, id: String(row.id), as_id: Number(row.asId) || 0, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, as_date: row.asDate != null ? String(row.asDate) : null, shop_name: row.shopName != null ? String(row.shopName) : null, status: row.status != null ? String(row.status) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}});}async function deleteHeads(companyId, ids) {if (!ids.length) return;const db = openCacheDb();await withTransaction(db, async (txDb) => {const list = ids;for (const id of list) await execute(txDb, "DELETE FROM consign_after_sale_cache WHERE company_id = ? AND id = ?", [companyId, String(id)]);});}async function upsertItems(companyId, rows) {if (!rows.length) return;const db = openCacheDb();const now = nowIso();await withTransaction(db, async (txDb) => {const items = rows;for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO consign_after_sale_item_cache (company_id, id, as_id, asi_id, sku_id, status_internal, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @as_id, @asi_id, @sku_id, @status_internal, @updated_at, @payload, @cached_at)
    ON CONFLICT(company_id, id) DO UPDATE SET
      as_id = @as_id, asi_id = @asi_id, sku_id = @sku_id,
      status_internal = @status_internal, updated_at = @updated_at,
      payload_json = @payload, cached_at = @cached_at
  `, { company_id: companyId, id: String(row.id), as_id: Number(row.asId) || 0, asi_id: Number(row.asiId) || 0, sku_id: row.skuId != null ? String(row.skuId) : null, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}});}async function deleteItems(companyId, ids) {if (!ids.length) return;const db = openCacheDb();await withTransaction(db, async (txDb) => {const list = ids;for (const id of list) await execute(txDb, "DELETE FROM consign_after_sale_item_cache WHERE company_id = ? AND id = ?", [companyId, String(id)]);});}async function fetchHeadPage({ since, includeDeleted, limit, offset }) {const body = { limit, offset };if (since) body.since = since;if (includeDeleted) body.includeDeleted = true;const payload = await clientRuntime.remoteRequest("/api/master-data/consign-after-sales", { method: "POST", body, timeoutMs: 120000 });return payload && payload.rows || [];}async function fetchItemPage({ since, includeDeleted, limit, offset }) {
  const body = { limit, offset };
  if (since) body.since = since;
  if (includeDeleted) body.includeDeleted = true;
  const payload = await clientRuntime.remoteRequest("/api/master-data/consign-after-sale-items", {
    method: "POST", body, timeoutMs: 120000
  });
  return payload && payload.rows || [];
}

async function syncFullHead(companyId) {
  const all = [];
  let offset = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const rows = await fetchHeadPage({ limit: FULL_PAGE_HEAD, offset });
    all.push(...rows);
    if (rows.length < FULL_PAGE_HEAD) break;
    offset += FULL_PAGE_HEAD;
  }
  let cursor = "";
  for (const row of all) {
    if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
  }
  const db = openCacheDb();
  const now = nowIso();





















  await withTransaction(db, async (txDb) => {const items =
























    all;await execute(txDb, "DELETE FROM consign_after_sale_cache WHERE company_id = ?", [companyId]);for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO consign_after_sale_cache (company_id, id, as_id, status_internal, as_date, shop_name, status, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @as_id, @status_internal, @as_date, @shop_name, @status, @updated_at, @payload, @cached_at)
  `, { company_id: companyId, id: String(row.id), as_id: Number(row.asId) || 0, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, as_date: row.asDate != null ? String(row.asDate) : null, shop_name: row.shopName != null ? String(row.shopName) : null, status: row.status != null ? String(row.status) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}}












  );setMeta(companyId, "head", { cursor, lastFullAt: now, lastSyncAt: now });return { mode: "full", source: "head", total: all.length };}async function syncFullItem(companyId) {const all = [];let offset = 0;for (let guard = 0; guard < 1000; guard += 1) {const rows = await fetchItemPage({ limit: FULL_PAGE_ITEM, offset });all.push(...rows);if (rows.length < FULL_PAGE_ITEM) break;offset += FULL_PAGE_ITEM;}let cursor = "";for (const row of all) {if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;}const db = openCacheDb();const now = nowIso();await withTransaction(db, async (txDb) => {const items =
    all;await execute(txDb, "DELETE FROM consign_after_sale_item_cache WHERE company_id = ?", [companyId]);for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO consign_after_sale_item_cache (company_id, id, as_id, asi_id, sku_id, status_internal, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @as_id, @asi_id, @sku_id, @status_internal, @updated_at, @payload, @cached_at)
  `, { company_id: companyId, id: String(row.id), as_id: Number(row.asId) || 0, asi_id: Number(row.asiId) || 0, sku_id: row.skuId != null ? String(row.skuId) : null, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}});setMeta(companyId, "item", { cursor, lastFullAt: now, lastSyncAt: now });return { mode: "full", source: "item", total: all.length };}

async function syncIncrementalHead(companyId) {
  const meta = getMeta(companyId, "head");
  if (!meta || !meta.cursor) return syncFullHead(companyId);
  const since = shiftBack1s(meta.cursor);
  let offset = 0;
  let cursor = meta.cursor;
  let upserted = 0;
  let deleted = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const rows = await fetchHeadPage({ since, includeDeleted: true, limit: INCR_PAGE, offset });
    if (!rows.length) break;
    const toUpsert = rows.filter((row) => row.statusInternal !== "deleted");
    const toDelete = rows.filter((row) => row.statusInternal === "deleted").map((row) => row.id);
    upsertHeads(companyId, toUpsert);
    deleteHeads(companyId, toDelete);
    upserted += toUpsert.length;
    deleted += toDelete.length;
    for (const row of rows) {
      if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
    }
    if (rows.length < INCR_PAGE) break;
    offset += INCR_PAGE;
  }
  setMeta(companyId, "head", { cursor, lastSyncAt: nowIso() });
  return { mode: "incremental", source: "head", upserted, deleted };
}

async function syncIncrementalItem(companyId) {
  const meta = getMeta(companyId, "item");
  if (!meta || !meta.cursor) return syncFullItem(companyId);
  const since = shiftBack1s(meta.cursor);
  let offset = 0;
  let cursor = meta.cursor;
  let upserted = 0;
  let deleted = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const rows = await fetchItemPage({ since, includeDeleted: true, limit: INCR_PAGE, offset });
    if (!rows.length) break;
    const toUpsert = rows.filter((row) => row.statusInternal !== "deleted");
    const toDelete = rows.filter((row) => row.statusInternal === "deleted").map((row) => row.id);
    upsertItems(companyId, toUpsert);
    deleteItems(companyId, toDelete);
    upserted += toUpsert.length;
    deleted += toDelete.length;
    for (const row of rows) {
      if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
    }
    if (rows.length < INCR_PAGE) break;
    offset += INCR_PAGE;
  }
  setMeta(companyId, "item", { cursor, lastSyncAt: nowIso() });
  return { mode: "incremental", source: "item", upserted, deleted };
}

async function reconcileHeadDeletes(companyId) {
  let payload;
  try {
    payload = await clientRuntime.remoteRequest("/api/master-data/consign-after-sale-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true };
  const db = openCacheDb();
  const localIds = (await queryAll(db, "SELECT id FROM consign_after_sale_cache WHERE company_id = ?", [companyId])).map((r) => r.id);
  const stale = localIds.filter((id) => !serverIds.has(id));
  deleteHeads(companyId, stale);
  setMeta(companyId, "head", { lastReconcileAt: nowIso() });
  return { source: "head", reconciled: stale.length };
}

async function reconcileItemDeletes(companyId) {
  let payload;
  try {
    payload = await clientRuntime.remoteRequest("/api/master-data/consign-after-sale-item-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true };
  const db = openCacheDb();
  const localIds = (await queryAll(db, "SELECT id FROM consign_after_sale_item_cache WHERE company_id = ?", [companyId])).map((r) => r.id);
  const stale = localIds.filter((id) => !serverIds.has(id));
  deleteItems(companyId, stale);
  setMeta(companyId, "item", { lastReconcileAt: nowIso() });
  return { source: "item", reconciled: stale.length };
}

function withLock(companyId, key, fn) {
  const lockKey = `${companyId}:${key}`;
  if (syncLocks.has(lockKey)) return syncLocks.get(lockKey);
  const promise = Promise.resolve().then(fn).finally(() => syncLocks.delete(lockKey));
  syncLocks.set(lockKey, promise);
  return promise;
}

async function triggerSync(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { skipped: true, reason: "no-company" };
  const runtime = clientRuntime.getRuntimeStatus();
  if (runtime.mode !== "client" || !runtime.serverUrl) return { skipped: true, reason: "not-client" };
  const mode = options.mode === "full" ? "full" : "incremental";
  const headTask = withLock(companyId, "sync-head", async () =>
  mode === "full" ? syncFullHead(companyId) : syncIncrementalHead(companyId)
  );
  const itemTask = withLock(companyId, "sync-item", async () =>
  mode === "full" ? syncFullItem(companyId) : syncIncrementalItem(companyId)
  );
  const [head, item] = await Promise.all([headTask, itemTask]);
  return { head, item };
}

async function triggerReconcile(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { skipped: true, reason: "no-company" };
  const runtime = clientRuntime.getRuntimeStatus();
  if (runtime.mode !== "client" || !runtime.serverUrl) return { skipped: true, reason: "not-client" };
  const headTask = withLock(companyId, "reconcile-head", () => reconcileHeadDeletes(companyId));
  const itemTask = withLock(companyId, "reconcile-item", () => reconcileItemDeletes(companyId));
  const [head, item] = await Promise.all([headTask, itemTask]);
  return { head, item };
}

async function getCacheStatus(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { companyId: null, headCount: 0, itemCount: 0, populated: false };
  let headCount = 0;
  let itemCount = 0;
  try {
    const db = openCacheDb();
    headCount = (await queryOne(db, "SELECT COUNT(*) AS c FROM consign_after_sale_cache WHERE company_id = ? AND status_internal != 'deleted'", [companyId])).c;
    itemCount = (await queryOne(db, "SELECT COUNT(*) AS c FROM consign_after_sale_item_cache WHERE company_id = ? AND status_internal != 'deleted'", [companyId])).c;
  } catch {
    return { companyId, headCount: 0, itemCount: 0, populated: false };
  }
  const headMeta = getMeta(companyId, "head");
  const itemMeta = getMeta(companyId, "item");
  return {
    companyId,
    headCount,
    itemCount,
    populated: headCount > 0,
    head: {
      cursor: headMeta?.cursor || null,
      lastFullAt: headMeta?.last_full_at || null,
      lastSyncAt: headMeta?.last_sync_at || null,
      lastReconcileAt: headMeta?.last_reconcile_at || null,
      syncing: syncLocks.has(`${companyId}:sync-head`)
    },
    item: {
      cursor: itemMeta?.cursor || null,
      lastFullAt: itemMeta?.last_full_at || null,
      lastSyncAt: itemMeta?.last_sync_at || null,
      lastReconcileAt: itemMeta?.last_reconcile_at || null,
      syncing: syncLocks.has(`${companyId}:sync-item`)
    }
  };
}

module.exports = {
  configureConsignAfterSaleCache,
  closeCacheDb,
  getCachedConsignAfterSales,
  getCachedConsignAfterSalesCount,
  getCachedConsignAfterSaleItems,
  isCachePopulated,
  triggerSync,
  triggerReconcile,
  getCacheStatus
};