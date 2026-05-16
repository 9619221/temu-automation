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

r.get("/agent", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 120));
  const rows = db.prepare(`
    SELECT
      h.id,
      h.device_id,
      h.device_uuid,
      d.user_agent,
      h.captured_count,
      h.total_sent,
      h.queue_depth,
      h.last_capture_url,
      h.last_capture_at,
      h.last_flush_at,
      h.last_flush_ok,
      h.last_flush_reason,
      h.hook_xhr_alive,
      h.hook_perf_seen,
      h.page_url,
      h.ts,
      h.received_at
    FROM agent_heartbeats h
    LEFT JOIN devices d ON d.id = h.device_id
    WHERE h.tenant_id = ?
    ORDER BY h.ts DESC
    LIMIT ?
  `).all(tid, limit);
  res.json(rows);
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

export default r;
