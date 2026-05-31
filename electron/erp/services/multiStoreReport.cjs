// 多店报表服务：fetch 云端 /api/dashboard/report/by-store + join 本地 erp_temu_malls
// + 跨库聚合真实营收/成本/毛利（ATTACH cloud.temu_sales_snapshot × 本地 erp_skus 成本台账）
// 输出按 store_code 排序的店铺指标列表，供桌面端报表页消费
//
// host 模式：ipc.cjs 直调；client 模式：lanServer 暴露路由让 client 远程调
//
// 金额口径（与用户确认）：
//   营收 = Σ(申报价 declared_price_cents/100 × 当日销量 today_sales)  —— 全托管下申报价=供货结算单价
//   成本 = Σ(当日销量 × 加权平均成本 weighted_avg_cost)
//   毛利 = 营收 − 成本（最简口径，不扣运费/退款）
//   join 键：cloud.temu_sales_snapshot.sku_ext_code == erp_skus.internal_sku_code

const CLOUD_BASE = "https://erp.temu.chat/cloud";
const CLOUD_LOGIN_USER = "admin";
const CLOUD_LOGIN_PASS = "cjl20020421";

// 进程级 token 缓存
let cachedToken = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; // JWT 默认 1h，留 10 分钟余量

async function loginCloud(fetchImpl) {
  const resp = await fetchImpl(`${CLOUD_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CLOUD_LOGIN_USER, password: CLOUD_LOGIN_PASS }),
  });
  if (!resp.ok) {
    throw new Error(`cloud login failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (!data?.token) throw new Error("cloud login: no token in response");
  cachedToken = data.token;
  cachedTokenAt = Date.now();
  return cachedToken;
}

async function getToken(fetchImpl) {
  if (cachedToken && Date.now() - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;
  return loginCloud(fetchImpl);
}

async function fetchCloudReport(options = {}) {
  const fetchImpl = typeof fetch === "function" ? fetch : (await import("undici")).fetch;
  const includeTest = options.includeTest ? "1" : "0";
  let token = await getToken(fetchImpl);
  let resp = await fetchImpl(`${CLOUD_BASE}/api/dashboard/report/by-store?include_test=${includeTest}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 401) {
    // token 失效，强制重登一次
    cachedToken = null;
    token = await loginCloud(fetchImpl);
    resp = await fetchImpl(`${CLOUD_BASE}/api/dashboard/report/by-store?include_test=${includeTest}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!resp.ok) {
    throw new Error(`cloud report HTTP ${resp.status}`);
  }
  return await resp.json();
}

function readMallDictionary(db) {
  try {
    return db.prepare(`
      SELECT mall_id, mall_name, store_code, site, status, remark, owner
      FROM erp_temu_malls
    `).all();
  } catch (error) {
    const msg = String(error?.message || "");
    if (/no such table/i.test(msg)) return [];
    // owner 列在旧库可能还没迁移，降级再查一次（不含 owner）
    if (/no such column/i.test(msg)) {
      try {
        return db.prepare(`
          SELECT mall_id, mall_name, store_code, site, status, remark, NULL AS owner
          FROM erp_temu_malls
        `).all();
      } catch (e2) {
        if (/no such table/i.test(String(e2?.message || ""))) return [];
        throw e2;
      }
    }
    throw error;
  }
}

// ===== 跨库营收/成本聚合 =====

const REAL_SALES_WHERE =
  "s.mall_supplier_id <> '' AND s.mall_supplier_id NOT IN ('MALL-EXT-E2E') " +
  "AND s.skc_id NOT IN ('SKC-EXT-E2E','SKC-DBG')";

// cloud 库当前单租户。by-store 本地聚合按此过滤（dashboard.js 用登录 user tid，ERP 进程无此上下文）。
const DEFAULT_CLOUD_TENANT = "default-tenant";

function toNum(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function optionalAllLocal(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ""))) return [];
    throw error;
  }
}

// 把 'YYYY-MM-DD' 偏移 n 天（n 可为负），返回 'YYYY-MM-DD'
function shiftDate(dateStr, days) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return dateStr;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function emptyWindow() {
  return { revenue: 0, cost: 0, gross_profit: 0, qty: 0 };
}

function emptyFinancials() {
  return {
    latest_date: null,
    today: emptyWindow(),
    last7d: { ...emptyWindow(), revenue_prev: 0, rev_wow: null },
    last30d: { ...emptyWindow(), revenue_prev: 0, rev_mom: null },
    cost_coverage: null,
    trend_daily: [],
  };
}

// 返回 Map<mall_id, financials>。attachCloudDb 失败时返回 null（前端据此知道金额维度不可用）。
function buildFinancialsByMall(db, attachCloudDb) {
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return null;
  }
  let latest;
  try {
    latest = db.prepare("SELECT MAX(stat_date) AS d FROM cloud.temu_sales_snapshot").get()?.d;
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return null;
    throw error;
  }
  if (!latest) return new Map();

  const since = shiftDate(latest, -59); // 覆盖 last30d + prev30d 环比
  const rows = db.prepare(`
    SELECT s.mall_supplier_id AS mall_id, s.stat_date AS d,
           SUM(COALESCE(s.declared_price_cents,0)/100.0 * COALESCE(s.today_sales,0)) AS revenue,
           SUM(COALESCE(s.today_sales,0) * COALESCE(k.wac,0)) AS cost,
           SUM(COALESCE(s.today_sales,0)) AS qty,
           SUM(CASE WHEN COALESCE(s.today_sales,0) > 0 THEN 1 ELSE 0 END) AS sku_rows,
           SUM(CASE WHEN COALESCE(s.today_sales,0) > 0 AND COALESCE(k.wac,0) > 0 THEN 1 ELSE 0 END) AS cost_rows
      FROM cloud.temu_sales_snapshot s
      LEFT JOIN (
        SELECT internal_sku_code, MAX(weighted_avg_cost) AS wac
          FROM erp_skus GROUP BY internal_sku_code
      ) k ON k.internal_sku_code = s.sku_ext_code
     WHERE ${REAL_SALES_WHERE}
       AND s.stat_date >= ? AND s.stat_date <= ?
     GROUP BY s.mall_supplier_id, s.stat_date
  `).all(since, latest);

  const d7start = shiftDate(latest, -6);
  const d7prevStart = shiftDate(latest, -13);
  const d7prevEnd = shiftDate(latest, -7);
  const d30start = shiftDate(latest, -29);
  const d30prevStart = shiftDate(latest, -59);
  const d30prevEnd = shiftDate(latest, -30);

  const byMall = new Map();
  const ensure = (mallId) => {
    if (!byMall.has(mallId)) {
      const f = emptyFinancials();
      f.latest_date = latest;
      f._sku_rows = 0;
      f._cost_rows = 0;
      f._trend = new Map();
      byMall.set(mallId, f);
    }
    return byMall.get(mallId);
  };

  for (const row of rows) {
    const f = ensure(row.mall_id);
    const rev = Number(row.revenue) || 0;
    const cost = Number(row.cost) || 0;
    const qty = Number(row.qty) || 0;
    const gp = rev - cost;
    const d = row.d;

    f._trend.set(d, { date: d, revenue: rev, gross_profit: gp });

    if (d === latest) {
      f.today.revenue += rev; f.today.cost += cost; f.today.gross_profit += gp; f.today.qty += qty;
    }
    if (d >= d7start && d <= latest) {
      f.last7d.revenue += rev; f.last7d.cost += cost; f.last7d.gross_profit += gp; f.last7d.qty += qty;
      f._sku_rows += Number(row.sku_rows) || 0;
      f._cost_rows += Number(row.cost_rows) || 0;
    }
    if (d >= d7prevStart && d <= d7prevEnd) {
      f.last7d.revenue_prev += rev;
    }
    if (d >= d30start && d <= latest) {
      f.last30d.revenue += rev; f.last30d.cost += cost; f.last30d.gross_profit += gp; f.last30d.qty += qty;
    }
    if (d >= d30prevStart && d <= d30prevEnd) {
      f.last30d.revenue_prev += rev;
    }
  }

  // 收尾：算环比、成本覆盖率、趋势数组
  for (const f of byMall.values()) {
    f.last7d.rev_wow = f.last7d.revenue_prev > 0
      ? (f.last7d.revenue - f.last7d.revenue_prev) / f.last7d.revenue_prev
      : null;
    f.last30d.rev_mom = f.last30d.revenue_prev > 0
      ? (f.last30d.revenue - f.last30d.revenue_prev) / f.last30d.revenue_prev
      : null;
    f.cost_coverage = f._sku_rows > 0 ? f._cost_rows / f._sku_rows : null;
    f.trend_daily = Array.from(f._trend.values()).sort((a, b) => a.date.localeCompare(b.date));
    delete f._trend; delete f._sku_rows; delete f._cost_rows;
  }

  return byMall;
}

// 本地 ATTACH cloud 直接聚合 by-store（复刻 cloud dashboard.js /report/by-store）。
// 前提：db 已 ATTACH cloud。绕开 cloud HTTP 单进程瓶颈（by-store 重聚合会卡死 cloud event loop）。
function buildByStoreLocal(db, options = {}) {
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const includeTest = !!options.includeTest;
  const excludeMallIds = includeTest ? [] : ["MALL-EXT-E2E", "MALL-DBG"];
  const ph = excludeMallIds.map(() => "?").join(",");
  const baseMallFilter = excludeMallIds.length ? `AND mall_id NOT IN (${ph})` : "";
  const salesMallFilter = excludeMallIds.length ? `AND mall_supplier_id NOT IN (${ph})` : "";

  const malls = optionalAllLocal(db,
    `SELECT mall_id, MAX(mall_name) AS mall_name, MAX(site) AS site, MAX(last_seen) AS last_seen_at
       FROM cloud.mall_accounts
      WHERE tenant_id = ? AND mall_id <> '' ${baseMallFilter}
      GROUP BY mall_id`, [tid, ...excludeMallIds]);

  // today_sales/last7d_sales/last30d_sales 是 Temu 在每个 stat_date 当天算好的快照值，
  // 表里每天每 SKU 一行（保留历史），所以只能取每店最新 stat_date 当天，绝不可跨天 SUM（否则虚高 N 倍）。
  const salesRows = optionalAllLocal(db,
    `WITH latest AS (
       SELECT mall_supplier_id, MAX(stat_date) AS sd
         FROM cloud.temu_sales_snapshot
        WHERE tenant_id = ? AND mall_supplier_id <> '' ${salesMallFilter}
          AND skc_id NOT IN ('SKC-EXT-E2E','SKC-DBG')
        GROUP BY mall_supplier_id
     )
     SELECT s.mall_supplier_id AS mall_id,
            SUM(COALESCE(s.today_sales,0))   AS sales_today_qty,
            SUM(COALESCE(s.last7d_sales,0))  AS sales_7d_qty,
            SUM(COALESCE(s.last30d_sales,0)) AS sales_30d_qty,
            COUNT(DISTINCT s.skc_id) AS sku_count
       FROM cloud.temu_sales_snapshot s
       JOIN latest l ON l.mall_supplier_id = s.mall_supplier_id AND l.sd = s.stat_date
      WHERE s.tenant_id = ? AND s.skc_id NOT IN ('SKC-EXT-E2E','SKC-DBG')
      GROUP BY s.mall_supplier_id`,
    [tid, ...excludeMallIds, tid]);
  const salesMap = new Map(salesRows.map((r) => [r.mall_id, r]));

  // 待发口径：未发完(delivered<demand) 且排除终态。temu_status 是裸数字码、按 source_type 混 3 套枚举，
  // 中文 LIKE 对数字码失效(老坑)。证据：stock_order 码 7=已完成(已发完,数量口径自动排除)、
  // 8=已取消(delivered=0 全为 0 + applyDeleteStatus=2 + 量级远超销量)，故按数量排除 7、按状态排除 8；
  // 兼容历史中文状态。7/8 只出现在 stock_order 套，排除不误伤 shipping_list/shipping_desk。
  const stockRows = optionalAllLocal(db,
    `SELECT mall_id, COUNT(*) AS total_orders,
            SUM(CASE WHEN COALESCE(delivered_qty,0) < COALESCE(demand_qty,0)
                      AND COALESCE(temu_status,'') NOT IN ('7','8')
                      AND temu_status NOT LIKE '%已完成%' AND temu_status NOT LIKE '%已发货%'
                      AND temu_status NOT LIKE '%已签收%' AND temu_status NOT LIKE '%取消%'
                     THEN 1 ELSE 0 END) AS pending_orders,
            SUM(COALESCE(demand_qty,0))    AS demand_qty_total,
            SUM(COALESCE(delivered_qty,0)) AS delivered_qty_total
       FROM cloud.temu_stock_order_snapshot
      WHERE tenant_id = ? AND mall_id <> '' ${baseMallFilter}
      GROUP BY mall_id`, [tid, ...excludeMallIds]);
  const stockMap = new Map(stockRows.map((r) => [r.mall_id, r]));

  const activityRows = optionalAllLocal(db,
    `SELECT mall_id, COUNT(*) AS activity_count,
            COUNT(DISTINCT activity_id) AS unique_activities,
            COUNT(DISTINCT skc_id)      AS activity_skc_count
       FROM cloud.temu_activity_snapshot
      WHERE tenant_id = ? AND mall_id <> '' ${baseMallFilter}
      GROUP BY mall_id`, [tid, ...excludeMallIds]);
  const activityMap = new Map(activityRows.map((r) => [r.mall_id, r]));

  const shopStatsRows = optionalAllLocal(db,
    `WITH latest AS (
       SELECT mall_id, MAX(stat_date) AS stat_date
         FROM cloud.temu_shop_stats
        WHERE tenant_id = ? AND mall_id <> '' ${baseMallFilter}
        GROUP BY mall_id
     )
     SELECT s.mall_id, s.stat_date, s.sale_volume, s.seven_days_sale_volume, s.thirty_days_sale_volume,
            s.on_sale_product_number, s.wait_product_number, s.lack_skc_number, s.advice_prepare_skc_number,
            s.about_to_sell_out_number, s.already_sold_out_number, s.high_price_limit_number,
            s.quality_after_sale_ratio_90d, s.last_updated_at
       FROM cloud.temu_shop_stats s
       JOIN latest l ON l.mall_id = s.mall_id AND l.stat_date = s.stat_date
      WHERE s.tenant_id = ?`, [tid, ...excludeMallIds, tid]);
  const shopStatsMap = new Map(shopStatsRows.map((r) => [r.mall_id, r]));

  const healthRows = optionalAllLocal(db,
    `SELECT mall_id, MAX(received_at) AS last_capture_at, COUNT(*) AS captures_total
       FROM cloud.capture_events
      WHERE tenant_id = ? AND mall_id IS NOT NULL AND mall_id <> '' ${baseMallFilter}
      GROUP BY mall_id`, [tid, ...excludeMallIds]);
  const healthMap = new Map(healthRows.map((r) => [r.mall_id, r]));

  const afterSalesRows = optionalAllLocal(db,
    `SELECT mall_id, COUNT(*) AS after_sales_count
       FROM cloud.temu_after_sale_snapshot
      WHERE tenant_id = ? AND mall_id <> '' ${baseMallFilter}
      GROUP BY mall_id`, [tid, ...excludeMallIds]);
  const afterSalesMap = new Map(afterSalesRows.map((r) => [r.mall_id, r]));

  const now = Date.now();
  const stores = malls.map((m) => {
    const s = salesMap.get(m.mall_id) || {};
    const o = stockMap.get(m.mall_id) || {};
    const a = activityMap.get(m.mall_id) || {};
    const ss = shopStatsMap.get(m.mall_id) || {};
    const h = healthMap.get(m.mall_id) || {};
    const af = afterSalesMap.get(m.mall_id) || {};
    const lastCaptureAt = Number(h.last_capture_at || 0);
    return {
      mall_id: m.mall_id,
      mall_name: m.mall_name || null,
      site: m.site || null,
      mall_last_seen: m.last_seen_at || null,
      sales: {
        today_qty: toNum(s.sales_today_qty),
        last7d_qty: toNum(s.sales_7d_qty),
        last30d_qty: toNum(s.sales_30d_qty),
        sku_count: toNum(s.sku_count),
      },
      stock_orders: {
        total: toNum(o.total_orders),
        pending: toNum(o.pending_orders),
        demand_qty: toNum(o.demand_qty_total),
        delivered_qty: toNum(o.delivered_qty_total),
      },
      activities: {
        count: toNum(a.activity_count),
        unique: toNum(a.unique_activities),
        skc_count: toNum(a.activity_skc_count),
      },
      shop_stats: {
        stat_date: ss.stat_date || null,
        sale_volume: toNum(ss.sale_volume),
        sale_7d: toNum(ss.seven_days_sale_volume),
        sale_30d: toNum(ss.thirty_days_sale_volume),
        on_sale_skc: toNum(ss.on_sale_product_number),
        wait_skc: toNum(ss.wait_product_number),
        lack_skc: toNum(ss.lack_skc_number),
        advice_prepare_skc: toNum(ss.advice_prepare_skc_number),
        about_to_sell_out_skc: toNum(ss.about_to_sell_out_number),
        already_sold_out_skc: toNum(ss.already_sold_out_number),
        high_price_limit_skc: toNum(ss.high_price_limit_number),
        after_sale_ratio_90d: ss.quality_after_sale_ratio_90d ?? null,
        last_updated_at: ss.last_updated_at || null,
      },
      after_sales: { count: toNum(af.after_sales_count) },
      health: {
        last_capture_at: lastCaptureAt || null,
        captures_total: toNum(h.captures_total),
        lag_seconds: lastCaptureAt ? Math.max(0, Math.round((now - lastCaptureAt) / 1000)) : null,
      },
    };
  });

  // 销量数据实际覆盖窗口（cloud 回溯天数可能不足 30 天，前端据此标注真实天数，避免"近30天"误导）
  const win = optionalAllLocal(db,
    `SELECT MIN(stat_date) mn, MAX(stat_date) mx, COUNT(DISTINCT stat_date) days
       FROM cloud.temu_sales_snapshot WHERE tenant_id = ? AND mall_supplier_id <> ''`, [tid])[0] || {};

  return {
    generated_at: now,
    tenant_id: tid,
    store_count: stores.length,
    stores,
    sales_window: { start: win.mn || null, end: win.mx || null, days: toNum(win.days) },
  };
}

// 进程级结果缓存：跨库聚合冷态可达 ~17s（OS page cache 被挤出后首查），
// 缓存 + 服务端定时预热让用户请求永远命中暖缓存、秒回。
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const _reportCache = new Map();    // includeTest -> { data, ts }
const _reportInflight = new Map(); // includeTest -> Promise（并发去重，避免多请求同时冷算）

// 主入口（带缓存）：force=true 跳过读缓存（预热用），仍写缓存。
async function buildMultiStoreReport(db, options = {}) {
  if (!db) throw new Error("multiStoreReport: db is required (host mode only)");
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const cached = _reportCache.get(key);
    if (cached && Date.now() - cached.ts < REPORT_CACHE_TTL_MS) return cached.data;
  }
  const inflight = _reportInflight.get(key);
  if (inflight) return inflight; // 复用进行中的计算（含预热），避免并发重复冷算
  const p = Promise.resolve()
    .then(() => _buildMultiStoreReportFresh(db, options))
    .then((data) => { _reportCache.set(key, { data, ts: Date.now() }); return data; })
    .finally(() => { _reportInflight.delete(key); });
  _reportInflight.set(key, p);
  return p;
}

// 预热：强制重算并填缓存，供服务端定时调用，使 page cache 常暖、用户不撞冷查询。
function prewarmMultiStoreReport(db, attachCloudDb) {
  try { buildSkuSales(db, { includeTest: false, attachCloudDb, force: true }); } catch {}
  return buildMultiStoreReport(db, { includeTest: false, attachCloudDb, force: true }).catch(() => null);
}

// 真正的聚合实现（无缓存）
async function _buildMultiStoreReportFresh(db, options = {}) {
  if (!db) throw new Error("multiStoreReport: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  const attached = typeof attachCloudDb === "function" && attachCloudDb(db) === true;

  // 优先本地 ATTACH cloud 直接聚合（快、不触碰 cloud HTTP 单进程）；attach 不可用时退回 HTTP API
  let cloud;
  let financialsByMall = null;
  if (attached) {
    cloud = buildByStoreLocal(db, { includeTest: options.includeTest });
    try {
      financialsByMall = buildFinancialsByMall(db, attachCloudDb);
    } catch (error) {
      financialsByMall = null;
      if (options.onError) options.onError(error);
    }
  } else {
    // 降级：本地开发机无 cloud sqlite 等场景，退回 cloud HTTP API（金额维度不可用）
    cloud = await fetchCloudReport({ includeTest: options.includeTest });
  }

  const dict = readMallDictionary(db);
  const dictByMall = new Map(dict.map((row) => [row.mall_id, row]));

  const stores = [];
  const unmapped = [];
  for (const s of cloud.stores || []) {
    const dictRow = dictByMall.get(s.mall_id);
    const financials = financialsByMall ? (financialsByMall.get(s.mall_id) || emptyFinancials()) : null;
    const enriched = {
      ...s,
      store_code: dictRow?.store_code || null,
      store_status: dictRow?.status || "unknown",
      dict_remark: dictRow?.remark || null,
      owner: dictRow?.owner || null,
      financials,
    };
    if (!dictRow) {
      unmapped.push(enriched);
    } else if (options.includeTest || dictRow.status !== "test") {
      stores.push(enriched);
    }
  }

  // 按 store_code 排序，无 store_code 排最后
  stores.sort((a, b) => {
    if (!a.store_code && !b.store_code) return 0;
    if (!a.store_code) return 1;
    if (!b.store_code) return -1;
    return a.store_code.localeCompare(b.store_code);
  });

  return {
    generated_at: cloud.generated_at || Date.now(),
    cloud_tenant_id: cloud.tenant_id || null,
    store_count: stores.length,
    financials_available: financialsByMall !== null,
    sales_window: cloud.sales_window || null, // 销量数据实际覆盖窗口（不足30天时前端据此标注真实天数）
    stores,
    unmapped, // 云端有数据但本地字典没登记的（应该提醒用户去 seed）
  };
}

// ===== 销售管理：SKU 级明细（每店最新天，含动销/库存/申报价/售罄）=====
const _skuSalesCache = new Map(); // includeTest -> { data, ts }

function _buildSkuSalesFresh(db, options = {}) {
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const includeTest = !!options.includeTest;
  const limit = Math.min(8000, Math.max(50, Number(options.limit) || 4000));
  const rows = optionalAllLocal(db, `
    WITH latest AS (
      SELECT mall_supplier_id, MAX(stat_date) AS sd
        FROM cloud.temu_sales_snapshot
       WHERE tenant_id = ? AND mall_supplier_id <> ''
       GROUP BY mall_supplier_id
    )
    SELECT s.mall_supplier_id AS mall_id, m.store_code, m.mall_name, m.status AS dict_status,
           s.skc_id, s.sku_ext_code, s.product_id, s.title, s.category_name,
           s.today_sales, s.last7d_sales, s.last30d_sales,
           s.warehouse_stock, s.occupy_stock, s.advice_qty, s.available_sale_days,
           s.declared_price_cents, s.stat_date
      FROM cloud.temu_sales_snapshot s
      JOIN latest l ON l.mall_supplier_id = s.mall_supplier_id AND l.sd = s.stat_date
      LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_supplier_id
     WHERE s.tenant_id = ? AND s.skc_id NOT IN ('SKC-EXT-E2E','SKC-DBG')
       ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
       AND (COALESCE(s.last30d_sales,0) > 0 OR COALESCE(s.today_sales,0) > 0 OR COALESCE(s.warehouse_stock,0) <= 0)
     ORDER BY COALESCE(s.last7d_sales,0) DESC
     LIMIT ?
  `, [tid, tid, limit]);

  const out = rows.map((r) => ({
    mall_id: r.mall_id,
    store_code: r.store_code || null,
    mall_name: r.mall_name || null,
    skc_id: r.skc_id || null,
    sku_ext_code: r.sku_ext_code || null,
    product_id: r.product_id || null,
    title: r.title || null,
    category: r.category_name || null,
    today: toNum(r.today_sales),
    last7d: toNum(r.last7d_sales),
    last30d: toNum(r.last30d_sales),
    stock: toNum(r.warehouse_stock),
    occupy: toNum(r.occupy_stock),
    advice_qty: toNum(r.advice_qty),
    sale_days: r.available_sale_days == null ? null : Number(r.available_sale_days),
    declared_price: r.declared_price_cents == null ? null : Number(r.declared_price_cents) / 100,
    stat_date: r.stat_date || null,
  }));
  return { generated_at: Date.now(), row_count: out.length, rows: out };
}

// SKU 销售明细（带缓存）。需 attachCloudDb 接通 cloud 库。
function buildSkuSales(db, options = {}) {
  if (!db) throw new Error("buildSkuSales: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const cached = _skuSalesCache.get(key);
    if (cached && Date.now() - cached.ts < REPORT_CACHE_TTL_MS) return cached.data;
  }
  const data = _buildSkuSalesFresh(db, options);
  _skuSalesCache.set(key, { data, ts: Date.now() });
  return data;
}

// ===== 风险待办：运营风险明细（每店最新天，按严重度排）=====
const _riskCache = new Map();
function buildRiskList(db, options = {}) {
  if (!db) throw new Error("buildRiskList: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const c = _riskCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const rows = optionalAllLocal(db, `
    WITH latest AS (
      SELECT mall_id, MAX(stat_date) AS sd FROM cloud.temu_operation_risk_snapshot
       WHERE tenant_id = ? AND mall_id <> '' GROUP BY mall_id
    )
    SELECT r.mall_id, m.store_code, m.mall_name, r.risk_type, r.severity, r.risk_title,
           r.risk_status, r.product_id, r.skc_id, r.quantity, r.stat_date
      FROM cloud.temu_operation_risk_snapshot r
      JOIN latest l ON l.mall_id = r.mall_id AND l.sd = r.stat_date
      LEFT JOIN erp_temu_malls m ON m.mall_id = r.mall_id
     WHERE r.tenant_id = ?
       ${options.includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY CASE r.severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, r.mall_id
     LIMIT 4000
  `, [tid, tid]);
  const out = rows.map((r) => ({
    mall_id: r.mall_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
    risk_type: r.risk_type || null, severity: r.severity || null, title: r.risk_title || null,
    status: r.risk_status || null, product_id: r.product_id || null, skc_id: r.skc_id || null,
    quantity: toNum(r.quantity), stat_date: r.stat_date || null,
  }));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out };
  _riskCache.set(key, { data, ts: Date.now() });
  return data;
}

// ===== 活动机会：可报活动 / 竞价 / 优惠券明细（每店最新天，仅含有实质内容的行）=====
const _activityCache = new Map();
function buildActivityList(db, options = {}) {
  if (!db) throw new Error("buildActivityList: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const c = _activityCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const rows = optionalAllLocal(db, `
    WITH latest AS (
      SELECT mall_id, MAX(stat_date) AS sd FROM cloud.temu_activity_snapshot
       WHERE tenant_id = ? AND mall_id <> '' GROUP BY mall_id
    )
    SELECT a.mall_id, m.store_code, m.mall_name, a.activity_kind, a.activity_title, a.activity_status,
           a.sku_ext_code, a.skc_id, a.signup_price_cents, a.suggested_price_cents,
           a.signup_price_diff_cents, a.activity_stock, a.end_at, a.stat_date, k.wac AS cost
      FROM cloud.temu_activity_snapshot a
      JOIN latest l ON l.mall_id = a.mall_id AND l.sd = a.stat_date
      LEFT JOIN erp_temu_malls m ON m.mall_id = a.mall_id
      LEFT JOIN (SELECT internal_sku_code,
                        MAX(COALESCE(NULLIF(weighted_avg_cost,0), NULLIF(jst_cost_price,0))) AS wac
                   FROM erp_skus GROUP BY internal_sku_code) k
        ON k.internal_sku_code = a.sku_ext_code
     WHERE a.tenant_id = ?
       AND (a.sku_ext_code IS NOT NULL OR a.activity_title IS NOT NULL OR a.signup_price_cents IS NOT NULL)
       ${options.includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY a.mall_id, a.activity_kind
     LIMIT 4000
  `, [tid, tid]);
  const centsToYuan = (v) => (v == null ? null : Number(v) / 100);
  const out = rows.map((a) => ({
    mall_id: a.mall_id, store_code: a.store_code || null, mall_name: a.mall_name || null,
    kind: a.activity_kind || null, title: a.activity_title || null, status: a.activity_status || null,
    sku_ext_code: a.sku_ext_code || null, skc_id: a.skc_id || null,
    signup_price: centsToYuan(a.signup_price_cents), suggested_price: centsToYuan(a.suggested_price_cents),
    price_diff: centsToYuan(a.signup_price_diff_cents), activity_stock: toNum(a.activity_stock),
    cost: a.cost != null && Number(a.cost) > 0 ? Number(a.cost) : null,
    end_at: a.end_at || null, stat_date: a.stat_date || null,
  }));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out };
  _activityCache.set(key, { data, ts: Date.now() });
  return data;
}

// ===== 店铺健康：店铺级体检（每店最新天）=====
const _shopHealthCache = new Map();
function buildShopHealth(db, options = {}) {
  if (!db) throw new Error("buildShopHealth: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const c = _shopHealthCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const rows = optionalAllLocal(db, `
    WITH latest AS (
      SELECT mall_id, MAX(stat_date) AS sd FROM cloud.temu_shop_stats
       WHERE tenant_id = ? AND mall_id <> '' GROUP BY mall_id
    )
    SELECT s.mall_id, m.store_code, m.mall_name, m.owner,
           s.sale_volume, s.seven_days_sale_volume, s.thirty_days_sale_volume,
           s.on_sale_product_number, s.wait_product_number, s.lack_skc_number,
           s.advice_prepare_skc_number, s.about_to_sell_out_number, s.already_sold_out_number,
           s.high_price_limit_number, s.quality_after_sale_ratio_90d, s.stat_date
      FROM cloud.temu_shop_stats s
      JOIN latest l ON l.mall_id = s.mall_id AND l.sd = s.stat_date
      LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
     WHERE s.tenant_id = ?
       ${options.includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY s.already_sold_out_number DESC, s.lack_skc_number DESC, s.mall_id
     LIMIT 4000
  `, [tid, tid]);
  const out = rows.map((s) => ({
    mall_id: s.mall_id, store_code: s.store_code || null, mall_name: s.mall_name || null, owner: s.owner || null,
    sale_volume: toNum(s.sale_volume), sale_7d: toNum(s.seven_days_sale_volume), sale_30d: toNum(s.thirty_days_sale_volume),
    on_sale: toNum(s.on_sale_product_number), wait_online: toNum(s.wait_product_number),
    lack_skc: toNum(s.lack_skc_number), advice_prepare_skc: toNum(s.advice_prepare_skc_number),
    about_to_sell_out: toNum(s.about_to_sell_out_number), already_sold_out: toNum(s.already_sold_out_number),
    high_price_limit: toNum(s.high_price_limit_number),
    after_sale_ratio_90d: s.quality_after_sale_ratio_90d == null ? null : Number(s.quality_after_sale_ratio_90d),
    stat_date: s.stat_date || null,
  }));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out };
  _shopHealthCache.set(key, { data, ts: Date.now() });
  return data;
}

// ===== 备货在途：未完成的备货/发货单（需求量 > 已发量）=====
const _stockOrderCache = new Map();
function buildStockOrders(db, options = {}) {
  if (!db) throw new Error("buildStockOrders: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const c = _stockOrderCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const rows = optionalAllLocal(db, `
    SELECT DISTINCT s.mall_id, m.store_code, m.mall_name, s.sku_ext_code, s.product_name, s.spec_name,
           s.source_type, s.demand_qty, s.delivered_qty, s.shipping_qty, s.inbound_qty,
           s.latest_ship_at, s.receive_warehouse_name, s.stock_order_no
      FROM cloud.temu_stock_order_snapshot s
      LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
     WHERE s.tenant_id = ?
       AND s.mall_id <> ''
       AND COALESCE(s.demand_qty,0) > COALESCE(s.delivered_qty,0)
       ${options.includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY (s.latest_ship_at IS NULL OR s.latest_ship_at = ''), s.latest_ship_at ASC, (s.demand_qty - COALESCE(s.delivered_qty,0)) DESC
     LIMIT 4000
  `, [tid]);
  const out = rows.map((s) => {
    const demand = toNum(s.demand_qty), delivered = toNum(s.delivered_qty);
    return {
      mall_id: s.mall_id, store_code: s.store_code || null, mall_name: s.mall_name || null,
      sku_ext_code: s.sku_ext_code || null, product_name: s.product_name || null, spec_name: s.spec_name || null,
      source_type: s.source_type || null, demand_qty: demand, delivered_qty: delivered,
      gap: Math.max(0, demand - delivered), shipping_qty: toNum(s.shipping_qty), inbound_qty: toNum(s.inbound_qty),
      latest_ship_at: s.latest_ship_at || null, warehouse: s.receive_warehouse_name || null, order_no: s.stock_order_no || null,
    };
  });
  const data = { generated_at: Date.now(), row_count: out.length, rows: out };
  _stockOrderCache.set(key, { data, ts: Date.now() });
  return data;
}

// ===== 销量趋势：店铺级每日销量序列（最近 N 天，排除预测值）=====
const _salesTrendCache = new Map();
function buildSalesTrend(db, options = {}) {
  if (!db) throw new Error("buildSalesTrend: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const days = options.days && options.days > 0 ? Math.min(90, Math.floor(options.days)) : 30;
  const key = (options.includeTest ? "1" : "0") + ":" + days;
  if (!options.force) {
    const c = _salesTrendCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  const rows = optionalAllLocal(db, `
    SELECT t.mall_id, m.store_code, m.mall_name, t.stat_date, SUM(t.sales_number) AS sales
      FROM cloud.temu_sku_sales_trend t
      LEFT JOIN erp_temu_malls m ON m.mall_id = t.mall_id
     WHERE t.tenant_id = ? AND t.mall_id <> ''
       AND COALESCE(t.is_predict,0) = 0
       AND t.stat_date >= date('now','-' || ? || ' days')
       ${options.includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     GROUP BY t.mall_id, t.stat_date
     ORDER BY t.stat_date, t.mall_id
  `, [tid, days]);
  const out = rows.map((r) => ({
    mall_id: r.mall_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
    stat_date: r.stat_date, sales: toNum(r.sales),
  }));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out };
  _salesTrendCache.set(key, { data, ts: Date.now() });
  return data;
}

// ===== 商品运营面板：以商品(SPU/product_id)为行，横向集成 活动/合规/流量/限流 四维 =====
const _productPanelCache = new Map();
function buildProductPanel(db, options = {}) {
  if (!db) throw new Error("buildProductPanel: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
  }
  const key = options.includeTest ? "1" : "0";
  if (!options.force) {
    const c = _productPanelCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  // 1) 流量（每店最新天，按 product_id）
  const flowRows = optionalAllLocal(db, `
    WITH lf AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_product_flow_snapshot WHERE tenant_id = ? GROUP BY mall_id)
    SELECT f.mall_id, f.product_id, f.title, f.expose_num, f.click_num, f.pay_goods_num,
           f.expose_pay_conversion_rate, f.flow_grow_status
      FROM cloud.temu_product_flow_snapshot f JOIN lf ON lf.mall_id = f.mall_id AND lf.sd = f.stat_date
     WHERE f.product_id IS NOT NULL AND f.product_id <> ''`, [tid]);
  // 2) 限流：高价流量受限（high_price_flow，每店最新天）
  const limRows = optionalAllLocal(db, `
    WITH lr AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_operation_risk_snapshot WHERE tenant_id = ? AND risk_type = 'high_price_flow' GROUP BY mall_id)
    SELECT DISTINCT r.mall_id, r.product_id FROM cloud.temu_operation_risk_snapshot r JOIN lr ON lr.mall_id = r.mall_id AND lr.sd = r.stat_date
     WHERE r.risk_type = 'high_price_flow' AND r.product_id IS NOT NULL AND r.product_id <> ''`, [tid]);
  // 3) 活动（每店最新天，按 product_id 聚合：可报活动数 + 最低报名价）
  const actRows = optionalAllLocal(db, `
    WITH la AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_activity_snapshot WHERE tenant_id = ? GROUP BY mall_id)
    SELECT a.mall_id, a.product_id, COUNT(*) cnt, MIN(a.signup_price_cents) minp
      FROM cloud.temu_activity_snapshot a JOIN la ON la.mall_id = a.mall_id AND la.sd = a.stat_date
     WHERE a.product_id IS NOT NULL AND a.product_id <> '' AND a.signup_price_cents IS NOT NULL
     GROUP BY a.mall_id, a.product_id`, [tid]);
  // 4) 合规（按 product_id，任一 SKC 违规即标记）
  const compRows = optionalAllLocal(db, `
    SELECT mall_id, product_id, MAX(compliance_status) cs, MAX(title) title
      FROM cloud.skc_snapshots WHERE tenant_id = ? AND compliance_status IS NOT NULL AND product_id IS NOT NULL AND product_id <> ''
     GROUP BY mall_id, product_id`, [tid]);
  // 商品名字典（by product_id，skc + sales 两表合并，覆盖更全）
  const titleRows = optionalAllLocal(db, `
    SELECT product_id, MAX(title) title FROM (
      SELECT product_id, title FROM cloud.skc_snapshots WHERE tenant_id = ? AND product_id <> '' AND title IS NOT NULL AND title <> ''
      UNION ALL
      SELECT product_id, title FROM cloud.temu_sales_snapshot WHERE tenant_id = ? AND product_id <> '' AND title IS NOT NULL AND title <> ''
    ) GROUP BY product_id`, [tid, tid]);
  const titleMap = new Map(titleRows.map((t) => [String(t.product_id), t.title]));
  const malls = optionalAllLocal(db, `SELECT mall_id, store_code, mall_name, status FROM erp_temu_malls`, []);
  const mallMap = new Map(malls.map((m) => [m.mall_id, m]));
  const map = new Map();
  const get = (mall_id, product_id, title) => {
    const k = mall_id + "|" + product_id;
    let e = map.get(k);
    if (!e) { e = { mall_id, product_id, title: title || null, expose: null, click: null, pay: null, conv: null, grow: null, limited: false, act_cnt: 0, min_price: null, compliance: null }; map.set(k, e); }
    if (title && !e.title) e.title = title;
    return e;
  };
  for (const f of flowRows) { const e = get(f.mall_id, f.product_id, f.title); e.expose = toNum(f.expose_num); e.click = toNum(f.click_num); e.pay = toNum(f.pay_goods_num); e.conv = f.expose_pay_conversion_rate == null ? null : Number(f.expose_pay_conversion_rate); e.grow = f.flow_grow_status || null; }
  for (const r of limRows) { get(r.mall_id, r.product_id, null).limited = true; }
  for (const a of actRows) { const e = get(a.mall_id, a.product_id, null); e.act_cnt = toNum(a.cnt); e.min_price = a.minp == null ? null : Number(a.minp) / 100; }
  for (const c of compRows) { const e = get(c.mall_id, c.product_id, c.title); e.compliance = c.cs || null; }
  const out = [];
  for (const e of map.values()) {
    const m = mallMap.get(e.mall_id);
    if (!options.includeTest && m && m.status === "test") continue;
    if (!e.title) e.title = titleMap.get(String(e.product_id)) || null;
    e.store_code = m ? m.store_code || null : null;
    e.mall_name = m ? m.mall_name || null : null;
    out.push(e);
  }
  out.sort((a, b) => (b.limited ? 1 : 0) - (a.limited ? 1 : 0) || (b.compliance ? 1 : 0) - (a.compliance ? 1 : 0) || (b.act_cnt - a.act_cnt) || ((b.expose || 0) - (a.expose || 0)));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out.slice(0, 4000) };
  _productPanelCache.set(key, { data, ts: Date.now() });
  return data;
}

// 写入店铺负责人（host 模式）。返回受影响行数。
function setMallOwner(db, mallId, owner) {
  if (!db) throw new Error("setMallOwner: db is required (host mode only)");
  if (!mallId) throw new Error("setMallOwner: mallId is required");
  const normalized = owner == null || String(owner).trim() === "" ? null : String(owner).trim();
  const info = db.prepare(`
    UPDATE erp_temu_malls
       SET owner = ?, updated_at = ?
     WHERE mall_id = ?
  `).run(normalized, new Date().toISOString(), mallId);
  return info.changes;
}

module.exports = {
  buildMultiStoreReport,
  prewarmMultiStoreReport,
  buildSkuSales,
  buildRiskList,
  buildActivityList,
  buildShopHealth,
  buildStockOrders,
  buildSalesTrend,
  buildProductPanel,
  setMallOwner,
  // 暴露给测试用
  _internal: { fetchCloudReport, readMallDictionary, loginCloud, buildFinancialsByMall, buildByStoreLocal, shiftDate },
};
