CREATE TABLE IF NOT EXISTS erp_1688_message_events (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  topic TEXT,
  message_type TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  source_ip TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  query_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  body_text TEXT,
  error_message TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_1688_message_events_received
  ON erp_1688_message_events(received_at);

CREATE INDEX IF NOT EXISTS idx_1688_message_events_topic
  ON erp_1688_message_events(topic, received_at);

CREATE INDEX IF NOT EXISTS idx_1688_message_events_message_id
  ON erp_1688_message_events(message_id);
