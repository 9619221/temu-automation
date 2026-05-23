CREATE TABLE IF NOT EXISTS temu_activity_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  stat_date TEXT NOT NULL,
  row_key TEXT NOT NULL,
  activity_kind TEXT,
  activity_id TEXT,
  activity_title TEXT,
  activity_status TEXT,
  product_id TEXT,
  skc_id TEXT,
  goods_id TEXT,
  start_at TEXT,
  end_at TEXT,
  metric_json TEXT,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, row_key, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_activity_tenant_mall_date
  ON temu_activity_snapshot(tenant_id, mall_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_activity_kind
  ON temu_activity_snapshot(tenant_id, mall_id, activity_kind, stat_date);
