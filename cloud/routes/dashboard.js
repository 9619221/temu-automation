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

function getProductFlowRows(db, tenantId, requestedMallId, requestedDate, explicitDate) {
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
      LIMIT 200
    `).all(...params);
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
  const includeFlowOnly = req.query.include_flow_only === "1";
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
    LIMIT 200
  `).all(...params);
  const flowRows = getProductFlowRows(db, tid, requestedMallId, date, Boolean(explicitDate));
  const flowByKey = new Map();
  for (const flow of flowRows) {
    for (const key of productFlowKeys(flow)) {
      if (!flowByKey.has(key)) flowByKey.set(key, flow);
    }
  }
  const usedFlowKeys = new Set();
  const payloadRows = rows.map((row) => {
    const flow = productFlowKeys(row).map((key) => flowByKey.get(key)).find(Boolean);
    if (flow) {
      for (const key of productFlowKeys(flow)) usedFlowKeys.add(key);
    }
    const rawPayload = getRawProductPayload(db, tid, row);
    const trendPayload = getSkuSalesTrendPayload(db, tid, rawPayload.raw_item, row.mall_supplier_id);
    return withTrendSalesFallback(withProductFlowFallback({
      ...row,
      ...rawPayload,
    }, flow), trendPayload);
  });
  if (includeFlowOnly) {
    for (const flow of flowRows) {
      const keys = productFlowKeys(flow);
      if (keys.some((key) => usedFlowKeys.has(key))) continue;
      const flowRow = buildProductFlowSalesRow(flow);
      payloadRows.push({
        ...flowRow,
        ...getRawProductPayload(db, tid, flowRow),
      });
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
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
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
             activity_title, activity_status, product_id, skc_id, goods_id,
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

r.get("/jst-purchase-inbound", (req, res) => {
  const db = getDb();
  const tid = req.user.tid;
  const q = normalizeId(req.query.q);
  const accountName = normalizeId(req.query.account_name || req.query.accountName);
  const supplier = normalizeId(req.query.supplier);
  const status = normalizeId(req.query.status);
  const dateFrom = normalizeId(req.query.date_from || req.query.dateFrom);
  const dateTo = normalizeId(req.query.date_to || req.query.dateTo);
  const limit = Math.max(1, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = ["line.tenant_id = @tenant_id"];
  const params = {
    tenant_id: tid,
    q: `%${q}%`,
    account_name: accountName,
    supplier: `%${supplier}%`,
    status,
    date_from: dateFrom,
    date_to: dateTo,
    limit,
    offset,
  };
  if (q) {
    where.push(`(
      line.receipt_no LIKE @q
      OR line.purchase_no LIKE @q
      OR line.online_purchase_no LIKE @q
      OR line.sku_code LIKE @q
      OR line.product_name LIKE @q
      OR line.supplier_name LIKE @q
      OR orders.tracking_no LIKE @q
    )`);
  }
  if (accountName) where.push("line.account_name = @account_name");
  if (supplier) where.push("line.supplier_name LIKE @supplier");
  if (status) where.push("line.status = @status");
  if (dateFrom) where.push("DATE(COALESCE(line.inbound_at, line.created_at)) >= DATE(@date_from)");
  if (dateTo) where.push("DATE(COALESCE(line.inbound_at, line.created_at)) <= DATE(@date_to)");
  const whereSql = where.join(" AND ");

  try {
    const rows = db.prepare(`
      SELECT
        line.line_id,
        line.receipt_no,
        line.purchase_no,
        line.online_purchase_no,
        line.account_name,
        line.supplier_name,
        line.supplier_code,
        line.operation_warehouse_name,
        line.warehouse_name,
        line.status,
        line.finance_status,
        line.inbound_type,
        line.created_at,
        line.inbound_at,
        line.archived_at,
        line.sku_code,
        line.product_name,
        line.style_code,
        line.color_spec,
        line.image_url,
        line.product_tag,
        line.qty,
        line.unit_price,
        line.amount,
        line.warehouse_available_qty,
        line.bind_location,
        line.remark,
        orders.total_qty AS order_total_qty,
        orders.total_amount AS order_total_amount,
        orders.freight_amount AS order_freight_amount,
        orders.paid_amount AS order_paid_amount,
        orders.purchaser_name,
        orders.creator_name,
        orders.logistics_company,
        orders.tracking_no,
        orders.labels
      FROM jst_purchase_inbound_lines line
      LEFT JOIN jst_purchase_inbound_orders orders
        ON orders.tenant_id = line.tenant_id AND orders.receipt_no = line.receipt_no
      WHERE ${whereSql}
      ORDER BY COALESCE(line.inbound_at, line.created_at) DESC, CAST(line.receipt_no AS INTEGER) DESC, line.line_id ASC
      LIMIT @limit OFFSET @offset
    `).all(params);
    const total = db.prepare(`
      SELECT COUNT(*) AS total
      FROM jst_purchase_inbound_lines line
      LEFT JOIN jst_purchase_inbound_orders orders
        ON orders.tenant_id = line.tenant_id AND orders.receipt_no = line.receipt_no
      WHERE ${whereSql}
    `).get(params).total;
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS line_count,
        COUNT(DISTINCT line.receipt_no) AS receipt_count,
        COALESCE(SUM(line.qty), 0) AS total_qty,
        COALESCE(SUM(line.amount), 0) AS total_amount
      FROM jst_purchase_inbound_lines line
      LEFT JOIN jst_purchase_inbound_orders orders
        ON orders.tenant_id = line.tenant_id AND orders.receipt_no = line.receipt_no
      WHERE ${whereSql}
    `).get(params);
    const options = {
      accounts: db.prepare(`
        SELECT account_name AS value, COUNT(*) AS count
        FROM jst_purchase_inbound_lines
        WHERE tenant_id = ? AND NULLIF(TRIM(COALESCE(account_name, '')), '') IS NOT NULL
        GROUP BY account_name
        ORDER BY account_name COLLATE NOCASE
      `).all(tid),
      statuses: db.prepare(`
        SELECT status AS value, COUNT(*) AS count
        FROM jst_purchase_inbound_lines
        WHERE tenant_id = ? AND NULLIF(TRIM(COALESCE(status, '')), '') IS NOT NULL
        GROUP BY status
        ORDER BY count DESC, status
      `).all(tid),
      suppliers: db.prepare(`
        SELECT supplier_name AS value, COUNT(*) AS count
        FROM jst_purchase_inbound_lines
        WHERE tenant_id = ? AND NULLIF(TRIM(COALESCE(supplier_name, '')), '') IS NOT NULL
        GROUP BY supplier_name
        ORDER BY count DESC, supplier_name
        LIMIT 300
      `).all(tid),
    };
    res.json({ rows, total, limit, offset, summary, options });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return res.json({
        rows: [],
        total: 0,
        limit,
        offset,
        summary: { line_count: 0, receipt_count: 0, total_qty: 0, total_amount: 0 },
        options: { accounts: [], statuses: [], suppliers: [] },
      });
    }
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
  const limit = Math.min(500, Number(req.query.limit) || 100);
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
