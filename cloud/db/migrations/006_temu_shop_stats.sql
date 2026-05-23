CREATE TABLE IF NOT EXISTS temu_shop_stats (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  stat_date TEXT NOT NULL,
  sale_volume INTEGER,
  seven_days_sale_volume INTEGER,
  thirty_days_sale_volume INTEGER,
  on_sale_product_number INTEGER,
  wait_product_number INTEGER,
  lack_skc_number INTEGER,
  advice_prepare_skc_number INTEGER,
  about_to_sell_out_number INTEGER,
  already_sold_out_number INTEGER,
  high_price_limit_number INTEGER,
  quality_after_sale_ratio_90d REAL,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, site, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_shop_stats_tenant_date
  ON temu_shop_stats(tenant_id, stat_date);
