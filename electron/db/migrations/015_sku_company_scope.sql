-- @no-transaction
PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS erp_skus_next;

CREATE TABLE erp_skus_next (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  account_id TEXT,
  internal_sku_code TEXT NOT NULL,
  temu_sku_id TEXT,
  temu_product_id TEXT,
  temu_skc_id TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  image_url TEXT,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id)
);

INSERT INTO erp_skus_next (
  id, company_id, account_id, internal_sku_code, temu_sku_id, temu_product_id,
  temu_skc_id, product_name, category, image_url, supplier_id, status,
  created_at, updated_at
)
SELECT
  sku.id,
  COALESCE(acct.company_id, supplier.company_id, 'company_default') AS company_id,
  sku.account_id,
  sku.internal_sku_code,
  sku.temu_sku_id,
  sku.temu_product_id,
  sku.temu_skc_id,
  sku.product_name,
  sku.category,
  sku.image_url,
  sku.supplier_id,
  sku.status,
  sku.created_at,
  sku.updated_at
FROM erp_skus sku
LEFT JOIN erp_accounts acct ON acct.id = sku.account_id
LEFT JOIN erp_suppliers supplier ON supplier.id = sku.supplier_id;

DROP TABLE erp_skus;
ALTER TABLE erp_skus_next RENAME TO erp_skus;

CREATE INDEX IF NOT EXISTS idx_erp_skus_account
  ON erp_skus(account_id);

CREATE INDEX IF NOT EXISTS idx_erp_skus_company_code
  ON erp_skus(company_id, internal_sku_code);

CREATE INDEX IF NOT EXISTS idx_erp_skus_company_status
  ON erp_skus(company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_skus_temu_product
  ON erp_skus(temu_product_id);

COMMIT;

PRAGMA foreign_keys = ON;
