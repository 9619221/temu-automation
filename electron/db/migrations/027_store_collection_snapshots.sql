CREATE TABLE IF NOT EXISTS erp_store_collection_snapshots (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  account_id TEXT NOT NULL,
  store_name TEXT,
  client_user_id TEXT,
  client_user_name TEXT,
  client_snapshot_id TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, account_id, client_snapshot_id)
);

CREATE TABLE IF NOT EXISTS erp_store_collection_snapshot_sources (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  account_id TEXT NOT NULL,
  data_key TEXT NOT NULL,
  task_key TEXT,
  label TEXT,
  category TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id, data_key),
  FOREIGN KEY(snapshot_id) REFERENCES erp_store_collection_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_collection_snapshots_company_uploaded
  ON erp_store_collection_snapshots(company_id, uploaded_at);

CREATE INDEX IF NOT EXISTS idx_store_collection_snapshots_account_uploaded
  ON erp_store_collection_snapshots(company_id, account_id, uploaded_at);

CREATE INDEX IF NOT EXISTS idx_store_collection_sources_snapshot
  ON erp_store_collection_snapshot_sources(snapshot_id, data_key);

CREATE INDEX IF NOT EXISTS idx_store_collection_sources_account_key
  ON erp_store_collection_snapshot_sources(company_id, account_id, data_key, created_at);
