-- @idempotent
CREATE TABLE IF NOT EXISTS addstock_task (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  mall_id       TEXT NOT NULL,
  enroll_id     TEXT NOT NULL,
  add_stock     INTEGER NOT NULL,
  sku_ext_code  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  result_json   TEXT,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  dispatched_at TEXT,
  done_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_addstock_task_pull ON addstock_task(tenant_id, mall_id, status, created_at);
