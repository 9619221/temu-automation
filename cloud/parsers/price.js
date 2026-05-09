// 价格 parser：把申报价 / 建议价聚合到 SKC 主体上
// - magneto/price-adjust/page-query → declared_price_cents（当前/目标价）
// - product/sku/site/suggestedPrice/pageQuery → suggested_price_cents
//
// SKU 是 SKC 的下级；同一 SKC 下多个 SKU 价格不同时，取最近一条 SKU 的价格作为
// SKC 的代表值（PriceReview 看板按 SKC 主轴展示，再钻取 SKU 明细）。

import { buildSkcUpsert } from "./index.js";

function firstDefined(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

function pickList(body) {
  return (
    body?.result?.pageItems ||
    body?.result?.dataList ||
    body?.result?.list ||
    body?.result?.items ||
    body?.data?.list ||
    body?.list ||
    null
  );
}

// 把 body 里的数字价格规范化成 cents（整数）
// 已经是 cents（字段名带 Cents / 整数 >= 1000）→ 直接用
// 否则按「元」→ ×100
function toCents(raw, fieldName) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n)) return null;
  const isCentsField = /cents?$/i.test(fieldName || "");
  if (isCentsField) return Math.round(n);
  // 整数且 >= 1000：当 cents（避免 $10 被误转成 $0.10）
  if (Number.isInteger(n) && n >= 1000) return n;
  return Math.round(n * 100);
}

function pickPriceCents(row, candidateKeys) {
  for (const k of candidateKeys) {
    const v = row?.[k];
    if (v != null && v !== "") {
      const cents = toCents(v, k);
      if (cents != null) return cents;
    }
  }
  return null;
}

export function parsePriceAdjust(db, ctx, evt, body) {
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;

  const upsert = buildSkcUpsert(db);
  const now = Date.now();
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });

  for (const row of list) {
    const skc_id = String(firstDefined(row, ["productSkcId", "skcId", "skc_id"]) || "");
    if (!skc_id) continue;

    const declared_price_cents = pickPriceCents(row, [
      "currentPriceCents", "currentPrice",
      "declaredPriceCents", "declaredPrice",
      "salePriceCents", "salePrice",
      "priceCents", "price",
    ]);
    const currency = firstDefined(row, ["currency", "currencyCode", "siteCurrency"]);

    if (declared_price_cents == null && !currency) continue;

    upsert.run({
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id: String(firstDefined(row, ["productId", "spuId"]) || "") || null,
      mall_id: ctx.mall_id || evt.mall_id || null,
      site: evt.site || null,
      title: null,
      category_id: null,
      category_name: null,
      status: null,
      thumb_url: null,
      spec_summary: null,
      declared_price_cents,
      suggested_price_cents: null,
      price_currency: currency ? String(currency).slice(0, 8) : null,
      sales_total: null,
      stock_available: null,
      compliance_status: null,
      sources_json,
      now,
    });
  }
}

export function parseSuggestedPrice(db, ctx, evt, body) {
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;

  const upsert = buildSkcUpsert(db);
  const now = Date.now();
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });

  for (const row of list) {
    const skc_id = String(firstDefined(row, ["productSkcId", "skcId", "skc_id"]) || "");
    if (!skc_id) continue;

    const suggested_price_cents = pickPriceCents(row, [
      "suggestedPriceCents", "suggestedPrice",
      "recommendPriceCents", "recommendPrice",
      "priceCents", "price",
    ]);
    const currency = firstDefined(row, ["currency", "currencyCode", "siteCurrency"]);

    if (suggested_price_cents == null) continue;

    upsert.run({
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id: String(firstDefined(row, ["productId", "spuId"]) || "") || null,
      mall_id: ctx.mall_id || evt.mall_id || null,
      site: evt.site || null,
      title: null,
      category_id: null,
      category_name: null,
      status: null,
      thumb_url: null,
      spec_summary: null,
      declared_price_cents: null,
      suggested_price_cents,
      price_currency: currency ? String(currency).slice(0, 8) : null,
      sales_total: null,
      stock_available: null,
      compliance_status: null,
      sources_json,
      now,
    });
  }
}
