// 独立高频 cron：只采 sales 源（全店）+ 立即物化到 erp_temu_openapi_sku_sales。
// 用法: */30 * * * * cd /opt/temu-automation && node scripts/cron-refresh-sales.cjs >> /var/log/temu-sales-refresh.log 2>&1
"use strict";

const Database = require("better-sqlite3");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");

const { callOpenApi, resolveTemuAppCredentials } = require("../electron/erp/temuOpenApiClient.cjs");

const PAGE_SIZE = 20;
const MAX_PAGES = 1500;
const MIN_INTERVAL_MS = 600;
const MAX_RETRIES = 5;

function nowIso() { return new Date().toISOString(); }
function s(v) { return v == null ? null : String(v); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let lastCallAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function callRetry(params) {
  let lastMsg = "";
  for (let i = 0; i <= MAX_RETRIES; i += 1) {
    await throttle();
    let response = null;
    try { ({ response } = await callOpenApi(params)); } catch (e) { response = { errorMsg: String(e?.message || e) }; }
    if (response && response.success === true) return response;
    const code = response && response.errorCode;
    lastMsg = (response && response.errorMsg) || `errorCode=${code}`;
    const retriable = code === 4000000 || /SYSTEM_EXCEPTION|limit|frequent|频繁|rate|timeout|超时/i.test(lastMsg);
    if (i < MAX_RETRIES && retriable) { await sleep(1000 * (i + 1)); continue; }
    throw new Error(`salesv2 失败: ${lastMsg}`);
  }
  throw new Error(`salesv2 重试失败: ${lastMsg}`);
}

const SALES_COLLECTOR = {
  source: "sales",
  type: "bg.goods.salesv2.get",
  region: "CN",
  listOf: (r) => r.subOrderList,
  map: (it) => ({
    record_key: s(it.skcExtCode || it.productSkcId),
    product_id: s(it.productId),
    product_skc_id: s(it.productSkcId),
    ext_code: s(it.skcExtCode),
    status: s(it.supplyStatus),
    biz_time: s(it.expectNormalSupplyTime),
  }),
};

function replaceSourceRecords(mallId, rows, now) {
  const del = db.prepare("DELETE FROM erp_temu_openapi_records WHERE mall_id = ? AND source = 'sales'");
  const ins = db.prepare(`
    INSERT INTO erp_temu_openapi_records
      (mall_id, source, seq, record_key, product_id, product_skc_id, ext_code, status, biz_time, raw_json, synced_at)
    VALUES (@mall_id,'sales',@seq,@record_key,@product_id,@product_skc_id,@ext_code,@status,@biz_time,@raw,@now)
  `);
  const tx = db.transaction(() => {
    del.run(mallId);
    rows.forEach((row, seq) => {
      ins.run({
        mall_id: mallId, seq,
        record_key: row.record_key ?? null,
        product_id: row.product_id ?? null,
        product_skc_id: row.product_skc_id ?? null,
        ext_code: row.ext_code ?? null,
        status: row.status ?? null,
        biz_time: row.biz_time ?? null,
        raw: row.raw,
        now,
      });
    });
  });
  tx();
}

async function collectSalesOneMall(mallRow) {
  const mallId = mallRow.mall_id;
  if (!mallRow.access_token) throw new Error(`店铺 ${mallId} 无 access_token`);
  const { appKey, appSecret } = resolveTemuAppCredentials({ appKey: mallRow.app_key, appSecret: mallRow.app_secret });
  const creds = { appKey, appSecret, accessToken: mallRow.access_token };

  const rows = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    if (pageNo > 1 && pageNo % 10 === 1) await sleep(4000);
    const response = await callRetry({
      type: SALES_COLLECTOR.type, ...creds, region: SALES_COLLECTOR.region,
      bizParams: { pageNo, pageSize: PAGE_SIZE },
    });
    const items = SALES_COLLECTOR.listOf(response.result || {}) || [];
    if (!items.length) break;
    for (const it of items) rows.push({ ...SALES_COLLECTOR.map(it), raw: JSON.stringify(it) });
    if (items.length < PAGE_SIZE) break;
  }
  replaceSourceRecords(mallId, rows, nowIso());
  return rows.length;
}

async function main() {
  const t0 = Date.now();
  const malls = db.prepare(`
    SELECT * FROM erp_temu_openapi_auth
    WHERE status='active' AND access_token IS NOT NULL AND access_token <> ''
    ORDER BY updated_at DESC
  `).all();

  console.log(nowIso(), `[sales-refresh] 开始采集 ${malls.length} 店`);
  const results = [];
  for (const m of malls) {
    try {
      const count = await collectSalesOneMall(m);
      results.push({ mallId: m.mall_id, ok: true, count });
    } catch (e) {
      results.push({ mallId: m.mall_id, ok: false, error: String(e?.message || e) });
    }
    await sleep(2000);
  }

  // 立即物化
  const { refreshSkuSalesAll } = require("../electron/erp/services/temuOpenApiSkuSales.cjs");
  const matResult = refreshSkuSalesAll(db);
  const elapsed = Date.now() - t0;
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  console.log(nowIso(), `[sales-refresh] 完成: ${okCount}成功 ${failCount}失败, 物化=${JSON.stringify(matResult)}, 耗时${elapsed}ms`);
  if (failCount) console.log(nowIso(), `[sales-refresh] 失败详情:`, results.filter(r => !r.ok));
  db.close();
}

main().catch(e => {
  console.error(nowIso(), "[sales-refresh] 致命错误:", e);
  db.close();
  process.exitCode = 1;
});
