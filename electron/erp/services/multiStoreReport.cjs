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

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CLOUD_BASE = "https://erp.temu.chat/cloud";
const CLOUD_LOGIN_USER = "admin";
const CLOUD_LOGIN_PASS = "cjl20020421";
const SETTLEMENT_ROBOT_SOURCE = "robot";
const SETTLEMENT_UNKNOWN_SOURCE = "unknown";
const SETTLEMENT_ROBOT_DEVICE_UUIDS = (process.env.SETTLEMENT_ROBOT_DEVICE_UUIDS || "settlement-robot")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tableColumns(db, tableName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
  } catch {
    return [];
  }
}

function cloudTableColumns(db, tableName) {
  try {
    return db.prepare(`PRAGMA cloud.table_info(${tableName})`).all().map((row) => row.name);
  } catch {
    return [];
  }
}

function cloudTableExists(db, tableName) {
  try {
    return !!db.prepare("SELECT 1 FROM cloud.sqlite_master WHERE type='table' AND name=?").get(tableName);
  } catch {
    return false;
  }
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = tableColumns(db, tableName);
  if (!columns.length || columns.includes(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function ensureSourceColumn(db, tableName) {
  addColumnIfMissing(db, tableName, "source", `source TEXT NOT NULL DEFAULT '${SETTLEMENT_UNKNOWN_SOURCE}'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${tableName}_source ON ${tableName}(source)`);
}

function sourceWhere(db, tableName, alias = "") {
  const columns = tableColumns(db, tableName);
  if (!columns.includes("source")) return " AND 1 = 0";
  const prefix = alias ? `${alias}.` : "";
  return ` AND ${prefix}source = '${SETTLEMENT_ROBOT_SOURCE}'`;
}

function robotCaptureSql(db, alias = "ce") {
  const eventColumns = cloudTableColumns(db, "capture_events");
  if (!eventColumns.includes("device_id") || !SETTLEMENT_ROBOT_DEVICE_UUIDS.length) {
    return { from: `cloud.capture_events ${alias}`, where: " AND 1 = 0", columns: eventColumns };
  }
  const ids = SETTLEMENT_ROBOT_DEVICE_UUIDS.map(sqlQuote).join(",");
  if (cloudTableExists(db, "devices")) {
    return {
      from: `cloud.capture_events ${alias} LEFT JOIN cloud.devices cd ON cd.id = ${alias}.device_id`,
      where: ` AND (${alias}.device_id IN (${ids}) OR cd.device_uuid IN (${ids}))`,
      columns: eventColumns,
    };
  }
  return {
    from: `cloud.capture_events ${alias}`,
    where: ` AND ${alias}.device_id IN (${ids})`,
    columns: eventColumns,
  };
}

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
function getRawApis(data) {
  if (Array.isArray(data?.apis)) return data.apis;
  if (Array.isArray(data?.data?.apis)) return data.data.apis;
  return [];
}

function unwrapApiPayload(entry) {
  return entry?.data?.result ?? entry?.data?.data ?? entry?.data ?? entry?.result ?? null;
}

function findDashboardApi(raw, pattern) {
  return getRawApis(raw).find((item) => String(item?.path || "").includes(pattern));
}

function parseIncomeAmount(value) {
  const amount = value && typeof value === "object" ? value : {};
  const cents = Number(amount.amount);
  if (Number.isFinite(cents)) return { yuan: cents / 100, cents: Math.round(cents) };
  const yuan = Number(amount.digitalText ?? amount.fullText ?? value);
  return { yuan: Number.isFinite(yuan) ? yuan : 0, cents: Number.isFinite(yuan) ? Math.round(yuan * 100) : null };
}

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeSettlementDate(item) {
  const raw = firstDefined(item, [
    "date", "statDate", "stat_date", "dateStr", "dataDate", "day", "pt",
    "settleDate", "settlementDate",
  ]);
  if (raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = text.match(/\d{4}-\d{2}-\d{2}/) || text.match(/\d{4}\/\d{2}\/\d{2}/);
  return (match ? match[0] : text.slice(0, 10)).replace(/\//g, "-");
}

function pickSettlementAmount(item) {
  return firstDefined(item, [
    "incomeAmount", "amount", "income", "incomeAmt", "settlementIncome",
    "settleAmount", "settlementAmount", "value",
  ]);
}

function inferDashboardMallId(raw, explicitMallId) {
  const mallId = String(explicitMallId || "").trim();
  if (mallId) return mallId;
  const userInfo = unwrapApiPayload(findDashboardApi(raw, "/auth/userInfo"));
  const malls = Array.isArray(userInfo?.mallList) ? userInfo.mallList : [];
  return malls.length === 1 && malls[0]?.mallId ? String(malls[0].mallId) : null;
}

function extractSettlementIncomeRows(raw, options = {}) {
  const incomeApi = findDashboardApi(raw, "finance/income-summary");
  const income = extractSettlementIncomeListFromCaptureBody(unwrapApiPayload(incomeApi));
  if (!Array.isArray(income) || !income.length) return [];
  const mallId = inferDashboardMallId(raw, options.mallId || options.mall_id);
  const accountId = String(options.accountId || options.account_id || "").trim() || null;
  const scopeKey = mallId || accountId || "__dashboard__";
  const source = String(options.source || SETTLEMENT_UNKNOWN_SOURCE).trim() || SETTLEMENT_UNKNOWN_SOURCE;
  return income
    .map((item) => ({ item, statDate: normalizeSettlementDate(item) }))
    .filter(({ item, statDate }) => item && statDate)
    .map((item) => {
      const amount = pickSettlementAmount(item.item);
      const parsed = parseIncomeAmount(amount);
      return {
        scope_key: scopeKey,
        mall_id: mallId,
        account_id: accountId,
        stat_date: item.statDate,
        currency: String(amount?.currencyCode || item.item.incomeAmount?.currencyCode || item.item.currency || "CNY"),
        income_amount: parsed.yuan,
        income_amount_cents: parsed.cents,
        raw_json: JSON.stringify(item.item),
        source,
      };
    });
}

function upsertSettlementIncomeFromDashboard(db, payload = {}) {
  const rows = extractSettlementIncomeRows(payload.dashboard || payload.raw || payload, payload);
  if (!rows.length) return { rows: 0, scopeKey: null, mallId: null, accountId: payload.accountId || payload.account_id || null };
  ensureSourceColumn(db, "erp_temu_settlement_income");
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO erp_temu_settlement_income
      (scope_key, mall_id, account_id, stat_date, currency, income_amount, income_amount_cents, raw_json, source, synced_at)
    VALUES
      (@scope_key, @mall_id, @account_id, @stat_date, @currency, @income_amount, @income_amount_cents, @raw_json, @source, @synced_at)
    ON CONFLICT(scope_key, stat_date) DO UPDATE SET
      mall_id = excluded.mall_id,
      account_id = excluded.account_id,
      currency = excluded.currency,
      income_amount = excluded.income_amount,
      income_amount_cents = excluded.income_amount_cents,
      raw_json = excluded.raw_json,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run({ ...row, synced_at: now });
  });
  tx();
  return { rows: rows.length, scopeKey: rows[0].scope_key, mallId: rows[0].mall_id, accountId: rows[0].account_id };
}

// 看板财务接口路径（官方开放平台无财务/结算 API，只能走 worker/扩展抓包，原始事件落 cloud.capture_events）
const SETTLEMENT_INCOME_PATH = "/api/merchant/front/finance/income-summary";
const SETTLEMENT_INCOME_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "081_temu_settlement_income.sql");

function ensureSettlementIncomeSchema(db) {
  db.exec(fs.readFileSync(SETTLEMENT_INCOME_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_settlement_income");
}

function extractSettlementIncomeListFromCaptureBody(body) {
  const candidates = [
    body?.result,
    body?.result?.data,
    body?.result?.list,
    body?.result?.rows,
    body?.result?.items,
    body?.result?.records,
    body?.result?.incomeSummaryList,
    body?.data?.result,
    body?.data?.data,
    body?.data?.list,
    body?.data?.rows,
    body?.data?.items,
    body?.data?.records,
    body?.data?.incomeSummaryList,
    body?.data,
    body?.list,
    body?.rows,
    body?.items,
    body?.records,
    body?.incomeSummaryList,
    body,
  ];
  return candidates.find((value) => Array.isArray(value)) || [];
}

// 采集入口：从 cloud.capture_events 批量物化结算收入。抓包按店、按日合并（received_at 升序、
// 后写覆盖=最新一条），逐店复用 upsertSettlementIncomeFromDashboard 落 erp_temu_settlement_income。
// 需要 db 已具备挂载 cloud 的能力（opts.attachCloudDb）。供独立同步脚本/定时器调用，不进报表热路径。
function syncSettlementIncomeFromCapture(db, opts = {}) {
  ensureSettlementIncomeSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    events = db.prepare(`
      SELECT ce.mall_id, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path = ? AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(SETTLEMENT_INCOME_PATH);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  // 按 mall 聚合：stat_date → 原始 income item（received_at 升序遍历，后写覆盖=最新抓包）
  const byMall = new Map();
  for (const ev of events) {
    let body;
    try { body = JSON.parse(ev.body_json); } catch { continue; }
    const list = extractSettlementIncomeListFromCaptureBody(body);
    if (!Array.isArray(list)) continue;
    const mallId = String(ev.mall_id);
    if (!byMall.has(mallId)) byMall.set(mallId, new Map());
    const dayMap = byMall.get(mallId);
    for (const item of list) {
      const statDate = normalizeSettlementDate(item);
      if (item && statDate) dayMap.set(statDate, item);
    }
  }
  let totalRows = 0;
  for (const [mallId, dayMap] of byMall) {
    if (!dayMap.size) continue;
    const apis = [{ path: SETTLEMENT_INCOME_PATH, data: { result: Array.from(dayMap.values()) } }];
    totalRows += upsertSettlementIncomeFromDashboard(db, { dashboard: { apis }, mallId, source: SETTLEMENT_ROBOT_SOURCE }).rows;
  }
  return { ok: true, attached: true, malls: byMall.size, rows: totalRows };
}

function emptySettlement() {
  return {
    latest_date: null,
    today: { income: 0 },
    last7d: { income: 0, income_prev: 0, income_wow: null },
    last30d: { income: 0, income_prev: 0, income_mom: null },
    trend_daily: [],
  };
}

function buildSettlementIncomeByMall(db) {
  let latest;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_settlement_income");
    latest = db.prepare(`
      SELECT MAX(stat_date) AS d
      FROM erp_temu_settlement_income
      WHERE mall_id IS NOT NULL AND mall_id <> ''
        ${sourceSql}
    `).get()?.d;
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return null;
    throw error;
  }
  if (!latest) return new Map();

  const since = shiftDate(latest, -59);
  const sourceSql = sourceWhere(db, "erp_temu_settlement_income");
  const rows = db.prepare(`
    SELECT mall_id, stat_date AS d, SUM(income_amount) AS income
    FROM erp_temu_settlement_income
    WHERE mall_id IS NOT NULL AND mall_id <> ''
      AND stat_date >= ? AND stat_date <= ?
      ${sourceSql}
    GROUP BY mall_id, stat_date
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
      const settlement = emptySettlement();
      settlement.latest_date = latest;
      settlement._trend = new Map();
      byMall.set(mallId, settlement);
    }
    return byMall.get(mallId);
  };

  for (const row of rows) {
    const settlement = ensure(row.mall_id);
    const income = Number(row.income) || 0;
    const d = row.d;
    settlement._trend.set(d, { date: d, income });
    if (d === latest) settlement.today.income += income;
    if (d >= d7start && d <= latest) settlement.last7d.income += income;
    if (d >= d7prevStart && d <= d7prevEnd) settlement.last7d.income_prev += income;
    if (d >= d30start && d <= latest) settlement.last30d.income += income;
    if (d >= d30prevStart && d <= d30prevEnd) settlement.last30d.income_prev += income;
  }

  for (const settlement of byMall.values()) {
    settlement.last7d.income_wow = settlement.last7d.income_prev > 0
      ? (settlement.last7d.income - settlement.last7d.income_prev) / settlement.last7d.income_prev
      : null;
    settlement.last30d.income_mom = settlement.last30d.income_prev > 0
      ? (settlement.last30d.income - settlement.last30d.income_prev) / settlement.last30d.income_prev
      : null;
    settlement.trend_daily = Array.from(settlement._trend.values()).sort((a, b) => a.date.localeCompare(b.date));
    delete settlement._trend;
  }

  return byMall;
}

// 结算明细三态（待处理/结算中/已到账）按店聚合，来源 erp_temu_settlement_detail（抓包物化）。
// 与收入汇总 income 旁路独立：income 是日度收入总额，detail 是逐笔结算单按状态汇总。
function emptySettlementDetailBucket() {
  return { count: 0, estimated: 0, sales_receipt: 0, chargeback: 0, subsidy: 0, total: 0 };
}

function emptySettlementDetail() {
  return {
    currency: "CNY",
    wait_settlement: emptySettlementDetailBucket(),
    in_settlement: emptySettlementDetailBucket(),
    settled: emptySettlementDetailBucket(),
  };
}

function buildSettlementDetailByMall(db, opts = {}) {
  // 注意：不按 stat_date 过滤。汇总卡片的统计窗口由采集时的请求参数决定（面板「结算时间范围」），
  // 物化行的 stat_date 只是采集日，按它过滤会把最新快照误伤掉（如 6/12 凌晨采的 6/1-11 窗口数据）。
  // 因此三态列展示的是「最近一次采集时所选窗口」的快照。
  const { startDate, endDate } = opts;
  const params = [];
  let dateWhere = "";
  if (startDate && endDate) {
    dateWhere = "AND stat_date >= ? AND stat_date <= ?";
    params.push(startDate, endDate);
  }
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_settlement_detail");
    // settle/detail/full/* 接口返回的是「汇总卡片」（一段时间范围一个总数），每次采集落一行快照。
    // 同店同状态同区域多行快照是同一笔钱的重复观测，必须取最新一条（按 source_received_at），绝不能 SUM。
    // 多区店（全球/美区/欧区是独立站点账户）按区各取最新后跨区加总，单区店行为不变。
    rows = db.prepare(`
      SELECT mall_id, settlement_status,
             COUNT(*) AS cnt,
             SUM(estimated_amount) AS estimated,
             SUM(sales_receipt_amount) AS sales_receipt,
             SUM(chargeback_amount) AS chargeback,
             SUM(subsidy_amount) AS subsidy,
             SUM(total_amount) AS total,
             MAX(currency) AS currency
      FROM (
        SELECT *, ROW_NUMBER() OVER (
                 PARTITION BY mall_id, settlement_status, COALESCE(site, '')
                 ORDER BY COALESCE(source_received_at, 0) DESC, stat_date DESC
               ) AS rn
          FROM erp_temu_settlement_detail
         WHERE mall_id IS NOT NULL AND mall_id <> ''
           ${dateWhere}
           ${sourceSql}
      ) WHERE rn = 1
      GROUP BY mall_id, settlement_status
    `).all(...params);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return null;
    throw error;
  }
  if (!rows.length) return new Map();

  const byMall = new Map();
  for (const row of rows) {
    if (!byMall.has(row.mall_id)) byMall.set(row.mall_id, emptySettlementDetail());
    const detail = byMall.get(row.mall_id);
    const bucket = detail[row.settlement_status];
    if (!bucket) continue; // 未知状态忽略
    bucket.count = Number(row.cnt) || 0;
    bucket.estimated = Number(row.estimated) || 0;
    bucket.sales_receipt = Number(row.sales_receipt) || 0;
    bucket.chargeback = Number(row.chargeback) || 0;
    bucket.subsidy = Number(row.subsidy) || 0;
    bucket.total = Number(row.total) || 0;
    if (row.currency) detail.currency = row.currency;
  }
  return byMall;
}

const SETTLEMENT_DETAIL_PATH_STATUS = new Map([
  ["/api/merchant/settle/detail/full/wait-settlement", "wait_settlement"],
  ["/api/merchant/settle/detail/full/in-settlement", "in_settlement"],
  ["/api/merchant/settle/detail/full/settled", "settled"],
]);
const SETTLEMENT_DETAIL_PATHS = Array.from(SETTLEMENT_DETAIL_PATH_STATUS.keys());
const SETTLEMENT_DETAIL_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "082_temu_settlement_detail.sql");

function ensureSettlementDetailSchema(db) {
  db.exec(fs.readFileSync(SETTLEMENT_DETAIL_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_settlement_detail");
}

function bjDateFromTimestamp(value) {
  const n = Number(value);
  const ms = Number.isFinite(n) && n > 0 ? n : Date.now();
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

function normalizeSettlementDetailDate(item, receivedAt) {
  return normalizeSettlementDate(item) || bjDateFromTimestamp(receivedAt);
}

function stableJsonHash(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value || {})).digest("hex").slice(0, 16);
}

function extractSettlementDetailListFromCaptureBody(body) {
  const candidates = [
    body?.result?.data?.list,
    body?.result?.data?.rows,
    body?.result?.data?.items,
    body?.result?.list,
    body?.result?.rows,
    body?.result?.items,
    body?.data?.result?.list,
    body?.data?.result?.rows,
    body?.data?.list,
    body?.data?.rows,
    body?.data?.items,
    body?.list,
    body?.rows,
    body?.items,
  ];
  const list = candidates.find((value) => Array.isArray(value));
  if (Array.isArray(list)) return list;
  const objectCandidate = body?.result?.data || body?.result || body?.data || body;
  return objectCandidate && typeof objectCandidate === "object" ? [objectCandidate] : [];
}

function normalizeMoneyAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const cents = Number(value.amount ?? value.cent ?? value.cents);
    if (Number.isFinite(cents)) {
      return {
        yuan: cents / 100,
        cents: Math.round(cents),
        currency: value.currencyCode || value.currency || null,
      };
    }
    // digitalText 可能带千分位逗号（"3,359.43"），直接 Number() 会 NaN（028 实测金额>999 全被解析成 0）
    const text = value.digitalText ?? value.fullText ?? value.text;
    let yuanObj = typeof text === "number" ? text : NaN;
    if (typeof text === "string") {
      const n = Number(text.replace(/[,\s¥$€£]/g, ""));
      if (Number.isFinite(n)) yuanObj = n;
    }
    // text 字段缺失时退到 value.value（接口原值，单位分；digitalText 语义是绝对值，保持一致取 abs）
    if (!Number.isFinite(yuanObj) && Number.isFinite(Number(value.value))) {
      yuanObj = Math.abs(Number(value.value)) / 100;
    }
    if (Number.isFinite(yuanObj)) {
      return {
        yuan: yuanObj,
        cents: Math.round(yuanObj * 100),
        currency: value.currencyCode || value.currency || null,
      };
    }
    return null;
  }
  const yuan = Number(String(value).replace(/[,\s]/g, "").replace(/^[^\d.-]+/, ""));
  if (!Number.isFinite(yuan)) return null;
  return { yuan, cents: Math.round(yuan * 100), currency: null };
}

function collectSettlementAmounts(root) {
  const out = {};
  const stack = [{ value: root, path: "" }];
  let steps = 0;
  const amountKeyRe = /(amount|income|payment|receipt|reverse|reversal|chargeback|subsidy|settlement|sales|refund|compensat|allowance)/i;
  while (stack.length && steps < 3000) {
    steps++;
    const { value, path: p } = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => stack.push({ value: item, path: `${p}[${idx}]` }));
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = p ? `${p}.${key}` : key;
      if (amountKeyRe.test(key)) {
        const parsed = normalizeMoneyAmount(child);
        if (parsed) out[childPath] = parsed;
      }
      if (child && typeof child === "object") stack.push({ value: child, path: childPath });
    }
  }
  return out;
}

function firstAmountByPath(amounts, patterns, rejectPatterns = []) {
  for (const [key, parsed] of Object.entries(amounts || {})) {
    if (rejectPatterns.some((pattern) => pattern.test(key))) continue;
    if (patterns.some((pattern) => pattern.test(key))) return parsed;
  }
  return null;
}

function pickSettlementDetailItemKey(item) {
  const explicit = firstDefined(item, [
    "settlementOrderSn", "settlementSn", "settlementNo", "settlementId",
    "billNo", "billId", "detailId", "id", "orderSn", "transactionId",
  ]);
  return explicit ? String(explicit) : `raw_${stableJsonHash(item)}`;
}

function buildSettlementDetailRowsFromCaptureEvent(ev) {
  const status = SETTLEMENT_DETAIL_PATH_STATUS.get(ev.url_path);
  if (!status) return [];
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  const list = extractSettlementDetailListFromCaptureBody(body);
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId || !list.length) return [];
  const site = String(ev.site || "").trim();
  const scopeKey = mallId;
  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const amounts = collectSettlementAmounts(item);
      // Temu 实际字段名：waitSettleAmount / incomeAmount / afsReverseAmount / afsReleaseAmount
      const estimated = firstAmountByPath(amounts, [/estimate/i, /waitSettle/i, /wait.*settle/i, /pending/i]);
      const sales = firstAmountByPath(amounts, [/sales/i, /receipt/i, /payment/i, /^incomeAmount/i, /^income/i], [/chargeback/i, /reverse/i, /reversal/i, /refund/i]);
      const chargeback = firstAmountByPath(amounts, [/chargeback/i, /reverse/i, /reversal/i, /refund/i]);
      const subsidy = firstAmountByPath(amounts, [/subsidy/i, /compensat/i, /allowance/i, /afsRelease/i, /release/i]);
      const total = firstAmountByPath(
        amounts,
        [/total/i, /^amount$/i, /settlementAmount/i],
        [/estimate/i, /wait/i, /pending/i],
      );
      const currency = estimated?.currency || sales?.currency || chargeback?.currency || subsidy?.currency || total?.currency || item.currency || "CNY";
      const derivedTotal = total?.yuan ?? ((sales?.yuan || 0) - (chargeback?.yuan || 0) + (subsidy?.yuan || 0));
      return {
        scope_key: scopeKey,
        mall_id: mallId,
        site,
        settlement_status: status,
        stat_date: normalizeSettlementDetailDate(item, ev.received_at),
        item_key: pickSettlementDetailItemKey(item),
        currency: String(currency || "CNY"),
        estimated_amount: estimated?.yuan || 0,
        sales_receipt_amount: sales?.yuan || 0,
        chargeback_amount: chargeback?.yuan || 0,
        subsidy_amount: subsidy?.yuan || 0,
        total_amount: Number.isFinite(derivedTotal) ? derivedTotal : 0,
        amounts_json: JSON.stringify(amounts),
        raw_json: JSON.stringify(item),
        source_received_at: Number(ev.received_at) || null,
        source: SETTLEMENT_ROBOT_SOURCE,
      };
    });
}

function upsertSettlementDetailRows(db, rows) {
  if (!rows.length) return { rows: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO erp_temu_settlement_detail
      (scope_key, mall_id, site, settlement_status, stat_date, item_key, currency,
       estimated_amount, sales_receipt_amount, chargeback_amount, subsidy_amount, total_amount,
       amounts_json, raw_json, source_received_at, source, synced_at)
    VALUES
      (@scope_key, @mall_id, @site, @settlement_status, @stat_date, @item_key, @currency,
       @estimated_amount, @sales_receipt_amount, @chargeback_amount, @subsidy_amount, @total_amount,
       @amounts_json, @raw_json, @source_received_at, @source, @synced_at)
    ON CONFLICT(scope_key, site, settlement_status, stat_date, item_key) DO UPDATE SET
      mall_id = excluded.mall_id,
      currency = excluded.currency,
      estimated_amount = excluded.estimated_amount,
      sales_receipt_amount = excluded.sales_receipt_amount,
      chargeback_amount = excluded.chargeback_amount,
      subsidy_amount = excluded.subsidy_amount,
      total_amount = excluded.total_amount,
      amounts_json = excluded.amounts_json,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run({ ...row, synced_at: now });
  });
  tx();
  return { rows: rows.length };
}

function syncSettlementDetailFromCapture(db, opts = {}) {
  ensureSettlementDetailSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    const siteSelect = capture.columns.includes("site") ? "ce.site" : "'' AS site";
    events = db.prepare(`
      SELECT ce.mall_id, ${siteSelect}, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path IN (${SETTLEMENT_DETAIL_PATHS.map(() => "?").join(",")})
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(...SETTLEMENT_DETAIL_PATHS);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const rows = [];
  const malls = new Set();
  for (const ev of events) {
    const eventRows = buildSettlementDetailRowsFromCaptureEvent(ev);
    for (const row of eventRows) {
      rows.push(row);
      if (row.mall_id) malls.add(row.mall_id);
    }
  }
  const result = upsertSettlementDetailRows(db, rows);
  return { ok: true, attached: true, malls: malls.size, rows: result.rows };
}

// =====================================================================
// 对账中心账务明细（seller.kuajingmaihuo.com /api/merchant/fund/detail/pageSearch）
// 被动 hook 抓包 → cloud.capture_events → erp_temu_fund_detail
// 费用类型靠 fundTypeDesc + remark 映射：售后赔付/仓储费/EPR/广告/推广等
// =====================================================================
const FUND_DETAIL_PATH = "/api/merchant/fund/detail/pageSearch";

function ensureFundDetailSchema(db) {
  const migSql = fs.readFileSync(
    path.join(__dirname, "..", "..", "db", "migrations", "083_temu_fund_detail.sql"),
    "utf8"
  );
  db.exec(migSql);
  ensureSourceColumn(db, "erp_temu_fund_detail");
}

function buildFundDetailRowsFromCaptureEvent(ev) {
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  let list = body?.result?.resultList || body?.result?.list || body?.resultList || body?.list || [];
  if (!Array.isArray(list)) return [];
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId) return [];
  const site = String(ev.site || "").trim() || "kuajingmaihuo";

  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      let amount = null;
      if (item.amountFormat && typeof item.amountFormat.value === "number") {
        amount = item.amountFormat.value;
      } else if (typeof item.amount === "number") {
        amount = item.amount;
      } else if (typeof item.amount === "string") {
        const m = item.amount.match(/[+-]?[\d,]+\.?\d*/);
        if (m) amount = parseFloat(m[0].replace(/,/g, ""));
      }
      if (amount != null && item.moneyChangeType === 2 && amount > 0) amount = -amount;
      let originAmount = null;
      if (item.originAmount != null) {
        if (typeof item.originAmount === "number") originAmount = item.originAmount;
        else if (typeof item.originAmount === "string") {
          const om = item.originAmount.match(/[+-]?[\d,]+\.?\d*/);
          if (om) originAmount = parseFloat(om[0].replace(/,/g, ""));
        }
      }
      return {
        mall_id: mallId,
        trans_sn: item.transSn || item.transactionSn || null,
        batch_id: item.batchId || "",
        transaction_time: item.transactionTime || item.createTime || "",
        create_time: item.createTime || "",
        money_change_type: item.moneyChangeType ?? null,
        fund_type: item.fundType ?? null,
        fund_type_desc: item.fundTypeDesc || "",
        currency: item.currencyType || item.amountFormat?.currencyCode || "CNY",
        amount,
        origin_amount: originAmount,
        remark: item.remark || "",
        remark_prompt: typeof item.remarkPrompt === "string" ? item.remarkPrompt : (item.remarkPrompt ? JSON.stringify(item.remarkPrompt) : ""),
        biz_type: item.bizType != null ? String(item.bizType) : "",
        source_region: item.sourceRegion != null ? String(item.sourceRegion) : "",
        query_id: item.queryId || "",
        site,
        source: SETTLEMENT_ROBOT_SOURCE,
      };
    });
}

function upsertFundDetailRows(db, rows) {
  if (!rows.length) return { rows: 0 };
  const now = new Date().toISOString();
  const stmtWithSn = db.prepare(`
    INSERT INTO erp_temu_fund_detail
      (mall_id, trans_sn, batch_id, transaction_time, create_time,
       money_change_type, fund_type, fund_type_desc, currency,
       amount, origin_amount, remark, remark_prompt,
       biz_type, source_region, query_id, site, source, updated_at)
    VALUES
      (@mall_id, @trans_sn, @batch_id, @transaction_time, @create_time,
       @money_change_type, @fund_type, @fund_type_desc, @currency,
       @amount, @origin_amount, @remark, @remark_prompt,
       @biz_type, @source_region, @query_id, @site, @source, @now)
    ON CONFLICT(mall_id, trans_sn) DO UPDATE SET
      batch_id = excluded.batch_id,
      transaction_time = excluded.transaction_time,
      money_change_type = excluded.money_change_type,
      fund_type = excluded.fund_type,
      fund_type_desc = excluded.fund_type_desc,
      currency = excluded.currency,
      amount = excluded.amount,
      origin_amount = excluded.origin_amount,
      remark = excluded.remark,
      remark_prompt = excluded.remark_prompt,
      biz_type = excluded.biz_type,
      source_region = excluded.source_region,
      query_id = excluded.query_id,
      site = excluded.site,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);
  const stmtNoSn = db.prepare(`
    INSERT INTO erp_temu_fund_detail
      (mall_id, trans_sn, batch_id, transaction_time, create_time,
       money_change_type, fund_type, fund_type_desc, currency,
       amount, origin_amount, remark, remark_prompt,
       biz_type, source_region, query_id, site, source, updated_at)
    VALUES
      (@mall_id, @trans_sn, @batch_id, @transaction_time, @create_time,
       @money_change_type, @fund_type, @fund_type_desc, @currency,
       @amount, @origin_amount, @remark, @remark_prompt,
       @biz_type, @source_region, @query_id, @site, @source, @now)
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const params = { ...row, now };
      if (row.trans_sn) stmtWithSn.run(params);
      else stmtNoSn.run(params);
      inserted++;
    }
  });
  tx();
  return { rows: inserted };
}

function syncFundDetailFromCapture(db, opts = {}) {
  ensureFundDetailSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    const siteSelect = capture.columns.includes("site") ? "ce.site" : "'' AS site";
    events = db.prepare(`
      SELECT ce.mall_id, ${siteSelect}, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path = ?
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(FUND_DETAIL_PATH);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const rows = [];
  const malls = new Set();
  for (const ev of events) {
    const eventRows = buildFundDetailRowsFromCaptureEvent(ev);
    for (const r of eventRows) {
      rows.push(r);
      if (r.mall_id) malls.add(r.mall_id);
    }
  }
  if (!rows.length) return { ok: true, attached: true, malls: 0, rows: 0 };
  const result = upsertFundDetailRows(db, rows);
  return { ok: true, attached: true, malls: malls.size, rows: result.rows };
}

// =====================================================================
// 结算批次订单级明细（xlsx 下载解析结果）
// worker 已把 /api/merchant/fund/detail/item/semi/download 的 xlsx 行转成
// fetch-active-settlement-orders 事件；这里落 ERP 表，供后续按订单/SKU 核算成本。
// =====================================================================
const SETTLEMENT_ORDER_DETAIL_PATH = "/api/merchant/fund/detail/item/semi/download";
const SETTLEMENT_ORDER_DETAIL_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "085_temu_settlement_order_detail.sql");

function ensureSettlementOrderDetailSchema(db) {
  db.exec(fs.readFileSync(SETTLEMENT_ORDER_DETAIL_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_settlement_order_detail");
  const columns = db.prepare("PRAGMA table_info(erp_temu_settlement_order_detail)").all().map((row) => row.name);
  if (!columns.includes("wb_no")) {
    db.exec("ALTER TABLE erp_temu_settlement_order_detail ADD COLUMN wb_no TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_temu_settlement_order_detail_wb ON erp_temu_settlement_order_detail(wb_no)");
}

function normalizeHeaderName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:：/\\()[\]{}【】（）"'`]+/g, "");
}

function pickRowValue(row, keys, opts = {}) {
  if (!row || typeof row !== "object") return null;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  const normalized = new Map();
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null || value === "") continue;
    normalized.set(normalizeHeaderName(key), value);
  }
  for (const key of keys) {
    const nk = normalizeHeaderName(key);
    if (normalized.has(nk)) return normalized.get(nk);
  }
  if (opts.includes) {
    const wanted = keys.map(normalizeHeaderName).filter(Boolean);
    for (const [key, value] of normalized.entries()) {
      if (wanted.some((needle) => key.includes(needle))) return value;
    }
  }
  return null;
}

function parseNumberLoose(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    return parseNumberLoose(firstDefined(value, ["value", "amount", "digitalText", "fullText", "text"]));
  }
  const text = String(value).trim();
  if (!text) return null;
  const negativeByParen = /^\(.*\)$/.test(text);
  const normalized = text.replace(/,/g, "").replace(/[^\d.+-]/g, "");
  if (!normalized || normalized === "-" || normalized === "+") return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negativeByParen && n > 0 ? -n : n;
}

function parseIntegerLoose(value) {
  const n = parseNumberLoose(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeWbNo(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/\bWB[A-Z0-9-]+\b/i);
  return match ? match[0].toUpperCase() : null;
}

function pickSettlementWbNo(row) {
  const direct = pickRowValue(row, [
    "wb_no",
    "wbNo",
    "WB",
    "WB No",
    "WB No.",
    "stockUpOrderNo",
    "stock_up_order_no",
    "purchaseOrderNo",
    "purchase_order_no",
    "备货单号",
    "备货单编号",
    "备货单",
  ], { includes: true });
  const directWb = normalizeWbNo(direct);
  if (directWb) return directWb;
  if (!row || typeof row !== "object") return null;
  for (const value of Object.values(row)) {
    if (value && typeof value === "object") {
      const nested = normalizeWbNo(firstDefined(value, ["value", "text", "fullText", "digitalText"]));
      if (nested) return nested;
      continue;
    }
    const found = normalizeWbNo(value);
    if (found) return found;
  }
  return null;
}

function extractSettlementOrderDetailRowsFromCaptureBody(body) {
  const meta = body?.result?.data || body?.result || body?.data || body || {};
  const candidates = [
    meta?.rows,
    meta?.list,
    meta?.items,
    meta?.records,
    body?.rows,
    body?.list,
    body?.items,
    body?.records,
  ];
  const rows = candidates.find((value) => Array.isArray(value)) || [];
  const columns = Array.isArray(meta?.columns)
    ? meta.columns
    : (rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : []);
  const sourceRowCount = parseIntegerLoose(meta?.rowCount ?? meta?.total ?? meta?.totalCount) ?? rows.length;
  return { rows, columns, meta, sourceRowCount };
}

function buildSettlementOrderDetailRowsFromCaptureEvent(ev) {
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  const { rows, columns, meta, sourceRowCount } = extractSettlementOrderDetailRowsFromCaptureBody(body);
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId || !rows.length) return [];

  const batchId = String(firstDefined(meta, ["batchId", "batch_id", "itemBizId", "item_biz_id"]) || `capture_${stableJsonHash(meta)}`);
  const site = String(ev.site || meta.site || "").trim() || "agentseller";
  const columnsJson = JSON.stringify(columns || []);
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row, index) => {
      const currency = pickRowValue(row, ["币种", "货币", "currency", "currencyCode"]) || meta.currency || "CNY";
      return {
        mall_id: mallId,
        site,
        batch_id: batchId,
        fund_type: firstDefined(meta, ["fundType", "fund_type"]) != null ? String(firstDefined(meta, ["fundType", "fund_type"])) : null,
        create_time: String(firstDefined(meta, ["createTime", "create_time", "transactionTime", "transaction_time"]) || ""),
        sheet_name: String(firstDefined(meta, ["sheetName", "sheet_name"]) || ""),
        source_row_count: sourceRowCount,
        row_index: index + 1,
        wb_no: pickSettlementWbNo(row),
        order_sn: pickRowValue(row, ["订单号", "订单编号", "子订单号", "orderSn", "order_sn", "orderNo", "order_no"]),
        parent_order_sn: pickRowValue(row, ["父订单号", "父单号", "parentOrderSn", "parent_order_sn", "parentOrderNo"]),
        sku_id: pickRowValue(row, ["SKU ID", "商品SKU ID", "商品 SKU ID", "skuId", "sku_id", "productSkuId"]),
        sku_ext_code: pickRowValue(row, ["商家SKU", "商家 SKU", "SKU货号", "SKU 货号", "货号", "skuExtCode", "sku_ext_code", "skuCode", "sellerSku", "externalSku"]),
        product_name: pickRowValue(row, ["商品名称", "商品标题", "品名", "productName", "product_name", "goodsName"]),
        quantity: parseNumberLoose(pickRowValue(row, ["数量", "商品数量", "件数", "quantity", "qty"])),
        currency: String(currency || "CNY"),
        amount: parseNumberLoose(pickRowValue(row, ["结算金额", "应结算金额", "实收金额", "入账金额", "总金额", "金额", "settlementAmount", "settlement_amount", "totalAmount", "amount"], { includes: true })),
        columns_json: columnsJson,
        raw_json: JSON.stringify(row),
        source_received_at: Number(ev.received_at) || null,
        source: SETTLEMENT_ROBOT_SOURCE,
      };
    });
}

function upsertSettlementOrderDetailRows(db, rows) {
  if (!rows.length) return { rows: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO erp_temu_settlement_order_detail
      (mall_id, site, batch_id, fund_type, create_time, sheet_name, source_row_count, row_index,
       wb_no, order_sn, parent_order_sn, sku_id, sku_ext_code, product_name, quantity, currency, amount,
       columns_json, raw_json, source_received_at, source, updated_at)
    VALUES
      (@mall_id, @site, @batch_id, @fund_type, @create_time, @sheet_name, @source_row_count, @row_index,
       @wb_no, @order_sn, @parent_order_sn, @sku_id, @sku_ext_code, @product_name, @quantity, @currency, @amount,
       @columns_json, @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id, batch_id, row_index) DO UPDATE SET
      site = excluded.site,
      fund_type = excluded.fund_type,
      create_time = excluded.create_time,
      sheet_name = excluded.sheet_name,
      source_row_count = excluded.source_row_count,
      wb_no = excluded.wb_no,
      order_sn = excluded.order_sn,
      parent_order_sn = excluded.parent_order_sn,
      sku_id = excluded.sku_id,
      sku_ext_code = excluded.sku_ext_code,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      currency = excluded.currency,
      amount = excluded.amount,
      columns_json = excluded.columns_json,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run({ ...row, now });
  });
  tx();
  return { rows: rows.length };
}

function syncSettlementOrderDetailFromCapture(db, opts = {}) {
  ensureSettlementOrderDetailSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    const siteSelect = capture.columns.includes("site") ? "ce.site" : "'' AS site";
    events = db.prepare(`
      SELECT ce.mall_id, ${siteSelect}, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path = ?
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(SETTLEMENT_ORDER_DETAIL_PATH);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const rows = [];
  const malls = new Set();
  for (const ev of events) {
    const eventRows = buildSettlementOrderDetailRowsFromCaptureEvent(ev);
    for (const row of eventRows) {
      rows.push(row);
      if (row.mall_id) malls.add(row.mall_id);
    }
  }
  if (!rows.length) return { ok: true, attached: true, malls: 0, rows: 0 };
  const result = upsertSettlementOrderDetailRows(db, rows);
  return { ok: true, attached: true, malls: malls.size, rows: result.rows };
}

// =====================================================================
// 资金/账务汇总（seller.kuajingmaihuo.com fund/detail day/month summary）
// =====================================================================
const FUND_SUMMARY_PATH_SCOPE = new Map([
  ["/api/merchant/fund/detail/daySummary", "day"],
  ["/api/merchant/fund/detail/monthSummary", "month"],
]);
const FUND_SUMMARY_PATHS = Array.from(FUND_SUMMARY_PATH_SCOPE.keys());
const FUND_SUMMARY_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "086_temu_fund_summary.sql");

function ensureFundSummarySchema(db) {
  db.exec(fs.readFileSync(FUND_SUMMARY_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_fund_summary");
}

function extractFundSummaryListFromCaptureBody(body) {
  const candidates = [
    body?.result,
    body?.result?.data,
    body?.result?.data?.list,
    body?.result?.data?.rows,
    body?.result?.data?.items,
    body?.result?.list,
    body?.result?.rows,
    body?.result?.items,
    body?.data?.result?.list,
    body?.data?.result?.rows,
    body?.data?.list,
    body?.data?.rows,
    body?.data?.items,
    body?.list,
    body?.rows,
    body?.items,
  ];
  const list = candidates.find((value) => Array.isArray(value));
  if (Array.isArray(list)) return list;
  const objectCandidate = body?.result?.data || body?.result || body?.data || body;
  return objectCandidate && typeof objectCandidate === "object" ? [objectCandidate] : [];
}

function normalizeFundSummaryDate(item, scope, receivedAt) {
  const raw = firstDefined(item, [
    "date", "statDate", "stat_date", "dateStr", "dataDate", "day", "summaryDate",
    "month", "statMonth", "stat_month", "yearMonth", "billMonth", "billingCycle",
  ]);
  const text = raw == null ? "" : String(raw).trim();
  if (scope === "month") {
    const month = text.match(/\d{4}[-/]\d{1,2}/);
    if (month) {
      const [y, m] = month[0].replace(/\//g, "-").split("-");
      return `${y}-${String(m).padStart(2, "0")}`;
    }
    const day = normalizeSettlementDate(item);
    if (day) return day.slice(0, 7);
    return bjDateFromTimestamp(receivedAt).slice(0, 7);
  }
  return normalizeSettlementDate(item) || bjDateFromTimestamp(receivedAt);
}

function parseFundSummaryMetric(value) {
  if (value && typeof value === "object") {
    const money = normalizeMoneyAmount(value);
    if (money) return money;
  }
  const yuan = parseNumberLoose(value);
  if (!Number.isFinite(yuan)) return null;
  return { yuan, cents: Math.round(yuan * 100), currency: null };
}

function collectFundSummaryMetrics(root) {
  const out = {};
  const stack = [{ value: root, path: "" }];
  const keyRe = /(amount|balance|income|expense|payment|receipt|frozen|freeze|available|total|sum|fund|money|余额|金额|收入|支出|流入|流出|冻结|限制|可用|合计|扣款|费用)/i;
  let steps = 0;
  while (stack.length && steps < 3000) {
    steps++;
    const { value, path: p } = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => stack.push({ value: item, path: `${p}[${idx}]` }));
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = p ? `${p}.${key}` : key;
      if (keyRe.test(key)) {
        const parsed = parseFundSummaryMetric(child);
        if (parsed) out[childPath] = parsed;
      }
      if (child && typeof child === "object") stack.push({ value: child, path: childPath });
    }
  }
  return out;
}

function buildFundSummaryRowsFromCaptureEvent(ev) {
  const scope = FUND_SUMMARY_PATH_SCOPE.get(ev.url_path);
  if (!scope) return [];
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  const list = extractFundSummaryListFromCaptureBody(body);
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId || !list.length) return [];
  const site = String(ev.site || "").trim() || "kuajingmaihuo";

  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const metrics = collectFundSummaryMetrics(item);
      const income = firstAmountByPath(metrics, [/income/i, /receipt/i, /inAmount/i, /收入/, /流入/], [/refund/i, /frozen/i, /freeze/i, /balance/i, /available/i]);
      const expense = firstAmountByPath(metrics, [/expense/i, /expenditure/i, /outAmount/i, /payment/i, /支出/, /流出/, /扣款/, /费用/], [/balance/i, /available/i]);
      const balance = firstAmountByPath(metrics, [/balance/i, /account/i, /余额/], [/available/i, /frozen/i, /freeze/i]);
      const frozen = firstAmountByPath(metrics, [/frozen/i, /freeze/i, /restrict/i, /limit/i, /hold/i, /冻结/, /限制/]);
      const available = firstAmountByPath(metrics, [/available/i, /usable/i, /withdraw/i, /可用/, /可提现/]);
      const total = firstAmountByPath(metrics, [/total/i, /sum/i, /^amount$/i, /合计/, /总/], [/count/i, /page/i]);
      const currency = income?.currency || expense?.currency || balance?.currency || frozen?.currency || available?.currency || total?.currency || item.currency || item.currencyType || "CNY";
      return {
        mall_id: mallId,
        site,
        summary_scope: scope,
        summary_date: normalizeFundSummaryDate(item, scope, ev.received_at),
        currency: String(currency || "CNY"),
        income_amount: income?.yuan ?? 0,
        expense_amount: expense?.yuan ?? 0,
        balance_amount: balance?.yuan ?? null,
        frozen_amount: frozen?.yuan ?? null,
        available_amount: available?.yuan ?? null,
        total_amount: total?.yuan ?? null,
        metrics_json: JSON.stringify(metrics),
        raw_json: JSON.stringify(item),
        source_received_at: Number(ev.received_at) || null,
        source: SETTLEMENT_ROBOT_SOURCE,
      };
    });
}

function upsertFundSummaryRows(db, rows) {
  if (!rows.length) return { rows: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO erp_temu_fund_summary
      (mall_id, site, summary_scope, summary_date, currency,
       income_amount, expense_amount, balance_amount, frozen_amount, available_amount, total_amount,
       metrics_json, raw_json, source_received_at, source, updated_at)
    VALUES
      (@mall_id, @site, @summary_scope, @summary_date, @currency,
       @income_amount, @expense_amount, @balance_amount, @frozen_amount, @available_amount, @total_amount,
       @metrics_json, @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id, site, summary_scope, summary_date) DO UPDATE SET
      currency = excluded.currency,
      income_amount = excluded.income_amount,
      expense_amount = excluded.expense_amount,
      balance_amount = excluded.balance_amount,
      frozen_amount = excluded.frozen_amount,
      available_amount = excluded.available_amount,
      total_amount = excluded.total_amount,
      metrics_json = excluded.metrics_json,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run({ ...row, now });
  });
  tx();
  return { rows: rows.length };
}

function syncFundSummaryFromCapture(db, opts = {}) {
  ensureFundSummarySchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    const siteSelect = capture.columns.includes("site") ? "ce.site" : "'' AS site";
    events = db.prepare(`
      SELECT ce.mall_id, ${siteSelect}, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path IN (${FUND_SUMMARY_PATHS.map(() => "?").join(",")})
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(...FUND_SUMMARY_PATHS);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const rows = [];
  const malls = new Set();
  for (const ev of events) {
    const eventRows = buildFundSummaryRowsFromCaptureEvent(ev);
    for (const row of eventRows) {
      rows.push(row);
      if (row.mall_id) malls.add(row.mall_id);
    }
  }
  if (!rows.length) return { ok: true, attached: true, malls: 0, rows: 0 };
  const result = upsertFundSummaryRows(db, rows);
  return { ok: true, attached: true, malls: malls.size, rows: result.rows };
}

function buildFundDetailByMall(db, opts = {}) {
  const { startDate, endDate } = opts;
  let dateFilter, params;
  if (startDate && endDate) {
    dateFilter = "transaction_time >= ? AND transaction_time < date(?, '+1 day')";
    params = [startDate, endDate];
  } else {
    dateFilter = "transaction_time >= date('now', '-30 days')";
    params = [];
  }
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_fund_detail");
    rows = db.prepare(`
      SELECT mall_id,
             money_change_type,
             COALESCE(NULLIF(remark,''), fund_type_desc) AS category,
             SUM(amount) / 100.0 AS total_amount, -- amount 物化为接口原值（分），聚合输出统一转元
             COUNT(*) AS cnt
        FROM erp_temu_fund_detail
       WHERE ${dateFilter}
         ${sourceSql}
       GROUP BY mall_id, money_change_type, category
    `).all(...params);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  for (const r of rows) {
    if (!byMall.has(r.mall_id)) {
      byMall.set(r.mall_id, { in_total: 0, out_total: 0, by_category: {} });
    }
    const m = byMall.get(r.mall_id);
    const amt = Number(r.total_amount) || 0;
    if (r.money_change_type === 1) m.in_total += amt;
    else if (r.money_change_type === 2) m.out_total += amt;
    m.by_category[r.category] = (m.by_category[r.category] || 0) + amt;
  }
  return byMall;
}

// ===== 结算报表独立查询（支持自定义时间段） =====
function buildFundSummaryByMall(db, opts = {}) {
  const { startDate, endDate } = opts;
  let where = "";
  let params = [];
  if (startDate && endDate) {
    where = `
      WHERE (
        (summary_scope = 'day' AND summary_date >= ? AND summary_date <= ?)
        OR (summary_scope = 'month' AND summary_date >= substr(?, 1, 7) AND summary_date <= substr(?, 1, 7))
      )
    `;
    params = [startDate, endDate, startDate, endDate];
  }
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_fund_summary");
    rows = db.prepare(`
      SELECT id, mall_id, site, summary_scope, summary_date, currency,
             income_amount, expense_amount, balance_amount, frozen_amount, available_amount, total_amount,
             source_received_at
        FROM erp_temu_fund_summary
        ${where || "WHERE 1=1"}
        ${sourceSql}
       ORDER BY summary_date ASC, COALESCE(source_received_at, 0) ASC, id ASC
    `).all(...params);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  const ensure = (mallId) => {
    if (!byMall.has(mallId)) {
      byMall.set(mallId, {
        latest_date: null,
        currency: "CNY",
        income_total: 0,
        expense_total: 0,
        balance_amount: 0,
        frozen_amount: 0,
        available_amount: 0,
        total_amount: 0,
        rows: 0,
        day_rows: 0,
        month_rows: 0,
        _month_income_total: 0,
        _month_expense_total: 0,
        _latest_key: "",
        _latest_balance_key: "",
        _latest_frozen_key: "",
        _latest_available_key: "",
        _latest_total_key: "",
      });
    }
    return byMall.get(mallId);
  };
  const setLatestAmount = (out, row, field, latestField, latestKey) => {
    if (row[field] == null) return;
    const value = Number(row[field]);
    if (!Number.isFinite(value)) return;
    if (!out[latestField] || latestKey >= out[latestField]) {
      out[field] = value;
      out[latestField] = latestKey;
    }
  };
  for (const row of rows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    const out = ensure(mallId);
    out.rows += 1;
    if (row.summary_scope === "day") {
      out.day_rows += 1;
      out.income_total += Number(row.income_amount) || 0;
      out.expense_total += Number(row.expense_amount) || 0;
    } else if (row.summary_scope === "month") {
      out.month_rows += 1;
      out._month_income_total += Number(row.income_amount) || 0;
      out._month_expense_total += Number(row.expense_amount) || 0;
    }
    const latestKey = `${row.summary_date || ""}|${String(row.source_received_at || 0).padStart(16, "0")}|${String(row.id || 0).padStart(10, "0")}`;
    if (!out._latest_key || latestKey >= out._latest_key) {
      out._latest_key = latestKey;
      out.latest_date = row.summary_date || null;
      out.currency = row.currency || out.currency || "CNY";
    }
    setLatestAmount(out, row, "balance_amount", "_latest_balance_key", latestKey);
    setLatestAmount(out, row, "frozen_amount", "_latest_frozen_key", latestKey);
    setLatestAmount(out, row, "available_amount", "_latest_available_key", latestKey);
    setLatestAmount(out, row, "total_amount", "_latest_total_key", latestKey);
  }
  for (const out of byMall.values()) {
    if (out.day_rows === 0 && out.month_rows > 0) {
      out.income_total = out._month_income_total;
      out.expense_total = out._month_expense_total;
    }
    delete out._month_income_total;
    delete out._month_expense_total;
    delete out._latest_key;
    delete out._latest_balance_key;
    delete out._latest_frozen_key;
    delete out._latest_available_key;
    delete out._latest_total_key;
  }
  return byMall;
}

// ============ EPR 费用（087）：eprfee goods/platform 抓包物化 ============

const EPR_FEE_GOODS_PATH = "/api/merchant/eprfee/goods/page-query";
const EPR_FEE_PLATFORM_PATH = "/api/merchant/eprfee/platform/wait-deduction/page-query";
const EPR_FEE_PACKAGE_PATH = "/api/merchant/eprfee/package/query";
const EPR_FEE_EXPORT_PATH = "/api/merchant/file/export/history/page";
const EPR_FEE_PATHS = [EPR_FEE_GOODS_PATH, EPR_FEE_PLATFORM_PATH, EPR_FEE_PACKAGE_PATH, EPR_FEE_EXPORT_PATH];
const EPR_FEE_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "087_temu_epr_fee.sql");
// goods 响应里四个列表各对应一种扣款状态
const EPR_GOODS_LIST_STATUS = [
  ["waitDeductionEprFeeInfoList", "wait"],
  ["deductedEprFeeInfoList", "deducted"],
  ["waitRefundEprFeeInfoList", "wait_refund"],
  ["refundedEprFeeInfoList", "refunded"],
];

function ensureEprFeeSchema(db) {
  db.exec(fs.readFileSync(EPR_FEE_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_epr_fee");
}

function buildEprFeeRow(item, { mallId, site, feeScope, deductStatus, receivedAt }) {
  // 字段名暂无非空真实样本，按 enum/summary 接口字段推测 + 宽容提取；raw_json 全留供校准
  const amountRaw = firstDefined(item, [
    "amount", "feeAmount", "deductAmount", "totalAmount", "eprFeeAmount", "deductionAmount", "payAmount",
    "金额", "扣费金额", "已扣费", "费用", "账单金额", "扣款金额", "应付金额", "实付金额",
  ]);
  const amount = (amountRaw && typeof amountRaw === "object")
    ? (normalizeMoneyAmount(amountRaw)?.yuan ?? parseNumberLoose(amountRaw))
    : parseNumberLoose(amountRaw);
  const originalRaw = firstDefined(item, ["originalAmount", "originAmount", "totalOriginalAmount"]);
  const originalAmount = (originalRaw && typeof originalRaw === "object")
    ? (normalizeMoneyAmount(originalRaw)?.yuan ?? parseNumberLoose(originalRaw))
    : parseNumberLoose(originalRaw);
  const currency = (amountRaw && typeof amountRaw === "object" && amountRaw.currencyCode)
    || item.currency || item.currencyCode || item.alphabetCode || "CNY";
  const explicitKey = firstDefined(item, [
    "id", "billId", "feeId", "certId", "recordId", "detailId", "skuId", "productSkuId",
    "单据号", "账单号", "流水号", "订单号", "商品ID", "SKU ID", "SKU",
  ]);
  return {
    mall_id: mallId,
    site,
    fee_scope: feeScope,
    deduct_status: deductStatus,
    item_key: explicitKey != null && explicitKey !== "" ? String(explicitKey) : `raw_${stableJsonHash(item)}`,
    cert_type: toNullableText(firstDefined(item, ["certType", "certCode", "证书类型", "资质类型"])),
    cert_name: toNullableText(firstDefined(item, ["certName", "certDisplayName", "证书名称", "资质名称", "EPR名称", "费用名称", "项目"])),
    region: toNullableText(firstDefined(item, ["regionName", "regionCode", "region", "siteName", "区域", "站点", "国家/地区", "国家"])),
    sku_id: toNullableText(firstDefined(item, ["skuId", "productSkuId", "prodSkuId", "SKU ID", "SKU", "sku"])),
    spu_id: toNullableText(firstDefined(item, ["spuId", "productId", "goodsId", "商品ID", "商品 Id", "SPU ID"])),
    goods_name: toNullableText(firstDefined(item, ["goodsName", "productName", "skuName", "title", "商品名称", "品名"])),
    quantity: parseNumberLoose(firstDefined(item, ["quantity", "totalQuantity", "qty", "num", "数量", "件数"])),
    amount: Number.isFinite(amount) ? amount : 0,
    original_amount: Number.isFinite(originalAmount) ? originalAmount : null,
    currency: String(currency || "CNY"),
    stat_date: normalizeSettlementDetailDate(item, receivedAt),
    raw_json: JSON.stringify(item),
    source_received_at: Number(receivedAt) || null,
    source: SETTLEMENT_ROBOT_SOURCE,
  };
}

function toNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 500) : null;
}

function getEprExportMeta(body) {
  const taskType = Number(body?.taskType ?? body?.result?.taskType);
  const type = String(body?.type || body?.result?.type || "");
  if (taskType === 18 || type === "Epr_Product") return { feeScope: "goods", deductStatus: "deducted" };
  if (taskType === 16 || type === "Epr_Proxy") return { feeScope: "proxy", deductStatus: "deducted" };
  if (taskType === 21 || type === "Epr_Agency") return { feeScope: "agency", deductStatus: "deducted" };
  return { feeScope: "export", deductStatus: "deducted" };
}

function buildEprFeeRowsFromCaptureEvent(ev) {
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId) return [];
  const site = String(ev.site || "").trim() || "agentseller";
  const result = body?.result || {};
  const rows = [];
  if (ev.url_path === EPR_FEE_EXPORT_PATH) {
    const exportRows = Array.isArray(body?.rows) ? body.rows : (Array.isArray(result?.rows) ? result.rows : []);
    const meta = getEprExportMeta(body);
    for (const item of exportRows) {
      if (!item || typeof item !== "object") continue;
      rows.push(buildEprFeeRow({
        ...item,
        __juxieyun_type: body.type || result.type || "",
        __juxieyun_task_type: body.taskType || result.taskType || "",
        __juxieyun_file_name: body.fileName || result.fileName || "",
        __juxieyun_area: body.area || result.area || "",
      }, { mallId, site, feeScope: meta.feeScope, deductStatus: meta.deductStatus, receivedAt: ev.received_at }));
    }
  } else if (ev.url_path === EPR_FEE_GOODS_PATH) {
    for (const [listKey, deductStatus] of EPR_GOODS_LIST_STATUS) {
      const list = result[listKey];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        rows.push(buildEprFeeRow(item, { mallId, site, feeScope: "goods", deductStatus, receivedAt: ev.received_at }));
      }
    }
  } else if (ev.url_path === EPR_FEE_PLATFORM_PATH) {
    const list = Array.isArray(result.dataList) ? result.dataList : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      rows.push(buildEprFeeRow(item, { mallId, site, feeScope: "platform", deductStatus: "wait", receivedAt: ev.received_at }));
    }
  } else if (ev.url_path === EPR_FEE_PACKAGE_PATH) {
    // 包裹级：响应列表名无真实样本，按 goods 四列表 + dataList/list 通用提取，落 fee_scope='package'。
    // item_key 优先显式 id、否则按内容 hash 去重，多列表并存不会重复落同一条。
    const pkgLists = [
      ...EPR_GOODS_LIST_STATUS,
      ["dataList", "wait"],
      ["list", "wait"],
    ];
    for (const [listKey, deductStatus] of pkgLists) {
      const list = result[listKey];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        rows.push(buildEprFeeRow(item, { mallId, site, feeScope: "package", deductStatus, receivedAt: ev.received_at }));
      }
    }
  }
  return rows;
}

function upsertEprFeeRows(db, rows) {
  if (!rows.length) return { rows: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO erp_temu_epr_fee
      (mall_id, site, fee_scope, deduct_status, item_key, cert_type, cert_name, region,
       sku_id, spu_id, goods_name, quantity, amount, original_amount, currency, stat_date,
       raw_json, source_received_at, source, synced_at)
    VALUES
      (@mall_id, @site, @fee_scope, @deduct_status, @item_key, @cert_type, @cert_name, @region,
       @sku_id, @spu_id, @goods_name, @quantity, @amount, @original_amount, @currency, @stat_date,
       @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id, fee_scope, deduct_status, item_key) DO UPDATE SET
      site = excluded.site,
      cert_type = excluded.cert_type,
      cert_name = excluded.cert_name,
      region = excluded.region,
      sku_id = excluded.sku_id,
      spu_id = excluded.spu_id,
      goods_name = excluded.goods_name,
      quantity = excluded.quantity,
      amount = excluded.amount,
      original_amount = excluded.original_amount,
      currency = excluded.currency,
      stat_date = excluded.stat_date,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run({ ...row, now });
  });
  tx();
  return { rows: rows.length };
}

function syncEprFeeFromCapture(db, opts = {}) {
  ensureEprFeeSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    const siteSelect = capture.columns.includes("site") ? "ce.site" : "'' AS site";
    events = db.prepare(`
      SELECT ce.mall_id, ${siteSelect}, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path IN (${EPR_FEE_PATHS.map(() => "?").join(",")})
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(...EPR_FEE_PATHS);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const rows = [];
  const malls = new Set();
  for (const ev of events) {
    for (const row of buildEprFeeRowsFromCaptureEvent(ev)) {
      rows.push(row);
      malls.add(row.mall_id);
    }
  }
  if (!rows.length) return { ok: true, attached: true, malls: 0, rows: 0 };
  const result = upsertEprFeeRows(db, rows);
  return { ok: true, attached: true, malls: malls.size, rows: result.rows };
}

function buildEprFeeByMall(db) {
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_epr_fee");
    rows = db.prepare(`
      SELECT mall_id, deduct_status, SUM(amount) AS total_amount, COUNT(*) AS cnt
        FROM erp_temu_epr_fee
       WHERE 1=1
         ${sourceSql}
       GROUP BY mall_id, deduct_status
    `).all();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  for (const row of rows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    if (!byMall.has(mallId)) {
      byMall.set(mallId, { wait_amount: 0, deducted_amount: 0, wait_count: 0, deducted_count: 0, total_count: 0 });
    }
    const out = byMall.get(mallId);
    const amount = Number(row.total_amount) || 0;
    const cnt = Number(row.cnt) || 0;
    if (row.deduct_status === "wait" || row.deduct_status === "wait_refund") {
      out.wait_amount += amount;
      out.wait_count += cnt;
    } else {
      out.deducted_amount += amount;
      out.deducted_count += cnt;
    }
    out.total_count += cnt;
  }
  return byMall;
}

// ============ 资金限制（088）：fund-frozen/rules 抓包物化（快照语义） ============

const FUND_FROZEN_PATH = "/api/merchant/fund-frozen/rules";
const FUND_FROZEN_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "088_temu_fund_frozen.sql");

function ensureFundFrozenSchema(db) {
  db.exec(fs.readFileSync(FUND_FROZEN_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_fund_frozen");
}

function buildFundFrozenRowsFromCaptureEvent(ev) {
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId) return [];
  const result = body?.result || {};
  const rules = Array.isArray(result.rules) ? result.rules : [];
  const fallbackCurrency = result.currency || "CNY";
  return rules
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      mall_id: mallId,
      frozen_type: toNullableText(item.frozenType) || `unknown_${index}`,
      reason: toNullableText(item.reason),
      // amount 源是 "￥7.40" 字符串，parseNumberLoose 剥货币符号/逗号
      amount: parseNumberLoose(firstDefined(item, ["amount", "currentAmount", "dr2Amount"])) ?? 0,
      currency: String(item.currency || fallbackCurrency || "CNY"),
      unfreeze_condition: toNullableText(item.unfreezeCondition),
      description: toNullableText(item.description),
      raw_json: JSON.stringify(item),
      source_received_at: Number(ev.received_at) || null,
      source: SETTLEMENT_ROBOT_SOURCE,
    }));
}

function syncFundFrozenFromCapture(db, opts = {}) {
  ensureFundFrozenSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    events = db.prepare(`
      SELECT ce.mall_id, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path = ?
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(FUND_FROZEN_PATH);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  // 快照语义：每店只取最新一次抓包（received_at 升序后写覆盖），落库前清掉该店旧行，
  // 避免已解冻项残留虚高冻结额
  const latestByMall = new Map();
  for (const ev of events) latestByMall.set(String(ev.mall_id), ev);
  const now = new Date().toISOString();
  const del = db.prepare(`DELETE FROM erp_temu_fund_frozen WHERE mall_id = ?${sourceWhere(db, "erp_temu_fund_frozen")}`);
  const ins = db.prepare(`
    INSERT INTO erp_temu_fund_frozen
      (mall_id, frozen_type, reason, amount, currency, unfreeze_condition, description,
       raw_json, source_received_at, source, synced_at)
    VALUES
      (@mall_id, @frozen_type, @reason, @amount, @currency, @unfreeze_condition, @description,
       @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id, frozen_type) DO UPDATE SET
      reason = excluded.reason,
      amount = excluded.amount,
      currency = excluded.currency,
      unfreeze_condition = excluded.unfreeze_condition,
      description = excluded.description,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  let total = 0;
  const malls = new Set();
  const tx = db.transaction(() => {
    for (const [mallId, ev] of latestByMall) {
      const rows = buildFundFrozenRowsFromCaptureEvent(ev);
      del.run(mallId);
      for (const row of rows) {
        ins.run({ ...row, now });
        total++;
      }
      if (rows.length) malls.add(mallId);
    }
  });
  tx();
  return { ok: true, attached: true, malls: malls.size, rows: total };
}

function buildFundFrozenByMall(db) {
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_fund_frozen");
    rows = db.prepare(`
      SELECT mall_id, frozen_type, reason, amount, currency, unfreeze_condition
        FROM erp_temu_fund_frozen
       WHERE 1=1
         ${sourceSql}
       ORDER BY mall_id, amount DESC
    `).all();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  for (const row of rows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    if (!byMall.has(mallId)) byMall.set(mallId, { total_amount: 0, items: [] });
    const out = byMall.get(mallId);
    out.total_amount += Number(row.amount) || 0;
    out.items.push({
      frozen_type: row.frozen_type,
      reason: row.reason,
      amount: Number(row.amount) || 0,
      currency: row.currency,
      unfreeze_condition: row.unfreeze_condition,
    });
  }
  return byMall;
}

// ============ 账户概览（090）：payment/account/amount/info 抓包物化（每店一行快照） ============

const ACCOUNT_OVERVIEW_PATH = "/api/merchant/payment/account/amount/info";
const ACCOUNT_OVERVIEW_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "090_temu_account_overview.sql");

function ensureAccountOverviewSchema(db) {
  db.exec(fs.readFileSync(ACCOUNT_OVERVIEW_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_account_overview");
}

// 金额宽容提取：对象走 normalizeMoneyAmount（分→元），字符串/数字走 parseNumberLoose（按元）
function extractMoneyYuan(obj, keys) {
  const raw = firstDefined(obj, keys);
  if (raw == null) return 0;
  if (typeof raw === "object") {
    const n = normalizeMoneyAmount(raw)?.yuan ?? parseNumberLoose(raw);
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseNumberLoose(raw);
  return Number.isFinite(n) ? n : 0;
}

function buildAccountOverviewRow(ev) {
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return null; }
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId) return null;
  const r = body?.result;
  if (!r || typeof r !== "object") return null;
  const currencyRaw = firstDefined(r, ["currency", "currencyCode", "alphabetCode"]);
  return {
    mall_id: mallId,
    available_amount: extractMoneyYuan(r, ["availableAmount", "availableBalance", "available", "canUseAmount"]),
    in_transit_amount: extractMoneyYuan(r, ["inTransitAmount", "onTheWayAmount", "transitAmount", "onWayAmount"]),
    pending_settle_amount: extractMoneyYuan(r, ["pendingSettlementAmount", "waitSettleAmount", "toBeSettledAmount", "unsettledAmount", "pendingAmount"]),
    frozen_amount: extractMoneyYuan(r, ["frozenAmount", "freezeAmount", "frozen"]),
    withdrawable_amount: extractMoneyYuan(r, ["withdrawableAmount", "canWithdrawAmount", "withdrawAmount"]),
    total_amount: extractMoneyYuan(r, ["totalAmount", "accountAmount", "balanceAmount", "balance", "total"]),
    currency: String(currencyRaw || "CNY"),
    raw_json: JSON.stringify(r),
    source_received_at: Number(ev.received_at) || null,
    source: SETTLEMENT_ROBOT_SOURCE,
  };
}

function syncAccountOverviewFromCapture(db, opts = {}) {
  ensureAccountOverviewSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    events = db.prepare(`
      SELECT ce.mall_id, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path = ?
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(ACCOUNT_OVERVIEW_PATH);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  // 快照语义：每店取最新一次抓包覆盖
  const latestByMall = new Map();
  for (const ev of events) latestByMall.set(String(ev.mall_id), ev);
  const now = new Date().toISOString();
  const ins = db.prepare(`
    INSERT INTO erp_temu_account_overview
      (mall_id, available_amount, in_transit_amount, pending_settle_amount, frozen_amount,
       withdrawable_amount, total_amount, currency, raw_json, source_received_at, source, synced_at)
    VALUES
      (@mall_id, @available_amount, @in_transit_amount, @pending_settle_amount, @frozen_amount,
       @withdrawable_amount, @total_amount, @currency, @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id) DO UPDATE SET
      available_amount = excluded.available_amount,
      in_transit_amount = excluded.in_transit_amount,
      pending_settle_amount = excluded.pending_settle_amount,
      frozen_amount = excluded.frozen_amount,
      withdrawable_amount = excluded.withdrawable_amount,
      total_amount = excluded.total_amount,
      currency = excluded.currency,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  let total = 0;
  const malls = new Set();
  const tx = db.transaction(() => {
    for (const [mallId, ev] of latestByMall) {
      const row = buildAccountOverviewRow(ev);
      if (!row) continue;
      ins.run({ ...row, now });
      total++;
      malls.add(mallId);
    }
  });
  tx();
  return { ok: true, attached: true, malls: malls.size, rows: total };
}

function buildAccountOverviewByMall(db) {
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_account_overview");
    rows = db.prepare(`
      SELECT mall_id, available_amount, in_transit_amount, pending_settle_amount, frozen_amount,
             withdrawable_amount, total_amount, currency
        FROM erp_temu_account_overview
       WHERE 1=1
         ${sourceSql}
    `).all();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  for (const row of rows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    byMall.set(mallId, {
      available_amount: Number(row.available_amount) || 0,
      in_transit_amount: Number(row.in_transit_amount) || 0,
      pending_settle_amount: Number(row.pending_settle_amount) || 0,
      frozen_amount: Number(row.frozen_amount) || 0,
      withdrawable_amount: Number(row.withdrawable_amount) || 0,
      total_amount: Number(row.total_amount) || 0,
      currency: row.currency || "CNY",
    });
  }
  return byMall;
}

// ============ 履约费用流出（091）：warehouse/express/bill overview+detail 抓包物化 ============

const FULFILLMENT_OVERVIEW_PATH = "/api/merchant/warehouse/express/bill/global/overview";
const FULFILLMENT_DETAIL_PATH = "/api/merchant/warehouse/express/bill/detail/list";
const FULFILLMENT_PATHS = [FULFILLMENT_OVERVIEW_PATH, FULFILLMENT_DETAIL_PATH];
const FULFILLMENT_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "091_temu_fulfillment_bill.sql");

function ensureFulfillmentBillSchema(db) {
  db.exec(fs.readFileSync(FULFILLMENT_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_fulfillment_bill");
}

function buildFulfillmentDetailRow(item, { mallId, receivedAt }) {
  const explicitKey = firstDefined(item, ["billId", "id", "waybillNo", "trackingNumber", "recordId", "detailId", "ptransId"]);
  return {
    mall_id: mallId,
    record_type: "detail",
    item_key: explicitKey != null && explicitKey !== "" ? String(explicitKey) : `raw_${stableJsonHash(item)}`,
    bill_type: toNullableText(firstDefined(item, ["billType", "feeType", "chargeType", "expenseType", "type"])),
    amount: extractMoneyYuan(item, ["amount", "feeAmount", "chargeAmount", "totalAmount", "expressFee", "billAmount"]),
    currency: String(firstDefined(item, ["currency", "currencyCode"]) || "CNY"),
    waybill_no: toNullableText(firstDefined(item, ["waybillNo", "trackingNumber", "expressNo"])),
    stat_date: normalizeSettlementDetailDate(item, receivedAt),
    raw_json: JSON.stringify(item),
    source_received_at: Number(receivedAt) || null,
    source: SETTLEMENT_ROBOT_SOURCE,
  };
}

function buildFulfillmentOverviewRow(result, { mallId, receivedAt }) {
  return {
    mall_id: mallId,
    record_type: "overview",
    item_key: "_overview",
    bill_type: null,
    amount: extractMoneyYuan(result, ["totalWaitPayAmount", "totalAmount", "totalFee", "totalExpense", "amount", "billTotalAmount", "sumAmount"]),
    currency: String(firstDefined(result, ["currency", "currencyCode"]) || "CNY"),
    waybill_no: null,
    stat_date: null,
    raw_json: JSON.stringify(result),
    source_received_at: Number(receivedAt) || null,
    source: SETTLEMENT_ROBOT_SOURCE,
  };
}

function syncFulfillmentBillFromCapture(db, opts = {}) {
  ensureFulfillmentBillSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    events = db.prepare(`
      SELECT ce.mall_id, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path IN (${FULFILLMENT_PATHS.map(() => "?").join(",")})
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(...FULFILLMENT_PATHS);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const now = new Date().toISOString();
  // overview：每店取最新覆盖；detail：清掉该店旧明细后重灌（快照语义，避免历史明细累积虚高）
  const latestOverview = new Map();
  const detailEventsByMall = new Map();
  for (const ev of events) {
    const mid = String(ev.mall_id);
    if (ev.url_path === FULFILLMENT_OVERVIEW_PATH) {
      latestOverview.set(mid, ev);
    } else {
      if (!detailEventsByMall.has(mid)) detailEventsByMall.set(mid, []);
      detailEventsByMall.get(mid).push(ev);
    }
  }
  const ins = db.prepare(`
    INSERT INTO erp_temu_fulfillment_bill
      (mall_id, record_type, item_key, bill_type, amount, currency, waybill_no, stat_date, raw_json, source_received_at, source, synced_at)
    VALUES
      (@mall_id, @record_type, @item_key, @bill_type, @amount, @currency, @waybill_no, @stat_date, @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id, record_type, item_key) DO UPDATE SET
      bill_type = excluded.bill_type, amount = excluded.amount, currency = excluded.currency,
      waybill_no = excluded.waybill_no, stat_date = excluded.stat_date, raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at, source = excluded.source, synced_at = excluded.synced_at
  `);
  const delDetail = db.prepare(`DELETE FROM erp_temu_fulfillment_bill WHERE mall_id = ? AND record_type = 'detail'${sourceWhere(db, "erp_temu_fulfillment_bill")}`);
  let total = 0;
  const malls = new Set();
  const tx = db.transaction(() => {
    for (const [mallId, ev] of latestOverview) {
      let body; try { body = JSON.parse(ev.body_json); } catch { continue; }
      const r = body?.result;
      if (!r || typeof r !== "object") continue;
      ins.run({ ...buildFulfillmentOverviewRow(r, { mallId, receivedAt: ev.received_at }), now });
      total++; malls.add(mallId);
    }
    for (const [mallId, evs] of detailEventsByMall) {
      delDetail.run(mallId);
      for (const ev of evs) {
        let body; try { body = JSON.parse(ev.body_json); } catch { continue; }
        const r = body?.result || {};
        const list = [r.list, r.resultList, r.dataList, r.pageItems, r.records].find((v) => Array.isArray(v)) || [];
        for (const item of list) {
          if (!item || typeof item !== "object") continue;
          ins.run({ ...buildFulfillmentDetailRow(item, { mallId, receivedAt: ev.received_at }), now });
          total++; malls.add(mallId);
        }
      }
    }
  });
  tx();
  return { ok: true, attached: true, malls: malls.size, rows: total };
}

function buildFulfillmentBillByMall(db, opts = {}) {
  const { startDate, endDate } = opts;
  const params = [];
  let where = "";
  if (startDate && endDate) {
    where = "WHERE record_type = 'detail' AND stat_date >= ? AND stat_date <= ?";
    params.push(startDate, endDate);
  }
  let rows;
  try {
    const sourceSql = sourceWhere(db, "erp_temu_fulfillment_bill");
    rows = db.prepare(`
      SELECT mall_id, record_type, bill_type, amount, currency, waybill_no, stat_date
        FROM erp_temu_fulfillment_bill
       ${where || "WHERE 1=1"}
       ${sourceSql}
       ORDER BY mall_id, record_type, amount DESC
    `).all(...params);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  for (const row of rows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    if (!byMall.has(mallId)) byMall.set(mallId, { overview_amount: 0, detail_total: 0, detail_count: 0, currency: "CNY", items: [] });
    const out = byMall.get(mallId);
    if (row.currency) out.currency = row.currency;
    if (row.record_type === "overview") {
      out.overview_amount = Number(row.amount) || 0;
    } else {
      out.detail_total += Number(row.amount) || 0;
      out.detail_count += 1;
      if (out.items.length < 200) {
        out.items.push({
          bill_type: row.bill_type,
          amount: Number(row.amount) || 0,
          currency: row.currency,
          waybill_no: row.waybill_no,
          stat_date: row.stat_date,
        });
      }
    }
  }
  return byMall;
}

// ============ 违规处罚明细（089）：tmod_punish entrance/list + island summary 物化 ============

const VIOLATION_LIST_PATH = "/mms/tmod_punish/agent/merchant_appeal/entrance/list";
const VIOLATION_SUMMARY_PATH = "/mms/island/punish/summary";
const VIOLATION_MIGRATION = path.join(__dirname, "..", "..", "db", "migrations", "089_temu_violation.sql");

function ensureViolationSchema(db) {
  db.exec(fs.readFileSync(VIOLATION_MIGRATION, "utf8"));
  ensureSourceColumn(db, "erp_temu_violation");
  ensureSourceColumn(db, "erp_temu_violation_summary");
}

function buildViolationRowsFromCaptureEvent(ev) {
  let body;
  try { body = JSON.parse(ev.body_json); } catch { return []; }
  const mallId = String(ev.mall_id || "").trim();
  if (!mallId) return [];
  const list = body?.result?.punish_appeal_entrance_list;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      mall_id: mallId,
      target_id: item.target_id != null ? String(item.target_id) : `raw_${stableJsonHash(item)}`,
      target_type: toNullableText(item.target_type),
      goods_id: item.goods_id != null ? String(item.goods_id) : null,
      spu_id: item.spu_id != null ? String(item.spu_id) : null,
      goods_name: toNullableText(item.goods_name),
      goods_img_url: toNullableText(item.goods_img_url),
      source_punish_name: toNullableText(item.source_punish_name),
      leaf_reason_name: toNullableText(item.leaf_reason_name),
      violation_desc: toNullableText(item.violation_desc),
      punish_status_desc: toNullableText(item.punish_status_desc),
      appeal_status: parseIntegerLoose(item.appeal_status),
      can_appeal: item.can_not_appeal == null ? null : (item.can_not_appeal ? 0 : 1),
      can_rectify: item.can_rectify == null ? null : (item.can_rectify ? 1 : 0),
      site_num: parseIntegerLoose(item.site_num),
      punish_num: parseIntegerLoose(item.punish_num),
      stat_date: bjDateFromTimestamp(ev.received_at),
      raw_json: JSON.stringify(item),
      source_received_at: Number(ev.received_at) || null,
      source: SETTLEMENT_ROBOT_SOURCE,
    }));
}

function syncViolationFromCapture(db, opts = {}) {
  ensureViolationSchema(db);
  const attachCloudDb = opts.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { ok: false, attached: false, malls: 0, rows: 0 };
  }
  let events;
  try {
    const capture = robotCaptureSql(db, "ce");
    events = db.prepare(`
      SELECT ce.mall_id, ce.url_path, ce.body_json, ce.received_at
        FROM ${capture.from}
       WHERE ce.url_path IN (?, ?)
         AND ce.mall_id IS NOT NULL AND ce.mall_id <> ''
         AND ce.body_json IS NOT NULL AND ce.body_json <> ''
         ${capture.where}
       ORDER BY ce.received_at ASC
    `).all(VIOLATION_LIST_PATH, VIOLATION_SUMMARY_PATH);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) {
      return { ok: false, attached: true, malls: 0, rows: 0 };
    }
    throw error;
  }
  const now = new Date().toISOString();
  const insDetail = db.prepare(`
    INSERT INTO erp_temu_violation
      (mall_id, target_id, target_type, goods_id, spu_id, goods_name, goods_img_url,
       source_punish_name, leaf_reason_name, violation_desc, punish_status_desc,
       appeal_status, can_appeal, can_rectify, site_num, punish_num, stat_date,
       raw_json, source_received_at, source, synced_at)
    VALUES
      (@mall_id, @target_id, @target_type, @goods_id, @spu_id, @goods_name, @goods_img_url,
       @source_punish_name, @leaf_reason_name, @violation_desc, @punish_status_desc,
       @appeal_status, @can_appeal, @can_rectify, @site_num, @punish_num, @stat_date,
       @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id, target_id) DO UPDATE SET
      target_type = excluded.target_type,
      goods_id = excluded.goods_id,
      spu_id = excluded.spu_id,
      goods_name = excluded.goods_name,
      goods_img_url = excluded.goods_img_url,
      source_punish_name = excluded.source_punish_name,
      leaf_reason_name = excluded.leaf_reason_name,
      violation_desc = excluded.violation_desc,
      punish_status_desc = excluded.punish_status_desc,
      appeal_status = excluded.appeal_status,
      can_appeal = excluded.can_appeal,
      can_rectify = excluded.can_rectify,
      site_num = excluded.site_num,
      punish_num = excluded.punish_num,
      stat_date = excluded.stat_date,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  const insSummary = db.prepare(`
    INSERT INTO erp_temu_violation_summary
      (mall_id, violation_count, add_site_limit_status, release_limit_time,
       raw_json, source_received_at, source, synced_at)
    VALUES
      (@mall_id, @violation_count, @add_site_limit_status, @release_limit_time,
       @raw_json, @source_received_at, @source, @now)
    ON CONFLICT(mall_id) DO UPDATE SET
      violation_count = excluded.violation_count,
      add_site_limit_status = excluded.add_site_limit_status,
      release_limit_time = excluded.release_limit_time,
      raw_json = excluded.raw_json,
      source_received_at = excluded.source_received_at,
      source = excluded.source,
      synced_at = excluded.synced_at
  `);
  let total = 0;
  const malls = new Set();
  const tx = db.transaction(() => {
    for (const ev of events) {
      const mallId = String(ev.mall_id).trim();
      if (ev.url_path === VIOLATION_LIST_PATH) {
        for (const row of buildViolationRowsFromCaptureEvent(ev)) {
          insDetail.run({ ...row, now });
          total++;
          malls.add(mallId);
        }
      } else if (ev.url_path === VIOLATION_SUMMARY_PATH) {
        let body;
        try { body = JSON.parse(ev.body_json); } catch { continue; }
        const result = body?.result;
        if (!result || typeof result !== "object") continue;
        insSummary.run({
          mall_id: mallId,
          violation_count: parseIntegerLoose(result.violationCount) ?? 0,
          add_site_limit_status: parseIntegerLoose(result.addSiteLimitStatus),
          release_limit_time: toNullableText(result.releaseLimitTime),
          raw_json: JSON.stringify(result),
          source_received_at: Number(ev.received_at) || null,
          source: SETTLEMENT_ROBOT_SOURCE,
          now,
        });
        total++;
        malls.add(mallId);
      }
    }
  });
  tx();
  return { ok: true, attached: true, malls: malls.size, rows: total };
}

function buildViolationByMall(db, opts = {}) {
  const detailLimit = Number(opts.detailLimit) || 50;
  const { startDate, endDate } = opts;
  const params = [];
  let detailWhere = "";
  const hasDateRange = !!(startDate && endDate);
  if (hasDateRange) {
    detailWhere = "WHERE stat_date >= ? AND stat_date <= ?";
    params.push(startDate, endDate);
  }
  let detailRows, summaryRows;
  try {
    const detailSourceSql = sourceWhere(db, "erp_temu_violation");
    const summarySourceSql = sourceWhere(db, "erp_temu_violation_summary");
    detailRows = db.prepare(`
      SELECT mall_id, target_id, goods_id, goods_name, source_punish_name, leaf_reason_name,
             violation_desc, punish_status_desc, appeal_status, can_appeal, can_rectify,
             site_num, punish_num, stat_date
        FROM erp_temu_violation
       ${detailWhere || "WHERE 1=1"}
       ${detailSourceSql}
       ORDER BY mall_id, source_received_at DESC
    `).all(...params);
    summaryRows = hasDateRange ? [] : db.prepare(`
      SELECT mall_id, violation_count, add_site_limit_status, release_limit_time
        FROM erp_temu_violation_summary
       WHERE 1=1
         ${summarySourceSql}
    `).all();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  const ensure = (mallId) => {
    if (!byMall.has(mallId)) {
      byMall.set(mallId, { violation_count: 0, add_site_limit_status: null, release_limit_time: null, items: [] });
    }
    return byMall.get(mallId);
  };
  for (const row of detailRows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    const out = ensure(mallId);
    out.violation_count++;
    if (out.items.length < detailLimit) {
      out.items.push({
        target_id: row.target_id,
        goods_id: row.goods_id,
        goods_name: row.goods_name,
        source_punish_name: row.source_punish_name,
        leaf_reason_name: row.leaf_reason_name,
        violation_desc: row.violation_desc,
        punish_status_desc: row.punish_status_desc,
        appeal_status: row.appeal_status,
        can_appeal: row.can_appeal,
        can_rectify: row.can_rectify,
        site_num: row.site_num,
        punish_num: row.punish_num,
        stat_date: row.stat_date,
      });
    }
  }
  for (const row of summaryRows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    const out = ensure(mallId);
    out.add_site_limit_status = row.add_site_limit_status;
    out.release_limit_time = row.release_limit_time;
    // summary 的总数比明细全（明细可能只采了前几页），取大者
    out.violation_count = Math.max(out.violation_count, Number(row.violation_count) || 0);
  }
  return byMall;
}

function buildSettlementRiskByMall(db, opts = {}) {
  const { startDate, endDate } = opts;
  let where = "WHERE risk_type IN ('violation_goods', 'inbound_exception')";
  const params = [];
  if (startDate && endDate) {
    where += " AND stat_date >= ? AND stat_date <= ?";
    params.push(startDate, endDate);
  }
  let rows;
  try {
    rows = db.prepare(`
      SELECT mall_id, risk_type, severity, COUNT(*) AS cnt, MAX(stat_date) AS latest_date
        FROM cloud.temu_operation_risk_snapshot
        ${where}
       GROUP BY mall_id, risk_type, severity
    `).all(...params);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return new Map();
    throw error;
  }
  const byMall = new Map();
  for (const row of rows) {
    const mallId = String(row.mall_id || "").trim();
    if (!mallId) continue;
    if (!byMall.has(mallId)) {
      byMall.set(mallId, { violation_count: 0, inbound_exception_count: 0, high_count: 0, latest_date: null, by_type: {} });
    }
    const out = byMall.get(mallId);
    const cnt = Number(row.cnt) || 0;
    if (row.risk_type === "violation_goods") out.violation_count += cnt;
    if (row.risk_type === "inbound_exception") out.inbound_exception_count += cnt;
    if (String(row.severity || "").toLowerCase() === "high") out.high_count += cnt;
    if (row.latest_date && (!out.latest_date || String(row.latest_date) > String(out.latest_date))) out.latest_date = row.latest_date;
    out.by_type[row.risk_type] = (out.by_type[row.risk_type] || 0) + cnt;
  }
  return byMall;
}

function querySettlementData(db, opts = {}) {
  const { startDate, endDate, attachCloudDb } = opts;

  // 1. fund_detail 按时间段
  let fundByMall;
  try { fundByMall = buildFundDetailByMall(db, { startDate, endDate }); }
  catch { fundByMall = new Map(); }
  let fundSummaryByMall;
  try { fundSummaryByMall = buildFundSummaryByMall(db, { startDate, endDate }); }
  catch { fundSummaryByMall = new Map(); }
  const riskByMall = new Map();
  let eprByMall;
  try { eprByMall = buildEprFeeByMall(db); }
  catch { eprByMall = new Map(); }
  let frozenByMall;
  try { frozenByMall = buildFundFrozenByMall(db); }
  catch { frozenByMall = new Map(); }
  let accountOverviewByMall;
  try { accountOverviewByMall = buildAccountOverviewByMall(db); }
  catch { accountOverviewByMall = new Map(); }
  let fulfillmentByMall;
  try { fulfillmentByMall = buildFulfillmentBillByMall(db, { startDate, endDate }); }
  catch { fulfillmentByMall = new Map(); }
  let violationByMall;
  try { violationByMall = buildViolationByMall(db, { startDate, endDate }); }
  catch { violationByMall = new Map(); }

  // 2. 销量/成本：纯本地数据（官方 salesv2 物化表 × erp_skus 加权均价）
  //    salesv2 是快照，只有 today/7d/30d 三个固定窗口，无法按自定义日期精确筛选。
  //    根据所选日期跨度选最接近的字段：<=7天用 last7d，>7天用 last30d。
  const finByMall = new Map();
  try {
    let daySpan = 30;
    if (startDate && endDate) {
      daySpan = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000));
    }
    const salesCol = daySpan <= 7 ? "last7d_sales" : "last30d_sales";
    const rows = db.prepare(`
      SELECT s.mall_id,
             SUM(COALESCE(s.${salesCol}, 0)) AS qty,
             SUM(COALESCE(s.${salesCol}, 0) * COALESCE(k.wac, 0)) AS cost
        FROM erp_temu_openapi_sku_sales s
        LEFT JOIN (
          SELECT internal_sku_code, MAX(weighted_avg_cost) AS wac
            FROM erp_skus GROUP BY internal_sku_code
        ) k ON k.internal_sku_code = s.ext_code
       GROUP BY s.mall_id
    `).all();
    for (const r of rows) {
      finByMall.set(r.mall_id, {
        cost: Number(r.cost) || 0,
        qty: Number(r.qty) || 0,
      });
    }
  } catch { /* salesv2 表不存在时保持空 */ }
  finByMall.clear();

  // 2b. 结算订单口径（C 口径）：已结算订单明细 × 加权均价。
  //     与「收入金额」同一批货（已结算订单），消除"收入算老订单、成本算新销量"的时间错配；
  //     sku_ext_code 即货号，与 erp_skus.internal_sku_code 直接关联（关联率 100%）。
  //     amount 用于前端算覆盖率（订单明细金额 ÷ 已结算货款，判断批次是否采全）。
  const orderByMall = new Map();
  try {
    let odWhere, odParams;
    const odSourceSql = sourceWhere(db, "erp_temu_settlement_order_detail", "d");
    if (startDate && endDate) {
      odWhere = `WHERE d.create_time >= ? AND d.create_time < date(?, '+1 day') ${odSourceSql}`;
      odParams = [startDate, endDate];
    } else {
      odWhere = `WHERE d.create_time >= date('now', '-30 days') ${odSourceSql}`;
      odParams = [];
    }
    const odRows = db.prepare(`
      WITH sku_wac AS (
        SELECT internal_sku_code, MAX(id) AS sku_id, MAX(weighted_avg_cost) AS wac
          FROM erp_skus
         WHERE COALESCE(internal_sku_code, '') <> ''
         GROUP BY internal_sku_code
      ),
      ledger_cost AS (
        SELECT s.internal_sku_code,
               l.source_doc_id,
               SUM(ABS(COALESCE(l.qty_delta, 0)) * COALESCE(l.unit_cost, 0))
                 / NULLIF(SUM(ABS(COALESCE(l.qty_delta, 0))), 0) AS unit_cost
          FROM erp_inventory_ledger_entries l
          JOIN erp_skus s ON s.id = l.sku_id
         WHERE l.type = 'outbound_to_temu'
           AND COALESCE(l.unit_cost, 0) > 0
           AND COALESCE(s.internal_sku_code, '') <> ''
         GROUP BY s.internal_sku_code, l.source_doc_id
      ),
      detail_cost AS (
        SELECT d.mall_id,
               COALESCE(d.quantity, 0) AS qty,
               COALESCE(d.amount, 0) AS amount,
               CASE WHEN json_extract(d.raw_json, '$.交易类型') = '销售回款' THEN COALESCE(d.amount, 0) ELSE 0 END AS sales_amt,
               CASE WHEN json_extract(d.raw_json, '$.交易类型') = '销售冲回' THEN COALESCE(d.amount, 0) ELSE 0 END AS reversal_amt,
               CASE WHEN json_extract(d.raw_json, '$.交易类型') = '非商责补贴' THEN COALESCE(d.amount, 0) ELSE 0 END AS subsidy_amt,
               CASE
                 WHEN COALESCE(lc.unit_cost, 0) > 0 THEN lc.unit_cost
                 WHEN COALESCE(h.weighted_avg_cost, 0) > 0 THEN h.weighted_avg_cost
                 WHEN COALESCE(k.wac, 0) > 0 THEN k.wac
                 ELSE 0
               END AS unit_cost,
               CASE
                 WHEN COALESCE(lc.unit_cost, 0) > 0 THEN 'ledger'
                 WHEN COALESCE(h.weighted_avg_cost, 0) > 0 THEN 'history'
                 WHEN COALESCE(k.wac, 0) > 0 THEN 'current'
                 ELSE 'missing'
               END AS source_kind
          FROM erp_temu_settlement_order_detail d
          LEFT JOIN sku_wac k ON k.internal_sku_code = d.sku_ext_code
          LEFT JOIN ledger_cost lc
            ON lc.internal_sku_code = d.sku_ext_code
           AND (
             lc.source_doc_id = 'consign-ship-cloud:' || d.mall_id || ':' || COALESCE(NULLIF(d.wb_no, ''), NULLIF(d.order_sn, ''), NULLIF(d.parent_order_sn, ''))
             OR lc.source_doc_id = 'consign-ship:' || COALESCE(NULLIF(d.wb_no, ''), NULLIF(d.order_sn, ''), NULLIF(d.parent_order_sn, ''))
           )
          LEFT JOIN erp_sku_cost_daily_snapshot h
            ON h.sku_id = k.sku_id
           AND h.stat_date = (
             SELECT MAX(h2.stat_date)
               FROM erp_sku_cost_daily_snapshot h2
              WHERE h2.sku_id = k.sku_id
                AND h2.stat_date <= date(COALESCE(NULLIF(d.create_time, ''), 'now'))
           )
         ${odWhere}
      )
      SELECT mall_id,
             SUM(qty) AS qty,
             SUM(CASE WHEN unit_cost > 0 THEN qty ELSE 0 END) AS qty_costed,
             SUM(CASE WHEN source_kind = 'ledger' THEN qty ELSE 0 END) AS qty_time_costed,
             SUM(CASE WHEN source_kind = 'history' THEN qty ELSE 0 END) AS qty_history_costed,
             SUM(CASE WHEN source_kind = 'current' THEN qty ELSE 0 END) AS qty_current_fallback,
             SUM(CASE WHEN source_kind = 'missing' THEN qty ELSE 0 END) AS qty_missing_cost,
             SUM(qty * unit_cost) AS cost,
             SUM(amount) AS amount,
             SUM(sales_amt) AS sales_revenue,
             SUM(reversal_amt) AS reversal_total,
             SUM(subsidy_amt) AS subsidy_total
        FROM detail_cost
       GROUP BY mall_id
    `).all(...odParams);
    for (const r of odRows) {
      orderByMall.set(r.mall_id, {
        qty: Number(r.qty) || 0,
        qty_costed: Number(r.qty_costed) || 0,
        qty_time_costed: Number(r.qty_time_costed) || 0,
        qty_history_costed: Number(r.qty_history_costed) || 0,
        qty_current_fallback: Number(r.qty_current_fallback) || 0,
        qty_missing_cost: Number(r.qty_missing_cost) || 0,
        cost: Number(r.cost) || 0,
        amount: Number(r.amount) || 0,
        sales_revenue: Number(r.sales_revenue) || 0,
        reversal_total: Number(r.reversal_total) || 0,
        subsidy_total: Number(r.subsidy_total) || 0,
      });
    }
  } catch { /* settlement_order_detail 表不存在时保持空 */ }

  // 3. settlement_income（真实结算收入，income-summary 主动采集）
  const stlIncByMall = new Map();
  try {
    let siDateWhere, siParams;
    const siSourceSql = sourceWhere(db, "erp_temu_settlement_income");
    if (startDate && endDate) {
      siDateWhere = "AND stat_date >= ? AND stat_date <= ?";
      siParams = [startDate, endDate];
    } else {
      siDateWhere = "AND stat_date >= date('now', '-30 days')";
      siParams = [];
    }
    const siRows = db.prepare(`
      SELECT mall_id, SUM(income_amount) AS total_income, COUNT(*) AS days
        FROM erp_temu_settlement_income
       WHERE income_amount IS NOT NULL ${siDateWhere}
         ${siSourceSql}
       GROUP BY mall_id
    `).all(...siParams);
    for (const r of siRows) {
      stlIncByMall.set(r.mall_id, { income: Number(r.total_income) || 0, days: r.days || 0 });
    }
  } catch { /* settlement_income 表不存在时保持空 */ }

  // 4. settlement_detail (全量不限时段)
  let sdByMall = null;
  try { sdByMall = buildSettlementDetailByMall(db, { startDate, endDate }); } catch { sdByMall = null; }

  // 5. 店铺字典
  const dict = readMallDictionary(db);
  const dictByMall = new Map(dict.map((row) => [row.mall_id, row]));

  // 6. 合并所有出现过的 mall_id
  const allMalls = new Set([...fundByMall.keys(), ...fundSummaryByMall.keys(), ...eprByMall.keys(), ...frozenByMall.keys(), ...accountOverviewByMall.keys(), ...fulfillmentByMall.keys(), ...violationByMall.keys(), ...stlIncByMall.keys(), ...orderByMall.keys()]);

  const stores = [];
  for (const mallId of allMalls) {
    const d = dictByMall.get(mallId);
    if (!d || d.status === "test") continue;
    const fd = fundByMall.get(mallId) || null;
    const fs = fundSummaryByMall.get(mallId) || null;
    const risk = riskByMall.get(mallId) || null;
    const fin = finByMall.get(mallId) || null;
    const sd = sdByMall ? (sdByMall.get(mallId) || null) : null;
    const si = stlIncByMall.get(mallId) || null;
    stores.push({
      mall_id: mallId,
      store_code: d.store_code || null,
      mall_name: d.mall_name || null,
      owner: d.owner || null,
      fund_detail: fd,
      fund_summary: fs,
      risk_detail: risk,
      epr_detail: eprByMall.get(mallId) || null,
      fund_frozen: frozenByMall.get(mallId) || null,
      account_overview: accountOverviewByMall.get(mallId) || null,
      fulfillment_bill: fulfillmentByMall.get(mallId) || null,
      violation: violationByMall.get(mallId) || null,
      settlement_income: si?.income || 0,  // 真实结算收入（income-summary）
      settlement_income_days: si?.days || 0,
      cost: fin?.cost || 0,
      qty: fin?.qty || 0,
      settlement_detail: sd,
      order_detail: orderByMall.get(mallId) || null, // C 口径：已结算订单件数/成本/金额
    });
  }
  stores.sort((a, b) => {
    if (!a.store_code && !b.store_code) return 0;
    if (!a.store_code) return 1;
    if (!b.store_code) return -1;
    return a.store_code.localeCompare(b.store_code);
  });

  return {
    stores,
    fund_detail_available: fundByMall.size > 0,
    fund_summary_available: fundSummaryByMall.size > 0,
    risk_detail_available: riskByMall.size > 0,
    epr_detail_available: eprByMall.size > 0,
    fund_frozen_available: frozenByMall.size > 0,
    account_overview_available: accountOverviewByMall.size > 0,
    fulfillment_bill_available: fulfillmentByMall.size > 0,
    violation_available: violationByMall.size > 0,
    financials_available: false,
    settlement_income_available: stlIncByMall.size > 0,
    order_detail_available: orderByMall.size > 0,
    date_range: { start: startDate || null, end: endDate || null },
  };
}

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

// 结算口径财务（实际结算明细 erp_temu_settlement_order_detail，纯本地、不依赖 cloud attach）。
//   营收 = Σ结算金额（销售回款 − 销售冲回 + 非商责补贴 的净额，真实结算到账）
//   成本 = Σ(结算数量 × 加权平均成本)  —— 仅「销售回款」行有数量，故成本天然只摊到卖出的货
//   毛利 = 营收 − 成本
// 相比 buildFinancialsByMall（销量×申报价预估营收）：货号 99.96% 齐全、成本匹配 ~97.6%，
// 不再因 cloud 销量快照货号缺失把无成本 SKU 按 0 成本算、导致毛利虚高。代价是结算有数天滞后。
// 返回 Map<mall_id, financials>（结构同 emptyFinancials）。表缺失返回 null（前端据此知维度不可用）。
function buildSettlementProfitByMall(db) {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='erp_temu_settlement_order_detail'")
    .get();
  if (!hasTable) return null;

  const latest = db
    .prepare("SELECT MAX(date(create_time)) AS d FROM erp_temu_settlement_order_detail")
    .get()?.d;
  if (!latest) return new Map();

  const since = shiftDate(latest, -59); // 覆盖 last30d + prev30d 环比
  const rows = db.prepare(`
    SELECT s.mall_id AS mall_id, date(s.create_time) AS d,
           SUM(COALESCE(s.amount,0)) AS revenue,
           SUM(COALESCE(s.quantity,0) * COALESCE(k.wac,0)) AS cost,
           SUM(COALESCE(s.quantity,0)) AS qty,
           SUM(CASE WHEN COALESCE(s.quantity,0) > 0 THEN 1 ELSE 0 END) AS sku_rows,
           SUM(CASE WHEN COALESCE(s.quantity,0) > 0 AND COALESCE(k.wac,0) > 0 THEN 1 ELSE 0 END) AS cost_rows
      FROM erp_temu_settlement_order_detail s
      LEFT JOIN (
        SELECT internal_sku_code, MAX(weighted_avg_cost) AS wac
          FROM erp_skus GROUP BY internal_sku_code
      ) k ON k.internal_sku_code = s.sku_ext_code
     WHERE date(s.create_time) >= ? AND date(s.create_time) <= ?
     GROUP BY s.mall_id, date(s.create_time)
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

  // 收尾：算环比、成本覆盖率、趋势数组（与 buildFinancialsByMall 同口径）
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

  const cloudMalls = optionalAllLocal(db,
    `SELECT mall_id, MAX(mall_name) AS mall_name, MAX(site) AS site, MAX(last_seen) AS last_seen_at
       FROM cloud.mall_accounts
      WHERE tenant_id = ? AND mall_id <> '' ${baseMallFilter}
      GROUP BY mall_id`, [tid, ...excludeMallIds]);
  const localMalls = optionalAllLocal(db,
    `SELECT mall_id, mall_name, site, NULL AS last_seen_at
       FROM erp_temu_malls
      WHERE mall_id <> ''
        ${includeTest ? "" : "AND COALESCE(status,'active') <> 'test'"}`, []);
  const mallById = new Map();
  for (const m of cloudMalls) mallById.set(m.mall_id, m);
  for (const m of localMalls) {
    if (!mallById.has(m.mall_id)) mallById.set(m.mall_id, m);
  }
  const malls = Array.from(mallById.values());

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

  // Keep report sales in step with OperationsWorkbench: prefer the official
  // salesv2 materialized table, and fall back to cloud scrape snapshots.
  const officialSalesRows = optionalAllLocal(db,
    `SELECT s.mall_id,
            SUM(COALESCE(s.today_sales,0))   AS sales_today_qty,
            SUM(COALESCE(s.last7d_sales,0))  AS sales_7d_qty,
            SUM(COALESCE(s.last30d_sales,0)) AS sales_30d_qty,
            COUNT(DISTINCT s.product_skc_id) AS sku_count
       FROM erp_temu_openapi_sku_sales s
       LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
      WHERE s.mall_id <> ''
        ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
      GROUP BY s.mall_id`, []);
  for (const r of officialSalesRows) salesMap.set(r.mall_id, r);

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

  // 货值（统一按官方 API 物化表 erp_temu_openapi_sku_sales 统计，本地主库表、35 店全覆盖，不依赖 cloud attach/抓包快照）：
  //   仓内货值 = 官方可售库存(warehouse_stock) × 加权均价；
  //   在途货值 = 官方待入库/在途(wait_in_stock = 已发往 Temu 仓待签收 + 待入库) × 加权均价。
  // 按 ext_code(货号) join erp_skus 加权均价；该表为当前态物化(非按天快照)，直接 SUM 不跨天虚高。成本未覆盖 SKU 计 0，为下限值。
  const invValueRows = optionalAllLocal(db,
    `SELECT s.mall_id,
            SUM(COALESCE(s.warehouse_stock,0) * COALESCE(k.wac,0)) AS warehouse_value,
            SUM(COALESCE(s.wait_in_stock,0)   * COALESCE(k.wac,0)) AS in_transit_value
       FROM erp_temu_openapi_sku_sales s
       LEFT JOIN (
         SELECT internal_sku_code, MAX(weighted_avg_cost) AS wac
           FROM erp_skus GROUP BY internal_sku_code
       ) k ON k.internal_sku_code = s.ext_code
      GROUP BY s.mall_id`, []);
  const invValueMap = new Map(invValueRows.map((r) => [r.mall_id, r]));

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
  const officialShopStatsRows = optionalAllLocal(db,
    `SELECT s.mall_id,
            MAX(SUBSTR(COALESCE(s.synced_at,''),1,10)) AS stat_date,
            SUM(COALESCE(s.today_sales,0))   AS sale_volume,
            SUM(COALESCE(s.last7d_sales,0))  AS seven_days_sale_volume,
            SUM(COALESCE(s.last30d_sales,0)) AS thirty_days_sale_volume,
            COUNT(DISTINCT s.product_skc_id) AS on_sale_product_number,
            0 AS wait_product_number,
            COUNT(DISTINCT CASE WHEN COALESCE(s.lack_quantity,0) > 0 THEN s.product_skc_id END) AS lack_skc_number,
            COUNT(DISTINCT CASE WHEN COALESCE(s.advice_qty,0) > 0 THEN s.product_skc_id END) AS advice_prepare_skc_number,
            COUNT(DISTINCT CASE WHEN s.sale_days IS NOT NULL AND s.sale_days < 7 THEN s.product_skc_id END) AS about_to_sell_out_number,
            COUNT(DISTINCT CASE WHEN COALESCE(s.warehouse_stock,0) <= 0 AND (COALESCE(s.last30d_sales,0) > 0 OR COALESCE(s.last7d_sales,0) > 0) THEN s.product_skc_id END) AS already_sold_out_number,
            0 AS high_price_limit_number,
            NULL AS quality_after_sale_ratio_90d,
            MAX(s.synced_at) AS last_updated_at
       FROM erp_temu_openapi_sku_sales s
       LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
      WHERE s.mall_id <> ''
        ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
      GROUP BY s.mall_id`, []);
  for (const r of officialShopStatsRows) shopStatsMap.set(r.mall_id, r);

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
    const iv = invValueMap.get(m.mall_id) || {};
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
      // 货值（官方 API 物化表统计，按加权均价计；成本未覆盖的 SKU 计 0，故为下限值）
      inventory: {
        warehouse_value: toNum(iv.warehouse_value),   // 仓内货值：官方可售库存(warehouse_stock) × 加权均价
        in_transit_value: toNum(iv.in_transit_value), // 在途货值：官方待入库/在途(wait_in_stock) × 加权均价
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

// 建议备货自算（统一口径，替代 Temu 黑盒 adviceQuantity）——与 temuAutoPurchase.cjs calcAdvice 同公式。
const _RESTOCK_FAST_QTY = 50, _RESTOCK_DAYS_NORMAL = 10, _RESTOCK_DAYS_FAST = 7;
function _beijingHour() { return (new Date().getUTCHours() + 8) % 24; }
function _skuTotalStock(warehouse, unavail, lack, waitIn) {
  return (warehouse || 0) + (unavail || 0) - (lack || 0) + (waitIn || 0);
}
function _calcAdvice(today, last7d, totalStock) {
  const hour = _beijingHour();
  const daily = Math.max((last7d || 0) / 7, (today || 0) * (hour < 12 ? 2 : hour < 18 ? 1.5 : 1.3));
  const days = daily > _RESTOCK_FAST_QTY ? _RESTOCK_DAYS_FAST : _RESTOCK_DAYS_NORMAL;
  return Math.max(0, Math.ceil(daily * days - (totalStock || 0)));
}

// 进程级结果缓存：跨库聚合冷态可达 ~17s（OS page cache 被挤出后首查），
// 缓存 + 服务端定时预热让用户请求永远命中暖缓存、秒回。
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const _reportCache = new Map();    // includeTest -> { data, ts }
const _reportInflight = new Map(); // includeTest -> Promise（并发去重，避免多请求同时冷算）

function clearMultiStoreReportCache() {
  _reportCache.clear();
  _reportInflight.clear();
}

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
  // 财务口径：实际结算明细（erp_temu_settlement_order_detail），纯本地、不依赖 cloud attach。
  // 货号 99.96% 齐全、成本匹配 ~97.6%，替代原销量×申报价预估口径（buildFinancialsByMall，
  // 因 cloud 销量快照货号缺失把无成本 SKU 按 0 成本算、致部分店毛利虚高）。
  let financialsByMall = null;
  try {
    financialsByMall = buildSettlementProfitByMall(db);
  } catch (error) {
    financialsByMall = null;
    if (options.onError) options.onError(error);
  }
  if (attached) {
    cloud = buildByStoreLocal(db, { includeTest: options.includeTest });
  } else {
    // 降级：本地开发机无 cloud sqlite 等场景，退回 cloud HTTP API（by-store 维度不可用）
    cloud = await fetchCloudReport({ includeTest: options.includeTest });
  }

  // 实际结算收入（本地物化表 erp_temu_settlement_income，纯本地、不依赖 cloud attach，
  // 与销量×申报价预估营收 financials 独立旁路）。表缺失/无数据时返回 null，前端据此知道维度不可用。
  let settlementByMall = null;
  try {
    settlementByMall = buildSettlementIncomeByMall(db);
  } catch (error) {
    settlementByMall = null;
    if (options.onError) options.onError(error);
  }

  // 结算明细三态（待处理/结算中/已到账，物化表 erp_temu_settlement_detail），与收入汇总独立旁路。
  let settlementDetailByMall = null;
  try {
    settlementDetailByMall = buildSettlementDetailByMall(db);
  } catch (error) {
    settlementDetailByMall = null;
    if (options.onError) options.onError(error);
  }

  // 对账中心账务明细（fund_detail），按店铺聚合近 30 天费用分类汇总
  let fundDetailByMall = null;
  try {
    fundDetailByMall = buildFundDetailByMall(db);
  } catch (error) {
    fundDetailByMall = null;
    if (options.onError) options.onError(error);
  }
  let fundSummaryByMall = null;
  try {
    fundSummaryByMall = buildFundSummaryByMall(db);
  } catch (error) {
    fundSummaryByMall = null;
    if (options.onError) options.onError(error);
  }
  let settlementRiskByMall = null;
  try {
    settlementRiskByMall = attached ? buildSettlementRiskByMall(db) : null;
  } catch (error) {
    settlementRiskByMall = null;
    if (options.onError) options.onError(error);
  }

  const dict = readMallDictionary(db);
  const dictByMall = new Map(dict.map((row) => [row.mall_id, row]));

  const stores = [];
  const unmapped = [];
  for (const s of cloud.stores || []) {
    const dictRow = dictByMall.get(s.mall_id);
    const financials = financialsByMall ? (financialsByMall.get(s.mall_id) || emptyFinancials()) : null;
    const settlement = settlementByMall ? (settlementByMall.get(s.mall_id) || emptySettlement()) : null;
    const settlement_detail = settlementDetailByMall ? (settlementDetailByMall.get(s.mall_id) || emptySettlementDetail()) : null;
    const fund_detail = fundDetailByMall ? (fundDetailByMall.get(s.mall_id) || null) : null;
    const fund_summary = fundSummaryByMall ? (fundSummaryByMall.get(s.mall_id) || null) : null;
    const risk_detail = settlementRiskByMall ? (settlementRiskByMall.get(s.mall_id) || null) : null;
    const enriched = {
      ...s,
      store_code: dictRow?.store_code || null,
      store_status: dictRow?.status || "unknown",
      dict_remark: dictRow?.remark || null,
      owner: dictRow?.owner || null,
      financials,
      settlement,
      settlement_detail,
      fund_detail,
      fund_summary,
      risk_detail,
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
    settlement_available: settlementByMall !== null, // 实际结算收入维度是否有数据（抓包物化）
    settlement_detail_available: settlementDetailByMall !== null, // 结算明细三态维度是否有数据（抓包物化）
    fund_detail_available: fundDetailByMall !== null && fundDetailByMall.size > 0, // 对账中心账务明细维度
    fund_summary_available: fundSummaryByMall !== null && fundSummaryByMall.size > 0,
    risk_detail_available: settlementRiskByMall !== null && settlementRiskByMall.size > 0,
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
           s.warehouse_stock, s.occupy_stock, s.unavailable_stock, s.lack_quantity,
           s.available_sale_days, s.declared_price_cents, s.stat_date
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
    total_stock: _skuTotalStock(toNum(r.warehouse_stock), toNum(r.unavailable_stock), toNum(r.lack_quantity), 0),
    advice_qty: _calcAdvice(toNum(r.today_sales), toNum(r.last7d_sales), _skuTotalStock(toNum(r.warehouse_stock), toNum(r.unavailable_stock), toNum(r.lack_quantity), 0)),
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
           s.warehouse_stock, s.occupy_stock, s.unavailable_stock, s.lack_quantity, s.wait_in_stock,
           s.sale_days, s.synced_at
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
    total_stock: _skuTotalStock(toNum(r.warehouse_stock), toNum(r.unavailable_stock), toNum(r.lack_quantity), toNum(r.wait_in_stock)),
    advice_qty: _calcAdvice(toNum(r.today_sales), toNum(r.last7d_sales), _skuTotalStock(toNum(r.warehouse_stock), toNum(r.unavailable_stock), toNum(r.lack_quantity), toNum(r.wait_in_stock))),
    sale_days: r.sale_days == null ? null : Number(r.sale_days),
    declared_price: null,
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
  // 已报名活动:按(店×货号)聚合已报活动数(扩展采的报名记录 temu_activity_enroll_record,每店最新天;排除报名失败=2)。
  // 表未建(migration 024 未部署)时 optionalAllLocal 返回 [] 不报错。
  const enrolledRows = optionalAllLocal(db, `
    WITH le AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_activity_enroll_record WHERE tenant_id = ? AND mall_id <> '' GROUP BY mall_id)
    SELECT e.mall_id, e.sku_ext_code, e.product_id, COUNT(DISTINCT e.activity_thematic_id) AS enrolled_count
      FROM cloud.temu_activity_enroll_record e
      JOIN le ON le.mall_id = e.mall_id AND le.sd = e.stat_date
     WHERE e.tenant_id = ? AND COALESCE(e.enroll_status, 0) <> 2 AND e.activity_thematic_id IS NOT NULL
     GROUP BY e.mall_id, e.sku_ext_code`, [tid, tid]);
  const enrolled = enrolledRows.map((r) => ({ mall_id: r.mall_id, sku_ext_code: r.sku_ext_code || null, product_id: r.product_id || null, count: toNum(r.enrolled_count) }));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out, enrolled };
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
// 官方路径：备货在途 = 采购单(purchase_order)算 需求/已发/缺口 + 发货单(ship_order)算 在途(已发出、未入库)。
// 采购单 SKU 级、发货单 SKC 级；在途按 mall_id+SKC 汇总后挂到对应 SKC 的首行(避免同 SKC 多 SKU 重复计)。
function _buildStockOrdersOfficialFresh(db, options = {}) {
  const includeTest = !!options.includeTest;
  const where = includeTest ? "" : " AND COALESCE(m.status,'active') <> 'test'";
  // 1) 发货单：按 mall_id+SKC 汇总在途件数(inboundTime 为空=未入库；在途 = 已发件数 - 已收件数)
  const shipRows = optionalAllLocal(db, "SELECT r.mall_id, r.raw_json FROM erp_temu_openapi_records r LEFT JOIN erp_temu_malls m ON m.mall_id = r.mall_id WHERE r.source = 'ship_order' AND r.raw_json IS NOT NULL" + where, []);
  const transit = new Map();
  for (const r of shipRows) {
    let s; try { s = JSON.parse(r.raw_json); } catch (e) { continue; }
    if (s.inboundTime) continue;
    const skc = s.productSkcId != null ? String(s.productSkcId) : null;
    if (!skc) continue;
    const pkgs = Array.isArray(s.packageList) ? s.packageList : [];
    let sent = 0; for (const p of pkgs) sent += toNum(p.skcNum);
    const inTransit = Math.max(0, sent - toNum(s.receiveSkcNum));
    if (inTransit <= 0) continue;
    const k = r.mall_id + "|" + skc;
    transit.set(k, (transit.get(k) || 0) + inTransit);
  }
  // 2) 采购单：SKU 级 需求/已发/已收/缺口
  const poRows = optionalAllLocal(db, "SELECT r.mall_id, m.store_code, m.mall_name, r.raw_json FROM erp_temu_openapi_records r LEFT JOIN erp_temu_malls m ON m.mall_id = r.mall_id WHERE r.source = 'purchase_order' AND r.raw_json IS NOT NULL" + where, []);
  const out = [];
  const usedTransit = new Set();
  for (const r of poRows) {
    let p; try { p = JSON.parse(r.raw_json); } catch (e) { continue; }
    const di = p.deliverInfo || {};
    const latest = di.expectLatestDeliverTimeOrDefault || di.expectLatestArrivalTimeOrDefault || null;
    const warehouse = di.receiveWarehouseName || null;
    const orderNo = p.originalPurchaseOrderSn || null;
    const skc = p.productSkcId != null ? String(p.productSkcId) : null;
    const tk = r.mall_id + "|" + (skc || "");
    const list = Array.isArray(p.skuQuantityDetailList) ? p.skuQuantityDetailList : [];
    for (const d of list) {
      const demand = toNum(d.purchaseQuantity);
      const delivered = toNum(d.deliverQuantity);
      const received = toNum(d.realReceiveAuthenticQuantity);
      const gap = Math.max(0, demand - delivered);
      let shipping = 0;
      if (skc && transit.has(tk) && !usedTransit.has(tk)) { shipping = transit.get(tk); usedTransit.add(tk); }
      if (gap <= 0 && shipping <= 0) continue;
      out.push({
        mall_id: r.mall_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
        sku_ext_code: d.extCode || null, product_name: p.productName || null, spec_name: d.className || null,
        source_type: "purchase_order", demand_qty: demand, delivered_qty: delivered,
        gap: gap, shipping_qty: shipping, inbound_qty: received,
        latest_ship_at: latest ? String(latest) : null, warehouse: warehouse, order_no: orderNo,
      });
    }
  }
  out.sort((a, b) => ((a.latest_ship_at || "~").localeCompare(b.latest_ship_at || "~")) || (b.gap - a.gap));
  return { generated_at: Date.now(), row_count: out.length, rows: out.slice(0, 4000), source: "official" };
}

function buildStockOrders(db, options = {}) {
  if (!db) throw new Error("buildStockOrders: db is required (host mode only)");
  if (useOfficialReports(options)) {
    const ok = "o:" + (options.includeTest ? "1" : "0");
    if (!options.force) { const c = _stockOrderCache.get(ok); if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data; }
    const data = _buildStockOrdersOfficialFresh(db, options);
    _stockOrderCache.set(ok, { data, ts: Date.now() });
    return data;
  }
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
      const _cts = _skuTotalStock(toNum(d.warehouse_stock), toNum(d.unavailable_stock), toNum(d.lack_quantity), 0);
      arr.push({ skc_id: d.skc_id || null, sku_ext_code: d.sku_ext_code || null, declared_price: d.declared_price_cents ? Number(d.declared_price_cents) / 100 : null, today: toNum(d.today_sales), last7d: toNum(d.last7d_sales), sale_days: d.available_sale_days == null ? null : Number(d.available_sale_days), stock: toNum(d.warehouse_stock), occupy: toNum(d.occupy_stock), unavail_stock: toNum(d.unavailable_stock), advice_qty: _calcAdvice(toNum(d.today_sales), toNum(d.last7d_sales), _cts), lack_qty: toNum(d.lack_quantity) });
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
      a.stock += toNum(d.warehouse_stock); a.occupy += toNum(d.occupy_stock); a.unavail += toNum(d.unavailable_stock); a.advice += _calcAdvice(toNum(d.today_sales), toNum(d.last7d_sales), _cts); a.lackQty += toNum(d.lack_quantity);
      if (toNum(d.warehouse_stock) <= 0) a.lack++;
    }
    codeMap = new Map([...agg].map(([k, a]) => [k, { skcs: [...a.skcs].join(",") || null, skus: [...a.skus].join(",") || null, declared: a.declared, score: a.score, comments: a.comments, stock: a.stock, occupy: a.occupy, unavail: a.unavail, advice: a.advice, lack: a.lack, lackQty: a.lackQty }]));
  }
  // 发货在途：备货单运输中数量(shipping_qty)，按 mall_id+product_id+sku_ext_code 聚合(stock_order 是当前态 upsert，无跨天虚高)
  let shipMap = new Map();
  let shipSkuMap = new Map();
  if (pids.length) {
    const ph2 = pids.map(() => "?").join(",");
    const shipRows = optionalAllLocal(db, `
      SELECT mall_id, product_id, sku_ext_code, SUM(COALESCE(shipping_qty,0)) ship
        FROM cloud.temu_stock_order_snapshot
       WHERE tenant_id = ? AND product_id IN (${ph2}) AND product_id IS NOT NULL AND product_id <> ''
       GROUP BY mall_id, product_id, sku_ext_code`, [tid, ...pids]);
    for (const s of shipRows) {
      const pk = s.mall_id + "|" + s.product_id;
      shipMap.set(pk, (shipMap.get(pk) || 0) + toNum(s.ship));
      if (s.sku_ext_code) shipSkuMap.set(pk + "|" + s.sku_ext_code, toNum(s.ship));
    }
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
    const spk = e.mall_id + "|" + e.product_id;
    for (const sk of e.skus_detail) {
      sk.shipping = sk.sku_ext_code ? (shipSkuMap.get(spk + "|" + sk.sku_ext_code) || 0) : 0;
    }
    e.store_code = m ? m.store_code || null : null;
    e.mall_name = m ? m.mall_name || null : null;
    out.push(e);
  }
  out.sort((a, b) => (b.limited ? 1 : 0) - (a.limited ? 1 : 0) || (b.compliance ? 1 : 0) - (a.compliance ? 1 : 0) || (b.act_cnt - a.act_cnt) || ((b.expose || 0) - (a.expose || 0)));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out.slice(0, 4000) };
  _productPanelCache.set(key, { data, ts: Date.now() });
  return data;
}

// 官方路径：从 erp_temu_openapi_sku_sales 聚合成 SPU 级运营面板。
// 官方表无：申报价/评价/流量/限流/合规/可报活动 → 这些字段留空（前端对应列已/将隐藏）。
function _buildProductPanelOfficialFresh(db, options = {}) {
  const includeTest = !!options.includeTest;
  const limit = Math.min(8000, Math.max(50, Number(options.limit) || 4000));
  const rows = optionalAllLocal(db, `
    SELECT s.mall_id, m.store_code, m.mall_name, s.product_id,
           s.product_skc_id, s.ext_code, s.spec_name, s.title, s.thumb_url,
           s.today_sales, s.last7d_sales, s.last30d_sales, s.sale_days,
           s.warehouse_stock, s.occupy_stock, s.unavailable_stock, s.advice_qty, s.lack_quantity,
           s.wait_in_stock, s.onsales_duration_offline, s.hot_tag, s.has_hot_sku
      FROM erp_temu_openapi_sku_sales s
      LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
     WHERE 1=1 ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
  `, []);
  const map = new Map();
  for (const r of rows) {
    const k = r.mall_id + "|" + r.product_id;
    let e = map.get(k);
    if (!e) {
      e = { mall_id: r.mall_id, product_id: r.product_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
        title: r.title || null, thumb: r.thumb_url || null, _skc: new Set(), _sku: new Set(),
        declared_price: null, score: null, comments: null,
        stock: 0, occupy: 0, unavail: 0, advice: 0, lack: 0, lack_qty: 0, shipping: 0,
        expose: null, click: null, pay: null, conv: null, grow: null, limited: false, act_cnt: 0, min_price: null, compliance: null, onsales_duration: null, hot_tag: false, has_hot_sku: false,
        skus_detail: [] };
      map.set(k, e);
    }
    if (r.product_skc_id) e._skc.add(r.product_skc_id);
    if (r.ext_code) e._sku.add(r.ext_code);
    if (r.title && !e.title) e.title = r.title;
    if (r.thumb_url && !e.thumb) e.thumb = r.thumb_url;
    const _ts = _skuTotalStock(toNum(r.warehouse_stock), toNum(r.unavailable_stock), toNum(r.lack_quantity), toNum(r.wait_in_stock));
    e.stock += toNum(r.warehouse_stock); e.occupy += toNum(r.occupy_stock); e.unavail += toNum(r.unavailable_stock);
    e.advice += _calcAdvice(toNum(r.today_sales), toNum(r.last7d_sales), _ts); e.lack_qty += toNum(r.lack_quantity);
    e.shipping += toNum(r.wait_in_stock);
    if (toNum(r.onsales_duration_offline) > 0) e.onsales_duration = toNum(r.onsales_duration_offline);
    if (toNum(r.hot_tag) > 0) e.hot_tag = true;
    if (toNum(r.has_hot_sku) > 0) e.has_hot_sku = true;
    if (toNum(r.warehouse_stock) <= 0) e.lack++;
    e.skus_detail.push({ skc_id: r.product_skc_id || null, sku_ext_code: r.ext_code || null, spec_name: r.spec_name || null, declared_price: null,
      today: toNum(r.today_sales), last7d: toNum(r.last7d_sales), last30d: toNum(r.last30d_sales), sale_days: r.sale_days == null ? null : Number(r.sale_days),
      stock: toNum(r.warehouse_stock), occupy: toNum(r.occupy_stock), advice_qty: _calcAdvice(toNum(r.today_sales), toNum(r.last7d_sales), _ts), lack_qty: toNum(r.lack_quantity) });
  }
  const arr = [...map.values()];
  // 按 SPU 级30天销量降序后再截断:总 SPU(上万)远多于 limit,若直接对无序 map slice 会漏掉高销量商品
  for (const e of arr) e._s30 = e.skus_detail.reduce((x, s) => x + (s.last30d || 0), 0);
  arr.sort((a, b) => b._s30 - a._s30);
  const out = arr.slice(0, limit).map((e) => {
    const { _skc, _sku, _s30, ...rest } = e;
    // 子行按规格名排序(同色相邻、尺码递增),空规格排末尾;让同 SKC 多尺码堆叠更易读
    // numeric:true 走自然排序(39<118,而非字典序里"118"<"39");排序 key 去空白,消除"17.7 英寸"vs"17.7英寸"格式不一致致乱序
    const specKey = (x) => String(x.spec_name || "").replace(/\s+/g, "");
    rest.skus_detail.sort((a, b) => {
      const ka = specKey(a), kb = specKey(b);
      if (!ka || !kb) return (ka ? 0 : 1) - (kb ? 0 : 1); // 空规格垫底
      return ka.localeCompare(kb, "zh", { numeric: true });
    });
    return { ...rest, skc_codes: [..._skc].join(",") || null, sku_codes: [..._sku].join(",") || null,
      total_stock: rest.stock + rest.unavail - rest.lack_qty + rest.shipping };
  });
  return { generated_at: Date.now(), row_count: out.length, rows: out, source: "official" };
}

// 商品销量趋势:从 cloud.temu_sales_snapshot 按 product_id 取逐日销量/营收(申报价×销量)。
// 数据=抓包采集快照,覆盖采集到的店与天数(约近2周、部分店);需 attach cloud,未 attach 则返回空。
function buildProductSalesTrend(db, options = {}) {
  const productId = options.productId != null ? String(options.productId) : "";
  if (!productId) return { product_id: null, rows: [], row_count: 0, source: "cloud" };
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { product_id: productId, rows: [], row_count: 0, attached: false, source: "cloud" };
  }
  const rows = db.prepare(`
    SELECT stat_date AS date,
           SUM(COALESCE(today_sales,0)) AS qty,
           ROUND(SUM(COALESCE(declared_price_cents,0)/100.0 * COALESCE(today_sales,0)), 2) AS revenue
      FROM cloud.temu_sales_snapshot
     WHERE product_id = ?
     GROUP BY stat_date
     ORDER BY stat_date
  `).all(productId);
  return { product_id: productId, rows, row_count: rows.length, source: "cloud" };
}

// ===== 高价限流清单：被 Temu「高价流量受限」的商品 =====
// 数据源=抓包 cloud.temu_operation_risk_snapshot(risk_type='high_price_flow')，官方 API 无此数据(价格类零权限)。
// 被动抓包：只有运营逛过 Temu 限流页的店才有数据；故按「近 N 天出现过」聚合，而非只看最新一天。
// 流量下降率取自 raw_json.flowDeclineRate；商品基础信息 join 官方物化表 erp_temu_openapi_sku_sales(最新最全)，
// 申报价从 cloud.temu_sales_snapshot 补(官方表无)。降价建议/目标价抓包为空壳，不提供。
const _hpfListCache = new Map();
function buildHighPriceFlowList(db, options = {}) {
  if (!db) throw new Error("buildHighPriceFlowList: db is required (host mode only)");
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], attached: false, source: "cloud" };
  }
  const includeTest = !!options.includeTest;
  const days = Math.min(60, Math.max(1, Number(options.days) || 14));
  const key = (includeTest ? "1" : "0") + ":" + days;
  if (!options.force) {
    const c = _hpfListCache.get(key);
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
  // 1) 高价限流：per (mall_id, product_id) 近 days 天最新一条，取流量下降率
  const limRows = optionalAllLocal(db, `
    WITH lr AS (
      SELECT mall_id, product_id, MAX(stat_date) sd
        FROM cloud.temu_operation_risk_snapshot
       WHERE tenant_id = ? AND risk_type = 'high_price_flow'
         AND product_id IS NOT NULL AND product_id <> ''
         AND stat_date >= date('now', ?)
       GROUP BY mall_id, product_id)
    SELECT r.mall_id, r.product_id, lr.sd AS last_seen_date,
           MAX(r.skc_id) skc_id,
           MAX(CAST(json_extract(r.raw_json, '$.flowDeclineRate') AS REAL)) AS decline_rate,
           MAX(CAST(json_extract(r.raw_json, '$.currentSupplierPrice') AS REAL)) AS cur_cents,
           MAX(CAST(json_extract(r.raw_json, '$.targetSupplierPriceForAllSite') AS REAL)) AS tgt_cents
      FROM cloud.temu_operation_risk_snapshot r
      JOIN lr ON lr.mall_id = r.mall_id AND lr.product_id = r.product_id AND lr.sd = r.stat_date
     WHERE r.risk_type = 'high_price_flow'
     GROUP BY r.mall_id, r.product_id`, [tid, `-${days} days`]);
  if (!limRows.length) {
    const data = { generated_at: Date.now(), row_count: 0, rows: [], source: "cloud" };
    _hpfListCache.set(key, { data, ts: Date.now() });
    return data;
  }
  const pids = [...new Set(limRows.map((r) => String(r.product_id)))].filter(Boolean);
  const ph = pids.map(() => "?").join(",");
  // 2) 商品基础信息(官方物化表,by mall_id+product_id 聚合 SPU)：标题/缩略图/货号/可用库存/今日·7天销量
  const offRows = optionalAllLocal(db, `
    SELECT mall_id, product_id, MAX(title) title, MAX(thumb_url) thumb,
           GROUP_CONCAT(DISTINCT ext_code) sku_codes,
           SUM(COALESCE(warehouse_stock, 0)) stock,
           SUM(COALESCE(today_sales, 0)) today_sales,
           SUM(COALESCE(last7d_sales, 0)) last7d_sales
      FROM erp_temu_openapi_sku_sales
     WHERE product_id IN (${ph})
     GROUP BY mall_id, product_id`, pids);
  const offMap = new Map(offRows.map((o) => [o.mall_id + "|" + o.product_id, o]));
  // 3) 申报价 + 标题/缩略图兜底(cloud temu_sales_snapshot 每商品最新天，取最低申报价)
  const cloudRows = optionalAllLocal(db, `
    WITH ls AS (SELECT product_id, MAX(stat_date) sd FROM cloud.temu_sales_snapshot WHERE tenant_id = ? AND product_id IN (${ph}) GROUP BY product_id)
    SELECT s.product_id, MIN(NULLIF(s.declared_price_cents, 0)) declared_cents, MAX(s.title) title, MAX(s.thumb_url) thumb
      FROM cloud.temu_sales_snapshot s JOIN ls ON ls.product_id = s.product_id AND ls.sd = s.stat_date
     WHERE s.product_id IN (${ph}) GROUP BY s.product_id`, [tid, ...pids, ...pids]);
  const cloudMap = new Map(cloudRows.map((c) => [String(c.product_id), c]));
  // 4) 店铺信息(店号/店名/负责人)
  const malls = optionalAllLocal(db, `SELECT mall_id, store_code, mall_name, owner, status FROM erp_temu_malls`, []);
  const mallMap = new Map(malls.map((m) => [m.mall_id, m]));
  const out = [];
  for (const r of limRows) {
    const m = mallMap.get(r.mall_id);
    if (!includeTest && m && m.status === "test") continue;
    const off = offMap.get(r.mall_id + "|" + r.product_id);
    const cl = cloudMap.get(String(r.product_id));
    out.push({
      mall_id: r.mall_id,
      store_code: m ? m.store_code || null : null,
      mall_name: m ? m.mall_name || null : null,
      owner: m ? m.owner || null : null,
      product_id: r.product_id,
      skc_id: r.skc_id || null,
      title: (off && off.title) || (cl && cl.title) || null,
      thumb: (off && off.thumb) || (cl && cl.thumb) || null,
      sku_codes: off && off.sku_codes ? off.sku_codes : null,
      decline_rate: r.decline_rate == null ? null : Number(r.decline_rate),
      current_price: r.cur_cents == null ? null : Number(r.cur_cents) / 100,
      target_price: r.tgt_cents == null ? null : Number(r.tgt_cents) / 100,
      last_seen_date: r.last_seen_date || null,
      declared_price: cl && cl.declared_cents ? Number(cl.declared_cents) / 100 : null,
      stock: off ? toNum(off.stock) : null,
      today_sales: off ? toNum(off.today_sales) : null,
      last7d_sales: off ? toNum(off.last7d_sales) : null,
    });
  }
  // 默认按流量下降率降序(限得最狠的排前)，其次最近限流日新的在前
  out.sort((a, b) => (b.decline_rate || 0) - (a.decline_rate || 0) || String(b.last_seen_date || "").localeCompare(String(a.last_seen_date || "")));
  const data = { generated_at: Date.now(), row_count: out.length, rows: out, source: "cloud" };
  _hpfListCache.set(key, { data, ts: Date.now() });
  return data;
}

// 商品运营面板:优先读物化缓存表(cron 预聚合,毫秒),无/未跑则实时兜底(慢);官方源走 official 版
function getProductPanelFast(db, options = {}) {
  if (useOfficialReports(options)) {
    const ok = "o:" + (options.includeTest ? "1" : "0");
    if (!options.force) { const c = _productPanelCache.get(ok); if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data; }
    const data = _buildProductPanelOfficialFresh(db, options);
    _productPanelCache.set(ok, { data, ts: Date.now() });
    return data;
  }
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
    shipped: "已发货", trade_completed: "交易完成", arrived: "已到货", inbounded: "已入库", closed: "已关闭",
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
  const UNSHIP = "status<>'cancelled' AND payment_status='paid' AND status NOT IN ('shipped','trade_completed','arrived','inbounded','closed')";
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

// 平台仓质检结果(运营工作台「平台质检」Tab):读 erp_temu_openapi_qc(官方采集物化),
// 默认只列不合格,关联店名 + join sku_sales 补货号(质检接口不返回货号)。纯本地 erp.sqlite。
function parseFlawsJson(j) { if (!j) return []; try { const a = JSON.parse(j); return Array.isArray(a) ? a : []; } catch { return []; } }
// 读某单第一张疵点小缩略(数据盘缓存 thumb.jpg)→ base64,供列表内嵌直显;无缓存返回 null(前端退化为「X张」点击)。
function readQcThumb(qcBillId) {
  try {
    const fs = require("fs"); const path = require("path");
    const p = path.join(QC_FLAW_CACHE_DIR, String(qcBillId).replace(/[^0-9a-zA-Z_-]/g, ""), "thumb.jpg");
    if (fs.existsSync(p)) return "data:image/jpeg;base64," + fs.readFileSync(p).toString("base64");
  } catch { /* 读失败返回 null */ }
  return null;
}
// 实时拉某质检单的疵点照片:私有图带 ~30 分钟签名,存的会失效,故实时调详情拿最新签名 URL + node fetch 带 referer 拉成 base64。
const QC_FLAW_CACHE_DIR = process.env.QC_FLAW_CACHE_DIR || "/opt/temu-erp-data/qc-flaw-cache";
async function fetchQcFlawImages(db, options = {}) {
  const nodeFs = require("fs");
  const nodePath = require("path");
  const mallId = String(options.mallId || options.mall_id || "");
  const qcBillId = String(options.qcBillId || options.qc_bill_id || "");
  if (!mallId || !qcBillId) throw new Error("缺少 mallId/qcBillId");
  const dir = nodePath.join(QC_FLAW_CACHE_DIR, qcBillId.replace(/[^0-9a-zA-Z_-]/g, ""));
  // 1) 命中数据盘缓存:直接读文件返回(秒出,不调 Temu)
  try {
    if (nodeFs.existsSync(dir)) {
      const files = nodeFs.readdirSync(dir).filter((f) => /\.jpg$/i.test(f)).sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]));
      if (files.length) {
        const images = files.map((f) => `data:image/jpeg;base64,${nodeFs.readFileSync(nodePath.join(dir, f)).toString("base64")}`);
        return { count: images.length, images, cached: true };
      }
    }
  } catch { /* 读缓存失败则走实时拉 */ }
  // 2) 未缓存:实时调详情拿最新签名 + 拉缩略,顺手写入数据盘缓存(增量)
  const m = db.prepare("SELECT app_key, app_secret, access_token, region FROM erp_temu_openapi_auth WHERE mall_id = ?").get(mallId);
  if (!m) throw new Error("该店未绑定官方授权");
  const { callOpenApi } = require("../temuOpenApiClient.cjs");
  const r = await callOpenApi({ type: "bg.goods.qualityinspectiondetail.get", appKey: m.app_key, appSecret: m.app_secret, accessToken: m.access_token, region: m.region || "CN", bizParams: { qcBillId: Number(qcBillId) } });
  if (!r.response || r.response.success !== true) throw new Error((r.response && r.response.errorMsg) || "质检详情查询失败");
  const hist = (r.response.result && r.response.result.historyVOS) || [];
  const urls = [];
  for (const h of hist) for (const f of ((h.qcDetail && h.qcDetail.flawDTOList) || [])) for (const u of (f.attachments || [])) if (u && !urls.includes(u)) urls.push(u);
  let cacheOk = false;
  try { nodeFs.mkdirSync(dir, { recursive: true }); cacheOk = true; } catch { /* 缓存目录建失败仍可返回 */ }
  const images = [];
  let idx = 0;
  for (const u of urls.slice(0, 30)) { // 上限 30 张防滥用
    try {
      const thumbUrl = u + (u.includes("?") ? "&" : "?") + "imageMogr2/thumbnail/800x"; // COS 数据万象缩略(800px),体积降约4倍
      const resp = await fetch(thumbUrl, { headers: { Referer: "https://kuajingmaihuo.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" } });
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) continue; // 单图 ≤ 8M
      if (cacheOk) { try { nodeFs.writeFileSync(nodePath.join(dir, `${idx}.jpg`), buf); } catch { /* 写缓存失败不致命 */ } }
      idx += 1;
      images.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
    } catch { /* 单图失败跳过 */ }
  }
  return { count: images.length, images, cached: false };
}
function buildOpenapiQc(db, options = {}) {
  const includeTest = !!options.includeTest;
  const limit = Math.min(5000, Math.max(50, Number(options.limit) || 2000));
  const onlyBad = options.onlyBad !== false; // 默认只不合格
  const rows = optionalAllLocal(db, `
    SELECT q.mall_id, m.store_code, m.mall_name,
           q.qc_bill_id, q.product_sku_id, q.product_skc_id, q.spu_id,
           COALESCE(NULLIF(q.ext_code,''), s.ext_code) AS ext_code,
           q.sku_name, q.spec, q.cat_name, q.purchase_no, q.thumb_url,
           q.qc_result, q.qc_result_update_time, q.finish_time,
           q.expect_qty, q.defective_qty, q.qc_group_name, q.receipt_no,
           q.flaw_summary, q.flaws_json, q.flaw_image_count
      FROM erp_temu_openapi_qc q
      LEFT JOIN erp_temu_malls m ON m.mall_id = q.mall_id
      LEFT JOIN erp_temu_openapi_sku_sales s ON s.mall_id = q.mall_id AND s.product_sku_id = q.product_sku_id
     WHERE 1=1
       ${onlyBad ? "AND q.qc_result = 2" : ""}
       ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY q.qc_result_update_time DESC
     LIMIT ?
  `, [limit]);
  const out = rows.map((r) => ({
    mall_id: r.mall_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
    qc_bill_id: r.qc_bill_id, product_sku_id: r.product_sku_id || null, product_skc_id: r.product_skc_id || null, spu_id: r.spu_id || null,
    ext_code: r.ext_code || null, sku_name: r.sku_name || null, spec: r.spec || null, cat_name: r.cat_name || null,
    purchase_no: r.purchase_no || null, thumb_url: r.thumb_url || null,
    qc_result: r.qc_result == null ? null : toNum(r.qc_result),
    qc_result_update_time: r.qc_result_update_time || null, finish_time: r.finish_time || null,
    expect_qty: r.expect_qty == null ? null : toNum(r.expect_qty),
    defective_qty: r.defective_qty == null ? null : toNum(r.defective_qty),
    qc_group_name: r.qc_group_name || null, receipt_no: r.receipt_no || null,
    flaw_summary: r.flaw_summary || null, flaws: parseFlawsJson(r.flaws_json),
    flaw_image_count: r.flaw_image_count == null ? 0 : toNum(r.flaw_image_count),
    flaw_thumb: readQcThumb(r.qc_bill_id),
  }));
  return { generated_at: Date.now(), row_count: out.length, rows: out, source: "official" };
}

// 今日首单发货(运营工作台总览统计卡):读 erp_temu_firstship_daily 当天(北京时区)行,关联店名。
// 数据由 temuOpenApiFirstShip.cjs(cron)物化(bg.shiporderv2.get 筛 isFirst,按 WB 去重)。纯本地 erp.sqlite。
function buildFirstShipToday(db, options = {}) {
  const includeTest = !!options.includeTest;
  const statDate = options.statDate || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // 北京今天 YYYY-MM-DD
  const rows = optionalAllLocal(db, `
    SELECT f.mall_id, m.store_code, m.mall_name,
           f.sub_purchase_order_sn, f.delivery_order_sn, f.product_skc_id, f.ext_code, f.deliver_time
      FROM erp_temu_firstship_daily f
      LEFT JOIN erp_temu_malls m ON m.mall_id = f.mall_id
     WHERE f.stat_date = ?
       ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY f.deliver_time DESC
  `, [statDate]);
  const out = rows.map((r) => ({
    mall_id: r.mall_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
    sub_purchase_order_sn: r.sub_purchase_order_sn, delivery_order_sn: r.delivery_order_sn || null,
    product_skc_id: r.product_skc_id || null, ext_code: r.ext_code || null,
    deliver_time: r.deliver_time == null ? null : toNum(r.deliver_time),
  }));
  return { generated_at: Date.now(), stat_date: statDate, row_count: out.length, rows: out, source: "official" };
}

// 今日创建商品(各店概览「今日创建」列):读 erp_temu_goods_created_daily 当天(北京)行,关联店名。
// 数据由 temuOpenApiGoodsCreated.cjs(cron)物化(goods.list createdAt=今天)。纯本地 erp.sqlite。
function buildGoodsCreatedToday(db, options = {}) {
  const includeTest = !!options.includeTest;
  const statDate = options.statDate || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const rows = optionalAllLocal(db, `
    SELECT g.mall_id, m.store_code, m.mall_name, g.product_skc_id, g.product_id, g.skc_site_status, g.created_at
      FROM erp_temu_goods_created_daily g
      LEFT JOIN erp_temu_malls m ON m.mall_id = g.mall_id
     WHERE g.stat_date = ?
       ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY g.created_at DESC
  `, [statDate]);
  const out = rows.map((r) => ({
    mall_id: r.mall_id, store_code: r.store_code || null, mall_name: r.mall_name || null,
    product_skc_id: r.product_skc_id || null, product_id: r.product_id || null,
    skc_site_status: r.skc_site_status == null ? null : toNum(r.skc_site_status),
    created_at: r.created_at == null ? null : toNum(r.created_at),
  }));
  return { generated_at: Date.now(), stat_date: statDate, row_count: out.length, rows: out, source: "official" };
}

// 商品品质看板(运营工作台「商品品质」Tab):读 cloud 抓包(Temu 后台「商品品质看板」/main/quality/dashboard
// 的 supplyChain/qualityMetrics 系列接口),解析品质分 + 售后率 + 售后/差评问题分布 + 店铺级 90 天指标。
// ⚠️数据是被动抓包(谁在后台打开过该店品质看板才抓得到)→只覆盖被浏览过的店,其余店为空(非 bug)。
// 一行 = 一个商品(按 mall_id+productId 去重,保留最新一次抓包)。纯读 cloud.capture_events,不写。
const QUALITY_PAGEQUERY_PATH = "/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/pageQuery"; // 商品级列表
const QUALITY_SHOPMETRIC_PATH = "/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/query";   // 店铺级 90 天指标
// 从 capture_events.url 的 origin 提站点:cn(agentseller.temu.com)/us(-us)/eu(-eu)。品质数据按「店+站点」区分(同店各站点品质分/评分不同)。
function qualitySiteFromUrl(url) {
  const u = String(url || "");
  if (/agentseller-us\./i.test(u)) return "us";
  if (/agentseller-eu\./i.test(u)) return "eu";
  return "cn";
}
// Temu 售后/差评问题名常见英文 → 中文(problAfsItemList 多为英文,problRevItemList 多为中文,未命中保留原文)
const QUALITY_PROBLEM_ZH = {
  "Damaged or unusable goods": "货物损坏/无法使用",
  "Item description discrepancy": "描述不符",
  "Quality issue": "质量问题",
  "Missing parts or accessories": "零件/配件缺失",
  "Wrong item received": "发错货",
  "Wrong item": "发错货",
  "Size issue": "尺寸问题",
  "Functional issue": "功能问题",
  "Poor quality": "质量差",
};
const _qNum = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const _qParse = (s) => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
function getQualityPageItems(j) {
  const result = j && j.result ? j.result : j;
  const containers = [result, result?.data, result?.page, result?.pageInfo].filter(Boolean);
  for (const c of containers) {
    if (Array.isArray(c)) return c;
    for (const key of ["pageItems", "items", "list", "records", "data"]) {
      if (Array.isArray(c?.[key])) return c[key];
    }
  }
  return [];
}
// 问题分布数组(problemName + quantity) → 摘要文本「描述不符×4; 货损×1」;空返回 null
function summarizeQualityProblems(list) {
  if (!Array.isArray(list)) return null;
  const parts = [];
  for (const p of list) {
    if (!p || !p.problemName) continue;
    const name = QUALITY_PROBLEM_ZH[p.problemName] || p.problemName;
    const q = Number(p.quantity);
    parts.push(Number.isFinite(q) && q > 0 ? `${name}×${q}` : name);
  }
  return parts.length ? parts.join("; ") : null;
}
function buildQualityPanel(db, options = {}) {
  const attachCloudDb = options.attachCloudDb;
  if (typeof attachCloudDb !== "function" || attachCloudDb(db) !== true) {
    return { generated_at: Date.now(), row_count: 0, rows: [], shops: [], attached: false, source: "cloud" };
  }
  const includeTest = !!options.includeTest;
  // 店铺字典:mall_id → 店名/店号/负责人/test 标记(品质数据按 Temu mall_id 关联)
  const dict = new Map();
  for (const m of readMallDictionary(db)) {
    dict.set(String(m.mall_id), { store_code: m.store_code || null, mall_name: m.mall_name || null, owner: m.owner || null, status: m.status || null });
  }
  const isTestMall = (mallId) => (dict.get(String(mallId))?.status === "test");

  // 1) 商品级品质列表:pageQuery 抓包(量小,全取),按 received_at 升序解析,同 mall+站点+productId 后写覆盖=最新
  const pageRows = optionalAllLocal(db, `
    SELECT mall_id, url, body_json, received_at
      FROM cloud.capture_events
     WHERE url_path = ? AND mall_id IS NOT NULL AND mall_id <> ''
     ORDER BY received_at ASC
  `, [QUALITY_PAGEQUERY_PATH]);
  const byKey = new Map();
  for (const ev of pageRows) {
    if (!includeTest && isTestMall(ev.mall_id)) continue;
    const site = qualitySiteFromUrl(ev.url);
    const j = _qParse(ev.body_json);
    const items = getQualityPageItems(j);
    for (const it of items) {
      const pid = it.productId != null ? String(it.productId) : (it.goodsId != null ? String(it.goodsId) : null);
      if (!pid) continue;
      byKey.set(String(ev.mall_id) + "|" + site + "|" + pid, { mall_id: String(ev.mall_id), site, received_at: ev.received_at, it });
    }
  }
  const rows = [];
  for (const { mall_id, site, received_at, it } of byKey.values()) {
    const d = dict.get(mall_id) || {};
    rows.push({
      mall_id, site, store_code: d.store_code || null, mall_name: d.mall_name || null, owner: d.owner || null,
      product_id: it.productId != null ? String(it.productId) : null,
      goods_id: it.goodsId != null ? String(it.goodsId) : null,
      product_name: it.productName || null,
      image_url: it.carouselImageUrl || null,
      category_name: it.categoryName || null,
      afs_score: _qNum(it.goodsAfsScore),
      afs_order_rate: _qNum(it.qltyAfsOrdrRate),
      afs_order_cnt: _qNum(it.qltyAfsOrdCnt),
      afs_problems: summarizeQualityProblems(it.problAfsItemList),
      rev_cnt: _qNum(it.revCnt),
      avg_rev_score: _qNum(it.avgRevScr),
      rev_problems: summarizeQualityProblems(it.problRevItemList),
      captured_at: received_at || null,
    });
  }
  // 品质分升序(最差排前),null(无分)排最后
  rows.sort((a, b) => {
    if (a.afs_score == null && b.afs_score == null) return 0;
    if (a.afs_score == null) return 1;
    if (b.afs_score == null) return -1;
    return a.afs_score - b.afs_score;
  });

  // 2) 店铺级 90 天指标:query 抓包,每店每站点保留最新一条
  const shopRows = optionalAllLocal(db, `
    SELECT mall_id, url, body_json, received_at
      FROM cloud.capture_events
     WHERE url_path = ? AND mall_id IS NOT NULL AND mall_id <> ''
     ORDER BY received_at ASC
  `, [QUALITY_SHOPMETRIC_PATH]);
  const shopByMall = new Map();
  for (const ev of shopRows) {
    if (!includeTest && isTestMall(ev.mall_id)) continue;
    const site = qualitySiteFromUrl(ev.url);
    const j = _qParse(ev.body_json);
    const r = j && j.result ? j.result : null;
    if (!r) continue;
    const d = dict.get(String(ev.mall_id)) || {};
    shopByMall.set(String(ev.mall_id) + "|" + site, {
      mall_id: String(ev.mall_id), site, store_code: d.store_code || null, mall_name: d.mall_name || null, owner: d.owner || null,
      afs_rate_90d: _qNum(r.qltyAfsOrdrRate90d),
      avg_score_90d: _qNum(r.avgScore90d),
      expect_loss: _qNum(r.expectLoss),
      captured_at: ev.received_at || null,
    });
  }
  const shops = Array.from(shopByMall.values());

  return { generated_at: Date.now(), row_count: rows.length, rows, shops, source: "cloud", attached: true };
}

// raw_json（同步时存的整条 review item）里捞 erp 表没单列存的字段：是否福利评价 + 晒图 URL。
// 福利评价 = 商家给好处换的好评，需要在前端标注区分；晒图是 C 端买家秀，一般是公开 CDN 图。
function parseReviewExtras(rawJson) {
  if (!rawJson) return { benefit: false, pictures: [] };
  let obj;
  try { obj = JSON.parse(rawJson); } catch { return { benefit: false, pictures: [] }; }
  const benefit = obj && (obj.isBenefitReview === true || obj.isBenefitReview === 1);
  const raw = obj && (obj.reviewPictures || obj.review_pictures || obj.reviewImageList || obj.images);
  const pictures = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p === "string") {
        if (/^https?:/i.test(p)) pictures.push(p);
      } else if (p && typeof p === "object") {
        const u = p.pictureUrl || p.url || p.imageUrl || p.thumbUrl || p.picUrl || p.image;
        if (typeof u === "string" && /^https?:/i.test(u)) pictures.push(u);
      }
      if (pictures.length >= 9) break;
    }
  }
  return { benefit: !!benefit, pictures };
}

// 运营工作台：商品评价（Chrome 扩展抓 /bg-luna-agent-seller/review/pageQuery → cloud → erp_temu_reviews）。
// 不走官方 API（官方无评价接口）。默认全部评价按时间倒序，前端按店铺/评分档/关键词筛选。
function buildReviews(db, options = {}) {
  const includeTest = !!options.includeTest;
  const limit = Math.min(10000, Math.max(50, Number(options.limit) || 3000));
  const rows = optionalAllLocal(db, `
    SELECT r.platform_shop_id AS mall_id, r.site, m.store_code, m.mall_name,
           r.review_id, r.product_id, r.product_skc_id, r.goods_id, r.goods_name,
           r.score, r.comment, r.comment_zh, r.spec_summary, r.category_path,
           r.status, r.on_sale, r.created_at_ts, r.raw_json
      FROM erp_temu_reviews r
      LEFT JOIN erp_temu_malls m ON m.mall_id = r.platform_shop_id
     WHERE 1=1
       ${includeTest ? "" : "AND COALESCE(m.status,'active') <> 'test'"}
     ORDER BY r.created_at_ts DESC, r.updated_at DESC
     LIMIT ?
  `, [limit]);
  let sum = 0;
  let scored = 0;
  let bad = 0;
  let withPic = 0;
  const out = rows.map((r) => {
    const score = r.score == null ? null : toNum(r.score);
    if (score != null) { sum += score; scored += 1; if (score <= 3) bad += 1; }
    const extras = parseReviewExtras(r.raw_json);
    if (extras.pictures.length) withPic += 1;
    return {
      mall_id: r.mall_id, site: r.site || null, store_code: r.store_code || null, mall_name: r.mall_name || null,
      review_id: r.review_id, product_id: r.product_id || null, product_skc_id: r.product_skc_id || null,
      goods_id: r.goods_id || null, goods_name: r.goods_name || null,
      score, comment: r.comment || null, comment_zh: r.comment_zh || null, spec_summary: r.spec_summary || null, category_path: r.category_path || null,
      status: r.status == null ? null : toNum(r.status), on_sale: r.on_sale == null ? null : toNum(r.on_sale),
      created_at_ts: r.created_at_ts == null ? null : toNum(r.created_at_ts),
      is_benefit: extras.benefit, pictures: extras.pictures,
    };
  });
  const summary = {
    total: out.length,
    avg_score: scored ? Number((sum / scored).toFixed(2)) : null,
    bad_count: bad,
    bad_rate: scored ? Number(((bad / scored) * 100).toFixed(1)) : null,
    pic_count: withPic,
  };
  try {
    const stmt = db.prepare("INSERT INTO op_task_state (task_key, status, owner, note, updated_at) VALUES (?, 'pending', NULL, ?, ?) ON CONFLICT(task_key) DO NOTHING");
    for (const r of out) {
      if (r.score != null && r.score <= 2) {
        const snippet = (r.comment_zh || r.comment || "").slice(0, 50);
        stmt.run(`review_alert|${r.mall_id}|${r.review_id}`, `差评(${r.score}分): ${snippet}`, Date.now());
      }
    }
  } catch (_) { /* op_task_state 表可能不存在 */ }
  return { generated_at: Date.now(), row_count: out.length, rows: out, summary, source: "extension" };
}

// 本地仓内库存报表（按店铺/账号聚合，数据源 = erp_inventory_batches 自有仓库）
function buildWarehouseInventory(db, options = {}) {
  const rows = optionalAllLocal(db,
    `SELECT
       b.account_id,
       acct.name AS account_name,
       COUNT(DISTINCT b.sku_id) AS sku_count,
       SUM(COALESCE(b.available_qty, 0))  AS available_qty,
       SUM(COALESCE(b.reserved_qty, 0))   AS reserved_qty,
       SUM(COALESCE(b.blocked_qty, 0))    AS blocked_qty,
       SUM(COALESCE(b.defective_qty, 0))  AS defective_qty,
       SUM(COALESCE(b.rework_qty, 0))     AS rework_qty,
       SUM(COALESCE(b.available_qty,0) + COALESCE(b.reserved_qty,0)
         + COALESCE(b.blocked_qty,0) + COALESCE(b.defective_qty,0)
         + COALESCE(b.rework_qty,0)) AS total_qty,
       SUM(
         COALESCE(sku.jst_cost_price, 0)
         * (COALESCE(b.available_qty,0) + COALESCE(b.reserved_qty,0)
           + COALESCE(b.blocked_qty,0) + COALESCE(b.defective_qty,0) + COALESCE(b.rework_qty,0))
       ) AS stock_value,
       COUNT(DISTINCT b.id) AS batch_count
     FROM erp_inventory_batches b
     LEFT JOIN erp_skus sku ON sku.id = b.sku_id
     LEFT JOIN erp_accounts acct ON acct.id = b.account_id
     WHERE (COALESCE(b.available_qty,0) + COALESCE(b.reserved_qty,0)
       + COALESCE(b.blocked_qty,0) + COALESCE(b.defective_qty,0)
       + COALESCE(b.rework_qty,0)) > 0
     GROUP BY b.account_id
     ORDER BY stock_value DESC`, []);

  const stores = rows.map((r) => ({
    account_id: r.account_id,
    account_name: r.account_name || null,
    sku_count: toNum(r.sku_count),
    available_qty: toNum(r.available_qty),
    reserved_qty: toNum(r.reserved_qty),
    blocked_qty: toNum(r.blocked_qty),
    defective_qty: toNum(r.defective_qty),
    rework_qty: toNum(r.rework_qty),
    total_qty: toNum(r.total_qty),
    stock_value: toNum(r.stock_value),
    batch_count: toNum(r.batch_count),
  }));

  const totalQty = stores.reduce((a, s) => a + s.total_qty, 0);
  const totalValue = stores.reduce((a, s) => a + s.stock_value, 0);
  const totalAvailable = stores.reduce((a, s) => a + s.available_qty, 0);
  const totalReserved = stores.reduce((a, s) => a + s.reserved_qty, 0);
  const totalSku = stores.reduce((a, s) => a + s.sku_count, 0);

  return {
    generated_at: Date.now(),
    store_count: stores.length,
    summary: { total_qty: totalQty, total_value: totalValue, available_qty: totalAvailable, reserved_qty: totalReserved, sku_count: totalSku },
    stores,
  };
}

// ─── 商品生命周期管线概览 ───────────────────────────────────────────────
// 实时计算每个 erp_skus 处于哪个生命周期阶段，返回按阶段分组的汇总 + 明细。
// 前端再合并云启侧(选品/核价)的数据，拼出完整 13 阶段管线。
const _pipelineCache = new Map();

// 商品全景概览入口:默认走「物化表 + 官方/cloud」快版,PIPELINE_USE_PANEL=0 回退旧实现。
function buildPipelineOverview(db, options = {}) {
  if (process.env.PIPELINE_USE_PANEL !== "0") return buildPipelineOverviewFast(db, options);
  return _buildPipelineOverviewLegacy(db, options);
}

// 商品全景「体检卡」数据底座:
//   主体 = 官方版商品面板(_buildProductPanelOfficialFresh,SPU 级,全店库存/销量/补货/缺货/在途/hot_tag);
//   增强 = cloud 流量/活动/限流/合规/申报价/评分(抓包,attach 成功才查,优雅降级);
//   阶段 = 官方生命周期(前半段) + 本地采购/入库(流转) + 销量/库存(后半段);
//   抽检 = 官方质检不合格(按 spu_id)。
// 维度统一:官方 salesv2 覆盖所有已建品(含 0 销量),故无需再 union erp_skus;纯选品(未建品)由前端云栖补。
function buildPipelineOverviewFast(db, options = {}) {
  if (!db) throw new Error("buildPipelineOverviewFast: db is required");
  if (!options.force) {
    const c = _pipelineCache.get("pf");
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }
  const includeTest = !!options.includeTest;

  // 1) 主体:官方版商品面板(全店权威库存/销量)
  const base = (_buildProductPanelOfficialFresh(db, { includeTest, force: true }).rows) || [];

  // 2) cloud 增强(attach 成功才查;失败则流量/活动/限流/合规留空,主体照常)
  const attachCloudDb = options.attachCloudDb;
  const cloudOk = typeof attachCloudDb === "function" && attachCloudDb(db) === true;
  const qualityMap = new Map(); // mall|pid -> {score,site,afs_order_rate}
  const flowMap = new Map();   // mall|pid -> {expose,click,conv,grow}
  const limSet = new Set();    // mall|pid 高价限流
  const actMap = new Map();    // mall|pid -> {act_cnt,min_price}
  const compMap = new Map();   // mall|pid -> compliance_status
  const enrichMap = new Map(); // mall|pid -> {declared,score,comments} (官方版没有,cloud 补)
  if (cloudOk) {
    const tid = options.tenantId || DEFAULT_CLOUD_TENANT;
    for (const f of optionalAllLocal(db, `
      WITH lf AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_product_flow_snapshot WHERE tenant_id = ? GROUP BY mall_id)
      SELECT f.mall_id, f.product_id, f.expose_num, f.click_num, f.expose_pay_conversion_rate, f.flow_grow_status
        FROM cloud.temu_product_flow_snapshot f JOIN lf ON lf.mall_id = f.mall_id AND lf.sd = f.stat_date
       WHERE f.product_id IS NOT NULL AND f.product_id <> ''`, [tid])) {
      flowMap.set(f.mall_id + "|" + f.product_id, { expose: toNum(f.expose_num), click: toNum(f.click_num), conv: f.expose_pay_conversion_rate == null ? null : Number(f.expose_pay_conversion_rate), grow: f.flow_grow_status || null });
    }
    for (const r of optionalAllLocal(db, `
      WITH lr AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_operation_risk_snapshot WHERE tenant_id = ? AND risk_type = 'high_price_flow' GROUP BY mall_id)
      SELECT DISTINCT r.mall_id, r.product_id FROM cloud.temu_operation_risk_snapshot r JOIN lr ON lr.mall_id = r.mall_id AND lr.sd = r.stat_date
       WHERE r.risk_type = 'high_price_flow' AND r.product_id IS NOT NULL AND r.product_id <> ''`, [tid])) {
      limSet.add(r.mall_id + "|" + r.product_id);
    }
    for (const a of optionalAllLocal(db, `
      WITH la AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_activity_snapshot WHERE tenant_id = ? GROUP BY mall_id)
      SELECT a.mall_id, a.product_id, COUNT(*) cnt, MIN(a.signup_price_cents) minp
        FROM cloud.temu_activity_snapshot a JOIN la ON la.mall_id = a.mall_id AND la.sd = a.stat_date
       WHERE a.product_id IS NOT NULL AND a.product_id <> '' AND a.signup_price_cents IS NOT NULL
       GROUP BY a.mall_id, a.product_id`, [tid])) {
      actMap.set(a.mall_id + "|" + a.product_id, { act_cnt: toNum(a.cnt), min_price: a.minp == null ? null : Number(a.minp) / 100 });
    }
    for (const c of optionalAllLocal(db, `
      SELECT mall_id, product_id, MAX(compliance_status) cs
        FROM cloud.skc_snapshots WHERE tenant_id = ? AND compliance_status IS NOT NULL AND product_id IS NOT NULL AND product_id <> ''
       GROUP BY mall_id, product_id`, [tid])) {
      compMap.set(c.mall_id + "|" + c.product_id, c.cs || null);
    }
    const latestQualityBySite = new Map();
    for (const ev of optionalAllLocal(db, `
      SELECT mall_id, url, body_json, received_at
        FROM cloud.capture_events
       WHERE url_path = ? AND mall_id IS NOT NULL AND mall_id <> ''
       ORDER BY received_at ASC`, [QUALITY_PAGEQUERY_PATH])) {
      const site = qualitySiteFromUrl(ev.url);
      const j = _qParse(ev.body_json);
      const items = getQualityPageItems(j);
      for (const it of items) {
        const productId = it.productId != null ? String(it.productId) : "";
        const goodsId = it.goodsId != null ? String(it.goodsId) : "";
        const pid = productId || goodsId;
        if (!pid) continue;
        const score = _qNum(it.goodsAfsScore);
        if (score == null) continue;
        latestQualityBySite.set(`${ev.mall_id}|${site}|${pid}`, {
          mall_id: String(ev.mall_id),
          product_id: productId || null,
          goods_id: goodsId || null,
          site,
          score,
          afs_order_rate: _qNum(it.qltyAfsOrdrRate),
        });
      }
    }
    const rememberQuality = (mallId, id, q) => {
      if (!id) return;
      const key = mallId + "|" + id;
      const prev = qualityMap.get(key);
      if (!prev || q.score < prev.score) qualityMap.set(key, q);
    };
    for (const q of latestQualityBySite.values()) {
      rememberQuality(q.mall_id, q.product_id, q);
      rememberQuality(q.mall_id, q.goods_id, q);
    }
    for (const s of optionalAllLocal(db, `
      WITH ls AS (SELECT mall_id, MAX(stat_date) sd FROM cloud.temu_sales_snapshot WHERE tenant_id = ? GROUP BY mall_id)
      SELECT s.mall_id, s.product_id, MIN(NULLIF(s.declared_price_cents,0)) dp, MAX(s.asf_score) score, MAX(s.comment_num) comments
        FROM cloud.temu_sales_snapshot s JOIN ls ON ls.mall_id = s.mall_id AND ls.sd = s.stat_date
       WHERE s.product_id IS NOT NULL AND s.product_id <> '' GROUP BY s.mall_id, s.product_id`, [tid])) {
      enrichMap.set(s.mall_id + "|" + s.product_id, { declared: s.dp ? Number(s.dp) / 100 : null, score: s.score == null ? null : Number(s.score), comments: s.comments == null ? null : toNum(s.comments) });
    }
  }

  // 3) 官方生命周期(按 product_skc_id),给前半段阶段(核价/上品中/已建品)用
  const lifeMap = new Map();
  for (const r of optionalAllLocal(db, `
    SELECT product_skc_id, status FROM erp_temu_openapi_records
     WHERE source = 'product_lifecycle' AND product_skc_id IS NOT NULL AND product_skc_id <> ''`, [])) {
    lifeMap.set(String(r.product_skc_id), String(r.status));
  }

  // 4) 官方质检(抽检):按 spu_id 聚合不合格(qc_result=2)
  const qcMap = new Map();
  for (const r of optionalAllLocal(db, `
    SELECT spu_id, COUNT(*) bad, SUM(COALESCE(defective_qty,0)) defective
      FROM erp_temu_openapi_qc WHERE qc_result = 2 AND spu_id IS NOT NULL AND spu_id <> ''
     GROUP BY spu_id`, [])) {
    qcMap.set(String(r.spu_id), { bad: toNum(r.bad), defective: toNum(r.defective) });
  }

  // 5) 本地采购/入库非终态 → 映射到 temu_product_id(SPU 维度,与主体对齐)
  const purchasingPids = new Set(optionalAllLocal(db, `
    SELECT DISTINCT sk.temu_product_id pid FROM erp_purchase_order_lines pol
      JOIN erp_purchase_orders po ON po.id = pol.po_id
      JOIN erp_skus sk ON sk.id = pol.sku_id
     WHERE po.status NOT IN ('inbounded','cancelled','closed') AND sk.temu_product_id IS NOT NULL AND sk.temu_product_id <> ''`, [])
    .map(r => String(r.pid)));
  const inboundPids = new Set(optionalAllLocal(db, `
    SELECT DISTINCT sk.temu_product_id pid FROM erp_inbound_receipt_lines irl
      JOIN erp_inbound_receipts ir ON ir.id = irl.receipt_id
      JOIN erp_skus sk ON sk.id = irl.sku_id
     WHERE ir.status NOT IN ('inbounded_pending_qc','cancelled') AND ir.status <> 'counted' AND sk.temu_product_id IS NOT NULL AND sk.temu_product_id <> ''`, [])
    .map(r => String(r.pid)));

  // 阶段判定(SPU 级,取最该处理的阶段)。生命周期码见 src/utils/temuSelectStatus.ts。
  const stageOf = (row, life) => {
    const s30 = (row.skus_detail || []).reduce((x, d) => x + (d.last30d || 0), 0);
    const hasSales = s30 > 0;
    if (hasSales && (toNum(row.advice) > 0 || toNum(row.lack_qty) > 0)) return "needs_restock";
    if (hasSales) return "selling";
    if (life === "7" || life === "9") return "pricing";
    if (life === "1" || life === "3" || life === "14" || life === "15") return "listing";
    if (purchasingPids.has(String(row.product_id))) return "purchasing";
    if (inboundPids.has(String(row.product_id))) return "inbound";
    if (toNum(row.stock) > 0) return "in_stock";
    if (life === "12") return "selling";
    return "created";
  };

  const STAGE_ORDER = ["selling", "needs_restock", "in_stock", "inbound", "purchasing", "created", "pricing", "listing"];
  const stages = {};
  for (const k of STAGE_ORDER) stages[k] = [];
  for (const row of base) {
    const k = row.mall_id + "|" + row.product_id;
    let life = null;
    if (row.skc_codes) { for (const skc of String(row.skc_codes).split(",")) { const st = lifeMap.get(skc.trim()); if (st) { life = st; break; } } }
    const flow = flowMap.get(k) || {};
    const act = actMap.get(k) || {};
    const enr = enrichMap.get(k) || {};
    const quality = qualityMap.get(k) || {};
    const qc = qcMap.get(String(row.product_id)) || {};
    const detail = row.skus_detail || [];
    const today = detail.reduce((x, d) => x + (d.today || 0), 0);
    const w7 = detail.reduce((x, d) => x + (d.last7d || 0), 0);
    const m30 = detail.reduce((x, d) => x + (d.last30d || 0), 0);
    const stage = stageOf(row, life);
    const out = {
      sku_id: row.product_id,
      sku_code: row.sku_codes ? String(row.sku_codes).split(",")[0] : (row.skc_codes || row.product_id),
      product_id: row.product_id, mall_id: row.mall_id, store_code: row.store_code || null, mall_name: row.mall_name || null,
      name: row.title || null, image: row.thumb || null, stage,
      today_sales: today, w7_sales: w7, m30_sales: m30,
      warehouse_stock: toNum(row.stock), occupy: toNum(row.occupy), unavail: toNum(row.unavail),
      shipping: toNum(row.shipping), total_stock: toNum(row.total_stock),
      advice_qty: toNum(row.advice), lack_qty: toNum(row.lack_qty),
      hot_tag: !!row.hot_tag, has_hot_sku: !!row.has_hot_sku, onsales_duration: row.onsales_duration == null ? null : toNum(row.onsales_duration),
      // cloud 增强(可能为空)
      expose: flow.expose == null ? null : flow.expose, click: flow.click == null ? null : flow.click,
      conv: flow.conv == null ? null : flow.conv, grow: flow.grow || null,
      limited: limSet.has(k), act_cnt: act.act_cnt || 0, act_min_price: act.min_price == null ? null : act.min_price,
      declared_price: enr.declared == null ? null : enr.declared,
      quality_score: quality.score == null ? null : quality.score,
      quality_site: quality.site || null,
      quality_afs_order_rate: quality.afs_order_rate == null ? null : quality.afs_order_rate,
      compliance: compMap.get(k) || null,
      lifecycle_status: life,
      qc_bad: qc.bad || 0, qc_defective: qc.defective || 0,
      review_count: enr.comments == null ? 0 : enr.comments, avg_score: enr.score == null ? null : enr.score,
      bad_reviews: 0, return_count: 0,
      // 兼容旧前端字段名
      local_available: toNum(row.stock), local_reserved: toNum(row.occupy),
      risk_tags: [],
    };
    out.risk_tags = _computePipelineRiskTags(out);
    (stages[stage] || (stages[stage] = [])).push(out);
  }

  const summary = {};
  for (const sKey of Object.keys(stages)) summary[sKey] = stages[sKey].length;
  const data = { generated_at: Date.now(), sku_count: base.length, summary, stages, source: cloudOk ? "official+cloud" : "official" };
  _pipelineCache.set("pf", { ts: Date.now(), data });
  return data;
}

// 体检卡风险标签(基于全景行字段)
function _computePipelineRiskTags(o) {
  const tags = [];
  if (o.lack_qty > 0 && o.advice_qty > 0 && o.warehouse_stock <= 0) tags.push("urgent_restock");
  else if (o.lack_qty > 0) tags.push("stock_out");
  if (o.limited) tags.push("limited");
  if (o.qc_bad > 0) tags.push("qc_fail");
  if (o.compliance && /(违规|缺失|待整改|不合规|风险|fail|invalid|risk)/i.test(String(o.compliance))) tags.push("compliance");
  if (o.avg_score != null && o.avg_score < 3) tags.push("low_score");
  return tags;
}

function _buildPipelineOverviewLegacy(db, options = {}) {
  if (!db) throw new Error("buildPipelineOverview: db is required");
  if (!options.force) {
    const c = _pipelineCache.get("p");
    if (c && Date.now() - c.ts < REPORT_CACHE_TTL_MS) return c.data;
  }

  // 1) 采购中的 SKU（PO 非终态）
  const purchasingSkus = new Set(
    optionalAllLocal(db, `
      SELECT DISTINCT pol.sku_id FROM erp_purchase_order_lines pol
      JOIN erp_purchase_orders po ON po.id = pol.po_id
      WHERE po.status NOT IN ('inbounded','cancelled','closed')`, [])
      .map(r => r.sku_id)
  );

  // 2) 入库中的 SKU（入库单非终态）
  const inboundSkus = new Set(
    optionalAllLocal(db, `
      SELECT DISTINCT irl.sku_id FROM erp_inbound_receipt_lines irl
      JOIN erp_inbound_receipts ir ON ir.id = irl.receipt_id
      WHERE ir.status NOT IN ('inbounded_pending_qc','cancelled')
        AND ir.status <> 'counted'`, [])
      .map(r => r.sku_id)
  );

  // 3) 本地库存 > 0 的 SKU
  const invMap = new Map();
  for (const r of optionalAllLocal(db, `SELECT sku_id, SUM(available_qty) aq, SUM(reserved_qty) rq FROM erp_inventory_batches GROUP BY sku_id`, [])) {
    if (toNum(r.aq) > 0 || toNum(r.rq) > 0) invMap.set(r.sku_id, { available: toNum(r.aq), reserved: toNum(r.rq) });
  }

  // 4) Temu 官方 salesv2 数据（按 ext_code→internal_sku_code 关联）
  const salesMap = new Map();
  for (const r of optionalAllLocal(db, `
    SELECT ext_code, mall_id, title, thumb_url,
           SUM(COALESCE(today_sales, 0)) today, SUM(COALESCE(last7d_sales, 0)) w7,
           SUM(COALESCE(last30d_sales, 0)) m30, SUM(COALESCE(warehouse_stock, 0)) wh,
           SUM(COALESCE(advice_qty, 0)) adv, SUM(COALESCE(lack_quantity, 0)) lack
      FROM erp_temu_openapi_sku_sales
     WHERE ext_code IS NOT NULL AND ext_code <> ''
     GROUP BY ext_code`, [])) {
    salesMap.set(r.ext_code, { mall_id: r.mall_id, title: r.title, thumb: r.thumb_url, today: toNum(r.today), w7: toNum(r.w7), m30: toNum(r.m30), wh: toNum(r.wh), adv: toNum(r.adv), lack: toNum(r.lack) });
  }

  // 5) 评价聚合（按 product_skc_id）
  const reviewMap = new Map();
  for (const r of optionalAllLocal(db, `
    SELECT product_skc_id, COUNT(*) cnt, AVG(score) avg_s,
           SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) bad
      FROM erp_temu_reviews WHERE product_skc_id IS NOT NULL AND product_skc_id <> ''
     GROUP BY product_skc_id`, [])) {
    reviewMap.set(r.product_skc_id, { count: toNum(r.cnt), avg_score: r.avg_s ? Math.round(r.avg_s * 10) / 10 : null, bad_count: toNum(r.bad) });
  }

  // 6) 售后退货聚合（按 internal_sku_code）
  const returnMap = new Map();
  for (const r of optionalAllLocal(db, `
    SELECT sku_code, COUNT(*) cnt FROM consign_after_sale_items
     WHERE sku_code IS NOT NULL AND sku_code <> ''
     GROUP BY sku_code`, [])) {
    returnMap.set(r.sku_code, toNum(r.cnt));
  }

  // 7) 遍历所有活跃 SKU，分配阶段
  const skus = optionalAllLocal(db, `
    SELECT id, internal_sku_code, product_name, image_url, temu_skc_id, temu_product_id, account_id, status
      FROM erp_skus WHERE status = 'active'`, []);

  const stages = {
    selling: [],
    needs_restock: [],
    in_stock: [],
    outbound: [],
    inbound: [],
    purchasing: [],
    created: [],
  };
  const STAGE_ORDER = ["selling", "needs_restock", "in_stock", "outbound", "inbound", "purchasing", "created"];

  for (const sku of skus) {
    const code = sku.internal_sku_code;
    const s = salesMap.get(code);
    const inv = invMap.get(sku.id);
    const rev = reviewMap.get(sku.temu_skc_id);
    const retCnt = returnMap.get(code) || 0;

    let stage;
    if (s && s.m30 > 0 && s.adv > 0) stage = "needs_restock";
    else if (s && s.m30 > 0) stage = "selling";
    else if (inv) stage = "in_stock";
    else if (inboundSkus.has(sku.id)) stage = "inbound";
    else if (purchasingSkus.has(sku.id)) stage = "purchasing";
    else stage = "created";

    const row = {
      sku_id: sku.id,
      sku_code: code,
      name: (s && s.title) || sku.product_name,
      image: (s && s.thumb) || sku.image_url,
      stage,
      today_sales: s ? s.today : null,
      w7_sales: s ? s.w7 : null,
      m30_sales: s ? s.m30 : null,
      warehouse_stock: s ? s.wh : null,
      advice_qty: s ? s.adv : null,
      local_available: inv ? inv.available : 0,
      local_reserved: inv ? inv.reserved : 0,
      review_count: rev ? rev.count : 0,
      avg_score: rev ? rev.avg_score : null,
      bad_reviews: rev ? rev.bad_count : 0,
      return_count: retCnt,
      risk_tags: _computeRiskTags(s, rev, retCnt, s ? s.m30 : 0),
    };
    stages[stage].push(row);
  }

  const summary = {};
  for (const st of STAGE_ORDER) summary[st] = stages[st].length;

  const data = { generated_at: Date.now(), sku_count: skus.length, summary, stages };
  _pipelineCache.set("p", { ts: Date.now(), data });
  return data;
}

function _computeRiskTags(sales, review, returnCount, m30Sales) {
  const tags = [];
  if (review && review.avg_score !== null && review.avg_score < 3) tags.push("low_score");
  if (review && review.bad_count >= 3) tags.push("many_bad_reviews");
  if (m30Sales > 0 && returnCount > 0 && returnCount / m30Sales > 0.05) tags.push("high_return_rate");
  if (sales && sales.lack > 0) tags.push("stock_out");
  if (sales && sales.adv > 0 && sales.wh <= 0) tags.push("urgent_restock");
  return tags;
}

// 单品风险标签查询（给商品面板用）
function buildProductRiskTags(db, options = {}) {
  if (!db) throw new Error("buildProductRiskTags: db is required");
  const skuCode = options.skuCode;
  const skuCodes = skuCode ? [skuCode] : (options.skuCodes || []);
  if (!skuCodes.length) return { generated_at: Date.now(), rows: [] };

  const ph = skuCodes.map(() => "?").join(",");

  const salesRows = optionalAllLocal(db, `
    SELECT ext_code, SUM(COALESCE(last30d_sales, 0)) m30, SUM(COALESCE(advice_qty, 0)) adv,
           SUM(COALESCE(lack_quantity, 0)) lack, SUM(COALESCE(warehouse_stock, 0)) wh
      FROM erp_temu_openapi_sku_sales WHERE ext_code IN (${ph}) GROUP BY ext_code`, skuCodes);
  const sm = new Map(salesRows.map(r => [r.ext_code, r]));

  const skuRows = optionalAllLocal(db, `SELECT id, internal_sku_code, temu_skc_id FROM erp_skus WHERE internal_sku_code IN (${ph})`, skuCodes);
  const skcIds = skuRows.map(r => r.temu_skc_id).filter(Boolean);

  let revMap = new Map();
  if (skcIds.length) {
    const ph2 = skcIds.map(() => "?").join(",");
    const revRows = optionalAllLocal(db, `
      SELECT product_skc_id, COUNT(*) cnt, AVG(score) avg_s, SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) bad
        FROM erp_temu_reviews WHERE product_skc_id IN (${ph2}) GROUP BY product_skc_id`, skcIds);
    revMap = new Map(revRows.map(r => [r.product_skc_id, r]));
  }

  const retRows = optionalAllLocal(db, `SELECT sku_code, COUNT(*) cnt FROM consign_after_sale_items WHERE sku_code IN (${ph}) GROUP BY sku_code`, skuCodes);
  const retM = new Map(retRows.map(r => [r.sku_code, toNum(r.cnt)]));

  const rows = skuRows.map(sku => {
    const s = sm.get(sku.internal_sku_code);
    const rev = revMap.get(sku.temu_skc_id);
    const retCnt = retM.get(sku.internal_sku_code) || 0;
    const m30 = s ? toNum(s.m30) : 0;
    return {
      sku_code: sku.internal_sku_code,
      risk_tags: _computeRiskTags(
        s ? { lack: toNum(s.lack), adv: toNum(s.adv), wh: toNum(s.wh) } : null,
        rev ? { avg_score: rev.avg_s ? Math.round(rev.avg_s * 10) / 10 : null, bad_count: toNum(rev.bad) } : null,
        retCnt, m30
      ),
    };
  });

  return { generated_at: Date.now(), rows };
}

module.exports = {
  buildMultiStoreReport,
  buildWarehouseInventory,
  buildOpenapiQc,
  buildFirstShipToday,
  buildGoodsCreatedToday,
  buildQualityPanel,
  buildReviews,
  fetchQcFlawImages,
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
  buildHighPriceFlowList,
  buildProductSalesTrend,
  setMallOwner,
  listOpTaskState,
  setOpTaskState,
  createEnrollTasks,
  pollEnrollResults,
  // 结算收入（income-summary 抓包物化）：采集入口 + 报表聚合
  upsertSettlementIncomeFromDashboard,
  syncSettlementIncomeFromCapture,
  syncSettlementDetailFromCapture,
  buildSettlementIncomeByMall,
  buildSettlementDetailByMall,
  ensureSettlementIncomeSchema,
  ensureSettlementDetailSchema,
  // 对账中心账务明细（费用采集）+ 结算报表独立查询
  syncFundDetailFromCapture,
  buildFundDetailByMall,
  ensureFundDetailSchema,
  syncSettlementOrderDetailFromCapture,
  ensureSettlementOrderDetailSchema,
  syncFundSummaryFromCapture,
  ensureFundSummarySchema,
  buildFundSummaryByMall,
  buildSettlementRiskByMall,
  // EPR 费用 / 资金限制 / 违规处罚（聚协云 P1+P2 对标）
  syncEprFeeFromCapture,
  ensureEprFeeSchema,
  buildEprFeeByMall,
  syncFundFrozenFromCapture,
  ensureFundFrozenSchema,
  buildFundFrozenByMall,
  syncAccountOverviewFromCapture,
  ensureAccountOverviewSchema,
  buildAccountOverviewByMall,
  syncFulfillmentBillFromCapture,
  ensureFulfillmentBillSchema,
  buildFulfillmentBillByMall,
  syncViolationFromCapture,
  ensureViolationSchema,
  buildViolationByMall,
  querySettlementData,
  clearMultiStoreReportCache,
  buildPipelineOverview,
  buildPipelineOverviewFast,
  buildProductRiskTags,
  // 暴露给测试用
  _internal: {
    fetchCloudReport, readMallDictionary, loginCloud,
    buildFinancialsByMall, buildSettlementProfitByMall, buildByStoreLocal, shiftDate,
    ensureSettlementIncomeSchema, ensureSettlementDetailSchema,
    extractSettlementIncomeRows, upsertSettlementIncomeFromDashboard,
    syncSettlementIncomeFromCapture, buildSettlementIncomeByMall, emptySettlement,
    extractSettlementIncomeListFromCaptureBody,
    buildSettlementDetailRowsFromCaptureEvent, syncSettlementDetailFromCapture,
    buildSettlementDetailByMall, emptySettlementDetail,
    extractSettlementDetailListFromCaptureBody, SETTLEMENT_DETAIL_PATHS,
    SETTLEMENT_INCOME_PATH, FUND_DETAIL_PATH, SETTLEMENT_ORDER_DETAIL_PATH,
    buildFundDetailRowsFromCaptureEvent, upsertFundDetailRows,
    syncFundDetailFromCapture, buildFundDetailByMall,
    ensureSettlementOrderDetailSchema, extractSettlementOrderDetailRowsFromCaptureBody,
    buildSettlementOrderDetailRowsFromCaptureEvent, upsertSettlementOrderDetailRows,
    syncSettlementOrderDetailFromCapture,
    FUND_SUMMARY_PATHS, extractFundSummaryListFromCaptureBody,
    buildFundSummaryRowsFromCaptureEvent, upsertFundSummaryRows,
    syncFundSummaryFromCapture, buildFundSummaryByMall, buildSettlementRiskByMall,
    EPR_FEE_PATHS, buildEprFeeRowsFromCaptureEvent, upsertEprFeeRows,
    syncEprFeeFromCapture, buildEprFeeByMall,
    FUND_FROZEN_PATH, buildFundFrozenRowsFromCaptureEvent,
    syncFundFrozenFromCapture, buildFundFrozenByMall,
    ACCOUNT_OVERVIEW_PATH, buildAccountOverviewRow,
    syncAccountOverviewFromCapture, buildAccountOverviewByMall,
    FULFILLMENT_PATHS, buildFulfillmentDetailRow, buildFulfillmentOverviewRow,
    syncFulfillmentBillFromCapture, buildFulfillmentBillByMall,
    VIOLATION_LIST_PATH, VIOLATION_SUMMARY_PATH, buildViolationRowsFromCaptureEvent,
    syncViolationFromCapture, buildViolationByMall,
  },
};
