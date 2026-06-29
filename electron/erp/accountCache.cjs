// 账号(店铺)列表本地缓存（client 模式专用）。
//
// 背景：account.list 在 client 模式每次都实时跨海打主控端 /api/master-data/workbench
// (part=accounts)，本身没有本地缓存。主控端一抖动/慢，出库中心、采购单等页面一进来
// 就调 account.list，直接撞「连接主控端超时」糊在脸上（60s 超时白等）。
//
// 本模块在 userData/data/cache.db 存一份 accounts 快照，配合 listAccountsRuntime 实现
// stale-while-revalidate：有缓存就秒返回 + 后台静默刷新；首次无缓存才实时拉一次并写
// 缓存；实时拉取超时/失败时尽量回退到旧缓存，而不是直接抛错。
//
// accounts 量很小（数十条），整段以 JSON blob 存储、按 company_id 分区，不做增量游标。

const cacheDbShared = require("./cacheDb.cjs");
// 命名空间引用（非解构）：便于单测 monkey-patch remoteRequest / getRuntimeStatus。
const clientRuntime = require("./clientRuntime.cjs");

const syncLocks = new Map(); // companyId -> in-flight Promise（同 company 并发单飞）

function configureAccountCache(options = {}) {
  cacheDbShared.configure(options);
}

function nowIso() {
  return new Date().toISOString();
}

function optionalString(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "";
}

// company 缺失时统一用空串作 key（同 session 内一致即可，换公司自然换 key 不串数据）。
function getCurrentCompanyId() {
  try {
    return optionalString(clientRuntime.getRuntimeStatus()?.currentUser?.companyId);
  } catch {
    return "";
  }
}

function openCacheDb() {
  const db = cacheDbShared.open();
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_cache (
      company_id TEXT PRIMARY KEY,
      accounts_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
  `);
  return db;
}

// 读缓存。返回 null 表示无可用缓存（无缓存 / 打开或解析失败），调用方据此降级实时拉。
async function getCachedAccounts(companyId) {
  const key = companyId != null ? companyId : getCurrentCompanyId();
  let db;
  try {
    db = openCacheDb();
  } catch {
    return null;
  }
  let row;
  try {
    row = db.prepare("SELECT accounts_json FROM account_cache WHERE company_id = ?").get(key);
  } catch {
    return null;
  }
  if (!row) return null;
  try {
    const arr = JSON.parse(row.accounts_json);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function setCachedAccounts(companyId, accounts) {
  const key = companyId != null ? companyId : getCurrentCompanyId();
  const db = openCacheDb();
  db.prepare(`
    INSERT INTO account_cache (company_id, accounts_json, cached_at)
    VALUES (@company_id, @accounts_json, @cached_at)
    ON CONFLICT(company_id) DO UPDATE SET
      accounts_json = excluded.accounts_json,
      cached_at = excluded.cached_at
  `).run({
    company_id: key,
    accounts_json: JSON.stringify(Array.isArray(accounts) ? accounts : []),
    cached_at: nowIso()
  });
}

async function fetchRemoteAccounts(params = {}) {
  const payload = await clientRuntime.remoteRequest("/api/master-data/workbench", {
    method: "POST",
    body: { ...(params || {}), part: "accounts" },
    timeoutMs: 60000
  });
  return payload && payload.workbench && payload.workbench.accounts || [];
}

// 拉主控端最新 accounts 并写缓存。同 company 并发请求单飞，共享同一 in-flight Promise。
// 成功返回拉到的 accounts；失败抛错（由调用方决定是否回退旧缓存）。
async function triggerSync(params = {}) {
  const companyId = getCurrentCompanyId();
  if (syncLocks.has(companyId)) return syncLocks.get(companyId);
  const promise = (async () => {
    const accounts = await fetchRemoteAccounts(params);
    try {
      setCachedAccounts(companyId, accounts);
    } catch {

      // 缓存写失败不影响返回
    }return accounts;
  })();
  syncLocks.set(companyId, promise);
  try {
    return await promise;
  } finally {
    syncLocks.delete(companyId);
  }
}

function closeCacheDb() {
  cacheDbShared.close();
}

module.exports = {
  configureAccountCache,
  getCachedAccounts,
  setCachedAccounts,
  triggerSync,
  closeCacheDb
};