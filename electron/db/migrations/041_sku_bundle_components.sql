-- @idempotent
ALTER TABLE erp_skus ADD COLUMN sku_type TEXT NOT NULL DEFAULT 'single';
ALTER TABLE erp_skus ADD COLUMN bundle_cost_price REAL;

CREATE TABLE IF NOT EXISTS erp_sku_bundle_components (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  bundle_sku_id TEXT NOT NULL,
  component_sku_id TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_cost REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bundle_sku_id, component_sku_id),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  FOREIGN KEY(bundle_sku_id) REFERENCES erp_skus(id),
  FOREIGN KEY(component_sku_id) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_sku_bundle_components_bundle
  ON erp_sku_bundle_components(company_id, bundle_sku_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_sku_bundle_components_component
  ON erp_sku_bundle_components(company_id, component_sku_id, status);
