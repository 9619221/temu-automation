-- 商品数据看板快照（对接 Temu goodsDataShow 系列 API）
CREATE TABLE IF NOT EXISTS temu_goods_data_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  stat_date TEXT NOT NULL,
  product_id TEXT,
  goods_id TEXT,
  skc_id TEXT,
  title TEXT,
  thumb_url TEXT,
  category_name TEXT,
  expose_num INTEGER,
  click_num INTEGER,
  detail_visit_num INTEGER,
  detail_visitor_num INTEGER,
  add_cart_num INTEGER,
  collect_num INTEGER,
  order_num INTEGER,
  pay_amount_cents INTEGER,
  guv INTEGER,
  pv INTEGER,
  module_name TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, product_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_goods_data_tenant_date
  ON temu_goods_data_snapshot(tenant_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_goods_data_product
  ON temu_goods_data_snapshot(tenant_id, product_id);
