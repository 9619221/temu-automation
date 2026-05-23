import { Router } from "express";
import { getDb } from "../db/connection.js";
import { authMiddleware } from "../middleware/auth.js";

const r = Router();
r.use(authMiddleware);

const realMallWhere = "mall_id <> ''";
const realSalesWhere = "mall_supplier_id <> '' AND mall_supplier_id NOT IN ('MALL-EXT-E2E') AND skc_id NOT IN ('SKC-EXT-E2E', 'SKC-DBG')";

function safeJsonParse(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function pickList(body) {
  const candidates = [
    body?.result?.pageItems,
    body?.result?.dataList,
    body?.result?.list,
    body?.result?.items,
    body?.result?.subOrderList,
    body?.data?.pageItems,
    body?.data?.list,
    body?.data?.items,
    body?.data?.subOrderList,
    body?.pageItems,
    body?.list,
    body?.items,
    Array.isArray(body) ? body : null,
  ];
  return candidates.find((value) => Array.isArray(value) && value.length > 0) || [];
}

function normalizeId(value) {
  if (value == null || value === "") return "";
  return String(value).trim();
}

function optionalAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ""))) return [];
    throw error;
  }
}

function optionalGet(db, sql, params = [], fallback = null) {
  try {
    return db.prepare(sql).get(...params) || fallback;
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ""))) return fallback;
    throw error;
  }
}

function latestText(...values) {
  return values
    .map((value) => (value == null ? "" : String(value)))
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] || null;
}

function toNum(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function rawItemIds(item) {
  return [
    item?.productSkcId,
    item?.skcId,
    item?.productSKCId,
    item?.skc_id,
    item?.productId,
    item?.product_id,
    item?.productSpuId,
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

function getCachedRawEvent(db, tenantId, eventId, eventCache) {
  const id = normalizeId(eventId);
  if (!id) return null;
  const key = `${tenantId}|${id}`;
  if (eventCache && eventCache.has(key)) return eventCache.get(key);
  const event = db.prepare(`
    SELECT id, url_path, method, status, ts, body_size, body_json
    FROM capture_events
    WHERE tenant_id = ? AND id = ?
  `).get(tenantId, id);
  if (!event) {
    if (eventCache) eventCache.set(key, null);
    return null;
  }
  const body = safeJsonParse(event.body_json);
  const { body_json: _bodyJson, ...rawSource } = event;
  const cached = { body, rawSource };
  if (eventCache) eventCache.set(key, cached);
  return cached;
}

function getRawProductPayload(db, tenantId, row, eventCache = null) {
  const ids = sourceEventIds(row);
  if (ids.length === 0) return {};
  const events = ids
    .map((id) => getCachedRawEvent(db, tenantId, id, eventCache))
    .filter(Boolean)
    .sort((left, right) => Number(right.rawSource?.ts || 0) - Number(left.rawSource?.ts || 0));

  for (const event of events) {
    const body = event.body;
    const rawItem = deepFindRawItem(body, row);
    if (!rawItem) continue;
    return {
      raw_item: rawItem,
      raw_source: event.rawSource,
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

function getSkuSalesTrendPayload(db, tenantId, rawItem, mallId = "") {
  const skuIds = collectProductSkuIds(rawItem);
  if (!skuIds.length) return {};
  const placeholders = skuIds.map(() => "?").join(",");
  const wantedMallId = normalizeId(mallId);
  let rows = [];
  try {
    const where = ["tenant_id = ?", `product_sku_id IN (${placeholders})`];
    const params = [tenantId, ...skuIds];
    if (wantedMallId) {
      where.push("mall_id = ?");
      params.push(wantedMallId);
    }
    rows = db.prepare(`
      SELECT product_sku_id, stat_date, sales_number, is_predict, sold_out
      FROM temu_sku_sales_trend
      WHERE ${where.join(" AND ")}
      ORDER BY stat_date ASC
    `).all(...params);
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

function productFlowKeys(row) {
  const keys = [];
  const mallId = normalizeId(row?.mall_supplier_id ?? row?.mall_id);
  const productId = normalizeId(row?.product_id);
  const goodsId = normalizeId(row?.goods_id);
  const prefix = mallId ? `mall:${mallId}|` : "";
  if (productId) keys.push(`${prefix}product:${productId}`);
  if (goodsId) keys.push(`${prefix}goods:${goodsId}`);
  return keys;
}

function getProductFlowRows(db, tenantId, requestedMallId, requestedDate, explicitDate, limit = 1000) {
  try {
    let date = requestedDate;
    if (!explicitDate) {
      const latestWhere = ["tenant_id = ?", realMallWhere];
      const latestParams = [tenantId];
      if (requestedMallId) {
        latestWhere.push("mall_id = ?");
        latestParams.push(requestedMallId);
      }
      const latest = db.prepare(`
        SELECT stat_date AS date
        FROM temu_product_flow_snapshot
        WHERE ${latestWhere.join(" AND ")}
        ORDER BY stat_date DESC, last_updated_at DESC
        LIMIT 1
      `).get(...latestParams);
      date = latest?.date || "";
    }
    if (!date) return [];
    const where = ["tenant_id = ?", "stat_date = ?", realMallWhere];
    const params = [tenantId, date];
    if (requestedMallId) {
      where.push("mall_id = ?");
      params.push(requestedMallId);
    }
    return db.prepare(`
      SELECT mall_id, site, stat_date, product_id, goods_id, title, category_name, thumb_url,
             expose_num, click_num, detail_visit_num, detail_visitor_num,
             add_to_cart_user_num, collect_user_num, pay_goods_num, pay_order_num, buyer_num,
             expose_pay_conversion_rate, expose_click_conversion_rate, click_pay_conversion_rate,
             search_expose_num, search_click_num, search_pay_goods_num, search_pay_order_num,
             recommend_expose_num, recommend_click_num, recommend_pay_goods_num, recommend_pay_order_num,
             flow_grow_status, grow_data_text, bsr_goods, source_event_id,
             sources_json, last_updated_at
      FROM temu_product_flow_snapshot
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(pay_goods_num, 0) DESC, COALESCE(pay_order_num, 0) DESC
      LIMIT ?
    `).all(...params, limit);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return [];
    throw error;
  }
}

function productFlowPayload(flow) {
  if (!flow) return {};
  return {
    flow_stat_date: flow.stat_date,
    flow_pay_goods_num: flow.pay_goods_num,
    flow_pay_order_num: flow.pay_order_num,
    flow_buyer_num: flow.buyer_num,
    flow_expose_num: flow.expose_num,
    flow_click_num: flow.click_num,
    flow_detail_visit_num: flow.detail_visit_num,
    flow_detail_visitor_num: flow.detail_visitor_num,
    flow_add_to_cart_user_num: flow.add_to_cart_user_num,
    flow_collect_user_num: flow.collect_user_num,
    flow_expose_pay_conversion_rate: flow.expose_pay_conversion_rate,
    flow_expose_click_conversion_rate: flow.expose_click_conversion_rate,
    flow_click_pay_conversion_rate: flow.click_pay_conversion_rate,
    flow_search_expose_num: flow.search_expose_num,
    flow_search_click_num: flow.search_click_num,
    flow_search_pay_goods_num: flow.search_pay_goods_num,
    flow_search_pay_order_num: flow.search_pay_order_num,
    flow_recommend_expose_num: flow.recommend_expose_num,
    flow_recommend_click_num: flow.recommend_click_num,
    flow_recommend_pay_goods_num: flow.recommend_pay_goods_num,
    flow_recommend_pay_order_num: flow.recommend_pay_order_num,
    flow_grow_status: flow.flow_grow_status,
    flow_grow_data_text: flow.grow_data_text,
    flow_bsr_goods: flow.bsr_goods,
  };
}

function getProductFlowTrendPayload(db, tenantId, row) {
  const productId = normalizeId(row?.product_id);
  const goodsId = normalizeId(row?.goods_id);
  if (!productId && !goodsId) return [];
  try {
    const where = ["tenant_id = ?", realMallWhere];
    const params = [tenantId];
    const mallId = normalizeId(row?.mall_supplier_id ?? row?.mall_id);
    if (mallId) {
      where.push("mall_id = ?");
      params.push(mallId);
    }
    const idWhere = [];
    if (productId) {
      idWhere.push("product_id = ?");
      params.push(productId);
    }
    if (goodsId) {
      idWhere.push("goods_id = ?");
      params.push(goodsId);
    }
    where.push(`(${idWhere.join(" OR ")})`);
    const rows = db.prepare(`
      SELECT stat_date, expose_num, click_num, detail_visit_num, detail_visitor_num,
             add_to_cart_user_num, collect_user_num, pay_goods_num, pay_order_num, buyer_num,
             expose_pay_conversion_rate, expose_click_conversion_rate, click_pay_conversion_rate,
             search_expose_num, search_click_num, search_pay_goods_num, search_pay_order_num,
             recommend_expose_num, recommend_click_num, recommend_pay_goods_num, recommend_pay_order_num,
             last_updated_at
      FROM temu_product_flow_trend
      WHERE ${where.join(" AND ")}
      ORDER BY stat_date DESC, last_updated_at DESC
      LIMIT 60
    `).all(...params);
    return rows.reverse().map((item) => ({
      date: item.stat_date,
      exposeNum: item.expose_num,
      clickNum: item.click_num,
      detailVisitNum: item.detail_visit_num,
      detailVisitorNum: item.detail_visitor_num,
      addToCartUserNum: item.add_to_cart_user_num,
      collectUserNum: item.collect_user_num,
      payGoodsNum: item.pay_goods_num,
      payOrderNum: item.pay_order_num,
      buyerNum: item.buyer_num,
      exposePayConversionRate: item.expose_pay_conversion_rate,
      exposeClickConversionRate: item.expose_click_conversion_rate,
      clickPayConversionRate: item.click_pay_conversion_rate,
      searchExposeNum: item.search_expose_num,
      searchClickNum: item.search_click_num,
      searchPayGoodsNum: item.search_pay_goods_num,
      searchPayOrderNum: item.search_pay_order_num,
      recommendExposeNum: item.recommend_expose_num,
      recommendClickNum: item.recommend_click_num,
      recommendPayGoodsNum: item.recommend_pay_goods_num,
      recommendPayOrderNum: item.recommend_pay_order_num,
      updatedAt: item.last_updated_at,
    }));
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return [];
    throw error;
  }
}

function withProductFlowFallback(row, flow) {
  if (!flow) return row;
  const next = {
    ...row,
    ...productFlowPayload(flow),
  };
  next.mall_supplier_id = next.mall_supplier_id || flow.mall_id || null;
  next.title = next.title || flow.title || null;
  next.category_name = next.category_name || flow.category_name || null;
  next.thumb_url = next.thumb_url || flow.thumb_url || null;
  next.product_id = next.product_id || flow.product_id || null;
  next.goods_id = next.goods_id || flow.goods_id || null;
  return next;
}

function buildProductFlowSalesRow(flow) {
  const productId = normalizeId(flow.product_id);
  const goodsId = normalizeId(flow.goods_id);
  return withProductFlowFallback({
    flow_only: true,
    skc_id: productId ? `SPU-${productId}` : `GOODS-${goodsId}`,
    product_id: productId || null,
    goods_id: goodsId || null,
    mall_supplier_id: flow.mall_id || null,
    title: flow.title || null,
    category_name: flow.category_name || null,
    thumb_url: flow.thumb_url || null,
    sku_ext_code: null,
    today_sales: null,
    last7d_sales: null,
    last30d_sales: null,
    total_sales: null,
    warehouse_stock: null,
    occupy_stock: null,
    unavailable_stock: null,
    advice_qty: null,
    available_sale_days: null,
    declared_price_cents: null,
    price_currency: null,
    asf_score: null,
    comment_num: null,
    quality_after_sales_rate: null,
    supply_status: null,
    stock_status: null,
    close_jit_status: null,
    stat_date: flow.stat_date,
    sources_json: flow.sources_json,
    last_updated_at: flow.last_updated_at,
  }, flow);
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

r.get("/endpoint-candidates", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 120));
  const rows = db.prepare(`
    SELECT
      site,
      method,
      url_path,
      COUNT(*) AS count_total,
      MAX(ts) AS last_seen,
      MAX(status) AS last_status,
      MAX(body_size) AS last_body_size,
      MAX(page) AS last_page
    FROM capture_events
    WHERE tenant_id = ?
      AND kind LIKE '%discovery%'
    GROUP BY site, method, url_path
    ORDER BY last_seen DESC
    LIMIT ?
  `).all(tid, limit);
  res.json(rows);
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
      h.collector_enabled,
      h.collector_index,
      h.collector_last_target_key,
      h.collector_last_target_url,
      h.collector_last_targets_json,
      h.collector_updated_at,
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

r.get("/shop-monitor", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const now = Date.now();
  const last24 = now - 86400000;
  const rowsByMall = new Map();

  const ensureRow = (mallId, patch = {}) => {
    const id = normalizeId(mallId);
    if (!id || /^MALL-(DBG|EXT-E2E)/i.test(id)) return null;
    const current = rowsByMall.get(id) || {
      mall_id: id,
      site: null,
      mall_name: null,
      last_seen: null,
      last_capture_at: null,
      capture_count_24h: 0,
      stat_date: null,
      sale_volume: 0,
      seven_days_sale_volume: 0,
      thirty_days_sale_volume: 0,
      on_sale_product_number: 0,
      wait_product_number: 0,
      lack_skc_number: 0,
      advice_prepare_skc_number: 0,
      about_to_sell_out_number: 0,
      already_sold_out_number: 0,
      high_price_limit_number: 0,
      quality_after_sale_ratio_90d: null,
      product_skc_count: 0,
      product_stock_available: 0,
      product_occupy_stock: 0,
      product_unavailable_stock: 0,
      flow_product_count: 0,
      flow_expose_num: 0,
      flow_click_num: 0,
      flow_detail_visit_num: 0,
      flow_detail_visitor_num: 0,
      flow_add_to_cart_user_num: 0,
      flow_collect_user_num: 0,
      flow_pay_goods_num: 0,
      flow_pay_order_num: 0,
      flow_buyer_num: 0,
      flow_expose_pay_conversion_rate: null,
      flow_expose_click_conversion_rate: null,
      flow_click_pay_conversion_rate: null,
      flow_search_expose_num: 0,
      flow_search_click_num: 0,
      flow_search_pay_goods_num: 0,
      flow_search_pay_order_num: 0,
      flow_recommend_expose_num: 0,
      flow_recommend_click_num: 0,
      flow_recommend_pay_goods_num: 0,
      flow_recommend_pay_order_num: 0,
      activity_count: 0,
      bidding_activity_count: 0,
      coupon_activity_count: 0,
      activity_stock: 0,
      risk_count: 0,
      high_risk_count: 0,
      medium_risk_count: 0,
      stock_order_count: 0,
      pending_stock_order_count: 0,
      stock_order_demand_qty: 0,
      stock_order_delivered_qty: 0,
      after_sale_count: 0,
      pending_after_sale_count: 0,
      return_package_count: 0,
      after_sale_quantity: 0,
      after_sale_amount_cents: 0,
      last_activity_at: null,
      last_flow_at: null,
      last_risk_at: null,
      last_stock_order_at: null,
      last_after_sale_at: null,
      last_updated_at: null,
    };
    rowsByMall.set(id, { ...current, ...patch, mall_id: id });
    return rowsByMall.get(id);
  };

  const mallRows = optionalAll(db, `
    SELECT
      m.mall_id,
      m.site,
      m.mall_name,
      m.last_seen,
      COALESCE(e.capture_count_24h, 0) AS capture_count_24h,
      e.last_capture_at
    FROM mall_accounts m
    LEFT JOIN (
      SELECT
        mall_id,
        SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS capture_count_24h,
        MAX(ts) AS last_capture_at
      FROM capture_events
      WHERE tenant_id = ? AND mall_id <> ''
      GROUP BY mall_id
    ) e ON e.mall_id = m.mall_id
    WHERE m.tenant_id = ?
      AND m.mall_id <> ''
      AND m.mall_id NOT LIKE 'MALL-DBG%'
      AND m.mall_id NOT LIKE 'MALL-EXT-E2E%'
  `, [last24, tid, tid]);
  for (const row of mallRows) ensureRow(row.mall_id, row);

  const captureOnlyRows = optionalAll(db, `
    SELECT
      mall_id,
      MAX(site) AS site,
      SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS capture_count_24h,
      MAX(ts) AS last_capture_at
    FROM capture_events
    WHERE tenant_id = ?
      AND mall_id <> ''
      AND mall_id NOT LIKE 'MALL-DBG%'
      AND mall_id NOT LIKE 'MALL-EXT-E2E%'
    GROUP BY mall_id
  `, [last24, tid]);
  for (const row of captureOnlyRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      site: current.site || row.site || null,
      capture_count_24h: toNum(row.capture_count_24h),
      last_capture_at: row.last_capture_at || current.last_capture_at,
      last_seen: current.last_seen || row.last_capture_at || null,
    });
  }

  const shopRows = optionalAll(db, `
    SELECT *
    FROM (
      SELECT
        id, tenant_id, mall_id, site, stat_date,
        sale_volume, seven_days_sale_volume, thirty_days_sale_volume,
        on_sale_product_number, wait_product_number, lack_skc_number,
        advice_prepare_skc_number, about_to_sell_out_number,
        already_sold_out_number, high_price_limit_number,
        quality_after_sale_ratio_90d, last_updated_at,
        ROW_NUMBER() OVER (PARTITION BY mall_id ORDER BY stat_date DESC, last_updated_at DESC) AS rn
      FROM temu_shop_stats
      WHERE tenant_id = ? AND ${realMallWhere}
    )
    WHERE rn = 1
  `, [tid]);
  for (const row of shopRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      site: current.site || row.site || null,
      stat_date: row.stat_date || current.stat_date,
      sale_volume: toNum(row.sale_volume),
      seven_days_sale_volume: toNum(row.seven_days_sale_volume),
      thirty_days_sale_volume: toNum(row.thirty_days_sale_volume),
      on_sale_product_number: toNum(row.on_sale_product_number),
      wait_product_number: toNum(row.wait_product_number),
      lack_skc_number: toNum(row.lack_skc_number),
      advice_prepare_skc_number: toNum(row.advice_prepare_skc_number),
      about_to_sell_out_number: toNum(row.about_to_sell_out_number),
      already_sold_out_number: toNum(row.already_sold_out_number),
      high_price_limit_number: toNum(row.high_price_limit_number),
      quality_after_sale_ratio_90d: row.quality_after_sale_ratio_90d,
      last_updated_at: latestText(current.last_updated_at, row.last_updated_at),
    });
  }

  const salesRows = optionalAll(db, `
    WITH latest AS (
      SELECT mall_supplier_id AS mall_id, MAX(stat_date) AS stat_date
      FROM temu_sales_snapshot
      WHERE tenant_id = ? AND ${realSalesWhere}
      GROUP BY mall_supplier_id
    )
    SELECT
      s.mall_supplier_id AS mall_id,
      MAX(s.stat_date) AS stat_date,
      COUNT(DISTINCT s.skc_id) AS product_skc_count,
      SUM(COALESCE(s.today_sales, 0)) AS sale_volume,
      SUM(COALESCE(s.last7d_sales, 0)) AS seven_days_sale_volume,
      SUM(COALESCE(s.last30d_sales, 0)) AS thirty_days_sale_volume,
      SUM(COALESCE(s.warehouse_stock, 0)) AS product_stock_available,
      SUM(COALESCE(s.occupy_stock, 0)) AS product_occupy_stock,
      SUM(COALESCE(s.unavailable_stock, 0)) AS product_unavailable_stock,
      SUM(CASE WHEN COALESCE(s.warehouse_stock, 0) <= 0 THEN 1 ELSE 0 END) AS already_sold_out_number,
      SUM(CASE WHEN COALESCE(s.advice_qty, 0) > 0 THEN 1 ELSE 0 END) AS advice_prepare_skc_number,
      MAX(s.last_updated_at) AS last_updated_at
    FROM temu_sales_snapshot s
    JOIN latest l ON l.mall_id = s.mall_supplier_id AND l.stat_date = s.stat_date
    WHERE s.tenant_id = ? AND ${realSalesWhere}
    GROUP BY s.mall_supplier_id
  `, [tid, tid]);
  for (const row of salesRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      stat_date: current.stat_date || row.stat_date || null,
      product_skc_count: toNum(row.product_skc_count),
      sale_volume: current.sale_volume || toNum(row.sale_volume),
      seven_days_sale_volume: current.seven_days_sale_volume || toNum(row.seven_days_sale_volume),
      thirty_days_sale_volume: current.thirty_days_sale_volume || toNum(row.thirty_days_sale_volume),
      on_sale_product_number: current.on_sale_product_number || toNum(row.product_skc_count),
      product_stock_available: toNum(row.product_stock_available),
      product_occupy_stock: toNum(row.product_occupy_stock),
      product_unavailable_stock: toNum(row.product_unavailable_stock),
      already_sold_out_number: current.already_sold_out_number || toNum(row.already_sold_out_number),
      advice_prepare_skc_number: current.advice_prepare_skc_number || toNum(row.advice_prepare_skc_number),
      last_updated_at: latestText(current.last_updated_at, row.last_updated_at),
    });
  }

  const flowRows = optionalAll(db, `
    WITH latest AS (
      SELECT mall_id, MAX(stat_date) AS stat_date
      FROM temu_product_flow_snapshot
      WHERE tenant_id = ? AND ${realMallWhere}
      GROUP BY mall_id
    )
    SELECT
      f.mall_id,
      MAX(f.stat_date) AS flow_stat_date,
      COUNT(DISTINCT COALESCE(NULLIF(f.goods_id, ''), f.product_id)) AS flow_product_count,
      SUM(COALESCE(f.expose_num, 0)) AS flow_expose_num,
      SUM(COALESCE(f.click_num, 0)) AS flow_click_num,
      SUM(COALESCE(f.detail_visit_num, 0)) AS flow_detail_visit_num,
      SUM(COALESCE(f.detail_visitor_num, 0)) AS flow_detail_visitor_num,
      SUM(COALESCE(f.add_to_cart_user_num, 0)) AS flow_add_to_cart_user_num,
      SUM(COALESCE(f.collect_user_num, 0)) AS flow_collect_user_num,
      SUM(COALESCE(f.pay_goods_num, 0)) AS flow_pay_goods_num,
      SUM(COALESCE(f.pay_order_num, 0)) AS flow_pay_order_num,
      SUM(COALESCE(f.buyer_num, 0)) AS flow_buyer_num,
      CASE
        WHEN SUM(COALESCE(f.expose_num, 0)) > 0
          THEN SUM(COALESCE(f.expose_pay_conversion_rate, 0) * COALESCE(f.expose_num, 0)) / SUM(COALESCE(f.expose_num, 0))
        ELSE AVG(f.expose_pay_conversion_rate)
      END AS flow_expose_pay_conversion_rate,
      CASE
        WHEN SUM(COALESCE(f.expose_num, 0)) > 0
          THEN SUM(COALESCE(f.expose_click_conversion_rate, 0) * COALESCE(f.expose_num, 0)) / SUM(COALESCE(f.expose_num, 0))
        ELSE AVG(f.expose_click_conversion_rate)
      END AS flow_expose_click_conversion_rate,
      CASE
        WHEN SUM(COALESCE(f.click_num, 0)) > 0
          THEN SUM(COALESCE(f.click_pay_conversion_rate, 0) * COALESCE(f.click_num, 0)) / SUM(COALESCE(f.click_num, 0))
        ELSE AVG(f.click_pay_conversion_rate)
      END AS flow_click_pay_conversion_rate,
      SUM(COALESCE(f.search_expose_num, 0)) AS flow_search_expose_num,
      SUM(COALESCE(f.search_click_num, 0)) AS flow_search_click_num,
      SUM(COALESCE(f.search_pay_goods_num, 0)) AS flow_search_pay_goods_num,
      SUM(COALESCE(f.search_pay_order_num, 0)) AS flow_search_pay_order_num,
      SUM(COALESCE(f.recommend_expose_num, 0)) AS flow_recommend_expose_num,
      SUM(COALESCE(f.recommend_click_num, 0)) AS flow_recommend_click_num,
      SUM(COALESCE(f.recommend_pay_goods_num, 0)) AS flow_recommend_pay_goods_num,
      SUM(COALESCE(f.recommend_pay_order_num, 0)) AS flow_recommend_pay_order_num,
      MAX(f.last_updated_at) AS last_flow_at
    FROM temu_product_flow_snapshot f
    JOIN latest l ON l.mall_id = f.mall_id AND l.stat_date = f.stat_date
    WHERE f.tenant_id = ? AND f.mall_id <> ''
    GROUP BY f.mall_id
  `, [tid, tid]);
  for (const row of flowRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      stat_date: current.stat_date || row.flow_stat_date || null,
      flow_product_count: toNum(row.flow_product_count),
      flow_expose_num: toNum(row.flow_expose_num),
      flow_click_num: toNum(row.flow_click_num),
      flow_detail_visit_num: toNum(row.flow_detail_visit_num),
      flow_detail_visitor_num: toNum(row.flow_detail_visitor_num),
      flow_add_to_cart_user_num: toNum(row.flow_add_to_cart_user_num),
      flow_collect_user_num: toNum(row.flow_collect_user_num),
      flow_pay_goods_num: toNum(row.flow_pay_goods_num),
      flow_pay_order_num: toNum(row.flow_pay_order_num),
      flow_buyer_num: toNum(row.flow_buyer_num),
      flow_expose_pay_conversion_rate: row.flow_expose_pay_conversion_rate == null ? null : Number(row.flow_expose_pay_conversion_rate),
      flow_expose_click_conversion_rate: row.flow_expose_click_conversion_rate == null ? null : Number(row.flow_expose_click_conversion_rate),
      flow_click_pay_conversion_rate: row.flow_click_pay_conversion_rate == null ? null : Number(row.flow_click_pay_conversion_rate),
      flow_search_expose_num: toNum(row.flow_search_expose_num),
      flow_search_click_num: toNum(row.flow_search_click_num),
      flow_search_pay_goods_num: toNum(row.flow_search_pay_goods_num),
      flow_search_pay_order_num: toNum(row.flow_search_pay_order_num),
      flow_recommend_expose_num: toNum(row.flow_recommend_expose_num),
      flow_recommend_click_num: toNum(row.flow_recommend_click_num),
      flow_recommend_pay_goods_num: toNum(row.flow_recommend_pay_goods_num),
      flow_recommend_pay_order_num: toNum(row.flow_recommend_pay_order_num),
      last_flow_at: row.last_flow_at || current.last_flow_at,
      last_updated_at: latestText(current.last_updated_at, row.last_flow_at),
    });
  }

  const activityRows = optionalAll(db, `
    WITH latest AS (
      SELECT mall_id, MAX(stat_date) AS stat_date
      FROM temu_activity_snapshot
      WHERE tenant_id = ? AND ${realMallWhere}
      GROUP BY mall_id
    )
    SELECT
      a.mall_id,
      COUNT(*) AS activity_count,
      SUM(CASE WHEN a.activity_kind = 'bidding' THEN 1 ELSE 0 END) AS bidding_activity_count,
      SUM(CASE WHEN a.activity_kind = 'coupon' THEN 1 ELSE 0 END) AS coupon_activity_count,
      SUM(COALESCE(a.activity_stock, 0)) AS activity_stock,
      MAX(a.last_updated_at) AS last_activity_at
    FROM temu_activity_snapshot a
    JOIN latest l ON l.mall_id = a.mall_id AND l.stat_date = a.stat_date
    WHERE a.tenant_id = ? AND a.mall_id <> ''
    GROUP BY a.mall_id
  `, [tid, tid]);
  for (const row of activityRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      activity_count: toNum(row.activity_count),
      bidding_activity_count: toNum(row.bidding_activity_count),
      coupon_activity_count: toNum(row.coupon_activity_count),
      activity_stock: toNum(row.activity_stock),
      last_activity_at: row.last_activity_at || current.last_activity_at,
      last_updated_at: latestText(current.last_updated_at, row.last_activity_at),
    });
  }

  const riskRows = optionalAll(db, `
    WITH latest AS (
      SELECT mall_id, MAX(stat_date) AS stat_date
      FROM temu_operation_risk_snapshot
      WHERE tenant_id = ? AND ${realMallWhere}
      GROUP BY mall_id
    )
    SELECT
      r.mall_id,
      COUNT(*) AS risk_count,
      SUM(CASE WHEN r.severity = 'high' THEN 1 ELSE 0 END) AS high_risk_count,
      SUM(CASE WHEN r.severity = 'medium' THEN 1 ELSE 0 END) AS medium_risk_count,
      MAX(r.last_updated_at) AS last_risk_at
    FROM temu_operation_risk_snapshot r
    JOIN latest l ON l.mall_id = r.mall_id AND l.stat_date = r.stat_date
    WHERE r.tenant_id = ? AND r.mall_id <> ''
    GROUP BY r.mall_id
  `, [tid, tid]);
  for (const row of riskRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      risk_count: toNum(row.risk_count),
      high_risk_count: toNum(row.high_risk_count),
      medium_risk_count: toNum(row.medium_risk_count),
      last_risk_at: row.last_risk_at || current.last_risk_at,
      last_updated_at: latestText(current.last_updated_at, row.last_risk_at),
    });
  }

  const stockRows = optionalAll(db, `
    SELECT
      mall_id,
      COUNT(*) AS stock_order_count,
      SUM(COALESCE(demand_qty, 0)) AS stock_order_demand_qty,
      SUM(COALESCE(delivered_qty, 0)) AS stock_order_delivered_qty,
      SUM(CASE
        WHEN COALESCE(temu_status, '') LIKE '%完成%' THEN 0
        WHEN COALESCE(temu_status, '') LIKE '%取消%' THEN 0
        ELSE 1
      END) AS pending_stock_order_count,
      MAX(last_updated_at) AS last_stock_order_at
    FROM temu_stock_order_snapshot
    WHERE tenant_id = ? AND ${realMallWhere}
    GROUP BY mall_id
  `, [tid]);
  for (const row of stockRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      stock_order_count: toNum(row.stock_order_count),
      pending_stock_order_count: toNum(row.pending_stock_order_count),
      stock_order_demand_qty: toNum(row.stock_order_demand_qty),
      stock_order_delivered_qty: toNum(row.stock_order_delivered_qty),
      last_stock_order_at: row.last_stock_order_at || current.last_stock_order_at,
      last_updated_at: latestText(current.last_updated_at, row.last_stock_order_at),
    });
  }

  const afterSaleRows = optionalAll(db, `
    SELECT
      mall_id,
      COUNT(*) AS after_sale_count,
      SUM(CASE WHEN after_sale_type = 'return_package' THEN 1 ELSE 0 END) AS return_package_count,
      SUM(COALESCE(quantity, 0)) AS after_sale_quantity,
      SUM(COALESCE(amount_cents, 0)) AS after_sale_amount_cents,
      SUM(CASE
        WHEN LOWER(COALESCE(status, '')) LIKE '%done%' THEN 0
        WHEN LOWER(COALESCE(status, '')) LIKE '%finish%' THEN 0
        WHEN LOWER(COALESCE(status, '')) LIKE '%complete%' THEN 0
        WHEN LOWER(COALESCE(status, '')) LIKE '%cancel%' THEN 0
        WHEN LOWER(COALESCE(status, '')) LIKE '%close%' THEN 0
        WHEN COALESCE(status, '') LIKE '%完成%' THEN 0
        WHEN COALESCE(status, '') LIKE '%取消%' THEN 0
        WHEN COALESCE(status, '') LIKE '%关闭%' THEN 0
        WHEN COALESCE(status, '') LIKE '%结束%' THEN 0
        WHEN COALESCE(status, '') LIKE '%已处理%' THEN 0
        WHEN COALESCE(status, '') LIKE '%已签收%' THEN 0
        WHEN COALESCE(status, '') LIKE '%已入库%' THEN 0
        ELSE 1
      END) AS pending_after_sale_count,
      MAX(last_updated_at) AS last_after_sale_at
    FROM temu_after_sale_snapshot
    WHERE tenant_id = ? AND ${realMallWhere}
    GROUP BY mall_id
  `, [tid]);
  for (const row of afterSaleRows) {
    const current = ensureRow(row.mall_id);
    if (!current) continue;
    Object.assign(current, {
      after_sale_count: toNum(row.after_sale_count),
      pending_after_sale_count: toNum(row.pending_after_sale_count),
      return_package_count: toNum(row.return_package_count),
      after_sale_quantity: toNum(row.after_sale_quantity),
      after_sale_amount_cents: toNum(row.after_sale_amount_cents),
      last_after_sale_at: row.last_after_sale_at || current.last_after_sale_at,
      last_updated_at: latestText(current.last_updated_at, row.last_after_sale_at),
    });
  }

  const deviceRow = optionalGet(db, `
    SELECT COUNT(*) AS device_count
    FROM devices
    WHERE tenant_id = ?
  `, [tid], { device_count: 0 });

  const rows = Array.from(rowsByMall.values()).map((row) => ({
    ...row,
    last_seen: latestText(row.last_seen, row.last_capture_at, row.last_updated_at, row.last_flow_at, row.last_activity_at, row.last_risk_at, row.last_stock_order_at, row.last_after_sale_at),
  })).sort((left, right) => {
    const riskDiff = toNum(right.high_risk_count) - toNum(left.high_risk_count);
    if (riskDiff !== 0) return riskDiff;
    const afterSaleDiff = toNum(right.pending_after_sale_count) - toNum(left.pending_after_sale_count);
    if (afterSaleDiff !== 0) return afterSaleDiff;
    const activityDiff = toNum(right.activity_count) - toNum(left.activity_count);
    if (activityDiff !== 0) return activityDiff;
    return String(right.last_seen || "").localeCompare(String(left.last_seen || ""));
  });

  const totals = rows.reduce((acc, row) => ({
    mall_count: acc.mall_count + 1,
    capture_count_24h: acc.capture_count_24h + toNum(row.capture_count_24h),
    sale_volume: acc.sale_volume + toNum(row.sale_volume),
    seven_days_sale_volume: acc.seven_days_sale_volume + toNum(row.seven_days_sale_volume),
    thirty_days_sale_volume: acc.thirty_days_sale_volume + toNum(row.thirty_days_sale_volume),
    on_sale_product_number: acc.on_sale_product_number + toNum(row.on_sale_product_number),
    lack_skc_number: acc.lack_skc_number + toNum(row.lack_skc_number),
    advice_prepare_skc_number: acc.advice_prepare_skc_number + toNum(row.advice_prepare_skc_number),
    already_sold_out_number: acc.already_sold_out_number + toNum(row.already_sold_out_number),
    flow_product_count: acc.flow_product_count + toNum(row.flow_product_count),
    flow_expose_num: acc.flow_expose_num + toNum(row.flow_expose_num),
    flow_click_num: acc.flow_click_num + toNum(row.flow_click_num),
    flow_detail_visit_num: acc.flow_detail_visit_num + toNum(row.flow_detail_visit_num),
    flow_detail_visitor_num: acc.flow_detail_visitor_num + toNum(row.flow_detail_visitor_num),
    flow_add_to_cart_user_num: acc.flow_add_to_cart_user_num + toNum(row.flow_add_to_cart_user_num),
    flow_collect_user_num: acc.flow_collect_user_num + toNum(row.flow_collect_user_num),
    flow_pay_goods_num: acc.flow_pay_goods_num + toNum(row.flow_pay_goods_num),
    flow_pay_order_num: acc.flow_pay_order_num + toNum(row.flow_pay_order_num),
    flow_buyer_num: acc.flow_buyer_num + toNum(row.flow_buyer_num),
    flow_search_expose_num: acc.flow_search_expose_num + toNum(row.flow_search_expose_num),
    flow_search_click_num: acc.flow_search_click_num + toNum(row.flow_search_click_num),
    flow_search_pay_goods_num: acc.flow_search_pay_goods_num + toNum(row.flow_search_pay_goods_num),
    flow_search_pay_order_num: acc.flow_search_pay_order_num + toNum(row.flow_search_pay_order_num),
    flow_recommend_expose_num: acc.flow_recommend_expose_num + toNum(row.flow_recommend_expose_num),
    flow_recommend_click_num: acc.flow_recommend_click_num + toNum(row.flow_recommend_click_num),
    flow_recommend_pay_goods_num: acc.flow_recommend_pay_goods_num + toNum(row.flow_recommend_pay_goods_num),
    flow_recommend_pay_order_num: acc.flow_recommend_pay_order_num + toNum(row.flow_recommend_pay_order_num),
    activity_count: acc.activity_count + toNum(row.activity_count),
    risk_count: acc.risk_count + toNum(row.risk_count),
    high_risk_count: acc.high_risk_count + toNum(row.high_risk_count),
    stock_order_count: acc.stock_order_count + toNum(row.stock_order_count),
    pending_stock_order_count: acc.pending_stock_order_count + toNum(row.pending_stock_order_count),
    stock_order_demand_qty: acc.stock_order_demand_qty + toNum(row.stock_order_demand_qty),
    stock_order_delivered_qty: acc.stock_order_delivered_qty + toNum(row.stock_order_delivered_qty),
    after_sale_count: acc.after_sale_count + toNum(row.after_sale_count),
    pending_after_sale_count: acc.pending_after_sale_count + toNum(row.pending_after_sale_count),
    return_package_count: acc.return_package_count + toNum(row.return_package_count),
    after_sale_quantity: acc.after_sale_quantity + toNum(row.after_sale_quantity),
    after_sale_amount_cents: acc.after_sale_amount_cents + toNum(row.after_sale_amount_cents),
  }), {
    mall_count: 0,
    capture_count_24h: 0,
    sale_volume: 0,
    seven_days_sale_volume: 0,
    thirty_days_sale_volume: 0,
    on_sale_product_number: 0,
    lack_skc_number: 0,
    advice_prepare_skc_number: 0,
    already_sold_out_number: 0,
    flow_product_count: 0,
    flow_expose_num: 0,
    flow_click_num: 0,
    flow_detail_visit_num: 0,
    flow_detail_visitor_num: 0,
    flow_add_to_cart_user_num: 0,
    flow_collect_user_num: 0,
    flow_pay_goods_num: 0,
    flow_pay_order_num: 0,
    flow_buyer_num: 0,
    flow_search_expose_num: 0,
    flow_search_click_num: 0,
    flow_search_pay_goods_num: 0,
    flow_search_pay_order_num: 0,
    flow_recommend_expose_num: 0,
    flow_recommend_click_num: 0,
    flow_recommend_pay_goods_num: 0,
    flow_recommend_pay_order_num: 0,
    activity_count: 0,
    risk_count: 0,
    high_risk_count: 0,
    stock_order_count: 0,
    pending_stock_order_count: 0,
    stock_order_demand_qty: 0,
    stock_order_delivered_qty: 0,
    after_sale_count: 0,
    pending_after_sale_count: 0,
    return_package_count: 0,
    after_sale_quantity: 0,
    after_sale_amount_cents: 0,
  });
  totals.flow_expose_click_conversion_rate = totals.flow_expose_num > 0
    ? totals.flow_click_num / totals.flow_expose_num
    : null;
  totals.flow_click_pay_conversion_rate = totals.flow_click_num > 0
    ? totals.flow_pay_goods_num / totals.flow_click_num
    : null;
  totals.flow_expose_pay_conversion_rate = totals.flow_expose_num > 0
    ? totals.flow_pay_goods_num / totals.flow_expose_num
    : null;
  totals.device_count = toNum(deviceRow?.device_count);

  res.json({
    generated_at: new Date().toISOString(),
    rows,
    totals,
  });
});

r.get("/stock-orders", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const requestedStatus = req.query.status ? String(req.query.status) : "";
  const q = req.query.q ? String(req.query.q).trim() : "";
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 300));
  const where = ["tenant_id = ?", realMallWhere];
  const params = [tid];
  if (requestedMallId) {
    where.push("mall_id = ?");
    params.push(requestedMallId);
  }
  if (requestedStatus) {
    where.push("COALESCE(temu_status, '') = ?");
    params.push(requestedStatus);
  }
  if (q) {
    where.push(`(
      stock_order_no LIKE ?
      OR parent_order_no LIKE ?
      OR delivery_order_sn LIKE ?
      OR delivery_batch_sn LIKE ?
      OR product_name LIKE ?
      OR skc_id LIKE ?
      OR sku_id LIKE ?
      OR sku_ext_code LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }

  try {
    const rows = db.prepare(`
      SELECT id, mall_id, site, row_key, stock_order_no, parent_order_no,
             delivery_order_sn, delivery_batch_sn, product_id, skc_id, sku_id, sku_ext_code,
             product_name, spec_name, demand_qty, delivered_qty, temu_status, warehouse_group,
             receive_warehouse_id, receive_warehouse_name, urgency_info, order_time, latest_ship_at,
             raw_json, source_event_id, sources_json, first_seen_at, last_updated_at
      FROM temu_stock_order_snapshot
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE
          WHEN COALESCE(temu_status, '') LIKE '%取消%' THEN 5
          WHEN COALESCE(temu_status, '') LIKE '%完成%' THEN 4
          WHEN COALESCE(temu_status, '') LIKE '%已发%' THEN 3
          ELSE 1
        END,
        last_updated_at DESC
      LIMIT ?
    `).all(...params, limit);
    const summary = db.prepare(`
      SELECT COALESCE(temu_status, '') AS temu_status, COUNT(*) AS count, COALESCE(SUM(demand_qty), 0) AS demand_qty
      FROM temu_stock_order_snapshot
      WHERE ${where.join(" AND ")}
      GROUP BY COALESCE(temu_status, '')
      ORDER BY count DESC
    `).all(...params);
    res.json({ rows, summary });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return res.json({ rows: [], summary: [] });
    throw error;
  }
});

r.get("/after-sales", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const requestedStatus = req.query.status ? String(req.query.status) : "";
  const requestedType = req.query.type ? String(req.query.type) : "";
  const q = req.query.q ? String(req.query.q).trim() : "";
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 300));
  const where = ["tenant_id = ?", realMallWhere];
  const params = [tid];
  if (requestedMallId) {
    where.push("mall_id = ?");
    params.push(requestedMallId);
  }
  if (requestedStatus) {
    where.push("COALESCE(status, '') = ?");
    params.push(requestedStatus);
  }
  if (requestedType) {
    where.push("after_sale_type = ?");
    params.push(requestedType);
  }
  if (q) {
    where.push(`(
      package_no LIKE ?
      OR order_id LIKE ?
      OR product_name LIKE ?
      OR skc_id LIKE ?
      OR sku_id LIKE ?
      OR logistics_no LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }

  try {
    const rows = db.prepare(`
      SELECT id, mall_id, site, row_key, after_sale_type, package_no, order_id,
             product_id, skc_id, sku_id, product_name, quantity, status, reason,
             logistics_no, warehouse_name, amount_cents, currency, created_at_text,
             updated_at_text, raw_json, source_event_id, sources_json,
             first_seen_at, last_updated_at
      FROM temu_after_sale_snapshot
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(status, '')) LIKE '%done%' THEN 2
          WHEN LOWER(COALESCE(status, '')) LIKE '%finish%' THEN 2
          WHEN LOWER(COALESCE(status, '')) LIKE '%complete%' THEN 2
          WHEN LOWER(COALESCE(status, '')) LIKE '%cancel%' THEN 2
          WHEN LOWER(COALESCE(status, '')) LIKE '%close%' THEN 2
          WHEN COALESCE(status, '') LIKE '%完成%' THEN 2
          WHEN COALESCE(status, '') LIKE '%取消%' THEN 2
          WHEN COALESCE(status, '') LIKE '%关闭%' THEN 2
          WHEN COALESCE(status, '') LIKE '%结束%' THEN 2
          WHEN COALESCE(status, '') LIKE '%已处理%' THEN 2
          WHEN COALESCE(status, '') LIKE '%已签收%' THEN 2
          WHEN COALESCE(status, '') LIKE '%已入库%' THEN 2
          ELSE 1
        END,
        last_updated_at DESC
      LIMIT ?
    `).all(...params, limit);
    const summary = db.prepare(`
      SELECT after_sale_type, COALESCE(status, '') AS status, COUNT(*) AS count,
             COALESCE(SUM(quantity), 0) AS quantity,
             COALESCE(SUM(amount_cents), 0) AS amount_cents
      FROM temu_after_sale_snapshot
      WHERE ${where.join(" AND ")}
      GROUP BY after_sale_type, COALESCE(status, '')
      ORDER BY count DESC
    `).all(...params);
    res.json({ rows, summary });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return res.json({ rows: [], summary: [] });
    throw error;
  }
});

r.get("/operation-risks", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedDate = req.query.date;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const requestedType = req.query.type ? String(req.query.type) : "";
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 300));
  const explicitDate = typeof requestedDate === "string" && requestedDate;
  let date = explicitDate ? requestedDate : "";
  try {
    if (!date) {
      const latestWhere = ["tenant_id = ?", realMallWhere];
      const latestParams = [tid];
      if (requestedMallId) {
        latestWhere.push("mall_id = ?");
        latestParams.push(requestedMallId);
      }
      const latest = db.prepare(`
        SELECT stat_date AS date
        FROM temu_operation_risk_snapshot
        WHERE ${latestWhere.join(" AND ")}
        ORDER BY stat_date DESC, last_updated_at DESC
        LIMIT 1
      `).get(...latestParams);
      date = latest?.date || new Date().toISOString().slice(0, 10);
    }
    const where = ["tenant_id = ?", "stat_date = ?", realMallWhere];
    const params = [tid, date];
    if (requestedMallId) {
      where.push("mall_id = ?");
      params.push(requestedMallId);
    }
    if (requestedType) {
      where.push("risk_type = ?");
      params.push(requestedType);
    }
    const rows = db.prepare(`
      SELECT id, mall_id, site, stat_date, risk_type, risk_key, risk_title,
             risk_status, severity, product_id, skc_id, goods_id, order_id,
             quantity, metric_json, raw_json, source_event_id, sources_json, last_updated_at
      FROM temu_operation_risk_snapshot
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        last_updated_at DESC
      LIMIT ?
    `).all(...params, limit);
    const summary = db.prepare(`
      SELECT risk_type, severity, COUNT(*) AS count
      FROM temu_operation_risk_snapshot
      WHERE ${where.join(" AND ")}
      GROUP BY risk_type, severity
      ORDER BY count DESC
    `).all(...params);
    res.json({ date, rows, summary });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return res.json({ date, rows: [], summary: [] });
    throw error;
  }
});

// ================= SKC 主体聚合查询 =================

// TEMU sales snapshots: ?date=YYYY-MM-DD
r.get("/temu-sales", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedDate = req.query.date;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const explicitDate = typeof requestedDate === "string" && requestedDate;
  const includeFlowOnly = req.query.include_flow_only === "1";
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || 3000));
  let date = explicitDate ? requestedDate : "";
  if (!date) {
    const latestWhere = ["tenant_id = ?", realSalesWhere];
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
  const where = ["tenant_id = ?", "stat_date = ?", realSalesWhere];
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
    LIMIT ?
  `).all(...params, limit);
  const flowRows = getProductFlowRows(db, tid, requestedMallId, date, Boolean(explicitDate), limit);
  const flowByKey = new Map();
  for (const flow of flowRows) {
    for (const key of productFlowKeys(flow)) {
      if (!flowByKey.has(key)) flowByKey.set(key, flow);
    }
  }
  const usedFlowKeys = new Set();
  const rawEventCache = new Map();
  const payloadRows = rows.map((row) => {
    const flow = productFlowKeys(row).map((key) => flowByKey.get(key)).find(Boolean);
    if (flow) {
      for (const key of productFlowKeys(flow)) usedFlowKeys.add(key);
    }
    const rawPayload = getRawProductPayload(db, tid, row, rawEventCache);
    const trendPayload = getSkuSalesTrendPayload(db, tid, rawPayload.raw_item, row.mall_supplier_id);
    const enriched = withTrendSalesFallback(withProductFlowFallback({
      ...row,
      ...rawPayload,
    }, flow), trendPayload);
    const flowTrendDaily = getProductFlowTrendPayload(db, tid, enriched);
    return flowTrendDaily.length ? { ...enriched, flow_trend_daily: flowTrendDaily } : enriched;
  });
  if (includeFlowOnly) {
    for (const flow of flowRows) {
      const keys = productFlowKeys(flow);
      if (keys.some((key) => usedFlowKeys.has(key))) continue;
      const flowRow = buildProductFlowSalesRow(flow);
      const flowPayload = {
        ...flowRow,
        ...getRawProductPayload(db, tid, flowRow, rawEventCache),
      };
      const flowTrendDaily = getProductFlowTrendPayload(db, tid, flowPayload);
      payloadRows.push(flowTrendDaily.length ? { ...flowPayload, flow_trend_daily: flowTrendDaily } : flowPayload);
      for (const key of keys) usedFlowKeys.add(key);
    }
  }
  payloadRows.sort((left, right) => {
    const leftSales = Number(left.today_sales ?? left.total_sales ?? 0) || 0;
    const rightSales = Number(right.today_sales ?? right.total_sales ?? 0) || 0;
    if (rightSales !== leftSales) return rightSales - leftSales;
    return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
  });
  res.json({
    date,
    rows: payloadRows,
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

r.get("/activity", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const requestedDate = req.query.date;
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const requestedKind = req.query.kind ? String(req.query.kind) : "";
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 1000));
  const explicitDate = typeof requestedDate === "string" && requestedDate;
  let date = explicitDate ? requestedDate : "";
  try {
    if (!date) {
      const latestWhere = ["tenant_id = ?", realMallWhere];
      const latestParams = [tid];
      if (requestedMallId) {
        latestWhere.push("mall_id = ?");
        latestParams.push(requestedMallId);
      }
      const latest = db.prepare(`
        SELECT stat_date AS date
        FROM temu_activity_snapshot
        WHERE ${latestWhere.join(" AND ")}
        ORDER BY stat_date DESC, last_updated_at DESC
        LIMIT 1
      `).get(...latestParams);
      date = latest?.date || new Date().toISOString().slice(0, 10);
    }
    const where = ["tenant_id = ?", "stat_date = ?", realMallWhere];
    const params = [tid, date];
    if (requestedMallId) {
      where.push("mall_id = ?");
      params.push(requestedMallId);
    }
    if (requestedKind) {
      where.push("activity_kind = ?");
      params.push(requestedKind);
    }
    const rows = db.prepare(`
      SELECT id, mall_id, site, stat_date, row_key, activity_kind, activity_id,
             activity_title, activity_type, activity_status, product_id, skc_id, goods_id,
             signup_price_cents, suggested_price_cents, price_currency, activity_stock,
             signup_price_diff_cents,
             start_at, end_at, metric_json, raw_json, source_event_id,
             sources_json, last_updated_at
      FROM temu_activity_snapshot
      WHERE ${where.join(" AND ")}
      ORDER BY last_updated_at DESC
      LIMIT ?
    `).all(...params, limit);
    const summary = db.prepare(`
      SELECT activity_kind, COUNT(*) AS count
      FROM temu_activity_snapshot
      WHERE ${where.join(" AND ")}
      GROUP BY activity_kind
      ORDER BY count DESC
    `).all(...params);
    res.json({ date, rows, summary });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return res.json({ date, rows: [], summary: [] });
    throw error;
  }
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
  const limit = Math.min(10000, Number(req.query.limit) || 100);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = ["tenant_id = ?", realMallWhere, "skc_id NOT IN ('SKC-EXT-E2E', 'SKC-DBG')"];
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
  const requestedMallId = req.query.mall_id ? String(req.query.mall_id) : "";
  const where = ["tenant_id = ?", "skc_id = ?", realMallWhere, "skc_id NOT IN ('SKC-EXT-E2E', 'SKC-DBG')"];
  const params = [tid, req.params.id];
  if (requestedMallId) {
    where.push("mall_id = ?");
    params.push(requestedMallId);
  }
  const row = db.prepare(`
    SELECT * FROM skc_snapshots WHERE ${where.join(" AND ")}
    ORDER BY last_updated_at DESC
    LIMIT 1
  `).get(...params);
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
