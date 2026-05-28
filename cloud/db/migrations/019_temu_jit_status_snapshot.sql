-- JIT 建议关闭 SKC 状态快照（querySuggestCloseJitSkc）
-- 扩展 SW 主动调 TEMU 全托管"紧急订单"页 querySuggestCloseJitSkc 接口，
-- 结果走 /v1/batch 入 capture_events 后被 parseTemuJitStatus 落到本表。

CREATE TABLE IF NOT EXISTS temu_jit_status_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  stat_date TEXT NOT NULL,
  skc_id TEXT NOT NULL,
  sku_id TEXT,
  product_name TEXT,
  jit_status TEXT,
  jit_close_time TEXT,
  suggest_close INTEGER,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, skc_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_jit_status_tenant_mall_updated
  ON temu_jit_status_snapshot(tenant_id, mall_id, last_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_temu_jit_status_skc
  ON temu_jit_status_snapshot(tenant_id, mall_id, skc_id);
