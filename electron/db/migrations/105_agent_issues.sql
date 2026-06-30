-- Agent 问题追踪表 (Marvis-style issues)
-- @idempotent

CREATE TABLE IF NOT EXISTS erp_agent_issues (
  id           TEXT PRIMARY KEY,
  run_id       TEXT,
  category     TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'medium',
  title        TEXT NOT NULL,
  description  TEXT DEFAULT '',
  context      TEXT DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'open',
  resolved_by  TEXT,
  resolution   TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  resolved_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_issues_status ON erp_agent_issues(status);
CREATE INDEX IF NOT EXISTS idx_agent_issues_category ON erp_agent_issues(category);
CREATE INDEX IF NOT EXISTS idx_agent_issues_severity ON erp_agent_issues(severity);
CREATE INDEX IF NOT EXISTS idx_agent_issues_created ON erp_agent_issues(created_at DESC);

-- Agent 运行日志详情
CREATE TABLE IF NOT EXISTS erp_agent_run_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  turn         INTEGER,
  event_type   TEXT NOT NULL,
  tool_name    TEXT,
  content      TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON erp_agent_run_events(run_id);
