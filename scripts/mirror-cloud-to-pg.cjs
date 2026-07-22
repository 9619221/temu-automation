// cloud sqlite（HK /opt/temu-cloud/data/temu-cloud.sqlite）→ PG public 镜像同步。
// 背景：ERP 迁 PG 后，代码里的 `cloud.` 前缀在 PG 侧被剥掉、直接读 public 同名表，
// 但迁库只做了一次性导入（数据停在 2026-06-25），没有持续搬运通道——本脚本补上它。
// HK 服务器 cron：本地读 cloud.sqlite，内网写 PG（同 refresh-reviews-pg.cjs 模式）。
// */10 * * * * cd /opt/temu-automation && flock -n /tmp/mirror-cloud-pg.lock node scripts/mirror-cloud-to-pg.cjs >> /var/log/temu-cloud-mirror.log 2>&1
"use strict";
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const CLOUD_DB = process.env.TEMU_CLOUD_DB_PATH || "/opt/temu-cloud/data/temu-cloud.sqlite";
const PG_URL = process.env.PG_CONNECTION_STRING || "postgresql://erp_app:ErpCluster2026!@10.5.0.12:5432/erp_production";

// numeric=true 表示游标列是毫秒整数；full=true 表示小字典表每次全量 upsert。
const TABLES = [
  { name: "devices", full: true },
  { name: "mall_accounts", full: true },
  { name: "tenants", full: true },
  { name: "capture_events", cursor: "received_at", numeric: true, batch: 300 },
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

const DEFAULT_BATCH = 1000;

async function pgTableMeta(pg, table) {
  const cols = await pg.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    [table]
  );
  const pk = await pg.query(
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
  if (value === undefined) return null;
  if (value === null) return null;
  if (dataType === "boolean") return value === 1 || value === true || value === "1";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return value;
}

async function upsertBatch(pg, table, cols, pk, types, rows) {
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
  await pg.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}
     ON CONFLICT (${pk.join(",")}) ${conflict}`,
    values
  );
  return rows.length;
}

async function mirrorTable(cloud, pg, spec) {
  const meta = await pgTableMeta(pg, spec.name);
  if (!meta.columns.length || !meta.pk.length) {
    console.log(`  ${spec.name}: PG 侧无表或无主键，跳过`);
    return 0;
  }
  const sqliteCols = cloud.prepare(`PRAGMA table_info(${spec.name})`).all().map((r) => r.name);
  const cols = meta.columns.filter((c) => sqliteCols.includes(c));
  if (!cols.length) {
    console.log(`  ${spec.name}: 无公共列，跳过`);
    return 0;
  }
  const batch = spec.batch || DEFAULT_BATCH;
  let total = 0;

  if (spec.full) {
    const rows = cloud.prepare(`SELECT ${cols.join(",")} FROM ${spec.name}`).all();
    for (let i = 0; i < rows.length; i += batch) {
      total += await upsertBatch(pg, spec.name, cols, meta.pk, meta.types, rows.slice(i, i + batch));
    }
    return total;
  }

  const sinceRow = await pg.query(`SELECT MAX(${spec.cursor}) AS c FROM ${spec.name}`);
  let since = sinceRow.rows[0]?.c;
  if (since === null || since === undefined) since = spec.numeric ? 0 : "";
  if (spec.numeric) since = Number(since);

  // keyset 分页：(cursor, rowid) 双键推进；起点用 >=（宁可重读一批，靠 upsert 幂等去重）
  let lastCursor = since;
  let lastRowid = -1;
  let firstPass = true;
  for (;;) {
    const rows = firstPass
      ? cloud.prepare(
          `SELECT rowid AS __rid, ${cols.join(",")} FROM ${spec.name}
            WHERE ${spec.cursor} >= ? ORDER BY ${spec.cursor}, rowid LIMIT ?`
        ).all(lastCursor, batch)
      : cloud.prepare(
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
    total += await upsertBatch(pg, spec.name, cols, meta.pk, meta.types, rows);
    if (rows.length < batch) break;
  }
  return total;
}

(async () => {
  const t0 = Date.now();
  const cloud = new Database(CLOUD_DB, { readonly: true });
  const pg = new Pool({ connectionString: PG_URL, max: 2 });
  const summary = [];
  let failed = false;
  try {
    for (const spec of TABLES) {
      try {
        const n = await mirrorTable(cloud, pg, spec);
        if (n > 0) summary.push(`${spec.name}=${n}`);
      } catch (error) {
        failed = true;
        console.error(`  ${spec.name}: FAILED ${error.message}`);
      }
    }
    console.log(
      new Date().toISOString(),
      `cloud→PG mirror: ${summary.length ? summary.join(" ") : "0 new rows"} in ${Date.now() - t0}ms`
    );
  } finally {
    await pg.end();
    cloud.close();
  }
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error("mirror-cloud-to-pg fatal:", error);
  process.exit(1);
});
