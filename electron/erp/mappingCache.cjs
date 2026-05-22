// 1688 供应商映射本地缓存 + 增量同步引擎（client 模式专用）。
//
// 背景：供应商管理(AlibabaMapping)每次进页面跨海全量拉映射(erp_sku_1688_sources，
// ~1.6 万条)，慢。本模块在 userData/data/cache.db 建一份本地映射缓存：页面直接读缓存
// 秒显示，后台增量从服务器（PR-M1 的 /api/master-data/mappings + mapping-ids 接口）拉
// 变化 merge。与 skuCache.cjs 同构、共用同一个 cache.db 文件（各自独立表）。
//
// 关键设计（与 skuCache 一致）：
//   - company 分区：mapping_cache 主键 (company_id, id)，换公司不串数据。
//   - 单飞锁：启动/进页/手动刷并发时，同 company 的同步串行化。
//   - 增量游标：mapping_sync_meta.cursor = 已同步到的 max(updated_at)，回退 1 秒重叠
//     拉取防边界漏（upsert 幂等，重复无害）。
//   - 删除检测两路：软删（status='deleted'，增量带 includeDeleted 能拿到→删缓存）
//     + 硬删（增量拉不到→靠 mapping-ids 全量 id 对账兜底）。
//   - 降级：cache.db 打不开 / 老服务器无 mapping 接口（404）时静默回退，不阻塞 UI。

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getErpDataDir } = require("../db/connection.cjs");
// 命名空间引用（非解构）：便于单元测试 monkey-patch remoteRequest / getRuntimeStatus。
const clientRuntime = require("./clientRuntime.cjs");

const FULL_PAGE = 1000; // 全量分页大小
const INCR_PAGE = 2000; // 增量分页大小（增量通常很少，大页减少往返）

let cacheDb = null;
let userDataDir = null;
const syncLocks = new Map(); // `${companyId}:${key}` -> in-flight Promise

function configureMappingCache(options = {}) {
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
    CREATE TABLE IF NOT EXISTS mapping_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      sku_id TEXT,
      account_id TEXT,
      status TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_mapping_cache_sku ON mapping_cache(company_id, sku_id);
    -- 同 skuCache：列表按 updated_at DESC 排序，缺索引会 USE TEMP B-TREE 全表排序，
    -- 加 (company_id, updated_at) 走索引提速。IF NOT EXISTS 让旧 cache.db 自动补建。
    CREATE INDEX IF NOT EXISTS idx_mapping_cache_updated ON mapping_cache(company_id, updated_at);
    CREATE TABLE IF NOT EXISTS mapping_sync_meta (
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
  return db.prepare("SELECT * FROM mapping_sync_meta WHERE company_id = ?").get(companyId) || null;
}

function setMeta(companyId, fields = {}) {
  const db = openCacheDb();
  db.prepare(`
    INSERT INTO mapping_sync_meta (company_id, cursor, last_full_at, last_sync_at, last_reconcile_at)
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
    const row = db.prepare("SELECT 1 FROM mapping_cache WHERE company_id = ? LIMIT 1").get(companyId);
    return Boolean(row);
  } catch {
    return false;
  }
}

// 构建 WHERE 条件（list 与 count 共用，保证两者口径一致）。search 走 payload_json LIKE：
// mapping_cache 没有 internal_sku_code / supplier_name 等单列，但 payload 是整条映射的
// JSON，前端搜的所有字段都在里面；16385 条全表扫 LIKE 仅几十毫秒，可接受。
function buildMappingConditions(params, args) {
  const conditions = ["company_id = @company_id", "status != 'deleted'"];
  const skuId = optionalString(params.skuId || params.sku_id);
  if (skuId) {
    conditions.push("sku_id = @sku_id");
    args.sku_id = skuId;
  }
  const accountId = optionalString(params.accountId || params.account_id);
  if (accountId) {
    conditions.push("account_id = @account_id");
    args.account_id = accountId;
  }
  const search = optionalString(params.search);
  if (search) {
    conditions.push("payload_json LIKE @search");
    args.search = `%${search}%`;
  }
  return conditions;
}

// 读缓存。返回 null 表示无法用缓存（无 companyId / 缓存空 / 打开失败），调用方据此降级回跨海。
function getCachedMappings(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {
    db = openCacheDb();
  } catch {
    return null;
  }
  if (!isCachePopulated(companyId)) return null;

  const args = { company_id: companyId };
  const conditions = buildMappingConditions(params, args);
  const limit = Math.max(1, Math.min(Number(params.limit) || 100000, 500000));
  const offset = Math.max(0, Number(params.offset) || 0);
  const rows = db.prepare(`
    SELECT payload_json FROM mapping_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...args, limit, offset });
  return rows.map((row) => JSON.parse(row.payload_json));
}

// 计数（配合分页器，与 getCachedMappings 同口径）。返回 null 同样表示无法用缓存、调用方降级。
function getCachedMappingsCount(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {
    db = openCacheDb();
  } catch {
    return null;
  }
  if (!isCachePopulated(companyId)) return null;

  const args = { company_id: companyId };
  const conditions = buildMappingConditions(params, args);
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM mapping_cache
    WHERE ${conditions.join(" AND ")}
  `).get(args);
  return row ? row.c : 0;
}

function upsertMappings(companyId, rows) {
  if (!rows.length) return;
  const db = openCacheDb();
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO mapping_cache (company_id, id, sku_id, account_id, status, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @sku_id, @account_id, @status, @updated_at, @payload, @cached_at)
    ON CONFLICT(company_id, id) DO UPDATE SET
      sku_id = @sku_id, account_id = @account_id, status = @status,
      updated_at = @updated_at, payload_json = @payload, cached_at = @cached_at
  `);
  const tx = db.transaction((items) => {
    for (const row of items) {
      if (!row || !row.id) continue;
      stmt.run({
        company_id: companyId,
        id: String(row.id),
        sku_id: row.skuId != null ? String(row.skuId) : null,
        account_id: row.accountId != null ? String(row.accountId) : null,
        status: row.status != null ? String(row.status) : null,
        updated_at: row.updatedAt != null ? String(row.updatedAt) : null,
        payload: JSON.stringify(row),
        cached_at: now,
      });
    }
  });
  tx(rows);
}

function deleteMappings(companyId, ids) {
  if (!ids.length) return;
  const db = openCacheDb();
  const stmt = db.prepare("DELETE FROM mapping_cache WHERE company_id = ? AND id = ?");
  const tx = db.transaction((list) => {
    for (const id of list) stmt.run(companyId, String(id));
  });
  tx(ids);
}

async function fetchMappingPage({ since, includeDeleted, limit, offset }) {
  const body = { limit, offset };
  if (since) body.since = since;
  if (includeDeleted) body.includeDeleted = true;
  const payload = await clientRuntime.remoteRequest("/api/master-data/mappings", {
    method: "POST",
    body,
    timeoutMs: 120000,
  });
  return (payload && payload.mappings) || [];
}

// 全量重建：拉所有活跃映射到内存后一个事务替换该 company 缓存（中途失败不破坏旧缓存）。
async function syncFull(companyId) {
  const all = [];
  let offset = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const mappings = await fetchMappingPage({ limit: FULL_PAGE, offset });
    all.push(...mappings);
    if (mappings.length < FULL_PAGE) break;
    offset += FULL_PAGE;
  }
  let cursor = "";
  for (const row of all) {
    if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
  }
  const db = openCacheDb();
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO mapping_cache (company_id, id, sku_id, account_id, status, updated_at, payload_json, cached_at)
    VALUES (@company_id, @id, @sku_id, @account_id, @status, @updated_at, @payload, @cached_at)
  `);
  const replaceTx = db.transaction((items) => {
    db.prepare("DELETE FROM mapping_cache WHERE company_id = ?").run(companyId);
    for (const row of items) {
      if (!row || !row.id) continue;
      stmt.run({
        company_id: companyId,
        id: String(row.id),
        sku_id: row.skuId != null ? String(row.skuId) : null,
        account_id: row.accountId != null ? String(row.accountId) : null,
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
    const mappings = await fetchMappingPage({ since, includeDeleted: true, limit: INCR_PAGE, offset });
    if (!mappings.length) break;
    const toUpsert = mappings.filter((row) => row.status !== "deleted");
    const toDelete = mappings.filter((row) => row.status === "deleted").map((row) => row.id);
    upsertMappings(companyId, toUpsert);
    deleteMappings(companyId, toDelete);
    upserted += toUpsert.length;
    deleted += toDelete.length;
    for (const row of mappings) {
      if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
    }
    if (mappings.length < INCR_PAGE) break;
    offset += INCR_PAGE;
  }
  setMeta(companyId, { cursor, lastSyncAt: nowIso() });
  return { mode: "incremental", upserted, deleted };
}

// 硬删对账：拉服务器全量 id 集，本地多出来的（被硬删的）清掉。老服务器无端点则静默跳过。
async function reconcileDeletes(companyId) {
  let payload;
  try {
    payload = await clientRuntime.remoteRequest("/api/master-data/mapping-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true }; // 防御：空集不敢全删
  const db = openCacheDb();
  const localIds = db.prepare("SELECT id FROM mapping_cache WHERE company_id = ?").all(companyId).map((r) => r.id);
  const stale = localIds.filter((id) => !serverIds.has(id));
  deleteMappings(companyId, stale);
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
    count = db.prepare("SELECT COUNT(*) AS c FROM mapping_cache WHERE company_id = ? AND status != 'deleted'").get(companyId).c;
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
  configureMappingCache,
  closeCacheDb,
  getCachedMappings,
  getCachedMappingsCount,
  isCachePopulated,
  triggerSync,
  triggerReconcile,
  getCacheStatus,
};
