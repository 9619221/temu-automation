// 从官方 API 已采集的 erp_temu_openapi_products.mainImageUrl 回填 erp_skus.image_url。
//
// 匹配关系：erp_temu_openapi_skus.ext_code（SKU 货号）== erp_skus.internal_sku_code（商品编码）。
// 只回填 image_url 为空的行，绝不覆盖已有图。

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

  sync(payload = {}) {
    const companyId = String(payload.companyId || payload.company_id || DEFAULT_COMPANY_ID);
    const now = nowIso();

    const update = this.db.prepare(`
      UPDATE erp_skus
      SET image_url = @thumb, updated_at = @now
      WHERE company_id = @company_id
        AND internal_sku_code = @code
        AND (image_url IS NULL OR image_url = '')
    `);

    let candidates = 0;
    let updated = 0;
    try {
      const pairs = this.db.prepare(`
        SELECT s.ext_code AS code,
               json_extract(p.raw_json, '$.mainImageUrl') AS thumb
        FROM erp_temu_openapi_skus s
        JOIN erp_temu_openapi_products p
          ON p.mall_id = s.mall_id AND p.product_id = s.product_id
        WHERE s.ext_code IS NOT NULL AND s.ext_code <> ''
          AND json_extract(p.raw_json, '$.mainImageUrl') IS NOT NULL
          AND json_extract(p.raw_json, '$.mainImageUrl') <> ''
      `).all();
      candidates = pairs.length;
      this.db.transaction(() => {
        for (const pair of pairs) {
          const code = pair.code == null ? "" : String(pair.code).trim();
          const thumb = pair.thumb == null ? "" : String(pair.thumb).trim();
          if (!code || !thumb) continue;
          updated += update.run({ company_id: companyId, code, thumb, now }).changes;
        }
      })();
    } catch (_) {
      // erp_temu_openapi_skus/products 表可能不存在（旧版本），静默跳过
    }

    return {
      companyId,
      candidates,
      updated,
      finishedAt: nowIso(),
    };
  }
}

module.exports = {
  TemuCloudImageSync,
  DEFAULT_COMPANY_ID,
};
