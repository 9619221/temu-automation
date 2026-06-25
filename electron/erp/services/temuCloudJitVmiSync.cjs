// 从 cloud sqlite (ATTACH 为 cloud 库) 把 temu_jit_status_snapshot / temu_stock_order_snapshot
// 增量同步进本地 ERP 表 erp_temu_jit_status / erp_temu_vmi_suborder。
// 触发链路：扩展 SW 主动调 TEMU 接口 → cloud /v1/batch → parser 落 cloud snapshot
//          → 本地 ERP 通过 ATTACH cloud db 跑本同步器 → 落本地 ERP 表。

const crypto = require("crypto");
const { queryAll, queryOne, execute, withTransaction} = require("../../db/connection.cjs");

const DEFAULT_COMPANY_ID = "company_default";
const ROBOT_KEY = "temu_additional_robot";

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, parts) {
  const text = parts.map((p) => String(p ?? "")).join("|");
  const hash = crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 20);
  return `${prefix}_${hash}`;
}

function ensureCloudAttached(db, attachFn) {
  if (typeof attachFn !== "function") return false;
  return attachFn(db) === true;
}

// ERP updated_at 是 ISO 毫秒精度，cloud last_updated_at 是 SQLite datetime 秒精度。
// 直接字符串比 ISO 'T' > 空格让 cursor 永远 >；只截 T 又会精度损失漏同秒数据。
// 解法：转 SQLite datetime 再减 1 秒兜底重叠（upsert 幂等，重拉无副作用）。
function normalizeCursor(value) {
  if (!value) return "1970-01-01 00:00:00";
  const text = String(value);
  const sqliteFmt = text.includes("T") ? text.replace("T", " ").replace(/\.\d+Z?$/, "") : text;
  const ms = Date.parse(sqliteFmt.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return sqliteFmt;
  return new Date(ms - 1000).toISOString().replace("T", " ").replace(/\.\d+Z?$/, "");
}

async function getJitCursor(db, companyId) {
  const row = await queryOne(db, `
    SELECT MAX(updated_at) AS cursor FROM erp_temu_jit_status WHERE company_id = ?
  `, [companyId]);
  return normalizeCursor(row?.cursor);
}

async function getVmiCursor(db, companyId) {
  const row = await queryOne(db, `
    SELECT MAX(updated_at) AS cursor FROM erp_temu_vmi_suborder WHERE company_id = ?
  `, [companyId]);
  return normalizeCursor(row?.cursor);
}

async function syncJit(db, { companyId, since, now, limit }) {
  const rows = await queryAll(db, `
    SELECT mall_id, site, stat_date, skc_id, sku_id, product_name,
           jit_status, jit_close_time, suggest_close,
           raw_json, last_updated_at
    FROM cloud.temu_jit_status_snapshot
    WHERE last_updated_at > @since
      AND mall_id IS NOT NULL AND mall_id <> ''
      AND skc_id IS NOT NULL AND skc_id <> ''
    ORDER BY last_updated_at ASC
    LIMIT @limit
  `, { since, limit });
  if (!rows.length) return { upserted: 0, skipped: 0, latestCursor: since };




















  let upserted = 0;
  let skipped = 0;
  let latestCursor = since;
  for (const row of rows) {
    if (!row.mall_id || !row.skc_id || !row.stat_date) {skipped += 1;continue;}
    await execute(db, `
    INSERT INTO erp_temu_jit_status (
      id, company_id, platform_shop_id, shop_name, skc, sku_code,
      product_name, jit_status, jit_close_time, suggest_close,
      stat_date, raw_json, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @platform_shop_id, NULL, @skc, @sku_code,
      @product_name, @jit_status, @jit_close_time, @suggest_close,
      @stat_date, @raw_json, @now, @now
    )
    ON CONFLICT(company_id, platform_shop_id, skc, stat_date) DO UPDATE SET
      sku_code = excluded.sku_code,
      product_name = excluded.product_name,
      jit_status = excluded.jit_status,
      jit_close_time = excluded.jit_close_time,
      suggest_close = excluded.suggest_close,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `, { id: stableId("temu_jit_status", [companyId, row.mall_id, row.skc_id, row.stat_date]), company_id: companyId, platform_shop_id: String(row.mall_id), skc: String(row.skc_id), sku_code: row.sku_id ? String(row.sku_id) : null, product_name: row.product_name || null, jit_status: row.jit_status || null, jit_close_time: row.jit_close_time || null, suggest_close: row.suggest_close == null ? 0 : row.suggest_close ? 1 : 0, stat_date: row.stat_date, raw_json: row.raw_json || "{}", now });upserted += 1;if (row.last_updated_at && row.last_updated_at > latestCursor) latestCursor = row.last_updated_at;}return { upserted, skipped, latestCursor };}
async function syncVmi(db, { companyId, since, now, limit }) {
  const rows = await queryAll(db, `
    SELECT mall_id, site, stock_order_no, delivery_order_sn, delivery_batch_sn,
           skc_id, sku_id, sku_ext_code, product_name,
           demand_qty, temu_status, order_time, raw_json, last_updated_at
    FROM cloud.temu_stock_order_snapshot
    WHERE last_updated_at > @since
      AND source_type = 'stock_order'
      AND mall_id IS NOT NULL AND mall_id <> ''
    ORDER BY last_updated_at ASC
    LIMIT @limit
  `, { since, limit });
  if (!rows.length) return { upserted: 0, skipped: 0, latestCursor: since };






















  let upserted = 0;
  let skipped = 0;
  let latestCursor = since;
  for (const row of rows) {
    const subOrderId = String(row.stock_order_no || row.delivery_order_sn || row.delivery_batch_sn || "").trim();
    if (!row.mall_id || !subOrderId) {skipped += 1;continue;}
    const statDate = row.order_time ?
    String(row.order_time).slice(0, 10) :
    String(row.last_updated_at || now).slice(0, 10);
    await execute(db, `
    INSERT INTO erp_temu_vmi_suborder (
      id, company_id, platform_shop_id, shop_name, sub_order_id, skc,
      sku_code, product_name, quantity, order_status, order_type,
      create_time, stat_date, raw_json, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @platform_shop_id, NULL, @sub_order_id, @skc,
      @sku_code, @product_name, @quantity, @order_status, NULL,
      @create_time, @stat_date, @raw_json, @now, @now
    )
    ON CONFLICT(company_id, platform_shop_id, sub_order_id, stat_date)
    DO UPDATE SET
      skc = excluded.skc,
      sku_code = excluded.sku_code,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      order_status = excluded.order_status,
      create_time = excluded.create_time,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `, { id: stableId("temu_vmi_suborder", [companyId, row.mall_id, subOrderId, statDate]), company_id: companyId, platform_shop_id: String(row.mall_id), sub_order_id: subOrderId, skc: row.skc_id ? String(row.skc_id) : null, sku_code: row.sku_ext_code || row.sku_id || null, product_name: row.product_name || null, quantity: Number.isFinite(Number(row.demand_qty)) ? Number(row.demand_qty) : 0, order_status: row.temu_status || null, create_time: row.order_time || null, stat_date: statDate, raw_json: row.raw_json || "{}", now });upserted += 1;if (row.last_updated_at && row.last_updated_at > latestCursor) latestCursor = row.last_updated_at;}return { upserted, skipped, latestCursor };}class TemuCloudJitVmiSync {
  constructor({ db, attachCloudDb }) {
    if (!db) throw new Error("TemuCloudJitVmiSync requires db");
    this.db = db;
    this.attachCloudDb = attachCloudDb;
  }

  async sync(payload = {}) {
    const companyId = String(payload.companyId || payload.company_id || DEFAULT_COMPANY_ID);
    const limit = Math.min(20000, Math.max(1, Number(payload.limit) || 5000));
    if (!ensureCloudAttached(this.db, this.attachCloudDb)) {
      throw new Error("cloud 数据库未挂载（本地 dev 或服务器未配置 cloud sqlite）");
    }
    const now = nowIso();
    const runId = stableId("temu_additional_run", [companyId, now]);
    await execute(this.db, `
      INSERT INTO erp_temu_robot_sync_runs (
        id, company_id, robot_key, shop_count, sku_count, price_log_count,
        jit_count, vmi_count, status, error, started_at, finished_at
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'running', NULL, ?, NULL)
    `, [runId, companyId, ROBOT_KEY, now]);

    try {
      const sinceJit = payload.sinceJit || payload.since || (await getJitCursor(this.db, companyId));
      const sinceVmi = payload.sinceVmi || payload.since || (await getVmiCursor(this.db, companyId));
      const stats = await withTransaction(this.db, async (txDb) => {
          const jitStats = await syncJit(this.db, { companyId, since: sinceJit, now, limit });
          const vmiStats = await syncVmi(this.db, { companyId, since: sinceVmi, now, limit });
          return { jitStats, vmiStats };
        });
      const finishedAt = nowIso();
      await execute(this.db, `
        UPDATE erp_temu_robot_sync_runs
        SET shop_count = 0, sku_count = 0, price_log_count = 0,
            jit_count = ?, vmi_count = ?, status = 'success',
            error = NULL, finished_at = ?
        WHERE id = ?
      `, [stats.jitStats.upserted, stats.vmiStats.upserted, finishedAt, runId]);
      return {
        runId,
        companyId,
        jitUpserted: stats.jitStats.upserted,
        jitSkipped: stats.jitStats.skipped,
        jitCursor: stats.jitStats.latestCursor,
        vmiUpserted: stats.vmiStats.upserted,
        vmiSkipped: stats.vmiStats.skipped,
        vmiCursor: stats.vmiStats.latestCursor,
        startedAt: now,
        finishedAt
      };
    } catch (error) {
      const finishedAt = nowIso();
      try {
        await execute(this.db, `
          UPDATE erp_temu_robot_sync_runs
          SET status = 'failed', error = ?, finished_at = ?
          WHERE id = ?
        `, [String(error?.message || error).slice(0, 2000), finishedAt, runId]);
      } catch {}
      throw error;
    }
  }
}

module.exports = {
  TemuCloudJitVmiSync,
  DEFAULT_COMPANY_ID,
  ROBOT_KEY
};