/**
 * 探针3：解广告/流量报表接口参数（bad query params -> 试多种参数形状逼出必填字段）。
 * 同时 dump 爆款邀约 + 商品列表首条完整字段，供建表/采集器字段映射。
 * 用法：TEMU_OPENAPI_APP_SECRET=xxx node probe_ad_reports.cjs [mallId]
 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
if (!APP_SECRET) { console.error("缺 secret"); process.exit(1); }
const mall = (process.argv[2]
  ? db.prepare("SELECT mall_id,region,access_token FROM erp_temu_openapi_auth WHERE mall_id=? AND status='active'").get(process.argv[2])
  : db.prepare(`SELECT a.mall_id,a.region,a.access_token,COUNT(p.product_id) c FROM erp_temu_openapi_auth a LEFT JOIN erp_temu_openapi_products p ON p.mall_id=a.mall_id WHERE a.status='active' GROUP BY a.mall_id ORDER BY c DESC LIMIT 1`).get());
const TOKEN = mall.access_token;
console.log(`# mall=${mall.mall_id}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(type, biz, region = "PA") {
  try {
    const r = await callOpenApi({ type, appKey: APP_KEY, appSecret: APP_SECRET, accessToken: TOKEN, region, bizParams: biz, timeoutMs: 25000 });
    return r.response || {};
  } catch (e) { return { _err: e.message }; }
}
function brief(b) {
  if (b._err) return "EXC " + b._err;
  if (b.success) return "✅ result=" + JSON.stringify(b.result).slice(0, 400);
  // 有些 PA 接口把业务体放在 result 里再包一层
  const inner = b.result && typeof b.result === "object" && ("success" in b.result) ? b.result : null;
  if (inner && inner.success) return "✅(inner) " + JSON.stringify(inner.result).slice(0, 400);
  return `❌ code=${b.errorCode || (inner && inner.errorCode)} msg=${b.errorMsg || (inner && inner.errorMsg)}`;
}

(async () => {
  // 拿一个 productId / skcId
  const lr = await call("bg.glo.goods.list.get", { pageNo: 1, pageSize: 3 });
  const first = (lr.result?.data || [])[0] || {};
  const productId = first.productId, skcId = first.productSkcId;
  console.log("productId=", productId, "skcId=", skcId, "\n");

  // 日期：昨天及近 7 天（今天 2026-06-02），多种格式
  const ymd = (off, sep) => { const t = new Date(Date.now() - off * 86400000); const s = t.toISOString().slice(0, 10); return sep === "" ? s.replace(/-/g, "") : s; };
  const s1 = ymd(8, "-"), e1 = ymd(1, "-");
  const s2 = ymd(8, ""), e2 = ymd(1, "");

  console.log("===== 广告报表-店铺维度 bg.glo.searchrec.ad.reports.mall.query =====");
  const mallVariants = [
    { startDate: s1, endDate: e1 },
    { startDate: s2, endDate: e2 },
    { startDate: s2, endDate: e2, pageNum: 1, pageSize: 10 },
    { date: e2 },
    { statDate: e2 },
    { bizDate: e2 },
    { startTime: s2, endTime: e2, dateType: 1 },
    { dateRange: { startDate: s2, endDate: e2 } },
    { queryStartDate: s2, queryEndDate: e2 },
  ];
  for (const v of mallVariants) { const b = await call("bg.glo.searchrec.ad.reports.mall.query", v); console.log("  " + JSON.stringify(v) + "\n    -> " + brief(b)); await sleep(700); }

  console.log("\n===== 广告报表-商品维度 bg.glo.searchrec.ad.reports.goods.query =====");
  const goodsVariants = [
    { startDate: s2, endDate: e2, pageNum: 1, pageSize: 10 },
    { startDate: s2, endDate: e2, pageNo: 1, pageSize: 10 },
    { startDate: s1, endDate: e1, pageNum: 1, pageSize: 10 },
    { date: e2, pageNum: 1, pageSize: 10 },
    { startDate: s2, endDate: e2, pageNum: 1, pageSize: 10, goodsId: productId },
  ];
  for (const v of goodsVariants) { const b = await call("bg.glo.searchrec.ad.reports.goods.query", v); console.log("  " + JSON.stringify(v) + "\n    -> " + brief(b)); await sleep(700); }

  console.log("\n===== 广告明细 bg.glo.searchrec.ad.detail.query =====");
  for (const v of [{ pageNum: 1, pageSize: 10 }, { pageNum: 1, pageSize: 10, status: 1 }, { startDate: s2, endDate: e2, pageNum: 1, pageSize: 10 }]) {
    const b = await call("bg.glo.searchrec.ad.detail.query", v); console.log("  " + JSON.stringify(v) + "\n    -> " + brief(b)); await sleep(700);
  }

  // ---- dump 爆款邀约首条完整 ----
  console.log("\n===== 爆款邀约首条完整字段 =====");
  const inv = await call("bg.glo.best.seller.invitation.query", { pageNo: 1, pageSize: 2 });
  const invList = inv.result?.result?.list || inv.result?.list || [];
  console.log(JSON.stringify(invList[0] || inv, null, 1).slice(0, 1500));

  // ---- dump 商品列表首条完整 ----
  console.log("\n===== 商品列表首条完整字段 =====");
  console.log(JSON.stringify(first, null, 1).slice(0, 2500));
})();
