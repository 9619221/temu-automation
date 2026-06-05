/**
 * TEMU「今日首单发货」采集 + 物化(运营工作台总览统计卡)。
 *
 * 数据源(现有授权内,无需申请):bg.shiporderv2.get
 *   - 按发货时间 deliverTimeFrom/To 拉某天发出的发货单(分页)
 *   - 首单标识:item.subPurchaseOrderBasicVO.isFirst === true
 *   - 去重键:item.subPurchaseOrderSn(采购子单号 WB,一个首单可能拆多个发货单/包裹)
 *
 * 物化到 erp_temu_firstship_daily(mig077),按 (mall_id, stat_date, sub_purchase_order_sn) 唯一。
 * 凭证按店从 erp_temu_openapi_auth 读(全托管 active, semi_managed=0)。纯本地 erp.sqlite,不触 cloud。
 * 供 scripts/refresh-openapi-firstship.cjs(cron) 调用;纯函数导出供测试。
 *
 * 注:实测该接口偶发返回 success=false / 空(限流),callRetry 退避重试解决——否则单次跑会漏店、数偏小。
 */
"use strict";

const { callOpenApi } = require("../temuOpenApiClient.cjs");

const PAGE_SIZE = 100;
const MAX_PAGES = 200;          // 分页上限(防 runaway;每店一天首单量很小)
const MIN_INTERVAL_MS = 400;    // 全局节流
const MAX_RETRIES = 4;
const BJ = 8 * 3600000, DAY = 86400000;

function s(v) { return v == null ? null : String(v); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let lastCallAt = 0;
async function throttle() {
  const w = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (w > 0) await sleep(w);
  lastCallAt = Date.now();
}

// 带节流 + 限流重试退避的调用。成功返回 response,彻底失败抛错。
async function callRetry(params) {
  let lastMsg = "";
  for (let i = 0; i <= MAX_RETRIES; i += 1) {
    await throttle();
    let response = null;
    try { ({ response } = await callOpenApi(params)); } catch (e) { response = { errorMsg: String((e && e.message) || e) }; }
    if (response && response.success === true) return response;
    const code = response && response.errorCode;
    lastMsg = (response && response.errorMsg) || `errorCode=${code}`;
    const retriable = !response || code === 4000000 || /SYSTEM_EXCEPTION|limit|frequent|频繁|rate|timeout|超时|null|empty/i.test(lastMsg);
    if (i < MAX_RETRIES && retriable) { await sleep(1000 * (i + 1)); continue; }
    throw new Error(`${params.type} 失败: ${lastMsg}`);
  }
  throw new Error(`${params.type} 重试失败: ${lastMsg}`);
}

// 北京时区某天 0 点的真实 UTC ms(dayOffset 0=今天, -1=昨天)。导出供测试/cron。
function bjDayStart(dayOffset = 0) {
  const todayStart = Math.floor((Date.now() + BJ) / DAY) * DAY - BJ;
  return todayStart + dayOffset * DAY;
}
// 北京时区日期串 YYYY-MM-DD。导出供测试。
function bjDateStr(ms) { return new Date(ms + BJ).toISOString().slice(0, 10); }

// 采集单店「指定日发货的首单」(按 WB 去重)。返回待 upsert 行数组。导出供测试。
async function collectFirstShipForMall(db, mall, opts = {}) {
  const cred = { appKey: mall.app_key, appSecret: mall.app_secret, accessToken: mall.access_token, region: mall.region || "CN" };
  const dayOffset = opts.dayOffset || 0;
  const from = bjDayStart(dayOffset);
  const to = dayOffset === 0 ? Date.now() : from + DAY - 1;
  const statDate = bjDateStr(from);
  const maxPages = opts.maxPages || MAX_PAGES;
  const seen = new Map(); // sub_purchase_order_sn -> row(一个首单多发货单只取首条)
  for (let page = 1; page <= maxPages; page += 1) {
    const resp = await callRetry({
      type: "bg.shiporderv2.get", ...cred,
      bizParams: { deliverTimeFrom: from, deliverTimeTo: to, pageSize: PAGE_SIZE, pageNo: page },
      timeoutMs: 30000,
    });
    const result = resp.result || {};
    const list = Array.isArray(result.list) ? result.list : [];
    for (const it of list) {
      const vo = it.subPurchaseOrderBasicVO;
      if (!(vo && vo.isFirst === true)) continue;     // 只要首单
      const sn = s(it.subPurchaseOrderSn);
      if (!sn || seen.has(sn)) continue;              // 按 WB 去重
      seen.set(sn, {
        mall_id: mall.mall_id, stat_date: statDate, sub_purchase_order_sn: sn,
        delivery_order_sn: s(it.deliveryOrderSn),
        product_skc_id: s(it.productSkcId),
        ext_code: (it.skcExtCode != null && String(it.skcExtCode).trim() !== "") ? String(it.skcExtCode) : null,
        deliver_time: it.deliverTime != null ? Number(it.deliverTime) : null,
      });
    }
    if (list.length < PAGE_SIZE) break;               // 不满一页 = 到底(不依赖偶发缺失的 total)
  }
  return [...seen.values()];
}

const UPSERT_SQL = `INSERT INTO erp_temu_firstship_daily
  (mall_id,stat_date,sub_purchase_order_sn,delivery_order_sn,product_skc_id,ext_code,deliver_time,synced_at)
  VALUES (@mall_id,@stat_date,@sub_purchase_order_sn,@delivery_order_sn,@product_skc_id,@ext_code,@deliver_time,@synced_at)
  ON CONFLICT(mall_id,stat_date,sub_purchase_order_sn) DO UPDATE SET
    delivery_order_sn=excluded.delivery_order_sn, product_skc_id=excluded.product_skc_id,
    ext_code=excluded.ext_code, deliver_time=excluded.deliver_time, synced_at=excluded.synced_at`;

// upsert 一批首单行。返回写入行数。导出供测试。
function upsertFirstShip(db, rows) {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const stmt = db.prepare(UPSERT_SQL);
  const tx = db.transaction((list) => { for (const r of list) stmt.run({ ...r, synced_at: now }); });
  tx(rows);
  return rows.length;
}

// 刷新所有全托管 active 店「指定日(默认今天)首单发货」。返回汇总。
async function refreshFirstShipAll(db, opts = {}) {
  const malls = db.prepare(
    "SELECT mall_id, mall_name, region, app_key, app_secret, access_token FROM erp_temu_openapi_auth WHERE status='active' AND semi_managed=0"
  ).all();
  let totalFirst = 0;
  const perMall = [];
  const errors = [];
  for (const m of malls) {
    try {
      const rows = await collectFirstShipForMall(db, m, opts);
      const n = upsertFirstShip(db, rows);
      totalFirst += n;
      if (n > 0) perMall.push({ mall: m.mall_id, first: n });
    } catch (e) {
      errors.push({ mall: m.mall_id, error: (e && e.message) || String(e) });
    }
  }
  return { malls: malls.length, first: totalFirst, perMall, errors };
}

module.exports = { refreshFirstShipAll, collectFirstShipForMall, upsertFirstShip, bjDayStart, bjDateStr };
