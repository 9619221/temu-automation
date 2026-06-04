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

function shouldRunWithoutWrapperTransaction(sql) {
  return /--\s*@no-transaction\b/i.test(sql);
}

function shouldRunIdempotent(sql) {
  return /--\s*@idempotent\b/i.test(sql);
}

// 仅吞掉「对象已存在」类幂等错误（重复加列 / 表或索引已存在），其余照常抛出
function isIgnorableIdempotentError(message) {
  return /duplicate column name|already exists/i.test(String(message || ""));
}

// 按分号拆分 SQL，跳过单引号字符串与 -- 行注释里的分号
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

// @idempotent 迁移逐语句执行：单条遇「已存在」类错误跳过，其余抛出
function execStatementsIdempotently(db, sql) {
  for (const statement of splitSqlStatements(sql)) {
    if (!statement.replace(/--[^\n]*/g, "").trim()) continue;
    try {
      db.exec(statement);
    } catch (error) {
      if (isIgnorableIdempotentError(error && error.message)) continue;
      throw error;
    }
  }
}

// 列出 backups/ 目录下的自动备份文件（erp-<时间戳>.sqlite），按修改时间从新到旧排序。
// 只认 "erp-" 前缀，不会误伤主库 erp.sqlite 或手工快照 erp.sqlite.PRE-* / erp.sqlite.CORRUPT-*。
function listAutoBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => /^erp-.*\.sqlite$/i.test(name))
    .map((name) => {
      const full = path.join(backupDir, name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch (_) { /* stat 失败按最旧处理 */ }
      return { name, full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// 只保留最近 keep 份自动备份，删除更旧的。清理失败不影响主流程。
function pruneAutoBackups(backupDir, keep) {
  const limit = Math.max(0, keep);
  for (const file of listAutoBackups(backupDir).slice(limit)) {
    try { fs.unlinkSync(file.full); } catch (_) { /* 删除失败忽略 */ }
  }
}

// 解析自动备份保留份数：options.backupKeep > 环境变量 ERP_BACKUP_KEEP > 默认 3。
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

  // 备份前先清理旧备份，给新备份腾出空间（先收到 keep-1 份，加上即将生成的共 keep 份）。
  // erp.sqlite 已数 GB，整库 copy 若撞 ENOSPC 会让迁移失败、服务进 restart loop，故先腾空间。
  const keep = resolveBackupKeep(options);
  pruneAutoBackups(backupDir, Math.max(0, keep - 1));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `erp-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, backupPath);

  // copy 成功后再校正一次，确保最终恰好保留 keep 份。
  pruneAutoBackups(backupDir, keep);
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
      const runSql = shouldRunIdempotent(sql)
        ? () => execStatementsIdempotently(db, sql)
        : () => db.exec(sql);

      try {
        if (shouldRunWithoutWrapperTransaction(sql)) {
          runSql();
          writeMigrationLog(db, migration.key, "success", "");
        } else {
          const applyMigration = db.transaction(() => {
            runSql();
            writeMigrationLog(db, migration.key, "success", "");
          });
          applyMigration();
        }
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
  backupDatabaseIfNeeded,
  pruneAutoBackups,
};
