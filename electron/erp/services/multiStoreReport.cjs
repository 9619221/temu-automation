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

// 主入口：返回 { generated_at, store_count, stores: [...], unmapped: [...], financials_available }
async function buildMultiStoreReport(db, options = {}) {
  if (!db) throw new Error("multiStoreReport: db is required (host mode only)");
  const cloud = await fetchCloudReport({ includeTest: options.includeTest });
  const dict = readMallDictionary(db);
  const dictByMall = new Map(dict.map((row) => [row.mall_id, row]));

  // 跨库金额聚合（attach 失败/无 cloud 库时为 null，前端降级隐藏金额列）
  let financialsByMall = null;
  try {
    financialsByMall = buildFinancialsByMall(db, options.attachCloudDb);
  } catch (error) {
    // 金额聚合失败不应拖垮整张报表，记录后降级
    financialsByMall = null;
    if (options.onError) options.onError(error);
  }

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
    stores,
    unmapped, // 云端有数据但本地字典没登记的（应该提醒用户去 seed）
  };
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
  setMallOwner,
  // 暴露给测试用
  _internal: { fetchCloudReport, readMallDictionary, loginCloud, buildFinancialsByMall, shiftDate },
};
