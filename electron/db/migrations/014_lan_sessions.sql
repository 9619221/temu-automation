CREATE TABLE IF NOT EXISTS erp_lan_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_lan_sessions_user
  ON erp_lan_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_erp_lan_sessions_expires
  ON erp_lan_sessions(expires_at);
