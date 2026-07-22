import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance = null;
let walCheckpointTimer = null;

// WAL 卫生：定时 TRUNCATE checkpoint，控住 WAL 体积（曾涨到 88MB，长读会压着 WAL 不截断）。
// 用 unref 不阻止进程退出；TRUNCATE 把已 checkpoint 的 WAL 物理截回 0。失败容错不抛。
function startWalCheckpoint(db) {
  if (walCheckpointTimer) return;
  walCheckpointTimer = setInterval(() => {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (e) {
      console.warn("[db] wal_checkpoint failed:", e?.message);
    }
  }, 60_000);
  if (typeof walCheckpointTimer.unref === "function") walCheckpointTimer.unref();
}

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
  startWalCheckpoint(dbInstance);
  console.log(`[db] opened ${dbPath}`);
  return dbInstance;
}

export function closeDb() {
  if (walCheckpointTimer) { clearInterval(walCheckpointTimer); walCheckpointTimer = null; }
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
}
