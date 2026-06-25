/**
 * TEMU「今日创建商品」采集 + 物化(各店概览「今日创建」列)。
 *
 * 数据源:bg.glo.goods.list.get(PA 网关) 按 createdAtStart/End=当天(北京)拉今天创建的商品。
 * 实测 createdAt=创建时间(非上架);一行=某店某天创建的一个 SKC(product_skc_id 去重)。
 * 物化 erp_temu_goods_created_daily(mig078),按 (mall_id, stat_date, product_skc_id) 唯一。
 * 凭证按店从 erp_temu_openapi_auth 读(全托管 active, semi_managed=0)。纯本地 erp.sqlite。
 * 供 scripts/refresh-openapi-goods-created.cjs(cron) 调用;纯函数导出供测试。
 */
"use strict";

const { callOpenApi } = require("../temuOpenApiClient.cjs");
const { queryAll, withTransaction} = require("../../db/connection.cjs");

const PAGE_SIZE = 100;
const MAX_PAGES = 100; // 今天创建的量小,分页上限防 runaway
const MIN_INTERVAL_MS = 400;
const MAX_RETRIES = 4;
const BJ = 8 * 3600000,DAY = 86400000;

function s(v) {return v == null ? null : String(v);}
function sleep(ms) {return new Promise((r) => setTimeout(r, ms));}

let lastCallAt = 0;
async function throttle() {
  const w = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (w > 0) await sleep(w);
  lastCallAt = Date.now();
}

async function callRetry(params) {
  let lastMsg = "";
  for (let i = 0; i <= MAX_RETRIES; i += 1) {
    await throttle();
    let response = null;
    try {({ response } = await callOpenApi(params));} catch (e) {response = { errorMsg: String(e && e.message || e) };}
    if (response && response.success === true) return response;
    const code = response && response.errorCode;
    lastMsg = response && response.errorMsg || `errorCode=${code}`;
    const retriable = !response || code === 4000000 || /SYSTEM_EXCEPTION|limit|frequent|频繁|rate|timeout|超时|null|empty/i.test(lastMsg);
    if (i < MAX_RETRIES && retriable) {await sleep(1000 * (i + 1));continue;}
    throw new Error(`${params.type} 失败: ${lastMsg}`);
  }
  throw new Error(`${params.type} 重试失败: ${lastMsg}`);
}

function bjDayStart(dayOffset = 0) {const todayStart = Math.floor((Date.now() + BJ) / DAY) * DAY - BJ;return todayStart + dayOffset * DAY;}
function bjDateStr(ms) {return new Date(ms + BJ).toISOString().slice(0, 10);}

// 采集单店「指定日创建的商品」(按 SKC 去重)。导出供测试。
async function collectGoodsCreatedForMall(db, mall, opts = {}) {
  // bg.glo.* 走 PA 网关(实测 region:"PA" + CN 全托 token 可用)
  const cred = { appKey: mall.app_key, appSecret: mall.app_secret, accessToken: mall.access_token, region: "PA" };
  const dayOffset = opts.dayOffset || 0;
  const from = bjDayStart(dayOffset);
  const to = dayOffset === 0 ? Date.now() : from + DAY - 1;
  const statDate = bjDateStr(from);
  const maxPages = opts.maxPages || MAX_PAGES;
  const seen = new Map();
  for (let page = 1; page <= maxPages; page += 1) {
    const resp = await callRetry({
      type: "bg.glo.goods.list.get", ...cred,
      bizParams: { createdAtStart: from, createdAtEnd: to, pageSize: PAGE_SIZE, page },
      timeoutMs: 30000
    });
    const result = resp.result || {};
    const list = Array.isArray(result.data) ? result.data : [];
    for (const it of list) {
      const skc = s(it.productSkcId);
      if (!skc || seen.has(skc)) continue;
      seen.set(skc, {
        mall_id: mall.mall_id, stat_date: statDate, product_skc_id: skc,
        product_id: s(it.productId),
        skc_site_status: it.skcSiteStatus != null ? Number(it.skcSiteStatus) : null,
        created_at: it.createdAt != null ? Number(it.createdAt) : null
      });
    }
    if (list.length < PAGE_SIZE) break;
  }
  return [...seen.values()];
}

const UPSERT_SQL = `INSERT INTO erp_temu_goods_created_daily
  (mall_id,stat_date,product_skc_id,product_id,skc_site_status,created_at,synced_at)
  VALUES (@mall_id,@stat_date,@product_skc_id,@product_id,@skc_site_status,@created_at,@synced_at)
  ON CONFLICT(mall_id,stat_date,product_skc_id) DO UPDATE SET
    product_id=excluded.product_id, skc_site_status=excluded.skc_site_status, created_at=excluded.created_at, synced_at=excluded.synced_at`;

async function upsertGoodsCreated(db, rows) {
  if (!rows.length) return 0;
  const now = new Date().toISOString();await withTransaction(db,

    async (txDb) => {const list =
      rows;for (const r of list) await execute(txDb, UPSERT_SQL, { ...r, synced_at: now });});
  return rows.length;
}

async function refreshGoodsCreatedAll(db, opts = {}) {
  const malls = await queryAll(db,
  "SELECT mall_id, mall_name, region, app_key, app_secret, access_token FROM erp_temu_openapi_auth WHERE status='active' AND semi_managed=0");

  let total = 0;
  const perMall = [];
  const errors = [];
  for (const m of malls) {
    try {
      const rows = await collectGoodsCreatedForMall(db, m, opts);
      const n = await upsertGoodsCreated(db, rows);
      total += n;
      if (n > 0) perMall.push({ mall: m.mall_id, created: n });
    } catch (e) {
      errors.push({ mall: m.mall_id, error: e && e.message || String(e) });
    }
  }
  return { malls: malls.length, created: total, perMall, errors };
}

module.exports = { refreshGoodsCreatedAll, collectGoodsCreatedForMall, upsertGoodsCreated, bjDayStart, bjDateStr };