const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  getErpDatabasePath, openErpDatabase,
  queryOne, execute, execSql, execRawSql, withTransaction,
} = require("./connection.cjs");

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

async function ensureMigrationLog(db) {
  await execSql(db, MIGRATION_LOG_TABLE_SQL);
}

async function hasSuccessfulMigration(db, migrationKey) {
  const row = await queryOne(db,
    "SELECT status FROM erp_migration_log WHERE migration_key = ? AND status = 'success'",
    [migrationKey]);
  return Boolean(row);
}

async function writeMigrationLog(db, migrationKey, status, remark = "") {
  await execute(db, `
    INSERT INTO erp_migration_log (id, migration_key, status, executed_at, remark)
    VALUES (@id, @migration_key, @status, @executed_at, @remark)
    ON CONFLICT(migration_key) DO UPDATE SET
      status = excluded.status,
      executed_at = excluded.executed_at,
      remark = excluded.remark
  `, {
    id: createId("migration"),
    migration_key: migrationKey,
    status,
    executed_at: nowIso(),
    remark: String(remark || "").slice(0, 2000),
  });
}

function shouldRunWithoutWrapperTransaction(sql) {
  return /--\s*@no-transaction\b/i.test(sql);
}

function shouldRunIdempotent(sql) {
  return /--\s*@idempotent\b/i.test(sql);
}

function isIgnorableIdempotentError(message) {
  return /duplicate column name|already exists/i.test(String(message || ""));
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (next === "'") { current += next; i += 1; }
        else inString = false;
      }
      continue;
    }
    if (ch === "-" && next === "-") { inLineComment = true; current += ch; continue; }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function execStatementsIdempotently(db, sql) {
  for (const statement of splitSqlStatements(sql)) {
    if (!statement.replace(/--[^\n]*/g, "").trim()) continue;
    try {
      await execRawSql(db, statement);
    } catch (error) {
      if (isIgnorableIdempotentError(error && error.message)) continue;
      throw error;
    }
  }
}

function listAutoBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => /^erp-.*\.sqlite$/i.test(name))
    .map((name) => {
      const full = path.join(backupDir, name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch (_) {}
      return { name, full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneAutoBackups(backupDir, keep) {
  const limit = Math.max(0, keep);
  for (const file of listAutoBackups(backupDir).slice(limit)) {
    try { fs.unlinkSync(file.full); } catch (_) {}
  }
}

function resolveBackupKeep(options = {}) {
  if (Number.isInteger(options.backupKeep) && options.backupKeep >= 1) return options.backupKeep;
  const envKeep = parseInt(process.env.ERP_BACKUP_KEEP || "", 10);
  if (Number.isInteger(envKeep) && envKeep >= 1) return envKeep;
  return 3;
}

function backupDatabaseIfNeeded(dbPath, options = {}) {
  if (options.backup === false) return null;
  if (!fs.existsSync(dbPath)) return null;

  const backupDir = options.backupDir || path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const keep = resolveBackupKeep(options);
  pruneAutoBackups(backupDir, Math.max(0, keep - 1));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `erp-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, backupPath);

  pruneAutoBackups(backupDir, keep);
  return backupPath;
}

async function runMigrations(options = {}) {
  const db = options.db || openErpDatabase(options);
  const shouldClose = !options.db;
  const dbPath = options.dbPath || db.__erpDbPath || getErpDatabasePath(options);

  try {
    await ensureMigrationLog(db);
    const migrationFiles = listMigrationFiles(options);
    const pendingKeys = new Set();
    for (const mig of migrationFiles) {
      if (!(await hasSuccessfulMigration(db, mig.key))) pendingKeys.add(mig.key);
    }
    const backupPath = pendingKeys.size > 0 ? backupDatabaseIfNeeded(dbPath, options) : null;
    const results = [];

    for (const migration of migrationFiles) {
      if (!pendingKeys.has(migration.key)) {
        results.push({ key: migration.key, status: "skipped" });
        continue;
      }

      const sql = fs.readFileSync(migration.path, "utf8");
      const idempotent = shouldRunIdempotent(sql);

      try {
        if (shouldRunWithoutWrapperTransaction(sql)) {
          if (idempotent) await execStatementsIdempotently(db, sql);
          else await execRawSql(db, sql);
          await writeMigrationLog(db, migration.key, "success", "");
        } else {
          await withTransaction(db, async (txDb) => {
            if (idempotent) await execStatementsIdempotently(txDb, sql);
            else await execRawSql(txDb, sql);
            await writeMigrationLog(txDb, migration.key, "success", "");
          });
        }
        results.push({ key: migration.key, status: "success" });
      } catch (error) {
        await writeMigrationLog(db, migration.key, "failed", error?.message || String(error));
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
  backupDatabaseIfNeeded,
  pruneAutoBackups,
};
