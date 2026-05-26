import { Router } from "express";
import crypto from "crypto";
import { getDb } from "../db/connection.js";
import { authMiddleware } from "../middleware/auth.js";
import { dispatchParsers } from "../parsers.js";

const r = Router();

function parseRequestBodyText(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  try {
    const params = new URLSearchParams(trimmed);
    const value = params.get("data") || params.get("param") || params.get("params");
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function attachRequestBody(responseBody, requestBodyText) {
  const requestBody = parseRequestBodyText(requestBodyText);
  if (!requestBody) return responseBody;
  if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
    return { ...responseBody, __request: requestBody };
  }
  return { result: responseBody, __request: requestBody };
}

r.get("/v1/health", authMiddleware, (req, res) => {
  res.json({ ok: true, ts: Date.now(), tenant_id: req.user.tid });
});

// Activity library backfill targets. The extension can ask the cloud which SKCs
// need a fresh marketing/enroll/list snapshot, then fetch those in the browser
// context where Temu cookies are available.
r.get("/v1/activity-targets", authMiddleware, (req, res) => {
  const db = getDb();
  const tenantId = req.user.tid;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const perGroupLimit = Math.min(50, Math.max(1, Number(req.query.per_group_limit) || 50));
  try {
    const rows = db.prepare(`
      WITH latest_sales AS (
        SELECT mall_supplier_id AS mall_id, MAX(stat_date) AS stat_date
        FROM temu_sales_snapshot
        WHERE tenant_id = ?
          AND mall_supplier_id <> ''
          AND skc_id NOT IN ('SKC-EXT-E2E', 'SKC-DBG')
        GROUP BY mall_supplier_id
      ),
      candidates AS (
        SELECT
          s.mall_supplier_id AS mall_id,
          'agentseller' AS site,
          s.skc_id,
          MAX(s.last_updated_at) AS updated_at
        FROM temu_sales_snapshot s
        JOIN latest_sales l
          ON l.mall_id = s.mall_supplier_id
         AND l.stat_date = s.stat_date
        WHERE s.tenant_id = ?
          AND s.mall_supplier_id <> ''
          AND s.skc_id <> ''
          AND s.skc_id NOT IN ('SKC-EXT-E2E', 'SKC-DBG')
        GROUP BY s.mall_supplier_id, s.skc_id
        UNION ALL
        SELECT
          mall_id,
          COALESCE(NULLIF(site, ''), 'agentseller') AS site,
          skc_id,
          MAX(last_updated_at) AS updated_at
        FROM skc_snapshots
        WHERE tenant_id = ?
          AND mall_id <> ''
          AND skc_id <> ''
          AND skc_id NOT IN ('SKC-EXT-E2E', 'SKC-DBG')
        GROUP BY mall_id, COALESCE(NULLIF(site, ''), 'agentseller'), skc_id
      ),
      dedup AS (
        SELECT mall_id, site, skc_id, MAX(updated_at) AS updated_at
        FROM candidates
        GROUP BY mall_id, site, skc_id
      ),
      activity AS (
        SELECT mall_id, skc_id, MAX(last_updated_at) AS last_activity_at
        FROM temu_activity_snapshot
        WHERE tenant_id = ?
          AND mall_id <> ''
          AND skc_id <> ''
        GROUP BY mall_id, skc_id
      )
      SELECT d.mall_id, d.site, d.skc_id, d.updated_at, a.last_activity_at
      FROM dedup d
      LEFT JOIN activity a
        ON a.mall_id = d.mall_id
       AND a.skc_id = d.skc_id
      ORDER BY
        CASE WHEN a.last_activity_at IS NULL THEN 0 ELSE 1 END,
        COALESCE(a.last_activity_at, '') ASC,
        d.updated_at DESC
      LIMIT ?
    `).all(tenantId, tenantId, tenantId, tenantId, limit);
    const groups = new Map();
    for (const row of rows) {
      const mallId = String(row.mall_id || "").trim();
      const site = String(row.site || "agentseller").trim() || "agentseller";
      const skcId = String(row.skc_id || "").trim();
      if (!mallId || !/^\d{5,}$/.test(skcId)) continue;
      const key = `${mallId}|${site}`;
      if (!groups.has(key)) groups.set(key, { mall_id: mallId, site, skc_ids: [] });
      const group = groups.get(key);
      if (group.skc_ids.length < perGroupLimit && !group.skc_ids.includes(skcId)) {
        group.skc_ids.push(skcId);
      }
    }
    const targets = Array.from(groups.values()).filter((group) => group.skc_ids.length);
    res.json({ ok: true, targets, count: rows.length, generated_at: Date.now() });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      res.json({ ok: true, targets: [], count: 0, generated_at: Date.now() });
      return;
    }
    throw error;
  }
});

// 全局 reload flag：通过 /api/_admin/trigger-reload 设为 true，下一次 heartbeat 把它返回给扩展，扩展调 chrome.runtime.reload() 重读 disk 代码
const RELOAD_FLAG = { ts: 0, version: 0 };
export function triggerExtensionReload() {
  RELOAD_FLAG.version++;
  RELOAD_FLAG.ts = Date.now();
  return RELOAD_FLAG;
}

// 全局 reconfig：让扩展 SW 自动改写 storage 切到新 cloud_endpoint / auth_token
const RECONFIG_FLAG = { version: 0, payload: null };
export function triggerExtensionReconfig(payload) {
  RECONFIG_FLAG.version++;
  RECONFIG_FLAG.payload = payload || null;
  return RECONFIG_FLAG;
}

// 扩展端心跳上报（用于无 DevTools 的远程诊断）
r.post("/v1/heartbeat", authMiddleware, (req, res) => {
  // 调试：把客户端上送的版本号 + page_url 打到 stdout
  try {
    const b = req.body || {};
    console.log(`[hb] dev=${(req.headers["x-device-id"] || "").slice(0,8)} reload=${b.last_reload_version} reconfig=${b.last_reconfig_version} page=${(b.page_url || "").slice(0,60)} cap=${b.captured_count} sent=${b.total_sent} q=${b.queue_depth}`);
  } catch {}
  const db = getDb();
  const deviceUuid = req.headers["x-device-id"] || null;
  const tenant_id = req.user.tid;
  const b = req.body || {};
  const now = Date.now();

  // 顺便 upsert device，让设备同时显示在 dashboard
  let device_id = null;
  if (deviceUuid) {
    const exist = db.prepare("SELECT id FROM devices WHERE device_uuid = ?").get(deviceUuid);
    if (exist) {
      device_id = exist.id;
      db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(device_id);
    } else {
      device_id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO devices (id, tenant_id, device_uuid, user_id, user_agent, last_seen)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).run(device_id, tenant_id, deviceUuid, req.user.uid, req.headers["user-agent"] || "");
    }
  }

  db.prepare(`
    INSERT INTO agent_heartbeats
    (id, tenant_id, device_id, device_uuid, captured_count, total_sent, queue_depth,
     last_capture_url, last_capture_at, last_flush_at, last_flush_ok, last_flush_reason,
     hook_xhr_alive, hook_perf_seen, page_url, collector_enabled, collector_index,
     collector_last_target_key, collector_last_target_url, collector_last_targets_json,
     collector_updated_at, ts, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), tenant_id, device_id, deviceUuid,
    b.captured_count ?? null, b.total_sent ?? null, b.queue_depth ?? null,
    b.last_capture_url || null, Number(b.last_capture_at) || null,
    Number(b.last_flush_at) || null,
    b.last_flush_ok == null ? null : (b.last_flush_ok ? 1 : 0),
    b.last_flush_reason || null,
    b.hook_xhr_alive == null ? null : (b.hook_xhr_alive ? 1 : 0),
    Number(b.hook_perf_seen) || null,
    b.page_url || null,
    b.collector_enabled == null ? null : (b.collector_enabled ? 1 : 0),
    Number.isFinite(Number(b.collector_index)) ? Number(b.collector_index) : null,
    b.collector_last_target_key || null,
    b.collector_last_target_url || null,
    Array.isArray(b.collector_last_targets) ? JSON.stringify(b.collector_last_targets).slice(0, 8000) : null,
    Number(b.collector_updated_at) || null,
    Number(b.ts) || now,
    now
  );

  // 在响应里告诉扩展是否要 reload（让代码改动 hot reload，不用人工点扩展刷新）
  const clientReloadVersion = Number(req.body?.last_reload_version || 0);
  const needsReload = RELOAD_FLAG.version > clientReloadVersion;
  const clientReconfigVersion = Number(req.body?.last_reconfig_version || 0);
  const needsReconfig = RECONFIG_FLAG.version > clientReconfigVersion && RECONFIG_FLAG.payload;

  res.json({
    ok: true,
    needs_reload: needsReload,
    reload_version: RELOAD_FLAG.version,
    reconfig: needsReconfig ? RECONFIG_FLAG.payload : null,
    reconfig_version: RECONFIG_FLAG.version,
  });
});

// 管理接口：触发所有扩展下次心跳时 reload
r.post("/_admin/trigger-reload", (req, res) => {
  const flag = triggerExtensionReload();
  res.json({ ok: true, ...flag });
});

// 管理接口：让所有扩展自动改写 cloud_endpoint / auth_token
// body: { cloud_endpoint, auth_token }
r.post("/_admin/trigger-reconfig", (req, res) => {
  const { cloud_endpoint, auth_token } = req.body || {};
  if (!cloud_endpoint) return res.status(400).json({ error: "cloud_endpoint 必填" });
  const flag = triggerExtensionReconfig({ cloud_endpoint, auth_token });
  res.json({ ok: true, ...flag });
});

r.post("/v1/batch", authMiddleware, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: "items 必须是数组" });

  const db = getDb();
  const deviceUuid = req.headers["x-device-id"] || null;
  const tenant_id = req.user.tid;

  // 1. upsert device
  let device_id = null;
  if (deviceUuid) {
    const exist = db.prepare("SELECT id FROM devices WHERE device_uuid = ?").get(deviceUuid);
    if (exist) {
      device_id = exist.id;
      db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(device_id);
    } else {
      device_id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO devices (id, tenant_id, device_uuid, user_id, user_agent, last_seen)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).run(device_id, tenant_id, deviceUuid, req.user.uid, req.headers["user-agent"] || "");
    }
  }

  // 2. 批量写入 + 维度统计 + mall upsert
  const insertEvt = db.prepare(`
    INSERT INTO capture_events
    (id, tenant_id, device_id, mall_id, site, page, kind, method, url, url_path, status, body_size, body_json, ts, captured_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertStat = db.prepare(`
    INSERT INTO api_endpoint_stats (tenant_id, site, method, url_path, count_total, last_seen)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(tenant_id, site, method, url_path)
    DO UPDATE SET count_total = count_total + 1, last_seen = excluded.last_seen
  `);
  const upsertMall = db.prepare(`
    INSERT INTO mall_accounts (id, tenant_id, site, mall_id, mall_name, last_seen)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, site, mall_id)
    DO UPDATE SET
      mall_name = COALESCE(excluded.mall_name, mall_accounts.mall_name),
      last_seen = excluded.last_seen
  `);

  const now = Date.now();
  let inserted = 0;

  // 事务前预先生成 event id + url_path，事务后传给 parser dispatcher
  const enriched = items.map((it) => {
    const url = it.url || "";
    const url_path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || url;
    const method = (it.method || "GET").toUpperCase();
    const storedBody = attachRequestBody(it.body || null, it.requestBodyText);
    const body_json = storedBody ? JSON.stringify(storedBody).slice(0, 1_000_000) : null;
    return {
      id: crypto.randomUUID(),
      url, url_path, method, body_json,
      it,
    };
  });

  const tx = db.transaction(() => {
    for (const e of enriched) {
      insertEvt.run(
        e.id,
        tenant_id,
        device_id,
        e.it.mall_id || null,
        e.it.site || null,
        e.it.page || null,
        e.it.kind || "unknown",
        e.method,
        e.url,
        e.url_path,
        e.it.status ?? null,
        e.it.bodySize ?? null,
        e.body_json,
        Number(e.it.ts) || now,
        Number(e.it.captured_at) || now,
        now
      );
      upsertStat.run(tenant_id, e.it.site || "", e.method, e.url_path, now);
      if (e.it.mall_id) {
        upsertMall.run(crypto.randomUUID(), tenant_id, e.it.site || "", String(e.it.mall_id), e.it.mall_name || null);
      }
      inserted++;
    }
  });
  tx();

  // parser 在主事务外跑，失败不影响 ingest 主流程
  try {
    const parserItems = enriched.map((e) => ({
      id: e.id,
      url_path: e.url_path,
      page: e.it.page || null,
      body_json: e.body_json,
      ts: Number(e.it.ts) || now,
      mall_id: e.it.mall_id || null,
      site: e.it.site || null,
    }));
    dispatchParsers(db, { tenant_id, device_id }, parserItems);
  } catch (e) {
    console.warn("[ingest] dispatchParsers failed:", e?.message);
  }

  res.json({ ok: true, inserted });
});

export default r;
