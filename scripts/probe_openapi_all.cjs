/**
 * 全量探针：对 Temu 开放平台「整个 API 文档」里的读接口逐个实调，报告每个能采到什么数据。
 * 只调读接口；写接口（发品/搬运/编辑/报名提交/库存编辑/文件上传/校验）不在此脚本内。
 * 用法（服务器上）：TEMU_OPENAPI_APP_SECRET=xxx node probe_openapi_all.cjs [mallId]
 */
"use strict";
const path = require("node:path");
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");

const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
if (!APP_SECRET) { console.error("缺 TEMU_OPENAPI_APP_SECRET"); process.exit(1); }

const argMall = process.argv[2];
// 选一个有商品的活跃店铺
let mall;
if (argMall) {
  mall = db.prepare("SELECT mall_id, region, access_token FROM erp_temu_openapi_auth WHERE mall_id=? AND status='active'").get(argMall);
} else {
  mall = db.prepare(`SELECT a.mall_id, a.region, a.access_token, COUNT(p.product_id) c
    FROM erp_temu_openapi_auth a LEFT JOIN erp_temu_openapi_products p ON p.mall_id=a.mall_id
    WHERE a.status='active' GROUP BY a.mall_id ORDER BY c DESC LIMIT 1`).get();
}
if (!mall) { console.error("无可用绑定店铺"); process.exit(1); }
const REGION = mall.region || "CN";
const TOKEN = mall.access_token;
console.log(`# 探针店铺 mall_id=${mall.mall_id} region=${REGION}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shape(v, depth = 0) {
  if (v === null || v === undefined) return v === null ? "null" : "undef";
  if (Array.isArray(v)) return `Array(${v.length})` + (v.length && depth < 2 ? `<${shape(v[0], depth + 1)}>` : "");
  if (typeof v === "object") {
    const ks = Object.keys(v);
    if (depth >= 2) return `{${ks.length} keys}`;
    return "{" + ks.slice(0, 30).map((k) => `${k}:${shape(v[k], depth + 1)}`).join(", ") + (ks.length > 30 ? ", ..." : "") + "}";
  }
  if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  return String(v);
}

const results = [];
async function probe(label, type, bizParams = {}, region = REGION) {
  let out = { label, type, region, params: bizParams };
  try {
    const r = await callOpenApi({ type, appKey: APP_KEY, appSecret: APP_SECRET, accessToken: TOKEN, region, bizParams, timeoutMs: 25000 });
    const b = r.response || {};
    out.success = !!b.success;
    out.errorCode = b.errorCode;
    out.errorMsg = b.errorMsg;
    if (b.success) out.resultShape = shape(b.result);
    else out.rawShape = shape(b);
  } catch (e) {
    out.success = false;
    out.error = e.message;
  }
  results.push(out);
  const tag = out.success ? "OK " : "ERR";
  console.log(`[${tag}] ${label}  (${type})`);
  if (out.success) console.log(`      result=${out.resultShape}`);
  else console.log(`      errorCode=${out.errorCode} errorMsg=${out.errorMsg || out.error}`);
  await sleep(700);
  return out;
}

(async () => {
  // ===== 基础 =====
  await probe("授权信息", "bg.open.accesstoken.info.get", {});
  await probe("店铺信息", "bg.mall.info.get", {});

  // ===== 货品 =====
  const list = await probe("商品列表", "bg.goods.list.get", { pageNo: 1, pageSize: 5 });
  // 从列表抽一个 productId / skcId / skuId / catId
  let productId, skcId, skuId, cat1Id, cat2Id, cat3Id;
  try {
    const items = list?.success && list.resultShape ? null : null;
    const rr = await callOpenApi({ type: "bg.goods.list.get", appKey: APP_KEY, appSecret: APP_SECRET, accessToken: TOKEN, region: REGION, bizParams: { pageNo: 1, pageSize: 5 } });
    const data = rr.response?.result || {};
    const arr = data.goodsList || data.list || data.data || data.dataList || (Array.isArray(data) ? data : []);
    const first = Array.isArray(arr) ? arr[0] : null;
    if (first) {
      productId = first.productId || first.goodsId || first.productSpuId;
      skcId = first.productSkcId || (first.skcList && first.skcList[0]?.productSkcId) || (first.productSkcList && first.productSkcList[0]?.productSkcId);
      const skcObj = (first.skcList && first.skcList[0]) || (first.productSkcList && first.productSkcList[0]) || {};
      skuId = (skcObj.skuList && skcObj.skuList[0]?.productSkuId) || (skcObj.productSkuList && skcObj.productSkuList[0]?.productSkuId);
      cat1Id = first.cat1Id || first.catId; cat2Id = first.cat2Id; cat3Id = first.cat3Id;
      console.log(`      ↳ 抽样 productId=${productId} skcId=${skcId} skuId=${skuId} cat1=${cat1Id}`);
    }
  } catch (e) { console.log("      ↳ 抽样失败:", e.message); }

  if (productId) {
    await probe("商品详情", "bg.goods.detail.get", { productId });
  } else {
    console.log("[SKIP] 商品详情 — 无 productId\n");
  }
  await probe("爆款售罄", "bg.goods.topselling.soldout.get", { pageNo: 1, pageSize: 5 });
  await probe("生命周期状态", "bg.product.search", { pageNo: 1, pageSize: 5 });
  await probe("品牌查询", "bg.goods.brand.get", { page: 1, pageSize: 5 });
  await probe("建议申报参考价(productId)", "bg.goods.suggest.supplyprice.get", productId ? { productId } : {});
  await probe("可绑定发货仓", "bg.goods.warehouse.list.get", {});
  await probe("运费模板列表", "bg.logistics.template.get", {});

  // ===== 销售 =====
  await probe("销售分仓组数据", "bg.goods.salesv2.get", { pageNo: 1, pageSize: 5 });

  // ===== 申报价/核价/调价 =====
  await probe("货品供货价(productId)", "bg.goods.price.list.get", productId ? { productIdList: [productId] } : {});
  await probe("核价单分页", "bg.price.review.page.query", { pageNo: 1, pageSize: 5 });
  await probe("半托调价单分页", "bg.semi.adjust.price.page.query", { pageNo: 1, pageSize: 5 });
  await probe("全托调价单分页", "bg.full.adjust.price.page.query", { pageNo: 1, pageSize: 5 });

  // ===== 活动 =====
  const act = await probe("活动列表", "bg.marketing.activity.list.get", { pageNo: 1, pageSize: 5 });
  let activityId;
  try {
    const rr = await callOpenApi({ type: "bg.marketing.activity.list.get", appKey: APP_KEY, appSecret: APP_SECRET, accessToken: TOKEN, region: REGION, bizParams: { pageNo: 1, pageSize: 5 } });
    const data = rr.response?.result || {};
    const arr = data.activityList || data.list || data.dataList || [];
    activityId = Array.isArray(arr) && arr[0] ? (arr[0].activityId || arr[0].id) : undefined;
    console.log(`      ↳ activityId=${activityId}`);
  } catch {}
  await probe("活动详情", "bg.marketing.activity.detail.get", activityId ? { activityId } : {});
  await probe("活动商品", "bg.marketing.activity.product.get", activityId ? { activityId, pageNo: 1, pageSize: 5 } : {});
  await probe("活动场次列表", "bg.marketing.activity.session.list.get", activityId ? { activityId } : {});
  await probe("活动报名记录", "bg.marketing.activity.enroll.list.get", { pageNo: 1, pageSize: 5 });

  // ===== 库存(PA) =====
  await probe("虚拟库存JIT(skcId)", "bg.qtg.stock.virtualinventoryjit.get", skcId ? { productSkcId: skcId } : {}, "PA");

  console.log("\n# ===== 汇总 =====");
  for (const r of results) {
    console.log(`${r.success ? "✅" : "❌"} ${r.label} | ${r.type} | ${r.success ? r.resultShape : (r.errorMsg || r.error || ("code=" + r.errorCode))}`.slice(0, 300));
  }
})();
