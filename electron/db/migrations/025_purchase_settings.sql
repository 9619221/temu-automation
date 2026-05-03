CREATE TABLE IF NOT EXISTS erp_purchase_settings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  inquiry_template TEXT NOT NULL DEFAULT '',
  alphashop_access_key TEXT,
  alphashop_secret_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_purchase_settings_company
  ON erp_purchase_settings(company_id);
