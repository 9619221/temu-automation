/**
 * 探针4：用正确参数(startTs/endTs 毫秒时间戳)实测广告报表-店铺维度，确认流量数据可取。
 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const APP_KEY = "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
const mall = db.prepare(`SELECT a.mall_id,a.region,a.access_token,COUNT(p.product_id) c FROM erp_temu_openapi_auth a LEFT JOIN erp_temu_openapi_products p ON p.mall_id=a.mall_id WHERE a.status='active' GROUP BY a.mall_id ORDER BY c DESC LIMIT 1`).get();
const TOKEN = mall.access_token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(type, biz, region = "PA") {
  try { const r = await callOpenApi({ type, appKey: APP_KEY, appSecret: APP_SECRET, accessToken: TOKEN, region, bizParams: biz, timeoutMs: 25000 }); return r.response || {}; }
  catch (e) { return { _err: e.message }; }
}
(async () => {
  console.log("# mall=", mall.mall_id);
  // 近 7 天：startTs = 7天前 0 点(UTC近似), endTs = 昨天 23:59:59.999
  const dayMs = 86400000;
  const now = Date.now();
  const startDay = new Date(now - 7 * dayMs); startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(now - 1 * dayMs); endDay.setUTCHours(23, 59, 59, 999);
  const startTs = startDay.getTime(), endTs = endDay.getTime();
  console.log("startTs=", startTs, new Date(startTs).toISOString(), "endTs=", endTs, new Date(endTs).toISOString(), "\n");

  console.log("== 店铺维度 mall.query ==");
  let b = await call("bg.glo.searchrec.ad.reports.mall.query", { startTs, endTs });
  console.log(JSON.stringify(b).slice(0, 1800));
  await sleep(1500);

  // 单天（小时级）
  const oneStart = new Date(now - 2 * dayMs); oneStart.setUTCHours(0, 0, 0, 0);
  const oneEnd = new Date(now - 2 * dayMs); oneEnd.setUTCHours(23, 59, 59, 999);
  console.log("\n== 店铺维度 单天 ==");
  b = await call("bg.glo.searchrec.ad.reports.mall.query", { startTs: oneStart.getTime(), endTs: oneEnd.getTime() });
  console.log(JSON.stringify(b).slice(0, 1200));
})();
