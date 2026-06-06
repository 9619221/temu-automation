#!/usr/bin/env node
/**
 * 聚水潭「1688 商品映射」→ erp_sku_1688_sources(供应商管理读这张表)。
 * - 仅导有 plat_offer_id 的真实映射行;
 * - 按 itemmap.sku_id == erp_skus.internal_sku_code 关联(只匹配现存 jst:skuprofile,
 *   济南已从 erp_skus 删除,故自动排除;额外再按 brand 含「济南」防御性跳过);
 * - account_id / sku_id 取自匹配到的 erp_skus(品牌=店铺归属)。
 * DRY=1 时事务回滚只报数。用法:node jushuitan-1688map-import.cjs <itemmap.json>
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function loadDb() {
  let Database;
  try { Database = require("better-sqlite3"); }
  catch { Database = require("/opt/temu-automation/node_modules/better-sqlite3"); }
  const dir = process.env.ERP_DATA_DIR || "/opt/temu-erp-data";
  return new Database(process.env.ERP_DB || path.join(dir, "erp.sqlite"));
}

const DRY = process.env.DRY === "1";

function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }
function intOr(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : d; }
// 用于映射比例:依次试每个候选值,取第一个能解析成正整数 (>=1) 的;全无则返回 null。
// 返回 null(而非兜底 1)用于区分"聚水潭确实给了比例"和"没给"——没给时不能用兜底值
// 覆盖用户在供应商管理里手改的比例(见 upsert 的 DO UPDATE CASE)。
function pickRatioOrNull(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1) return Math.trunc(n);
  }
  return null;
}

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) throw new Error("用法: node jushuitan-1688map-import.cjs <itemmap.json>");
  const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (!Array.isArray(rows)) throw new Error("JSON 非数组");

  const db = loadDb();
  db.pragma("busy_timeout = 60000");
  const now = new Date().toISOString();

  // internal_sku_code -> { id, account_id }(只含现存 jst:skuprofile,济南已删)
  const skuMap = new Map();
  for (const r of db.prepare(
    "SELECT id, internal_sku_code, account_id FROM erp_skus WHERE id LIKE 'jst:skuprofile:%'"
  ).iterate()) {
    skuMap.set(String(r.internal_sku_code), { id: r.id, account_id: r.account_id });
  }

  const upsert = db.prepare(`
    INSERT INTO erp_sku_1688_sources (
      id, account_id, sku_id, external_offer_id, external_sku_id, external_spec_id,
      supplier_name, product_title, product_url, image_url, unit_price, moq,
      lead_days, logistics_fee, status, is_default, is_no_spec, source_payload_json,
      created_by, created_at, updated_at, mapping_group_id, platform_sku_name,
      our_qty, platform_qty, remark
    ) VALUES (
      @id, @account_id, @sku_id, @external_offer_id, @external_sku_id, @external_spec_id,
      @supplier_name, @product_title, @product_url, @image_url, NULL, @moq,
      NULL, NULL, 'active', @is_default, @is_no_spec, @source_payload_json,
      NULL, @created_at, @updated_at, '', @platform_sku_name,
      @our_qty, @platform_qty, @remark
    )
    ON CONFLICT(id) DO UPDATE SET
      account_id=excluded.account_id, sku_id=excluded.sku_id,
      supplier_name=excluded.supplier_name, product_title=excluded.product_title,
      product_url=excluded.product_url, image_url=excluded.image_url,
      moq=excluded.moq, status=excluded.status, is_default=excluded.is_default,
      source_payload_json=excluded.source_payload_json,
      platform_sku_name=excluded.platform_sku_name,
      our_qty = CASE WHEN @ratio_from_jst = 1 THEN excluded.our_qty ELSE erp_sku_1688_sources.our_qty END,
      platform_qty = CASE WHEN @ratio_from_jst = 1 THEN excluded.platform_qty ELSE erp_sku_1688_sources.platform_qty END,
      remark=excluded.remark, updated_at=excluded.updated_at
  `);

  const stats = {
    total: rows.length, noOffer: 0, jinanBrand: 0, unmatched: 0,
    upserted: 0, skusCovered: new Set(),
  };

  const run = db.transaction(() => {
    for (const r of rows) {
      const offer = s(r.plat_offer_id);
      if (!offer) { stats.noOffer++; continue; }
      if (s(r.brand).includes("济南")) { stats.jinanBrand++; continue; }
      const code = s(r.sku_id);
      const hit = skuMap.get(code);
      if (!hit) { stats.unmatched++; continue; }

      const extSku = s(r.plat_sku_id);
      let extSpec = s(r.plat_spec_id);
      // 与落库口径(ipc.cjs:7229)一致:spec 与 sku 同值=伪 cargoSkuId 规整为无规格,plat_spec_id 空也按无规格;
      // id 与 unique key 都基于 extSpec,故在算 id 前规整,保证两者一致、重跑不撞 UNIQUE。
      if (extSpec && extSku && extSpec === extSku) extSpec = "";
      const acct = hit.account_id == null ? "" : String(hit.account_id);
      const id = "jst:1688src:" + crypto
        .createHash("sha1")
        .update([acct, hit.id, offer, extSku, extSpec].join("|"))
        .digest("hex")
        .slice(0, 24);

      // 聚水潭没给比例(base_qty/pack_qty/plat_map_qty 全空)时 jstOur/jstPlat 为 null。
      // INSERT 新行兜底 1:1;已存在的行靠 ratio_from_jst 在 DO UPDATE 里决定是否覆盖——
      // 没给比例就保留库里现有值,不再把用户手改的比例冲回 1:1。
      const jstOur = pickRatioOrNull(r.base_qty);
      const jstPlat = pickRatioOrNull(r.pack_qty, r.plat_map_qty);
      upsert.run({
        id,
        account_id: hit.account_id,
        sku_id: hit.id,
        external_offer_id: offer,
        external_sku_id: extSku,
        external_spec_id: extSpec,
        is_no_spec: extSpec ? 0 : 1,
        supplier_name: s(r.supplier_name) || s(r.manage_name_1688) || null,
        product_title: s(r.name) || null,
        product_url: s(r.url) || s(r.platpromotionurl) || s(r.cpsUrl) || null,
        image_url: s(r.pic) || s(r.cpsPic) || null,
        moq: intOr(r.min_order_qty, 1) || 1,
        is_default: s(r.is_default_supplier) === "是" ? 1 : 0,
        source_payload_json: JSON.stringify(r),
        platform_sku_name: s(r.manage_name_1688) || null,
        our_qty: jstOur !== null ? jstOur : 1,
        platform_qty: jstPlat !== null ? jstPlat : 1,
        ratio_from_jst: jstOur !== null || jstPlat !== null ? 1 : 0,
        remark: s(r.plat_supplier_remark) || s(r.pack_qty_remark) || s(r.healthCheckResult) || null,
        created_at: now,
        updated_at: now,
      });
      stats.upserted++;
      stats.skusCovered.add(hit.id);
    }
    if (DRY) throw new Error("__DRY__");
  });

  let rolledBack = false;
  try { run(); } catch (e) {
    if (e && e.message === "__DRY__") rolledBack = true;
    else { db.close(); throw e; }
  }

  const after = db.prepare(
    "SELECT COUNT(*) c FROM erp_sku_1688_sources WHERE id LIKE 'jst:1688src:%'"
  ).get().c;
  db.close();
  console.log(JSON.stringify({
    mode: DRY ? "DRY(已回滚)" : "WRITE",
    total: stats.total,
    skippedNoOffer: stats.noOffer,
    skippedJinanBrand: stats.jinanBrand,
    skippedUnmatched: stats.unmatched,
    upserted: stats.upserted,
    distinctSkusCovered: stats.skusCovered.size,
    erp_sku_1688_sources_jst_rows_after: after,
    rolledBack,
  }, null, 2));
}

main();
