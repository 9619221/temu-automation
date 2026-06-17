const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

function getDefaultUserDataDir(env = process.env) {
  if (env.APP_USER_DATA) return env.APP_USER_DATA;
  if (env.TEMU_USER_DATA) return env.TEMU_USER_DATA;
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "temu-automation");
}

function getErpDataDir(options = {}) {
  if (options.dataDir) return path.resolve(options.dataDir);
  const userDataDir = options.userDataDir || getDefaultUserDataDir(options.env || process.env);
  return path.join(userDataDir, "data");
}

function getErpDatabasePath(options = {}) {
  if (options.dbPath) return path.resolve(options.dbPath);
  return path.join(getErpDataDir(options), "erp.sqlite");
}

function openErpDatabase(options = {}) {
  const dbPath = getErpDatabasePath(options);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -65536");
  db.pragma("mmap_size = 268435456");
  if (process.env.ERP_WAL_AUTOCHECKPOINT === "0") {
    db.pragma("wal_autocheckpoint = 0");
  }
  db.__erpDbPath = dbPath;
  return db;
}

function openErpDatabaseReadonly(dbPathOrOptions = {}) {
  const dbPath = typeof dbPathOrOptions === "string"
    ? dbPathOrOptions
    : getErpDatabasePath(dbPathOrOptions);
  // 只读连接：不要设 journal_mode（改 DB header 是写操作，只读连接会抛 SQLITE_READONLY；
  // WAL 模式由主连接维护，只读连接打开时自动继承）。也不碰 wal_autocheckpoint（checkpoint
  // 是主连接的事）。只保留对只读有意义的两项：query_only 强化只读约束、busy_timeout 防读阻塞。
  const db = new Database(dbPath, { readonly: true });
  db.pragma("query_only = ON");
  db.pragma("busy_timeout = 10000");
  db.pragma("cache_size = -65536");
  db.pragma("mmap_size = 268435456");
  db.__erpDbPath = dbPath;
  return db;
}

module.exports = {
  getDefaultUserDataDir,
  getErpDataDir,
  getErpDatabasePath,
  openErpDatabase,
  openErpDatabaseReadonly,
};

