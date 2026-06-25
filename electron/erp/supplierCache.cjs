// 供应商列表本地缓存（client 模式专用）。
// 与 accountCache.cjs 同架构：stale-while-revalidate，共用 cache.db。
// 供应商全量 ~3.7MB JSON，变化频率低（天级），不值得每次跨海拉全量。

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getErpDataDir } = require("../db/connection.cjs");
const clientRuntime = require("./clientRuntime.cjs");

let cacheDb = null;
let userDataDir = null;
const syncLocks = new Map();

function configureSupplierCache(options = {}) {
  userDataDir = options.userDataDir || userDataDir || null;
}

function nowIso() {
  return new Date().toISOString();
}

function getCurrentCompanyId() {
  try {
    const cid = clientRuntime.getRuntimeStatus()?.currentUser?.companyId;
    return cid == null ? "" : String(cid).trim() || "";
  } catch {
    return "";
  }
}

async function openCacheDb() {
  if (cacheDb) return cacheDb;
  const dbPath = path.join(getErpDataDir({ userDataDir }), "cache.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  await execSql(db, `
    CREATE TABLE IF NOT EXISTS supplier_cache (
      company_id TEXT PRIMARY KEY,
      suppliers_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
  `);
  cacheDb = db;
  return db;
}

async function getCachedSuppliers(companyId) {
  const key = companyId != null ? companyId : getCurrentCompanyId();
  let db;
  try {db = openCacheDb();} catch {return null;}
  let row;
  try {
    row = await queryOne(db, "SELECT suppliers_json FROM supplier_cache WHERE company_id = ?", [key]);
  } catch {return null;}
  if (!row) return null;
  try {
    const arr = JSON.parse(row.suppliers_json);
    return Array.isArray(arr) ? arr : null;
  } catch {return null;}
}

async function setCachedSuppliers(companyId, suppliers) {
  const key = companyId != null ? companyId : getCurrentCompanyId();
  const db = openCacheDb();
  await execute(db, `
    INSERT INTO supplier_cache (company_id, suppliers_json, cached_at)
    VALUES (@company_id, @suppliers_json, @cached_at)
    ON CONFLICT(company_id) DO UPDATE SET
      suppliers_json = excluded.suppliers_json,
      cached_at = excluded.cached_at
  `, {
    company_id: key,
    suppliers_json: JSON.stringify(Array.isArray(suppliers) ? suppliers : []),
    cached_at: nowIso()
  });
}

async function fetchRemoteSuppliers(params = {}) {
  const payload = await clientRuntime.remoteRequest("/api/master-data/workbench", {
    method: "POST",
    body: { ...(params || {}), part: "suppliers" },
    timeoutMs: 60000
  });
  return payload && payload.workbench && payload.workbench.suppliers || [];
}

async function triggerSync(params = {}) {
  const companyId = getCurrentCompanyId();
  if (syncLocks.has(companyId)) return syncLocks.get(companyId);
  const promise = (async () => {
    const suppliers = await fetchRemoteSuppliers(params);
    try {setCachedSuppliers(companyId, suppliers);} catch {/* */}
    return suppliers;
  })();
  syncLocks.set(companyId, promise);
  try {
    return await promise;
  } finally {
    syncLocks.delete(companyId);
  }
}

function closeCacheDb() {
  if (cacheDb) {
    try {cacheDb.close();} catch {/* */}
    cacheDb = null;
  }
}

module.exports = {
  configureSupplierCache,
  getCachedSuppliers,
  setCachedSuppliers,
  triggerSync,
  closeCacheDb
};