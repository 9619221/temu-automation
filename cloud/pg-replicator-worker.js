// ============================================================
// PG 增量复制 worker 线程（被 pg-replicator.js 拉起）
// 为什么在 worker：capture_events.body_json 单条可达 200KB，一批几百条的同步
// 读取会把主线程事件循环堵死几十秒（2026-07-23 首次主线程方案实测翻车，
// 与 2026-07-08 采集落库堵主线程同型事故）。本线程卡死只卡自己。
// 表清单/游标/幂等 upsert 语义对齐 scripts/mirror-cloud-to-pg.cjs：
// - 游标存 PG 侧（MAX(cursor) 动态推导，无状态表）
// - keyset 分页 (cursor, rowid) 双键推进，起点 >= 宁可重读靠 upsert 去重
// - 只写两侧公共列；PG 无表或无主键则跳过该表
// ============================================================
import { parentPort, workerData } from "node:worker_threads";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// numeric=true 游标列是毫秒整数；full=true 小字典表每轮全量 upsert（10 分钟节流）
// capture_events batch 压到 100：body_json 大，控住单批内存与 PG 语句体积
const TABLES = [
  { name: "devices", full: true },
  { name: "mall_accounts", full: true },
  { name: "tenants", full: true },
  { name: "capture_events", cursor: "received_at", numeric: true, batch: 100 },
  { name: "temu_sales_snapshot", cursor: "last_updated_at" },
  { name: "temu_shop_stats", cursor: "last_updated_at" },
  { name: "skc_snapshots", cursor: "last_updated_at" },
  { name: "temu_sku_sales_trend", cursor: "last_updated_at" },
  { name: "temu_product_flow_snapshot", cursor: "last_updated_at" },
  { name: "temu_product_flow_trend", cursor: "last_updated_at" },
  { name: "temu_activity_snapshot", cursor: "last_updated_at" },
  { name: "temu_activity_enroll_record", cursor: "last_updated_at" },
  { name: "temu_stock_order_snapshot", cursor: "last_updated_at" },
  { name: "temu_after_sale_snapshot", cursor: "last_updated_at" },
  { name: "temu_operation_risk_snapshot", cursor: "last_updated_at" },
  { name: "temu_goods_data_snapshot", cursor: "last_updated_at" },
];

const DEFAULT_BATCH = 500;
const DEBOUNCE_MS = 500;
const FALLBACK_INTERVAL_MS = 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 300_000;
const FULL_TABLE_INTERVAL_MS = 600_000;

const pgUrl = workerData?.pgUrl || process.env.PG_MIRROR_URL || "";
if (!pgUrl) {
  // 理论上主线程未配置时不会拉起本 worker，双保险
  console.log("[pg-replicator] worker 无 PG 连接串，退出");
  process.exit(0);
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const dbPath = path.join(dataDir, "temu-cloud.sqlite");
if (!fs.existsSync(dbPath)) {
  console.error(`[pg-replicator] sqlite 不存在: ${dbPath}`);
  process.exit(1);
}
const sqlite = new Database(dbPath, { readonly: true });
sqlite.pragma("busy_timeout = 15000");
const pool = new pg.Pool({
  connectionString: pgUrl,
  max: 2,
  connectionTimeoutMillis: 10_000,   // 连接排队上限：拿不到连接就报错进退避，不许无限等
  statement_timeout: 120_000,        // 单条语句上限：大批量 upsert 卡住时报错而不是永久悬挂
  query_timeout: 150_000,
});

let running = false;
let rerun = false;
let debounceTimer = null;
let backoffMs = 0;
let backoffUntil = 0;
let lastFullSyncAt = 0;
let firstRound = true; // 首轮逐表打点，定位启动期卡点
const metaCache = new Map();

async function pgTableMeta(table) {
  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    [table]
  );
  const pk = await pool.query(
    `SELECT a.attname FROM pg_index i
       JOIN unnest(i.indkey) WITH ORDINALITY AS x(attnum, n) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = x.attnum
      WHERE i.indrelid = ('public.' || quote_ident($1))::regclass AND i.indisprimary
      ORDER BY x.n`,
    [table]
  );
  return {
    columns: cols.rows.map((r) => r.column_name),
    types: Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type])),
    pk: pk.rows.map((r) => r.attname),
  };
}

function coerce(value, dataType) {
  if (value === undefined || value === null) return null;
  if (dataType === "boolean") return value === 1 || value === true || value === "1";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return value;
}

async function upsertBatch(table, cols, pk, types, rows) {
  if (!rows.length) return 0;
  const nonPk = cols.filter((c) => !pk.includes(c));
  const values = [];
  const tuples = rows.map((row, ri) => {
    const ph = cols.map((c, ci) => {
      values.push(coerce(row[c], types[c]));
      return `$${ri * cols.length + ci + 1}`;
    });
    return `(${ph.join(",")})`;
  });
  const conflict = nonPk.length
    ? `DO UPDATE SET ${nonPk.map((c) => `${c} = excluded.${c}`).join(", ")}`
    : "DO NOTHING";
  await pool.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}
     ON CONFLICT (${pk.join(",")}) ${conflict}`,
    values
  );
  return rows.length;
}

async function tableMetaCached(table) {
  if (metaCache.has(table)) return metaCache.get(table);
  const meta = await pgTableMeta(table);
  let usable = null;
  if (meta.columns.length && meta.pk.length) {
    const sqliteCols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
    const cols = meta.columns.filter((c) => sqliteCols.includes(c));
    if (cols.length) usable = { cols, pk: meta.pk, types: meta.types };
    else console.warn(`[pg-replicator] ${table}: 无公共列，跳过`);
  } else {
    console.warn(`[pg-replicator] ${table}: PG 侧无表或无主键，跳过`);
  }
  metaCache.set(table, usable);
  return usable;
}

async function replicateTable(spec) {
  const meta = await tableMetaCached(spec.name);
  if (!meta) return 0;
  if (firstRound) console.log(`[pg-replicator] ${spec.name}: 开始首轮`);
  const { cols, pk, types } = meta;
  const batch = spec.batch || DEFAULT_BATCH;
  let total = 0;

  if (spec.full) {
    const rows = sqlite.prepare(`SELECT ${cols.join(",")} FROM ${spec.name}`).all();
    for (let i = 0; i < rows.length; i += batch) {
      total += await upsertBatch(spec.name, cols, pk, types, rows.slice(i, i + batch));
    }
    return total;
  }

  const sinceRow = await pool.query(`SELECT MAX(${spec.cursor}) AS c FROM ${spec.name}`);
  let since = sinceRow.rows[0]?.c;
  if (since === null || since === undefined) since = spec.numeric ? 0 : "";
  if (spec.numeric) since = Number(since);

  let lastCursor = since;
  let lastRowid = -1;
  let firstPass = true;
  let batches = 0;
  // 每轮每表限 50 批：洪峰期追不到尾时保证「轮」能收口（打日志、让 rerun 续追），
  // 否则一轮永不结束、外部完全无观测（2026-07-23 实测教训）
  const MAX_BATCHES_PER_ROUND = 50;
  for (;;) {
    if (batches >= MAX_BATCHES_PER_ROUND) { rerun = true; break; }
    const rows = firstPass
      ? sqlite.prepare(
          `SELECT rowid AS __rid, ${cols.join(",")} FROM ${spec.name}
            WHERE ${spec.cursor} >= ? ORDER BY ${spec.cursor}, rowid LIMIT ?`
        ).all(lastCursor, batch)
      : sqlite.prepare(
          `SELECT rowid AS __rid, ${cols.join(",")} FROM ${spec.name}
            WHERE ${spec.cursor} > ? OR (${spec.cursor} = ? AND rowid > ?)
            ORDER BY ${spec.cursor}, rowid LIMIT ?`
        ).all(lastCursor, lastCursor, lastRowid, batch);
    if (!rows.length) break;
    const last = rows[rows.length - 1];
    lastCursor = last[spec.cursor];
    lastRowid = last.__rid;
    firstPass = false;
    for (const r of rows) delete r.__rid;
    total += await upsertBatch(spec.name, cols, pk, types, rows);
    batches++;
    if (batches % 10 === 0) console.log(`[pg-replicator] ${spec.name}: ${total} rows so far (batch ${batches})`);
    if (rows.length < batch) break;
  }
  return total;
}

async function runOnce() {
  const t0 = Date.now();
  const includeFull = t0 - lastFullSyncAt >= FULL_TABLE_INTERVAL_MS;
  let total = 0;
  for (const spec of TABLES) {
    if (spec.full && !includeFull) continue;
    total += await replicateTable(spec);
  }
  if (includeFull) lastFullSyncAt = t0;
  firstRound = false;
  if (total > 0) {
    let lag = 0;
    try {
      const sqMax = sqlite.prepare("SELECT COALESCE(MAX(received_at),0) AS m FROM capture_events").get().m;
      const pgMax = (await pool.query("SELECT COALESCE(MAX(received_at),0) AS m FROM capture_events")).rows[0].m;
      lag = Math.max(0, Number(sqMax) - Number(pgMax));
    } catch { /* lag 仅观测用 */ }
    console.log(`[pg-replicator] synced ${total} rows in ${Date.now() - t0}ms, lag=${lag}ms`);
  }
}

async function pump() {
  if (running) { rerun = true; return; }
  if (Date.now() < backoffUntil) return;
  running = true;
  rerun = false;
  try {
    await runOnce();
    backoffMs = 0;
  } catch (e) {
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : BACKOFF_BASE_MS, BACKOFF_MAX_MS);
    backoffUntil = Date.now() + backoffMs;
    metaCache.clear();
    console.warn(`[pg-replicator] sync failed (${e?.message}), backoff ${backoffMs}ms`);
  } finally {
    running = false;
    if (rerun) scheduleDebounced();
  }
}

function scheduleDebounced() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pump().catch((e) => console.error("[pg-replicator] pump error:", e?.message));
  }, DEBOUNCE_MS);
}

parentPort.on("message", (msg) => {
  if (msg === "ingest") scheduleDebounced();
});

setInterval(() => {
  pump().catch((e) => console.error("[pg-replicator] pump error:", e?.message));
}, FALLBACK_INTERVAL_MS);

console.log("[pg-replicator] worker started (debounce 500ms, fallback 60s, capture batch 100)");
scheduleDebounced(); // 启动即追存量
