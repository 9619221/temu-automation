// 从 cloud sqlite (ATTACH 为 cloud) 把 Temu SKU 缩略图回填进本地 ERP erp_skus.image_url。
//
// 绑定关系：用户人工把 ERP「商品编码」(internal_sku_code) 填进 Temu 商品「货号」(sku_ext_code)，
// 两者一一对应。cloud.temu_sales_snapshot 是唯一同时带 sku_ext_code + thumb_url 的快照表
// （与商品管理页「货号」列同源），故以它为图源，按 sku_ext_code == internal_sku_code 回填。
//
// 只回填 image_url 为空的行，绝不覆盖已有图。沿用 temuCloudSalesSync 的约定：
// 不按 tenant 过滤（货号全局唯一即可定位），companyId 默认 company_default。
// 本地 dev 或服务器未配 cloud sqlite 时优雅降级（attached=false），返回 updated=0 不抛错。

const DEFAULT_COMPANY_ID = "company_default";

function nowIso() {
  return new Date().toISOString();
}

function ensureCloudAttached(db, attachFn) {
  if (typeof attachFn !== "function") return false;
  return attachFn(db) === true;
}

// 取每个货号最新一张非空缩略图：先按货号取 MAX(last_updated_at)，再回连取该行 thumb_url。
function loadLatestThumbByExtCode(db) {
  return db.prepare(`
    SELECT s.sku_ext_code AS code, s.thumb_url AS thumb
    FROM cloud.temu_sales_snapshot s
    JOIN (
      SELECT sku_ext_code, MAX(last_updated_at) AS mx
      FROM cloud.temu_sales_snapshot
      WHERE sku_ext_code IS NOT NULL AND sku_ext_code <> ''
        AND thumb_url IS NOT NULL AND thumb_url <> ''
      GROUP BY sku_ext_code
    ) m ON m.sku_ext_code = s.sku_ext_code AND m.mx = s.last_updated_at
    WHERE s.thumb_url IS NOT NULL AND s.thumb_url <> ''
  `).all();
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
    if (!ensureCloudAttached(this.db, this.attachCloudDb)) {
      // 本地 dev / 服务器未配 cloud 库：不算失败，安静返回。
      return { companyId, attached: false, candidates: 0, updated: 0, finishedAt: now };
    }

    // 同货号去重后，每个货号一行（最新缩略图）。
    const pairs = loadLatestThumbByExtCode(this.db);
    if (!pairs.length) {
      return { companyId, attached: true, candidates: 0, updated: 0, finishedAt: now };
    }

    const update = this.db.prepare(`
      UPDATE erp_skus
      SET image_url = @thumb, updated_at = @now
      WHERE company_id = @company_id
        AND internal_sku_code = @code
        AND (image_url IS NULL OR image_url = '')
    `);

    let updated = 0;
    this.db.transaction(() => {
      for (const pair of pairs) {
        const code = pair.code == null ? "" : String(pair.code).trim();
        const thumb = pair.thumb == null ? "" : String(pair.thumb).trim();
        if (!code || !thumb) continue;
        updated += update.run({ company_id: companyId, code, thumb, now }).changes;
      }
    })();

    return {
      companyId,
      attached: true,
      candidates: pairs.length,
      updated,
      finishedAt: nowIso(),
    };
  }
}

module.exports = {
  TemuCloudImageSync,
  DEFAULT_COMPANY_ID,
};
