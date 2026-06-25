// 采集+物化「今日创建商品」→ erp_temu_goods_created_daily(各店概览「今日创建」列)。独立 cron 进程。
// 调 bg.glo.goods.list.get(PA) 按今日(北京)createdAt 拉、按 SKC 去重;纯本地 erp.sqlite。
// 用法(crontab,建议每 30 分钟刷当天):
//   11,41 * * * * cd /opt/temu-automation && node scripts/refresh-openapi-goods-created.cjs >> /var/log/temu-openapi-goods-created.log 2>&1
"use strict";
const { openErpDatabase, closePgPool, USE_PG } = require("../electron/db/connection.cjs");
const { refreshGoodsCreatedAll } = require("../electron/erp/services/temuOpenApiGoodsCreated.cjs");

(async () => {
  const db = openErpDatabase();
  const t0 = Date.now();
  try {
    const dayOffset = Number(process.env.GOODS_CREATED_DAY_OFFSET) || 0;
    const r = await refreshGoodsCreatedAll(db, { dayOffset });
    console.log(new Date().toISOString(), "goods-created refreshed", JSON.stringify({ malls: r.malls, created: r.created, errors: r.errors.length }), "in", Date.now() - t0, "ms");
    if (r.errors.length) console.error("goods-created errors(前5):", JSON.stringify(r.errors.slice(0, 5)));
  } catch (e) {
    console.error(new Date().toISOString(), "goods-created refresh failed:", (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    if (USE_PG) await closePgPool(); else db.close();
  }
})();
