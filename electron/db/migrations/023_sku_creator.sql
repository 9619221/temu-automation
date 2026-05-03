ALTER TABLE erp_skus ADD COLUMN created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_skus_created_by
  ON erp_skus(created_by);
