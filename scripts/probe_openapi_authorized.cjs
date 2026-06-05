/**
 * 探针2：只调「该 token 已授权」的数据类读接口，按正确网关（glo/qtg 走 PA，其余走 CN）。
 * 链式取 productId/skcId/activityId 再调详情类。报告每个接口实际返回的数据形状与样本。
 * 用法：TEMU_OPENAPI_APP_SECRET=xxx node probe_openapi_authorized.cjs [mallId]
 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
if (!APP_SECRET) { console.error("缺 TEMU_OPENAPI_APP_SECRET"); process.exit(1); }

const argMall = process.argv[2];
const mall = argMall
  ? db.prepare("SELECT mall_id, region, access_token FROM erp_temu_openapi_auth WHERE mall_id=? AND status='active'").get(argMall)
  : db.prepare(`SELECT a.mall_id, a.region, a.access_token, COUNT(p.product_id) c
      FROM erp_temu_openapi_auth a LEFT JOIN erp_temu_openapi_products p ON p.mall_id=a.mall_id
      WHERE a.status='active' GROUP BY a.mall_id ORDER BY c DESC LIMIT 1`).get();
if (!mall) { console.error("无绑定店铺"); process.exit(1); }
const TOKEN = mall.access_token;
console.log(`# 店铺 mall_id=${mall.mall_id}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shape(v, d = 0) {
  if (v === null) return "null"; if (v === undefined) return "undef";
  if (Array.isArray(v)) return `Array(${v.length})` + (v.length && d < 3 ? `<${shape(v[0], d + 1)}>` : "");
  if (typeof v === "object") { const ks = Object.keys(v); if (d >= 3) return `{${ks.length}k}`;
    return "{" + ks.slice(0, 40).map((k) => `${k}:${shape(v[k], d + 1)}`).join(", ") + (ks.length > 40 ? ",…" : "") + "}"; }
  if (typeof v === "string") return v.length > 36 ? `"${v.slice(0, 36)}…"` : `"${v}"`;
  return String(v);
}
function gw(type) { return /^bg\.(glo|qtg)\./.test(type) ? "PA" : "CN"; }

const results = [];
async function probe(label, type, biz = {}) {
  const region = gw(type);
  let out = { label, type, region };
  try {
    const r = await callOpenApi({ type, appKey: APP_KEY, appSecret: APP_SECRET, accessToken: TOKEN, region, bizParams: biz, timeoutMs: 25000 });
    const b = r.response || {};
    out.success = !!b.success; out.errorCode = b.errorCode; out.errorMsg = b.errorMsg;
    out.result = b.result;
    out.resultShape = b.success ? shape(b.result) : shape(b);
  } catch (e) { out.success = false; out.error = e.message; }
  results.push(out);
  console.log(`[${out.success ? "OK " : "ERR"}] ${label} (${type}/${region})`);
  console.log(`      ${out.success ? out.resultShape : ("code=" + out.errorCode + " " + (out.errorMsg || out.error))}`.slice(0, 600));
  await sleep(800);
  return out;
}

// 近 7 天日期，给广告/报表类接口用
const today = new Date();
const d = (off) => { const t = new Date(today.getTime() - off * 86400000); return t.toISOString().slice(0, 10); };
const startDate = d(7), endDate = d(1);

(async () => {
  // ---- 货品(PA) ----
  const list = await probe("商品列表", "bg.glo.goods.list.get", { pageNo: 1, pageSize: 5 });
  let productId, skcId, skuId;
  try {
    const dat = list?.result || {};
    const arr = dat.goodsList || dat.list || dat.data || dat.dataList || [];
    const f = Array.isArray(arr) && arr[0];
    if (f) {
      productId = f.productId || f.goodsId;
      const skc = (f.productSkcList && f.productSkcList[0]) || (f.skcList && f.skcList[0]) || {};
      skcId = skc.productSkcId || f.productSkcId;
      skuId = (skc.productSkuList && skc.productSkuList[0]?.productSkuId) || (skc.skuList && skc.skuList[0]?.productSkuId);
      console.log(`      ↳ productId=${productId} skcId=${skcId} skuId=${skuId}`);
    }
  } catch (e) { console.log("      ↳抽样失败", e.message); }

  if (productId) await probe("商品详情", "bg.glo.goods.detail.get", { productId });
  await probe("生命周期状态", "bg.glo.product.search", productId ? { productIdList: [productId] } : { pageNo: 1, pageSize: 5 });
  await probe("爆款售罄", "bg.glo.goods.topselling.soldout.get", { pageNo: 1, pageSize: 5 });
  await probe("已下架货品", "bg.glo.goods.removed.get", { pageNo: 1, pageSize: 5 });
  await probe("自定义货号标签", "bg.glo.goods.custom.label.get", productId ? { productIdList: [productId] } : {});
  await probe("货品标签v2", "bg.glo.goods.labelv2.get", productId ? { productIdList: [productId] } : {});
  await probe("运费模板", "bg.glo.logistics.template.get", {});
  await probe("爆款邀约", "bg.glo.best.seller.invitation.query", { pageNo: 1, pageSize: 5 });

  // ---- 广告/流量报表(PA) ----
  await probe("广告报表-店铺维度", "bg.glo.searchrec.ad.reports.mall.query", { startDate, endDate });
  await probe("广告报表-商品维度", "bg.glo.searchrec.ad.reports.goods.query", { startDate, endDate, pageNo: 1, pageSize: 5 });
  await probe("广告明细", "bg.glo.searchrec.ad.detail.query", { pageNo: 1, pageSize: 5 });
  await probe("广告日志", "bg.glo.searchrec.ad.log.query", { pageNo: 1, pageSize: 5 });

  // ---- 销售/库存 ----
  await probe("销售v2分仓组", "bg.goods.salesv2.get", { pageNo: 1, pageSize: 3 });
  await probe("销售v1", "bg.goods.sales.get", { pageNo: 1, pageSize: 3 });
  await probe("虚拟库存JIT", "bg.qtg.stock.virtualinventoryjit.get", skcId ? { productSkcId: skcId } : {});
  await probe("销量预测", "bg.predict.volume.get", skcId ? { productSkcId: skcId } : {});

  // ---- 采购/发货/备货 ----
  await probe("采购单v2", "bg.purchaseorderv2.get", { pageNo: 1, pageSize: 3 });
  await probe("发货单v2", "bg.shiporderv2.get", { pageSize: 10 });
  await probe("备货单staging", "bg.shiporder.staging.get", { pageNo: 1, pageSize: 3 });
  await probe("收货地址v2", "bg.shiporder.receiveaddressv2.get", {});

  // ---- 售后/退货 ----
  await probe("退货包裹列表", "bg.refund.returnpackagelist.get", { pageNo: 1, pageSize: 3 });

  // ---- 质检/寄样 ----
  await probe("质检单", "bg.goods.qualityinspection.get", { pageNo: 1, pageSize: 3 });
  await probe("寄样单", "bg.sample.order.get", { pageNo: 1, pageSize: 3 });

  // ---- 基础数据 ----
  await probe("店铺地址", "bg.mall.address.get", {});
  await probe("物流公司", "bg.logistics.company.get", {});
  await probe("类目树cats", "bg.goods.cats.get", { parentCatId: 0 });
  await probe("类目纠正记录", "bg.goods.redress.correctrecord.query", { pageNo: 1, pageSize: 3 });
  await probe("车型库", "bg.vehicle.library.query", { pageNo: 1, pageSize: 3 });

  console.log("\n# ===== 汇总(读接口实测) =====");
  for (const r of results) {
    const v = r.success ? r.resultShape : ("❌ " + (r.errorMsg || r.error || ("code=" + r.errorCode)));
    console.log(`${r.success ? "✅" : "  "} ${r.label} | ${r.type} | ${v}`.slice(0, 240));
  }
})();
