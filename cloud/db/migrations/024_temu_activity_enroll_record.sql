-- 已报名活动记录(来源:agentseller /api/kiana/gamblers/marketing/enroll/list 不带筛选参数)
-- 与可报活动快照 temu_activity_snapshot 分表存放,避免 row_key/activity_status 冲突。
-- 按 sku 维度展开(每个已报名记录的每个 sku 一行),便于 ERP 按货号/SPU 聚合「已报活动数」。
CREATE TABLE IF NOT EXISTS temu_activity_enroll_record (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  stat_date TEXT NOT NULL,
  row_key TEXT NOT NULL,
  enroll_id TEXT,
  enroll_status INTEGER,             -- 1报名中 2失败 3成功待分配 4成功已分配 5已结束 6已下线
  enroll_time TEXT,
  activity_type INTEGER,
  activity_thematic_id TEXT,
  activity_thematic_name TEXT,
  product_id TEXT,
  skc_id TEXT,
  sku_id TEXT,
  sku_ext_code TEXT,
  goods_id TEXT,
  activity_price_cents INTEGER,
  daily_price_cents INTEGER,
  activity_stock INTEGER,
  sold_status INTEGER,               -- 0正常 1即将售罄 2已售罄
  session_end_time TEXT,
  raw_json TEXT,
  source_event_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, row_key, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_enroll_record_tenant_mall_date
  ON temu_activity_enroll_record(tenant_id, mall_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_enroll_record_ext
  ON temu_activity_enroll_record(tenant_id, mall_id, sku_ext_code);
CREATE INDEX IF NOT EXISTS idx_enroll_record_product
  ON temu_activity_enroll_record(tenant_id, mall_id, product_id);
