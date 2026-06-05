/**
 * 完整「要备多少货」清单（自算版）：直接 require 部署的 temuAutoPurchase.cjs，打印全部候选+汇总。
 * 纯只读。用法(服务器)：cd /opt/temu-automation && node /tmp/preview-auto-purchase-v2.cjs
 */
"use strict";
const m = require("/opt/temu-automation/electron/erp/services/temuAutoPurchase.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const { candidates, summary } = m.getAutoPurchaseCandidates(db);

console.log(`# ===== 要备多少货（自算建议备货）=====`);
console.log(`# 合计: ${summary.count} 个 SKU · ${summary.totalQty} 件 · 预估 ¥${summary.totalAmount} · ${summary.stores} 店 · 已跳过现成单 ${summary.skippedHasOrder} 个 · 无成本(预估未计) ${summary.count - summary.costCoverage} 个`);

// 按店汇总
const byMall = {};
for (const c of candidates) {
  const k = String(c.mallId).slice(-4);
  if (!byMall[k]) byMall[k] = { n: 0, qty: 0, amt: 0 };
  byMall[k].n += 1; byMall[k].qty += c.adviceQty; byMall[k].amt += (c.estAmount || 0);
}
console.log(`\n# 按店(店号尾4位 · SKU数/件数/预估):`);
for (const [k, v] of Object.entries(byMall).sort((a, b) => b[1].amt - a[1].amt)) {
  console.log(`  ${k}: ${v.n}个 / ${v.qty}件 / ¥${Math.round(v.amt * 100) / 100}`);
}

// 全部明细
const p = (s, n) => (String(s == null ? "-" : s) + "              ").slice(0, n);
console.log(`\n# 全部明细(按预估花费降序):`);
console.log(`  ${p("店", 5)}${p("货号", 12)}${p("建议", 5)}${p("今日", 5)}${p("7天", 4)}${p("30天", 5)}${p("库存", 6)}${p("成本", 7)}${p("预估", 8)} 商品`);
for (const c of candidates) {
  console.log(`  ${p(String(c.mallId).slice(-4), 5)}${p(c.extCode || c.productSkuId, 12)}${p(c.adviceQty, 5)}${p(c.todaySales, 5)}${p(c.last7dSales, 4)}${p(c.last30dSales, 5)}${p(c.totalStock, 6)}${p(c.costPrice != null ? "¥" + c.costPrice : "无", 7)}${p(c.estAmount != null ? "¥" + c.estAmount : "无", 8)} ${String(c.title || "").slice(0, 20)}`);
}
