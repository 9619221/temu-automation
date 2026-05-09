-- 扩展端心跳：SW 周期性自报状态，用来在没有 CDP / DevTools 的情况下诊断扩展工作

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT,
  device_uuid TEXT,
  captured_count INTEGER,
  total_sent INTEGER,
  queue_depth INTEGER,
  last_capture_url TEXT,
  last_capture_at INTEGER,
  last_flush_at INTEGER,
  last_flush_ok INTEGER,
  last_flush_reason TEXT,
  hook_xhr_alive INTEGER,
  hook_perf_seen INTEGER,
  page_url TEXT,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_tenant_ts ON agent_heartbeats(tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_device ON agent_heartbeats(device_uuid, ts DESC);
