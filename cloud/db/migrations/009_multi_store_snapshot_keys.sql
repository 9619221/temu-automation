PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_skc_tenant_mall;
DROP INDEX IF EXISTS idx_skc_tenant_updated;
DROP INDEX IF EXISTS idx_skc_product;

ALTER TABLE skc_snapshots RENAME TO skc_snapshots_old;

CREATE TABLE skc_snapshots (
  tenant_id TEXT NOT NULL,
  skc_id TEXT NOT NULL,
  product_id TEXT,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  title TEXT,
  category_id TEXT,
  category_name TEXT,
  status TEXT,
  thumb_url TEXT,
  spec_summary TEXT,
  declared_price_cents INTEGER,
  suggested_price_cents INTEGER,
  price_currency TEXT,
  sales_total INTEGER,
  stock_available INTEGER,
  compliance_status TEXT,
  sources_json TEXT,
  first_seen_at INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, mall_id, skc_id)
);

INSERT OR REPLACE INTO skc_snapshots (
  tenant_id, skc_id, product_id, mall_id, site, title, category_id, category_name,
  status, thumb_url, spec_summary, declared_price_cents, suggested_price_cents,
  price_currency, sales_total, stock_available, compliance_status, sources_json,
  first_seen_at, last_updated_at
)
SELECT
  tenant_id, skc_id, product_id, COALESCE(mall_id, ''), site, title, category_id,
  category_name, status, thumb_url, spec_summary, declared_price_cents,
  suggested_price_cents, price_currency, sales_total, stock_available,
  compliance_status, sources_json, first_seen_at, last_updated_at
FROM skc_snapshots_old;

DROP TABLE skc_snapshots_old;

CREATE INDEX idx_skc_tenant_mall ON skc_snapshots(tenant_id, mall_id);
CREATE INDEX idx_skc_tenant_updated ON skc_snapshots(tenant_id, last_updated_at DESC);
CREATE INDEX idx_skc_product ON skc_snapshots(tenant_id, mall_id, product_id);

DROP INDEX IF EXISTS idx_temu_sales_tenant_date;

ALTER TABLE temu_sales_snapshot RENAME TO temu_sales_snapshot_old;

CREATE TABLE temu_sales_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  skc_id TEXT NOT NULL,
  product_id TEXT,
  goods_id TEXT NOT NULL DEFAULT '',
  mall_supplier_id TEXT NOT NULL DEFAULT '',
  title TEXT,
  category_name TEXT,
  thumb_url TEXT,
  sku_ext_code TEXT,
  today_sales INTEGER,
  last7d_sales INTEGER,
  last30d_sales INTEGER,
  total_sales INTEGER,
  warehouse_stock INTEGER,
  occupy_stock INTEGER,
  unavailable_stock INTEGER,
  advice_qty INTEGER,
  available_sale_days REAL,
  declared_price_cents INTEGER,
  price_currency TEXT,
  asf_score TEXT,
  comment_num INTEGER,
  quality_after_sales_rate TEXT,
  supply_status TEXT,
  stock_status TEXT,
  close_jit_status TEXT,
  stat_date TEXT NOT NULL,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_supplier_id, skc_id, stat_date)
);

INSERT OR REPLACE INTO temu_sales_snapshot (
  id, tenant_id, skc_id, product_id, goods_id, mall_supplier_id, title,
  category_name, thumb_url, sku_ext_code, today_sales, last7d_sales,
  last30d_sales, total_sales, warehouse_stock, occupy_stock, unavailable_stock,
  advice_qty, available_sale_days, declared_price_cents, price_currency,
  asf_score, comment_num, quality_after_sales_rate, supply_status, stock_status,
  close_jit_status, stat_date, sources_json, first_seen_at, last_updated_at
)
SELECT
  id, tenant_id, skc_id, product_id, COALESCE(goods_id, ''), COALESCE(mall_supplier_id, ''),
  title, category_name, thumb_url, sku_ext_code, today_sales, last7d_sales,
  last30d_sales, total_sales, warehouse_stock, occupy_stock, unavailable_stock,
  advice_qty, available_sale_days, declared_price_cents, price_currency,
  asf_score, comment_num, quality_after_sales_rate, supply_status, stock_status,
  close_jit_status, stat_date, sources_json, first_seen_at, last_updated_at
FROM temu_sales_snapshot_old;

DROP TABLE temu_sales_snapshot_old;

CREATE INDEX idx_temu_sales_tenant_date ON temu_sales_snapshot(tenant_id, stat_date);
CREATE INDEX idx_temu_sales_tenant_mall_date ON temu_sales_snapshot(tenant_id, mall_supplier_id, stat_date);

DROP INDEX IF EXISTS idx_temu_sku_sales_trend_tenant_date;
DROP INDEX IF EXISTS idx_temu_sku_sales_trend_sku_date;

ALTER TABLE temu_sku_sales_trend RENAME TO temu_sku_sales_trend_old;

CREATE TABLE temu_sku_sales_trend (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  product_sku_id TEXT NOT NULL,
  stat_date TEXT NOT NULL,
  sales_number INTEGER,
  is_predict INTEGER,
  sold_out INTEGER,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, product_sku_id, stat_date)
);

INSERT OR REPLACE INTO temu_sku_sales_trend (
  id, tenant_id, mall_id, site, product_sku_id, stat_date, sales_number,
  is_predict, sold_out, source_event_id, sources_json, first_seen_at, last_updated_at
)
SELECT
  id, tenant_id, COALESCE(mall_id, ''), site, product_sku_id, stat_date,
  sales_number, is_predict, sold_out, source_event_id, sources_json,
  first_seen_at, last_updated_at
FROM temu_sku_sales_trend_old;

DROP TABLE temu_sku_sales_trend_old;

CREATE INDEX idx_temu_sku_sales_trend_tenant_date
  ON temu_sku_sales_trend(tenant_id, mall_id, stat_date);

CREATE INDEX idx_temu_sku_sales_trend_sku_date
  ON temu_sku_sales_trend(tenant_id, mall_id, product_sku_id, stat_date);

DROP INDEX IF EXISTS idx_temu_product_flow_tenant_date;
DROP INDEX IF EXISTS idx_temu_product_flow_product;

ALTER TABLE temu_product_flow_snapshot RENAME TO temu_product_flow_snapshot_old;

CREATE TABLE temu_product_flow_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  stat_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  goods_id TEXT NOT NULL DEFAULT '',
  title TEXT,
  category_name TEXT,
  thumb_url TEXT,
  expose_num INTEGER,
  click_num INTEGER,
  detail_visit_num INTEGER,
  detail_visitor_num INTEGER,
  add_to_cart_user_num INTEGER,
  collect_user_num INTEGER,
  pay_goods_num INTEGER,
  pay_order_num INTEGER,
  buyer_num INTEGER,
  expose_pay_conversion_rate REAL,
  expose_click_conversion_rate REAL,
  click_pay_conversion_rate REAL,
  search_expose_num INTEGER,
  search_click_num INTEGER,
  search_pay_goods_num INTEGER,
  search_pay_order_num INTEGER,
  recommend_expose_num INTEGER,
  recommend_click_num INTEGER,
  recommend_pay_goods_num INTEGER,
  recommend_pay_order_num INTEGER,
  flow_grow_status TEXT,
  grow_data_text TEXT,
  bsr_goods INTEGER,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, product_id, goods_id, stat_date, site)
);

INSERT OR REPLACE INTO temu_product_flow_snapshot (
  id, tenant_id, mall_id, site, stat_date, product_id, goods_id, title,
  category_name, thumb_url, expose_num, click_num, detail_visit_num,
  detail_visitor_num, add_to_cart_user_num, collect_user_num, pay_goods_num,
  pay_order_num, buyer_num, expose_pay_conversion_rate, expose_click_conversion_rate,
  click_pay_conversion_rate, search_expose_num, search_click_num, search_pay_goods_num,
  search_pay_order_num, recommend_expose_num, recommend_click_num, recommend_pay_goods_num,
  recommend_pay_order_num, flow_grow_status, grow_data_text, bsr_goods,
  source_event_id, sources_json, first_seen_at, last_updated_at
)
SELECT
  id, tenant_id, COALESCE(mall_id, ''), site, stat_date, product_id, COALESCE(goods_id, ''),
  title, category_name, thumb_url, expose_num, click_num, detail_visit_num,
  detail_visitor_num, add_to_cart_user_num, collect_user_num, pay_goods_num,
  pay_order_num, buyer_num, expose_pay_conversion_rate, expose_click_conversion_rate,
  click_pay_conversion_rate, search_expose_num, search_click_num, search_pay_goods_num,
  search_pay_order_num, recommend_expose_num, recommend_click_num,
  recommend_pay_goods_num, recommend_pay_order_num, flow_grow_status, grow_data_text,
  bsr_goods, source_event_id, sources_json, first_seen_at, last_updated_at
FROM temu_product_flow_snapshot_old;

DROP TABLE temu_product_flow_snapshot_old;

CREATE INDEX idx_temu_product_flow_tenant_date
  ON temu_product_flow_snapshot(tenant_id, mall_id, stat_date);

CREATE INDEX idx_temu_product_flow_product
  ON temu_product_flow_snapshot(tenant_id, mall_id, product_id, goods_id);

PRAGMA foreign_keys = ON;
