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

function firstDeepDefined(obj, keys, maxDepth = 3) {
  const seen = new Set();
  const stack = [{ value: obj, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const direct = firstDefined(value, keys);
    if (direct != null && direct !== "") return direct;
    if (depth >= maxDepth) continue;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function pickList(body) {
  const candidates = [
    body?.result?.pageItems,
    body?.result?.data,
    body?.result?.dataList,
    body?.result?.list,
    body?.result?.items,
    body?.result?.records,
    body?.result?.rows,
    body?.result?.subOrderList,
    body?.result?.subPurchaseOrderList,
    body?.result?.purchaseOrderList,
    body?.result?.deliveryBatchList,
    body?.result?.deliveryBatchVOList,
    body?.result?.deliveryOrderList,
    body?.result?.deliveryOrderVOList,
    body?.result?.page?.records,
    body?.result?.page?.rows,
    body?.data?.pageItems,
    body?.data?.dataList,
    body?.data?.list,
    body?.data?.items,
    body?.data?.records,
    body?.data?.rows,
    body?.data?.subOrderList,
    body?.data?.subPurchaseOrderList,
    body?.data?.purchaseOrderList,
    body?.data?.deliveryBatchList,
    body?.data?.deliveryBatchVOList,
    body?.data?.deliveryOrderList,
    body?.data?.deliveryOrderVOList,
    body?.data?.page?.records,
    body?.data?.page?.rows,
    body?.pageItems,
    body?.dataList,
    body?.list,
    body?.items,
    body?.records,
    body?.rows,
    body?.subOrderList,
    body?.subPurchaseOrderList,
    body?.purchaseOrderList,
    body?.deliveryBatchList,
    body?.deliveryBatchVOList,
    body?.deliveryOrderList,
    body?.deliveryOrderVOList,
  ];
  return candidates.find((value) => Array.isArray(value) && value.length > 0) || null;
}

// 价格统一成 cents：字段名带 Cents / 整数 >= 1000 当 cents，否则 ×100
function toCents(raw, fieldName) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n)) return null;
  const isCentsField = /cents?$/i.test(fieldName || "");
  if (isCentsField) return Math.round(n);
  if (
    Number.isInteger(n)
    && /(activityPrice|dailyPrice|supplierPrice|targetSupplierPrice|suggestActivityPrice|suggestActivitySupplierPrice|suggestedActivitySupplierPrice)/i.test(fieldName || "")
  ) {
    return Math.round(n);
  }
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

function occupiedInventoryInteger(expected, normalLock, fallback) {
  const expectedNum = toNullableInteger(expected);
  const normalNum = toNullableInteger(normalLock);
  const occupied = Math.max(0, expectedNum || 0) + Math.max(0, normalNum || 0);
  if (occupied > 0) return occupied;
  return expectedNum ?? normalNum ?? toNullableInteger(fallback);
}

function toNullableString(raw, max) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  return max ? s.slice(0, max) : s;
}

function eventMallId(ctx, evt, fallback = null) {
  return toNullableString(ctx?.mall_id || evt?.mall_id || fallback) || "";
}

function toNullableBooleanInteger(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "number") return raw ? 1 : 0;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (["1", "true", "yes", "y"].includes(text)) return 1;
  if (["0", "false", "no", "n"].includes(text)) return 0;
  return null;
}

function formatDateInTimeZone(ms, timeZone = "Asia/Shanghai") {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function categoryNameFromValue(raw) {
  if (raw == null || raw === "") return null;
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        value = JSON.parse(text);
      } catch {
        return text.slice(0, 200);
      }
    } else {
      return text.slice(0, 200);
    }
  }
  if (Array.isArray(value)) {
    const parts = value.map(categoryNameFromValue).filter(Boolean);
    return parts.join(">").slice(0, 200) || null;
  }
  if (value && typeof value === "object") {
    const parts = [];
    for (let i = 1; i <= 10; i++) {
      const name = value[`cat${i}Name`];
      if (name) parts.push(String(name));
    }
    if (parts.length) return parts.join(">").slice(0, 200);
    return toNullableString(value.catName || value.categoryName || value.name, 200);
  }
  return String(value).slice(0, 200);
}

function normalizeStatDate(raw, fallbackEvt) {
  if (raw != null && raw !== "") {
    const text = String(raw).trim();
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const ms = n > 946684800000 ? n : n * 1000;
      const date = formatDateInTimeZone(ms);
      if (date) return date;
    }
  }
  return eventStatDate(fallbackEvt);
}

function collectSkuSalesTrendPoints(body) {
  const out = [];
  const stack = [body];
  const seen = new Set();
  let steps = 0;
  while (stack.length && steps < 20000) {
    steps++;
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    if (typeof node !== "object") continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const skuId = firstDefined(node, ["prodSkuId", "productSkuId", "skuId", "product_sku_id"]);
    const salesNumber = firstDefined(node, ["salesNumber", "saleNumber", "sales", "saleVolume"]);
    const date = firstDefined(node, ["date", "statDate", "stat_date", "saleDate"]);
    if (skuId != null && salesNumber != null && date != null) out.push(node);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return out;
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
    ON CONFLICT(tenant_id, mall_id, skc_id) DO UPDATE SET
      product_id           = COALESCE(excluded.product_id, product_id),
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
      mall_id: eventMallId(ctx, evt),
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

// ---------- 合规巡查：retrieval/board/pageQuery 命中违规的 SKC，回填 compliance_status ----------

function parseComplianceBoard(db, ctx, evt, body) {
  const items = body && body.result && Array.isArray(body.result.pageItems) ? body.result.pageItems : pickList(body);
  if (!Array.isArray(items) || !items.length) return;
  const upd = db.prepare(`
    UPDATE skc_snapshots
       SET compliance_status = @compliance_status, last_updated_at = datetime('now')
     WHERE tenant_id = @tenant_id AND skc_id = @skc_id
  `);
  for (const row of items) {
    const skc_id = String(firstDefined(row, ["productSkcId", "skcId", "skc_id"]) || "");
    if (!skc_id) continue;
    const reasons = [];
    if (Array.isArray(row.reasonList)) for (const r of row.reasonList) if (r && r.reason) reasons.push(String(r.reason));
    if (Array.isArray(row.secondReasonList)) for (const r of row.secondReasonList) if (r && r.reason) reasons.push(String(r.reason));
    const uniq = [...new Set(reasons)];
    const compliance_status = (uniq.length ? uniq.join("; ") : "违规命中").slice(0, 500);
    upd.run({ tenant_id: ctx.tenant_id, skc_id, compliance_status });
  }
}

// ---------- TEMU sales/management ----------

function parseSkuSalesTrend(db, ctx, evt, body) {
  const points = collectSkuSalesTrendPoints(body);
  if (!points.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_sku_sales_trend (
      id, tenant_id, mall_id, site, product_sku_id, stat_date,
      sales_number, is_predict, sold_out, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @product_sku_id, @stat_date,
      @sales_number, @is_predict, @sold_out, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, product_sku_id, stat_date) DO UPDATE SET
      site            = COALESCE(excluded.site, site),
      sales_number    = COALESCE(excluded.sales_number, sales_number),
      is_predict      = COALESCE(excluded.is_predict, is_predict),
      sold_out        = COALESCE(excluded.sold_out, sold_out),
      source_event_id = COALESCE(excluded.source_event_id, source_event_id),
      sources_json    = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const point of points) {
    const product_sku_id = toNullableString(firstDefined(point, ["prodSkuId", "productSkuId", "skuId", "product_sku_id"]));
    if (!product_sku_id) continue;
    const stat_date = normalizeStatDate(firstDefined(point, ["date", "statDate", "stat_date", "saleDate"]), evt);
    if (!stat_date) continue;
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id: eventMallId(ctx, evt),
      site: evt.site || null,
      product_sku_id,
      stat_date,
      sales_number: toNullableInteger(firstDefined(point, ["salesNumber", "saleNumber", "sales", "saleVolume"])),
      is_predict: toNullableBooleanInteger(firstDefined(point, ["isPredict", "predict", "is_predict"])),
      sold_out: toNullableBooleanInteger(firstDefined(point, ["soldOut", "isSoldOut", "sold_out"])),
      source_event_id: evt.id,
      sources_json,
    });
  }
}

function parseSalesManagement(db, ctx, evt, body) {
  if (String(evt?.url_path || "").includes("querySkuSalesNumber")) {
    parseSkuSalesTrend(db, ctx, evt, body);
    return;
  }
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;
  const upsertSales = db.prepare(`
    INSERT INTO temu_sales_snapshot (
      id, tenant_id, skc_id, product_id, goods_id, mall_supplier_id,
      title, category_name, thumb_url, sku_ext_code,
      today_sales, last7d_sales, last30d_sales, total_sales,
      warehouse_stock, occupy_stock, unavailable_stock, advice_qty, lack_quantity, available_sale_days,
      declared_price_cents, price_currency, asf_score, comment_num, quality_after_sales_rate,
      supply_status, stock_status, close_jit_status, stat_date, sources_json
    ) VALUES (
      @id, @tenant_id, @skc_id, @product_id, @goods_id, @mall_supplier_id,
      @title, @category_name, @thumb_url, @sku_ext_code,
      @today_sales, @last7d_sales, @last30d_sales, @total_sales,
      @warehouse_stock, @occupy_stock, @unavailable_stock, @advice_qty, @lack_quantity, @available_sale_days,
      @declared_price_cents, @price_currency, @asf_score, @comment_num, @quality_after_sales_rate,
      @supply_status, @stock_status, @close_jit_status, @stat_date, @sources_json
    )
    ON CONFLICT(tenant_id, mall_supplier_id, skc_id, stat_date) DO UPDATE SET
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
      lack_quantity            = COALESCE(excluded.lack_quantity, lack_quantity),
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
    const skc_id = toNullableString(firstDefined(row, [
      "productSkcId", "productSKCId", "productSkcIdStr", "skcId", "skc_id",
    ]));
    if (!skc_id) continue;
    const totalInfo = row?.skuQuantityTotalInfo || {};
    const inventoryInfo = totalInfo?.inventoryNumInfo || row?.inventoryNumInfo || row?.skuInventoryInfo || {};
    const skuList = Array.isArray(row?.skuQuantityDetailList)
      ? row.skuQuantityDetailList
      : Array.isArray(row?.skuList)
        ? row.skuList
        : Array.isArray(row?.skuInfoList)
          ? row.skuInfoList
          : [];
    const sku = skuList[0] || null;
    const declared_price_cents = pickPriceCents({ ...(sku || {}), ...row }, [
      "supplierPriceCents", "supplierPriceCent", "supplierPrice",
      "salePriceCents", "salePriceCent", "salePrice",
      "currentPriceCents", "currentPrice", "priceCents", "price",
    ]);
    const price_currency = toNullableString(firstDefined({ ...(sku || {}), ...row }, [
      "currencyType", "currency", "currencyCode", "siteCurrency", "priceCurrency",
    ]), 8);
    const title = toNullableString(firstDefined(row, ["productName", "goodsName", "title", "name"]), 500);
    const category_name = toNullableString(categoryNameFromValue(firstDefined(row, ["category", "categoryName", "catName"])), 200);
    const thumb_url = toNullableString(firstDefined(row, ["productSkcPicture", "goodsImageUrl", "imageUrl", "thumbUrl"]), 1000);
    const supply_status = toNullableString(firstDefined(row, ["supplyStatus", "status", "saleStatus"]), 50);
    const mall_id = eventMallId(ctx, evt, firstDefined(row, ["supplierId", "mallSupplierId", "mallId"]));
    const total_sales = toNullableInteger(firstDefined(row, ["totalSales", "totalSaleVolume", "salesTotal"]) ?? totalInfo.totalSaleVolume);
    const warehouse_stock = toNullableInteger(firstDefined(row, [
      "warehouseStock", "warehouseInventoryNum", "sellerWhStock", "stockAvailable",
    ]) ?? inventoryInfo.warehouseInventoryNum);
    const sku_ext_code = toNullableString(
      firstDefined(row, ["skcExtCode", "skuExtCode", "skuCode"]) ?? sku?.skuExtCode
    );
    upsertSales.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id: toNullableString(firstDefined(row, ["productId", "productSpuId", "spuId"])),
      goods_id: toNullableString(firstDefined(row, ["goodsId", "goods_id"])) || "",
      mall_supplier_id: mall_id,
      title,
      category_name,
      thumb_url,
      sku_ext_code,
      today_sales: toNullableInteger(firstDefined(row, ["todaySales", "todaySaleVolume", "saleVolume"]) ?? totalInfo.todaySaleVolume),
      last7d_sales: toNullableInteger(firstDefined(row, ["last7DaysSales", "sevenDaysSaleVolume", "lastSevenDaysSaleVolume"]) ?? totalInfo.lastSevenDaysSaleVolume),
      last30d_sales: toNullableInteger(firstDefined(row, ["last30DaysSales", "thirtyDaysSaleVolume", "lastThirtyDaysSaleVolume"]) ?? totalInfo.lastThirtyDaysSaleVolume),
      total_sales,
      warehouse_stock,
      occupy_stock: occupiedInventoryInteger(
        inventoryInfo.expectedOccupiedInventoryNum ?? row.expectedOccupiedInventoryNum,
        inventoryInfo.normalLockNumber ?? row.normalLockNumber,
        row.occupyStock ?? row.occupiedStock,
      ),
      unavailable_stock: toNullableInteger(firstDefined(row, ["unavailableStock", "unavailableWarehouseInventoryNum"]) ?? inventoryInfo.unavailableWarehouseInventoryNum),
      advice_qty: toNullableInteger(firstDefined(row, ["adviceQuantity", "adviceQty", "suggestPrepareQuantity"]) ?? totalInfo.adviceQuantity),
      lack_quantity: toNullableInteger(firstDefined(row, ["lackQuantity"]) ?? totalInfo.lackQuantity ?? inventoryInfo.lackQuantity),
      available_sale_days: toNullableNumber(firstDefined(row, ["availableSaleDays", "warehouseAvailableSaleDays"]) ?? totalInfo.availableSaleDays),
      declared_price_cents,
      price_currency,
      asf_score: toNullableString(firstDefined(row, ["asfScore", "score"])),
      comment_num: toNullableInteger(firstDefined(row, ["commentNum", "reviewNum"])),
      quality_after_sales_rate: toNullableString(firstDefined(row, ["qualityAfterSalesRate", "afterSalesRate"])),
      supply_status,
      stock_status: toNullableString(firstDefined(row, ["stockStatus", "inventoryStatus"])),
      close_jit_status: toNullableString(firstDefined(row, ["closeJitStatus", "jitStatus"])),
      stat_date,
      sources_json,
    });
    upsertSkc.run({
      tenant_id: ctx.tenant_id,
      skc_id,
      product_id: toNullableString(firstDefined(row, ["productId", "productSpuId", "spuId"])),
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

// ---------- TEMU product flow ----------

function parseProductFlowGoods(db, ctx, evt, body) {
  const list = body?.result?.list || pickList(body);
  if (!Array.isArray(list) || !list.length) return;
  const stat_date = normalizeStatDate(
    firstDefined(body?.result || {}, ["updateAt", "statDate", "date", "dataDate"]),
    evt
  );
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  const upsert = db.prepare(`
    INSERT INTO temu_product_flow_snapshot (
      id, tenant_id, mall_id, site, stat_date, product_id, goods_id,
      title, category_name, thumb_url,
      expose_num, click_num, detail_visit_num, detail_visitor_num,
      add_to_cart_user_num, collect_user_num, pay_goods_num, pay_order_num, buyer_num,
      expose_pay_conversion_rate, expose_click_conversion_rate, click_pay_conversion_rate,
      search_expose_num, search_click_num, search_pay_goods_num, search_pay_order_num,
      recommend_expose_num, recommend_click_num, recommend_pay_goods_num, recommend_pay_order_num,
      flow_grow_status, grow_data_text, bsr_goods, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date, @product_id, @goods_id,
      @title, @category_name, @thumb_url,
      @expose_num, @click_num, @detail_visit_num, @detail_visitor_num,
      @add_to_cart_user_num, @collect_user_num, @pay_goods_num, @pay_order_num, @buyer_num,
      @expose_pay_conversion_rate, @expose_click_conversion_rate, @click_pay_conversion_rate,
      @search_expose_num, @search_click_num, @search_pay_goods_num, @search_pay_order_num,
      @recommend_expose_num, @recommend_click_num, @recommend_pay_goods_num, @recommend_pay_order_num,
      @flow_grow_status, @grow_data_text, @bsr_goods, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, product_id, goods_id, stat_date, site) DO UPDATE SET
      mall_id                       = COALESCE(excluded.mall_id, mall_id),
      title                         = COALESCE(excluded.title, title),
      category_name                 = COALESCE(excluded.category_name, category_name),
      thumb_url                     = COALESCE(excluded.thumb_url, thumb_url),
      expose_num                    = COALESCE(excluded.expose_num, expose_num),
      click_num                     = COALESCE(excluded.click_num, click_num),
      detail_visit_num              = COALESCE(excluded.detail_visit_num, detail_visit_num),
      detail_visitor_num            = COALESCE(excluded.detail_visitor_num, detail_visitor_num),
      add_to_cart_user_num          = COALESCE(excluded.add_to_cart_user_num, add_to_cart_user_num),
      collect_user_num              = COALESCE(excluded.collect_user_num, collect_user_num),
      pay_goods_num                 = COALESCE(excluded.pay_goods_num, pay_goods_num),
      pay_order_num                 = COALESCE(excluded.pay_order_num, pay_order_num),
      buyer_num                     = COALESCE(excluded.buyer_num, buyer_num),
      expose_pay_conversion_rate    = COALESCE(excluded.expose_pay_conversion_rate, expose_pay_conversion_rate),
      expose_click_conversion_rate  = COALESCE(excluded.expose_click_conversion_rate, expose_click_conversion_rate),
      click_pay_conversion_rate     = COALESCE(excluded.click_pay_conversion_rate, click_pay_conversion_rate),
      search_expose_num             = COALESCE(excluded.search_expose_num, search_expose_num),
      search_click_num              = COALESCE(excluded.search_click_num, search_click_num),
      search_pay_goods_num          = COALESCE(excluded.search_pay_goods_num, search_pay_goods_num),
      search_pay_order_num          = COALESCE(excluded.search_pay_order_num, search_pay_order_num),
      recommend_expose_num          = COALESCE(excluded.recommend_expose_num, recommend_expose_num),
      recommend_click_num           = COALESCE(excluded.recommend_click_num, recommend_click_num),
      recommend_pay_goods_num       = COALESCE(excluded.recommend_pay_goods_num, recommend_pay_goods_num),
      recommend_pay_order_num       = COALESCE(excluded.recommend_pay_order_num, recommend_pay_order_num),
      flow_grow_status              = COALESCE(excluded.flow_grow_status, flow_grow_status),
      grow_data_text                = COALESCE(excluded.grow_data_text, grow_data_text),
      bsr_goods                     = COALESCE(excluded.bsr_goods, bsr_goods),
      source_event_id               = COALESCE(excluded.source_event_id, source_event_id),
      sources_json                  = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at               = datetime('now')
  `);
  for (const row of list) {
    const product_id = toNullableString(firstDefined(row, ["productSpuId", "productId", "spuId"]));
    if (!product_id) continue;
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id: eventMallId(ctx, evt),
      site: evt.site || null,
      stat_date,
      product_id,
      goods_id: toNullableString(row.goodsId) || "",
      title: toNullableString(firstDefined(row, ["goodsName", "productName", "title"]), 500),
      category_name: categoryNameFromValue(row.category),
      thumb_url: toNullableString(firstDefined(row, ["goodsImageUrl", "productSkcPicture", "imageUrl", "thumbUrl"]), 1000),
      expose_num: toNullableInteger(row.exposeNum),
      click_num: toNullableInteger(row.clickNum),
      detail_visit_num: toNullableInteger(row.goodsDetailVisitNum),
      detail_visitor_num: toNullableInteger(row.goodsDetailVisitorNum),
      add_to_cart_user_num: toNullableInteger(row.addToCartUserNum),
      collect_user_num: toNullableInteger(row.collectUserNum),
      pay_goods_num: toNullableInteger(row.payGoodsNum),
      pay_order_num: toNullableInteger(row.payOrderNum),
      buyer_num: toNullableInteger(row.buyerNum),
      expose_pay_conversion_rate: toNullableNumber(row.exposePayConversionRate),
      expose_click_conversion_rate: toNullableNumber(row.exposeClickConversionRate),
      click_pay_conversion_rate: toNullableNumber(row.clickPayConversionRate),
      search_expose_num: toNullableInteger(row.searchExposeNum),
      search_click_num: toNullableInteger(row.searchClickNum),
      search_pay_goods_num: toNullableInteger(row.searchPayGoodsNum),
      search_pay_order_num: toNullableInteger(row.searchPayOrderNum),
      recommend_expose_num: toNullableInteger(row.recommendExposeNum),
      recommend_click_num: toNullableInteger(row.recommendClickNum),
      recommend_pay_goods_num: toNullableInteger(row.recommendPayGoodsNum),
      recommend_pay_order_num: toNullableInteger(row.recommendPayOrderNum),
      flow_grow_status: toNullableString(row.flowGrowStatus, 50),
      grow_data_text: toNullableString(row.growDataText, 100),
      bsr_goods: toNullableBooleanInteger(row.bsrGoods),
      source_event_id: evt.id,
      sources_json,
    });
  }
}

function flowValue(row, keys) {
  return firstDeepDefined(row, keys, 2);
}

function flowInteger(row, keys) {
  return toNullableInteger(flowValue(row, keys));
}

function flowNumber(row, keys) {
  return toNullableNumber(flowValue(row, keys));
}

function hasFlowMetrics(row) {
  if (!row || typeof row !== "object") return false;
  return flowValue(row, [
    "exposeNum", "exposureNum", "impressionNum", "showNum",
    "clickNum", "goodsDetailVisitNum", "goodsDetailVisitorNum",
    "payGoodsNum", "payOrderNum", "buyerNum",
  ]) != null;
}

function flowProductMeta(body) {
  const request = body?.__request || {};
  const result = body?.result || body?.data || body || {};
  return {
    product_id: toNullableString(firstDeepDefined(request, ["productSpuId", "productId", "spuId"], 3)
      ?? firstDeepDefined(result, ["productSpuId", "productId", "spuId"], 3)),
    goods_id: toNullableString(firstDeepDefined(request, ["goodsId", "goods_id"], 3)
      ?? firstDeepDefined(result, ["goodsId", "goods_id"], 3)),
  };
}

function collectProductFlowTrendRows(body) {
  const result = body?.result || body?.data || body;
  const rows = [];
  const seen = new Set();
  const stack = [result];
  let steps = 0;
  while (stack.length && steps < 12000 && rows.length < 500) {
    steps++;
    const node = stack.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      const metricRows = node.filter((item) => item && typeof item === "object" && hasFlowMetrics(item));
      if (metricRows.length > 0) rows.push(...metricRows);
      continue;
    }
    for (const key of [
      "trendList", "trendData", "dailyList", "dailyTrend", "dataList",
      "list", "items", "records", "rows", "chartData", "dateList",
    ]) {
      const value = node[key];
      if (Array.isArray(value)) stack.push(value);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object" && !Array.isArray(value)) stack.push(value);
    }
  }
  if (rows.length === 0 && hasFlowMetrics(result)) rows.push(result);
  return rows;
}

function parseProductFlowTrend(db, ctx, evt, body) {
  const rows = collectProductFlowTrendRows(body);
  if (!rows.length) return;
  const meta = flowProductMeta(body);
  const root = body?.result || body?.data || body || {};
  const fallbackDate = firstDeepDefined(root, ["statDate", "dataDate", "date", "dt", "updateAt"], 2);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  const upsert = db.prepare(`
    INSERT INTO temu_product_flow_trend (
      id, tenant_id, mall_id, site, product_id, goods_id, stat_date,
      expose_num, click_num, detail_visit_num, detail_visitor_num,
      add_to_cart_user_num, collect_user_num, pay_goods_num, pay_order_num, buyer_num,
      expose_pay_conversion_rate, expose_click_conversion_rate, click_pay_conversion_rate,
      search_expose_num, search_click_num, search_pay_goods_num, search_pay_order_num,
      recommend_expose_num, recommend_click_num, recommend_pay_goods_num, recommend_pay_order_num,
      source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @product_id, @goods_id, @stat_date,
      @expose_num, @click_num, @detail_visit_num, @detail_visitor_num,
      @add_to_cart_user_num, @collect_user_num, @pay_goods_num, @pay_order_num, @buyer_num,
      @expose_pay_conversion_rate, @expose_click_conversion_rate, @click_pay_conversion_rate,
      @search_expose_num, @search_click_num, @search_pay_goods_num, @search_pay_order_num,
      @recommend_expose_num, @recommend_click_num, @recommend_pay_goods_num, @recommend_pay_order_num,
      @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, product_id, goods_id, stat_date, site) DO UPDATE SET
      expose_num                    = COALESCE(excluded.expose_num, expose_num),
      click_num                     = COALESCE(excluded.click_num, click_num),
      detail_visit_num              = COALESCE(excluded.detail_visit_num, detail_visit_num),
      detail_visitor_num            = COALESCE(excluded.detail_visitor_num, detail_visitor_num),
      add_to_cart_user_num          = COALESCE(excluded.add_to_cart_user_num, add_to_cart_user_num),
      collect_user_num              = COALESCE(excluded.collect_user_num, collect_user_num),
      pay_goods_num                 = COALESCE(excluded.pay_goods_num, pay_goods_num),
      pay_order_num                 = COALESCE(excluded.pay_order_num, pay_order_num),
      buyer_num                     = COALESCE(excluded.buyer_num, buyer_num),
      expose_pay_conversion_rate    = COALESCE(excluded.expose_pay_conversion_rate, expose_pay_conversion_rate),
      expose_click_conversion_rate  = COALESCE(excluded.expose_click_conversion_rate, expose_click_conversion_rate),
      click_pay_conversion_rate     = COALESCE(excluded.click_pay_conversion_rate, click_pay_conversion_rate),
      search_expose_num             = COALESCE(excluded.search_expose_num, search_expose_num),
      search_click_num              = COALESCE(excluded.search_click_num, search_click_num),
      search_pay_goods_num          = COALESCE(excluded.search_pay_goods_num, search_pay_goods_num),
      search_pay_order_num          = COALESCE(excluded.search_pay_order_num, search_pay_order_num),
      recommend_expose_num          = COALESCE(excluded.recommend_expose_num, recommend_expose_num),
      recommend_click_num           = COALESCE(excluded.recommend_click_num, recommend_click_num),
      recommend_pay_goods_num       = COALESCE(excluded.recommend_pay_goods_num, recommend_pay_goods_num),
      recommend_pay_order_num       = COALESCE(excluded.recommend_pay_order_num, recommend_pay_order_num),
      source_event_id               = COALESCE(excluded.source_event_id, source_event_id),
      sources_json                  = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at               = datetime('now')
  `);

  for (const row of rows) {
    const product_id = toNullableString(flowValue(row, ["productSpuId", "productId", "spuId"]) ?? meta.product_id) || "";
    const goods_id = toNullableString(flowValue(row, ["goodsId", "goods_id"]) ?? meta.goods_id) || "";
    if (!product_id && !goods_id) continue;
    const stat_date = normalizeStatDate(flowValue(row, ["statDate", "dataDate", "date", "dt", "time", "dateTime"]) ?? fallbackDate, evt);
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id: eventMallId(ctx, evt),
      site: evt.site || "",
      product_id,
      goods_id,
      stat_date,
      expose_num: flowInteger(row, ["exposeNum", "exposureNum", "impressionNum", "showNum"]),
      click_num: flowInteger(row, ["clickNum"]),
      detail_visit_num: flowInteger(row, ["goodsDetailVisitNum", "detailVisitNum", "detailVisits"]),
      detail_visitor_num: flowInteger(row, ["goodsDetailVisitorNum", "detailVisitorNum", "detailVisitors"]),
      add_to_cart_user_num: flowInteger(row, ["addToCartUserNum", "cartUserNum"]),
      collect_user_num: flowInteger(row, ["collectUserNum", "favoriteUserNum"]),
      pay_goods_num: flowInteger(row, ["payGoodsNum", "payGoodsNumber", "paidGoodsNum"]),
      pay_order_num: flowInteger(row, ["payOrderNum", "paidOrderNum", "orderNum"]),
      buyer_num: flowInteger(row, ["buyerNum", "payUserNum", "paidUserNum"]),
      expose_pay_conversion_rate: flowNumber(row, ["exposePayConversionRate", "exposePayRate"]),
      expose_click_conversion_rate: flowNumber(row, ["exposeClickConversionRate", "exposeClickRate"]),
      click_pay_conversion_rate: flowNumber(row, ["clickPayConversionRate", "clickPayRate"]),
      search_expose_num: flowInteger(row, ["searchExposeNum"]),
      search_click_num: flowInteger(row, ["searchClickNum"]),
      search_pay_goods_num: flowInteger(row, ["searchPayGoodsNum"]),
      search_pay_order_num: flowInteger(row, ["searchPayOrderNum"]),
      recommend_expose_num: flowInteger(row, ["recommendExposeNum"]),
      recommend_click_num: flowInteger(row, ["recommendClickNum"]),
      recommend_pay_goods_num: flowInteger(row, ["recommendPayGoodsNum"]),
      recommend_pay_order_num: flowInteger(row, ["recommendPayOrderNum"]),
      source_event_id: evt.id,
      sources_json,
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
    mall_id: eventMallId(ctx, evt),
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

// ---------- 活动总览（queryMallActivityOverView / TypeList） ----------

function parseMallActivityOverview(db, ctx, evt, body) {
  const result = body?.result || body?.data || body;
  if (!result || typeof result !== "object") return;
  const enrollable = toNullableInteger(firstDefined(result, [
    "enrollableCount", "canEnrollCount", "canSignupCount", "availableActivityCount",
    "waitEnrollCount", "toBeEnrolledNum", "toBeEnrolledCount",
  ]));
  const enrolled = toNullableInteger(firstDefined(result, [
    "enrolledCount", "signedUpCount", "alreadyEnrollCount", "enrolledNum",
  ]));
  const ongoing = toNullableInteger(firstDefined(result, [
    "ongoingCount", "inProgressCount", "runningCount", "activeCount", "ongoingNum",
  ]));
  const total = toNullableInteger(firstDefined(result, [
    "totalCount", "totalActivityCount", "allCount", "total",
  ]));
  if ([enrollable, enrolled, ongoing, total].every((v) => v == null)) return;
  const upsertShopStats = db.prepare(`
    INSERT INTO temu_shop_stats (
      id, tenant_id, mall_id, site, stat_date,
      enrollable_activity_count, enrolled_activity_count, ongoing_activity_count, total_activity_count, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date,
      @enrollable_activity_count, @enrolled_activity_count, @ongoing_activity_count, @total_activity_count, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, site, stat_date) DO UPDATE SET
      enrollable_activity_count = COALESCE(excluded.enrollable_activity_count, enrollable_activity_count),
      enrolled_activity_count   = COALESCE(excluded.enrolled_activity_count, enrolled_activity_count),
      ongoing_activity_count    = COALESCE(excluded.ongoing_activity_count, ongoing_activity_count),
      total_activity_count      = COALESCE(excluded.total_activity_count, total_activity_count),
      sources_json              = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at           = datetime('now')
  `);
  upsertShopStats.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: eventMallId(ctx, evt),
    site: String(evt.site || ""),
    stat_date: eventStatDate(evt),
    enrollable_activity_count: enrollable,
    enrolled_activity_count: enrolled,
    ongoing_activity_count: ongoing,
    total_activity_count: total,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- 店铺流量 / 经营数据（mallFlow / mallInfo） ----------

function parseMallTraffic(db, ctx, evt, body) {
  const result = body?.result || body?.data || body;
  if (!result || typeof result !== "object") return;
  const visit_count = toNullableInteger(firstDefined(result, [
    "visitCount", "mallVisitCount", "totalVisitors", "visitorsNum", "visitNum", "uv",
  ]));
  const pay_buyer_count = toNullableInteger(firstDefined(result, [
    "payBuyerCount", "payCount", "payNum", "payUserCount", "payVisitorsNum", "buyerNum",
  ]));
  const visit_pay_rate = toNullableNumber(firstDefined(result, [
    "visitPayRate", "visitPayPercent", "payRate", "conversionRate", "payConversionRate",
  ]));
  const attention_count = toNullableInteger(firstDefined(result, [
    "attentionCount", "collectCount", "followCount", "favoriteCount",
  ]));
  const attention_rate = toNullableNumber(firstDefined(result, [
    "attentionRate", "attentionPercent", "mallAttentionPercent", "collectRate",
  ]));
  const trade_amount_cents = toCents(firstDefined(result, [
    "tradeAmount", "payAmount", "gmv", "saleAmount", "totalPayAmount",
  ]), "tradeAmount");
  const trade_order_count = toNullableInteger(firstDefined(result, [
    "tradeOrderCount", "orderCount", "payOrderCount", "totalOrderCount",
  ]));
  if ([visit_count, pay_buyer_count, visit_pay_rate, attention_count, trade_amount_cents, trade_order_count].every((v) => v == null)) return;
  const upsert = db.prepare(`
    INSERT INTO temu_shop_stats (
      id, tenant_id, mall_id, site, stat_date,
      visit_count, pay_buyer_count, visit_pay_rate, attention_count, attention_rate,
      trade_amount_cents, trade_order_count, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date,
      @visit_count, @pay_buyer_count, @visit_pay_rate, @attention_count, @attention_rate,
      @trade_amount_cents, @trade_order_count, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, site, stat_date) DO UPDATE SET
      visit_count        = COALESCE(excluded.visit_count, visit_count),
      pay_buyer_count    = COALESCE(excluded.pay_buyer_count, pay_buyer_count),
      visit_pay_rate     = COALESCE(excluded.visit_pay_rate, visit_pay_rate),
      attention_count    = COALESCE(excluded.attention_count, attention_count),
      attention_rate     = COALESCE(excluded.attention_rate, attention_rate),
      trade_amount_cents = COALESCE(excluded.trade_amount_cents, trade_amount_cents),
      trade_order_count  = COALESCE(excluded.trade_order_count, trade_order_count),
      sources_json       = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at    = datetime('now')
  `);
  upsert.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: eventMallId(ctx, evt),
    site: String(evt.site || ""),
    stat_date: eventStatDate(evt),
    visit_count, pay_buyer_count, visit_pay_rate, attention_count, attention_rate,
    trade_amount_cents, trade_order_count,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- DSR 评分（mallDsr） ----------

function parseMallDsr(db, ctx, evt, body) {
  const result = body?.result || body?.data || body;
  if (!result || typeof result !== "object") return;
  const dsr_score = toNullableNumber(firstDefined(result, [
    "dsrScore", "score", "totalScore", "overallScore", "mallScore",
  ]));
  const dsr_logistics_score = toNullableNumber(firstDefined(result, [
    "logisticsScore", "logisticsDsrScore", "deliveryScore", "shippingScore",
  ]));
  const dsr_service_score = toNullableNumber(firstDefined(result, [
    "serviceScore", "serviceDsrScore", "customerServiceScore",
  ]));
  const dsr_description_score = toNullableNumber(firstDefined(result, [
    "descriptionScore", "descriptionDsrScore", "productScore", "goodsScore",
  ]));
  if ([dsr_score, dsr_logistics_score, dsr_service_score, dsr_description_score].every((v) => v == null)) return;
  const upsert = db.prepare(`
    INSERT INTO temu_shop_stats (
      id, tenant_id, mall_id, site, stat_date,
      dsr_score, dsr_logistics_score, dsr_service_score, dsr_description_score, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date,
      @dsr_score, @dsr_logistics_score, @dsr_service_score, @dsr_description_score, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, site, stat_date) DO UPDATE SET
      dsr_score             = COALESCE(excluded.dsr_score, dsr_score),
      dsr_logistics_score   = COALESCE(excluded.dsr_logistics_score, dsr_logistics_score),
      dsr_service_score     = COALESCE(excluded.dsr_service_score, dsr_service_score),
      dsr_description_score = COALESCE(excluded.dsr_description_score, dsr_description_score),
      sources_json          = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at       = datetime('now')
  `);
  upsert.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: eventMallId(ctx, evt),
    site: String(evt.site || ""),
    stat_date: eventStatDate(evt),
    dsr_score, dsr_logistics_score, dsr_service_score, dsr_description_score,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- 商品数据看板（goodsDataShow） ----------

function parseGoodsDataShow(db, ctx, evt, body) {
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_goods_data_snapshot (
      id, tenant_id, mall_id, site, stat_date,
      product_id, goods_id, skc_id, title, thumb_url, category_name,
      expose_num, click_num, detail_visit_num, detail_visitor_num,
      add_cart_num, collect_num, order_num, pay_amount_cents, guv, pv,
      module_name, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date,
      @product_id, @goods_id, @skc_id, @title, @thumb_url, @category_name,
      @expose_num, @click_num, @detail_visit_num, @detail_visitor_num,
      @add_cart_num, @collect_num, @order_num, @pay_amount_cents, @guv, @pv,
      @module_name, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, product_id, stat_date) DO UPDATE SET
      goods_id          = COALESCE(excluded.goods_id, goods_id),
      skc_id            = COALESCE(excluded.skc_id, skc_id),
      title             = COALESCE(excluded.title, title),
      thumb_url         = COALESCE(excluded.thumb_url, thumb_url),
      category_name     = COALESCE(excluded.category_name, category_name),
      expose_num        = COALESCE(excluded.expose_num, expose_num),
      click_num         = COALESCE(excluded.click_num, click_num),
      detail_visit_num  = COALESCE(excluded.detail_visit_num, detail_visit_num),
      detail_visitor_num= COALESCE(excluded.detail_visitor_num, detail_visitor_num),
      add_cart_num       = COALESCE(excluded.add_cart_num, add_cart_num),
      collect_num       = COALESCE(excluded.collect_num, collect_num),
      order_num         = COALESCE(excluded.order_num, order_num),
      pay_amount_cents  = COALESCE(excluded.pay_amount_cents, pay_amount_cents),
      guv               = COALESCE(excluded.guv, guv),
      pv                = COALESCE(excluded.pv, pv),
      module_name       = COALESCE(excluded.module_name, module_name),
      source_event_id   = excluded.source_event_id,
      sources_json      = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at   = datetime('now')
  `);
  const stat_date = normalizeStatDate(firstDefined(body?.result || body?.data || {}, ["statDate", "date", "dataDate", "updateTime"]), evt);
  const mall_id = eventMallId(ctx, evt);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const product_id = toNullableString(firstDefined(row, ["productId", "goodsId", "spuId", "productSpuId"]));
    if (!product_id) continue;
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || "",
      stat_date,
      product_id,
      goods_id: toNullableString(firstDefined(row, ["goodsId", "goods_id"])),
      skc_id: toNullableString(firstDefined(row, ["productSkcId", "skcId"])),
      title: toNullableString(firstDefined(row, ["goodsName", "productName", "title", "name"]), 500),
      thumb_url: toNullableString(firstDefined(row, ["thumbUrl", "imageUrl", "mainImage", "goodsImg"]), 1000),
      category_name: toNullableString(firstDefined(row, ["categoryName", "catName", "catePathName"]), 300),
      expose_num: toNullableInteger(firstDefined(row, ["exposeNum", "exposureCount", "impressionNum", "showNum"])),
      click_num: toNullableInteger(firstDefined(row, ["clickNum", "clickCount", "tapNum"])),
      detail_visit_num: toNullableInteger(firstDefined(row, ["detailVisitNum", "detailPageView", "detailPv"])),
      detail_visitor_num: toNullableInteger(firstDefined(row, ["detailVisitorNum", "detailUv", "detailVisitUv"])),
      add_cart_num: toNullableInteger(firstDefined(row, ["addToCartNum", "addCartNum", "addToCartUserNum", "cartNum"])),
      collect_num: toNullableInteger(firstDefined(row, ["collectNum", "collectUserNum", "favoriteNum"])),
      order_num: toNullableInteger(firstDefined(row, ["orderNum", "payOrderNum", "payGoodsNum", "saleNum"])),
      pay_amount_cents: toCents(firstDefined(row, ["payAmount", "gmv", "saleAmount", "tradeAmount"]), "payAmount"),
      guv: toNullableInteger(firstDefined(row, ["guv", "goodsUv", "productUv"])),
      pv: toNullableInteger(firstDefined(row, ["pv", "goodsPv", "productPv", "pageView"])),
      module_name: toNullableString(firstDefined(row, ["moduleName", "module", "channelName"]), 200),
      source_event_id: evt.id,
      sources_json,
    });
  }
}

// ---------- 优惠券日报（couponDailyList） ----------

function parseCouponDaily(db, ctx, evt, body) {
  const result = body?.result || body?.data || body;
  if (!result || typeof result !== "object") return;
  const list = Array.isArray(result) ? result : (result.list || result.items || result.dataList);
  const count = Array.isArray(list) ? list.length : toNullableInteger(firstDefined(result, ["activeCount", "totalCount", "count"]));
  if (count == null && !Array.isArray(list)) return;
  const upsert = db.prepare(`
    INSERT INTO temu_shop_stats (
      id, tenant_id, mall_id, site, stat_date, coupon_active_count, sources_json
    ) VALUES (@id, @tenant_id, @mall_id, @site, @stat_date, @coupon_active_count, @sources_json)
    ON CONFLICT(tenant_id, mall_id, site, stat_date) DO UPDATE SET
      coupon_active_count = COALESCE(excluded.coupon_active_count, coupon_active_count),
      sources_json = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  upsert.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: eventMallId(ctx, evt),
    site: String(evt.site || ""),
    stat_date: eventStatDate(evt),
    coupon_active_count: count,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- 每日商品咨询访问（dailyMallGoods） ----------

function parseDailyMallGoods(db, ctx, evt, body) {
  const result = body?.result || body?.data || body;
  if (!result || typeof result !== "object") return;
  const count = toNullableInteger(firstDefined(result, [
    "consultVisitCount", "visitCount", "totalCount", "count",
  ]));
  if (count == null) return;
  const upsert = db.prepare(`
    INSERT INTO temu_shop_stats (
      id, tenant_id, mall_id, site, stat_date, daily_consult_visit_count, sources_json
    ) VALUES (@id, @tenant_id, @mall_id, @site, @stat_date, @daily_consult_visit_count, @sources_json)
    ON CONFLICT(tenant_id, mall_id, site, stat_date) DO UPDATE SET
      daily_consult_visit_count = COALESCE(excluded.daily_consult_visit_count, daily_consult_visit_count),
      sources_json = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  upsert.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: eventMallId(ctx, evt),
    site: String(evt.site || ""),
    stat_date: eventStatDate(evt),
    daily_consult_visit_count: count,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- 商品 UV/PV（goodsInfo/guvPv） ----------

function parseGoodsInfoGuvPv(db, ctx, evt, body) {
  const list = pickList(body);
  if (!Array.isArray(list) || !list.length) return;
  const stat_date = normalizeStatDate(firstDefined(body?.result || body?.data || {}, ["statDate", "date"]), evt);
  const mall_id = eventMallId(ctx, evt);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  const upsert = db.prepare(`
    INSERT INTO temu_goods_data_snapshot (
      id, tenant_id, mall_id, site, stat_date, product_id, goods_id, guv, pv,
      source_event_id, sources_json
    ) VALUES (@id, @tenant_id, @mall_id, @site, @stat_date, @product_id, @goods_id, @guv, @pv,
      @source_event_id, @sources_json)
    ON CONFLICT(tenant_id, mall_id, product_id, stat_date) DO UPDATE SET
      goods_id    = COALESCE(excluded.goods_id, goods_id),
      guv         = COALESCE(excluded.guv, guv),
      pv          = COALESCE(excluded.pv, pv),
      source_event_id = excluded.source_event_id,
      sources_json = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const product_id = toNullableString(firstDefined(row, ["productId", "goodsId", "spuId"]));
    if (!product_id) continue;
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || "",
      stat_date,
      product_id,
      goods_id: toNullableString(firstDefined(row, ["goodsId", "goods_id"])),
      guv: toNullableInteger(firstDefined(row, ["guv", "goodsUv", "uv"])),
      pv: toNullableInteger(firstDefined(row, ["pv", "goodsPv", "pageView"])),
      source_event_id: evt.id,
      sources_json,
    });
  }
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
      mall_id: eventMallId(ctx, evt), site: evt.site || null,
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
      mall_id: eventMallId(ctx, evt), site: evt.site || null,
      title: null, category_id: null, category_name: null, status: null, thumb_url: null, spec_summary: null,
      declared_price_cents: null, suggested_price_cents,
      price_currency: currency ? String(currency).slice(0, 8) : null,
      sales_total: null, stock_available: null, compliance_status: null,
      sources_json, now,
    });
  }
}

// ---------- 调度器 ----------

// ---------- TEMU operation risks / shop inspection ----------

function operationRiskTypeFromPath(path) {
  const text = String(path || "");
  if (/tmod_punish|merchant_appeal/i.test(text)) return "violation_goods";
  if (/pageQueryDeliveryBatch|pageQueryDeliveryOrders/i.test(text)) return "delivery_order";
  if (/queryAllFeedbackRecordInfo|pageQueryProblemWaybills/i.test(text)) return "logistics_feedback";
  if (/searchQcSubBillHistory/i.test(text)) return "spot_check_history";
  if (/searchQcSubBill|querySubOrderList/i.test(text)) return "spot_check";
  if (/queryWeekInboundExceptionDetailInfo|supplier\/exception/i.test(text)) return "inbound_exception";
  if (/returnSupplier/i.test(text)) return "return_package";
  if (/high\/price\/flow\/reduce|queryCompetitor|querySiteTargetPrice|batchQueryCustomerQueryLimit/i.test(text)) return "high_price_flow";
  if (/bg-brando-mms\/supplier\/data\/center\/skc\/sales\/data/i.test(text)) return "regional_sales";
  return "operation";
}

function operationRiskSeverity(type, row) {
  const statusText = [
    row?.status, row?.state, row?.auditStatus, row?.orderStatus, row?.exceptionStatus,
    row?.reason, row?.exceptionReason, row?.punishReason, row?.feedbackType,
  ].map((value) => String(value || "")).join(" ");
  if (/违规|处罚|异常|失败|超时|未签收|限流|拒绝|退回|待处理|failed|timeout|abnormal|reject/i.test(statusText)) return "high";
  if (["violation_goods", "inbound_exception", "high_price_flow"].includes(type)) return "high";
  if (["logistics_feedback", "spot_check", "return_package"].includes(type)) return "medium";
  return "low";
}

function operationRiskItems(body) {
  const direct = pickList(body);
  if (Array.isArray(direct) && direct.length) return direct;
  const root = body?.result ?? body?.data ?? body;
  if (!root || typeof root !== "object") return [];
  const out = [];
  const seen = new Set();
  const stack = [{ node: root, depth: 0 }];
  while (stack.length && out.length < 2000) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node) || depth > 5) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      const objectRows = node.filter((item) => item && typeof item === "object" && !Array.isArray(item));
      if (objectRows.length) out.push(...objectRows);
      continue;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push({ node: value, depth: depth + 1 });
    }
  }
  if (out.length) return out;
  return root && typeof root === "object" && !Array.isArray(root) ? [root] : [];
}

function operationRiskKey(type, row, evt, index) {
  const key = firstDefined(row, [
    "deliveryOrderSn", "deliveryBatchSn", "subPurchaseOrderSn", "subOrderSn", "purchaseOrderSn",
    "parentOrderSn", "orderSn", "returnPackageSn", "packageSn", "waybillNo", "trackingNumber",
    "qcSubBillId", "qcBillId", "appealId", "punishId", "productSkcId", "skcId", "productId", "id",
  ]);
  return [type, key || evt.id, index].map((part) => String(part ?? "")).join("|").slice(0, 500);
}

function stockOrderItems(body) {
  const direct = pickList(body);
  if (Array.isArray(direct) && direct.length) return direct;
  return operationRiskItems(body);
}

function stockOrderRowKey(row, evt, index, sourceType = "") {
  const keyOrder = sourceType === "shipping_list"
    ? [
      "deliveryOrderSn", "deliveryOrderNo", "shipOrderSn", "shipOrderNo", "deliverOrderSn",
      "subPurchaseOrderSn", "subPurchaseOrderNo", "purchaseOrderSn", "purchaseOrderNo",
      "stockOrderNo", "stockOrderSn", "deliveryBatchSn", "deliveryBatchNo",
      "onlineOrderSn", "onlineOrderNo", "internalOrderSn", "internalOrderNo",
      "platformOrderSn", "orderSn", "id",
    ]
    : sourceType === "shipping_desk"
      ? [
        "deliveryBatchSn", "deliveryBatchNo", "batchSn", "batchNo",
        "deliveryOrderSn", "deliveryOrderNo", "shipOrderSn", "shipOrderNo", "deliverOrderSn",
        "subPurchaseOrderSn", "subPurchaseOrderNo", "purchaseOrderSn", "purchaseOrderNo",
        "stockOrderNo", "stockOrderSn", "onlineOrderSn", "onlineOrderNo",
        "internalOrderSn", "internalOrderNo", "platformOrderSn", "orderSn", "id",
      ]
      : [
        "subPurchaseOrderSn", "subPurchaseOrderNo", "purchaseOrderSn", "purchaseOrderNo",
        "stockOrderNo", "stockOrderSn", "deliveryOrderSn", "deliveryOrderNo",
        "deliveryBatchSn", "deliveryBatchNo", "onlineOrderSn", "onlineOrderNo",
        "internalOrderSn", "internalOrderNo", "platformOrderSn", "orderSn", "id",
      ];
  const key = firstDeepDefined(row, keyOrder, 3);
  const skc = firstDeepDefined(row, ["productSkcId", "productSKCId", "skcId", "skc_id"], 3);
  const sku = firstDeepDefined(row, ["productSkuId", "prodSkuId", "skuId", "sku_id"], 3);
  return [key || evt.id, skc || "", sku || "", index].map((part) => String(part ?? "")).join("|").slice(0, 500);
}

function stockOrderSourceTypeFromPath(path, page) {
  const urlText = String(path || "");
  const pageText = String(page || "");
  const combined = `${urlText} ${pageText}`;
  if (/shipping-list|pageQueryDeliveryOrders/i.test(combined)) return "shipping_list";
  if (/shipping-desk|pageQuerySubPurchaseOrder|pageQueryDeliveryBatch/i.test(combined)) return "shipping_desk";
  if (/querySubOrderList/i.test(urlText)) return "stock_order";
  return "stock_order";
}

function stockOrderStatus(row) {
  const textStatus = toNullableString(firstDeepDefined(row, [
    "statusName", "statusText", "statusDesc", "statusLabel",
    "orderStatusName", "orderStatusText", "orderStatusDesc",
    "stateName", "stateText", "stateDesc",
    "deliveryStatusName", "deliveryStatusText", "deliveryStatusDesc",
    "purchaseStatusName", "purchaseStatusText", "purchaseStatusDesc",
    "subOrderStatusName", "subOrderStatusText", "subOrderStatusDesc",
    "fulfillStatusName", "fulfillStatusText", "fulfillStatusDesc",
    "platformStatusName", "platformStatusText", "platformStatusDesc",
    "payStatusName", "payStatusText", "inboundStatusName", "inboundStatusText",
  ], 3), 100);
  if (textStatus) return textStatus;
  return toNullableString(firstDeepDefined(row, [
    "status", "orderStatus", "state", "deliveryStatus", "purchaseStatus",
    "subOrderStatus", "fulfillStatus", "platformStatus", "payStatus", "inboundStatus",
  ], 3), 100);
}

function pickDeepPriceCents(row, keys) {
  for (const key of keys) {
    const value = firstDeepDefined(row, [key], 3);
    if (value == null || value === "") continue;
    const cents = toCents(value, key);
    if (cents != null) return cents;
  }
  return null;
}

function pickDeepInteger(row, keys, options = {}) {
  let fallback = null;
  for (const key of keys) {
    const value = firstDeepDefined(row, [key], 3);
    if (value == null || value === "") continue;
    const num = toNullableInteger(value);
    if (num == null) continue;
    if (options.preferPositive && num > 0) return num;
    if (fallback == null) fallback = num;
    if (!options.preferPositive) return num;
  }
  return fallback;
}

function parseTemuStockOrders(db, ctx, evt, body) {
  const items = stockOrderItems(body);
  if (!items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_stock_order_snapshot (
      id, tenant_id, mall_id, site, source_type, row_key, stock_order_no, parent_order_no,
      delivery_order_sn, delivery_batch_sn, product_id, skc_id, sku_id, sku_ext_code,
      online_order_no, internal_order_no, order_amount_cents, currency,
      product_name, spec_name, demand_qty, delivered_qty, temu_status, warehouse_group,
      receive_warehouse_id, receive_warehouse_name, urgency_info, order_time, latest_ship_at,
      shipping_qty, inbound_qty, weight_kg, package_count, package_no, logistics_info,
      raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @source_type, @row_key, @stock_order_no, @parent_order_no,
      @delivery_order_sn, @delivery_batch_sn, @product_id, @skc_id, @sku_id, @sku_ext_code,
      @online_order_no, @internal_order_no, @order_amount_cents, @currency,
      @product_name, @spec_name, @demand_qty, @delivered_qty, @temu_status, @warehouse_group,
      @receive_warehouse_id, @receive_warehouse_name, @urgency_info, @order_time, @latest_ship_at,
      @shipping_qty, @inbound_qty, @weight_kg, @package_count, @package_no, @logistics_info,
      @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, row_key) DO UPDATE SET
      site                   = COALESCE(excluded.site, site),
      source_type            = COALESCE(excluded.source_type, source_type),
      stock_order_no         = COALESCE(excluded.stock_order_no, stock_order_no),
      parent_order_no        = COALESCE(excluded.parent_order_no, parent_order_no),
      delivery_order_sn      = COALESCE(excluded.delivery_order_sn, delivery_order_sn),
      delivery_batch_sn      = COALESCE(excluded.delivery_batch_sn, delivery_batch_sn),
      product_id             = COALESCE(excluded.product_id, product_id),
      skc_id                 = COALESCE(excluded.skc_id, skc_id),
      sku_id                 = COALESCE(excluded.sku_id, sku_id),
      sku_ext_code           = COALESCE(excluded.sku_ext_code, sku_ext_code),
      online_order_no        = COALESCE(excluded.online_order_no, online_order_no),
      internal_order_no      = COALESCE(excluded.internal_order_no, internal_order_no),
      order_amount_cents     = COALESCE(excluded.order_amount_cents, order_amount_cents),
      currency               = COALESCE(excluded.currency, currency),
      product_name           = COALESCE(excluded.product_name, product_name),
      spec_name              = COALESCE(excluded.spec_name, spec_name),
      demand_qty             = COALESCE(excluded.demand_qty, demand_qty),
      delivered_qty          = COALESCE(excluded.delivered_qty, delivered_qty),
      temu_status            = COALESCE(excluded.temu_status, temu_status),
      warehouse_group        = COALESCE(excluded.warehouse_group, warehouse_group),
      receive_warehouse_id   = COALESCE(excluded.receive_warehouse_id, receive_warehouse_id),
      receive_warehouse_name = COALESCE(excluded.receive_warehouse_name, receive_warehouse_name),
      urgency_info           = COALESCE(excluded.urgency_info, urgency_info),
      order_time             = COALESCE(excluded.order_time, order_time),
      latest_ship_at         = COALESCE(excluded.latest_ship_at, latest_ship_at),
      shipping_qty           = COALESCE(excluded.shipping_qty, shipping_qty),
      inbound_qty            = COALESCE(excluded.inbound_qty, inbound_qty),
      weight_kg              = COALESCE(excluded.weight_kg, weight_kg),
      package_count          = COALESCE(excluded.package_count, package_count),
      package_no             = COALESCE(excluded.package_no, package_no),
      logistics_info         = COALESCE(excluded.logistics_info, logistics_info),
      raw_json               = COALESCE(excluded.raw_json, raw_json),
      source_event_id        = COALESCE(excluded.source_event_id, source_event_id),
      sources_json           = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at        = datetime('now')
  `);
  const mall_id = eventMallId(ctx, evt);
  const source_type = stockOrderSourceTypeFromPath(evt.url_path, evt.page);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  items.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const stock_order_no = toNullableString(firstDeepDefined(row, [
      "subPurchaseOrderSn", "subPurchaseOrderNo", "purchaseOrderSn", "purchaseOrderNo",
      "stockOrderNo", "stockOrderSn", "platformPurchaseOrderSn", "platformPurchaseOrderNo",
    ], 3));
    const delivery_order_sn = toNullableString(firstDeepDefined(row, [
      "deliveryOrderSn", "deliveryOrderNo", "shipOrderSn", "shipOrderNo", "deliverOrderSn",
    ], 3));
    const delivery_batch_sn = toNullableString(firstDeepDefined(row, [
      "deliveryBatchSn", "deliveryBatchNo", "batchSn", "batchNo",
    ], 3));
    const skc_id = toNullableString(firstDeepDefined(row, [
      "productSkcId", "productSKCId", "skcId", "skc_id",
    ], 3));
    const sku_id = toNullableString(firstDeepDefined(row, [
      "productSkuId", "prodSkuId", "skuId", "sku_id",
    ], 3));
    if (!stock_order_no && !delivery_order_sn && !delivery_batch_sn && !skc_id && !sku_id) return;
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || null,
      source_type,
      row_key: stockOrderRowKey(row, evt, index, source_type),
      stock_order_no,
      parent_order_no: toNullableString(firstDeepDefined(row, [
        "parentOrderSn", "parentOrderNo", "parentPurchaseOrderSn", "parentPurchaseOrderNo",
      ], 3)),
      delivery_order_sn,
      delivery_batch_sn,
      product_id: toNullableString(firstDeepDefined(row, ["productId", "productSpuId", "spuId"], 3)),
      skc_id,
      sku_id,
      sku_ext_code: toNullableString(firstDeepDefined(row, [
        "skuExtCode", "extCode", "externalSkuCode", "supplierSkuCode", "skuCode", "specCode",
      ], 3), 200),
      online_order_no: toNullableString(firstDeepDefined(row, [
        "onlineOrderSn", "onlineOrderNo", "online_order_no", "platformOrderSn",
        "platformOrderNo", "parentOrderSn", "parentOrderNo",
      ], 3), 200),
      internal_order_no: toNullableString(firstDeepDefined(row, [
        "internalOrderSn", "internalOrderNo", "internal_order_no", "orderSn", "orderNo",
        "wbOrderSn", "wbOrderNo",
      ], 3), 200),
      order_amount_cents: pickDeepPriceCents(row, [
        "orderAmountCents", "orderAmountCent", "orderAmount", "totalAmountCents",
        "totalAmount", "payAmountCents", "payAmount", "amountCents", "amount",
      ]),
      currency: toNullableString(firstDeepDefined(row, [
        "currency", "currencyCode", "currency_code", "priceCurrency", "siteCurrency",
      ], 3), 20),
      product_name: toNullableString(firstDeepDefined(row, [
        "productName", "goodsName", "productTitle", "title", "name",
      ], 3), 500),
      spec_name: toNullableString(firstDeepDefined(row, [
        "specName", "skuSpecName", "productSkuSpec", "colorSpec", "skuName",
      ], 3), 500),
      demand_qty: toNullableInteger(firstDeepDefined(row, [
        "demandQty", "demandQuantity", "purchaseQuantity", "subPurchaseQuantity",
        "expectQuantity", "expectedQuantity", "requiredQuantity", "quantity", "qty",
        "waitDeliverQuantity", "waitDeliveryNum", "stockUpNum", "applyStockNum",
        "shouldDeliverQuantity", "planQuantity", "orderQuantity", "skuQuantity",
      ], 3)),
      delivered_qty: toNullableInteger(firstDeepDefined(row, [
        "deliveredQty", "deliveredQuantity", "deliverQuantity", "deliveryQuantity",
        "shippedQty", "shippedQuantity", "actualQuantity", "receivedQuantity",
        "arrivedQuantity", "arrivalQuantity", "inboundQuantity", "inStockQuantity",
        "deliverSkcNum", "receiveSkcNum",
      ], 3)),
      temu_status: stockOrderStatus(row),
      warehouse_group: toNullableString(firstDeepDefined(row, [
        "warehouseGroup", "warehouseGroupName", "warehouse", "warehouseName", "siteName",
      ], 3), 200),
      receive_warehouse_id: toNullableString(firstDeepDefined(row, [
        "receiveWarehouseId", "receiveSubWarehouseId", "subWarehouseId", "warehouseId",
      ], 3), 100),
      receive_warehouse_name: toNullableString(firstDeepDefined(row, [
        "receiveWarehouseName", "receiveSubWarehouseName", "subWarehouseName", "warehouseName",
      ], 3), 200),
      urgency_info: toNullableString(firstDeepDefined(row, [
        "urgencyInfo", "urgentInfo", "urgentType", "priority", "tag", "label",
      ], 3), 200),
      order_time: toNullableString(firstDeepDefined(row, [
        "orderTime", "createdAt", "createTime", "gmtCreate", "purchaseTime", "submitTime",
        "payTime", "paymentTime",
      ], 3), 100),
      latest_ship_at: toNullableString(firstDeepDefined(row, [
        "latestShipAt", "latestDeliveryTime", "expectShipTime", "expectedShipTime",
        "deliveryDeadline", "shipDeadline", "expectArriveTime", "expectedArriveTime",
        "expectReceiveTime", "expectedReceiveTime",
      ], 3), 100),
      shipping_qty: toNullableInteger(firstDeepDefined(row, [
        "shippingQty", "shippingQuantity", "sendQty", "sendQuantity", "deliveryQty",
        "deliveryQuantity", "deliverQty", "deliverQuantity", "shippedQty", "shippedQuantity",
        "deliverSkcNum", "skcPurchaseNum",
      ], 3)),
      inbound_qty: toNullableInteger(firstDeepDefined(row, [
        "inboundQty", "inboundQuantity", "arrivalQty", "arrivalQuantity",
        "receivedQty", "receivedQuantity", "inStockQuantity", "stockInQuantity",
        "receiveSkcNum",
      ], 3)),
      weight_kg: toNullableNumber(firstDeepDefined(row, [
        "weightKg", "weight_kg", "weight", "packageWeight", "packageWeightKg",
      ], 3)),
      package_count: pickDeepInteger(row, [
        "packageCount", "packageNum", "parcelCount", "parcelNum", "boxCount", "boxes",
        "expressPackageNum", "otherDeliveryPackageNum", "deliverPackageNum", "receivePackageNum",
      ], { preferPositive: true }),
      package_no: toNullableString(firstDeepDefined(row, [
        "packageNo", "packageSn", "parcelNo", "parcelSn", "waybillNo", "trackingNumber",
        "trackingNo", "logisticsNo",
      ], 3), 300),
      logistics_info: toNullableString(firstDeepDefined(row, [
        "logisticsInfo", "logisticsName", "logisticsCompany", "expressCompanyName",
        "expressCompany", "carrierName", "shipCompanyName",
      ], 3), 500),
      raw_json: toJsonText(row),
      source_event_id: evt.id,
      sources_json,
    });
  });
}

// ---------- JIT 建议关闭：querySuggestCloseJitSkc ----------

function jitSuggestItems(body) {
  const candidates = [
    body?.result?.suggestCloseJitSkcList,
    body?.result?.suggestCloseJitList,
    body?.result?.skcList,
    body?.data?.suggestCloseJitSkcList,
    body?.data?.suggestCloseJitList,
    body?.data?.skcList,
    body?.suggestCloseJitSkcList,
    body?.suggestCloseJitList,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  const generic = pickList(body);
  return Array.isArray(generic) ? generic : [];
}

function parseTemuJitStatus(db, ctx, evt, body) {
  const items = jitSuggestItems(body);
  if (!items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_jit_status_snapshot (
      id, tenant_id, mall_id, site, stat_date, skc_id, sku_id, product_name,
      jit_status, jit_close_time, suggest_close, raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date, @skc_id, @sku_id, @product_name,
      @jit_status, @jit_close_time, @suggest_close, @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, skc_id, stat_date) DO UPDATE SET
      site            = COALESCE(excluded.site, site),
      sku_id          = COALESCE(excluded.sku_id, sku_id),
      product_name    = COALESCE(excluded.product_name, product_name),
      jit_status      = COALESCE(excluded.jit_status, jit_status),
      jit_close_time  = COALESCE(excluded.jit_close_time, jit_close_time),
      suggest_close   = COALESCE(excluded.suggest_close, suggest_close),
      raw_json        = COALESCE(excluded.raw_json, raw_json),
      source_event_id = COALESCE(excluded.source_event_id, source_event_id),
      sources_json    = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  const mall_id = eventMallId(ctx, evt);
  const stat_date = eventStatDate(evt);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const skc_id = toNullableString(firstDeepDefined(item, [
      "productSkcId", "productSKCId", "skcId", "skc", "skcCode", "productSkcCode", "goodsSkcId",
    ], 3));
    if (!skc_id) continue;
    const suggestRaw = firstDeepDefined(item, [
      "suggestClose", "suggest_close", "needClose", "closeSuggest", "canClose", "suggestion",
    ], 3);
    const suggest_close = suggestRaw == null
      ? 1
      : (toNullableBooleanInteger(suggestRaw) ?? (toNullableInteger(suggestRaw) ? 1 : 0));
    const itemJson = JSON.stringify(item);
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || null,
      stat_date,
      skc_id,
      sku_id: toNullableString(firstDeepDefined(item, [
        "productSkuId", "skuId", "skuCode", "extCode",
      ], 3), 200),
      product_name: toNullableString(firstDeepDefined(item, [
        "productName", "goodsName", "title", "name",
      ], 3), 500),
      jit_status: toNullableString(firstDeepDefined(item, [
        "jitStatus", "status", "statusDesc", "statusText", "closeStatus",
      ], 3), 100),
      jit_close_time: toNullableString(firstDeepDefined(item, [
        "jitCloseTime", "closeTime", "suggestCloseTime", "closeDeadline", "gmtClose",
      ], 3), 100),
      suggest_close,
      raw_json: itemJson.length > 1_000_000 ? itemJson.slice(0, 1_000_000) : itemJson,
      source_event_id: evt.id,
      sources_json,
    });
  }
}

// ---------- 商品评价：/bg-luna-agent-seller/review/pageQuery ----------

function reviewItems(body) {
  const candidates = [
    body?.result?.pageItems,
    body?.result?.list,
    body?.result?.items,
    body?.data?.pageItems,
    body?.data?.list,
    body?.pageItems,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

function buildSpecSummary(specVOS) {
  if (!Array.isArray(specVOS) || !specVOS.length) return null;
  const parts = [];
  for (const spec of specVOS) {
    if (!spec || typeof spec !== "object") continue;
    const parent = String(spec.parentName ?? spec.parent_name ?? "").trim();
    const value = String(spec.specName ?? spec.spec_name ?? "").trim();
    if (!value) continue;
    parts.push(parent ? `${parent}=${value}` : value);
  }
  return parts.length ? parts.join("; ").slice(0, 500) : null;
}

function buildReviewCategoryPath(categoryPath) {
  if (!categoryPath || typeof categoryPath !== "object") return null;
  const parts = [];
  for (let i = 1; i <= 10; i++) {
    const node = categoryPath[`cat${i}`];
    if (node && typeof node === "object" && node.catName) {
      parts.push(String(node.catName));
    }
  }
  return parts.length ? parts.join(">").slice(0, 200) : null;
}

function parseTemuReview(db, ctx, evt, body) {
  const items = reviewItems(body);
  if (!items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_review_snapshot (
      id, tenant_id, mall_id, site, review_id,
      product_id, product_skc_id, product_sku_ids,
      goods_id, goods_skc_id, goods_sku_id, goods_name,
      score, comment, spec_summary, category_path,
      review_pictures, review_videos, status, on_sale, is_benefit_review,
      created_at_ts, raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @review_id,
      @product_id, @product_skc_id, @product_sku_ids,
      @goods_id, @goods_skc_id, @goods_sku_id, @goods_name,
      @score, @comment, @spec_summary, @category_path,
      @review_pictures, @review_videos, @status, @on_sale, @is_benefit_review,
      @created_at_ts, @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, review_id) DO UPDATE SET
      site             = COALESCE(excluded.site, site),
      product_id       = COALESCE(excluded.product_id, product_id),
      product_skc_id   = COALESCE(excluded.product_skc_id, product_skc_id),
      product_sku_ids  = COALESCE(excluded.product_sku_ids, product_sku_ids),
      goods_id         = COALESCE(excluded.goods_id, goods_id),
      goods_skc_id     = COALESCE(excluded.goods_skc_id, goods_skc_id),
      goods_sku_id     = COALESCE(excluded.goods_sku_id, goods_sku_id),
      goods_name       = COALESCE(excluded.goods_name, goods_name),
      score            = COALESCE(excluded.score, score),
      comment          = COALESCE(excluded.comment, comment),
      spec_summary     = COALESCE(excluded.spec_summary, spec_summary),
      category_path    = COALESCE(excluded.category_path, category_path),
      review_pictures  = COALESCE(excluded.review_pictures, review_pictures),
      review_videos    = COALESCE(excluded.review_videos, review_videos),
      status           = COALESCE(excluded.status, status),
      on_sale          = COALESCE(excluded.on_sale, on_sale),
      is_benefit_review = COALESCE(excluded.is_benefit_review, is_benefit_review),
      created_at_ts    = COALESCE(excluded.created_at_ts, created_at_ts),
      raw_json         = COALESCE(excluded.raw_json, raw_json),
      source_event_id  = COALESCE(excluded.source_event_id, source_event_id),
      sources_json     = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at  = datetime('now')
  `);
  const mall_id = eventMallId(ctx, evt);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const reviewId = toNullableString(firstDefined(item, ["reviewId", "review_id", "id"]));
    if (!reviewId) continue;
    const skuIds = item.productSkuIds ?? item.product_sku_ids;
    const itemJson = JSON.stringify(item);
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || null,
      review_id: reviewId,
      product_id: toNullableString(firstDefined(item, ["productId", "product_id"])),
      product_skc_id: toNullableString(firstDefined(item, ["productSkcId", "product_skc_id"])),
      product_sku_ids: Array.isArray(skuIds) ? JSON.stringify(skuIds) : null,
      goods_id: toNullableString(firstDefined(item, ["goodsId", "goods_id"])),
      goods_skc_id: toNullableString(firstDefined(item, ["goodsSkcId", "goods_skc_id"])),
      goods_sku_id: toNullableString(firstDefined(item, ["goodsSkuId", "goods_sku_id"])),
      goods_name: toNullableString(firstDefined(item, ["goodsName", "goods_name", "title"]), 500),
      score: toNullableInteger(firstDefined(item, ["score", "rating"])),
      comment: toNullableString(firstDefined(item, ["comment", "content", "reviewText"]), 5000),
      spec_summary: buildSpecSummary(item.specVOS),
      category_path: buildReviewCategoryPath(item.categoryPath),
      review_pictures: item.reviewPictures ? JSON.stringify(item.reviewPictures).slice(0, 10000) : null,
      review_videos: item.reviewVideos ? JSON.stringify(item.reviewVideos).slice(0, 10000) : null,
      status: toNullableInteger(firstDefined(item, ["status", "state"])),
      on_sale: toNullableBooleanInteger(item.onSale),
      is_benefit_review: toNullableBooleanInteger(item.isBenefitReview),
      created_at_ts: toNullableInteger(firstDefined(item, ["createdAtTs", "createTime", "createdAt"])),
      raw_json: itemJson.length > 200_000 ? itemJson.slice(0, 200_000) : itemJson,
      source_event_id: evt.id,
      sources_json,
    });
  }
}

function afterSaleTypeFromPath(path) {
  const text = String(path || "");
  // 只放行「列表」接口（行都带 packageSn / returnSupplierApplicationId，能正确归并）。
  // 退货包裹列表 + 包裹内 SKU 明细列表（都带 packageSn）→ 包裹维度
  if (/returnSupplier\/package\/pageQueryReturnSupplierPackage|returnSupplier\/package\/pageReturnPackageSkuDetailList/i.test(text)) return "return_package";
  if (/returnSupplier\/supplierException/i.test(text)) return "return_exception";
  // 退货申请单列表（含「按SKC退」，带 returnSupplierApplicationId / 状态 / 时间）→ 售后维度
  if (/afs\/queryPage|sellerReturnSupplierApplication\/pageQueryReturnSupplierApplicationForGmp/i.test(text)) return "after_sale";
  // 其余 returnSupplier/* 多为明细弹窗 / 动作 / 枚举接口
  //（queryReturnOrderDetail / createReturnSupplierApplication / queryReturnPackageSkcReason / *Enum / *PopUp / count* 等），
  // 不是列表数据，入库只会产生无父单号的孤儿 SKU 行 → 返回 null，调用方据此跳过。
  return null;
}

function afterSaleRowKey(type, row, evt, index) {
  const key = firstDeepDefined(row, [
    "returnSupplierApplicationId",
    "returnPackageSn", "returnPackageNo", "returnSupplierPackageNo", "packageSn", "packageNo",
    "afterSaleOrderSn", "afterSaleNo", "afsOrderSn", "afsNo",
    "orderSn", "parentOrderSn", "subOrderSn", "waybillNo", "trackingNumber", "id",
  ], 3);
  const skc = firstDeepDefined(row, ["productSkcId", "productSKCId", "skcId", "skc_id"], 3);
  const sku = firstDeepDefined(row, ["productSkuId", "prodSkuId", "skuId", "sku_id"], 3);
  // 包裹级汇总行（无 skc/sku，如退货包裹管理接口）用稳定后缀，避免分页 index 漂移产生重复行；
  // SKU 明细行（有 skc/sku）仍按 index 区分同一包裹下的多个 SKU。
  const tail = (skc || sku) ? index : "pkg";
  return [type, key || evt.id, skc || "", sku || "", tail].map((part) => String(part ?? "")).join("|").slice(0, 500);
}

function parseTemuAfterSales(db, ctx, evt, body) {
  const items = operationRiskItems(body);
  if (!items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_after_sale_snapshot (
      id, tenant_id, mall_id, site, row_key, after_sale_type, package_no, order_id,
      product_id, skc_id, sku_id, product_name, quantity, status, reason,
      logistics_no, warehouse_name, amount_cents, currency, created_at_text,
      updated_at_text, raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @row_key, @after_sale_type, @package_no, @order_id,
      @product_id, @skc_id, @sku_id, @product_name, @quantity, @status, @reason,
      @logistics_no, @warehouse_name, @amount_cents, @currency, @created_at_text,
      @updated_at_text, @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, row_key) DO UPDATE SET
      site             = COALESCE(excluded.site, site),
      after_sale_type  = COALESCE(excluded.after_sale_type, after_sale_type),
      package_no       = COALESCE(excluded.package_no, package_no),
      order_id         = COALESCE(excluded.order_id, order_id),
      product_id       = COALESCE(excluded.product_id, product_id),
      skc_id           = COALESCE(excluded.skc_id, skc_id),
      sku_id           = COALESCE(excluded.sku_id, sku_id),
      product_name     = COALESCE(excluded.product_name, product_name),
      quantity         = COALESCE(excluded.quantity, quantity),
      status           = COALESCE(excluded.status, status),
      reason           = COALESCE(excluded.reason, reason),
      logistics_no     = COALESCE(excluded.logistics_no, logistics_no),
      warehouse_name   = COALESCE(excluded.warehouse_name, warehouse_name),
      amount_cents     = COALESCE(excluded.amount_cents, amount_cents),
      currency         = COALESCE(excluded.currency, currency),
      created_at_text  = COALESCE(excluded.created_at_text, created_at_text),
      updated_at_text  = COALESCE(excluded.updated_at_text, updated_at_text),
      raw_json         = COALESCE(excluded.raw_json, raw_json),
      source_event_id  = COALESCE(excluded.source_event_id, source_event_id),
      sources_json     = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at  = datetime('now')
  `);
  const mall_id = eventMallId(ctx, evt);
  const site = evt.site || null;
  const after_sale_type = afterSaleTypeFromPath(evt.url_path);
  if (!after_sale_type) return; // 明细弹窗 / 动作 / 枚举接口不入快照（避免孤儿 SKU 行）
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  items.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const package_no = toNullableString(firstDeepDefined(row, [
      "returnSupplierApplicationId",
      "returnPackageSn", "returnPackageNo", "returnSupplierPackageNo", "packageSn", "packageNo",
      "afterSaleOrderSn", "afterSaleNo", "afsOrderSn", "afsNo",
    ], 3));
    const order_id = toNullableString(firstDeepDefined(row, [
      "orderSn", "orderNo", "parentOrderSn", "parentOrderNo", "subOrderSn", "subOrderNo",
      "purchaseOrderSn", "purchaseOrderNo",
    ], 3));
    const skc_id = toNullableString(firstDeepDefined(row, [
      "productSkcId", "productSKCId", "skcId", "skc_id",
    ], 3));
    const sku_id = toNullableString(firstDeepDefined(row, [
      "productSkuId", "prodSkuId", "skuId", "sku_id",
    ], 3));
    if (!package_no && !order_id && !skc_id && !sku_id) return;
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site,
      row_key: afterSaleRowKey(after_sale_type, row, evt, index),
      after_sale_type,
      package_no,
      order_id,
      product_id: toNullableString(firstDeepDefined(row, ["productId", "productSpuId", "spuId"], 3)),
      skc_id,
      sku_id,
      product_name: toNullableString(firstDeepDefined(row, [
        "productName", "goodsName", "productTitle", "title", "name",
      ], 3), 500),
      quantity: toNullableInteger(firstDeepDefined(row, [
        "quantity", "qty", "returnQuantity", "returnQty", "refundQuantity", "refundQty",
        "returnSupplierQuantity", "goodsQuantity", "skuQuantity", "applyQuantity",
      ], 3)),
      status: toNullableString(firstDeepDefined(row, [
        // 中文状态描述优先于数字状态码：packageStatusDesc(包裹「已出库」) / statusDescription(申请单「审核通过」)
        "packageStatusDesc", "statusDescription", "status", "statusName", "state", "stateName", "afterSaleStatus",
        "returnStatus", "packageStatus", "auditStatus",
      ], 3), 100),
      reason: toNullableString(firstDeepDefined(row, [
        "returnSupplierReasonDesc", "reason", "returnReason", "refundReason", "afterSaleReason",
        "feedbackReason", "exceptionReason", "remark",
      ], 3), 500),
      logistics_no: toNullableString(firstDeepDefined(row, [
        "expressDeLiverySn", "waybillNo", "trackingNumber", "trackingNo", "logisticsNo", "expressNo", "mailNo",
      ], 3), 200),
      warehouse_name: toNullableString(firstDeepDefined(row, [
        "returnSubWarehouseName", "warehouseName", "receiveWarehouseName", "returnWarehouseName", "siteName",
      ], 3), 200),
      amount_cents: pickPriceCents(row, [
        "amountCents", "refundAmountCents", "returnAmountCents", "refundFeeCents",
        "amount", "refundAmount", "returnAmount", "refundFee",
      ]),
      currency: toNullableString(firstDeepDefined(row, [
        "currency", "currencyCode", "currencyType", "priceCurrency",
      ], 3), 20),
      created_at_text: toNullableString(firstDeepDefined(row, [
        "createdAt", "createTime", "gmtCreate", "applyTime", "returnCreateTime", "createdAtTimestamp",
      ], 3), 100),
      updated_at_text: toNullableString(firstDeepDefined(row, [
        "updatedAt", "updateTime", "gmtModified", "operateTime", "finishTime",
      ], 3), 100),
      raw_json: toJsonText(row),
      source_event_id: evt.id,
      sources_json,
    });
  });
}

function parseOperationRisk(db, ctx, evt, body) {
  const type = operationRiskTypeFromPath(evt.url_path);
  const items = operationRiskItems(body);
  if (!items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_operation_risk_snapshot (
      id, tenant_id, mall_id, site, stat_date, risk_type, risk_key,
      risk_title, risk_status, severity, product_id, skc_id, goods_id,
      order_id, quantity, metric_json, raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date, @risk_type, @risk_key,
      @risk_title, @risk_status, @severity, @product_id, @skc_id, @goods_id,
      @order_id, @quantity, @metric_json, @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, risk_type, risk_key, stat_date) DO UPDATE SET
      site            = COALESCE(excluded.site, site),
      risk_title      = COALESCE(excluded.risk_title, risk_title),
      risk_status     = COALESCE(excluded.risk_status, risk_status),
      severity        = COALESCE(excluded.severity, severity),
      product_id      = COALESCE(excluded.product_id, product_id),
      skc_id          = COALESCE(excluded.skc_id, skc_id),
      goods_id        = COALESCE(excluded.goods_id, goods_id),
      order_id        = COALESCE(excluded.order_id, order_id),
      quantity        = COALESCE(excluded.quantity, quantity),
      metric_json     = COALESCE(excluded.metric_json, metric_json),
      raw_json        = COALESCE(excluded.raw_json, raw_json),
      source_event_id = COALESCE(excluded.source_event_id, source_event_id),
      sources_json    = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  const stat_date = normalizeStatDate(firstDefined(body?.result || body?.data || {}, ["statDate", "date", "dataDate", "updateTime"]), evt);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  const mall_id = eventMallId(ctx, evt);
  items.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const order_id = toNullableString(firstDeepDefined(row, [
      "deliveryOrderSn", "deliveryBatchSn", "subPurchaseOrderSn", "subOrderSn", "purchaseOrderSn",
      "parentOrderSn", "orderSn", "returnPackageSn", "packageSn", "waybillNo", "trackingNumber",
      "qcSubBillId", "qcBillId", "appealId", "punishId", "id",
    ], 2));
    const product_id = toNullableString(firstDeepDefined(row, ["productId", "productSpuId", "spuId"], 2));
    const skc_id = toNullableString(firstDeepDefined(row, ["productSkcId", "productSKCId", "skcId", "skc_id"], 2));
    const goods_id = toNullableString(firstDeepDefined(row, ["goodsId", "goods_id"], 2));
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || null,
      stat_date,
      risk_type: type,
      risk_key: operationRiskKey(type, row, evt, index),
      risk_title: toNullableString(firstDeepDefined(row, [
        "productName", "goodsName", "title", "name", "exceptionReason", "reason",
        "punishReason", "feedbackReason", "qcReason", "warehouseName", "siteName",
      ], 2), 500),
      risk_status: toNullableString(firstDeepDefined(row, [
        "status", "state", "auditStatus", "orderStatus", "exceptionStatus", "qcStatus", "feedbackStatus",
      ], 2), 100),
      severity: operationRiskSeverity(type, row),
      product_id,
      skc_id,
      goods_id,
      order_id,
      quantity: toNullableInteger(firstDeepDefined(row, [
        "quantity", "qty", "expectQuantity", "expectedQuantity", "actualQuantity", "deliverQuantity",
        "purchaseQuantity", "returnQuantity", "stockNum", "lackNum",
      ], 2)),
      metric_json: toJsonText({
        sourcePath: evt.url_path,
        status: firstDeepDefined(row, ["status", "state", "auditStatus", "orderStatus", "exceptionStatus"], 2),
        reason: firstDeepDefined(row, ["reason", "exceptionReason", "punishReason", "feedbackReason", "qcReason"], 2),
        supplierName: firstDeepDefined(row, ["supplierName", "mallName", "warehouseName"], 2),
        logisticsNo: firstDeepDefined(row, ["waybillNo", "trackingNumber", "logisticsNo", "expressNo"], 2),
        createdAt: firstDeepDefined(row, ["createdAt", "createTime", "gmtCreate", "orderCreateTime"], 2),
        updatedAt: firstDeepDefined(row, ["updatedAt", "updateTime", "gmtModified", "operateTime"], 2),
      }, 20000),
      raw_json: toJsonText(row),
      source_event_id: evt.id,
      sources_json,
    });
  });
}

// ---------- TEMU activity / marketing ----------

function activityKindFromPath(path) {
  const text = String(path || "");
  if (/coupon/i.test(text)) return "coupon";
  if (/bidding|Bidding|ace/i.test(text)) return "bidding";
  if (/bsr|colossus/i.test(text)) return "bsr";
  if (/gambit|gamblers|marketing|activity|sale\/manage\/supplier\/api\/activity/i.test(text)) return "activity";
  return "marketing";
}

function toJsonText(value, max = 200000) {
  if (value == null) return null;
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

const ACTIVITY_ARRAY_META = {
  goodsCouponGoodsVOS: { activityTitle: "商品券推荐商品", activityType: "商品券" },
  mallCouponGoodsVOS: { activityTitle: "店铺券推荐商品", activityType: "店铺券" },
  rcActivityGoodsVOS: { activityTitle: "资源位推荐商品", activityType: "资源位活动" },
  activityList: { activityType: "活动报名" },
  thematicList: { activityType: "活动主题" },
  sessionList: { activityType: "活动场次" },
  sessionAggList: { activityType: "活动场次" },
  matchList: { activityTitle: "活动匹配", activityType: "活动匹配" },
  productList: {},
  goodsList: {},
  pageItems: {},
  dataList: {},
  items: {},
  subOrderList: {},
  list: {},
};

function activityMetaForPath(path, arrayKey = "") {
  const text = String(path || "");
  const meta = { ...(ACTIVITY_ARRAY_META[arrayKey] || {}) };
  if (/\/api\/activity\/data\/goods\/detail/i.test(text)) {
    meta.activityTitle = meta.activityTitle || "活动商品数据";
    meta.activityType = meta.activityType || "活动数据";
  } else if (/\/api\/activity\/data\/market\//i.test(text)) {
    meta.activityTitle = meta.activityTitle || "活动大盘数据";
    meta.activityType = meta.activityType || "活动数据";
  } else if (/activity\/tool\/home\/picksGoods/i.test(text)) {
    meta.activityType = meta.activityType || "活动推荐";
  } else if (/activity\/list\/for\/home/i.test(text)) {
    meta.activityType = meta.activityType || "活动报名";
  } else if (/biddingInvitation/i.test(text)) {
    meta.activityType = meta.activityType || "竞价活动";
  }
  return meta;
}

function mergeActivityMeta(base, next) {
  return Object.fromEntries(
    Object.entries({ ...(base || {}), ...(next || {}) }).filter(([, value]) => value != null && value !== ""),
  );
}

function activityMetaFromRequest(body) {
  const req = body?.__request;
  if (!isRecord(req)) return {};
  const productIds = Array.isArray(req.productIds) ? req.productIds : [];
  const productSkcIds = Array.isArray(req.productSkcIds) ? req.productSkcIds : [];
  const goodsIds = Array.isArray(req.goodsIds) ? req.goodsIds : [];
  return {
    activityId: firstDefined(req, ["activityThematicId", "activityId", "themeId", "topicId"]),
    activityTitle: firstDefined(req, ["activityThematicName", "activityName", "activityTitle", "themeName", "topicName"]),
    activityType: firstDefined(req, ["activityType", "activityTypeName"]),
    productId: productIds[0] ?? firstDefined(req, ["productId", "spuId"]),
    skcId: productSkcIds[0] ?? firstDefined(req, ["productSkcId", "skcId"]),
    goodsId: goodsIds[0] ?? firstDefined(req, ["goodsId"]),
  };
}

const NO_ACTIVITY_STATUS = "\u672a\u53c2\u52a0\u6d3b\u52a8";

function isActiveActivityLibraryEvent(evt) {
  return /\/marketing\/enroll\/list/i.test(String(evt?.url_path || evt?.url || ""));
}

function requestedActivitySkcIds(body) {
  const req = body?.__request;
  if (!isRecord(req) || !Array.isArray(req.productSkcIds)) return [];
  const seen = new Set();
  const out = [];
  for (const value of req.productSkcIds) {
    const id = String(value == null ? "" : value).trim();
    if (!/^\d{5,}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function itemActivitySkcIds(item, out) {
  if (!isRecord(item)) return;
  const direct = firstDefined(item, ["productSkcId", "skcId", "skc_id"]);
  if (direct != null && /^\d{5,}$/.test(String(direct))) out.add(String(direct));
  const skcList = Array.isArray(item.skcList) ? item.skcList : [];
  for (const skc of skcList) {
    if (!isRecord(skc)) continue;
    const skcId = firstDefined(skc, ["productSkcId", "skcId", "skc_id"]);
    if (skcId != null && /^\d{5,}$/.test(String(skcId))) out.add(String(skcId));
  }
}

function appendMissingActivitySkcItems(items, body, evt, meta) {
  if (!isActiveActivityLibraryEvent(evt)) return items;
  const requested = requestedActivitySkcIds(body);
  if (!requested.length) return items;
  const present = new Set();
  for (const item of items) itemActivitySkcIds(item, present);
  const next = [...items];
  for (const skcId of requested) {
    if (present.has(skcId)) continue;
    next.push({
      productSkcId: skcId,
      activityStatus: NO_ACTIVITY_STATUS,
      __checkedNoActivity: true,
      __activity_meta: mergeActivityMeta(meta, {
        activityId: `no-activity:${skcId}`,
        activityTitle: NO_ACTIVITY_STATUS,
        activityType: NO_ACTIVITY_STATUS,
        skcId,
      }),
    });
  }
  return next;
}

function activityListFromRoot(root) {
  const out = [];
  if (Array.isArray(root)) out.push(["result", root]);
  if (!isRecord(root)) return out;
  for (const key of Object.keys(ACTIVITY_ARRAY_META)) {
    if (Array.isArray(root[key]) && root[key].length) out.push([key, root[key]]);
  }
  return out;
}

function normalizeActivityItem(item, meta) {
  if (!isRecord(item)) return null;
  const order = isRecord(item.biddingInvitationOrder) ? item.biddingInvitationOrder : null;
  if (!order) return { ...item, __activity_meta: meta };
  return {
    ...order,
    ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "biddingInvitationOrder")),
    biddingInvitationOrder: order,
    __activity_meta: mergeActivityMeta(meta, {
      activityId: firstDefined(order, ["biddingInvitationOrderSn", "orderSn", "invitationTopicId", "topicId", "id"]),
      activityTitle: firstDefined(order, ["topicName", "activityName", "title", "name"]),
    }),
  };
}

function pushActivityItem(out, item, meta, evt) {
  if (!isRecord(item)) return;
  const localMeta = mergeActivityMeta(meta, item.__activity_meta);
  const order = isRecord(item.biddingInvitationOrder) ? item.biddingInvitationOrder : null;
  const skcList = Array.isArray(item.skcList) ? item.skcList : [];
  if (skcList.length) {
    for (const skc of skcList) {
      if (!isRecord(skc)) continue;
      const skuList = Array.isArray(skc.skuList) && skc.skuList.length ? skc.skuList : [null];
      for (const sku of skuList) {
        const skuObj = isRecord(sku) ? sku : {};
        out.push({
          ...item,
          ...skc,
          ...skuObj,
          productId: firstDefined(item, ["productId", "productSpuId", "spuId"]) ?? localMeta.productId,
          productSkcId: firstDefined(skc, ["productSkcId", "skcId"]) ?? firstDefined(item, ["productSkcId", "skcId"]) ?? localMeta.skcId,
          __activity_parent: item,
          __activity_meta: mergeActivityMeta(localMeta, {
            activityId: firstDefined(item, ["activityThematicId", "activityId", "activityThemeId", "themeId", "topicId"]) ?? localMeta.activityId,
            activityTitle: firstDefined(item, ["activityThematicName", "activityName", "activityTitle", "themeName", "topicName", "name", "title"]) || localMeta.activityTitle,
            activityType: (firstDefined(item, ["activityTypeName", "activityType"]) ?? localMeta.activityType) || "活动匹配",
          }),
        });
      }
    }
    return;
  }
  const nestedActivityLists = [
    ["thematicList", item.thematicList],
    ["sessionList", item.sessionList],
    ["sessionAggList", item.sessionAggList],
  ].filter(([, value]) => Array.isArray(value) && value.length);
  if (nestedActivityLists.length) {
    for (const [arrayKey, list] of nestedActivityLists) {
      const childMeta = mergeActivityMeta(localMeta, activityMetaForPath(evt.url_path, arrayKey));
      for (const child of list) {
        if (!isRecord(child)) continue;
        out.push({
          ...item,
          ...child,
          __activity_parent: item,
          __activity_meta: mergeActivityMeta(childMeta, {
            activityId: firstDefined(child, ["activityThematicId", "activityId", "themeId", "topicId"]),
            activityTitle: firstDefined(child, ["activityThematicName", "activityName", "themeName", "topicName"]) || firstDefined(item, ["activityName", "activityTitle", "name", "title"]),
            activityType: firstDefined(child, ["activityType", "activityTypeName"]) ?? firstDefined(item, ["activityType", "activityTypeName"]),
          }),
        });
      }
    }
    return;
  }
  const productLists = [
    ["biddingProductList", item.biddingProductList],
    ["productList", item.productList],
    ["goodsList", item.goodsList],
  ].filter(([, value]) => Array.isArray(value) && value.length);
  if (productLists.length) {
    for (const [arrayKey, list] of productLists) {
      const productMeta = mergeActivityMeta(localMeta, activityMetaForPath(evt.url_path, arrayKey));
      for (const product of list) {
        if (!isRecord(product)) continue;
        out.push({
          ...(order || {}),
          ...product,
          __activity_meta: productMeta,
          __activity_parent: order || item,
        });
      }
    }
    return;
  }
  const normalized = normalizeActivityItem(item, localMeta);
  if (normalized) out.push(normalized);
}

function pickActivityItems(body, evt) {
  const requestMeta = activityMetaFromRequest(body);
  const list = pickList(body);
  if (Array.isArray(list) && list.length) {
    const out = [];
    const meta = mergeActivityMeta(activityMetaForPath(evt.url_path, "list"), requestMeta);
    for (const item of list) pushActivityItem(out, item, meta, evt);
    const withMissing = appendMissingActivitySkcItems(out, body, evt, meta);
    if (withMissing.length) return withMissing;
    return list;
  }
  const result = body?.result ?? body?.data ?? body;
  const out = [];
  const baseMeta = mergeActivityMeta(activityMetaForPath(evt.url_path), requestMeta);
  for (const [arrayKey, array] of activityListFromRoot(result)) {
    const meta = mergeActivityMeta(activityMetaForPath(evt.url_path, arrayKey), requestMeta);
    for (const item of array) pushActivityItem(out, item, meta, evt);
  }
  const withMissing = appendMissingActivitySkcItems(out, body, evt, baseMeta);
  if (withMissing.length) return withMissing;
  if (isActiveActivityLibraryEvent(evt)) return [];
  return result && typeof result === "object"
    ? [{ ...result, __activity_meta: baseMeta }]
    : [];
}

function pickActivityPriceCents(item, keys) {
  for (const key of keys) {
    const raw = firstDeepDefined(item, [key], 3);
    if (raw == null || raw === "") continue;
    const value = raw && typeof raw === "object"
      ? firstDefined(raw, ["priceCents", "priceCent", "cent", "cents", "amount", "value", "price"])
      : raw;
    const cents = toCents(value, key);
    if (cents != null) return cents;
  }
  return null;
}

function pickActivityInteger(item, keys) {
  const raw = firstDeepDefined(item, keys, 3);
  return toNullableInteger(raw);
}

function stringifyActivitySkuSpec(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.map(stringifyActivitySkuSpec).filter(Boolean).join(" / ");
  if (typeof value !== "object") return String(value).trim();
  const direct = firstDefined(value, ["specText", "skuAttr", "skuAttrText", "skuAttribute", "skuName", "className", "attrName"]);
  if (direct != null && direct !== "") return String(direct).trim();
  const label = firstDefined(value, ["parentSpecName", "specKey", "key", "name", "label"]);
  const text = firstDefined(value, ["specName", "unitSpecName", "value", "text", "title"]);
  return [label, text].filter((part) => part != null && part !== "").map((part) => String(part).trim()).join(": ");
}

function activitySkuAttrText(item) {
  const direct = firstDeepDefined(item, [
    "skuAttrText", "skuAttributeText", "skuPropertyText", "skuPropText",
    "skuName", "className", "specText", "specName",
  ], 2);
  const directText = stringifyActivitySkuSpec(direct);
  if (directText) return directText;
  const specList = firstDeepDefined(item, [
    "productSkuSpecList", "skuSpecList", "skuAttrList", "skuAttrs",
    "skuProperties", "skuPropertyList",
  ], 2);
  return stringifyActivitySkuSpec(specList);
}

function activityRowKey(item, evt, index) {
  const activityId = firstDefined(item, [
    "activityThematicId", "activityId", "activityThemeId", "themeId", "topicId",
    "invitationTopicId", "couponId", "promotionId", "campaignId", "biddingInvitationOrderSn", "orderSn", "id",
  ]);
  const meta = isRecord(item.__activity_meta) ? item.__activity_meta : {};
  const productId = firstDefined(item, ["productId", "productSpuId", "spuId", "spu_id", "goodsSpuId"]) ?? meta.productId;
  const skcId = firstDefined(item, ["productSkcId", "skcId", "skc_id"]) ?? meta.skcId;
  const skuId = firstDefined(item, ["productSkuId", "prodSkuId", "skuId", "sku_id"]);
  const skuExtCode = firstDefined(item, ["skuExtCode", "skuCode", "extCode", "externalSkuCode"]);
  const goodsId = firstDefined(item, ["goodsId", "goods_id"]) ?? meta.goodsId;
  return [
    activityKindFromPath(evt.url_path),
    activityId || meta.activityId || evt.id,
    productId || "",
    skcId || "",
    skuId || "",
    skuExtCode || "",
    goodsId || "",
    index,
  ].map((part) => String(part ?? "")).join("|").slice(0, 500);
}

// 已报名活动记录(/enroll/list 不带 sessionStatusTag/productSkcIds;list 项带 enrollId,可报库没有)。
// 分表 temu_activity_enroll_record,展开到 sku 维度,便于 ERP 按货号/SPU 聚合「已报活动数」。
function parseEnrollRecord(db, ctx, evt, body) {
  const result = body?.result || body?.data || body || {};
  const list = Array.isArray(result.list) ? result.list : [];
  if (!list.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_activity_enroll_record (
      id, tenant_id, mall_id, site, stat_date, row_key,
      enroll_id, enroll_status, enroll_time, activity_type, activity_thematic_id, activity_thematic_name,
      product_id, skc_id, sku_id, sku_ext_code, goods_id,
      activity_price_cents, daily_price_cents, activity_stock, sold_status, session_end_time, session_start_time,
      sites_json, raw_json, source_event_id
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date, @row_key,
      @enroll_id, @enroll_status, @enroll_time, @activity_type, @activity_thematic_id, @activity_thematic_name,
      @product_id, @skc_id, @sku_id, @sku_ext_code, @goods_id,
      @activity_price_cents, @daily_price_cents, @activity_stock, @sold_status, @session_end_time, @session_start_time,
      @sites_json, @raw_json, @source_event_id
    )
    ON CONFLICT(tenant_id, mall_id, row_key, stat_date) DO UPDATE SET
      enroll_status        = COALESCE(excluded.enroll_status, enroll_status),
      enroll_time          = COALESCE(excluded.enroll_time, enroll_time),
      activity_type        = COALESCE(excluded.activity_type, activity_type),
      activity_thematic_id = COALESCE(excluded.activity_thematic_id, activity_thematic_id),
      activity_thematic_name = COALESCE(excluded.activity_thematic_name, activity_thematic_name),
      product_id           = COALESCE(excluded.product_id, product_id),
      skc_id               = COALESCE(excluded.skc_id, skc_id),
      sku_id               = COALESCE(excluded.sku_id, sku_id),
      sku_ext_code         = COALESCE(excluded.sku_ext_code, sku_ext_code),
      goods_id             = COALESCE(excluded.goods_id, goods_id),
      activity_price_cents = COALESCE(excluded.activity_price_cents, activity_price_cents),
      daily_price_cents    = COALESCE(excluded.daily_price_cents, daily_price_cents),
      activity_stock       = COALESCE(excluded.activity_stock, activity_stock),
      sold_status          = COALESCE(excluded.sold_status, sold_status),
      session_end_time     = COALESCE(excluded.session_end_time, session_end_time),
      session_start_time   = COALESCE(excluded.session_start_time, session_start_time),
      sites_json           = COALESCE(excluded.sites_json, sites_json),
      source_event_id      = COALESCE(excluded.source_event_id, source_event_id),
      last_updated_at      = datetime('now')
  `);
  const stat_date = normalizeStatDate(firstDefined(result, ["statDate", "date", "dataDate"]), evt);
  const mall_id = eventMallId(ctx, evt);
  for (const rec of list) {
    if (!isRecord(rec)) continue;
    const base = {
      enroll_id: toNullableString(firstDefined(rec, ["enrollId", "enroll_id"]), 100),
      enroll_status: toNullableInteger(firstDefined(rec, ["enrollStatus"])),
      enroll_time: toNullableString(firstDefined(rec, ["enrollTime"])),
      activity_type: toNullableInteger(firstDefined(rec, ["activityType"])),
      activity_thematic_id: toNullableString(firstDefined(rec, ["activityThematicId", "activityId", "themeId"]), 100),
      activity_thematic_name: toNullableString(firstDefined(rec, ["activityThematicName", "activityName", "activityTypeName"]), 500),
      product_id: toNullableString(firstDefined(rec, ["productId", "productSpuId", "spuId"]), 100),
      goods_id: toNullableString(firstDefined(rec, ["goodsId", "goods_id"]), 100),
      activity_stock: toNullableInteger(firstDefined(rec, ["activityStock", "remainingActivityStock"])),
      sold_status: toNullableInteger(firstDefined(rec, ["soldStatus"])),
      session_end_time: toNullableString(firstDefined(rec, ["sessionEndTime", "endTime"])),
      session_start_time: toNullableString(firstDefined(rec, ["sessionStartTime", "startTime"])),
      sites_json: Array.isArray(rec.sites) && rec.sites.length ? JSON.stringify(rec.sites.map(s => ({ id: s.siteId, name: s.siteName }))) : null,
    };
    const skcList = Array.isArray(rec.skcList) ? rec.skcList : [];
    const rows = [];
    for (const skc of skcList) {
      if (!isRecord(skc)) continue;
      const skc_id = toNullableString(firstDefined(skc, ["skcId", "productSkcId"]), 100);
      const skcDaily = pickActivityPriceCents(skc, ["dailyPrice", "dailyPriceCents"]);
      const skcAct = pickActivityPriceCents(skc, ["activityPrice", "activityPriceCents"]);
      const skuList = Array.isArray(skc.skuList) ? skc.skuList : [];
      if (!skuList.length) {
        rows.push({ skc_id, sku_id: null, sku_ext_code: toNullableString(firstDefined(skc, ["extCode", "skuExtCode", "skcExtCode"]), 200), activity_price_cents: skcAct, daily_price_cents: skcDaily });
        continue;
      }
      for (const sku of skuList) {
        if (!isRecord(sku)) continue;
        rows.push({
          skc_id,
          sku_id: toNullableString(firstDefined(sku, ["skuId", "productSkuId"]), 100),
          sku_ext_code: toNullableString(firstDefined(sku, ["extCode", "skuExtCode", "skuCode"]), 200),
          activity_price_cents: pickActivityPriceCents(sku, ["activityPrice", "activityPriceCents"]) ?? skcAct,
          daily_price_cents: pickActivityPriceCents(sku, ["dailyPrice", "dailyPriceCents"]) ?? skcDaily,
        });
      }
    }
    if (!rows.length) rows.push({ skc_id: null, sku_id: null, sku_ext_code: null, activity_price_cents: null, daily_price_cents: null });
    for (const r of rows) {
      const row_key = [base.enroll_id || "", r.skc_id || "", r.sku_id || "", base.activity_thematic_id || ""].join("|").slice(0, 300);
      upsert.run({
        id: crypto.randomUUID(),
        tenant_id: ctx.tenant_id,
        mall_id,
        site: evt.site || null,
        stat_date,
        row_key,
        ...base,
        skc_id: r.skc_id,
        sku_id: r.sku_id,
        sku_ext_code: r.sku_ext_code,
        activity_price_cents: r.activity_price_cents,
        daily_price_cents: r.daily_price_cents,
        raw_json: null,
        source_event_id: evt.id,
      });
    }
  }
}

function parseActivitySnapshot(db, ctx, evt, body) {
  // 已报名记录分流:/enroll/list 不带筛选返回的 result.list 项带 enrollId(可报库没有)→落独立表,不混入可报快照
  const rawList = body?.result?.list || body?.data?.list;
  if (Array.isArray(rawList) && rawList.some((r) => r && r.enrollId != null)) {
    return parseEnrollRecord(db, ctx, evt, body);
  }
  const items = pickActivityItems(body, evt);
  if (!items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_activity_snapshot (
      id, tenant_id, mall_id, site, stat_date, row_key, activity_kind,
      activity_id, activity_title, activity_type, activity_status, product_id, skc_id, sku_id, sku_ext_code, sku_attr_text, goods_id,
      daily_price_cents, signup_price_cents, suggested_price_cents, price_currency, activity_stock,
      signup_price_diff_cents,
      start_at, end_at, metric_json, raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @stat_date, @row_key, @activity_kind,
      @activity_id, @activity_title, @activity_type, @activity_status, @product_id, @skc_id, @sku_id, @sku_ext_code, @sku_attr_text, @goods_id,
      @daily_price_cents, @signup_price_cents, @suggested_price_cents, @price_currency, @activity_stock,
      @signup_price_diff_cents,
      @start_at, @end_at, @metric_json, @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, row_key, stat_date) DO UPDATE SET
      site            = COALESCE(excluded.site, site),
      activity_kind   = COALESCE(excluded.activity_kind, activity_kind),
      activity_id     = COALESCE(excluded.activity_id, activity_id),
      activity_title  = COALESCE(excluded.activity_title, activity_title),
      activity_type   = COALESCE(excluded.activity_type, activity_type),
      activity_status = COALESCE(excluded.activity_status, activity_status),
      product_id      = COALESCE(excluded.product_id, product_id),
      skc_id          = COALESCE(excluded.skc_id, skc_id),
      sku_id          = COALESCE(excluded.sku_id, sku_id),
      sku_ext_code    = COALESCE(excluded.sku_ext_code, sku_ext_code),
      sku_attr_text   = COALESCE(excluded.sku_attr_text, sku_attr_text),
      goods_id        = COALESCE(excluded.goods_id, goods_id),
      daily_price_cents = COALESCE(excluded.daily_price_cents, daily_price_cents),
      signup_price_cents = COALESCE(excluded.signup_price_cents, signup_price_cents),
      suggested_price_cents = COALESCE(excluded.suggested_price_cents, suggested_price_cents),
      price_currency  = COALESCE(excluded.price_currency, price_currency),
      activity_stock  = COALESCE(excluded.activity_stock, activity_stock),
      signup_price_diff_cents = COALESCE(excluded.signup_price_diff_cents, signup_price_diff_cents),
      start_at        = COALESCE(excluded.start_at, start_at),
      end_at          = COALESCE(excluded.end_at, end_at),
      metric_json     = COALESCE(excluded.metric_json, metric_json),
      raw_json        = COALESCE(excluded.raw_json, raw_json),
      source_event_id = COALESCE(excluded.source_event_id, source_event_id),
      sources_json    = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at = datetime('now')
  `);
  const stat_date = normalizeStatDate(firstDefined(body?.result || body?.data || {}, ["statDate", "date", "dataDate", "updateTime"]), evt);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  const mall_id = eventMallId(ctx, evt);
  const activity_kind = activityKindFromPath(evt.url_path);
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const meta = isRecord(item.__activity_meta) ? item.__activity_meta : {};
    const activity_type = toNullableString(meta.activityType ?? firstDeepDefined(item, [
      "activityTypeName", "activityType", "activityCategory", "promotionType",
      "marketingType", "campaignType", "enrollType", "bizType", "typeName", "type",
    ], 2), 100);
    const signup_price_cents = pickActivityPriceCents(item, [
      "signupPriceCents", "signupPriceCent", "signupPrice",
      "enrollPriceCents", "enrollPriceCent", "enrollPrice",
      "applyPriceCents", "applyPriceCent", "applyPrice",
      "activityPriceCents", "activityPriceCent", "activityPrice",
      "campaignPriceCents", "campaignPriceCent", "campaignPrice",
      "promotionPriceCents", "promotionPriceCent", "promotionPrice",
      "salePriceCents", "salePriceCent", "salePrice",
      "supplierActivityPrice", "skuActivityPrice", "skcActivityPrice",
      "inputPrice", "declarePrice", "declaredPrice",
    ]);
    const daily_price_cents = pickActivityPriceCents(item, [
      "dailyDeclarePriceCents", "dailyDeclarePriceCent", "dailyDeclarePrice",
      "normalDeclarePriceCents", "normalDeclarePriceCent", "normalDeclarePrice",
      "dailyPriceCents", "dailyPriceCent", "dailyPrice",
      "normalPriceCents", "normalPriceCent", "normalPrice",
      "basePriceCents", "basePriceCent", "basePrice",
      "supplierPriceCents", "supplierPriceCent", "supplierPrice",
      "declaredPriceCents", "declaredPriceCent", "declaredPrice",
      "declarePriceCents", "declarePriceCent", "declarePrice",
      "skuSupplierPrice", "skuDeclaredPrice",
    ]);
    const suggested_price_cents = pickActivityPriceCents(item, [
      "suggestedPriceCents", "suggestedPriceCent", "suggestedPrice",
      "suggestPriceCents", "suggestPriceCent", "suggestPrice",
      "recommendPriceCents", "recommendPriceCent", "recommendPrice",
      "recommendedPriceCents", "recommendedPriceCent", "recommendedPrice",
      "referencePriceCents", "referencePriceCent", "referencePrice",
      "advicePriceCents", "advicePriceCent", "advicePrice",
      "activitySuggestPrice", "suggestActivityPrice", "maxEnrollPrice", "maxPrice",
    ]);
    const explicit_diff_cents = pickActivityPriceCents(item, [
      "signupPriceDiffCents", "signupPriceDiffCent", "signupPriceDiff",
      "priceDiffCents", "priceDiffCent", "priceDiff",
      "enrollPriceDiff", "applyPriceDiff", "declarePriceDiff",
    ]);
    const signup_price_diff_cents = explicit_diff_cents
      ?? (signup_price_cents != null && suggested_price_cents != null ? signup_price_cents - suggested_price_cents : null);
    const activity_stock = pickActivityInteger(item, [
      "activityStock", "enrollStock", "signupStock", "applyStock",
      "activityInventory", "promotionStock", "campaignStock", "saleStock",
      "stockNum", "stock", "inventoryNum", "inventory", "availableStock",
      "activityGoodsStock", "goodsStock", "quantity",
    ]);
    const remaining_activity_stock = pickActivityInteger(item, [
      "remainingActivityStock", "remainActivityStock", "remainingActivityStockNum",
      "activityRemainStock", "activityRemainingStock", "leftActivityStock", "surplusActivityStock",
      "availableActivityStock", "remainingQuantity", "remainQuantity", "leftQuantity", "surplusQuantity",
      "remainingStock", "remainStock", "leftStock", "surplusStock", "canEnrollStock",
    ]);
    const price_currency = toNullableString(firstDeepDefined(item, [
      "currency", "currencyCode", "currencyType", "siteCurrency", "priceCurrency",
    ], 3), 16);
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id,
      site: evt.site || null,
      stat_date,
      row_key: activityRowKey(item, evt, index),
      activity_kind,
      activity_id: toNullableString(firstDefined(item, [
        "activityThematicId", "activityId", "activityThemeId", "themeId", "topicId",
        "invitationTopicId", "couponId", "promotionId", "campaignId", "biddingInvitationOrderSn", "orderSn", "id",
      ]) ?? meta.activityId),
      activity_title: toNullableString(meta.activityTitle ?? firstDefined(item, [
        "activityThematicName", "activityName", "activityTitle", "themeName", "topicName", "couponName",
        "name", "title", "productName", "goodsName",
      ]), 500),
      activity_type,
      activity_status: toNullableString(firstDefined(item, [
        "status", "activityStatus", "enrollStatus", "auditStatus", "state", "stage", "orderStatus",
      ]), 100),
      product_id: toNullableString(firstDefined(item, ["productId", "productSpuId", "spuId", "spu_id", "goodsSpuId"]) ?? meta.productId),
      skc_id: toNullableString(firstDefined(item, ["productSkcId", "skcId", "skc_id"]) ?? meta.skcId),
      sku_id: toNullableString(firstDefined(item, ["productSkuId", "prodSkuId", "skuId", "sku_id"]), 100),
      sku_ext_code: toNullableString(firstDefined(item, ["skuExtCode", "skuCode", "extCode", "externalSkuCode"]), 200),
      sku_attr_text: toNullableString(activitySkuAttrText(item), 500),
      goods_id: toNullableString(firstDefined(item, ["goodsId", "goods_id"]) ?? meta.goodsId),
      daily_price_cents,
      signup_price_cents,
      suggested_price_cents,
      price_currency,
      activity_stock,
      signup_price_diff_cents,
      start_at: toNullableString(firstDefined(item, ["startTime", "beginTime", "sessionStartTime", "activityStartTime", "validStartTime"])),
      end_at: toNullableString(firstDefined(item, ["endTime", "finishTime", "sessionEndTime", "activityEndTime", "validEndTime"])),
      metric_json: toJsonText({
        activityType: activity_type,
        checkedNoActivity: item.__checkedNoActivity === true ? 1 : 0,
        skuId: firstDefined(item, ["productSkuId", "prodSkuId", "skuId", "sku_id"]),
        skuExtCode: firstDefined(item, ["skuExtCode", "skuCode", "extCode", "externalSkuCode"]),
        skuAttrText: activitySkuAttrText(item),
        dailyPriceCents: daily_price_cents,
        signupPriceCents: signup_price_cents,
        suggestedPriceCents: suggested_price_cents,
        priceCurrency: price_currency,
        activityStock: activity_stock,
        remainingActivityStock: remaining_activity_stock,
        signupPriceDiffCents: signup_price_diff_cents,
        payAmount: firstDefined(item, ["payAmount", "activityPayAmountTotal", "gmv"]),
        orderCount: firstDefined(item, ["orderCount", "activityGoodsOrderCount"]),
        goodsCount: firstDefined(item, ["goodsCount", "activityGoodsCount", "activityGoodsQuantity"]),
        cartCount: firstDefined(item, ["cartCount", "activityGoodsCartCount"]),
        productCount: firstDefined(item, ["productCount", "goodsNum"]),
        activitySales: firstDefined(item, ["activitySales", "goodsSales", "sales", "saleCount"]),
        activityTransactionAmount: firstDefined(item, ["activityTransactionAmount", "transactionAmount", "payAmount", "gmv"]),
        totalVisitorsNum: firstDefined(item, ["totalVisitorsNum", "activityGoodsVisitorsNum", "visitorsNum"]),
        clickVisitorsNum: firstDefined(item, ["clickVisitorsNum", "clickVisitorNum"]),
        payVisitorsNum: firstDefined(item, ["payVisitorsNum", "payVisitorNum"]),
        visitorsClickConversionRate: firstDefined(item, ["visitorsClickConversionRate", "clickConversionRate"]),
        visitorsPayConversionRate: firstDefined(item, ["visitorsPayConversionRate", "payConversionRate"]),
      }, 20000),
      // raw_json 不再落库：结构化字段已拆成正式列 + metric_json，控制台不消费 raw_json，
      // 而它每行 ~33KB、每天累积 ~1GB（曾撑到 5.7G 拖慢全表冷扫）。置 null 止血。
      raw_json: null,
      source_event_id: evt.id,
      sources_json,
    });
  });
}

// ---------- 合规属性(制造商/欧代/土代/进口商):compliance_property API ----------

function parseComplianceProperty(db, ctx, evt, body) {
  const templateList = body?.result?.template_list;
  if (Array.isArray(templateList) && templateList.length) {
    return parseComplianceQueryDetail(db, ctx, evt, body);
  }
  const items = pickList(body);
  if (!Array.isArray(items) || !items.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_compliance_property (
      id, tenant_id, mall_id, site, product_skc_id, product_name,
      manufacturer_name, manufacturer_address, manufacturer_email,
      ec_rep_name, ec_rep_address, ec_rep_email,
      tur_rep_name, tur_rep_address,
      importer_name, importer_address,
      raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @product_skc_id, @product_name,
      @manufacturer_name, @manufacturer_address, @manufacturer_email,
      @ec_rep_name, @ec_rep_address, @ec_rep_email,
      @tur_rep_name, @tur_rep_address,
      @importer_name, @importer_address,
      @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, product_skc_id) DO UPDATE SET
      site                 = COALESCE(excluded.site, site),
      product_name         = COALESCE(excluded.product_name, product_name),
      manufacturer_name    = COALESCE(excluded.manufacturer_name, manufacturer_name),
      manufacturer_address = COALESCE(excluded.manufacturer_address, manufacturer_address),
      manufacturer_email   = COALESCE(excluded.manufacturer_email, manufacturer_email),
      ec_rep_name          = COALESCE(excluded.ec_rep_name, ec_rep_name),
      ec_rep_address       = COALESCE(excluded.ec_rep_address, ec_rep_address),
      ec_rep_email         = COALESCE(excluded.ec_rep_email, ec_rep_email),
      tur_rep_name         = COALESCE(excluded.tur_rep_name, tur_rep_name),
      tur_rep_address      = COALESCE(excluded.tur_rep_address, tur_rep_address),
      importer_name        = COALESCE(excluded.importer_name, importer_name),
      importer_address     = COALESCE(excluded.importer_address, importer_address),
      raw_json             = excluded.raw_json,
      source_event_id      = excluded.source_event_id,
      sources_json         = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at      = datetime('now')
  `);
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const item of items) {
    const skc = toNullableString(firstDefined(item, ["productSkcId", "skcId", "skc_id", "productSKCId", "spu_id", "spuId", "goods_id", "goodsId"]));
    if (!skc) continue;
    const props = extractComplianceProps(item);
    upsert.run({
      id: crypto.randomUUID(),
      tenant_id: ctx.tenant_id,
      mall_id: ctx.mall_id || "",
      site: ctx.site || null,
      product_skc_id: skc,
      product_name: toNullableString(firstDefined(item, ["productName", "goodsName", "skcName", "product_name"])),
      manufacturer_name: props.manufacturer_name,
      manufacturer_address: props.manufacturer_address,
      manufacturer_email: props.manufacturer_email,
      ec_rep_name: props.ec_rep_name,
      ec_rep_address: props.ec_rep_address,
      ec_rep_email: props.ec_rep_email,
      tur_rep_name: props.tur_rep_name,
      tur_rep_address: props.tur_rep_address,
      importer_name: props.importer_name,
      importer_address: props.importer_address,
      raw_json: JSON.stringify(item).slice(0, 20000),
      source_event_id: evt.id,
      sources_json,
    });
  }
}

function extractComplianceProps(item) {
  const out = {
    manufacturer_name: null, manufacturer_address: null, manufacturer_email: null,
    ec_rep_name: null, ec_rep_address: null, ec_rep_email: null,
    tur_rep_name: null, tur_rep_address: null,
    importer_name: null, importer_address: null,
  };
  const propsList = item.compliancePropertyList || item.propertyList || item.properties || item.complianceProperties || [];
  if (Array.isArray(propsList) && propsList.length) {
    for (const p of propsList) {
      const name = String(p.propertyName || p.name || p.type || p.key || "").toUpperCase();
      const val = p.propertyValue || p.value || p.content || "";
      const addr = p.propertyValueAddress || p.address || p.addressValue || "";
      const email = p.propertyValueEmail || p.email || p.emailValue || "";
      if (/MANUFACTURER|制造商/.test(name)) {
        out.manufacturer_name = val || null;
        out.manufacturer_address = addr || null;
        out.manufacturer_email = email || null;
      } else if (/EC.?REP|欧代/.test(name)) {
        out.ec_rep_name = val || null;
        out.ec_rep_address = addr || null;
        out.ec_rep_email = email || null;
      } else if (/TUR.?REP|土.{0,2}代/.test(name)) {
        out.tur_rep_name = val || null;
        out.tur_rep_address = addr || null;
      } else if (/IMPORTER|进口商/.test(name)) {
        out.importer_name = val || null;
        out.importer_address = addr || null;
      }
    }
  }
  if (!out.manufacturer_name) {
    out.manufacturer_name = toNullableString(firstDefined(item, ["manufacturerName", "manufacturer", "mfrName"]));
    out.manufacturer_address = toNullableString(firstDefined(item, ["manufacturerAddress", "mfrAddress"]));
    out.manufacturer_email = toNullableString(firstDefined(item, ["manufacturerEmail", "mfrEmail"]));
  }
  if (!out.ec_rep_name) {
    out.ec_rep_name = toNullableString(firstDefined(item, ["ecRepName", "ecRep", "authorizedRepresentativeName"]));
    out.ec_rep_address = toNullableString(firstDefined(item, ["ecRepAddress", "authorizedRepresentativeAddress"]));
    out.ec_rep_email = toNullableString(firstDefined(item, ["ecRepEmail", "authorizedRepresentativeEmail"]));
  }
  if (!out.tur_rep_name) {
    out.tur_rep_name = toNullableString(firstDefined(item, ["turRepName", "turkeyRepName"]));
    out.tur_rep_address = toNullableString(firstDefined(item, ["turRepAddress", "turkeyRepAddress"]));
  }
  if (!out.importer_name) {
    out.importer_name = toNullableString(firstDefined(item, ["importerName", "importer"]));
    out.importer_address = toNullableString(firstDefined(item, ["importerAddress"]));
  }
  return out;
}

function parseComplianceQueryDetail(db, ctx, evt, body) {
  const templates = body.result.template_list;
  const r = body.result || {};
  const skc = String(r.spu_id || r.goods_id || "").trim();
  if (!skc) return;
  const props = {
    manufacturer_name: null, manufacturer_address: null, manufacturer_email: null,
    ec_rep_name: null, ec_rep_address: null, ec_rep_email: null,
    tur_rep_name: null, tur_rep_address: null,
    importer_name: null, importer_address: null,
  };
  for (const tmpl of templates) {
    const reps = Array.isArray(tmpl.rep_detail_list) ? tmpl.rep_detail_list : [];
    if (!reps.length) continue;
    const first = reps[0] || {};
    const name = (first.rep_name || "").trim();
    if (!name) continue;
    const addrInfo = first.rep_address_info || {};
    const addr = [addrInfo.address_line_one, addrInfo.city, addrInfo.state_name, addrInfo.region_name, addrInfo.post_code].filter(Boolean).join(", ");
    const email = first.rep_mail || null;
    const taskType = Number(tmpl.task_type);
    if (taskType === 25) {
      props.ec_rep_name = name;
      if (addr) props.ec_rep_address = addr;
      if (email) props.ec_rep_email = email;
    } else if (taskType === 60) {
      props.manufacturer_name = name;
      if (addr) props.manufacturer_address = addr;
      if (email) props.manufacturer_email = email;
    } else if (taskType === 84) {
      props.tur_rep_name = name;
      if (addr) props.tur_rep_address = addr;
    }
  }
  if (!props.ec_rep_name && !props.manufacturer_name && !props.tur_rep_name) return;
  const upsert = db.prepare(`
    INSERT INTO temu_compliance_property (
      id, tenant_id, mall_id, site, product_skc_id, product_name,
      manufacturer_name, manufacturer_address, manufacturer_email,
      ec_rep_name, ec_rep_address, ec_rep_email,
      tur_rep_name, tur_rep_address,
      importer_name, importer_address,
      raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @site, @product_skc_id, @product_name,
      @manufacturer_name, @manufacturer_address, @manufacturer_email,
      @ec_rep_name, @ec_rep_address, @ec_rep_email,
      @tur_rep_name, @tur_rep_address,
      @importer_name, @importer_address,
      @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, product_skc_id) DO UPDATE SET
      site                 = COALESCE(excluded.site, site),
      manufacturer_name    = COALESCE(excluded.manufacturer_name, manufacturer_name),
      manufacturer_address = COALESCE(excluded.manufacturer_address, manufacturer_address),
      manufacturer_email   = COALESCE(excluded.manufacturer_email, manufacturer_email),
      ec_rep_name          = COALESCE(excluded.ec_rep_name, ec_rep_name),
      ec_rep_address       = COALESCE(excluded.ec_rep_address, ec_rep_address),
      ec_rep_email         = COALESCE(excluded.ec_rep_email, ec_rep_email),
      tur_rep_name         = COALESCE(excluded.tur_rep_name, tur_rep_name),
      tur_rep_address      = COALESCE(excluded.tur_rep_address, tur_rep_address),
      importer_name        = COALESCE(excluded.importer_name, importer_name),
      importer_address     = COALESCE(excluded.importer_address, importer_address),
      raw_json             = excluded.raw_json,
      source_event_id      = excluded.source_event_id,
      sources_json         = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at      = datetime('now')
  `);
  upsert.run({
    id: crypto.randomUUID(),
    tenant_id: ctx.tenant_id,
    mall_id: ctx.mall_id || "",
    site: ctx.site || null,
    product_skc_id: skc,
    product_name: null,
    ...props,
    raw_json: JSON.stringify(body.result).slice(0, 20000),
    source_event_id: evt.id,
    sources_json: JSON.stringify({ [evt.url_path]: evt.id }),
  });
}

// ---------- SKU 站点绑定异常（queryFullyOtherMessage） ----------

function parseTemuSkuSiteException(db, ctx, evt, body) {
  const result = body?.result;
  if (!result || typeof result !== "object") return;
  const list = result.goodsSkuBindSiteFailInfoVOList;
  if (!Array.isArray(list) || !list.length) return;
  const upsert = db.prepare(`
    INSERT INTO temu_sku_site_exception_snapshot (
      id, tenant_id, mall_id, sku_id, goods_id, skc_id, site_name,
      check_code, exception_reason, exception_time, sku_spec,
      raw_json, source_event_id, sources_json
    ) VALUES (
      @id, @tenant_id, @mall_id, @sku_id, @goods_id, @skc_id, @site_name,
      @check_code, @exception_reason, @exception_time, @sku_spec,
      @raw_json, @source_event_id, @sources_json
    )
    ON CONFLICT(tenant_id, mall_id, sku_id, site_name) DO UPDATE SET
      goods_id         = COALESCE(excluded.goods_id, goods_id),
      skc_id           = COALESCE(excluded.skc_id, skc_id),
      check_code       = COALESCE(excluded.check_code, check_code),
      exception_reason = COALESCE(excluded.exception_reason, exception_reason),
      exception_time   = COALESCE(excluded.exception_time, exception_time),
      sku_spec         = COALESCE(excluded.sku_spec, sku_spec),
      raw_json         = COALESCE(excluded.raw_json, raw_json),
      source_event_id  = COALESCE(excluded.source_event_id, source_event_id),
      sources_json     = json_patch(COALESCE(sources_json, '{}'), COALESCE(excluded.sources_json, '{}')),
      last_updated_at  = datetime('now')
  `);
  const mall_id = eventMallId(ctx, evt);
  const tenant_id = ctx?.tenant_id || "";
  const sources_json = JSON.stringify({ [evt.url_path]: evt.id });
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const skuId = toNullableString(item.skuId || item.sku_id);
    const siteName = toNullableString(item.siteName || item.site_name);
    if (!skuId || !siteName) continue;
    const checkList = Array.isArray(item.checkInfoList) ? item.checkInfoList : [];
    const firstCheck = checkList[0] || {};
    const checkCode = toNullableString(firstCheck.checkCode);
    const exceptionReason = toNullableString(firstCheck.checkDesc || item.checkDesc);
    let exceptionTime = null;
    const ts = item.createTime || item.gmtCreate || item.timestamp;
    if (ts) {
      try { exceptionTime = new Date(typeof ts === "string" ? ts : Number(ts)).toISOString(); } catch { /* */ }
    }
    const id = crypto.randomUUID();
    upsert.run({
      id, tenant_id, mall_id,
      sku_id: skuId,
      goods_id: toNullableString(item.goodsId || item.goods_id),
      skc_id: toNullableString(item.skcId || item.skc_id || item.productSkcId),
      site_name: siteName,
      check_code: checkCode,
      exception_reason: exceptionReason,
      exception_time: exceptionTime,
      sku_spec: toNullableString(item.skuSpecString || item.specString || item.spec),
      raw_json: JSON.stringify(item),
      source_event_id: evt.id || null,
      sources_json,
    });
  }
}

const PARSERS = [
  { match: /\/auth\/userInfo|\/mms\/userInfo|\/mms\/account\/menu/, fn: parseUserInfo, name: "userInfo" },
  { match: /\/product\/skc\/pageQuery|\/product\/draft\/pageQuery|\/product\/notAllEu\/pageQuery/, fn: parseSkcList, name: "skcList" },
  { match: /\/retrieval\/board\/pageQuery/, fn: parseComplianceBoard, name: "complianceBoard" },
  { match: /compliance_property\/(page_query|query_detail|query_template)/, fn: parseComplianceProperty, name: "complianceProperty" },
  { match: /\/mms\/venom\/api\/supplier\/sales\/management\/(listOverall|listWarehouse|querySkuSalesNumber|queryFulfilmentFormStatistic)/, fn: parseSalesManagement, name: "salesManagement" },
  { match: /\/api\/seller\/full\/flow\/analysis\/goods\/list/, fn: parseProductFlowGoods, name: "productFlowGoods" },
  { match: /\/api\/seller\/full\/flow\/analysis\/goods\/(detail|trend)/, fn: parseProductFlowTrend, name: "productFlowTrend" },
  { match: /\/api\/activity\/data\/|\/gamblers\/|\/gambit\/|\/colossus\/bsr\/|\/biddingInvitationSupplierRpcService|\/sale\/manage\/supplier\/api\/activity\//, fn: parseActivitySnapshot, name: "activitySnapshot" },
  { match: /\/bg\/swift\/api\/common\/statistics\/web\/queryStatisticDataFullManaged|\/visage-agent-seller\/product\/statisticsData/, fn: parseShopStatistics, name: "shopStatistics" },
  { match: /\/magneto\/price-adjust\/page-query/, fn: parsePriceAdjust, name: "priceAdjust" },
  { match: /\/product\/sku\/site\/suggestedPrice\/pageQuery/, fn: parseSuggestedPrice, name: "suggestedPrice" },
  { match: /deliverGoods\/platform\/pageQuerySubPurchaseOrder|deliverGoods\/management\/pageQueryDeliveryOrders|deliverGoods\/management\/pageQueryDeliveryBatch|\/purchase\/manager\/querySubOrderList/, fn: parseTemuStockOrders, name: "temuStockOrders" },
  { match: /querySuggestCloseJitSkc|suggestCloseJitSkc/i, fn: parseTemuJitStatus, name: "temuJitStatus" },
  { match: /\/bg-luna-agent-seller\/review\/pageQuery/i, fn: parseTemuReview, name: "temuReview" },
  { match: /\/mms\/api\/appalachian\/afs\/queryPageV3|\/dunland\/api\/gmp\/returnSupplier\//, fn: parseTemuAfterSales, name: "temuAfterSales" },
  { match: /\/tmod_punish\/|pageQueryDeliveryBatch|queryAllFeedbackRecordInfo|searchQcSubBill|queryWeekInboundExceptionDetailInfo|returnSupplier|high\/price\/flow\/reduce|queryCompetitor|querySiteTargetPrice|batchQueryCustomerQueryLimit|bg-brando-mms\/supplier\/data\/center\/skc\/sales\/data|purchase\/manager\/querySubOrderList/, fn: parseOperationRisk, name: "operationRisk" },
  { match: /queryMallActivityOverView|queryMallActivityTypeList/, fn: parseMallActivityOverview, name: "mallActivityOverview" },
  { match: /mallFlow\/|mallTradeFlowRT|mallVisitPay|mallPayList|mallAttentionPercent|mallVisitPayPercent|mallVisitPayAttentionList|getMallVisitPayPercent|queryMallFlowOverViewReadyTime/, fn: parseMallTraffic, name: "mallTraffic" },
  { match: /mallDsr\/|queryDsrResult|mallScore\/queryMallConfigurationList/, fn: parseMallDsr, name: "mallDsr" },
  { match: /goodsDataShow\/(overviewList|detailList|moduleShow)|goodsDateOverview|queryGoodsPageOverView|queryGoodsPageOverViewReadyDate/, fn: parseGoodsDataShow, name: "goodsDataShow" },
  { match: /coupon\/couponDailyList/, fn: parseCouponDaily, name: "couponDaily" },
  { match: /dailyMallGoods\/consultVisit/, fn: parseDailyMallGoods, name: "dailyMallGoods" },
  { match: /goodsInfo\/guvPv|goodsInfo\/noGoods/, fn: parseGoodsInfoGuvPv, name: "goodsInfoGuvPv" },
  { match: /\/api\/kiana\/mms\/robin\/queryFullyOtherMessage/, fn: parseTemuSkuSiteException, name: "temuSkuSiteException" },
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
