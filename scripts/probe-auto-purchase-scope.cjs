/**
 * 调研：自动备货的实际规模 + 去重验证。纯读本地 erp.sqlite。
 *  - 该备的 SKU = erp_temu_openapi_sku_sales.advice_qty > 0
 *  - 现成备货单 = erp_temu_openapi_records(purchase_order) 里该 SKU 有未完成单(status∈0,1,2,3,6,10；排除7已入库/8作废)
 *  - 输出：该备总数 / 已有现成单(跳过) / 无现成单(要自动申请) + 样本 + 核对截图 SKC
 * 用法(服务器)：NODE_PATH=/opt/temu-automation/node_modules node /tmp/probe-auto-purchase-scope.cjs
 */
"use strict";
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");

// 1. 该备的 SKU（建议备货量>0）
const need = db.prepare(`
  SELECT mall_id, product_sku_id, product_skc_id, advice_qty, lack_quantity, warehouse_stock, wait_in_stock, last7d_sales, title
  FROM erp_temu_openapi_sku_sales WHERE advice_qty > 0
`).all();
console.log(`# 建议备货量>0 的 SKU: ${need.length}`);

// 2. 有未完成备货单的 (mall_id|productSkuId) 集合（流式读，省内存）
const INFLIGHT = new Set();
const stmt = db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'");
let poScanned = 0, poInflight = 0;
for (const r of stmt.iterate()) {
  poScanned++;
  let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
  const st = Number(it.status);
  if (![0, 1, 2, 3, 6, 10].includes(st)) continue; // 7已入库/8作废 不算现成单
  poInflight++;
  for (const sk of (it.skuQuantityDetailList || [])) {
    if (sk && sk.productSkuId != null) INFLIGHT.add(r.mall_id + "|" + String(sk.productSkuId));
  }
}
console.log(`# 备货单总数 ${poScanned}，其中未完成(在途) ${poInflight}，覆盖 SKU 键 ${INFLIGHT.size}`);

// 3. 交集/差集
let hasOrder = 0, noOrder = 0, adviceSum = 0;
const samples = [];
const byMall = {};
for (const n of need) {
  const key = n.mall_id + "|" + n.product_sku_id;
  if (INFLIGHT.has(key)) { hasOrder++; continue; }
  noOrder++;
  adviceSum += Number(n.advice_qty) || 0;
  byMall[n.mall_id] = (byMall[n.mall_id] || 0) + 1;
  if (samples.length < 12) samples.push(n);
}
console.log(`\n# ===== 自动备货规模 =====`);
console.log(`  该备且【已有现成单→跳过】: ${hasOrder}`);
console.log(`  该备且【无现成单→要自动申请】: ${noOrder}（建议量合计 ${adviceSum} 件，涉及 ${Object.keys(byMall).length} 店）`);
console.log(`\n# 要自动申请的样本:`);
for (const s of samples) {
  console.log(`  mall=${s.mall_id} sku=${s.product_sku_id} 建议量=${s.advice_qty} 缺货=${s.lack_quantity} 可用库存=${s.warehouse_stock} 在途=${s.wait_in_stock} 近7日销=${s.last7d_sales} | ${String(s.title || "").slice(0, 24)}`);
}

// 4. 核对截图两个 SKC 的 advice_qty（看 salesv2 建议量 vs 后台「申请备货」建议量是否一致）
for (const skc of ["25835213917", "46556692339"]) {
  const rows = db.prepare(`
    SELECT mall_id, product_sku_id, advice_qty, lack_quantity, warehouse_stock, wait_in_stock
    FROM erp_temu_openapi_sku_sales WHERE product_skc_id = ?`).all(skc);
  console.log(`\n# 核对截图 SKC=${skc}: ${rows.length} 行 (截图后台建议备货量=0)`);
  for (const r of rows.slice(0, 6)) {
    console.log(`  mall=${r.mall_id} sku=${r.product_sku_id} advice_qty=${r.advice_qty} 缺货=${r.lack_quantity} 可用库存=${r.warehouse_stock} 在途=${r.wait_in_stock}`);
  }
}
