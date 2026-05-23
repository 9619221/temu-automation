CREATE TABLE IF NOT EXISTS temu_sku_sales_trend (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT,
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
  UNIQUE (tenant_id, product_sku_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_sku_sales_trend_tenant_date
  ON temu_sku_sales_trend(tenant_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_sku_sales_trend_sku_date
  ON temu_sku_sales_trend(tenant_id, product_sku_id, stat_date);
