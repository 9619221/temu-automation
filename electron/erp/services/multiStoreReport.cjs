// 多店报表服务：fetch 云端 /api/dashboard/report/by-store + join 本地 erp_temu_malls
// 输出按 store_code 排序的店铺指标列表，供桌面端报表页消费
//
// host 模式：ipc.cjs 直调；client 模式：lanServer 暴露路由让 client 远程调

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
      SELECT mall_id, mall_name, store_code, site, status, remark
      FROM erp_temu_malls
    `).all();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ""))) return [];
    throw error;
  }
}

// 主入口：返回 { generated_at, store_count, stores: [...], unmapped: [...] }
async function buildMultiStoreReport(db, options = {}) {
  if (!db) throw new Error("multiStoreReport: db is required (host mode only)");
  const cloud = await fetchCloudReport({ includeTest: options.includeTest });
  const dict = readMallDictionary(db);
  const dictByMall = new Map(dict.map((row) => [row.mall_id, row]));

  const stores = [];
  const unmapped = [];
  for (const s of cloud.stores || []) {
    const dictRow = dictByMall.get(s.mall_id);
    const enriched = {
      ...s,
      store_code: dictRow?.store_code || null,
      store_status: dictRow?.status || "unknown",
      dict_remark: dictRow?.remark || null,
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
    stores,
    unmapped, // 云端有数据但本地字典没登记的（应该提醒用户去 seed）
  };
}

module.exports = {
  buildMultiStoreReport,
  // 暴露给测试用
  _internal: { fetchCloudReport, readMallDictionary, loginCloud },
};
