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
  db.__erpDbPath = dbPath;
  return db;
}

module.exports = {
  getDefaultUserDataDir,
  getErpDataDir,
  getErpDatabasePath,
  openErpDatabase,
};

