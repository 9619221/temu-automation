-- Agent 经验模板表
-- @idempotent

CREATE TABLE IF NOT EXISTS erp_agent_experience_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern      TEXT NOT NULL,
  diagnosis    TEXT NOT NULL,
  solution     TEXT NOT NULL,
  effectiveness TEXT DEFAULT '',
  use_count    INTEGER DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
