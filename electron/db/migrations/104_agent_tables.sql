-- Agent 系统核心表
-- @idempotent

-- Agent 审批队列
CREATE TABLE IF NOT EXISTS erp_agent_approvals (
  id             TEXT PRIMARY KEY,
  run_id         TEXT,
  tool_name      TEXT NOT NULL,
  tool_input     TEXT DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'pending',
  reject_reason  TEXT DEFAULT '',
  created_at     TEXT DEFAULT (datetime('now')),
  resolved_at    TEXT
);

-- Agent 记忆（运营经验）
CREATE TABLE IF NOT EXISTS erp_agent_memory (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  tags         TEXT DEFAULT '',
  confidence   REAL DEFAULT 0.7,
  status       TEXT NOT NULL DEFAULT 'active',
  source       TEXT DEFAULT 'manual',
  hit_count    INTEGER DEFAULT 0,
  last_hit_at  TEXT,
  decay_at     TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Agent 决策日志
CREATE TABLE IF NOT EXISTS erp_agent_decision_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT,
  turn         INTEGER,
  observation  TEXT,
  reasoning    TEXT,
  decision     TEXT,
  confidence   REAL,
  risk         TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Agent 运行历史
CREATE TABLE IF NOT EXISTS erp_agent_runs (
  id           TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  trigger_data TEXT DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'running',
  turns        INTEGER DEFAULT 0,
  reply        TEXT,
  issue_count  INTEGER DEFAULT 0,
  started_at   TEXT DEFAULT (datetime('now')),
  finished_at  TEXT,
  error        TEXT
);

-- Agent 定时跟进
CREATE TABLE IF NOT EXISTS erp_agent_followups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT NOT NULL,
  context      TEXT DEFAULT '{}',
  fire_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON erp_agent_approvals(status);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_created ON erp_agent_approvals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_status ON erp_agent_memory(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON erp_agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_followups_fire ON erp_agent_followups(fire_at) WHERE status = 'pending';
