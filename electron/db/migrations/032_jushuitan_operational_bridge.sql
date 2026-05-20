CREATE TABLE IF NOT EXISTS erp_jst_business_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  source_key TEXT NOT NULL,
  record_type TEXT NOT NULL DEFAULT 'header',
  external_id TEXT NOT NULL,
  business_no TEXT,
  business_time TEXT,
  status TEXT,
  related_no TEXT,
  party_name TEXT,
  shop_name TEXT,
  account_id TEXT,
  supplier_id TEXT,
  sku_id TEXT,
  sku_code TEXT,
  product_name TEXT,
  qty REAL,
  amount REAL,
  warehouse_id TEXT,
  warehouse_name TEXT,
  logistics_company TEXT,
  tracking_no TEXT,
  raw_record_id TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, source_key, external_id, record_type)
);

CREATE TABLE IF NOT EXISTS erp_jst_business_sync_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  source_keys_json TEXT NOT NULL DEFAULT '[]',
  raw_count INTEGER NOT NULL DEFAULT 0,
  business_count INTEGER NOT NULL DEFAULT 0,
  account_count INTEGER NOT NULL DEFAULT 0,
  supplier_count INTEGER NOT NULL DEFAULT 0,
  sku_count INTEGER NOT NULL DEFAULT 0,
  warehouse_count INTEGER NOT NULL DEFAULT 0,
  sku_source_count INTEGER NOT NULL DEFAULT 0,
  purchase_order_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_erp_jst_business_records_source_time
  ON erp_jst_business_records(company_id, source_key, business_time);

CREATE INDEX IF NOT EXISTS idx_erp_jst_business_records_status
  ON erp_jst_business_records(company_id, source_key, status);

CREATE INDEX IF NOT EXISTS idx_erp_jst_business_records_sku
  ON erp_jst_business_records(company_id, sku_code);

CREATE INDEX IF NOT EXISTS idx_erp_jst_business_records_party
  ON erp_jst_business_records(company_id, party_name);

CREATE INDEX IF NOT EXISTS idx_erp_jst_business_runs_company
  ON erp_jst_business_sync_runs(company_id, started_at);
