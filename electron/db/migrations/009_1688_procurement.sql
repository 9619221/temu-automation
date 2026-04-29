ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_offer_id TEXT;

ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_sku_id TEXT;

ALTER TABLE erp_sourcing_candidates
  ADD COLUMN external_spec_id TEXT;

ALTER TABLE erp_sourcing_candidates
  ADD COLUMN source_payload_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_erp_sourcing_external_offer
  ON erp_sourcing_candidates(external_offer_id);

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_id TEXT;

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_status TEXT;

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_payload_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_po_external_order
  ON erp_purchase_orders(external_order_id);

CREATE TABLE IF NOT EXISTS erp_1688_api_call_log (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  api_key TEXT NOT NULL,
  action TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '{}',
  response_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_1688_api_call_log_account_created
  ON erp_1688_api_call_log(account_id, created_at);
