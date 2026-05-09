import { Router } from "express";
import { getDb } from "../db/connection.js";
import { authMiddleware } from "../middleware/auth.js";

const r = Router();
r.use(authMiddleware);

r.get("/stats", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const total = db.prepare("SELECT COUNT(*) AS n FROM capture_events WHERE tenant_id = ?").get(tid).n;
  const last24h = db
    .prepare("SELECT COUNT(*) AS n FROM capture_events WHERE tenant_id = ? AND received_at >= ?")
    .get(tid, Date.now() - 86400000).n;
  const malls = db
    .prepare(`SELECT site, mall_id, mall_name, last_seen FROM mall_accounts
              WHERE tenant_id = ? ORDER BY last_seen DESC LIMIT 50`)
    .all(tid);
  const topEndpoints = db
    .prepare(`SELECT site, method, url_path, count_total, last_seen FROM api_endpoint_stats
              WHERE tenant_id = ? ORDER BY count_total DESC LIMIT 30`)
    .all(tid);
  const devices = db
    .prepare(`SELECT device_uuid, last_seen, user_agent FROM devices
              WHERE tenant_id = ? ORDER BY last_seen DESC LIMIT 30`)
    .all(tid);
  res.json({ total, last24h, malls, topEndpoints, devices });
});

r.get("/events", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const { url_path, mall_id, limit = 100, since } = req.query;
  const where = ["tenant_id = ?"];
  const params = [tid];
  if (url_path) { where.push("url_path LIKE ?"); params.push("%" + url_path + "%"); }
  if (mall_id) { where.push("mall_id = ?"); params.push(mall_id); }
  if (since) { where.push("ts >= ?"); params.push(Number(since)); }
  const sql = `SELECT id, ts, mall_id, site, page, method, url_path, status, body_size
               FROM capture_events WHERE ${where.join(" AND ")}
               ORDER BY ts DESC LIMIT ?`;
  params.push(Math.min(500, Number(limit) || 100));
  res.json(db.prepare(sql).all(...params));
});

// 扩展端最新心跳：诊断"hook 是否在跑、队列多深、最近抓到啥"
r.get("/agent", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const rows = db.prepare(`
    SELECT device_uuid, captured_count, total_sent, queue_depth,
           last_capture_url, last_capture_at, last_flush_at, last_flush_ok, last_flush_reason,
           hook_xhr_alive, hook_perf_seen, page_url, ts, received_at
    FROM agent_heartbeats
    WHERE tenant_id = ?
    ORDER BY ts DESC
    LIMIT 20
  `).all(tid);
  res.json(rows);
});

// 时间桶聚合：默认 24h 按 1h 分，可选 ?bucket=hour|day&since=ts
r.get("/timeline", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const bucket = req.query.bucket === "day" ? 86400000 : 3600000;
  const since = Number(req.query.since) || (Date.now() - 24 * 3600 * 1000);
  // SQLite 没原生 floor div，自己算 bucket 边界
  const rows = db
    .prepare(`
      SELECT
        (ts / ?) * ? AS bucket_ts,
        COUNT(*) AS n,
        SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS err4,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS err5
      FROM capture_events
      WHERE tenant_id = ? AND ts >= ?
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `)
    .all(bucket, bucket, tid, since);
  res.json({ bucket, since, points: rows });
});

// 按店铺聚合
r.get("/by-mall", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const since = Number(req.query.since) || (Date.now() - 24 * 3600 * 1000);
  const rows = db
    .prepare(`
      SELECT site, COALESCE(mall_id, '(unknown)') AS mall_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
             MAX(ts) AS last_ts,
             COUNT(DISTINCT url_path) AS distinct_endpoints
      FROM capture_events
      WHERE tenant_id = ? AND ts >= ?
      GROUP BY site, mall_id
      ORDER BY total DESC
      LIMIT 50
    `)
    .all(tid, since);
  res.json(rows);
});

// 状态码分布
r.get("/status-breakdown", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const since = Number(req.query.since) || (Date.now() - 24 * 3600 * 1000);
  const rows = db
    .prepare(`
      SELECT
        CASE
          WHEN status >= 200 AND status < 300 THEN '2xx'
          WHEN status >= 300 AND status < 400 THEN '3xx'
          WHEN status >= 400 AND status < 500 THEN '4xx'
          WHEN status >= 500 THEN '5xx'
          ELSE 'other'
        END AS bucket,
        COUNT(*) AS n
      FROM capture_events
      WHERE tenant_id = ? AND ts >= ?
      GROUP BY bucket
      ORDER BY n DESC
    `)
    .all(tid, since);
  res.json(rows);
});

// 业务分类聚合（按 url_path 关键词归类到商品 / 订单 / 销售 / 活动等）
r.get("/by-category", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const since = Number(req.query.since) || (Date.now() - 24 * 3600 * 1000);
  // 前端友好：先把每个 url_path 算上 count，按 path 关键词分组
  const rows = db
    .prepare(`
      SELECT url_path, COUNT(*) AS n
      FROM capture_events
      WHERE tenant_id = ? AND ts >= ?
      GROUP BY url_path
    `)
    .all(tid, since);
  const buckets = {};
  for (const r of rows) {
    const cat = categorize(r.url_path);
    buckets[cat] = (buckets[cat] || 0) + r.n;
  }
  const out = Object.entries(buckets)
    .map(([category, n]) => ({ category, n }))
    .sort((a, b) => b.n - a.n);
  res.json(out);
});

function categorize(path) {
  if (/\b(product|skc|sku|goods|draft)\b/i.test(path)) return "商品";
  if (/\b(purchase|order|stock|delivery|deliver|express)\b/i.test(path)) return "订单/物流";
  if (/\b(sales|sale|listOverall|soldOut)\b/i.test(path)) return "销售";
  if (/\b(afs|aftersales|return|refund)\b/i.test(path)) return "售后";
  if (/\b(flow|analysis|statistics|category)\b/i.test(path)) return "数据/流量";
  if (/\b(activity|marketing|gambit|gamblers|coupon|enroll|bidding|colossus|hot)\b/i.test(path)) return "活动/营销";
  if (/\b(magneto|price|suggestedPrice|zoro|adjust)\b/i.test(path)) return "价格";
  if (/\b(robin|lich|todo|wait|guide|hawk|course)\b/i.test(path)) return "任务/课程";
  if (/\b(msgBox|chat|cute|infoTicket|agora|conv)\b/i.test(path)) return "消息/客服";
  if (/\b(finance|fund|merchant\/front)\b/i.test(path)) return "财务";
  if (/\b(retrieval|brando|compliance|notAllEu|origin)\b/i.test(path)) return "合规/检测";
  if (/\b(gray|lollipop|direnjie|leo-config|common\/site)\b/i.test(path)) return "灰度/配置";
  if (/\b(auth|userInfo|menu|redDot|agreement)\b/i.test(path)) return "鉴权/菜单";
  return "其他";
}

r.get("/event/:id/body", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const row = db
    .prepare("SELECT body_json FROM capture_events WHERE tenant_id = ? AND id = ?")
    .get(tid, req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.setHeader("Content-Type", "application/json");
  res.send(row.body_json || "null");
});

// ================= SKC 主体聚合查询 =================

// 列表：?mall_id=&q=&limit=&offset=
r.get("/skc", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const { mall_id, q } = req.query;
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = ["tenant_id = ?"];
  const params = [tid];
  if (mall_id) { where.push("mall_id = ?"); params.push(mall_id); }
  if (q) {
    where.push("(title LIKE ? OR skc_id LIKE ? OR product_id LIKE ?)");
    const like = "%" + q + "%";
    params.push(like, like, like);
  }
  const rows = db.prepare(`
    SELECT skc_id, product_id, mall_id, site, title, category_name, status,
           thumb_url, declared_price_cents, suggested_price_cents, price_currency,
           sales_total, stock_available, last_updated_at
    FROM skc_snapshots
    WHERE ${where.join(" AND ")}
    ORDER BY last_updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM skc_snapshots WHERE ${where.join(" AND ")}`).get(...params).n;
  res.json({ rows, total, limit, offset });
});

// 单条详情：从 skc_snapshots + sources_json 引用回原 capture_events
r.get("/skc/:id", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const row = db.prepare(`
    SELECT * FROM skc_snapshots WHERE tenant_id = ? AND skc_id = ?
  `).get(tid, req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  let sources = {};
  try { sources = JSON.parse(row.sources_json || "{}"); } catch {}
  // 取所有 source event 的元数据（不取 body）
  const eventIds = Object.values(sources);
  let events = [];
  if (eventIds.length) {
    const placeholders = eventIds.map(() => "?").join(",");
    events = db.prepare(`
      SELECT id, url_path, method, status, ts FROM capture_events
      WHERE tenant_id = ? AND id IN (${placeholders})
      ORDER BY ts DESC
    `).all(tid, ...eventIds);
  }
  res.json({ skc: row, sources, events });
});

// ================= PriceReview 看板专用 =================

// 列出 SKC 的「价格审核」视图：申报价 + 建议价 + 价差 + 175% 阈值判断
// 形状贴近现有 PriceReview.tsx 期望，前端可直接渲染
r.get("/price-review", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const { mall_id } = req.query;
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = ["tenant_id = ?", "(declared_price_cents IS NOT NULL OR suggested_price_cents IS NOT NULL)"];
  const params = [tid];
  if (mall_id) { where.push("mall_id = ?"); params.push(mall_id); }

  const rows = db.prepare(`
    SELECT skc_id, product_id, mall_id, site, title, thumb_url, category_name,
           declared_price_cents, suggested_price_cents, price_currency,
           last_updated_at
    FROM skc_snapshots
    WHERE ${where.join(" AND ")}
    ORDER BY last_updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // 计算 175% 阈值（成本×1.75 是核价目标，但成本暂未在云端，所以前端只能展示「申报 vs 建议」差异）
  const enriched = rows.map((r) => {
    const declared = r.declared_price_cents;
    const suggested = r.suggested_price_cents;
    const gap_cents = (declared != null && suggested != null) ? declared - suggested : null;
    const gap_ratio = (declared && suggested) ? (declared - suggested) / suggested : null;
    return { ...r, gap_cents, gap_ratio };
  });
  const total = db.prepare(`SELECT COUNT(*) AS n FROM skc_snapshots WHERE ${where.join(" AND ")}`).get(...params).n;
  res.json({ rows: enriched, total, limit, offset });
});

export default r;
