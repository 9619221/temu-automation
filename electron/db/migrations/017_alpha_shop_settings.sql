CREATE TABLE IF NOT EXISTS erp_alpha_shop_settings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  access_key TEXT,
  secret_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id)
);

CREATE INDEX IF NOT EXISTS idx_alpha_shop_settings_company
  ON erp_alpha_shop_settings(company_id);
