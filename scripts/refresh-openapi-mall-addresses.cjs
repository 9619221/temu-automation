"use strict";

/**
 * 刷新「本店发货地址」缓存到 erp_temu_malls.send_address_json。
 *
 * 遍历所有有官方授权凭证的店（erp_temu_openapi_auth status=active），调
 * bg.mall.address.get 取该店的发货地址列表，写回 erp_temu_malls.send_address_json。
 * 出库中心「发货地址」列直接读这个缓存，免每次实时调 Temu。
 *
 * 发货地址极少变，每天 cron 跑一次即可；运营在后台改了发货地址，手动跑本脚本可立即刷新。
 *
 * 用法：node scripts/refresh-openapi-mall-addresses.cjs
 *   ERP_DB_PATH 可覆盖库路径（默认服务器 /opt/temu-erp-data/erp.sqlite）。
 */

const Database = require("better-sqlite3");
const { getMallShipCreds } = require("../electron/erp/services/temuOpenApiShipping.cjs");
const { callOpenApi } = require("../electron/erp/temuOpenApiClient.cjs");

const DB_PATH = process.env.ERP_DB_PATH || "/opt/temu-erp-data/erp.sqlite";

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode=WAL");

  // 有官方授权凭证的店（按 mall_id 去重）。
  const malls = db
    .prepare(
      "SELECT DISTINCT mall_id FROM erp_temu_openapi_auth " +
        "WHERE status='active' AND access_token IS NOT NULL AND access_token != ''",
    )
    .all();

  const upd = db.prepare(
    "UPDATE erp_temu_malls SET send_address_json = ?, updated_at = ? WHERE mall_id = ?",
  );

  let ok = 0;
  let miss = 0;
  let fail = 0;
  for (const m of malls) {
    const mallId = String(m.mall_id);
    try {
      const creds = getMallShipCreds(db, mallId);
      const r = await callOpenApi({ ...creds, type: "bg.mall.address.get", bizParams: {} });
      const body = r && r.response;
      if (!body || body.success !== true) {
        throw new Error((body && body.errorMsg) || "mall.address.get 返回失败");
      }
      const res = body.result;
      const list = Array.isArray(res)
        ? res
        : res && typeof res === "object"
          ? Object.values(res)
          : [];
      const info = upd.run(JSON.stringify(list), new Date().toISOString(), mallId);
      if (info.changes > 0) {
        ok += 1;
        console.log(`[mall-addr] ${mallId}: ${list.length} 地址, 已更新`);
      } else {
        // 该店在 erp_temu_malls 没有字典行（绑定登记缺失），跳过——发货地址列对它会空。
        miss += 1;
        console.warn(`[mall-addr] ${mallId}: erp_temu_malls 无字典行，跳过（${list.length} 地址未落地）`);
      }
    } catch (e) {
      fail += 1;
      console.error(`[mall-addr] ${mallId}: ${e.message}`);
    }
  }

  console.log(`[mall-addr] 完成：更新 ${ok}、无字典行 ${miss}、失败 ${fail}（共 ${malls.length} 店）`);
  db.close();
}

main().catch((e) => {
  console.error("[mall-addr] 致命错误:", e);
  process.exit(1);
});
