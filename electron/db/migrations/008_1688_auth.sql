CREATE TABLE IF NOT EXISTS erp_1688_auth_settings (
  id TEXT PRIMARY KEY,
  app_key TEXT,
  app_secret TEXT,
  redirect_uri TEXT,
  access_token TEXT,
  refresh_token TEXT,
  member_id TEXT,
  ali_id TEXT,
  resource_owner TEXT,
  token_payload_json TEXT NOT NULL DEFAULT '{}',
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  authorized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_1688_oauth_states (
  state TEXT PRIMARY KEY,
  created_by TEXT,
  redirect_after TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_1688_oauth_states_expires
  ON erp_1688_oauth_states(expires_at);
