/**
 * Phase 0 只读实测：搞清「接单」(status=0 待接单 → 可发货)机制，零副作用。
 * 取一个真实 status=0 待接单单，只读调三接口看它能否进发货流程：
 *  - purchaseorderv2.get：实时状态 + isCanJoinDeliverPlatform(是否可加发货台)字段
 *  - receiveaddressv2.get：能否取大仓收货地址(现有注释:只有可发货状态能取到)
 *  - staging.get：发货台里有没有它
 * 用法(服务器)：TEMU_OPENAPI_APP_SECRET=xxx NODE_PATH=/opt/temu-automation/node_modules node /tmp/probe-consign-accept.cjs
 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
if (!APP_SECRET) { console.error("缺 TEMU_OPENAPI_APP_SECRET"); process.exit(1); }

// 抽 3 个不同店的 status=0 待接单单(样本多一点，避免单店特例)
const rows = db.prepare(`
  SELECT mall_id, raw_json FROM erp_temu_openapi_records
  WHERE source='purchase_order' AND json_extract(raw_json,'$.status')=0
  GROUP BY mall_id LIMIT 3`).all();
if (!rows.length) { console.log("无 status=0 待接单单"); process.exit(0); }

async function call(creds, type, biz) {
  try {
    const r = await callOpenApi({ ...creds, type, bizParams: biz, timeoutMs: 25000 });
    const b = r.response || {};
    return { ok: b.success === true, code: b.errorCode, msg: b.errorMsg, result: b.result };
  } catch (e) { return { ok: false, msg: e.message }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const row of rows) {
    const it = JSON.parse(row.raw_json);
    const mallId = row.mall_id;
    const wb = String(it.subPurchaseOrderSn);
    const sk = (it.skuQuantityDetailList || [])[0] || {};
    const auth = db.prepare("SELECT app_key, app_secret, access_token, region FROM erp_temu_openapi_auth WHERE mall_id=? AND status='active'").get(String(mallId));
    if (!auth) { console.log(`\n# mall=${mallId} 无凭证，跳过`); continue; }
    const creds = { appKey: auth.app_key || APP_KEY, appSecret: auth.app_secret || APP_SECRET, accessToken: auth.access_token, region: auth.region || "CN" };

    console.log(`\n# ==== mall=${mallId} WB=${wb} ====`);
    console.log(`#  采集快照: 货品=${it.productName} skuId=${sk.productSkuId} skcId=${it.productSkcId} 建议量=${sk.adviceQuantity} 下单量=${sk.purchaseQuantity}`);

    // 1. 实时状态 + 是否可加发货台(关键字段)
    const po = await call(creds, "bg.purchaseorderv2.get", { pageNo: 1, pageSize: 10, subPurchaseOrderSnList: [wb] });
    if (po.ok) {
      const o = ((po.result && po.result.subOrderForSupplierList) || [])[0];
      if (o) {
        const sk0 = (o.skuQuantityDetailList || [])[0] || {};
        console.log(`  [1] purchaseorderv2: 实时status=${o.status}(0待接单/1已接单) source=${o.source} settlementType=${o.settlementType}`);
        console.log(`      ★ isCanJoinDeliverPlatform(可加发货台)=${o.isCanJoinDeliverPlatform}  todayCanDeliver=${o.todayCanDeliver}  applyDeleteStatus=${o.applyDeleteStatus}`);
        console.log(`      sku: adviceQuantity=${sk0.adviceQuantity} purchaseQuantity=${sk0.purchaseQuantity} purchaseUpLimit=${sk0.purchaseUpLimit} supportIncreaseNum=${sk0.supportIncreaseNum}`);
      } else console.log(`  [1] purchaseorderv2: 查不到该单(可能已流转/作废)`);
    } else console.log(`  [1] purchaseorderv2 失败 code=${po.code} ${po.msg}`);
    await sleep(700);

    // 2. 能否取大仓收货地址(只有可发货状态能取到)
    const rav = await call(creds, "bg.shiporder.receiveaddressv2.get", { subPurchaseOrderSnList: [wb] });
    if (rav.ok) {
      const grp = ((rav.result && rav.result.subPurchaseReceiveAddressGroups) || [])[0];
      console.log(`  [2] receiveaddressv2: 成功 ${grp && grp.receiveAddressInfo ? "→ 取到收货地址(该单可发货!)" : "→ 返回空(不可发货)"}`);
    } else console.log(`  [2] receiveaddressv2: 失败 code=${rav.code} ${rav.msg} (→ 待接单单不可直接发货)`);
    await sleep(700);

    // 3. 发货台里有没有它
    const sg = await call(creds, "bg.shiporder.staging.get", { pageSize: 50, pageNo: 1 });
    if (sg.ok) {
      const list = (sg.result && sg.result.list) || [];
      const hit = list.find((x) => x && x.subPurchaseOrderBasicVO && String(x.subPurchaseOrderBasicVO.subPurchaseOrderSn) === wb);
      console.log(`  [3] staging.get: 发货台共 ${sg.result.total} 单；这个待接单单在发货台里=${hit ? "在" : "不在"}`);
    } else console.log(`  [3] staging.get 失败 code=${sg.code} ${sg.msg}`);
    await sleep(700);
  }
  console.log("\n# 结论判读：若 isCanJoinDeliverPlatform=true 且 receiveaddressv2 能取到地址 → 待接单单可直接进发货流程(接单=加发货台/建发货单)；");
  console.log("# 若 false/取不到 → status=0 必须先有独立接单动作才能发货，而 OPEN API 无 accept 接口 → 全自动接单走不通(只能后台/平台自动接)。");
})();
