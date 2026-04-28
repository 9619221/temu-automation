CREATE TABLE IF NOT EXISTS erp_work_item_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id TEXT,
  actor_role TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(work_item_id) REFERENCES erp_work_items(id),
  FOREIGN KEY(actor_id) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_work_item_events_item ON erp_work_item_events(work_item_id, created_at);
