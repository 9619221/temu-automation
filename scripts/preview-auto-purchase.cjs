/**
 * 真实预览：在服务器只读跑「采购自动备货」扫描逻辑(与 temuAutoPurchase.getAutoPurchaseCandidates 等价)，
 * 打印真实候选 + 汇总 + 预估花费。纯读 erp.sqlite，不重启服务、不写库。
 * 用法：NODE_PATH=/opt/temu-automation/node_modules node /tmp/preview-auto-purchase.cjs
 */
"use strict";
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const INFLIGHT = new Set([0, 1, 2, 3, 6, 10]); // 未完成备货单状态(排除7已入库/8作废)
const num = (v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// 1. 有现成(未完成)备货单的 SKU 集合
const inflight = new Set();
for (const r of db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'").iterate()) {
  let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
  if (!INFLIGHT.has(Number(it.status))) continue;
  for (const sk of (it.skuQuantityDetailList || [])) if (sk && sk.productSkuId != null) inflight.add(r.mall_id + "|" + String(sk.productSkuId));
}
// 2. 货号→成本
const costMap = new Map();
for (const r of db.prepare("SELECT internal_sku_code code, MAX(COALESCE(NULLIF(weighted_avg_cost,0),NULLIF(jst_cost_price,0))) cost FROM erp_skus WHERE internal_sku_code IS NOT NULL AND internal_sku_code<>'' GROUP BY internal_sku_code").all())
  if (r.code != null && r.cost != null) costMap.set(String(r.code), Number(r.cost));
// 3. 候选 = advice_qty>0 且无现成单
const rows = db.prepare("SELECT * FROM erp_temu_openapi_sku_sales WHERE advice_qty > 0").all();
const cand = []; let tq = 0, ta = 0, skip = 0;
for (const r of rows) {
  if (inflight.has(r.mall_id + "|" + r.product_sku_id)) { skip++; continue; }
  const cost = r.ext_code ? (costMap.get(String(r.ext_code)) ?? null) : null;
  const advice = num(r.advice_qty) || 0;
  const est = cost != null ? Math.round(advice * cost * 100) / 100 : null;
  tq += advice; if (est != null) ta += est;
  cand.push({ mallId: r.mall_id, sku: r.product_sku_id, ext: r.ext_code, title: r.title, advice, lack: num(r.lack_quantity), stock: num(r.warehouse_stock), wait: num(r.wait_in_stock), s7: num(r.last7d_sales), cost, est });
}
cand.sort((a, b) => (b.est || 0) - (a.est || 0));

console.log(`# 汇总: 待备 ${cand.length} 个 · 合计 ${tq} 件 · 预估总花费 ¥${Math.round(ta * 100) / 100} · 涉及 ${new Set(cand.map((c) => c.mallId)).size} 店 · 已跳过(有现成单) ${skip} 个 · 算到成本 ${cand.filter((c) => c.est != null).length} 个`);
// 按店分布
const byMall = {};
for (const c of cand) byMall[String(c.mallId).slice(-4)] = (byMall[String(c.mallId).slice(-4)] || 0) + 1;
console.log("# 按店分布(店号尾4位):", Object.entries(byMall).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}:${n}`).join("  "));
console.log("\n# 全部候选(按预估花费降序):");
console.log("  店   货号        建议 缺货 库存 在途 销7  成本    预估     商品");
for (const c of cand) {
  const p = (s, n) => (String(s ?? "-") + "          ").slice(0, n);
  console.log(`  ${p(String(c.mallId).slice(-4), 5)}${p(c.ext || c.sku, 12)}${p(c.advice, 5)}${p(c.lack, 5)}${p(c.stock, 5)}${p(c.wait, 5)}${p(c.s7, 5)}${p(c.cost != null ? "¥" + c.cost : "无", 8)}${p(c.est != null ? "¥" + c.est : "无", 9)} ${String(c.title || "").slice(0, 20)}`);
}
