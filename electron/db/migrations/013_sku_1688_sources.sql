CREATE TABLE IF NOT EXISTS erp_sku_1688_sources (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  external_offer_id TEXT NOT NULL,
  external_sku_id TEXT NOT NULL DEFAULT '',
  external_spec_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT,
  product_title TEXT,
  product_url TEXT,
  image_url TEXT,
  unit_price REAL,
  moq INTEGER,
  lead_days INTEGER,
  logistics_fee REAL,
  status TEXT NOT NULL DEFAULT 'active',
  is_default INTEGER NOT NULL DEFAULT 0,
  source_payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, sku_id, external_offer_id, external_sku_id, external_spec_id),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id),
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_sku_1688_sources_sku_default
  ON erp_sku_1688_sources(account_id, sku_id, status, is_default, updated_at);

CREATE INDEX IF NOT EXISTS idx_sku_1688_sources_offer
  ON erp_sku_1688_sources(external_offer_id, external_sku_id, external_spec_id);
