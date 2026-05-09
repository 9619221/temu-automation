ALTER TABLE erp_accounts
  ADD COLUMN owner_name TEXT;

ALTER TABLE erp_store_collection_snapshots
  ADD COLUMN owner_name TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_accounts_company_owner
  ON erp_accounts(company_id, owner_name, status);
