CREATE TABLE IF NOT EXISTS erp_1688_message_subscriptions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  topic TEXT NOT NULL,
  category TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'enabled',
  callback_url TEXT,
  last_message_event_id TEXT,
  last_received_at TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, topic),
  FOREIGN KEY(created_by) REFERENCES erp_users(id),
  FOREIGN KEY(last_message_event_id) REFERENCES erp_1688_message_events(id)
);

CREATE INDEX IF NOT EXISTS idx_1688_message_subscriptions_company_status
  ON erp_1688_message_subscriptions(company_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_1688_message_subscriptions_topic
  ON erp_1688_message_subscriptions(topic, last_received_at);
