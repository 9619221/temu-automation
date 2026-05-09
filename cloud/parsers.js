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
    body?.data?.pageItems ||
    body?.data?.list ||
    body?.data?.items ||
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
