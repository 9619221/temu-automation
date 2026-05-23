CREATE TABLE IF NOT EXISTS temu_after_sale_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  row_key TEXT NOT NULL,
  after_sale_type TEXT,
  package_no TEXT,
  order_id TEXT,
  product_id TEXT,
  skc_id TEXT,
  sku_id TEXT,
  product_name TEXT,
  quantity INTEGER,
  status TEXT,
  reason TEXT,
  logistics_no TEXT,
  warehouse_name TEXT,
  amount_cents INTEGER,
  currency TEXT,
  created_at_text TEXT,
  updated_at_text TEXT,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, row_key)
);

CREATE INDEX IF NOT EXISTS idx_temu_after_sale_tenant_mall_updated
  ON temu_after_sale_snapshot(tenant_id, mall_id, last_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_temu_after_sale_skc
  ON temu_after_sale_snapshot(tenant_id, mall_id, skc_id, sku_id);

CREATE INDEX IF NOT EXISTS idx_temu_after_sale_status
  ON temu_after_sale_snapshot(tenant_id, mall_id, status);
