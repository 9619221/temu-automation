-- @idempotent
ALTER TABLE erp_suppliers ADD COLUMN supplier_code TEXT;
ALTER TABLE erp_suppliers ADD COLUMN supplier_level TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE erp_suppliers ADD COLUMN payment_terms TEXT;
ALTER TABLE erp_suppliers ADD COLUMN lead_days INTEGER;
ALTER TABLE erp_suppliers ADD COLUMN tax_rate REAL;
ALTER TABLE erp_suppliers ADD COLUMN settlement_currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE erp_suppliers ADD COLUMN remark TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_suppliers_company_code
  ON erp_suppliers(company_id, supplier_code);

CREATE INDEX IF NOT EXISTS idx_erp_suppliers_company_level
  ON erp_suppliers(company_id, supplier_level);
