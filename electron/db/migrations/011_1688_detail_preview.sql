ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_detail_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_sku_options_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_price_ranges_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_detail_fetched_at TEXT;

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_preview_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_previewed_at TEXT;

CREATE TABLE IF NOT EXISTS erp_1688_delivery_addresses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  full_name TEXT NOT NULL,
  mobile TEXT,
  phone TEXT,
  post_code TEXT,
  province_text TEXT,
  city_text TEXT,
  area_text TEXT,
  town_text TEXT,
  address TEXT NOT NULL,
  address_id TEXT,
  raw_address_param_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_1688_delivery_addresses_default
  ON erp_1688_delivery_addresses(status, is_default);
