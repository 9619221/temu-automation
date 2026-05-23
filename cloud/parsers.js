// Parser 单文件：把 capture_events 抽到 SKC / mall 主体表
// 设计：parser 在主 ingest 事务外跑，try/catch 包裹，失败不阻塞 ingest

import crypto from "crypto";

// ---------- 工具 ----------

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
    body?.result?.subOrderList ||
    body?.data?.pageItems ||
    body?.data?.list ||
    body?.data?.items ||
    body?.data?.subOrderList ||
    body?.pageItems ||
    body?.list ||
    body?.items ||
    null
  );
}

// 价格统一成 cents：字段名带 Cents / 整数 >= 1000 当 cents，否则 ×100
function toCents(raw, fieldName) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n)) return null;
  const isCentsField = /cents?$/i.test(fieldName || "");
  if (isCentsField) return Math.round(n);
  if (Number.isInteger(n) && n >= 1000) return n;
  return Math.round(n * 100);
}

function toNullableNumber(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toNullableInteger(raw) {
  const n = toNullableNumber(raw);
  return n == null ? null : Math.trunc(n);
}

function toNullableString(raw, max) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  return max ? s.slice(0, max) : s;
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

// SKC upsert：非空字段 COALESCE 保留旧值，sources_json 走 json_patch 合并
function buildSkcUpsert(db) {
  return db.prepare(`
    INSERT INTO skc_snapshots (
      tenant_id, skc_id, product_id, mall_id, site,
      title, category_id, category_name, status, thumb_url, spec_summary,
      declared_price_cents, suggested_price_cents, price_currency,
      sales_total, stock_available, compliance_status,
      sources_json, first_seen_at, last_updated_at
    ) VALUES (
      @tenant_id, @skc_id, @product_id, @mall_id, @site,
      @title, @category_id, @category_name, @status, @thumb_url, @spec_summary,
      @declared_price_cents, @suggested_price_cents, @price_currency,
      @sales_total, @stock_available, @compliance_status,
      @sources_json, @now, @now
    )
    ON CONFLICT(tenant_id, skc_id) DO UPDATE SET
      product_id           = COALESCE(excluded.product_id, product_id),
      mall_id              = COALESCE(excluded.mall_id, mall_id),
      site                 = COALESCE(excluded.site, site),
      title                = COALESCE(excluded.title, title),
      category_id          = COALESCE(excluded.category_id, category_id),
      category_name        = COALESCE(excluded.category_name, category_name),
      status               = COALESCE(excluded.status, status),
      thumb_url            = COALESCE(excluded.thumb_url, thumb_url),
      spec_summary         = COALESCE(excluded.spec_summary, spec_summary),
      declared_price_cents = COALESCE(excluded.declared_price_cents, declared_price_cents),
      suggested_price_cents= COALESCE(excluded.suggested_price_cents, suggested_price_cents),
      price_currency       = COALESCE(excluded.price_currency, price_currency),
      sales_total          = COALESCE(excluded.sales_total, sales_total),
      stock_available      = COALESCE(excluded.stock_available, stock_available),
      compliance_status    = COALESCE(excluded.compliance_status, compliance_status),
      sources_json         = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at      = excluded.last_updated_at
  `);
}

// ---------- userInfo：解 mall_id 写 mall_accounts ----------

function collectMallInfos(body) {
  const out = [];
  const seen = new Set();
  const stack = [body];
  let steps = 0;
  while (stack.length && steps < 10000) {
    steps++;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const x of node) stack.push(x);
      continue;
    }
    const rawMallId = node.mallId ?? node.mall_id;
    if (rawMallId != null && rawMallId !== "") {
      const mall_id = String(rawMallId).trim();
      if (mall_id && !seen.has(mall_id)) {
        seen.add(mall_id);
        out.push({
          mall_id,
          mall_name: node.mallName || node.mall_name || node.shopName || node.storeName || null,
          site: node.site || node.siteId || node.siteName || node.region || null,
        });
      }
    }
    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  return out;
}

function parseUserInfo(db, ctx, evt, body) {
  const malls = collectMallInfos(body);
  if (!malls.length) return;
  const upsertMall = db.prepare(`
    INSERT INTO mall_accounts (id, tenant_id, site, mall_id, mall_name, last_seen)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, site, mall_id) DO UPDATE SET
      mall_name = COALESCE(excluded.mall_name, mall_accounts.mall_name),
      last_seen = excluded.last_seen
  `);
  for (const m of malls) {
    upsertMall.run(crypto.randomUUID(), ctx.tenant_id, m.site || evt.site || "", m.mall_id, m.mall_name);
  }
}

// ---------- skc/pageQuery 等列表：抽 SKC 基础信息 ----------

function parseSkcList(db, ctx, evt, body) {
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

// ---------- TEMU sales/management ----------

function parseSalesManagement(db, ctx, evt, body) {
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;
  const upsertSales = db.prepare(`
    INSERT INTO temu_sales_snapshot (
      id, tenant_id, skc_id, product_id, goods_id, mall_supplier_id,
      title, category_name, thumb_url, sku_ext_code,
      today_sales, last7d_sales, last30d_sales, total_sales,
      warehouse_stock, occupy_stock, unavailable_stock, advice_qty, available_sale_days,
      declared_price_cents, price_currency, asf_score, comment_num, quality_after_sales_rate,
      supply_status, stock_status, close_jit_status, stat_date, sources_json
    ) VALUES (
      @id, @tenant_id, @skc_id, @product_id, @goods_id, @mall_supplier_id,
      @title, @category_name, @thumb_url, @sku_ext_code,
      @today_sales, @last7d_sales, @last30d_sales, @total_sales,
      @warehouse_stock, @occupy_stock, @unavailable_stock, @advice_qty, @available_sale_days,
      @declared_price_cents, @price_currency, @asf_score, @comment_num, @quality_after_sales_rate,
      @supply_status, @stock_status, @close_jit_status, @stat_date, @sources_json
    )
    ON CONFLICT(tenant_id, skc_id, stat_date) DO UPDATE SET
      product_id               = COALESCE(excluded.product_id, product_id),
      goods_id                 = COALESCE(excluded.goods_id, goods_id),
      mall_supplier_id         = COALESCE(excluded.mall_supplier_id, mall_supplier_id),
      title                    = COALESCE(excluded.title, title),
      category_name            = COALESCE(excluded.category_name, category_name),
      thumb_url                = COALESCE(excluded.thumb_url, thumb_url),
      sku_ext_code             = COALESCE(excluded.sku_ext_code, sku_ext_code),
      today_sales              = COALESCE(excluded.today_sales, today_sales),
      last7d_sales             = COALESCE(excluded.last7d_sales, last7d_sales),
      last30d_sales            = COALESCE(excluded.last30d_sales, last30d_sales),
      total_sales              = COALESCE(excluded.total_sales, total_sales),
      warehouse_stock          = COALESCE(excluded.warehouse_stock, warehouse_stock),
      occupy_stock             = COALESCE(excluded.occupy_stock, occupy_stock),
      unavailable_stock        = COALESCE(excluded.unavailable_stock, unavailable_stock),
      advice_qty               = COALESCE(excluded.advice_qty, advice_qty),
      available_sale_days      = COALESCE(excluded.available_sale_days, available_sale_days),
      declared_price_cents     = COALESCE(excluded.declared_price_cents, declared_price_cents),
      price_currency           = COALESCE(excluded.price_currency, price_currency),
      asf_score                = COALESCE(excluded.asf_score, asf_score),
      comment_num              = COALESCE(excluded.comment_num, comment_num),
      quality_after_sales_rate = COALESCE(excluded.quality_after_sales_rate, quality_after_sales_rate),
      supply_status            = COALESCE(excluded.supply_status, supply_status),
      stock_status             = COALESCE(excluded.stock_status, stock_status),
      close_jit_status         = COALESCE(excluded.close_jit_status, close_jit_status),
      sources_json             = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at          = datetime('now')
  `);
  const upsertSkc = buildSkcUpsert(db);
  const stat_date = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const row of list) {
    const skc_id = toNullableString(row?.productSkcId);
    if (!skc_id) continue;
    const totalInfo = row?.skuQuantityTotalInfo || {};
    const inventoryInfo = totalInfo?.inventoryNumInfo || {};
    const sku = Array.isArray(row?.skuQuantityDetailList) ? row.skuQuantityDetailList[0] : null;
    const declared_price_cents = sku ? toCents(sku.supplierPrice, "supplierPrice") : null;
    const price_currency = toNullableString(sku?.currencyType, 8);
    const title = toNullableString(row.productName, 500);
    const category_name = toNullableString(row.category, 200);
    const thumb_url = toNullableString(row.productSkcPicture, 1000);
    const supply_status = toNullableString(row.supplyStatus, 50);
    const mall_id = ctx.mall_id || evt.mall_id || toNullableString(row.supplierId) || null;
    const total_sales = toNullableInteger(row.totalSales ?? totalInfo.totalSaleVolume);
    const warehouse_stock = toNullableInteger(row.warehouseStock ?? inventoryInfo.warehouseInventoryNum);
    const sku_ext_code = toNullableString(
      row.skcExtCode != null && row.skcExtCode !== "" ? row.skcExtCode : sku?.skuExtCode
    );
    upsertSales.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id: toNullableString(row.productId),
      goods_id: toNullableString(row.goodsId),
      mall_supplier_id: toNullableString(row.supplierId),
      title,
      category_name,
      thumb_url,
      sku_ext_code,
      today_sales: toNullableInteger(row.todaySales ?? totalInfo.todaySaleVolume),
      last7d_sales: toNullableInteger(row.last7DaysSales ?? totalInfo.lastSevenDaysSaleVolume),
      last30d_sales: toNullableInteger(row.last30DaysSales ?? totalInfo.lastThirtyDaysSaleVolume),
      total_sales,
      warehouse_stock,
      occupy_stock: toNullableInteger(row.occupyStock ?? inventoryInfo.expectedOccupiedInventoryNum ?? inventoryInfo.normalLockNumber),
      unavailable_stock: toNullableInteger(row.unavailableStock ?? inventoryInfo.unavailableWarehouseInventoryNum),
      advice_qty: toNullableInteger(row.adviceQuantity ?? totalInfo.adviceQuantity),
      available_sale_days: toNullableNumber(row.availableSaleDays ?? totalInfo.availableSaleDays),
      declared_price_cents,
      price_currency,
      asf_score: toNullableString(row.asfScore),
      comment_num: toNullableInteger(row.commentNum),
      quality_after_sales_rate: toNullableString(row.qualityAfterSalesRate),
      supply_status,
      stock_status: toNullableString(row.stockStatus),
      close_jit_status: toNullableString(row.closeJitStatus),
      stat_date,
      sources_json,
    });
    upsertSkc.run({
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id: toNullableString(row.productId),
      mall_id,
      site: evt.site || null,
      title,
      category_id: null,
      category_name,
      status: supply_status,
      thumb_url,
      spec_summary: null,
      declared_price_cents,
      suggested_price_cents: null,
      price_currency,
      sales_total: total_sales,
      stock_available: warehouse_stock,
      compliance_status: null,
      sources_json,
      now,
    });
  }
}

// ---------- TEMU shop statistics ----------

function eventStatDate(evt) {
  const ts = Number(evt?.ts);
  const time = Number.isFinite(ts) && ts > 946684800000 ? ts : Date.now();
  return new Date(time).toISOString().slice(0, 10);
}

function parseShopStatistics(db, ctx, evt, body) {
  const result = body?.result || body?.data || body;
  if (!result || typeof result !== "object") return;
  const sale_volume = toNullableInteger(firstDefined(result, ["saleVolume", "todaySaleVolume", "todaySales"]));
  const seven_days_sale_volume = toNullableInteger(firstDefined(result, ["sevenDaysSaleVolume", "lastSevenDaysSaleVolume", "last7DaysSales"]));
  const thirty_days_sale_volume = toNullableInteger(firstDefined(result, ["thirtyDaysSaleVolume", "lastThirtyDaysSaleVolume", "last30DaysSales"]));
  const on_sale_product_number = toNullableInteger(firstDefined(result, ["onSaleProductNumber", "onSaleProducts"]));
  const wait_product_number = toNullableInteger(firstDefined(result, ["waitProductNumber"]));
  const lack_skc_number = toNullableInteger(firstDefined(result, ["lackSkcNumber"]));
  const advice_prepare_skc_number = toNullableInteger(firstDefined(result, ["advicePrepareSkcNumber"]));
  const about_to_sell_out_number = toNullableInteger(firstDefined(result, ["aboutToSellOutNumber"]));
  const already_sold_out_number = toNullableInteger(firstDefined(result, ["alreadySoldOutNumber"]));
  const high_price_limit_number = toNullableInteger(firstDefined(result, ["highPriceLimitNumber"]));
  const quality_after_sale_ratio_90d = toNullableNumber(firstDefined(result, ["qualityAfterSaleRatio90d"]));
  const hasAnyMetric = [
    sale_volume,
    seven_days_sale_volume,
    thirty_days_sale_volume,
    on_sale_product_number,
    wait_product_number,
    lack_skc_number,
    advice_prepare_skc_number,
    about_to_sell_out_number,
    already_sold_out_number,
    high_price_limit_number,
  ].some((value) => value != null);
  if (!hasAnyMetric) return;

  const upsert = db.prepare(`
    INSERT INTO temu_shop_stats (
      id, tenant_id, mall_id, site, stat_date,
      sale_volume, seven_days_sale_volume, thirty_days_sale_volume,
      on_sale_product_number, wait_product_number, lack_skc_number,
      advice_prepare_skc_number, about_to_sell_out_number, already_sold_out_number,
      high_price_limit_number, quality_after_sale_ratio_90d, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date,
      @sale_volume, @seven_days_sale_volume, @thirty_days_sale_volume,
      @on_sale_product_number, @wait_product_number, @lack_skc_number,
      @advice_prepare_skc_number, @about_to_sell_out_number, @already_sold_out_number,
      @high_price_limit_number, @quality_after_sale_ratio_90d, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, site, stat_date) DO UPDATE SET
      sale_volume                  = COALESCE(excluded.sale_volume, sale_volume),
      seven_days_sale_volume       = COALESCE(excluded.seven_days_sale_volume, seven_days_sale_volume),
      thirty_days_sale_volume      = COALESCE(excluded.thirty_days_sale_volume, thirty_days_sale_volume),
      on_sale_product_number       = COALESCE(excluded.on_sale_product_number, on_sale_product_number),
      wait_product_number          = COALESCE(excluded.wait_product_number, wait_product_number),
      lack_skc_number              = COALESCE(excluded.lack_skc_number, lack_skc_number),
      advice_prepare_skc_number    = COALESCE(excluded.advice_prepare_skc_number, advice_prepare_skc_number),
      about_to_sell_out_number     = COALESCE(excluded.about_to_sell_out_number, about_to_sell_out_number),
      already_sold_out_number      = COALESCE(excluded.already_sold_out_number, already_sold_out_number),
      high_price_limit_number      = COALESCE(excluded.high_price_limit_number, high_price_limit_number),
      quality_after_sale_ratio_90d = COALESCE(excluded.quality_after_sale_ratio_90d, quality_after_sale_ratio_90d),
      sources_json                 = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at              = datetime('now')
  `);
  upsert.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: String(ctx.mall_id || evt.mall_id || ""),
    site: String(evt.site || ""),
    stat_date: eventStatDate(evt),
    sale_volume,
    seven_days_sale_volume,
    thirty_days_sale_volume,
    on_sale_product_number,
    wait_product_number,
    lack_skc_number,
    advice_prepare_skc_number,
    about_to_sell_out_number,
    already_sold_out_number,
    high_price_limit_number,
    quality_after_sale_ratio_90d,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- magneto/price-adjust：申报价 ----------

function parsePriceAdjust(db, ctx, evt, body) {
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
      tenant_id: ctx.tenant_id, skc_id,
      product_id: String(firstDefined(row, ["productId", "spuId"]) || "") || null,
      mall_id: ctx.mall_id || evt.mall_id || null, site: evt.site || null,
      title: null, category_id: null, category_name: null, status: null, thumb_url: null, spec_summary: null,
      declared_price_cents, suggested_price_cents: null,
      price_currency: currency ? String(currency).slice(0, 8) : null,
      sales_total: null, stock_available: null, compliance_status: null,
      sources_json, now,
    });
  }
}

// ---------- suggestedPrice：建议价 ----------

function parseSuggestedPrice(db, ctx, evt, body) {
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
      tenant_id: ctx.tenant_id, skc_id,
      product_id: String(firstDefined(row, ["productId", "spuId"]) || "") || null,
      mall_id: ctx.mall_id || evt.mall_id || null, site: evt.site || null,
      title: null, category_id: null, category_name: null, status: null, thumb_url: null, spec_summary: null,
      declared_price_cents: null, suggested_price_cents,
      price_currency: currency ? String(currency).slice(0, 8) : null,
      sales_total: null, stock_available: null, compliance_status: null,
      sources_json, now,
    });
  }
}

// ---------- 调度器 ----------

const PARSERS = [
  { match: /\/auth\/userInfo|\/mms\/userInfo|\/mms\/account\/menu/, fn: parseUserInfo, name: "userInfo" },
  { match: /\/product\/skc\/pageQuery|\/product\/draft\/pageQuery|\/product\/notAllEu\/pageQuery/, fn: parseSkcList, name: "skcList" },
  { match: /\/mms\/venom\/api\/supplier\/sales\/management\/(listOverall|querySkuSalesNumber|queryFulfilmentFormStatistic)/, fn: parseSalesManagement, name: "salesManagement" },
  { match: /\/bg\/swift\/api\/common\/statistics\/web\/queryStatisticDataFullManaged|\/visage-agent-seller\/product\/statisticsData/, fn: parseShopStatistics, name: "shopStatistics" },
  { match: /\/magneto\/price-adjust\/page-query/, fn: parsePriceAdjust, name: "priceAdjust" },
  { match: /\/product\/sku\/site\/suggestedPrice\/pageQuery/, fn: parseSuggestedPrice, name: "suggestedPrice" },
];

export function dispatchParsers(db, ctx, items) {
  for (const it of items) {
    if (!it.body_json) continue;
    let body;
    try { body = JSON.parse(it.body_json); } catch { continue; }
    for (const p of PARSERS) {
      if (!p.match.test(it.url_path)) continue;
      try {
        p.fn(db, ctx, it, body);
      } catch (e) {
        console.warn(`[parser:${p.name}] event=${it.id} url=${it.url_path}: ${String(e?.message || e).slice(0, 200)}`);
      }
    }
  }
}
