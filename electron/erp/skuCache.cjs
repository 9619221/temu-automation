// 商品资料本地缓存 + 增量同步引擎（client 模式专用）。
//
// 背景：client 模式桌面端没有本地 erp.sqlite，每次商品资料/采购搜索都跨海拉
// 全量 SKU（22576 条、~40MB），慢。本模块在 userData/data/cache.db 建一份本地
// 缓存：页面直接读缓存秒显示，后台增量从服务器（PR1 的 since / sku-ids 接口）拉
// 变化 merge。聚水潭已停用，服务器 erp_skus 是唯一权威源。
//
// 关键设计：
//   - company 分区：sku_cache 主键 (company_id, id)，换公司不串数据。
//   - 单飞锁：启动触发 + 进页触发 + 手动刷可能并发，同 company 的同步串行化。
//   - 增量游标：sku_sync_meta.cursor = 已同步到的 max(updated_at)，回退 1 秒重叠
//     拉取防边界漏（upsert 幂等，重复无害）。
//   - 删除检测两路：软删（status='deleted'，增量带 includeDeleted 能拿到→删缓存）
//     + 硬删（增量拉不到→靠 sku-ids 全量 id 对账兜底）。
//   - 降级：cache.db 打不开 / 老服务器无 sku-ids（404）时静默回退，不阻塞 UI。

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getErpDataDir } = require("../db/connection.cjs");
// 命名空间引用（非解构）：便于单元测试 monkey-patch remoteRequest / getRuntimeStatus。
const clientRuntime = require("./clientRuntime.cjs");

const FULL_PAGE = 1000; // 全量分页大小（22576 条 ≈ 23 次跨海）
const INCR_PAGE = 2000; // 增量分页大小（增量通常很少，大页减少往返）

let cacheDb = null;
let userDataDir = null;
const syncLocks = new Map(); // `${companyId}:${key}` -> in-flight Promise

function configureSkuCache(options = {}) {
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

// 游标回退 1 秒，重叠拉取防止同一 updated_at 边界行漏掉（upsert 幂等）。
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
    CREATE TABLE IF NOT EXISTS sku_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      internal_sku_code TEXT,
      product_name TEXT,
      status TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_sku_cache_code ON sku_cache(company_id, internal_sku_code);
    CREATE INDEX IF NOT EXISTS idx_sku_cache_name ON sku_cache(company_id, product_name);
    CREATE TABLE IF NOT EXISTS sku_sync_meta (
      company_id TEXT PRIMARY KEY,
      cursor TEXT,
      last_full_at TEXT,
      last_sync_at TEXT,
      last_reconcile_at TEXT
    );
  `);
  cacheDb = db;
  return db;
}

function closeCacheDb() {
  if (cacheDb) {
    try { cacheDb.close(); } catch { /* ignore */ }
    cacheDb = null;
  }
}

function getMeta(companyId) {
  const db = openCacheDb();
  return db.prepare("SELECT * FROM sku_sync_meta WHERE company_id = ?").get(companyId) || null;
}

function setMeta(companyId, fields = {}) {
  const db = openCacheDb();
  db.prepare(`
    INSERT INTO sku_sync_meta (company_id, cursor, last_full_at, last_sync_at, last_reconcile_at)
    VALUES (@company_id, @cursor, @last_full_at, @last_sync_at, @last_reconcile_at)
    ON CONFLICT(company_id) DO UPDATE SET
      cursor = COALESCE(@cursor, cursor),
      last_full_at = COALESCE(@last_full_at, last_full_at),
      last_sync_at = COALESCE(@last_sync_at, last_sync_at),
      last_reconcile_at = COALESCE(@last_reconcile_at, last_reconcile_at)
  `).run({
    company_id: companyId,
    cursor: fields.cursor != null ? fields.cursor : null,
    last_full_at: fields.lastFullAt != null ? fields.lastFullAt : null,
    last_sync_at: fields.lastSyncAt != null ? fields.lastSyncAt : null,
    last_reconcile_at: fields.lastReconcileAt != null ? fields.lastReconcileAt : null,
  });
}

function isCachePopulated(companyId) {
  if (!companyId) return false;
  try {
    const db = openCacheDb();
    const row = db.prepare("SELECT 1 FROM sku_cache WHERE company_id = ? LIMIT 1").get(companyId);
    return Boolean(row);
  } catch {
    return false;
  }
}

// 读缓存。返回 null 表示无法用缓存（无 companyId / 缓存空 / 打开失败），调用方据此降级回跨海。
function getCachedSkus(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {
    db = openCacheDb();
  } catch {
    return null;
  }
  if (!isCachePopulated(companyId)) return null;

  const conditions = ["company_id = @company_id", "status != 'deleted'"];
  const args = { company_id: companyId };
  const search = optionalString(params.search);
  if (search) {
    conditions.push("(internal_sku_code LIKE @search OR id LIKE @search OR product_name LIKE @search)");
    args.search = `%${search}%`;
  }
  const limit = Math.max(1, Math.min(Number(params.limit) || 500, 100000));
  const offset = Math.max(0, Number(params.offset) || 0);
  const rows = db.prepare(`
    SELECT payload_json FROM sku_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...args, limit, offset });
  return rows.map((row) => JSON.parse(row.payload_json));
}

function upsertSkus(companyId, rows) {
  if (!rows.length) return;
  const db = openCacheDb();
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO sku_cache (company_id, id, internal_sku_code, product_name, status, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @code, @name, @status, @updated_at, @payload, @cached_at)
    ON CONFLICT(company_id, id) DO UPDATE SET
      internal_sku_code = @code, product_name = @name, status = @status,
      updated_at = @updated_at, payload_json = @payload, cached_at = @cached_at
  `);
  const tx = db.transaction((items) => {
    for (const row of items) {
      if (!row || !row.id) continue;
      stmt.run({
        company_id: companyId,
        id: String(row.id),
        code: row.internalSkuCode != null ? String(row.internalSkuCode) : null,
        name: row.productName != null ? String(row.productName) : null,
        status: row.status != null ? String(row.status) : null,
        updated_at: row.updatedAt != null ? String(row.updatedAt) : null,
        payload: JSON.stringify(row),
        cached_at: now,
      });
    }
  });
  tx(rows);
}

function deleteSkus(companyId, ids) {
  if (!ids.length) return;
  const db = openCacheDb();
  const stmt = db.prepare("DELETE FROM sku_cache WHERE company_id = ? AND id = ?");
  const tx = db.transaction((list) => {
    for (const id of list) stmt.run(companyId, String(id));
  });
  tx(ids);
}

async function fetchSkuPage({ since, includeDeleted, limit, offset }) {
  const body = { part: "skus", limit, offset };
  if (since) body.since = since;
  if (includeDeleted) body.includeDeleted = true;
  const payload = await clientRuntime.remoteRequest("/api/master-data/workbench", {
    method: "POST",
    body,
    timeoutMs: 120000,
  });
  return (payload && payload.workbench && payload.workbench.skus) || [];
}

// 全量重建：拉所有活跃 SKU 到内存后一个事务替换该 company 缓存（中途失败不破坏旧缓存）。
async function syncFull(companyId) {
  const all = [];
  let offset = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const skus = await fetchSkuPage({ limit: FULL_PAGE, offset });
    all.push(...skus);
    if (skus.length < FULL_PAGE) break;
    offset += FULL_PAGE;
  }
  let cursor = "";
  for (const row of all) {
    if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
  }
  const db = openCacheDb();
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO sku_cache (company_id, id, internal_sku_code, product_name, status, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @code, @name, @status, @updated_at, @payload, @cached_at)
  `);
  const replaceTx = db.transaction((items) => {
    db.prepare("DELETE FROM sku_cache WHERE company_id = ?").run(companyId);
    for (const row of items) {
      if (!row || !row.id) continue;
      stmt.run({
        company_id: companyId,
        id: String(row.id),
        code: row.internalSkuCode != null ? String(row.internalSkuCode) : null,
        name: row.productName != null ? String(row.productName) : null,
        status: row.status != null ? String(row.status) : null,
        updated_at: row.updatedAt != null ? String(row.updatedAt) : null,
        payload: JSON.stringify(row),
        cached_at: now,
      });
    }
  });
  replaceTx(all);
  setMeta(companyId, { cursor, lastFullAt: now, lastSyncAt: now });
  return { mode: "full", total: all.length };
}

// 增量：since 固定（cursor 回退 1 秒）+ offset 翻页拉所有变化行。
async function syncIncremental(companyId) {
  const meta = getMeta(companyId);
  if (!meta || !meta.cursor) return syncFull(companyId);
  const since = shiftBack1s(meta.cursor);
  let offset = 0;
  let cursor = meta.cursor;
  let upserted = 0;
  let deleted = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const skus = await fetchSkuPage({ since, includeDeleted: true, limit: INCR_PAGE, offset });
    if (!skus.length) break;
    const toUpsert = skus.filter((row) => row.status !== "deleted");
    const toDelete = skus.filter((row) => row.status === "deleted").map((row) => row.id);
    upsertSkus(companyId, toUpsert);
    deleteSkus(companyId, toDelete);
    upserted += toUpsert.length;
    deleted += toDelete.length;
    for (const row of skus) {
      if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
    }
    if (skus.length < INCR_PAGE) break;
    offset += INCR_PAGE;
  }
  setMeta(companyId, { cursor, lastSyncAt: nowIso() });
  return { mode: "incremental", upserted, deleted };
}

// 硬删对账：拉服务器全量 id 集，本地多出来的（被硬删的）清掉。老服务器无端点则静默跳过。
async function reconcileDeletes(companyId) {
  let payload;
  try {
    payload = await clientRuntime.remoteRequest("/api/master-data/sku-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true }; // 防御：空集不敢全删
  const db = openCacheDb();
  const localIds = db.prepare("SELECT id FROM sku_cache WHERE company_id = ?").all(companyId).map((r) => r.id);
  const stale = localIds.filter((id) => !serverIds.has(id));
  deleteSkus(companyId, stale);
  setMeta(companyId, { lastReconcileAt: nowIso() });
  return { reconciled: stale.length };
}

// 单飞：同 company 的 sync 串行化（full 与 incremental 共用 "sync" key 互斥）。
function withLock(companyId, key, fn) {
  const lockKey = `${companyId}:${key}`;
  if (syncLocks.has(lockKey)) return syncLocks.get(lockKey);
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => syncLocks.delete(lockKey));
  syncLocks.set(lockKey, promise);
  return promise;
}

// 对外：触发同步。mode='full'|'incremental'（默认 incremental，无游标自动转 full）。
async function triggerSync(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { skipped: true, reason: "no-company" };
  const runtime = clientRuntime.getRuntimeStatus();
  if (runtime.mode !== "client" || !runtime.serverUrl) return { skipped: true, reason: "not-client" };
  const mode = options.mode === "full" ? "full" : "incremental";
  return withLock(companyId, "sync", async () => {
    const result = mode === "full" ? await syncFull(companyId) : await syncIncremental(companyId);
    return result;
  });
}

// 对外：触发硬删对账（独立锁，可与 sync 并行）。
async function triggerReconcile(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { skipped: true, reason: "no-company" };
  const runtime = clientRuntime.getRuntimeStatus();
  if (runtime.mode !== "client" || !runtime.serverUrl) return { skipped: true, reason: "not-client" };
  return withLock(companyId, "reconcile", () => reconcileDeletes(companyId));
}

function getCacheStatus(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { companyId: null, count: 0, populated: false };
  let count = 0;
  try {
    const db = openCacheDb();
    count = db.prepare("SELECT COUNT(*) AS c FROM sku_cache WHERE company_id = ? AND status != 'deleted'").get(companyId).c;
  } catch {
    return { companyId, count: 0, populated: false };
  }
  const meta = getMeta(companyId);
  return {
    companyId,
    count,
    populated: count > 0,
    cursor: meta?.cursor || null,
    lastFullAt: meta?.last_full_at || null,
    lastSyncAt: meta?.last_sync_at || null,
    lastReconcileAt: meta?.last_reconcile_at || null,
    syncing: syncLocks.has(`${companyId}:sync`),
  };
}

module.exports = {
  configureSkuCache,
  closeCacheDb,
  getCachedSkus,
  isCachePopulated,
  triggerSync,
  triggerReconcile,
  getCacheStatus,
};
