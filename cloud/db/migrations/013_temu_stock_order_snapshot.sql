CREATE TABLE IF NOT EXISTS temu_stock_order_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  row_key TEXT NOT NULL,
  stock_order_no TEXT,
  parent_order_no TEXT,
  delivery_order_sn TEXT,
  delivery_batch_sn TEXT,
  product_id TEXT,
  skc_id TEXT,
  sku_id TEXT,
  sku_ext_code TEXT,
  product_name TEXT,
  spec_name TEXT,
  demand_qty INTEGER,
  delivered_qty INTEGER,
  temu_status TEXT,
  warehouse_group TEXT,
  receive_warehouse_id TEXT,
  receive_warehouse_name TEXT,
  urgency_info TEXT,
  order_time TEXT,
  latest_ship_at TEXT,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, row_key)
);

CREATE INDEX IF NOT EXISTS idx_temu_stock_order_tenant_mall_updated
  ON temu_stock_order_snapshot(tenant_id, mall_id, last_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_temu_stock_order_skc
  ON temu_stock_order_snapshot(tenant_id, mall_id, skc_id, sku_id);

CREATE INDEX IF NOT EXISTS idx_temu_stock_order_status
  ON temu_stock_order_snapshot(tenant_id, mall_id, temu_status);
