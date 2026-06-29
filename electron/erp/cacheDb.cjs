// cache.db 共享连接（所有 *Cache.cjs 模块共用）。
// 之前每个 cache 模块各自 new Database(cache.db) 打开独立连接，
// SQLite WAL 模式下跨连接写读存在可见性延迟：A 连接写入的 mapping_cache 行，
// B 连接的 NOT EXISTS 子查询可能看不到，导致"映射了一遍还要第二遍"。
// 改为单连接后写读在同一事务视图内，问题消除。

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getErpDataDir } = require("../db/connection.cjs");

let sharedDb = null;
let userDataDir = null;

function configure(options = {}) {
  userDataDir = options.userDataDir || userDataDir || null;
}

function getCacheDbPath() {
  return path.join(getErpDataDir({ userDataDir }), "cache.db");
}

function open() {
  if (sharedDb) return sharedDb;
  const dbPath = getCacheDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  sharedDb = db;
  return db;
}

function close() {
  if (sharedDb) {
    try { sharedDb.close(); } catch { /* ignore */ }
    sharedDb = null;
  }
}

module.exports = { configure, open, close };
