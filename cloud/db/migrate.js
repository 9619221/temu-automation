import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (id) VALUES (?)").run(f);
      db.exec("COMMIT");
      console.log(`[migrate] applied ${f}`);
      ran++;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { ran, total: files.length };
}
