"use strict";

/**
 * 采购自动备货：扫描「平台建议备货量>0 且 无现成备货单」的 SKU，供前端预览 + 批量申请。
 *
 * 数据来源（均为已采集的官方 salesv2 / 备货单物化）：
 *  - 建议备货量 / 缺货 / 库存：erp_temu_openapi_sku_sales(advice_qty 等，mig065)
 *  - 现成备货单去重：erp_temu_openapi_records(source='purchase_order') 的 raw_json，
 *    某 SKU 若存在「未完成」备货单(status∈0,1,2,3,6,10；7已入库/8作废 不算) → 跳过，不重复备
 *  - 成本(预估花费)：erp_skus.weighted_avg_cost[internal_sku_code=货号]
 *
 * 申请走 temuOpenApiShipping.applyOfficialPurchaseOrder(bg.purchaseorder.apply)，按建议量逐 SKU 真下单。
 * 「预览」= await getAutoPurchaseCandidates(只读)；「申请」= await applyAutoPurchaseBatch(真下单，前端二次确认后调)。
 */

const { applyOfficialPurchaseOrder } = require("./temuOpenApiShipping.cjs");
const { queryAll } = require("../../db/connection.cjs");

// 「没发货」的备货单状态：待接单0 / 已接单待发货1。
// （已送货2/已收货3/已验收6/已入库7 都是货已在路上或已到、体现在总库存里；8作废）
// 这些没发货的单 = 已申请但还没发的量，要从"要备多少"里扣掉、只补差额。
const PENDING_STATUS = new Set([0, 1]);

function num(v) {if (v == null) return null;const n = Number(v);return Number.isFinite(n) ? n : null;}

// 建议备货「自算」——对齐运营工作台 OperationsWorkbench（Temu 的 adviceQuantity 是黑盒，含大量销0却建议备）：
//   今日预估 = 今日销量 ×(早<12点 ×2 / 12-18点 ×1.5 / 晚≥18点 ×1.3)，把"截至现在"今日销量预判成全天量
//   日均 = max(7天日均, 今日预估)；备货天数 = 日均>50 用 7 天、否则 10 天；
//   建议备货 = max(0, ⌈日均 × 天数 − 总库存⌉)  → 销0(日均0)自然算出 0、不备。
const RESTOCK_FAST_QTY = 50,RESTOCK_DAYS_NORMAL = 10,RESTOCK_DAYS_FAST = 7;
// 突然爆单判定：今日预估 > 7天日均 × 倍数 且 建议量 ≥ 最小量 → 标记需人工审核（不进默认批量申请）。
const REVIEW_MULTIPLIER = 3,REVIEW_MIN_QTY = 10;
function calcAdvice(today, last7d, totalStock, hour) {
  const daily = Math.max((last7d || 0) / 7, (today || 0) * (hour < 12 ? 2 : hour < 18 ? 1.5 : 1.3));
  const days = daily > RESTOCK_FAST_QTY ? RESTOCK_DAYS_FAST : RESTOCK_DAYS_NORMAL;
  return Math.max(0, Math.ceil(daily * days - (totalStock || 0)));
}
// 北京时间小时（服务器多为 UTC）。
function beijingHour() {return (new Date().getUTCHours() + 8) % 24;}
// SKU 级总库存 = 可用 + 暂不可用 − 缺货件数 + 在途（与运营工作台同公式，字段全取 salesv2 SKU 级）。
function skuTotalStock(r) {
  return (num(r.warehouse_stock) || 0) + (num(r.unavailable_stock) || 0) - (num(r.lack_quantity) || 0) + (num(r.wait_in_stock) || 0);
}

// 每个 SKU「现成、没发货、没过期」备货单的累计备货量(= 已申请但还没发的量)。
// 流式读，省内存(records 表可达数万行)。过期 = 当前时间超过备货单「最晚发货时间」→ 发不了、不计入。
async function buildPendingQtyMap(db, nowMs) {
  const map = new Map();
  const rows = await queryAll(db, "SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'");
  for (const r of rows) {
    let it;try {it = JSON.parse(r.raw_json);} catch {continue;}
    if (!PENDING_STATUS.has(Number(it.status))) continue; // 只算没发货的(待接单/已接单待发货)
    const di = it.deliverInfo && typeof it.deliverInfo === "object" ? it.deliverInfo : {};
    const latest = Number(di.expectLatestDeliverTimeOrDefault);
    if (Number.isFinite(latest) && latest > 0 && nowMs > latest) continue; // 过期→发不了，不计入
    const list = Array.isArray(it.skuQuantityDetailList) ? it.skuQuantityDetailList : [];
    for (const sk of list) {
      if (sk && sk.productSkuId != null) {
        const key = r.mall_id + "|" + String(sk.productSkuId);
        map.set(key, (map.get(key) || 0) + (num(sk.purchaseQuantity) || 0));
      }
    }
  }
  return map;
}

// 货号 → 采购成本(weighted_avg_cost 优先, 退 jst_cost_price)。一货号多行取 MAX。与 consign 同口径。
async function buildCostMap(db) {
  const m = new Map();
  const rows = await queryAll(db, `
    SELECT internal_sku_code AS code,
           MAX(COALESCE(NULLIF(weighted_avg_cost,0), NULLIF(jst_cost_price,0))) AS cost
      FROM erp_skus WHERE internal_sku_code IS NOT NULL AND internal_sku_code <> ''
     GROUP BY internal_sku_code`);
  for (const r of rows) if (r.code != null && r.cost != null) m.set(String(r.code), Number(r.cost));
  return m;
}

/**
 * 扫描自动备货候选：建议备货量>0 且 无现成备货单的 SKU。
 * @param {object} db
 * @param {{mallId?:string}} [opts] 可按店过滤
 * @returns {{candidates:Array, summary:object}}
 */
async function getAutoPurchaseCandidates(db, opts = {}) {
  const mallId = opts.mallId ? String(opts.mallId) : null;
  const nowMs = Date.now();
  const pendingMap = await buildPendingQtyMap(db, nowMs);
  const costMap = await buildCostMap(db);

  const hour = beijingHour();
  // 扫全量 SKU，用「自算建议备货」（销量+总库存）替代 Temu 黑盒 advice_qty。
  const rows = mallId ? await queryAll(db,
  "SELECT * FROM erp_temu_openapi_sku_sales WHERE mall_id = ?", [mallId]) : await queryAll(db,
  "SELECT * FROM erp_temu_openapi_sku_sales");

  const candidates = [];
  let totalQty = 0,totalAmount = 0,skipped = 0;
  for (const r of rows) {
    const totalStock = skuTotalStock(r);
    const fullAdvice = calcAdvice(num(r.today_sales) || 0, num(r.last7d_sales) || 0, totalStock, hour); // X：自算要备多少
    if (fullAdvice <= 0) continue; // 自算=0（销0 或 库存够）→ 不备
    const pendingQty = pendingMap.get(r.mall_id + "|" + r.product_sku_id) || 0; // Y：现成没发货没过期的在备量
    const advice = fullAdvice - pendingQty; // 缺口 = 要备 − 现成在备
    if (advice <= 0) {skipped += 1;continue;} // 现成单已备够 → 不重复申请
    // 突然爆单：今日预估远超 7 天日均（且量不小）→ 需人工审核，不进默认批量申请
    const todayEst = (num(r.today_sales) || 0) * (hour < 12 ? 2 : hour < 18 ? 1.5 : 1.3);
    const weekAvg = (num(r.last7d_sales) || 0) / 7;
    const needsReview = todayEst > weekAvg * REVIEW_MULTIPLIER && advice >= REVIEW_MIN_QTY;
    const cost = r.ext_code ? costMap.get(String(r.ext_code)) ?? null : null;
    const estAmount = cost != null ? Math.round(advice * cost * 100) / 100 : null;
    totalQty += advice;
    if (estAmount != null) totalAmount += estAmount;
    candidates.push({
      mallId: r.mall_id,
      productId: r.product_id,
      productSkcId: r.product_skc_id,
      productSkuId: r.product_sku_id,
      extCode: r.ext_code,
      title: r.title,
      thumbUrl: r.thumb_url,
      specName: r.spec_name,
      adviceQty: advice, // 缺口 = 申请数量
      fullAdvice, // 自算要备(X)
      pendingQty, // 现成没发货没过期的在备量(Y)
      needsReview, // 突然爆单（今日预估远超7天日均）→ 需人工审核
      temuAdviceQty: num(r.advice_qty), // Temu 原始建议（仅参考对比）
      todaySales: num(r.today_sales),
      last7dSales: num(r.last7d_sales),
      last30dSales: num(r.last30d_sales),
      warehouseStock: num(r.warehouse_stock), // 可用
      occupyStock: num(r.occupy_stock), // 预占
      unavailStock: num(r.unavailable_stock), // 暂不可用
      lackQuantity: num(r.lack_quantity), // 缺货件数
      waitInStock: num(r.wait_in_stock), // 在途
      totalStock, // 总库存=可用+暂不可用−缺货+在途
      saleDays: num(r.sale_days),
      costPrice: cost != null ? cost : null,
      estAmount
    });
  }
  // 预估花费大的排前面（人工优先核对大头）
  candidates.sort((a, b) => (b.estAmount || 0) - (a.estAmount || 0));

  const stores = new Set(candidates.map((c) => c.mallId));
  return {
    candidates,
    summary: {
      count: candidates.length,
      totalQty,
      totalAmount: Math.round(totalAmount * 100) / 100,
      stores: stores.size,
      costCoverage: candidates.filter((c) => c.estAmount != null).length, // 算到成本的条数(判断金额完整度)
      skippedHasOrder: skipped, // 已有现成单被跳过的条数
      needsReviewCount: candidates.filter((c) => c.needsReview).length // 突然爆单需人工审核的条数
    }
  };
}

/**
 * 批量申请备货：逐 SKU 调 bg.purchaseorder.apply（真下单）。按 mallId 分别取凭证。
 * 单 SKU 失败不影响其余，错误码原样收集（核价 1001 / 超建议量 1002 / 当日额度 61001 等）。
 * @param {object} db
 * @param {Array<{mallId:string,productSkuId:(string|number),productSkcId:(string|number),quantity:number}>} items
 * @returns {Promise<{total:number, ok:number, fail:number, results:Array}>}
 */
async function applyAutoPurchaseBatch(db, items) {
  const list = Array.isArray(items) ? items : [];
  // 服务器若为旧版 temuOpenApiShipping(无采购写三件套)，applyOfficialPurchaseOrder 会是 undefined：
  // 此时友好失败、不崩，提示「申请功能待服务器更新」。
  if (typeof applyOfficialPurchaseOrder !== "function") {
    return {
      total: list.length, ok: 0, fail: list.length,
      results: list.map((it) => ({ mallId: it.mallId, productSkuId: it.productSkuId, ok: false, error: "申请功能未在服务器启用，请联系管理员更新主控端" }))
    };
  }
  const results = [];
  for (const it of list) {
    const qty = Number(it.quantity != null ? it.quantity : it.adviceQty);
    const base = { productSkuId: it.productSkuId, mallId: it.mallId, quantity: qty };
    if (!it.mallId || !it.productSkuId || !it.productSkcId || !(qty > 0)) {
      results.push({ ...base, ok: false, error: "缺少 mallId/SKU/SKC/数量" });
      continue;
    }
    try {
      const r = await applyOfficialPurchaseOrder({
        db,
        mallId: String(it.mallId),
        purchaseDetailList: [{ productSkuId: Number(it.productSkuId), productSkcId: Number(it.productSkcId), productSkuPurchaseQuantity: qty }]
      });
      results.push({ ...base, ok: true, result: r.result });
    } catch (e) {
      results.push({ ...base, ok: false, error: e.message, errorCode: e.errorCode });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  return { total: results.length, ok, fail: results.length - ok, results };
}

module.exports = { getAutoPurchaseCandidates, applyAutoPurchaseBatch, PENDING_STATUS };