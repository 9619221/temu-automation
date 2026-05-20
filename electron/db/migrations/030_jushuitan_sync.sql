CREATE TABLE IF NOT EXISTS erp_jst_auth_settings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  label TEXT NOT NULL DEFAULT 'default',
  auth_mode TEXT NOT NULL DEFAULT 'legacy',
  environment TEXT NOT NULL DEFAULT 'production',
  base_url TEXT NOT NULL DEFAULT 'https://open.erp321.com/api/open/query.aspx',
  partner_id TEXT,
  partner_key TEXT,
  token TEXT,
  app_key TEXT,
  app_secret TEXT,
  access_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_test_at TEXT,
  last_token_refresh_at TEXT,
  last_error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, label),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE TABLE IF NOT EXISTS erp_jst_sync_sources (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  source_key TEXT NOT NULL,
  method TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  enabled INTEGER NOT NULL DEFAULT 1,
  sync_mode TEXT NOT NULL DEFAULT 'paged',
  page_size INTEGER NOT NULL DEFAULT 100,
  default_params_json TEXT NOT NULL DEFAULT '{}',
  cursor_field TEXT,
  cursor_value TEXT,
  last_synced_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  total_synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, source_key),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE TABLE IF NOT EXISTS erp_jst_sync_jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  source_key TEXT,
  method TEXT,
  mode TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  request_json TEXT NOT NULL DEFAULT '{}',
  response_summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE TABLE IF NOT EXISTS erp_jst_raw_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  source_key TEXT NOT NULL,
  method TEXT NOT NULL,
  external_id TEXT NOT NULL,
  cursor_value TEXT,
  record_hash TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  job_id TEXT,
  UNIQUE(company_id, source_key, external_id),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  FOREIGN KEY(job_id) REFERENCES erp_jst_sync_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_jst_auth_company
  ON erp_jst_auth_settings(company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_jst_sources_company
  ON erp_jst_sync_sources(company_id, enabled, updated_at);

CREATE INDEX IF NOT EXISTS idx_erp_jst_jobs_company
  ON erp_jst_sync_jobs(company_id, started_at);

CREATE INDEX IF NOT EXISTS idx_erp_jst_raw_source
  ON erp_jst_raw_records(company_id, source_key, updated_at);

CREATE INDEX IF NOT EXISTS idx_erp_jst_raw_hash
  ON erp_jst_raw_records(record_hash);
