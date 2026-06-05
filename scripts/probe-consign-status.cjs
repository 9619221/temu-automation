/**
 * 一次性调研：从已采集的 erp_temu_openapi_records(source='purchase_order') 看备货单真实状态分布
 * + 待接单(status=0)样本字段。纯读本地 erp.sqlite，不调 API。
 * 用法(服务器)：NODE_PATH=/opt/temu-automation/node_modules node /tmp/probe-consign-status.cjs
 */
"use strict";
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");

// status 分布(SQL 层 json_extract，内存安全)
const dist = db.prepare(`
  SELECT json_extract(raw_json,'$.status') st, COUNT(*) c
  FROM erp_temu_openapi_records WHERE source='purchase_order'
  GROUP BY st ORDER BY c DESC`).all();
console.log("# purchase_order 原始 status 分布:");
console.log("# (官方文档 statusList: 0待接单 1已接单待发货 2已送货 3已收货 4已拒收 5验收全退 6已验收 7已入库 8作废 9超时)");
let total = 0;
for (const r of dist) { total += r.c; console.log(`  status=${r.st}: ${r.c}`); }
console.log(`  合计: ${total}`);

// source 分布(谁下的单)
const src = db.prepare(`
  SELECT json_extract(raw_json,'$.source') s, COUNT(*) c
  FROM erp_temu_openapi_records WHERE source='purchase_order'
  GROUP BY s ORDER BY c DESC`).all();
console.log("\n# 下单来源 source 分布 (0运营 1供应商 2系统 3excel 4系统规则 9999平台):");
for (const r of src) console.log(`  source=${r.s}: ${r.c}`);

// 取 status=0 一条样本看字段（建议量 vs 下单量关系）
for (const st of [0, 1]) {
  const row = db.prepare(`
    SELECT raw_json FROM erp_temu_openapi_records
    WHERE source='purchase_order' AND json_extract(raw_json,'$.status')=? LIMIT 1`).get(st);
  if (!row) { console.log(`\n# 无 status=${st} 样本`); continue; }
  const it = JSON.parse(row.raw_json);
  const sk = (it.skuQuantityDetailList || [])[0] || {};
  console.log(`\n# status=${st} 样本:`);
  console.log("  so_id(WB):", it.subPurchaseOrderSn, "| 母单:", it.originalPurchaseOrderSn, "| 发货单:", it.deliveryOrderSn || (it.deliverInfo || {}).deliveryOrderSn || "(无)");
  console.log("  货品:", it.productName, "| source:", it.source, "| settlementType(0采购/1备货VMI):", it.settlementType, "| JIT:", it.purchaseStockType, "| 今日可发:", it.todayCanDeliver, "| 紧急:", it.urgencyType);
  console.log("  SKU数:", (it.skuQuantityDetailList || []).length, "| sku[0]:", JSON.stringify({
    productSkuId: sk.productSkuId, productSkcId: it.productSkcId, extCode: sk.extCode, className: sk.className,
    adviceQuantity: sk.adviceQuantity, purchaseQuantity: sk.purchaseQuantity, purchaseUpLimit: sk.purchaseUpLimit,
    deliverQuantity: sk.deliverQuantity, realReceiveAuthenticQuantity: sk.realReceiveAuthenticQuantity, supportIncreaseNum: sk.supportIncreaseNum,
  }));
}

// 待接单(0) 跨店统计：多少店有、多少单、涉及多少 SKU、建议量合计
const wb0 = db.prepare(`
  SELECT mall_id, COUNT(*) c FROM erp_temu_openapi_records
  WHERE source='purchase_order' AND json_extract(raw_json,'$.status')=0
  GROUP BY mall_id ORDER BY c DESC`).all();
console.log(`\n# status=0 待接单：涉及 ${wb0.length} 个店，单量 top5:`);
for (const r of wb0.slice(0, 5)) console.log(`  mall=${r.mall_id}: ${r.c} 单`);
