CREATE TABLE IF NOT EXISTS erp_purchase_request_comments (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  author_role TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(author_id) REFERENCES erp_users(id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_request_events (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(actor_id) REFERENCES erp_users(id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_request_reads (
  pr_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY(pr_id, user_id),
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(user_id) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_pr_comments_pr_created
  ON erp_purchase_request_comments(pr_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pr_events_pr_created
  ON erp_purchase_request_events(pr_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pr_reads_user
  ON erp_purchase_request_reads(user_id, last_read_at);
