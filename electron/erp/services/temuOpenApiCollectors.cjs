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

const PAGE_SIZE = 100;
const MAX_PAGES = 300;
const RETURN_WINDOW_DAYS = 30;            // 售后出库时间窗口（接口限 ≤31 天）
const MAX_INVENTORY_SKCS = 8000;          // 库存逐 SKC 调用上限（防 runaway）
const INVENTORY_DELAY_MS = 30;            // 库存调用间隔（轻节流，避免限流）

function nowIso() { return new Date().toISOString(); }
function s(v) { return v == null ? null : String(v); }

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
    listOf: (r) => r.list || r.data || r.returnSupplierPackageList || r.returnPackageList,
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
    const { ok, response } = await callOpenApi({
      type: collector.type, ...creds, region: collector.region,
      bizParams: { ...extra, pageNo, pageSize: PAGE_SIZE },
    });
    if (!ok || !response || response.success === false) {
      throw new Error(`${collector.type} 失败: ${response?.errorMsg || `errorCode=${response?.errorCode}`}`);
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
  for (const { product_skc_id } of skcRows) {
    try {
      const { ok, response } = await callOpenApi({
        type: "bg.qtg.stock.virtualinventoryjit.get", ...creds, region: "PA",
        bizParams: { productSkcId: product_skc_id },
      });
      if (ok && response && response.success !== false) {
        const stockList = (response.result && response.result.productSkuStockList) || [];
        for (const st of stockList) {
          rows.push({
            record_key: s(st.productSkuId), product_id: null,
            product_skc_id: s(product_skc_id), ext_code: s(st.extCode),
            status: null, biz_time: null, raw: JSON.stringify(st),
          });
        }
      }
    } catch { /* 单 SKC 失败跳过 */ }
    if (INVENTORY_DELAY_MS) await new Promise((r) => setTimeout(r, INVENTORY_DELAY_MS));
  }
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
  for (const collector of LIST_COLLECTORS) {
    try { summary[collector.source] = await syncListCollector(db, mallId, creds, collector); }
    catch (e) { summary[collector.source] = -1; firstError = firstError || `${collector.source}: ${e?.message || e}`; }
  }
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

async function syncAllCollectorsAllMalls(db) {
  const malls = db.prepare(`
    SELECT * FROM erp_temu_openapi_auth
    WHERE status='active' AND access_token IS NOT NULL AND access_token <> ''
    ORDER BY updated_at DESC
  `).all();
  const results = [];
  for (const m of malls) {
    try { results.push({ ok: true, ...(await syncAllCollectorsForMall(db, m)) }); }
    catch (e) { results.push({ ok: false, mallId: m.mall_id, error: String(e?.message || e) }); }
  }
  return { malls: results.length, results };
}

module.exports = {
  LIST_COLLECTORS,
  syncAllCollectorsForMall,
  syncAllCollectorsAllMalls,
};
