CREATE TABLE IF NOT EXISTS erp_work_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P2',
  status TEXT NOT NULL DEFAULT 'new',
  owner_role TEXT NOT NULL,
  owner_user_id TEXT,
  title TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  related_doc_type TEXT,
  related_doc_id TEXT,
  sku_id TEXT,
  due_at TEXT,
  dedupe_key TEXT,
  source_rule TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(account_id, dedupe_key),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(owner_user_id) REFERENCES erp_users(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_audit_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(actor_id) REFERENCES erp_users(id)
);

