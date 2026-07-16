/**
 * 一次性回填 mig110 加的商品列表现成字段（skc_id / thumb_url / ext_code / skus_json）。
 *
 * 用法（服务器，走 PG）：
 *   PG_CONNECTION_STRING=... node scripts/backfill-temu-openapi-product-cols.cjs
 * 桌面端 sqlite 同理直接 node 跑（不设 PG_CONNECTION_STRING 即读本地 erp.sqlite）。
 *
 * 只处理 skc_id 为空的行，可重复执行；分批提交避免长事务。
 */
"use strict";

const { openErpDatabase, queryAll, execute } = require("../electron/db/connection.cjs");
const { deriveProductListColumns } = require("../electron/erp/services/temuOpenApiProductSync.cjs");

const BATCH = 500;

async function main() {
  const db = await openErpDatabase();
  let total = 0;
  let failed = 0;
  for (;;) {
    const rows = await queryAll(db, `
      SELECT mall_id, product_id, raw_json
      FROM erp_temu_openapi_products
      WHERE skc_id IS NULL AND raw_json IS NOT NULL
      LIMIT ${BATCH}
    `);
    if (!rows.length) break;
    let progressed = 0;
    for (const row of rows) {
      let item = null;
      try { item = JSON.parse(row.raw_json); } catch { /* 脏数据跳过 */ }
      const derived = item ? deriveProductListColumns(item) : null;
      if (!derived || !derived.skcId) {
        // 解析不出 skc_id 的行标记为空串占位，避免死循环反复扫到
        await execute(db, `
          UPDATE erp_temu_openapi_products SET skc_id = '' WHERE mall_id = @mall_id AND product_id = @product_id
        `, { mall_id: row.mall_id, product_id: row.product_id });
        failed += 1;
        progressed += 1;
        continue;
      }
      await execute(db, `
        UPDATE erp_temu_openapi_products
        SET skc_id = @skc_id, thumb_url = @thumb_url, ext_code = @ext_code, skus_json = @skus_json
        WHERE mall_id = @mall_id AND product_id = @product_id
      `, { skc_id: derived.skcId, thumb_url: derived.thumbUrl, ext_code: derived.extCode, skus_json: derived.skusJson, mall_id: row.mall_id, product_id: row.product_id });
      total += 1;
      progressed += 1;
    }
    console.log(`[backfill] 已回填 ${total} 行（无法解析 ${failed} 行）`);
    if (!progressed) break;
  }
  console.log(`[backfill] 完成：回填 ${total} 行，无法解析 ${failed} 行`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] 失败:", e);
  process.exit(1);
});
