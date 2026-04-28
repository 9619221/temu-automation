const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getErpDatabasePath, openErpDatabase } = require("./connection.cjs");

const MIGRATION_LOG_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS erp_migration_log (
  id TEXT PRIMARY KEY,
  migration_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  remark TEXT
);
`;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function getMigrationsDir(options = {}) {
  return options.migrationsDir || path.join(__dirname, "migrations");
}

function listMigrationFiles(options = {}) {
  const migrationsDir = getMigrationsDir(options);
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      key: name.replace(/\.sql$/i, ""),
      name,
      path: path.join(migrationsDir, name),
    }));
}

function ensureMigrationLog(db) {
  db.exec(MIGRATION_LOG_TABLE_SQL);
}

function hasSuccessfulMigration(db, migrationKey) {
  const row = db.prepare(
    "SELECT status FROM erp_migration_log WHERE migration_key = ? AND status = 'success'",
  ).get(migrationKey);
  return Boolean(row);
}

function writeMigrationLog(db, migrationKey, status, remark = "") {
  db.prepare(`
    INSERT INTO erp_migration_log (id, migration_key, status, executed_at, remark)
    VALUES (@id, @migration_key, @status, @executed_at, @remark)
    ON CONFLICT(migration_key) DO UPDATE SET
      status = excluded.status,
      executed_at = excluded.executed_at,
      remark = excluded.remark
  `).run({
    id: createId("migration"),
    migration_key: migrationKey,
    status,
    executed_at: nowIso(),
    remark: String(remark || "").slice(0, 2000),
  });
}

function backupDatabaseIfNeeded(dbPath, options = {}) {
  if (options.backup === false) return null;
  if (!fs.existsSync(dbPath)) return null;

  const backupDir = options.backupDir || path.join(path.dirname(dbPath), "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `erp-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function runMigrations(options = {}) {
  const db = options.db || openErpDatabase(options);
  const shouldClose = !options.db;
  const dbPath = options.dbPath || db.__erpDbPath || getErpDatabasePath(options);

  try {
    ensureMigrationLog(db);
    const migrationFiles = listMigrationFiles(options);
    const pending = migrationFiles.filter((migration) => !hasSuccessfulMigration(db, migration.key));
    const backupPath = pending.length > 0 ? backupDatabaseIfNeeded(dbPath, options) : null;
    const results = [];

    for (const migration of migrationFiles) {
      if (hasSuccessfulMigration(db, migration.key)) {
        results.push({ key: migration.key, status: "skipped" });
        continue;
      }

      const sql = fs.readFileSync(migration.path, "utf8");
      const applyMigration = db.transaction(() => {
        db.exec(sql);
        writeMigrationLog(db, migration.key, "success", "");
      });

      try {
        applyMigration();
        results.push({ key: migration.key, status: "success" });
      } catch (error) {
        writeMigrationLog(db, migration.key, "failed", error?.message || String(error));
        error.message = `Migration ${migration.key} failed: ${error.message}`;
        throw error;
      }
    }

    return { dbPath, backupPath, migrations: results };
  } finally {
    if (shouldClose) db.close();
  }
}

module.exports = {
  ensureMigrationLog,
  listMigrationFiles,
  runMigrations,
};

