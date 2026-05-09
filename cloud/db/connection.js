import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../data"));
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "temu-cloud.sqlite");
  dbInstance = new Database(dbPath);
  dbInstance.pragma("foreign_keys = ON");
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("synchronous = NORMAL");
  dbInstance.pragma("busy_timeout = 5000");
  console.log(`[db] opened ${dbPath}`);
  return dbInstance;
}

export function closeDb() {
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
}
