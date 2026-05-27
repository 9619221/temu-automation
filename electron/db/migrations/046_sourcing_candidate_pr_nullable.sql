-- @no-transaction
-- 放开 erp_sourcing_candidates.pr_id 的 NOT NULL 约束。
-- 背景：聚水潭导入的采购单没有"采购需求"PR 这条根，转线下时 INSERT candidate
-- 会撞 NOT NULL constraint failed: erp_sourcing_candidates.pr_id。
-- 做法按 SQLite 官方推荐：关 FK → 事务内重建表 → FK 自检 → 开 FK。

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE erp_sourcing_candidates__new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  pr_id TEXT,
  purchase_source TEXT NOT NULL,
  sourcing_method TEXT NOT NULL DEFAULT 'manual',
  supplier_id TEXT,
  supplier_name TEXT,
  product_title TEXT,
  product_url TEXT,
  image_url TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  moq INTEGER NOT NULL DEFAULT 1,
  lead_days INTEGER,
  logistics_fee REAL DEFAULT 0,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  external_offer_id TEXT,
  external_sku_id TEXT,
  external_spec_id TEXT,
  source_payload_json TEXT NOT NULL DEFAULT '{}',
  external_detail_json TEXT NOT NULL DEFAULT '{}',
  external_sku_options_json TEXT NOT NULL DEFAULT '[]',
  external_price_ranges_json TEXT NOT NULL DEFAULT '[]',
  external_detail_fetched_at TEXT,
  inquiry_status TEXT,
  inquiry_message TEXT,
  inquiry_sent_at TEXT,
  inquiry_result_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id),
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

INSERT INTO erp_sourcing_candidates__new (
  id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
  product_title, product_url, image_url, unit_price, moq, lead_days, logistics_fee,
  remark, status, created_by, created_at, updated_at,
  external_offer_id, external_sku_id, external_spec_id, source_payload_json,
  external_detail_json, external_sku_options_json, external_price_ranges_json, external_detail_fetched_at,
  inquiry_status, inquiry_message, inquiry_sent_at, inquiry_result_json
)
SELECT
  id, account_id, pr_id, purchase_source, sourcing_method, supplier_id, supplier_name,
  product_title, product_url, image_url, unit_price, moq, lead_days, logistics_fee,
  remark, status, created_by, created_at, updated_at,
  external_offer_id, external_sku_id, external_spec_id, source_payload_json,
  external_detail_json, external_sku_options_json, external_price_ranges_json, external_detail_fetched_at,
  inquiry_status, inquiry_message, inquiry_sent_at, inquiry_result_json
FROM erp_sourcing_candidates;

DROP TABLE erp_sourcing_candidates;

ALTER TABLE erp_sourcing_candidates__new RENAME TO erp_sourcing_candidates;

CREATE INDEX IF NOT EXISTS idx_erp_sourcing_pr_status
  ON erp_sourcing_candidates(pr_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_sourcing_external_offer
  ON erp_sourcing_candidates(external_offer_id);

CREATE INDEX IF NOT EXISTS idx_erp_sourcing_inquiry
  ON erp_sourcing_candidates(pr_id, inquiry_status, inquiry_sent_at);

COMMIT;

PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
