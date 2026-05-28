// 从 cloud sqlite (ATTACH 为 cloud) 把 temu_review_snapshot 增量同步进本地 ERP erp_temu_reviews。
// 数据源：扩展 hook 捕获 /bg-luna-agent-seller/review/pageQuery 写入 cloud。

const crypto = require("crypto");

const DEFAULT_COMPANY_ID = "company_default";
const ROBOT_KEY = "temu_review_robot";

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
// 减 1 秒兜底同秒边界（upsert 幂等）。
function normalizeCursor(value) {
  if (!value) return "1970-01-01 00:00:00";
  const text = String(value);
  const sqliteFmt = text.includes("T") ? text.replace("T", " ").replace(/\.\d+Z?$/, "") : text;
  const ms = Date.parse(sqliteFmt.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return sqliteFmt;
  return new Date(ms - 1000).toISOString().replace("T", " ").replace(/\.\d+Z?$/, "");
}

function getReviewCursor(db, companyId) {
  const row = db.prepare(`
    SELECT MAX(updated_at) AS cursor FROM erp_temu_reviews WHERE company_id = ?
  `).get(companyId);
  return normalizeCursor(row?.cursor);
}

function syncReviews(db, { companyId, since, now, limit }) {
  const rows = db.prepare(`
    SELECT mall_id, review_id, product_id, product_skc_id,
           goods_id, goods_name, score, comment, spec_summary, category_path,
           status, on_sale, created_at_ts, raw_json, last_updated_at
    FROM cloud.temu_review_snapshot
    WHERE last_updated_at > @since
      AND mall_id IS NOT NULL AND mall_id <> ''
      AND review_id IS NOT NULL AND review_id <> ''
    ORDER BY last_updated_at ASC
    LIMIT @limit
  `).all({ since, limit });
  if (!rows.length) return { upserted: 0, skipped: 0, latestCursor: since };
  const upsert = db.prepare(`
    INSERT INTO erp_temu_reviews (
      id, company_id, platform_shop_id, review_id,
      product_id, product_skc_id, goods_id, goods_name,
      score, comment, spec_summary, category_path,
      status, on_sale, created_at_ts, raw_json, created_at, updated_at
    )
    VALUES (
      @id, @company_id, @platform_shop_id, @review_id,
      @product_id, @product_skc_id, @goods_id, @goods_name,
      @score, @comment, @spec_summary, @category_path,
      @status, @on_sale, @created_at_ts, @raw_json, @now, @now
    )
    ON CONFLICT(company_id, platform_shop_id, review_id) DO UPDATE SET
      product_id = excluded.product_id,
      product_skc_id = excluded.product_skc_id,
      goods_id = excluded.goods_id,
      goods_name = excluded.goods_name,
      score = excluded.score,
      comment = excluded.comment,
      spec_summary = excluded.spec_summary,
      category_path = excluded.category_path,
      status = excluded.status,
      on_sale = excluded.on_sale,
      created_at_ts = excluded.created_at_ts,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  let upserted = 0;
  let skipped = 0;
  let latestCursor = since;
  for (const row of rows) {
    if (!row.mall_id || !row.review_id) { skipped += 1; continue; }
    upsert.run({
      id: stableId("temu_review", [companyId, row.mall_id, row.review_id]),
      company_id: companyId,
      platform_shop_id: String(row.mall_id),
      review_id: String(row.review_id),
      product_id: row.product_id || null,
      product_skc_id: row.product_skc_id || null,
      goods_id: row.goods_id || null,
      goods_name: row.goods_name || null,
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
      comment: row.comment || null,
      spec_summary: row.spec_summary || null,
      category_path: row.category_path || null,
      status: Number.isFinite(Number(row.status)) ? Number(row.status) : null,
      on_sale: row.on_sale == null ? null : (row.on_sale ? 1 : 0),
      created_at_ts: Number.isFinite(Number(row.created_at_ts)) ? Number(row.created_at_ts) : null,
      raw_json: row.raw_json || "{}",
      now,
    });
    upserted += 1;
    if (row.last_updated_at && row.last_updated_at > latestCursor) latestCursor = row.last_updated_at;
  }
  return { upserted, skipped, latestCursor };
}

class TemuCloudReviewSync {
  constructor({ db, attachCloudDb }) {
    if (!db) throw new Error("TemuCloudReviewSync requires db");
    this.db = db;
    this.attachCloudDb = attachCloudDb;
  }

  sync(payload = {}) {
    const companyId = String(payload.companyId || payload.company_id || DEFAULT_COMPANY_ID);
    const limit = Math.min(20000, Math.max(1, Number(payload.limit) || 5000));
    if (!ensureCloudAttached(this.db, this.attachCloudDb)) {
      throw new Error("cloud 数据库未挂载（本地 dev 或服务器未配置 cloud sqlite）");
    }
    const now = nowIso();
    const runId = stableId("temu_review_run", [companyId, now]);
    this.db.prepare(`
      INSERT INTO erp_temu_robot_sync_runs (
        id, company_id, robot_key, shop_count, sku_count, price_log_count,
        jit_count, vmi_count, review_count, status, error, started_at, finished_at
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 'running', NULL, ?, NULL)
    `).run(runId, companyId, ROBOT_KEY, now);

    try {
      const since = payload.since || getReviewCursor(this.db, companyId);
      const stats = this.db.transaction(() => syncReviews(this.db, { companyId, since, now, limit }))();
      const finishedAt = nowIso();
      this.db.prepare(`
        UPDATE erp_temu_robot_sync_runs
        SET review_count = ?, status = 'success', error = NULL, finished_at = ?
        WHERE id = ?
      `).run(stats.upserted, finishedAt, runId);
      return {
        runId,
        companyId,
        reviewUpserted: stats.upserted,
        reviewSkipped: stats.skipped,
        reviewCursor: stats.latestCursor,
        startedAt: now,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = nowIso();
      try {
        this.db.prepare(`
          UPDATE erp_temu_robot_sync_runs
          SET status = 'failed', error = ?, finished_at = ?
          WHERE id = ?
        `).run(String(error?.message || error).slice(0, 2000), finishedAt, runId);
      } catch {}
      throw error;
    }
  }
}

module.exports = {
  TemuCloudReviewSync,
  DEFAULT_COMPANY_ID,
  ROBOT_KEY,
};
