-- @idempotent
-- TEMU 商品评价
-- 数据来源：cloud temu_review_snapshot 通过 ATTACH 增量同步

CREATE TABLE IF NOT EXISTS erp_temu_reviews (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  platform_shop_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  product_id TEXT,
  product_skc_id TEXT,
  goods_id TEXT,
  goods_name TEXT,
  score INTEGER,
  comment TEXT,
  spec_summary TEXT,
  category_path TEXT,
  status INTEGER,
  on_sale INTEGER,
  created_at_ts INTEGER,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, platform_shop_id, review_id)
);

ALTER TABLE erp_temu_robot_sync_runs ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_erp_temu_reviews_skc
  ON erp_temu_reviews(company_id, product_skc_id);

CREATE INDEX IF NOT EXISTS idx_erp_temu_reviews_created
  ON erp_temu_reviews(company_id, created_at_ts DESC);

CREATE INDEX IF NOT EXISTS idx_erp_temu_reviews_score
  ON erp_temu_reviews(company_id, score);
