ALTER TABLE erp_1688_delivery_addresses
  ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_1688_delivery_addresses_account_default
  ON erp_1688_delivery_addresses(company_id, account_id, status, is_default, updated_at);
