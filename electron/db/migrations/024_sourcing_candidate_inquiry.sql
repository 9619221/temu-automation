ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_status TEXT;
ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_message TEXT;
ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_sent_at TEXT;
ALTER TABLE erp_sourcing_candidates ADD COLUMN inquiry_result_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_erp_sourcing_inquiry_status
  ON erp_sourcing_candidates(pr_id, inquiry_status, inquiry_sent_at);
