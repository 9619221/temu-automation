"use strict";

/**
 * 采购自动发货「快递映射表」服务：按 (店铺, 商品 SPU) 配指定快递 + 揽收时段；没配的退默认策略。
 * 表见 migration 080。维护：前端配置页 + Excel 批量导入。
 * resolveCarrier 给自动发货编排用——从 logisticsmatch 候选里按映射/默认策略选快递。
 */

function nowIso() { return new Date().toISOString(); }

// 列映射(可按店)。
function listCarrierMap(db, opts = {}) {
  const mallId = opts.mallId ? String(opts.mallId) : null;
  return mallId
    ? db.prepare("SELECT * FROM erp_auto_ship_carrier_map WHERE mall_id = ? ORDER BY updated_at DESC").all(mallId)
    : db.prepare("SELECT * FROM erp_auto_ship_carrier_map ORDER BY mall_id, updated_at DESC").all();
}

// 批量 upsert(配置 / Excel 导入)。rows=[{mallId,productId,extCode?,productName?,expressCompanyId?,expressCompanyName?,pickupPref?,note?}]
function upsertCarrierMap(db, rows, actor) {
  const list = Array.isArray(rows) ? rows : [];
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO erp_auto_ship_carrier_map
      (mall_id, product_id, ext_code, product_name, express_company_id, express_company_name, pickup_pref, note, updated_at, updated_by)
    VALUES
      (@mall_id, @product_id, @ext_code, @product_name, @express_company_id, @express_company_name, @pickup_pref, @note, @updated_at, @updated_by)
    ON CONFLICT(mall_id, product_id) DO UPDATE SET
      ext_code=excluded.ext_code, product_name=excluded.product_name,
      express_company_id=excluded.express_company_id, express_company_name=excluded.express_company_name,
      pickup_pref=excluded.pickup_pref, note=excluded.note, updated_at=excluded.updated_at, updated_by=excluded.updated_by`);
  let n = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const r of list) {
      if (!r.mallId || !r.productId) { skipped += 1; continue; }
      stmt.run({
        mall_id: String(r.mallId),
        product_id: String(r.productId),
        ext_code: r.extCode != null ? String(r.extCode) : null,
        product_name: r.productName != null ? String(r.productName) : null,
        express_company_id: r.expressCompanyId != null && r.expressCompanyId !== "" ? String(r.expressCompanyId) : null,
        express_company_name: r.expressCompanyName != null && r.expressCompanyName !== "" ? String(r.expressCompanyName) : null,
        pickup_pref: r.pickupPref != null && r.pickupPref !== "" ? String(r.pickupPref) : null,
        note: r.note != null ? String(r.note) : null,
        updated_at: now,
        updated_by: actor || null,
      });
      n += 1;
    }
  });
  tx();
  return { upserted: n, skipped };
}

function deleteCarrierMap(db, { mallId, productId }) {
  const r = db.prepare("DELETE FROM erp_auto_ship_carrier_map WHERE mall_id = ? AND product_id = ?").run(String(mallId), String(productId));
  return { deleted: r.changes };
}

function getDefault(db) {
  return db.prepare("SELECT carrier_strategy AS carrierStrategy, pickup_pref AS pickupPref FROM erp_auto_ship_default WHERE id = 1").get()
    || { carrierStrategy: "most_used_then_cheapest", pickupPref: "asap" };
}
function setDefault(db, { carrierStrategy, pickupPref }, actor) {
  db.prepare("UPDATE erp_auto_ship_default SET carrier_strategy = ?, pickup_pref = ?, updated_at = ?, updated_by = ? WHERE id = 1")
    .run(carrierStrategy || "most_used_then_cheapest", pickupPref || "asap", nowIso(), actor || null);
  return getDefault(db);
}

// 按策略从候选里选快递。companies=[{expressCompanyId,expressCompanyName,predictId,minCharge,...}]
function pickByStrategy(companies, mostUsed, strategy) {
  if (!companies || !companies.length) return null;
  const cheapest = () => companies.slice().sort((a, b) => (a.minCharge ?? Infinity) - (b.minCharge ?? Infinity))[0];
  const used = () => (mostUsed && companies.find((c) => String(c.expressCompanyId) === String(mostUsed.expressCompanyId))) || (mostUsed && mostUsed.expressCompanyId ? mostUsed : null);
  if (strategy === "cheapest") return cheapest();
  if (strategy === "most_used") return used() || cheapest();
  return used() || cheapest(); // most_used_then_cheapest(默认)
}

// 给自动发货编排选快递：按(mallId,productId)查映射→指定快递在候选里命中就用；否则退默认策略。
// match = getOfficialLogisticsMatch 返回 { mostUsed, companies:[...] }
// 返回 { expressCompanyId, expressCompanyName, predictId, minCharge, pickupPref, source } 或 null。
function resolveCarrier(db, { mallId, productId, match, def }) {
  const companies = (match && Array.isArray(match.companies)) ? match.companies : [];
  const dft = def || getDefault(db);
  const mapRow = productId
    ? db.prepare("SELECT express_company_id, express_company_name, pickup_pref FROM erp_auto_ship_carrier_map WHERE mall_id = ? AND product_id = ?").get(String(mallId), String(productId))
    : null;

  if (mapRow && (mapRow.express_company_id || mapRow.express_company_name)) {
    const hit = companies.find((c) =>
      (mapRow.express_company_id && String(c.expressCompanyId) === String(mapRow.express_company_id)) ||
      (mapRow.express_company_name && c.expressCompanyName === mapRow.express_company_name));
    if (hit) return { ...hit, pickupPref: mapRow.pickup_pref || dft.pickupPref, source: "map" };
    // 指定快递不在候选里 → 退默认策略，揽收仍用映射的偏好
  }
  const pickupPref = (mapRow && mapRow.pickup_pref) || dft.pickupPref;
  const picked = pickByStrategy(companies, match && match.mostUsed, dft.carrierStrategy);
  return picked ? { ...picked, pickupPref, source: mapRow ? "map_fallback_default" : "default" } : null;
}

// 列「已接单待发货(status=1)」备货单涉及的商品(去重) + 现有映射配置。供前端表格 + Excel 模板导出。
function listShippableProducts(db) {
  const seen = new Map();
  const stmt = db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'");
  for (const r of stmt.iterate()) {
    let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
    if (Number(it.status) !== 1) continue; // 只列已接单待发货的(自动发货实际会发的)
    if (it.productId == null) continue;
    const key = r.mall_id + "|" + String(it.productId);
    if (!seen.has(key)) {
      seen.set(key, {
        mallId: r.mall_id,
        productId: String(it.productId),
        extCode: it.productSn != null ? String(it.productSn) : null,
        productName: it.productName || null,
      });
    }
  }
  const products = [...seen.values()];
  const mapRows = db.prepare("SELECT mall_id, product_id, express_company_id, express_company_name, pickup_pref FROM erp_auto_ship_carrier_map").all();
  const mapByKey = new Map(mapRows.map((m) => [m.mall_id + "|" + m.product_id, m]));
  for (const p of products) {
    const m = mapByKey.get(p.mallId + "|" + p.productId);
    p.expressCompanyId = m ? m.express_company_id : null;
    p.expressCompanyName = m ? m.express_company_name : null;
    p.pickupPref = m ? m.pickup_pref : null;
    p.configured = Boolean(m && (m.express_company_id || m.express_company_name));
  }
  // 未配置的排前面(待办)
  products.sort((a, b) => Number(a.configured) - Number(b.configured));
  return products;
}

module.exports = { listCarrierMap, upsertCarrierMap, deleteCarrierMap, getDefault, setDefault, resolveCarrier, pickByStrategy, listShippableProducts };
