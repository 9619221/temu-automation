/**
 * Temu 官方开放平台「多源采集」：采购单/发货单/销售/售后/库存。
 *
 * 落通用快照表 erp_temu_openapi_records(mall_id, source, seq, ...)，每源每次 delete+重插。
 * 与商品主数据(erp_temu_openapi_products，独立模块 temuOpenApiProductSync.cjs)互补。
 *
 * 网关/参数实测依据(2026-06-02, 063店铺)：
 *  - 采购单 bg.purchaseorderv2.get(CN)     pageNo/pageSize → result.total + subOrderForSupplierList[]
 *  - 发货单 bg.shiporderv2.get(CN)         pageNo/pageSize → result.total + list[]
 *  - 销售   bg.goods.salesv2.get(CN)        pageNo/pageSize → result.total + subOrderList[](带 skcExtCode)
 *  - 售后   bg.refund.returnpackagelist.get(CN) outboundTimeStart/End(≤31天) + pageNo/pageSize
 *  - 库存   bg.qtg.stock.virtualinventoryjit.get(PA) 逐 productSkcId(不支持批量) → result.productSkuStockList[]
 */
"use strict";

const { callOpenApi, resolveTemuAppCredentials } = require("../temuOpenApiClient.cjs");

const PAGE_SIZE = 20;                     // 实测各接口 pageSize 上限不同(发货≤20,>20报SYSTEM_EXCEPTION)，取 20 通用安全
const MAX_PAGES = 1500;
const RETURN_WINDOW_DAYS = 30;            // 售后出库时间窗口（接口限 ≤31 天）
const MAX_INVENTORY_SKCS = 20000;         // 库存逐 SKC 调用上限（防 runaway）
const INVENTORY_CONCURRENCY = 8;          // 库存接口(PA)限流宽松，实测并发10无失败，取8并发提速~10倍
const MIN_INTERVAL_MS = 600;              // 全局节流（SYSTEM_EXCEPTION 间歇触发，放慢更稳）
const MAX_RETRIES = 5;
const INTER_COLLECTOR_PAUSE_MS = 4000;    // 源间停顿，让限流桶回血（避免上一源耗光桶导致下一源持续限流）

function nowIso() { return new Date().toISOString(); }
function s(v) { return v == null ? null : String(v); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let lastCallAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

// 带节流 + 限流重试退避的调用。成功返回 response，彻底失败抛错。
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
    throw new Error(`${params.type} 失败: ${lastMsg}`);
  }
  throw new Error(`${params.type} 重试失败: ${lastMsg}`);
}

// ===== 列表型采集源注册表 =====
const LIST_COLLECTORS = [
  {
    source: "purchase_order",
    type: "bg.purchaseorderv2.get",
    region: "CN",
    listOf: (r) => r.subOrderForSupplierList,
    map: (it) => ({
      record_key: s(it.originalPurchaseOrderSn || it.subPurchaseOrderSn),
      product_id: s(it.productId),
      product_skc_id: s(it.productSkcId),
      ext_code: s(it.skcExtCode || it.extCode),
      status: s(it.fulfilmentFormStatus || it.status),
      biz_time: s(it.purchaseTime || it.createTime),
    }),
  },
  {
    source: "ship_order",
    type: "bg.shiporderv2.get",
    region: "CN",
    listOf: (r) => r.list,
    map: (it) => ({
      record_key: s(it.expressDeliverySn || it.deliveryOrderSn),
      product_id: s(it.productId),
      product_skc_id: s(it.productSkcId),
      ext_code: s(it.skcExtCode || it.extCode),
      status: s(it.latestFeedbackStatus || it.status),
      biz_time: s(it.expectLatestPickTime || it.createTime),
    }),
  },
  {
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
  },
  {
    source: "return",
    type: "bg.refund.returnpackagelist.get",
    region: "CN",
    extraParams: () => {
      const now = Date.now();
      return { outboundTimeStart: now - RETURN_WINDOW_DAYS * 86400000, outboundTimeEnd: now };
    },
    listOf: (r) => r.packageDetailDTOList || r.list || r.data || r.returnSupplierPackageList || r.returnPackageList,
    map: (it) => ({
      record_key: s(it.returnSupplierPackageSn || it.packageSn || it.returnPackageSn),
      product_id: s(it.productId),
      product_skc_id: s(it.productSkcId),
      ext_code: s(it.skcExtCode || it.extCode),
      status: s(it.status || it.packageStatus || it.returnStatus),
      biz_time: s(it.outboundTime || it.gmtCreate),
    }),
  },
];

function replaceSourceRecords(db, mallId, source, rows, now) {
  const del = db.prepare("DELETE FROM erp_temu_openapi_records WHERE mall_id = ? AND source = ?");
  const ins = db.prepare(`
    INSERT INTO erp_temu_openapi_records
      (mall_id, source, seq, record_key, product_id, product_skc_id, ext_code, status, biz_time, raw_json, synced_at)
    VALUES (@mall_id,@source,@seq,@record_key,@product_id,@product_skc_id,@ext_code,@status,@biz_time,@raw,@now)
  `);
  const tx = db.transaction(() => {
    del.run(mallId, source);
    rows.forEach((row, seq) => {
      ins.run({
        mall_id: mallId, source, seq,
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

async function syncListCollector(db, mallId, creds, collector) {
  const extra = collector.extraParams ? collector.extraParams() : {};
  const rows = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    if (pageNo > 1 && pageNo % 10 === 1) await sleep(INTER_COLLECTOR_PAUSE_MS); // 每 10 页停一下回血
    let response;
    const pageKey = collector.pageParam || "pageNo";   // 多数接口 pageNo，少数(glo.product.search)用 pageNum
    try {
      response = await callRetry({
        type: collector.type, ...creds, region: collector.region,
        bizParams: { ...extra, [pageKey]: pageNo, pageSize: collector.pageSize || PAGE_SIZE },
      });
    } catch (e) {
      if (pageNo === 1) throw e;       // 首页就失败 = 彻底失败
      break;                            // 翻页中途失败：保留已采页，停止翻页
    }
    const items = collector.listOf(response.result || {}) || [];
    if (!items.length) break;
    for (const it of items) rows.push({ ...collector.map(it), raw: JSON.stringify(it) });
    if (items.length < PAGE_SIZE) break;
  }
  replaceSourceRecords(db, mallId, collector.source, rows, nowIso());
  return rows.length;
}

// 库存：逐 productSkcId（取自已采的商品主数据表）调 virtualinventoryjit。
async function syncInventoryCollector(db, mallId, creds) {
  const skcRows = db.prepare(`
    SELECT DISTINCT product_skc_id FROM (
      SELECT json_extract(raw_json, '$.productSkcId') AS product_skc_id
      FROM erp_temu_openapi_products WHERE mall_id = ?
    ) WHERE product_skc_id IS NOT NULL LIMIT ?
  `).all(mallId, MAX_INVENTORY_SKCS);
  const rows = [];
  // 库存接口(PA)限流宽松，用并发池提速（不走全局 600ms 节流），单 SKC 失败重试1次后跳过
  let idx = 0;
  async function worker() {
    while (idx < skcRows.length) {
      const skc = skcRows[idx++].product_skc_id;
      let stockList = null;
      for (let attempt = 0; attempt < 2 && stockList === null; attempt += 1) {
        try {
          const { ok, response } = await callOpenApi({
            type: "bg.qtg.stock.virtualinventoryjit.get", ...creds, region: "PA",
            bizParams: { productSkcId: skc },
          });
          if (ok && response && response.success === true) {
            stockList = (response.result && response.result.productSkuStockList) || [];
          }
        } catch { /* retry */ }
        if (stockList === null) await sleep(300);
      }
      for (const st of (stockList || [])) {
        rows.push({
          record_key: s(st.productSkuId), product_id: null,
          product_skc_id: s(skc), ext_code: s(st.extCode),
          status: null, biz_time: null, raw: JSON.stringify(st),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: INVENTORY_CONCURRENCY }, () => worker()));
  replaceSourceRecords(db, mallId, "inventory", rows, nowIso());
  return rows.length;
}

/**
 * 采集单店全部源，回写 erp_temu_openapi_auth 多源采集状态。
 * @param {object} [opts] { skipInventory } 库存逐 SKC 较慢，可跳过
 */
async function syncAllCollectorsForMall(db, mallRow, opts = {}) {
  const mallId = mallRow.mall_id;
  if (!mallRow.access_token) throw new Error(`店铺 ${mallId} 无 access_token`);
  const { appKey, appSecret } = resolveTemuAppCredentials({ appKey: mallRow.app_key, appSecret: mallRow.app_secret });
  const creds = { appKey, appSecret, accessToken: mallRow.access_token };

  const summary = {};
  let firstError = null;
  for (let i = 0; i < LIST_COLLECTORS.length; i += 1) {
    const collector = LIST_COLLECTORS[i];
    if (i > 0) await sleep(INTER_COLLECTOR_PAUSE_MS);   // 源间停顿，让限流桶回血
    try { summary[collector.source] = await syncListCollector(db, mallId, creds, collector); }
    catch (e) { summary[collector.source] = -1; firstError = firstError || `${collector.source}: ${e?.message || e}`; }
  }
  if (!opts.skipInventory) await sleep(INTER_COLLECTOR_PAUSE_MS);
  if (!opts.skipInventory) {
    try { summary.inventory = await syncInventoryCollector(db, mallId, creds); }
    catch (e) { summary.inventory = -1; firstError = firstError || `inventory: ${e?.message || e}`; }
  }

  const now = nowIso();
  db.prepare(`
    UPDATE erp_temu_openapi_auth
    SET last_records_sync_at=@now, records_sync_summary_json=@summary,
        last_records_sync_status=@status, last_records_sync_error=@err, updated_at=@now
    WHERE mall_id=@mall_id
  `).run({
    now, summary: JSON.stringify(summary),
    status: firstError ? "partial" : "ok",
    err: firstError ? String(firstError).slice(0, 1000) : null,
    mall_id: mallId,
  });
  return { mallId, summary };
}

async function syncAllCollectorsAllMalls(db, opts = {}) {
  const malls = db.prepare(`
    SELECT * FROM erp_temu_openapi_auth
    WHERE status='active' AND access_token IS NOT NULL AND access_token <> ''
    ORDER BY updated_at DESC
  `).all();
  const results = [];
  for (const m of malls) {
    try { results.push({ ok: true, ...(await syncAllCollectorsForMall(db, m, opts)) }); }
    catch (e) { results.push({ ok: false, mallId: m.mall_id, error: String(e?.message || e) }); }
  }
  return { malls: results.length, results };
}

/** 仅采库存（全店）——独立 job 用，与快源解耦。 */
async function syncInventoryAllMalls(db) {
  const malls = db.prepare(`
    SELECT * FROM erp_temu_openapi_auth
    WHERE status='active' AND access_token IS NOT NULL AND access_token <> ''
    ORDER BY updated_at DESC
  `).all();
  const results = [];
  for (const m of malls) {
    try {
      const { appKey, appSecret } = resolveTemuAppCredentials({ appKey: m.app_key, appSecret: m.app_secret });
      const count = await syncInventoryCollector(db, m.mall_id, { appKey, appSecret, accessToken: m.access_token });
      results.push({ ok: true, mallId: m.mall_id, inventory: count });
    } catch (e) {
      results.push({ ok: false, mallId: m.mall_id, error: String(e?.message || e) });
    }
  }
  return { malls: results.length, results };
}

// ===================== 扩展采集：广告/流量、爆款邀约、生命周期 =====================
// 数据落同一张 erp_temu_openapi_records，但用独立 source 值与独立 job（不混进已部署的快源同步）。

const AD_REPORT_WINDOW_DAYS = 7;   // 广告/流量报表回溯窗口

// 列表型扩展源（沿用 syncListCollector，靠 pageParam/region 区分）。
const EXT_LIST_COLLECTORS = [
  {
    source: "product_lifecycle",                 // 货品生命周期/选品状态
    type: "bg.glo.product.search",
    region: "PA",
    pageParam: "pageNum",                         // 该接口用 pageNum 而非 pageNo
    listOf: (r) => r.dataList,
    map: (it) => {
      const skc = (Array.isArray(it.skcList) && it.skcList[0]) || {};
      return {
        record_key: s(it.productId),
        product_id: s(it.productId),
        product_skc_id: s(skc.skcId),
        ext_code: null,
        status: s(skc.selectStatus),              // 选品/生命周期状态码
        biz_time: null,
      };
    },
  },
  {
    source: "best_seller_invitation",             // 平台爆款邀约
    type: "bg.glo.best.seller.invitation.query",
    region: "PA",
    pageParam: "pageNo",
    listOf: (r) => (r.result && r.result.list) || r.list,   // 双层包：response.result.result.list
    map: (it) => ({
      record_key: s(it.invitationId),
      product_id: null,
      product_skc_id: null,
      ext_code: null,
      status: s(it.type),
      biz_time: s(it.endTime),
    }),
  },
];

// 广告/流量报表时间窗口（毫秒级，UTC 0 点对齐；mall 维度实测宽松可用）。
function adReportWindow(days) {
  const dayMs = 86400000;
  const now = Date.now();
  const start = new Date(now - days * dayMs); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now - 1 * dayMs); end.setUTCHours(23, 59, 59, 999);
  return { startTs: start.getTime(), endTs: end.getTime() };
}

function unwrapAdResult(response) {
  // PA 广告接口双层包：response.result.result 才是业务体
  const r1 = response && response.result;
  if (r1 && typeof r1 === "object" && ("result" in r1)) return r1.result;
  return r1;
}

// 店铺维度广告/流量：单店一行 (product_id=null)，raw_json 存整体 summary + 按天 reportsItemList。
async function syncAdReportMall(db, mallId, creds) {
  const win = adReportWindow(AD_REPORT_WINDOW_DAYS);
  const response = await callRetry({
    type: "bg.glo.searchrec.ad.reports.mall.query", ...creds, region: "PA", bizParams: win,
  });
  const body = unwrapAdResult(response);
  if (!body) { replaceSourceRecords(db, mallId, "ad_report_mall", [], nowIso()); return 0; }
  const row = {
    record_key: `${win.startTs}-${win.endTs}`,
    product_id: null, product_skc_id: null, ext_code: null,
    status: null, biz_time: String(win.endTs),
    raw: JSON.stringify({ window: win, ...body }),
  };
  replaceSourceRecords(db, mallId, "ad_report_mall", [row], nowIso());
  return 1;
}

// 商品维度广告/流量：按 productId 一行，raw_json 存该商品窗口指标。
// 注：goods.query 参数较 mall 维度严格，extraParams 允许在确认参数后调整。
async function syncAdReportGoods(db, mallId, creds, extraParams = {}) {
  const win = adReportWindow(AD_REPORT_WINDOW_DAYS);
  let response;
  try {
    response = await callRetry({
      type: "bg.glo.searchrec.ad.reports.goods.query", ...creds, region: "PA",
      bizParams: { ...win, ...extraParams },
    });
  } catch (e) {
    // 商品维度参数仍在标定中：失败不阻断其他扩展源，记 0
    replaceSourceRecords(db, mallId, "ad_report_goods", [], nowIso());
    throw e;
  }
  const body = unwrapAdResult(response);
  const info = (body && (body.reportInfo || body)) || {};
  const items = info.reportsItemList || [];
  // 按 productId 聚合（items 可能为 product×day）
  const byPid = new Map();
  for (const it of items) {
    const pid = s(it.productId);
    if (!pid) continue;
    if (!byPid.has(pid)) byPid.set(pid, []);
    byPid.get(pid).push(it);
  }
  const rows = [];
  for (const [pid, arr] of byPid) {
    rows.push({
      record_key: pid, product_id: pid, product_skc_id: null, ext_code: null,
      status: null, biz_time: String(win.endTs),
      raw: JSON.stringify({ window: win, items: arr }),
    });
  }
  replaceSourceRecords(db, mallId, "ad_report_goods", rows, nowIso());
  return rows.length;
}

async function syncExtendedCollectorsForMall(db, mallRow, opts = {}) {
  const mallId = mallRow.mall_id;
  if (!mallRow.access_token) throw new Error(`店铺 ${mallId} 无 access_token`);
  const { appKey, appSecret } = resolveTemuAppCredentials({ appKey: mallRow.app_key, appSecret: mallRow.app_secret });
  const creds = { appKey, appSecret, accessToken: mallRow.access_token };

  const summary = {};
  let firstError = null;
  // 列表型扩展源
  for (let i = 0; i < EXT_LIST_COLLECTORS.length; i += 1) {
    const collector = EXT_LIST_COLLECTORS[i];
    if (i > 0) await sleep(INTER_COLLECTOR_PAUSE_MS);
    try { summary[collector.source] = await syncListCollector(db, mallId, creds, collector); }
    catch (e) { summary[collector.source] = -1; firstError = firstError || `${collector.source}: ${e?.message || e}`; }
  }
  // 店铺维度广告/流量
  await sleep(INTER_COLLECTOR_PAUSE_MS);
  try { summary.ad_report_mall = await syncAdReportMall(db, mallId, creds); }
  catch (e) { summary.ad_report_mall = -1; firstError = firstError || `ad_report_mall: ${e?.message || e}`; }
  // 商品维度广告/流量（参数标定中，失败不致命）
  if (!opts.skipAdGoods) {
    await sleep(INTER_COLLECTOR_PAUSE_MS);
    try { summary.ad_report_goods = await syncAdReportGoods(db, mallId, creds, opts.adGoodsParams || {}); }
    catch (e) { summary.ad_report_goods = -1; firstError = firstError || `ad_report_goods: ${e?.message || e}`; }
  }

  const now = nowIso();
  db.prepare(`
    UPDATE erp_temu_openapi_auth
    SET last_ext_sync_at=@now, ext_sync_summary_json=@summary,
        last_ext_sync_status=@status, last_ext_sync_error=@err, updated_at=@now
    WHERE mall_id=@mall_id
  `).run({
    now, summary: JSON.stringify(summary),
    status: firstError ? "partial" : "ok",
    err: firstError ? String(firstError).slice(0, 1000) : null,
    mall_id: mallId,
  });
  return { mallId, summary };
}

async function syncExtendedCollectorsAllMalls(db, opts = {}) {
  const malls = db.prepare(`
    SELECT * FROM erp_temu_openapi_auth
    WHERE status='active' AND access_token IS NOT NULL AND access_token <> ''
    ORDER BY updated_at DESC
  `).all();
  const results = [];
  for (const m of malls) {
    try { results.push({ ok: true, ...(await syncExtendedCollectorsForMall(db, m, opts)) }); }
    catch (e) { results.push({ ok: false, mallId: m.mall_id, error: String(e?.message || e) }); }
  }
  return { malls: results.length, results };
}

module.exports = {
  LIST_COLLECTORS,
  EXT_LIST_COLLECTORS,
  syncAllCollectorsForMall,
  syncAllCollectorsAllMalls,
  syncInventoryAllMalls,
  syncAdReportMall,
  syncAdReportGoods,
  syncExtendedCollectorsForMall,
  syncExtendedCollectorsAllMalls,
};
