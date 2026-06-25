// 找品单（采购请求）本地缓存 + 增量同步引擎（client 模式专用）。
//
// 背景：client 模式桌面端没有本地 erp.sqlite，找品页首屏每次跨海拉全量找品单
// （limit 2000，含商品/店铺/发起人 join 的富行，payload 大、跨海慢，进页面长时间
// 骨架屏）。本模块在 userData/data/cache.db 建一份本地镜像：找品页直接读缓存秒显，
// 后台增量从主控端（/api/purchase/requests 的 since 接口）拉变化 merge。
//
// 设计对齐 skuCache（黄金模板），差异点：
//   - 找品行是 erp_purchase_requests + 多表 join 的「富行」（带 internalSkuCode /
//     productName / accountName / requestedByName / candidateCount / 映射价等）。
//     镜像表只抽出少量可查询/可搜索列建索引，整行存 payload_json。
//   - erp_purchase_requests 是硬删除表（无软删标记），所以：增量靠 updated_at 纯
//     upsert，删除完全靠 request-ids 全量 id 对账兜底（reconcileDeletes）。
//   - 找品总量中等（几百~几千），getCachedPurchaseRequests 默认返回该 company 全部
//     活跃找品行（本地查询毫秒级），前端拿去照原有逻辑分队列 / 计数 / 分页——前端
//     改动最小：把「远端 workbench.purchaseRequests」换成「本地缓存的 purchaseRequests」。
//
// 接口契约（主控端待实现，见 Phase1 task #2）：
//   POST /api/purchase/requests  body { since?, includeDeleted?, limit, offset }
//     -> { ok, requests: [ <与 workbench.purchaseRequests 同口径的富行> ] }
//        富行须含 id / updatedAt，按 updated_at 可增量；建议 ORDER BY updated_at。
//   GET  /api/purchase/request-ids -> { ok, ids: [<当前存在的找品单 id 全集>] }

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

function configurePurchaseRequestCache(options = {}) {
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

async function openCacheDb() {
  if (cacheDb) return cacheDb;
  const dbPath = getCacheDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  await execSql(db, `
    CREATE TABLE IF NOT EXISTS purchase_request_cache (
      company_id TEXT NOT NULL,
      id TEXT NOT NULL,
      account_id TEXT,
      sku_id TEXT,
      status TEXT,
      reason TEXT,
      internal_sku_code TEXT,
      product_name TEXT,
      account_name TEXT,
      requested_by_name TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      cached_at TEXT NOT NULL,
      PRIMARY KEY (company_id, id)
    );
    -- 列表固定按 updated_at DESC 排序，索引避免全表 TEMP B-TREE 排序。
    CREATE INDEX IF NOT EXISTS idx_pr_cache_updated ON purchase_request_cache(company_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_pr_cache_status ON purchase_request_cache(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_pr_cache_code ON purchase_request_cache(company_id, internal_sku_code);
    CREATE TABLE IF NOT EXISTS purchase_request_sync_meta (
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
    try {cacheDb.close();} catch {/* ignore */}
    cacheDb = null;
  }
}

async function getMeta(companyId) {
  const db = openCacheDb();
  return (await queryOne(db, "SELECT * FROM purchase_request_sync_meta WHERE company_id = ?", [companyId])) || null;
}

async function setMeta(companyId, fields = {}) {
  const db = openCacheDb();
  await execute(db, `
    INSERT INTO purchase_request_sync_meta (company_id, cursor, last_full_at, last_sync_at, last_reconcile_at)
    VALUES (@company_id, @cursor, @last_full_at, @last_sync_at, @last_reconcile_at)
    ON CONFLICT(company_id) DO UPDATE SET
      cursor = COALESCE(@cursor, cursor),
      last_full_at = COALESCE(@last_full_at, last_full_at),
      last_sync_at = COALESCE(@last_sync_at, last_sync_at),
      last_reconcile_at = COALESCE(@last_reconcile_at, last_reconcile_at)
  `, {
    company_id: companyId,
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
    const row = await queryOne(db, "SELECT 1 FROM purchase_request_cache WHERE company_id = ? LIMIT 1", [companyId]);
    return Boolean(row);
  } catch {
    return false;
  }
}

// 读缓存。返回 null 表示无法用缓存（无 companyId / 缓存空 / 打开失败），调用方据此降级回跨海。
// 默认返回该 company 全部活跃找品富行（payload 原样），前端照原逻辑分队列 / 计数 / 分页。
async function getCachedPurchaseRequests(params = {}) {
  const companyId = optionalString(params.companyId) || getCurrentCompanyId();
  if (!companyId) return null;
  let db;
  try {
    db = openCacheDb();
  } catch {
    return null;
  }
  if (!isCachePopulated(companyId)) return null;

  const conditions = ["company_id = @company_id"];
  const args = { company_id: companyId };
  const search = optionalString(params.search);
  if (search) {
    conditions.push(
      "(internal_sku_code LIKE @search OR product_name LIKE @search OR account_name LIKE @search OR requested_by_name LIKE @search OR id LIKE @search)"
    );
    args.search = `%${search}%`;
  }
  // 默认不限条数（找品量中等，本地查询毫秒级）；保留 limit/offset 以备将来。
  const limit = Math.max(1, Math.min(Number(params.limit) || 100000, 100000));
  const offset = Math.max(0, Number(params.offset) || 0);
  const rows = await queryAll(db, `
    SELECT payload_json FROM purchase_request_cache
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT @limit OFFSET @offset
  `, { ...args, limit, offset });
  return rows.map((row) => JSON.parse(row.payload_json));
}

function rowToCacheColumns(companyId, row, now) {
  return {
    company_id: companyId,
    id: String(row.id),
    account_id: row.accountId != null ? String(row.accountId) : null,
    sku_id: row.skuId != null ? String(row.skuId) : null,
    status: row.status != null ? String(row.status) : null,
    reason: row.reason != null ? String(row.reason) : null,
    internal_sku_code: row.internalSkuCode != null ? String(row.internalSkuCode) : null,
    product_name: row.productName != null ? String(row.productName) : null,
    account_name: row.accountName != null ? String(row.accountName) : null,
    requested_by_name: row.requestedByName != null ? String(row.requestedByName) : null,
    updated_at: row.updatedAt != null ? String(row.updatedAt) : null,
    payload: JSON.stringify(row),
    cached_at: now
  };
}

const UPSERT_SQL = `
  INSERT INTO purchase_request_cache
    (company_id, id, account_id, sku_id, status, reason, internal_sku_code, product_name, account_name, requested_by_name, updated_at, payload_json, cached_at)
  VALUES
    (@company_id, @id, @account_id, @sku_id, @status, @reason, @internal_sku_code, @product_name, @account_name, @requested_by_name, @updated_at, @payload, @cached_at)
  ON CONFLICT(company_id, id) DO UPDATE SET
    account_id = @account_id, sku_id = @sku_id, status = @status, reason = @reason,
    internal_sku_code = @internal_sku_code, product_name = @product_name,
    account_name = @account_name, requested_by_name = @requested_by_name,
    updated_at = @updated_at, payload_json = @payload, cached_at = @cached_at
`;

async function upsertRequests(companyId, rows) {
  if (!rows.length) return;
  const db = openCacheDb();
  const now = nowIso();






  await withTransaction(db, async (txDb) => {const items =







    rows;for (const row of items) {if (!row || !row.id) continue;await execute(txDb, UPSERT_SQL, [rowToCacheColumns(companyId, row, now)]);}}

  );}async function deleteRequests(companyId, ids) {if (!ids.length) return;const db = openCacheDb();await withTransaction(db, async (txDb) => {const list =
    ids;for (const id of list) await execute(txDb, "DELETE FROM purchase_request_cache WHERE company_id = ? AND id = ?", [companyId, String(id)]);});
}

async function fetchRequestPage({ since, includeDeleted, limit, offset }) {
  const body = { limit, offset };
  if (since) body.since = since;
  if (includeDeleted) body.includeDeleted = true;
  const payload = await clientRuntime.remoteRequest("/api/purchase/requests", {
    method: "POST",
    body,
    timeoutMs: 120000
  });
  return payload && Array.isArray(payload.requests) ? payload.requests : [];
}

// 全量重建：拉所有找品行到内存后一个事务替换该 company 缓存（中途失败不破坏旧缓存）。
async function syncFull(companyId) {
  const all = [];
  let offset = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const rows = await fetchRequestPage({ limit: FULL_PAGE, offset });
    all.push(...rows);
    if (rows.length < FULL_PAGE) break;
    offset += FULL_PAGE;
  }
  let cursor = "";
  for (const row of all) {
    if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
  }
  const db = openCacheDb();
  const now = nowIso();await withTransaction(db,

  async (txDb) => {const items =






    all;await execute(txDb, "DELETE FROM purchase_request_cache WHERE company_id = ?", [companyId]);for (const row of items) {if (!row || !row.id) continue;await execute(txDb, UPSERT_SQL, [rowToCacheColumns(companyId, row, now)]);}});
  setMeta(companyId, { cursor, lastFullAt: now, lastSyncAt: now });
  return { mode: "full", total: all.length };
}

// 增量：since 固定（cursor 回退 1 秒）+ offset 翻页拉所有变化行。
// erp_purchase_requests 无软删标记，纯 upsert；删除靠 reconcileDeletes 兜底。
async function syncIncremental(companyId) {
  const meta = getMeta(companyId);
  if (!meta || !meta.cursor) return syncFull(companyId);
  const since = shiftBack1s(meta.cursor);
  let offset = 0;
  let cursor = meta.cursor;
  let upserted = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const rows = await fetchRequestPage({ since, limit: INCR_PAGE, offset });
    if (!rows.length) break;
    upsertRequests(companyId, rows);
    upserted += rows.length;
    for (const row of rows) {
      if (row.updatedAt && row.updatedAt > cursor) cursor = row.updatedAt;
    }
    if (rows.length < INCR_PAGE) break;
    offset += INCR_PAGE;
  }
  setMeta(companyId, { cursor, lastSyncAt: nowIso() });
  return { mode: "incremental", upserted };
}

// 硬删对账：拉服务器全量 id 集，本地多出来的（被硬删的）清掉。老服务器无端点则静默跳过。
async function reconcileDeletes(companyId) {
  let payload;
  try {
    payload = await clientRuntime.remoteRequest("/api/purchase/request-ids", { method: "GET", timeoutMs: 60000 });
  } catch (error) {
    if (error && error.statusCode === 404) return { skipped: true };
    throw error;
  }
  const serverIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
  if (!serverIds.size) return { skipped: true }; // 防御：空集不敢全删
  const db = openCacheDb();
  const localIds = (await queryAll(db, "SELECT id FROM purchase_request_cache WHERE company_id = ?", [companyId])).map((r) => r.id);
  const stale = localIds.filter((id) => !serverIds.has(id));
  deleteRequests(companyId, stale);
  setMeta(companyId, { lastReconcileAt: nowIso() });
  return { reconciled: stale.length };
}

// 单飞：同 company 的 sync 串行化（full 与 incremental 共用 "sync" key 互斥）。
function withLock(companyId, key, fn) {
  const lockKey = `${companyId}:${key}`;
  if (syncLocks.has(lockKey)) return syncLocks.get(lockKey);
  const promise = Promise.resolve().
  then(fn).
  finally(() => syncLocks.delete(lockKey));
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
  return withLock(companyId, "sync", async () =>
  mode === "full" ? syncFull(companyId) : syncIncremental(companyId)
  );
}

// 对外：触发硬删对账（独立锁，可与 sync 并行）。
async function triggerReconcile(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { skipped: true, reason: "no-company" };
  const runtime = clientRuntime.getRuntimeStatus();
  if (runtime.mode !== "client" || !runtime.serverUrl) return { skipped: true, reason: "not-client" };
  return withLock(companyId, "reconcile", () => reconcileDeletes(companyId));
}

async function getCacheStatus(options = {}) {
  const companyId = optionalString(options.companyId) || getCurrentCompanyId();
  if (!companyId) return { companyId: null, count: 0, populated: false };
  let count = 0;
  try {
    const db = openCacheDb();
    count = (await queryOne(db, "SELECT COUNT(*) AS c FROM purchase_request_cache WHERE company_id = ?", [companyId])).c;
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
    syncing: syncLocks.has(`${companyId}:sync`)
  };
}

module.exports = {
  configurePurchaseRequestCache,
  closeCacheDb,
  getCachedPurchaseRequests,
  isCachePopulated,
  triggerSync,
  triggerReconcile,
  getCacheStatus
};