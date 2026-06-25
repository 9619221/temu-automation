"use strict";

const { queryAll, queryOne, execute, withTransaction } = require("../../db/connection.cjs");

function nowIso() { return new Date().toISOString(); }

async function listCarrierMap(db, opts = {}) {
  const mallId = opts.mallId ? String(opts.mallId) : null;
  return mallId
    ? await queryAll(db, "SELECT * FROM erp_auto_ship_carrier_map WHERE mall_id = ? ORDER BY updated_at DESC", [mallId])
    : await queryAll(db, "SELECT * FROM erp_auto_ship_carrier_map ORDER BY mall_id, updated_at DESC");
}

async function upsertCarrierMap(db, rows, actor) {
  const list = Array.isArray(rows) ? rows : [];
  const now = nowIso();
  let n = 0, skipped = 0;
  await withTransaction(db, async (txDb) => {
    for (const r of list) {
      if (!r.mallId || !r.productId) { skipped += 1; continue; }
      await execute(txDb, `
        INSERT INTO erp_auto_ship_carrier_map
          (mall_id, product_id, ext_code, product_name, express_company_id, express_company_name, pickup_pref, note, updated_at, updated_by)
        VALUES
          (@mall_id, @product_id, @ext_code, @product_name, @express_company_id, @express_company_name, @pickup_pref, @note, @updated_at, @updated_by)
        ON CONFLICT(mall_id, product_id) DO UPDATE SET
          ext_code=excluded.ext_code, product_name=excluded.product_name,
          express_company_id=excluded.express_company_id, express_company_name=excluded.express_company_name,
          pickup_pref=excluded.pickup_pref, note=excluded.note, updated_at=excluded.updated_at, updated_by=excluded.updated_by`, {
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
  return { upserted: n, skipped };
}

async function deleteCarrierMap(db, { mallId, productId }) {
  const r = await execute(db, "DELETE FROM erp_auto_ship_carrier_map WHERE mall_id = ? AND product_id = ?", [String(mallId), String(productId)]);
  return { deleted: r.changes };
}

async function getDefault(db) {
  return await queryOne(db, 'SELECT carrier_strategy AS "carrierStrategy", pickup_pref AS "pickupPref" FROM erp_auto_ship_default WHERE id = 1')
    || { carrierStrategy: "most_used_then_cheapest", pickupPref: "asap" };
}

async function setDefault(db, { carrierStrategy, pickupPref }, actor) {
  await execute(db, "UPDATE erp_auto_ship_default SET carrier_strategy = ?, pickup_pref = ?, updated_at = ?, updated_by = ? WHERE id = 1",
    [carrierStrategy || "most_used_then_cheapest", pickupPref || "asap", nowIso(), actor || null]);
  return getDefault(db);
}

function pickByStrategy(companies, mostUsed, strategy) {
  if (!companies || !companies.length) return null;
  const cheapest = () => companies.slice().sort((a, b) => (a.minCharge ?? Infinity) - (b.minCharge ?? Infinity))[0];
  const used = () => (mostUsed && companies.find((c) => String(c.expressCompanyId) === String(mostUsed.expressCompanyId))) || (mostUsed && mostUsed.expressCompanyId ? mostUsed : null);
  if (strategy === "cheapest") return cheapest();
  if (strategy === "most_used") return used() || cheapest();
  return used() || cheapest();
}

async function resolveCarrier(db, { mallId, productId, match, def }) {
  const companies = (match && Array.isArray(match.companies)) ? match.companies : [];
  const dft = def || await getDefault(db);
  const mapRow = productId
    ? await queryOne(db, "SELECT express_company_id, express_company_name, pickup_pref FROM erp_auto_ship_carrier_map WHERE mall_id = ? AND product_id = ?", [String(mallId), String(productId)])
    : null;

  if (mapRow && (mapRow.express_company_id || mapRow.express_company_name)) {
    const hit = companies.find((c) =>
      (mapRow.express_company_id && String(c.expressCompanyId) === String(mapRow.express_company_id)) ||
      (mapRow.express_company_name && c.expressCompanyName === mapRow.express_company_name));
    if (hit) return { ...hit, pickupPref: mapRow.pickup_pref || dft.pickupPref, source: "map" };
  }
  const pickupPref = (mapRow && mapRow.pickup_pref) || dft.pickupPref;
  const picked = pickByStrategy(companies, match && match.mostUsed, dft.carrierStrategy);
  return picked ? { ...picked, pickupPref, source: mapRow ? "map_fallback_default" : "default" } : null;
}

async function listShippableProducts(db) {
  const seen = new Map();
  const rows = await queryAll(db, "SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'");
  for (const r of rows) {
    let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
    if (Number(it.status) !== 1) continue;
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
  const mapRows = await queryAll(db, "SELECT mall_id, product_id, express_company_id, express_company_name, pickup_pref FROM erp_auto_ship_carrier_map");
  const mapByKey = new Map(mapRows.map((m) => [m.mall_id + "|" + m.product_id, m]));
  for (const p of products) {
    const m = mapByKey.get(p.mallId + "|" + p.productId);
    p.expressCompanyId = m ? m.express_company_id : null;
    p.expressCompanyName = m ? m.express_company_name : null;
    p.pickupPref = m ? m.pickup_pref : null;
    p.configured = Boolean(m && (m.express_company_id || m.express_company_name));
  }
  products.sort((a, b) => Number(a.configured) - Number(b.configured));
  return products;
}

module.exports = { listCarrierMap, upsertCarrierMap, deleteCarrierMap, getDefault, setDefault, resolveCarrier, pickByStrategy, listShippableProducts };
