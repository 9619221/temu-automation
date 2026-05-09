// Parser 调度器：按 url_path 把 capture_events 路由给具体 parser
// 设计原则：
// 1) parser 失败不影响主 ingest 流程（已捕获 try/catch）
// 2) parser 只读 body_json + 写各自聚合表，不动 capture_events
// 3) 顺序：先跑 userInfo（解出 mall_id 写 device_mall_links），再跑业务 parser

import { parseUserInfo } from "./userInfo.js";
import { parseSkcList } from "./skc.js";
import { parsePriceAdjust, parseSuggestedPrice } from "./price.js";

const PARSERS = [
  { match: /\/auth\/userInfo|\/mms\/userInfo|\/mms\/account\/menu/, fn: parseUserInfo, name: "userInfo" },
  { match: /\/product\/skc\/pageQuery|\/product\/draft\/pageQuery|\/product\/notAllEu\/pageQuery/, fn: parseSkcList, name: "skcList" },
  { match: /\/magneto\/price-adjust\/page-query/, fn: parsePriceAdjust, name: "priceAdjust" },
  { match: /\/product\/sku\/site\/suggestedPrice\/pageQuery/, fn: parseSuggestedPrice, name: "suggestedPrice" },
];

export function dispatchParsers(db, ctx, items) {
  // ctx: { tenant_id, device_id }
  // items: [{ id, url_path, body_json, ts, mall_id, site }]
  for (const it of items) {
    if (!it.body_json) continue;
    let body;
    try {
      body = JSON.parse(it.body_json);
    } catch {
      continue;
    }
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

// 工具：SKC upsert 时只覆盖非 null 字段，sources_json 走 json_patch 合并
export function buildSkcUpsert(db) {
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
