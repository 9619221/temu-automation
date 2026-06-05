/** debug：遍历找有数据的店，dump 发货单完整结构 + 所有含 "first" 的字段，定位 isFirst。只读。 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite", { readonly: true });
const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
const stores = db.prepare("SELECT mall_id,region,access_token FROM erp_temu_openapi_auth WHERE status='active' ORDER BY mall_id LIMIT 10").all();
const findFirst = (o, p, out) => {
  if (!o || typeof o !== "object") return;
  for (const k in o) {
    if (/first/i.test(k)) out.push(p + k + "=" + JSON.stringify(o[k]));
    const v = o[k];
    if (v && typeof v === "object") { if (Array.isArray(v)) { if (v[0]) findFirst(v[0], p + k + "[0].", out); } else findFirst(v, p + k + ".", out); }
  }
};
(async () => {
  for (const s of stores) {
    let r;
    try { r = await callOpenApi({ type: "bg.shiporderv2.get", appKey: APP_KEY, appSecret: APP_SECRET, accessToken: s.access_token, region: s.region || "CN", bizParams: { pageSize: 5, pageNo: 1 }, timeoutMs: 30000 }); }
    catch (e) { console.log(s.mall_id, "ERR", e.message); continue; }
    const result = (r && r.response && r.response.result) || {};
    const list = result.list || [];
    console.log(s.mall_id, "ok=" + (r && r.ok), "total=" + result.total, "listLen=" + list.length);
    if (list[0]) {
      const it = list[0];
      console.log("  item keys:", Object.keys(it).join(","));
      const out = []; findFirst(it, "", out);
      console.log("  含 first 的字段:", out.length ? out.join("  |  ") : "(无!)");
      const pd0 = (it.packageDetailList || [])[0];
      console.log("  packageDetailList[0]:", pd0 ? JSON.stringify(pd0).slice(0, 1000) : "(none)");
      return;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  console.log("前 10 店都没拉到 list（可能 API 偶发，多跑几次）");
})().catch((e) => console.log("FATAL", e && e.message));
