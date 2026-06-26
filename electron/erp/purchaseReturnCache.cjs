// 采购退货历史本地缓存 + 增量同步引擎（client 模式专用）。
//
// 背景：采购退货数据来自聚水潭历史导入（1062 单 + 1264 明细），写在服务器
// 生产 erp.sqlite。聚水潭已停用、目前为死历史数据，本模块仍按 mapping/sku 一致
// 的同步框架建本地缓存：页面直读缓存秒显示，后台增量从服务器（PR1 的
// /api/master-data/purchase-returns + purchase-return-ids 等接口）拉变化 merge。
//
// 关键设计（与 mappingCache / skuCache 一致）：
//   - company 分区：缓存主键 (company_id, id)，换公司不串数据。
//   - 单飞锁：同 company 同 key 串行化。head 与 item 同步用不同 key，可并行。
//   - 增量游标：head/item 各一行 sync_meta（用 source 字段区分），cursor 回退
//     1 秒重叠拉取防边界漏。
//   - 删除检测两路：软删（status_internal='deleted'，includeDeleted 拿得到）
//     + 硬删（增量拉不到→靠 ids 端点对账兜底）。
//   - 降级：cache.db 打不开 / 服务器无端点（404）时静默回退，不阻塞 UI。

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

function configurePurchaseReturnCache(options = {}) {
  userDataDir = options.userDataDir || userDataDir || null;
}

function nowIso() {
  return new Date().toISOString();
}

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

function openCacheDb() {
  if (cacheDb) return cacheDb;
  const dbPath = getCacheDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_return_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      io_id INTEGER NOT NULL,
      status_internal TEXT,
      io_date TEXT,
      supplier_name TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pr_cache_io_date ON purchase_return_cache(company_id, io_date);
    CREATE INDEX IF NOT EXISTS idx_pr_cache_updated ON purchase_return_cache(company_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_pr_cache_supplier ON purchase_return_cache(company_id, supplier_name);
    CREATE INDEX IF NOT EXISTS idx_pr_cache_io_id ON purchase_return_cache(company_id, io_id);

    CREATE TABLE IF NOT EXISTS purchase_return_item_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      io_id INTEGER NOT NULL,
      ioi_id INTEGER NOT NULL,
      sku_id TEXT,
      status_internal TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pr_item_cache_io ON purchase_return_item_cache(company_id, io_id);
    CREATE INDEX IF NOT EXISTS idx_pr_item_cache_updated ON purchase_return_item_cache(company_id, updated_at);

    CREATE TABLE IF NOT EXISTS purchase_return_sync_meta (
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

function getMeta(companyId, source) {
  const db = openCacheDb();
  return db.prepare("SELECT * FROM purchase_return_sync_meta WHERE company_id = ? AND source = ?").get(companyId, source) || null;
}

function setMeta(companyId, source, fields = {}) {
  const db = openCacheDb();
  db.prepare(`
    INSERT INTO purchase_return_sync_meta (company_id, source, cursor, last_full_at, last_sync_at, last_reconcile_at)
    VALUES (@company_id, @source, @cursor, @last_full_at, @last_sync_at, @last_reconcile_at)
    ON CONFLICT(company_id, source) DO UPDATE SET
      cursor = COALESCE(@cursor, cursor),
      last_full_at = COALESCE(@last_full_at, last_full_at),
      last_sync_at = COALESCE(@last_sync_at, last_sync_at),
      last_reconcile_at = COALESCE(@last_reconcile_at, last_reconcile_at)
  `).run({
    company_id: companyId,
    source,
    cursor: fields.cursor != null ? fields.cursor : null,
    last_full_at: fields.lastFullAt != null ? fields.lastFullAt : null,
    last_sync_at: fields.lastSyncAt != null ? fields.lastSyncAt : null,
    last_reconcile_at: fields.lastReconcileAt != null ? fields.lastReconcileAt : null
  });
}

function isCachePopulated(companyId) {
  if (!companyId) return false;
  try {
    const db = openCacheDb();
    const row = db.prepare("SELECT 1 FROM purchase_return_cache WHERE company_id = ? LIMIT 1").get(companyId);
    return Boolean(row);
  } catch {
    return false;
  }
}

function buildHeadConditions(params, args) {
  const conditions = ["company_id = @company_id", "status_internal != 'deleted'"];
  const supplier = optionalString(params.supplier || params.supplier_name);
  if (supplier) {
    conditions.push("supplier_name = @supplier");
    args.supplier = supplier;
  }
  const dateFrom = optionalString(params.dateFrom || params.date_from);
  if (dateFrom) {
    conditions.push("io_date >= @date_from");
    args.date_from = dateFrom;
  }
  const dateTo = optionalString(params.dateTo || params.date_to);
  if (dateTo) {
    conditions.push("io_date <= @date_to");
    args.date_to = dateTo;
  }
  const search = optionalString(params.search || params.q);
  if (search) {
    conditions.push("(payload_json LIKE @search OR EXISTS (SELECT 1 FROM purchase_return_item_cache pic WHERE pic.company_id = purchase_return_cache.company_id AND pic.io_id = purchase_return_cache.io_id AND pic.status_internal != 'deleted' AND pic.payload_json LIKE @search))");
    args.search = `%${search}%`;
  }
  return conditions;
}

function getCachedPurchaseReturns(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {db = openCacheDb();} catch {return null;}
  if (!isCachePopulated(companyId)) return null;

  const args = { company_id: companyId };
  const conditions = buildHeadConditions(params, args);
  const limit = Math.max(1, Math.min(Number(params.limit) || 100000, 500000));
  const offset = Math.max(0, Number(params.offset) || 0);
  const rows = db.prepare(`
    SELECT payload_json FROM purchase_return_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY io_date DESC, io_id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...args, limit, offset });
  return rows.map((row) => JSON.parse(row.payload_json));
}

function getCachedPurchaseReturnsCount(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {db = openCacheDb();} catch {return null;}
  if (!isCachePopulated(companyId)) return null;
  const args = { company_id: companyId };
  const conditions = buildHeadConditions(params, args);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM purchase_return_cache WHERE ${conditions.join(" AND ")}`).get(args);
  return row ? row.c : 0;
}

function getCachedPurchaseReturnItems(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {db = openCacheDb();} catch {return null;}
  const ioId = params.ioId != null ? Number(params.ioId) : null;
  const ioIdsRaw = Array.isArray(params.ioIds) ? params.ioIds.map(Number).filter(Number.isFinite) : null;
  const conditions = ["company_id = @company_id", "status_internal != 'deleted'"];
  const args = { company_id: companyId };
  if (Number.isFinite(ioId)) {
    conditions.push("io_id = @io_id");
    args.io_id = ioId;
  } else if (ioIdsRaw && ioIdsRaw.length) {
    const placeholders = ioIdsRaw.map((_, idx) => `@io_${idx}`);
    ioIdsRaw.forEach((v, idx) => {args[`io_${idx}`] = v;});
    conditions.push(`io_id IN (${placeholders.join(", ")})`);
  }
  const rows = db.prepare(`
    SELECT payload_json FROM purchase_return_item_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY io_id DESC, ioi_id ASC
  `).all(args);
  return rows.map((row) => JSON.parse(row.payload_json));
}

async function upsertHeads(companyId, rows) {
  if (!rows.length) return;
  const db = openCacheDb();
  const now = nowIso();























  await withTransaction(db, async (txDb) => {const items =














































    rows;for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO purchase_return_cache (company_id, id, io_id, status_internal, io_date, supplier_name, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @io_id, @status_internal, @io_date, @supplier_name, @updated_at, @payload, @cached_at)
    ON CONFLICT(company_id, id) DO UPDATE SET
      io_id = @io_id, status_internal = @status_internal, io_date = @io_date,
      supplier_name = @supplier_name, updated_at = @updated_at,
      payload_json = @payload, cached_at = @cached_at
  `, { company_id: companyId, id: String(row.id), io_id: Number(row.ioId) || 0, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, io_date: row.ioDate != null ? String(row.ioDate) : null, supplier_name: row.supplierName != null ? String(row.supplierName) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}});}async function deleteHeads(companyId, ids) {if (!ids.length) return;const db = openCacheDb();await withTransaction(db, async (txDb) => {const list = ids;for (const id of list) await execute(txDb, "DELETE FROM purchase_return_cache WHERE company_id = ? AND id = ?", [companyId, String(id)]);});}async function upsertItems(companyId, rows) {if (!rows.length) return;const db = openCacheDb();const now = nowIso();await withTransaction(db, async (txDb) => {const items = rows;for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO purchase_return_item_cache (company_id, id, io_id, ioi_id, sku_id, status_internal, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @io_id, @ioi_id, @sku_id, @status_internal, @updated_at, @payload, @cached_at)
    ON CONFLICT(company_id, id) DO UPDATE SET
      io_id = @io_id, ioi_id = @ioi_id, sku_id = @sku_id,
      status_internal = @status_internal, updated_at = @updated_at,
      payload_json = @payload, cached_at = @cached_at
  `, { company_id: companyId, id: String(row.id), io_id: Number(row.ioId) || 0, ioi_id: Number(row.ioiId) || 0, sku_id: row.skuId != null ? String(row.skuId) : null, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}});}async function deleteItems(companyId, ids) {if (!ids.length) return;const db = openCacheDb();await withTransaction(db, async (txDb) => {const list = ids;for (const id of list) await execute(txDb, "DELETE FROM purchase_return_item_cache WHERE company_id = ? AND id = ?", [companyId, String(id)]);});}async function fetchHeadPage({ since, includeDeleted, limit, offset }) {const body = { limit, offset };if (since) body.since = since;if (includeDeleted) body.includeDeleted = true;const payload = await clientRuntime.remoteRequest("/api/master-data/purchase-returns", { method: "POST", body, timeoutMs: 120000 });return payload && payload.rows || [];}

async function fetchItemPage({ since, includeDeleted, limit, offset }) {
  const body = { limit, offset };
  if (since) body.since = since;
  if (includeDeleted) body.includeDeleted = true;
  const payload = await clientRuntime.remoteRequest("/api/master-data/purchase-return-items", {
    method: "POST",
    body,
    timeoutMs: 120000
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
























    all;await execute(txDb, "DELETE FROM purchase_return_cache WHERE company_id = ?", [companyId]);for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO purchase_return_cache (company_id, id, io_id, status_internal, io_date, supplier_name, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @io_id, @status_internal, @io_date, @supplier_name, @updated_at, @payload, @cached_at)
  `, { company_id: companyId, id: String(row.id), io_id: Number(row.ioId) || 0, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, io_date: row.ioDate != null ? String(row.ioDate) : null, supplier_name: row.supplierName != null ? String(row.supplierName) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}}












  );setMeta(companyId, "head", { cursor, lastFullAt: now, lastSyncAt: now });return { mode: "full", source: "head", total: all.length };}async function syncFullItem(companyId) {const all = [];let offset = 0;for (let guard = 0; guard < 1000; guard += 1) {const rows = await fetchItemPage({ limit: FULL_PAGE_ITEM, offset });all.push(...rows);if (rows.length < FULL_PAGE_ITEM) break;offset += FULL_PAGE_ITEM;}let cursor = "";for (const row of all) {if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;}const db = openCacheDb();const now = nowIso();await withTransaction(db, async (txDb) => {const items =
    all;await execute(txDb, "DELETE FROM purchase_return_item_cache WHERE company_id = ?", [companyId]);for (const row of items) {if (!row || !row.id) continue;await execute(txDb, `
    INSERT INTO purchase_return_item_cache (company_id, id, io_id, ioi_id, sku_id, status_internal, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @io_id, @ioi_id, @sku_id, @status_internal, @updated_at, @payload, @cached_at)
  `, { company_id: companyId, id: String(row.id), io_id: Number(row.ioId) || 0, ioi_id: Number(row.ioiId) || 0, sku_id: row.skuId != null ? String(row.skuId) : null, status_internal: row.statusInternal != null ? String(row.statusInternal) : null, updated_at: row.updatedAt != null ? String(row.updatedAt) : null, payload: JSON.stringify(row), cached_at: now });}});setMeta(companyId, "item", { cursor, lastFullAt: now, lastSyncAt: now });return { mode: "full", source: "item", total: all.length };}

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
    payload = await clientRuntime.remoteRequest("/api/master-data/purchase-return-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true };
  const db = openCacheDb();
  const localIds = db.prepare("SELECT id FROM purchase_return_cache WHERE company_id = ?").all(companyId).map((r) => r.id);
  const stale = localIds.filter((id) => !serverIds.has(id));
  deleteHeads(companyId, stale);
  setMeta(companyId, "head", { lastReconcileAt: nowIso() });
  return { source: "head", reconciled: stale.length };
}

async function reconcileItemDeletes(companyId) {
  let payload;
  try {
    payload = await clientRuntime.remoteRequest("/api/master-data/purchase-return-item-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true };
  const db = openCacheDb();
  const localIds = db.prepare("SELECT id FROM purchase_return_item_cache WHERE company_id = ?").all(companyId).map((r) => r.id);
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

// 对外：触发同步。mode='full'|'incremental'（默认 incremental，无游标自动转 full）。
// head 与 item 并行（不同锁 key），返回 { head, item }。
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

function getCacheStatus(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { companyId: null, headCount: 0, itemCount: 0, populated: false };
  let headCount = 0;
  let itemCount = 0;
  try {
    const db = openCacheDb();
    headCount = db.prepare("SELECT COUNT(*) AS c FROM purchase_return_cache WHERE company_id = ? AND status_internal != 'deleted'").get(companyId).c;
    itemCount = db.prepare("SELECT COUNT(*) AS c FROM purchase_return_item_cache WHERE company_id = ? AND status_internal != 'deleted'").get(companyId).c;
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
  configurePurchaseReturnCache,
  closeCacheDb,
  getCachedPurchaseReturns,
  getCachedPurchaseReturnsCount,
  getCachedPurchaseReturnItems,
  isCachePopulated,
  triggerSync,
  triggerReconcile,
  getCacheStatus
};