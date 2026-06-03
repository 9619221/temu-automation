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

// 活动报名:桌面端把任务下发到云端 enroll_task(扩展再按店拉取执行)
async function createEnrollTasks(tasks = []) {
  const fetchImpl = typeof fetch === "function" ? fetch : (await import("undici")).fetch;
  let token = await getToken(fetchImpl);
  const out = [];
  for (const t of tasks) {
    const post = (tk) => fetchImpl(`${CLOUD_BASE}/api/ingest/v1/enroll-tasks/create`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
      body: JSON.stringify(t),
    });
    let resp = await post(token);
    if (resp.status === 401) { cachedToken = null; token = await loginCloud(fetchImpl); resp = await post(token); }
    const data = await resp.json().catch(() => ({}));
    out.push({ ok: !!(resp.ok && data?.ok), task_id: data?.task_id || null, mall_id: t?.mall_id || null, error: data?.error || (resp.ok ? null : `HTTP ${resp.status}`) });
  }
  return { rows: out };
}

// 桌面端轮询报名任务结果(扩展执行后回传云端)
async function pollEnrollResults(taskIds = []) {
  if (!Array.isArray(taskIds) || !taskIds.length) return { tasks: [] };
  const fetchImpl = typeof fetch === "function" ? fetch : (await import("undici")).fetch;
  let token = await getToken(fetchImpl);
  const url = `${CLOUD_BASE}/api/ingest/v1/enroll-tasks/status?ids=${encodeURIComponent(taskIds.join(","))}`;
  let resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 401) { cachedToken = null; token = await loginCloud(fetchImpl); resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } }); }
  const data = await resp.json().catch(() => ({}));
  return { tasks: data?.tasks || [] };
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

// 运营工作台数据源开关：默认走官方 API 物化表(erp_temu_openapi_sku_sales)，
// 传 options.source='scrape' 或设环境变量 OPENAPI_SKU_SALES=0 可回退抓包(cloud.temu_*_snapshot)。
function useOfficialReports(options = {}) {
  if (options.source === "official") return true;
  if (options.source === "scrape") return false;
  return process.env.OPENAPI_SKU_SALES !== "0";
}

// 官方路径：读 erp_temu_openapi_sku_sales（物化自 bg.goods.salesv2.get），不依赖 cloud attach。
function _buildSkuSalesOfficialFresh(db, options = {}) {
  const includeTest = !!options.includeTest;
  const limit = Math.min(8000, Math.max(50, Number(options.limit) || 4000));
  const rows = optionalAllLocal(db, `
    SELECT s.mall_id, m.store_code, m.mall_name,
           s.product_skc_id AS skc_id, s.ext_code AS sku_ext_code, s.product_id, s.title, s.category,
           s.today_sales, s.last7d_sales, s.last30d_sales,
           s.warehouse_stock, s.occupy_stock, s.advice_qty, s.sale_days, s.synced_at
      FROM erp_temu_openapi_sku_sales s
      LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
     WHERE (COALESCE(s.last30d_sales,0) > 0 OR COALESCE(s.today_sales,0) > 0 OR COALESCE(s.warehouse_stock,0) <= 0)
       ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY COALESCE(s.last7d_sales,0) DESC
     LIMIT ?
  `, [limit]);
  const out = rows.map((r) => ({
    mall_id: r.mall_id,
    store_code: r.store_code || null,
    mall_name: r.mall_name || null,
    skc_id: r.skc_id || null,
    sku_ext_code: r.sku_ext_code || null,
    product_id: r.product_id || null,
    title: r.title || null,
    category: r.category || null,
    today: toNum(r.today_sales),
    last7d: toNum(r.last7d_sales),
    last30d: toNum(r.last30d_sales),
    stock: toNum(r.warehouse_stock),
    occupy: toNum(r.occupy_stock),
    advice_qty: toNum(r.advice_qty),
    sale_days: r.sale_days == null ? null : Number(r.sale_days),
    declared_price: null, // 官方 supplierPrice 单位/语义未定，Phase 1 留空（待接价格接口或 join 抓包）
    stat_date: r.synced_at ? String(r.synced_at).slice(0, 10) : null,
  }));
  return { generated_at: Date.now(), row_count: out.length, rows: out, source: "official" };
}

// SKU 销售明细（带缓存）。官方路径读物化表；抓包路径需 attachCloudDb 接通 cloud 库。
function buildSkuSales(db, options = {}) {
  if (!db) throw new Error("buildSkuSales: db is required (host mode only)");
  const official = useOfficialReports(options);
  const key = (official ? "o:" : "s:") + (options.includeTest ? "1" : "0");
  if (!options.force) {
    const cached = _skuSalesCache.get(key);
    if (cached && Date.now() - cached.ts < REPORT_CACHE_TTL_MS) return cached.data;
  }
  let data;
  if (official) {
    data = _buildSkuSalesOfficialFresh(db, options);
  } else {
    const attachCloudDb = options.attachCloudDb;
    if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
      return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
    }
    data = _buildSkuSalesFresh(db, options);
  }
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
           a.signup_price_diff_cents, a.activity_stock, a.end_at, a.stat_date, k.wac AS cost,
           a.activity_id, a.product_id, a.activity_type, a.sku_id,
           sc.title AS prod_title, sc.thumb_url AS thumb
      FROM cloud.temu_activity_snapshot a
      JOIN latest l ON l.mall_id = a.mall_id AND l.sd = a.stat_date
      LEFT JOIN erp_temu_malls m ON m.mall_id = a.mall_id
      LEFT JOIN cloud.skc_snapshots sc ON sc.tenant_id = a.tenant_id AND sc.skc_id = a.skc_id
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
    activity_id: a.activity_id || null, product_id: a.product_id || null,
    activity_type: a.activity_type != null ? Number(a.activity_type) : null, sku_id: a.sku_id || null,
    sku_ext_code: a.sku_ext_code || null, skc_id: a.skc_id || null,
    product_name: a.prod_title || a.activity_title || null, thumb: a.thumb || null,
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
// 抓包路径：Temu 原生店铺体检快照（每店最新天）。
function _buildShopHealthScrapeFresh(db, options = {}) {
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
  return { generated_at: Date.now(), row_count: out.length, rows: out };
}
// 官方路径：从 erp_temu_openapi_sku_sales 按店聚合销量/缺货/售罄/建议/即将售罄。
// 官方无对应数据的字段(high_price_limit/wait_online/after_sale_ratio)置 0/null，由风险面板等抓包侧另行覆盖。
function _buildShopHealthOfficialFresh(db, options = {}) {
  const rows = optionalAllLocal(db, `
    SELECT s.mall_id, m.store_code, m.mall_name, m.owner,
           SUM(COALESCE(s.today_sales,0))   AS sale_volume,
           SUM(COALESCE(s.last7d_sales,0))  AS sale_7d,
           SUM(COALESCE(s.last30d_sales,0)) AS sale_30d,
           COUNT(DISTINCT CASE WHEN COALESCE(s.lack_quantity,0) > 0 THEN s.product_skc_id END) AS lack_skc,
           COUNT(DISTINCT CASE WHEN COALESCE(s.advice_qty,0) > 0 THEN s.product_skc_id END) AS advice_prepare_skc,
           COUNT(DISTINCT CASE WHEN s.sale_days IS NOT NULL AND s.sale_days < 7 THEN s.product_skc_id END) AS about_to_sell_out,
           COUNT(DISTINCT CASE WHEN COALESCE(s.warehouse_stock,0) <= 0 AND (COALESCE(s.last30d_sales,0) > 0 OR COALESCE(s.last7d_sales,0) > 0) THEN s.product_skc_id END) AS already_sold_out,
           COUNT(DISTINCT s.product_skc_id) AS on_sale
      FROM erp_temu_openapi_sku_sales s
      LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
     WHERE 1=1
       ${options.includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     GROUP BY s.mall_id, m.store_code, m.mall_name, m.owner
     ORDER BY already_sold_out DESC, lack_skc DESC, s.mall_id
     LIMIT 4000
  `, []);
  const out = rows.map((s) => ({
    mall_id: s.mall_id, store_code: s.store_code || null, mall_name: s.mall_name || null, owner: s.owner || null,
    sale_volume: toNum(s.sale_volume), sale_7d: toNum(s.sale_7d), sale_30d: toNum(s.sale_30d),
    on_sale: toNum(s.on_sale), wait_online: 0,
    lack_skc: toNum(s.lack_skc), advice_prepare_skc: toNum(s.advice_prepare_skc),
    about_to_sell_out: toNum(s.about_to_sell_out), already_sold_out: toNum(s.already_sold_out),
    high_price_limit: 0,
    after_sale_ratio_90d: null,
    stat_date: null,
  }));
  return { generated_at: Date.now(), row_count: out.length, rows: out, source: "official" };
}
function buildShopHealth(db, options = {}) {
  if (!db) throw new Error("buildShopHealth: db is required (host mode only)");
  const official = useOfficialReports(options);
  const key = (official ? "o:" : "s:") + (options.includeTest ? "1" : "0");
  if (!options.force) {
    const c = _shopHealthCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  let data;
  if (official) {
    data = _buildShopHealthOfficialFresh(db, options);
  } else {
    const attachCloudDb = options.attachCloudDb;
    if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
      return { generated_at: Date.now(), row_count: 0, rows: [], attached: false };
    }
    data = _buildShopHealthScrapeFresh(db, options);
  }
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
    SELECT f.mall_id, f.product_id, f.title, f.thumb_url, f.expose_num, f.click_num, f.pay_goods_num,
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
  const malls = optionalAllLocal(db, `SELECT mall_id, store_code, mall_name, status FROM erp_temu_malls`, []);
  const mallMap = new Map(malls.map((m) => [m.mall_id, m]));
  const map = new Map();
  const get = (mall_id, product_id, title) => {
    const k = mall_id + "|" + product_id;
    let e = map.get(k);
    if (!e) { e = { mall_id, product_id, title: title || null, thumb: null, expose: null, click: null, pay: null, conv: null, grow: null, limited: false, act_cnt: 0, min_price: null, compliance: null }; map.set(k, e); }
    if (title && !e.title) e.title = title;
    return e;
  };
  for (const f of flowRows) { const e = get(f.mall_id, f.product_id, f.title); e.expose = toNum(f.expose_num); e.click = toNum(f.click_num); e.pay = toNum(f.pay_goods_num); e.conv = f.expose_pay_conversion_rate == null ? null : Number(f.expose_pay_conversion_rate); e.grow = f.flow_grow_status || null; if (f.thumb_url) e.thumb = f.thumb_url; }
  for (const r of limRows) { get(r.mall_id, r.product_id, null).limited = true; }
  for (const a of actRows) { const e = get(a.mall_id, a.product_id, null); e.act_cnt = toNum(a.cnt); e.min_price = a.minp == null ? null : Number(a.minp) / 100; }
  for (const c of compRows) { const e = get(c.mall_id, c.product_id, c.title); e.compliance = c.cs || null; }
  // 只查命中商品的 标题/缩略图/编码/申报价（IN 走 product_id 索引，避免扫全表 GROUP BY）
  const pids = [...new Set([...map.values()].map((e) => e.product_id))].filter((p) => p);
  let titleMap = new Map();
  let codeMap = new Map();
  let detailMap = new Map();
  if (pids.length) {
    const ph = pids.map(() => "?").join(",");
    const titleRows = optionalAllLocal(db, `
      SELECT product_id, MAX(title) title, MAX(thumb_url) thumb FROM (
        SELECT product_id, title, thumb_url FROM cloud.skc_snapshots WHERE tenant_id = ? AND product_id IN (${ph}) AND title IS NOT NULL AND title <> ''
        UNION ALL
        SELECT product_id, title, thumb_url FROM cloud.temu_sales_snapshot WHERE tenant_id = ? AND product_id IN (${ph}) AND title IS NOT NULL AND title <> ''
      ) GROUP BY product_id`, [tid, ...pids, tid, ...pids]);
    titleMap = new Map(titleRows.map((t) => [String(t.product_id), { title: t.title, thumb: t.thumb }]));
    // SKU 明细(每商品各自最新天,覆盖全)+ JS 聚合出 SPU 级值(单天,不跨天虚高)
    const detailRows = optionalAllLocal(db, `
      WITH ls AS (SELECT product_id, MAX(stat_date) sd FROM cloud.temu_sales_snapshot WHERE tenant_id = ? AND product_id IN (${ph}) GROUP BY product_id)
      SELECT s.product_id, s.skc_id, s.sku_ext_code, s.declared_price_cents, s.today_sales, s.last7d_sales, s.available_sale_days,
             s.warehouse_stock, s.occupy_stock, s.unavailable_stock, s.advice_qty, s.lack_quantity, s.asf_score, s.comment_num
        FROM cloud.temu_sales_snapshot s JOIN ls ON ls.product_id = s.product_id AND ls.sd = s.stat_date
       WHERE s.product_id IN (${ph})`, [tid, ...pids, ...pids]);
    const agg = new Map();
    for (const d of detailRows) {
      const k = String(d.product_id);
      let arr = detailMap.get(k);
      if (!arr) { arr = []; detailMap.set(k, arr); }
      arr.push({ skc_id: d.skc_id || null, sku_ext_code: d.sku_ext_code || null, declared_price: d.declared_price_cents ? Number(d.declared_price_cents) / 100 : null, today: toNum(d.today_sales), last7d: toNum(d.last7d_sales), sale_days: d.available_sale_days == null ? null : Number(d.available_sale_days), stock: toNum(d.warehouse_stock), occupy: toNum(d.occupy_stock), advice_qty: toNum(d.advice_qty), lack_qty: toNum(d.lack_quantity) });
      let a = agg.get(k);
      if (!a) { a = { skcs: new Set(), skus: new Set(), declared: null, score: null, comments: null, stock: 0, occupy: 0, unavail: 0, advice: 0, lack: 0, lackQty: 0 }; agg.set(k, a); }
      if (d.skc_id) a.skcs.add(d.skc_id);
      if (d.sku_ext_code) a.skus.add(d.sku_ext_code);
      const dp = d.declared_price_cents ? Number(d.declared_price_cents) : null;
      if (dp && (a.declared == null || dp < a.declared)) a.declared = dp;
      const sc = d.asf_score ? Number(d.asf_score) : null;
      if (sc && (a.score == null || sc > a.score)) a.score = sc;
      const cn = d.comment_num != null ? toNum(d.comment_num) : null;
      if (cn != null && (a.comments == null || cn > a.comments)) a.comments = cn;
      a.stock += toNum(d.warehouse_stock); a.occupy += toNum(d.occupy_stock); a.unavail += toNum(d.unavailable_stock); a.advice += toNum(d.advice_qty); a.lackQty += toNum(d.lack_quantity);
      if (toNum(d.warehouse_stock) <= 0) a.lack++;
    }
    codeMap = new Map([...agg].map(([k, a]) => [k, { skcs: [...a.skcs].join(",") || null, skus: [...a.skus].join(",") || null, declared: a.declared, score: a.score, comments: a.comments, stock: a.stock, occupy: a.occupy, unavail: a.unavail, advice: a.advice, lack: a.lack, lackQty: a.lackQty }]));
  }
  // 发货在途：备货单运输中数量(shipping_qty)，按 mall_id+product_id 聚合(stock_order 是当前态 upsert，无跨天虚高)
  let shipMap = new Map();
  if (pids.length) {
    const ph2 = pids.map(() => "?").join(",");
    const shipRows = optionalAllLocal(db, `
      SELECT mall_id, product_id, SUM(COALESCE(shipping_qty,0)) ship
        FROM cloud.temu_stock_order_snapshot
       WHERE tenant_id = ? AND product_id IN (${ph2}) AND product_id IS NOT NULL AND product_id <> ''
       GROUP BY mall_id, product_id`, [tid, ...pids]);
    shipMap = new Map(shipRows.map((s) => [s.mall_id + "|" + s.product_id, toNum(s.ship)]));
  }
  const out = [];
  for (const e of map.values()) {
    const m = mallMap.get(e.mall_id);
    if (!options.includeTest && m && m.status === "test") continue;
    const tm = titleMap.get(String(e.product_id));
    if (tm) { if (!e.title) e.title = tm.title || null; if (!e.thumb) e.thumb = tm.thumb || null; }
    const cm = codeMap.get(String(e.product_id));
    e.skc_codes = cm ? cm.skcs : null;
    e.sku_codes = cm ? cm.skus : null;
    e.declared_price = cm && cm.declared ? Number(cm.declared) / 100 : null;
    e.score = cm && cm.score != null ? Number(cm.score) : null;
    e.comments = cm && cm.comments != null ? toNum(cm.comments) : null;
    e.stock = cm ? toNum(cm.stock) : null;
    e.occupy = cm ? toNum(cm.occupy) : null;
    e.unavail = cm ? toNum(cm.unavail) : null;
    e.advice = cm ? toNum(cm.advice) : null;
    e.lack = cm ? toNum(cm.lack) : null;
    e.lack_qty = cm ? toNum(cm.lackQty) : null;
    e.shipping = shipMap.get(e.mall_id + "|" + e.product_id) || 0;
    // 总库存 = 可用 + 暂不可用 - 缺货件数 + 发货在途
    e.total_stock = cm ? (toNum(cm.stock) + toNum(cm.unavail) - toNum(cm.lackQty) + e.shipping) : null;
    e.skus_detail = detailMap.get(String(e.product_id)) || [];
    e.store_code = m ? m.store_code || null : null;
    e.mall_name = m ? m.mall_name || null : null;
    out.push(e);
  }
  out.sort((a, b) => (b.limited ? 1 : 0) - (a.limited ? 1 : 0) || (b.compliance ? 1 : 0) - (a.compliance ? 1 : 0) || (b.act_cnt - a.act_cnt) || ((b.expose || 0) - (a.expose || 0)));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out.slice(0, 4000) };
  _productPanelCache.set(key, { data, ts: Date.now() });
  return data;
}

// 商品运营面板:优先读物化缓存表(cron 预聚合,毫秒),无/未跑则实时兜底(慢)
function getProductPanelFast(db, options = {}) {
  try {
    const key = "product_panel:" + (options.includeTest ? "1" : "0");
    const row = db.prepare("SELECT payload_json, updated_at FROM erp_report_cache WHERE cache_key = ?").get(key);
    if (row && row.payload_json) {
      const d = JSON.parse(row.payload_json);
      d.cached_at = row.updated_at || null;
      return d;
    }
  } catch (e) { /* 表不存在/解析失败 → 走实时兜底 */ }
  return buildProductPanel(db, options);
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

// 运营工作台「今日待办」闭环状态:KV 表 op_task_state(task_key → 已处理/已忽略)
// 表可能在未跑 migration 的旧服务器上不存在,list 容错返回空;set 走 upsert/delete
function listOpTaskState(db) {
  if (!db) throw new Error("listOpTaskState: db is required (host mode only)");
  try {
    const rows = db.prepare("SELECT task_key, status, owner, note, updated_at FROM op_task_state").all();
    return { rows };
  } catch (e) {
    if (/no such table/i.test(e?.message || "")) return { rows: [] };
    throw e;
  }
}
function setOpTaskState(db, taskKey, status, owner) {
  if (!db) throw new Error("setOpTaskState: db is required (host mode only)");
  if (!taskKey) throw new Error("setOpTaskState: taskKey is required");
  const key = String(taskKey);
  if (status == null) {
    return db.prepare("DELETE FROM op_task_state WHERE task_key = ?").run(key).changes;
  }
  if (status !== "done" && status !== "ignored") throw new Error("setOpTaskState: invalid status");
  const normOwner = owner == null || String(owner).trim() === "" ? null : String(owner).trim();
  return db.prepare(
    `INSERT INTO op_task_state (task_key, status, owner, note, updated_at)
     VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(task_key) DO UPDATE SET status = excluded.status, owner = excluded.owner, updated_at = excluded.updated_at`
  ).run(key, status, normOwner, Date.now()).changes;
}

// 采购单报表(纯本地 erp.sqlite，不涉及 cloud)：汇总/分布/供应商/月趋势均为「全量 SQL 聚合」，
// 明细只取最近 ORDERS_LIMIT 单(附截断标记)。采购总额 = total_amount(货款) + freight_amount(运费)。
// 已付口径用 payment_status='paid'(paid_amount 列在历史数据里普遍被填成=总额，不可信)。
let _purchaseReportCache = { ts: 0, data: null };
function buildPurchaseReport(db, options = {}) {
  if (!db) throw new Error("buildPurchaseReport: db is required (host mode only)");
  if (!options.force && _purchaseReportCache.data && Date.now() - _purchaseReportCache.ts < REPORT_CACHE_TTL_MS) return _purchaseReportCache.data;
  const STATUS_LABELS = {
    draft: "草稿", pushed_pending_price: "待报价", pending_finance_approval: "待财务审批",
    approved_to_pay: "待付款", paid: "已付款", supplier_processing: "供应商处理中",
    shipped: "已发货", arrived: "已到货", inbounded: "已入库", closed: "已关闭",
    delayed: "已延期", exception: "异常", cancelled: "已取消",
  };
  const ORDERS_LIMIT = 500;
  const curMonth = new Date().toISOString().slice(0, 7);
  const AMT = "(COALESCE(total_amount,0)+COALESCE(freight_amount,0))"; // 采购总额表达式
  // 供应商主体名：仅取 1688 订单详情的卖家公司名/店铺名(兼容 $.baseInfo 与 $.result.baseInfo 两种结构)。
  // 仅约 1.3% 单有(其余聚水潭单无 1688 详情)，无则 null；不再 fallback 采购员(那是 jst_purchaser_name)。
  const SUP = "COALESCE(NULLIF(json_extract(po.external_order_detail_json,'$.baseInfo.sellerContact.companyName'),''),NULLIF(json_extract(po.external_order_detail_json,'$.result.baseInfo.sellerContact.companyName'),''),NULLIF(json_extract(po.external_order_detail_json,'$.baseInfo.sellerLoginId'),''),NULLIF(json_extract(po.external_order_detail_json,'$.result.baseInfo.sellerLoginId'),''))";
  // 1) 汇总(全量 SQL，不受明细 LIMIT 影响)
  const sr = db.prepare(`
    SELECT COUNT(*) po_count,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled_count,
      SUM(CASE WHEN status<>'cancelled' THEN COALESCE(total_amount,0) ELSE 0 END) goods_amount,
      SUM(CASE WHEN status<>'cancelled' THEN COALESCE(freight_amount,0) ELSE 0 END) freight_amount,
      SUM(CASE WHEN status<>'cancelled' AND payment_status='paid' THEN ${AMT} ELSE 0 END) paid_amount,
      SUM(CASE WHEN status<>'cancelled' AND COALESCE(payment_status,'unpaid')<>'paid' THEN ${AMT} ELSE 0 END) unpaid_amount,
      SUM(CASE WHEN status NOT IN ('cancelled','inbounded','closed') THEN ${AMT} ELSE 0 END) pending_inbound_amount,
      SUM(CASE WHEN status<>'cancelled' AND substr(created_at,1,7)=? THEN ${AMT} ELSE 0 END) this_month_amount,
      SUM(CASE WHEN status<>'cancelled' AND substr(created_at,1,7)=? THEN 1 ELSE 0 END) this_month_count
      FROM erp_purchase_orders`).get(curMonth, curMonth);
  const summary = {
    po_count: toNum(sr.po_count), cancelled_count: toNum(sr.cancelled_count),
    goods_amount: toNum(sr.goods_amount), freight_amount: toNum(sr.freight_amount),
    total_amount: toNum(sr.goods_amount) + toNum(sr.freight_amount),
    paid_amount: toNum(sr.paid_amount), unpaid_amount: toNum(sr.unpaid_amount),
    pending_inbound_amount: toNum(sr.pending_inbound_amount),
    this_month_amount: toNum(sr.this_month_amount), this_month_count: toNum(sr.this_month_count),
    payment_rate: (toNum(sr.goods_amount) + toNum(sr.freight_amount)) > 0 ? toNum(sr.paid_amount) / (toNum(sr.goods_amount) + toNum(sr.freight_amount)) : 0,
  };
  // 2) 状态分布(全量)
  const by_status = optionalAllLocal(db, `SELECT status, COUNT(*) count, SUM(${AMT}) amount FROM erp_purchase_orders GROUP BY status`, [])
    .map((r) => ({ status: r.status, label: STATUS_LABELS[r.status] || r.status, count: toNum(r.count), amount: toNum(r.amount) }))
    .sort((a, b) => b.count - a.count);
  // 3) 采购员 TOP(全量，排除取消)：按采购员(jst_purchaser_name,98.6%覆盖)聚合。
  // 真供应商主体名仅1.3%覆盖(见 SUP)，不足以做排行；故此排行实为采购员维度。字段名沿用 by_supplier。
  const by_supplier = optionalAllLocal(db, `
    SELECT COALESCE(NULLIF(po.jst_purchaser_name,''),'(未知采购员)') supplier_name,
           COUNT(*) count,
           SUM(COALESCE(po.total_amount,0)+COALESCE(po.freight_amount,0)) amount,
           SUM(CASE WHEN po.payment_status='paid' THEN (COALESCE(po.total_amount,0)+COALESCE(po.freight_amount,0)) ELSE 0 END) paid
      FROM erp_purchase_orders po
     WHERE po.status<>'cancelled'
     GROUP BY supplier_name ORDER BY amount DESC LIMIT 20`, [])
    .map((r) => ({ supplier_id: r.supplier_name, supplier_name: r.supplier_name, count: toNum(r.count), amount: toNum(r.amount), paid: toNum(r.paid) }));
  // 4) 月趋势(全量，排除取消，近12月)
  const monthly = optionalAllLocal(db, `
    SELECT substr(created_at,1,7) month, COUNT(*) count, SUM(${AMT}) amount
      FROM erp_purchase_orders WHERE status<>'cancelled' AND created_at IS NOT NULL AND created_at<>''
     GROUP BY month ORDER BY month DESC LIMIT 12`, [])
    .map((r) => ({ month: r.month, count: toNum(r.count), amount: toNum(r.amount) })).reverse();
  // 6) 资金占用四象限(已付×已入库 矩阵，排除取消)：财务看采购资金/负债结构
  const ACT = "status<>'cancelled'";
  const DONE = "status IN ('inbounded','closed')";
  const cap = (w) => { const r = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(${AMT}),0) a FROM erp_purchase_orders WHERE ${w}`).get(); return { count: toNum(r.c), amount: toNum(r.a) }; };
  const capital = {
    paid_done: cap(`${ACT} AND payment_status='paid' AND ${DONE}`),
    paid_undone: cap(`${ACT} AND payment_status='paid' AND NOT (${DONE})`),
    unpaid_done: cap(`${ACT} AND COALESCE(payment_status,'unpaid')<>'paid' AND ${DONE}`),
    unpaid_undone: cap(`${ACT} AND COALESCE(payment_status,'unpaid')<>'paid' AND NOT (${DONE})`),
  };
  // 7) 应付账款账龄(未付单，按下单距今分桶；系统无账期/交期字段，只能按下单日近似)
  const agingRaw = optionalAllLocal(db, `
    SELECT CASE WHEN julianday('now')-julianday(created_at)<=30 THEN '0-30'
                WHEN julianday('now')-julianday(created_at)<=60 THEN '31-60'
                WHEN julianday('now')-julianday(created_at)<=90 THEN '61-90'
                ELSE '90+' END bucket,
           COUNT(*) count, COALESCE(SUM(${AMT}),0) amount
      FROM erp_purchase_orders
     WHERE ${ACT} AND COALESCE(payment_status,'unpaid')<>'paid' AND created_at IS NOT NULL AND created_at<>''
     GROUP BY bucket`, []);
  const aging = ['0-30', '31-60', '61-90', '90+'].map((b) => {
    const r = agingRaw.find((x) => x.bucket === b);
    return { bucket: b, count: r ? toNum(r.count) : 0, amount: r ? toNum(r.amount) : 0 };
  });
  // 8) 现金流出(按 paid_at 实际付款月度；paid_at 仅部分有值，附覆盖率)
  const cashMonthly = optionalAllLocal(db, `
    SELECT substr(paid_at,1,7) month, COUNT(*) count, COALESCE(SUM(${AMT}),0) amount
      FROM erp_purchase_orders WHERE ${ACT} AND paid_at IS NOT NULL AND paid_at<>''
     GROUP BY month ORDER BY month DESC LIMIT 12`, [])
    .map((r) => ({ month: r.month, count: toNum(r.count), amount: toNum(r.amount) })).reverse();
  const covR = db.prepare(`SELECT SUM(CASE WHEN paid_at IS NOT NULL AND paid_at<>'' THEN 1 ELSE 0 END) f, COUNT(*) c FROM erp_purchase_orders WHERE ${ACT} AND payment_status='paid'`).get();
  const cash_outflow = { coverage: toNum(covR.c) > 0 ? Math.round((toNum(covR.f) / toNum(covR.c)) * 100) : 0, monthly: cashMonthly };
  // 9) 已付未发货(预付风险敞口)：钱付了但 status 未到 shipped+，资金占用 + 供应商履约/跑路风险；按下单后拖延天数分桶
  const UNSHIP = "status<>'cancelled' AND payment_status='paid' AND status NOT IN ('shipped','arrived','inbounded','closed')";
  const psT = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(${AMT}),0) a FROM erp_purchase_orders WHERE ${UNSHIP}`).get();
  const psAgingRaw = optionalAllLocal(db, `
    SELECT CASE WHEN julianday('now')-julianday(created_at)<=7 THEN '0-7'
                WHEN julianday('now')-julianday(created_at)<=15 THEN '8-15'
                WHEN julianday('now')-julianday(created_at)<=30 THEN '16-30'
                ELSE '30+' END bucket,
           COUNT(*) count, COALESCE(SUM(${AMT}),0) amount
      FROM erp_purchase_orders WHERE ${UNSHIP} GROUP BY bucket`, []);
  const paid_unshipped = {
    count: toNum(psT.c), amount: toNum(psT.a),
    aging: ['0-7', '8-15', '16-30', '30+'].map((b) => { const r = psAgingRaw.find((x) => x.bucket === b); return { bucket: b, count: r ? toNum(r.count) : 0, amount: r ? toNum(r.amount) : 0 }; }),
  };
  // 5) 明细(最近 ORDERS_LIMIT 单)：先取单，再只聚合这些单的明细行(避免全表 GROUP BY 43404 行)
  const rows = optionalAllLocal(db, `
    SELECT po.id, po.po_no, po.status, po.payment_status, po.total_amount, po.freight_amount,
           po.created_at, po.expected_delivery_date, po.actual_delivery_date, po.paid_at,
           po.supplier_id, ${SUP} supplier_name, po.jst_purchaser_name buyer_name, po.account_id, a.name account_name
      FROM erp_purchase_orders po
      LEFT JOIN erp_accounts a ON a.id = po.account_id
     ORDER BY po.created_at DESC LIMIT ?`, [ORDERS_LIMIT]);
  let lineMap = new Map();
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const lineAgg = optionalAllLocal(db, `SELECT po_id, COUNT(*) line_count, COALESCE(SUM(qty),0) total_qty, COALESCE(SUM(received_qty),0) received_qty FROM erp_purchase_order_lines WHERE po_id IN (${ph}) GROUP BY po_id`, ids);
    lineMap = new Map(lineAgg.map((l) => [l.po_id, l]));
  }
  const orders = rows.map((r) => {
    const lm = lineMap.get(r.id) || {};
    const goods = toNum(r.total_amount), freight = toNum(r.freight_amount);
    const total = goods + freight;
    const isPaid = r.payment_status === "paid";
    const totalQty = toNum(lm.total_qty), recvQty = toNum(lm.received_qty);
    return {
      id: r.id, po_no: r.po_no, status: r.status, status_label: STATUS_LABELS[r.status] || r.status,
      payment_status: r.payment_status || null,
      supplier_id: r.supplier_id || null, supplier_name: r.supplier_name || null, buyer_name: r.buyer_name || null,
      account_id: r.account_id || null, account_name: r.account_name || null,
      goods_amount: goods, freight_amount: freight, total_amount: total,
      paid_amount: isPaid ? total : 0, unpaid_amount: isPaid ? 0 : total,
      line_count: toNum(lm.line_count), total_qty: totalQty, received_qty: recvQty,
      inbound_pct: totalQty > 0 ? Math.round((recvQty / totalQty) * 100) : 0,
      created_at: r.created_at || null, expected_delivery_date: r.expected_delivery_date || null,
      actual_delivery_date: r.actual_delivery_date || null, paid_at: r.paid_at || null,
    };
  });
  const result = {
    generated_at: Date.now(), row_count: toNum(sr.po_count),
    orders_shown: orders.length, orders_truncated: toNum(sr.po_count) > ORDERS_LIMIT,
    summary, capital, aging, cash_outflow, paid_unshipped, by_status, by_supplier, monthly, orders,
  };
  _purchaseReportCache = { ts: Date.now(), data: result };
  return result;
}

module.exports = {
  buildMultiStoreReport,
  buildPurchaseReport,
  prewarmMultiStoreReport,
  buildSkuSales,
  buildRiskList,
  buildActivityList,
  buildShopHealth,
  buildStockOrders,
  buildSalesTrend,
  buildProductPanel,
  getProductPanelFast,
  setMallOwner,
  listOpTaskState,
  setOpTaskState,
  createEnrollTasks,
  pollEnrollResults,
  // 暴露给测试用
  _internal: { fetchCloudReport, readMallDictionary, loginCloud, buildFinancialsByMall, buildByStoreLocal, shiftDate },
};
