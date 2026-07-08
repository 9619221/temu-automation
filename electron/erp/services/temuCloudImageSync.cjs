const { queryAll, execute, withTransaction} = require("../../db/connection.cjs");
// 从官方 API 已采集的 erp_temu_openapi_products.mainImageUrl 回填 erp_skus.image_url。
//
// 匹配关系：erp_temu_openapi_skus.ext_code（SKU 货号）== erp_skus.internal_sku_code（商品编码）。
// 只回填 image_url 为空的行，绝不覆盖已有图。
//
// 第二步兜底：Temu 官方图跑完后仍无图的商品，从已绑定的 1688 货源
// （erp_sku_1688_sources.image_url，绑定/找货时抓取的供应商图）回填，同样只补空不覆盖。

const DEFAULT_COMPANY_ID = "company_default";

function nowIso() {
  return new Date().toISOString();
}

class TemuCloudImageSync {
  constructor({ db, attachCloudDb }) {
    if (!db) throw new Error("TemuCloudImageSync requires db");
    this.db = db;
    this.attachCloudDb = attachCloudDb;
  }

  async sync(payload = {}) {
    const companyId = String(payload.companyId || payload.company_id || DEFAULT_COMPANY_ID);
    const now = nowIso();









    let candidates = 0;
    let updated = 0;
    try {
      const pairs = await queryAll(this.db, `
        SELECT s.ext_code AS code,
               json_extract(p.raw_json, '$.mainImageUrl') AS thumb
        FROM erp_temu_openapi_skus s
        JOIN erp_temu_openapi_products p
          ON p.mall_id = s.mall_id AND p.product_id = s.product_id
        WHERE s.ext_code IS NOT NULL AND s.ext_code <> ''
          AND json_extract(p.raw_json, '$.mainImageUrl') IS NOT NULL
          AND json_extract(p.raw_json, '$.mainImageUrl') <> ''
      `);
      candidates = pairs.length;
      await withTransaction(this.db, async (txDb) => {
          for (const pair of pairs) {
            const code = pair.code == null ? "" : String(pair.code).trim();
            const thumb = pair.thumb == null ? "" : String(pair.thumb).trim();
            if (!code || !thumb) continue;
            updated += (await execute(txDb, `
      UPDATE erp_skus
      SET image_url = @thumb, updated_at = @now
      WHERE company_id = @company_id
        AND internal_sku_code = @code
        AND (image_url IS NULL OR image_url = '')
    `, { company_id: companyId, code, thumb, now })).changes;}});} catch (_) {
      // erp_temu_openapi_skus/products 表可能不存在（旧版本），静默跳过
    }

    // 兜底：从 1688 货源绑定回填仍缺图的商品（默认货源优先）
    let candidates1688 = 0;
    let updated1688 = 0;
    try {
      const pairs = await queryAll(this.db, `
        SELECT source.sku_id AS sku_id, source.image_url AS thumb, source.is_default AS is_default
        FROM erp_sku_1688_sources source
        JOIN erp_skus sku ON sku.id = source.sku_id
        WHERE source.status = 'active'
          AND source.image_url IS NOT NULL AND source.image_url <> ''
          AND sku.company_id = @company_id
          AND (sku.image_url IS NULL OR sku.image_url = '')
        ORDER BY source.is_default DESC, source.updated_at DESC
      `, { company_id: companyId });
      const bySku = new Map();
      for (const pair of pairs) {
        if (!bySku.has(pair.sku_id)) bySku.set(pair.sku_id, String(pair.thumb).trim());
      }
      candidates1688 = bySku.size;
      await withTransaction(this.db, async (txDb) => {
        for (const [skuId, thumb] of bySku) {
          if (!thumb) continue;
          updated1688 += (await execute(txDb, `
      UPDATE erp_skus
      SET image_url = @thumb, updated_at = @now
      WHERE id = @sku_id
        AND company_id = @company_id
        AND (image_url IS NULL OR image_url = '')
    `, { company_id: companyId, sku_id: skuId, thumb, now })).changes;
        }
      });
    } catch (_) {
      // erp_sku_1688_sources 表可能不存在（旧版本），静默跳过
    }

    return { companyId,
      candidates,
      updated,
      candidates1688,
      updated1688,
      finishedAt: nowIso()
    };
  }
}

module.exports = {
  TemuCloudImageSync,
  DEFAULT_COMPANY_ID
};