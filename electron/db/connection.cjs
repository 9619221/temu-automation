const fs = require("fs");
const os = require("os");
const path = require("path");

const USE_PG = !!process.env.PG_CONNECTION_STRING;

// ─── SQLite (桌面端 / 本地开发) ───

let Database;
if (!USE_PG) {
  Database = require("better-sqlite3");
}

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
  if (USE_PG) return createPgDb();

  const dbPath = getErpDatabasePath(options);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -131072");
  db.pragma("mmap_size = 2147483648");
  if (process.env.ERP_WAL_AUTOCHECKPOINT === "0") {
    db.pragma("wal_autocheckpoint = 0");
  }
  db.__erpDbPath = dbPath;
  return db;
}

function openErpDatabaseReadonly(dbPathOrOptions = {}) {
  if (USE_PG) return createPgDb();

  const dbPath = typeof dbPathOrOptions === "string"
    ? dbPathOrOptions
    : getErpDatabasePath(dbPathOrOptions);
  const db = new Database(dbPath, { readonly: true });
  db.pragma("query_only = ON");
  db.pragma("busy_timeout = 3000");
  db.pragma("cache_size = -65536");
  db.pragma("mmap_size = 2147483648");
  db.__erpDbPath = dbPath;
  return db;
}

// ─── PostgreSQL 连接池 ───

const { Pool } = USE_PG ? require("pg") : {};

let _pgPool = null;

function getPgPool() {
  if (_pgPool) return _pgPool;
  _pgPool = new Pool({
    connectionString: process.env.PG_CONNECTION_STRING,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  _pgPool.on("error", (err) => {
    console.error("[PG Pool] unexpected error:", err.message);
  });
  return _pgPool;
}

function createPgDb() {
  const pool = getPgPool();
  const masked = (process.env.PG_CONNECTION_STRING || "").replace(/:[^:@]*@/, ":***@");
  return {
    __isPg: true,
    __pgTarget: pool,
    __pool: pool,
    __erpDbPath: `pg:${masked}`,
    close() {},
    pragma() {},
    backup() { return Promise.resolve(); },
  };
}

// ─── SQL 翻译 (SQLite → PG) ───

function _replaceBalanced(sql, funcName, replacer) {
  let result = "";
  let remaining = sql;
  const pattern = new RegExp("\\b" + funcName + "\\s*\\(", "i");
  for (;;) {
    const m = pattern.exec(remaining);
    if (!m) { result += remaining; break; }
    result += remaining.substring(0, m.index);
    const after = m.index + m[0].length;
    let depth = 1, i = after, inStr = false;
    while (i < remaining.length && depth > 0) {
      const ch = remaining[i];
      if (inStr) { if (ch === "'") inStr = false; }
      else if (ch === "'") inStr = true;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth > 0) i++; else break;
    }
    if (depth !== 0) { result += m[0]; remaining = remaining.substring(after); continue; }
    result += replacer(remaining.substring(after, i).trim());
    remaining = remaining.substring(i + 1);
  }
  return result;
}

function _splitAtTopComma(s) {
  let depth = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (ch === "'") inStr = false; continue; }
    if (ch === "'") { inStr = true; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) return [s.substring(0, i).trim(), s.substring(i + 1).trim()];
  }
  return [s.trim()];
}

function translateSqlSyntax(sql) {
  let s = sql;

  // --- JSON ---
  s = _replaceBalanced(s, "json_extract", inner => {
    const parts = _splitAtTopComma(inner);
    if (parts.length !== 2) return `json_extract(${inner})`;
    const col = parts[0].trim();
    const pathRaw = parts[1].trim().replace(/^'|'$/g, "");
    if (/^\$\.(\w+)$/.test(pathRaw)) {
      return `(${col})::jsonb->>'${pathRaw.slice(2)}'`;
    }
    if (/^\$\[(\d+)\]\.(\w+)$/.test(pathRaw)) {
      const m = pathRaw.match(/^\$\[(\d+)\]\.(\w+)$/);
      return `(${col})::jsonb -> ${m[1]} ->> '${m[2]}'`;
    }
    const segs = pathRaw.replace(/^\$\.?/, "").split(/\./).map(seg => {
      const arrM = seg.match(/^(\w*)\[(\d+)\]$/);
      if (arrM) return arrM[1] ? [arrM[1], arrM[2]] : [arrM[2]];
      return [seg];
    }).flat();
    const last = segs.pop();
    const chain = segs.map(seg => /^\d+$/.test(seg) ? ` -> ${seg}` : ` -> '${seg}'`).join("");
    return `(${col})::jsonb${chain} ->> '${last}'`;
  });
  s = s.replace(/\bjson_group_array\s*\(/gi, "jsonb_agg(");
  s = s.replace(/\bjson_object\s*\(/gi, "jsonb_build_object(");
  s = _replaceBalanced(s, "json_each", inner =>
    `jsonb_array_elements((${inner})::jsonb)`);

  // --- 聚合（用 _replaceBalanced 处理嵌套括号如 CASE/子查询） ---
  s = _replaceBalanced(s, "GROUP_CONCAT", inner => {
    const parts = _splitAtTopComma(inner);
    const sep = parts.length >= 2 ? parts[1].trim() : "','";
    let expr = parts[0].trim();
    const distinctMatch = expr.match(/^DISTINCT\s+/i);
    if (distinctMatch) {
      expr = expr.substring(distinctMatch[0].length);
      return `string_agg(DISTINCT (${expr})::text, ${sep})`;
    }
    return `string_agg((${expr})::text, ${sep})`;
  });

  // --- 标量 MAX/MIN（多参数）→ GREATEST/LEAST ---
  s = _replaceBalanced(s, "MAX", inner => {
    const parts = _splitAtTopComma(inner);
    return parts.length >= 2 ? `GREATEST(${inner})` : `MAX(${inner})`;
  });
  s = _replaceBalanced(s, "MIN", inner => {
    const parts = _splitAtTopComma(inner);
    return parts.length >= 2 ? `LEAST(${inner})` : `MIN(${inner})`;
  });

  // --- NULL ---
  s = s.replace(/IFNULL\(/gi, "COALESCE(");

  // --- 日期时间（先特殊后通用，避免误翻） ---
  s = s.replace(/\bdatetime\(\s*'now'\s*\)/gi, "NOW()");
  s = _replaceBalanced(s, "datetime", inner => `(${inner})::timestamp`);

  s = s.replace(/\bjulianday\(\s*'now'\s*\)/gi,
    "EXTRACT(EPOCH FROM NOW()) / 86400.0");
  s = _replaceBalanced(s, "julianday", inner =>
    `EXTRACT(EPOCH FROM (${inner})::timestamp) / 86400.0`);

  s = _replaceBalanced(s, "date", inner => {
    const args = _splitAtTopComma(inner);
    if (args.length === 1) return `(${args[0]})::date`;
    const [expr, mod] = args;
    if (/^'now'$/i.test(expr) && /^'localtime'$/i.test(mod))
      return "(NOW() AT TIME ZONE 'Asia/Shanghai')::date";
    const nowDays = mod.match(/^'([+-]?\d+)\s*days?'$/i);
    if (/^'now'$/i.test(expr) && nowDays)
      return `(CURRENT_DATE + INTERVAL '${nowDays[1]} days')`;
    if (/^'localtime'$/i.test(mod))
      return `((${expr})::timestamp AT TIME ZONE 'Asia/Shanghai')::date`;
    const days = mod.match(/^'([+-]?\d+)\s*days?'$/i);
    if (days) return `((${expr})::date + INTERVAL '${days[1]} days')`;
    if (/^'now'$/i.test(expr))
      return `(CURRENT_DATE + (${mod})::interval)`;
    return `(${expr})::date`;
  });

  // --- 模式匹配 ---
  s = s.replace(/\bGLOB\s+'\[0-9\]\*'/g, "~ '^[0-9]+'");
  s = s.replace(/\bGLOB\s+'\[0-9\]\[0-9\]\[0-9\]\[0-9\]\[0-9\]\[0-9\]'/g,
    () => "~ '^[0-9]{6}$'");

  // --- LIKE → ILIKE ---
  s = s.replace(/\bLIKE\b/g, "ILIKE");

  // --- ATTACH 前缀 ---
  s = s.replace(/\bcloud\./gi, "");

  // --- DDL: SQLite AUTOINCREMENT → PG GENERATED BY DEFAULT AS IDENTITY ---
  s = s.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
    "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY");

  // --- PG 保留字 user 做表别名 → 加引号 ---
  s = s.replace(/\b(FROM|JOIN)\s+erp_users\s+user\b/gi, '$1 erp_users "user"');
  if (/erp_users\s+"user"/i.test(s)) {
    s = s.replace(/\buser\./g, '"user".');
  }

  // --- ON CONFLICT DO UPDATE SET 中的裸列名歧义 ---
  const insertMatch = s.match(/INSERT\s+INTO\s+(\w+)/i);
  if (insertMatch) {
    const tbl = insertMatch[1];
    s = s.replace(
      /COALESCE\(excluded\.(\w+),\s*(?!excluded\.|[\w]+\.)(\w+)\)/gi,
      (m, col1, col2) => col1.toLowerCase() === col2.toLowerCase()
        ? `COALESCE(excluded.${col1}, ${tbl}.${col2})`
        : m
    );
    // COALESCE(@param, bareCol) — @param 绑定参数 + 裸列名同样歧义
    s = s.replace(
      /COALESCE\((@\w+),\s*(?!excluded\.|[\w]+\.)([a-zA-Z_]\w*)\)/gi,
      (_m, param, col) => `COALESCE(${param}, ${tbl}.${col})`
    );
  }

  return s;
}

function prepareForPg(sql, params) {
  let s = translateSqlSyntax(sql);
  let p;

  // 自动修正 [objectParams] 模式：批量转换工具把 .all(obj) 转成了 queryAll(db, sql, [obj])
  let effectiveParams = params;
  if (Array.isArray(params) && params.length === 1 && params[0] && typeof params[0] === "object" && !Array.isArray(params[0]) && /@\w+/.test(sql)) {
    effectiveParams = params[0];
  }

  if (effectiveParams && !Array.isArray(effectiveParams) && typeof effectiveParams === "object") {
    // @name 命名参数 → $N 位置参数
    const names = [];
    s = s.replace(/@(\w+)/g, (_match, name) => {
      let idx = names.indexOf(name);
      if (idx === -1) { names.push(name); idx = names.length - 1; }
      return `$${idx + 1}`;
    });
    p = names.map((n) => effectiveParams[n]);
  } else {
    // ? 位置参数 → $N
    let i = 0;
    s = s.replace(/\?/g, () => `$${++i}`);
    p = Array.isArray(effectiveParams) ? effectiveParams : [];
  }

  // PG 无法推断 $N IS NULL 中 null 参数的类型 → 加 ::text 强转
  s = s.replace(/\$(\d+)\s+IS\s+NULL/gi, '$$$1::text IS NULL');
  s = s.replace(/\$(\d+)\s+IS\s+NOT\s+NULL/gi, '$$$1::text IS NOT NULL');

  // PG 不允许多余参数：如果翻译后的 SQL 没有 $N，清空 params
  if (p.length > 0 && !/\$\d/.test(s)) p = [];

  return { sql: s, params: p };
}

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ─── 统一 Async 查询接口 ───
// 同时支持 SQLite (better-sqlite3) 和 PG (pg Pool/Client)
// 调用端统一 await queryAll(db, sql, [params])

async function queryAll(db, sql, params = []) {
  if (db.__isPg) {
    const pg = prepareForPg(sql, params);
    const result = await db.__pgTarget.query(pg.sql, pg.params);
    return result.rows;
  }
  if (!Array.isArray(params) && typeof params === "object") {
    return db.prepare(sql).all(params);
  }
  return db.prepare(sql).all(...params);
}

async function queryOne(db, sql, params = []) {
  const rows = await queryAll(db, sql, params);
  return rows[0] || undefined;
}

async function execute(db, sql, params = []) {
  if (db.__isPg) {
    const pg = prepareForPg(sql, params);
    const result = await db.__pgTarget.query(pg.sql, pg.params);
    return { changes: result.rowCount, lastInsertRowid: 0 };
  }
  if (!Array.isArray(params) && typeof params === "object") {
    return db.prepare(sql).run(params);
  }
  return db.prepare(sql).run(...params);
}

async function execSql(db, sql) {
  if (db.__isPg) {
    const pg = prepareForPg(sql, {});
    await db.__pgTarget.query(pg.sql);
  } else {
    db.exec(sql);
  }
}

async function withTransaction(db, fn) {
  if (db.__isPg) {
    const client = await db.__pool.connect();
    const txDb = {
      __isPg: true,
      __pgTarget: client,
      __pool: db.__pool,
      __erpDbPath: db.__erpDbPath,
    };
    try {
      await client.query("BEGIN");
      const result = await fn(txDb);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } else {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(db);
      db.exec("COMMIT");
      return result;
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch {}
      throw e;
    }
  }
}

async function tableHasColumn(db, tableName, columnName) {
  if (!/^[a-z0-9_]+$/i.test(tableName)) return false;
  if (db.__isPg) {
    const rows = await queryAll(db,
      "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
      [tableName, columnName]);
    return rows.length > 0;
  }
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName);
}

async function getTableColumns(db, tableName) {
  if (!/^[a-z0-9_]+$/i.test(tableName)) return [];
  if (db.__isPg) {
    return (await queryAll(db,
      "SELECT column_name AS name FROM information_schema.columns WHERE table_name = ? AND table_schema = 'public' ORDER BY ordinal_position",
      [tableName])).map(r => r.name);
  }
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(r => r.name);
}

async function tableExists(db, tableName) {
  if (!/^[a-z0-9_]+$/i.test(tableName)) return false;
  if (db.__isPg) {
    const row = await queryOne(db,
      "SELECT 1 FROM information_schema.tables WHERE table_name = ? AND table_schema = 'public'",
      [tableName]);
    return !!row;
  }
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
}

async function execRawSql(db, sql) {
  if (db.__isPg) {
    await db.__pgTarget.query(sql);
  } else {
    db.exec(sql);
  }
}

async function closePgPool() {
  if (_pgPool) {
    await _pgPool.end();
    _pgPool = null;
  }
}

module.exports = {
  getDefaultUserDataDir,
  getErpDataDir,
  getErpDatabasePath,
  openErpDatabase,
  openErpDatabaseReadonly,
  USE_PG,
  getPgPool,
  convertPlaceholders,
  translateSqlSyntax,
  prepareForPg,
  queryAll,
  queryOne,
  execute,
  execSql,
  withTransaction,
  tableHasColumn,
  getTableColumns,
  tableExists,
  execRawSql,
  closePgPool,
};
