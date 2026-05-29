// 一次性回填脚本：扫历史 capture_events 走 parser dispatcher，
// 把已有数据填进 skc_snapshots / mall_accounts。
//
// 用法：node scripts/backfill-parsers.js [--tenant=<id>] [--limit=<n>] [--since=<ts_ms>]

import { getDb } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { dispatchParsers } from "../parsers.js";

migrate();
const db = getDb();

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.+)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  })
);

const where = ["1=1"];
const params = [];
if (args.tenant) { where.push("tenant_id = ?"); params.push(args.tenant); }
if (args.since) { where.push("ts >= ?"); params.push(Number(args.since)); }
const limit = Number(args.limit) || 50000;

const rows = db.prepare(`
  SELECT id, tenant_id, device_id, mall_id, site, page, url_path, body_json, ts
  FROM capture_events
  WHERE ${where.join(" AND ")}
  ORDER BY ts ASC
  LIMIT ?
`).all(...params, limit);

console.log(`[backfill] scanning ${rows.length} events...`);

// 按 (tenant_id, device_id) 分组喂给 dispatchParsers，保留 ctx 上下文
const groups = new Map();
for (const r of rows) {
  const key = `${r.tenant_id}::${r.device_id || ""}`;
  if (!groups.has(key)) groups.set(key, { tenant_id: r.tenant_id, device_id: r.device_id, items: [] });
  groups.get(key).items.push({
    id: r.id,
    url_path: r.url_path,
    page: r.page,
    body_json: r.body_json,
    ts: r.ts,
    mall_id: r.mall_id,
    site: r.site,
  });
}

let processed = 0;
for (const [key, g] of groups) {
  dispatchParsers(db, { tenant_id: g.tenant_id, device_id: g.device_id }, g.items);
  processed += g.items.length;
  console.log(`[backfill] ${key}: ${g.items.length} events`);
}

function countTable(name) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n; }
  catch { return "(no table)"; }
}

console.log(`\n[backfill] done. processed=${processed} events`);
console.log(`  skc_snapshots:          ${countTable("skc_snapshots")} rows`);
console.log(`  mall_accounts:          ${countTable("mall_accounts")} rows`);
console.log(`  temu_sales_snapshot:    ${countTable("temu_sales_snapshot")} rows`);
console.log(`  temu_stock_order_snapshot: ${countTable("temu_stock_order_snapshot")} rows`);
console.log(`  temu_jit_status_snapshot:  ${countTable("temu_jit_status_snapshot")} rows`);
console.log(`  temu_review_snapshot:   ${countTable("temu_review_snapshot")} rows`);
