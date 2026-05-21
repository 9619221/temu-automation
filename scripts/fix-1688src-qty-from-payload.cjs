#!/usr/bin/env node
/**
 * 一次性修数据:从 erp_sku_1688_sources.source_payload_json 里反推聚水潭原版
 * base_qty / pack_qty / plat_map_qty,重算 our_qty / platform_qty 写回。
 *
 * 背景:scripts/jushuitan-1688map-import.cjs 旧版 intOr() 把 null 当 0 处理,
 * 导致 pack_qty=null 时 fallback 到 plat_map_qty 的链路彻底失效,所有
 * platform_qty 被强制写成 1。本脚本按行重算,不聚合不去重。
 *
 * DRY=1 仅报数不写。用法:node fix-1688src-qty-from-payload.cjs
 */
const path = require("path");

function loadDb() {
  let Database;
  try { Database = require("better-sqlite3"); }
  catch { Database = require("/opt/temu-automation/node_modules/better-sqlite3"); }
  const dir = process.env.ERP_DATA_DIR || "/opt/temu-erp-data";
  return new Database(process.env.ERP_DB || path.join(dir, "erp.sqlite"));
}

const DRY = process.env.DRY === "1";

function pickPositiveInt(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1) return Math.trunc(n);
  }
  return 1;
}

function main() {
  const db = loadDb();
  db.pragma("busy_timeout = 60000");
  const now = new Date().toISOString();

  const sel = db.prepare(
    "SELECT id, our_qty, platform_qty, source_payload_json " +
    "FROM erp_sku_1688_sources WHERE id LIKE 'jst:1688src:%'"
  );
  const upd = db.prepare(
    "UPDATE erp_sku_1688_sources SET our_qty=@our_qty, platform_qty=@platform_qty, updated_at=@updated_at WHERE id=@id"
  );

  const stats = {
    total: 0, badJson: 0, unchanged: 0, changedOur: 0, changedPlatform: 0,
    changedRows: 0, samples: [],
  };

  // 一次性读全(16k 行,内存无压力);事务内不能再 iterate 同一连接的游标。
  const allRows = sel.all();

  const run = db.transaction(() => {
    for (const r of allRows) {
      stats.total++;
      let p;
      try { p = JSON.parse(r.source_payload_json || "null") || {}; }
      catch { stats.badJson++; continue; }

      // 护栏:只重算"聚水潭原始 payload"——至少含一个聚水潭比例字段才动。
      // 否则可能是被找货/采购等链路覆盖了 source_payload 的行,它们当前
      // our_qty/platform_qty 是用户真实值,pickPositiveInt 兜底成 1 会冲掉。
      const hasJstFields =
        p.base_qty != null || p.pack_qty != null || p.plat_map_qty != null;
      if (!hasJstFields) { stats.unchanged++; continue; }

      const newOur = pickPositiveInt(p.base_qty);
      const newPlatform = pickPositiveInt(p.pack_qty, p.plat_map_qty);

      const ourDiff = newOur !== r.our_qty;
      const platDiff = newPlatform !== r.platform_qty;
      if (!ourDiff && !platDiff) { stats.unchanged++; continue; }

      if (ourDiff) stats.changedOur++;
      if (platDiff) stats.changedPlatform++;
      stats.changedRows++;
      if (stats.samples.length < 12) {
        stats.samples.push({
          id: r.id,
          base_qty: p.base_qty ?? null,
          pack_qty: p.pack_qty ?? null,
          plat_map_qty: p.plat_map_qty ?? null,
          our: { from: r.our_qty, to: newOur },
          platform: { from: r.platform_qty, to: newPlatform },
        });
      }

      upd.run({ id: r.id, our_qty: newOur, platform_qty: newPlatform, updated_at: now });
    }
    if (DRY) throw new Error("__DRY__");
  });

  let rolledBack = false;
  try { run(); } catch (e) {
    if (e && e.message === "__DRY__") rolledBack = true;
    else { db.close(); throw e; }
  }

  db.close();
  console.log(JSON.stringify({
    mode: DRY ? "DRY(已回滚)" : "WRITE",
    total: stats.total,
    badJson: stats.badJson,
    unchanged: stats.unchanged,
    changedRows: stats.changedRows,
    changedOurQty: stats.changedOur,
    changedPlatformQty: stats.changedPlatform,
    rolledBack,
    samples: stats.samples,
  }, null, 2));
}

main();
