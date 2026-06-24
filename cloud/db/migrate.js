import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    if (inLineComment) { current += ch; if (ch === "\n") inLineComment = false; continue; }
    if (inString) { current += ch; if (ch === "'") { if (next === "'") { current += next; i += 1; } else inString = false; } continue; }
    if (ch === "-" && next === "-") { inLineComment = true; current += ch; continue; }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === ";") { if (current.trim()) statements.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function execStatementsIdempotently(db, sql) {
  for (const statement of splitSqlStatements(sql)) {
    if (!statement.replace(/--[^\n]*/g, "").trim()) continue;
    try { db.exec(statement); } catch (error) {
      if (isIgnorableIdempotentError(error && error.message)) continue;
      throw error;
    }
  }
}

export function migrate() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare("SELECT id FROM migrations").all().map((r) => r.id));
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const idempotent = shouldRunIdempotent(sql);
    db.exec("BEGIN");
    try {
      if (idempotent) execStatementsIdempotently(db, sql);
      else db.exec(sql);
      db.prepare("INSERT INTO migrations (id) VALUES (?)").run(f);
      db.exec("COMMIT");
      console.log(`[migrate] applied ${f}${idempotent ? " (idempotent)" : ""}`);
      ran++;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { ran, total: files.length };
}
