// SKC 列表 parser：处理 product/skc/pageQuery / draft/pageQuery / notAllEu/pageQuery
// 这些响应都是「商品列表 + 分页」格式，每条带 productSkcId / productId 主体字段。
//
// 各域字段命名差异大（productName vs title、mainImageUrl vs coverUrl 等），
// 用 firstDefined 做宽松映射，匹配不到就留 null（COALESCE 会保留旧值）。

import { buildSkcUpsert } from "./index.js";

function firstDefined(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

function pickList(body) {
  // 已知的列表所在路径（按 Temu 域差异列举）
  return (
    body?.result?.pageItems ||
    body?.result?.dataList ||
    body?.result?.list ||
    body?.result?.items ||
    body?.data?.pageItems ||
    body?.data?.list ||
    body?.data?.items ||
    body?.pageItems ||
    body?.list ||
    body?.items ||
    null
  );
}

export function parseSkcList(db, ctx, evt, body) {
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;

  const upsert = buildSkcUpsert(db);
  const now = Date.now();
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });

  for (const row of list) {
    const skc_id = String(firstDefined(row, ["productSkcId", "skcId", "productSKCId", "skc_id"]) || "");
    if (!skc_id) continue;
    const product_id = String(firstDefined(row, ["productId", "product_id", "spuId"]) || "") || null;
    const title = firstDefined(row, ["productName", "productTitle", "title", "name", "skcName"]);
    const category_id = String(firstDefined(row, ["categoryId", "catId", "cateId", "category_id"]) || "") || null;
    const category_name = firstDefined(row, ["categoryName", "catName", "category_name"]);
    const status = firstDefined(row, ["skcStatus", "status", "saleStatus", "productStatus"]);
    const thumb_url = firstDefined(row, ["mainImageUrl", "mainImage", "coverUrl", "thumbUrl", "firstImage", "imageUrl"]);
    const sales_total = Number(firstDefined(row, ["salesVolume", "saleVolume", "soldNum", "sales", "totalSold"])) || null;
    const stock_available = Number(firstDefined(row, ["stockNum", "stock", "inventoryNum", "availableStock", "stockQuantity"])) || null;

    upsert.run({
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id,
      mall_id: ctx.mall_id || evt.mall_id || null,
      site: evt.site || null,
      title: title ? String(title).slice(0, 500) : null,
      category_id,
      category_name: category_name ? String(category_name).slice(0, 200) : null,
      status: status ? String(status).slice(0, 50) : null,
      thumb_url: thumb_url ? String(thumb_url).slice(0, 1000) : null,
      spec_summary: null,
      declared_price_cents: null,
      suggested_price_cents: null,
      price_currency: null,
      sales_total,
      stock_available,
      compliance_status: null,
      sources_json,
      now,
    });
  }
}
