import { Router } from "express";
import { getDb } from "../db/connection.js";
import { authMiddleware } from "../middleware/auth.js";

const r = Router();
r.use(authMiddleware);

function safeJsonParse(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function pickList(body) {
  return (
    body?.result?.pageItems ||
    body?.result?.dataList ||
    body?.result?.list ||
    body?.result?.items ||
    body?.result?.subOrderList ||
    body?.data?.pageItems ||
    body?.data?.list ||
    body?.data?.items ||
    body?.data?.subOrderList ||
    body?.pageItems ||
    body?.list ||
    body?.items ||
    (Array.isArray(body) ? body : [])
  );
}

function normalizeId(value) {
  if (value == null || value === "") return "";
  return String(value).trim();
}

function rawItemIds(item) {
  return [
    item?.productSkcId,
    item?.skcId,
    item?.productSKCId,
    item?.skc_id,
    item?.productId,
    item?.product_id,
    item?.goodsId,
    item?.goods_id,
  ].map(normalizeId).filter(Boolean);
}

function rowIds(row) {
  return [row?.skc_id, row?.product_id, row?.goods_id].map(normalizeId).filter(Boolean);
}

function rawItemMatchesRow(item, row) {
  const wanted = new Set(rowIds(row));
  if (wanted.size === 0) return false;
  return rawItemIds(item).some((id) => wanted.has(id));
}

function deepFindRawItem(body, row) {
  const directList = pickList(body);
  if (Array.isArray(directList)) {
    const found = directList.find((item) => item && typeof item === "object" && rawItemMatchesRow(item, row));
    if (found) return found;
  }

  const stack = [{ node: body, depth: 0 }];
  const seen = new Set();
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node || depth > 6 || seen.has(node)) continue;
    if (typeof node !== "object") continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object" && rawItemMatchesRow(item, row)) return item;
        stack.push({ node: item, depth: depth + 1 });
      }
      continue;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push({ node: value, depth: depth + 1 });
    }
  }
  return null;
}

function sourceEventIds(row) {
  const sources = safeJsonParse(row?.sources_json, {});
  if (!sources || typeof sources !== "object") return [];
  return Array.from(new Set(Object.values(sources).map(normalizeId).filter(Boolean)));
}

function getRawProductPayload(db, tenantId, row) {
  const ids = sourceEventIds(row);
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(",");
  const events = db.prepare(`
    SELECT id, url_path, method, status, ts, body_size, body_json
    FROM capture_events
    WHERE tenant_id = ? AND id IN (${placeholders})
    ORDER BY ts DESC
  `).all(tenantId, ...ids);

  for (const event of events) {
    const body = safeJsonParse(event.body_json);
    const rawItem = deepFindRawItem(body, row);
    if (!rawItem) continue;
    const { body_json: _bodyJson, ...rawSource } = event;
    return {
      raw_item: rawItem,
      raw_source: rawSource,
    };
  }
  return {};
}

function collectProductSkuIds(rawItem) {
  const out = new Set();
  const add = (value) => {
    const id = normalizeId(value);
    if (id) out.add(id);
  };
  add(rawItem?.productSkuId);
  add(rawItem?.prodSkuId);
  const lists = [
    rawItem?.skuQuantityDetailList,
    rawItem?.skuQuantityDetailForSupplierList,
    rawItem?.skuList,
    rawItem?.skuInfoList,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const sku of list) {
      add(sku?.productSkuId);
      add(sku?.prodSkuId);
      add(sku?.skuId);
    }
  }
  return Array.from(out);
}

function aggregateTrendRows(rows) {
  const daily = new Map();
  for (const row of rows) {
    if (Number(row.is_predict || 0) === 1) continue;
    const date = normalizeId(row.stat_date);
    if (!date) continue;
    daily.set(date, (daily.get(date) || 0) + (Number(row.sales_number) || 0));
  }
  const trendDaily = Array.from(daily.entries())
    .map(([date, salesNumber]) => ({ date, salesNumber }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!trendDaily.length) {
    return {
      trend_daily: [],
      trend_latest_date: null,
      trend_today_sales: null,
      trend_last7d_sales: null,
      trend_last30d_sales: null,
    };
  }
  const latest = trendDaily[trendDaily.length - 1].date;
  const latestMs = Date.parse(`${latest}T00:00:00Z`);
  const sumWindow = (days) => {
    if (!Number.isFinite(latestMs)) return trendDaily.slice(-days).reduce((sum, item) => sum + item.salesNumber, 0);
    const cutoff = latestMs - (days - 1) * 86400000;
    return trendDaily.reduce((sum, item) => {
      const ms = Date.parse(`${item.date}T00:00:00Z`);
      return Number.isFinite(ms) && ms >= cutoff && ms <= latestMs ? sum + item.salesNumber : sum;
    }, 0);
  };
  return {
    trend_daily: trendDaily,
    trend_latest_date: latest,
    trend_today_sales: daily.get(latest) || 0,
    trend_last7d_sales: sumWindow(7),
    trend_last30d_sales: sumWindow(30),
  };
}

function getSkuSalesTrendPayload(db, tenantId, rawItem) {
  const skuIds = collectProductSkuIds(rawItem);
  if (!skuIds.length) return {};
  const placeholders = skuIds.map(() => "?").join(",");
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT product_sku_id, stat_date, sales_number, is_predict, sold_out
      FROM temu_sku_sales_trend
      WHERE tenant_id = ? AND product_sku_id IN (${placeholders})
      ORDER BY stat_date ASC
    `).all(tenantId, ...skuIds);
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || ""))) throw error;
    return {};
  }
  if (!rows.length) return {};

  const sku_sales_trends = {};
  for (const skuId of skuIds) {
    const skuRows = rows.filter((row) => normalizeId(row.product_sku_id) === skuId);
    if (!skuRows.length) continue;
    const metrics = aggregateTrendRows(skuRows);
    if (metrics.trend_daily.length) {
      sku_sales_trends[skuId] = {
        trend_daily: metrics.trend_daily,
        latest_date: metrics.trend_latest_date,
        today_sales: metrics.trend_today_sales,
        last7d_sales: metrics.trend_last7d_sales,
        last30d_sales: metrics.trend_last30d_sales,
      };
    }
  }
  const aggregate = aggregateTrendRows(rows);
  if (!aggregate.trend_daily.length) return {};
  return {
    trend_daily: aggregate.trend_daily,
    trend_latest_date: aggregate.trend_latest_date,
    trend_today_sales: aggregate.trend_today_sales,
    trend_last7d_sales: aggregate.trend_last7d_sales,
    trend_last30d_sales: aggregate.trend_last30d_sales,
    sku_sales_trends,
  };
}

function withTrendSalesFallback(row, trendPayload) {
  if (!trendPayload?.trend_daily?.length) return row;
  const next = { ...row, ...trendPayload };
  if ((Number(next.today_sales) || 0) <= 0 && trendPayload.trend_today_sales != null) {
    next.today_sales = trendPayload.trend_today_sales;
  }
  if ((Number(next.last7d_sales) || 0) <= 0 && trendPayload.trend_last7d_sales != null) {
    next.last7d_sales = trendPayload.trend_last7d_sales;
  }
  if ((Number(next.last30d_sales) || 0) <= 0 && trendPayload.trend_last30d_sales != null) {
    next.last30d_sales = trendPayload.trend_last30d_sales;
  }
  return next;
}

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

// TEMU sales snapshots: ?date=YYYY-MM-DD
r.get("/temu-sales", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedDate = req.query.date;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const explicitDate = typeof requestedDate === "string" && requestedDate;
  let date = explicitDate ? requestedDate : "";
  if (!date) {
    const latestWhere = ["tenant_id = ?"];
    const latestParams = [tid];
    if (requestedMallId) {
      latestWhere.push("mall_supplier_id = ?");
      latestParams.push(requestedMallId);
    }
    const latest = db.prepare(`
      SELECT stat_date AS date
      FROM temu_sales_snapshot
      WHERE ${latestWhere.join(" AND ")}
      ORDER BY stat_date DESC
      LIMIT 1
    `).get(...latestParams);
    date = latest?.date || new Date().toISOString().slice(0, 10);
  }
  const where = ["tenant_id = ?", "stat_date = ?"];
  const params = [tid, date];
  if (requestedMallId) {
    where.push("mall_supplier_id = ?");
    params.push(requestedMallId);
  }
  const rows = db.prepare(`
    SELECT skc_id, product_id, goods_id, mall_supplier_id, title, category_name,
           thumb_url, sku_ext_code, today_sales, last7d_sales, last30d_sales,
           total_sales, warehouse_stock, occupy_stock, unavailable_stock,
           advice_qty, available_sale_days, declared_price_cents, price_currency,
           asf_score, comment_num, quality_after_sales_rate, supply_status,
           stock_status, close_jit_status, stat_date, sources_json, last_updated_at
    FROM temu_sales_snapshot
    WHERE ${where.join(" AND ")}
    ORDER BY total_sales DESC
    LIMIT 200
  `).all(...params);
  res.json({
    date,
    rows: rows.map((row) => {
      const rawPayload = getRawProductPayload(db, tid, row);
      const trendPayload = getSkuSalesTrendPayload(db, tid, rawPayload.raw_item);
      return withTrendSalesFallback({
        ...row,
        ...rawPayload,
      }, trendPayload);
    }),
  });
});

r.get("/shop-sales", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedDate = req.query.date;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const explicitDate = typeof requestedDate === "string" && requestedDate;
  const where = ["tenant_id = ?"];
  const params = [tid];
  if (explicitDate) {
    where.push("stat_date = ?");
    params.push(requestedDate);
  }
  if (requestedMallId) {
    where.push("mall_id = ?");
    params.push(requestedMallId);
  }
  const row = db.prepare(`
    SELECT id, tenant_id, mall_id, site, stat_date,
           sale_volume, seven_days_sale_volume, thirty_days_sale_volume,
           on_sale_product_number, wait_product_number, lack_skc_number,
           advice_prepare_skc_number, about_to_sell_out_number,
           already_sold_out_number, high_price_limit_number,
           quality_after_sale_ratio_90d, sources_json, last_updated_at
    FROM temu_shop_stats
    WHERE ${where.join(" AND ")}
    ORDER BY stat_date DESC, last_updated_at DESC
    LIMIT 1
  `).get(...params);
  res.json({ date: row?.stat_date || "", row: row || null });
});

r.get("/event/:id/body", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const row = db.prepare(`
    SELECT id, mall_id, site, page, kind, method, url, url_path, status, body_size, ts, captured_at, received_at, body_json
    FROM capture_events
    WHERE tenant_id = ? AND id = ?
  `).get(tid, req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const body = safeJsonParse(row.body_json, null);
  const { body_json: _bodyJson, ...event } = row;
  res.json({ event, body });
});

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
