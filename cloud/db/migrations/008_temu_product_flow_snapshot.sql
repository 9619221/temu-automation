CREATE TABLE IF NOT EXISTS temu_product_flow_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT,
  site TEXT,
  stat_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  goods_id TEXT,
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
  UNIQUE (tenant_id, product_id, goods_id, stat_date, site)
);

CREATE INDEX IF NOT EXISTS idx_temu_product_flow_tenant_date
  ON temu_product_flow_snapshot(tenant_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_product_flow_product
  ON temu_product_flow_snapshot(tenant_id, product_id, goods_id);
