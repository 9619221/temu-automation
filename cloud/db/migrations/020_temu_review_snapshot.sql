-- TEMU 商品评价快照（/bg-luna-agent-seller/review/pageQuery）
-- 数据来源：运营访问评价页时扩展 hook 捕获，扩展 SW 暂不主动调。

CREATE TABLE IF NOT EXISTS temu_review_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  review_id TEXT NOT NULL,
  product_id TEXT,
  product_skc_id TEXT,
  product_sku_ids TEXT,
  goods_id TEXT,
  goods_skc_id TEXT,
  goods_sku_id TEXT,
  goods_name TEXT,
  score INTEGER,
  comment TEXT,
  spec_summary TEXT,
  category_path TEXT,
  review_pictures TEXT,
  review_videos TEXT,
  status INTEGER,
  on_sale INTEGER,
  is_benefit_review INTEGER,
  created_at_ts INTEGER,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, review_id)
);

CREATE INDEX IF NOT EXISTS idx_temu_review_tenant_mall_updated
  ON temu_review_snapshot(tenant_id, mall_id, last_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_temu_review_skc
  ON temu_review_snapshot(tenant_id, mall_id, product_skc_id);

CREATE INDEX IF NOT EXISTS idx_temu_review_created
  ON temu_review_snapshot(tenant_id, mall_id, created_at_ts DESC);
