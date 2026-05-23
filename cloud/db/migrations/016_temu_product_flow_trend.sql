CREATE TABLE IF NOT EXISTS temu_product_flow_trend (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  goods_id TEXT NOT NULL DEFAULT '',
  stat_date TEXT NOT NULL,
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
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, product_id, goods_id, stat_date, site)
);

CREATE INDEX IF NOT EXISTS idx_temu_product_flow_trend_tenant_date
  ON temu_product_flow_trend(tenant_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_product_flow_trend_product
  ON temu_product_flow_trend(tenant_id, mall_id, product_id, goods_id);
