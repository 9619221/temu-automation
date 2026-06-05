/**
 * 探针：实调 bg.shiporderv2.get，统计「今日发出的首单数」。
 *
 * 验证目的（只读，零副作用，不创建/不撤销任何发货单）：
 *   1. isFirst 字段是否真按预期标识「首单」
 *   2. deliverTimeFrom/To 按发货时间筛是否生效
 *   3. 今天真实有几个首单发出（按采购子单号 subPurchaseOrderSn 去重）
 *
 * 用法（服务器上跑，service 同环境拿 APP_SECRET）：
 *   TEMU_OPENAPI_APP_SECRET=xxx node scripts/probe-ship-firstorder-today.cjs [limitStores] [dayOffset]
 *   limitStores 省略=全部店；传数字=只跑前 N 个店（先跑 3 个定性）
 *   dayOffset   省略=今天；-1=昨天（昨天数据更全，便于验证 isFirst 口径）
 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite", { readonly: true });
const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
if (!APP_SECRET) { console.error("缺 TEMU_OPENAPI_APP_SECRET（service 环境里有，命令行需自行注入）"); process.exit(1); }

// 发货时间范围：按北京时间(UTC+8)「某天 0 点 ~ 当天结束」，与服务器系统时区无关。
const dayOffset = process.argv[3] ? parseInt(process.argv[3], 10) : 0;
const BJ = 8 * 3600000, DAY = 86400000;
const nowMs = Date.now();
const bjMidnightToday = Math.floor((nowMs + BJ) / DAY) * DAY - BJ; // 北京今天0点的真实 UTC ms
const deliverTimeFrom = bjMidnightToday + dayOffset * DAY;
const deliverTimeTo = dayOffset === 0 ? nowMs : deliverTimeFrom + DAY - 1;
const fmt = (ms) => new Date(ms + BJ).toISOString().replace("T", " ").slice(0, 19) + " (北京)";
console.log(`# 发货时间范围: ${fmt(deliverTimeFrom)} ~ ${fmt(deliverTimeTo)}`);

const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
let stores = db.prepare("SELECT mall_id, region, access_token FROM erp_temu_openapi_auth WHERE status='active' ORDER BY mall_id").all();
const totalActive = stores.length;
if (limit) stores = stores.slice(0, limit);
console.log(`# active 店总数 ${totalActive}, 本次跑 ${stores.length}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 兼容 isFirst 可能直接挂 item、也可能在关联采购单信息 subPurchaseOrderBasicVO 里
const pick = (it, k) => (it && it[k] != null ? it[k] : (it && it.subPurchaseOrderBasicVO ? it.subPurchaseOrderBasicVO[k] : undefined));

(async () => {
  let grandFirst = 0, grandShip = 0;
  const samples = [];
  for (const st of stores) {
    const region = st.region || "CN";
    const firstSns = new Set();  // 首单去重（按采购子单号）
    const allSns = new Set();    // 全部发货去重（对照）
    let pageNo = 1, total = null, pages = 0, listKeySeen = null;
    try {
      while (pages < 60) {
        const r = await callOpenApi({
          type: "bg.shiporderv2.get", appKey: APP_KEY, appSecret: APP_SECRET,
          accessToken: st.access_token, region,
          bizParams: { deliverTimeFrom, deliverTimeTo, pageSize: 100, pageNo },
          timeoutMs: 30000,
        });
        const result = (r && r.response && r.response.result) || {};
        const list = result.list || [];
        if (total == null) total = result.total;
        for (const it of list) {
          const sn = it.subPurchaseOrderSn;
          const vo = it.subPurchaseOrderBasicVO;
          const isFirst = !!(vo && vo.isFirst === true);
          if (sn) allSns.add(String(sn));
          if (isFirst && sn) {
            firstSns.add(String(sn));
            if (samples.length < 10) samples.push({
              mall: st.mall_id, subPurchaseOrderSn: String(sn),
              deliveryOrderSn: it.deliveryOrderSn, extCode: it.skcExtCode,
              deliverTime: it.deliverTime ? fmt(it.deliverTime) : null, status: it.status,
            });
          }
        }
        pages++;
        if (list.length < 100) break;
        pageNo++;
      }
      grandFirst += firstSns.size; grandShip += allSns.size;
      console.log(`${st.mall_id}: 发货(去重子单)=${allSns.size}  首单=${firstSns.size}  [接口 total 报 ${total}]`);
    } catch (e) {
      console.log(`${st.mall_id}: ERR ${String((e && e.message) || e)}`);
    }
    await sleep(300);
  }
  console.log(`\n# 合计：今日发货(去重子单)=${grandShip}  今日首单发出=${grandFirst}`);
  if (samples.length) { console.log(`# 首单样本(验证 isFirst/发货时间口径)：`); for (const s of samples) console.log("  ", JSON.stringify(s)); }
  else console.log(`# 无首单样本（可能今天确实没有首单发出，或 dayOffset 试 -1 看昨天）`);
})();
