-- @idempotent
-- Temu EPR 费用明细（环保费），来源 agentseller 抓包（机器人主动采）：
-- /api/merchant/eprfee/goods/page-query        商品维度（queryType 1=待扣 2=已扣）
-- /api/merchant/eprfee/platform/wait-deduction/page-query  平台代扣维度（按资质证书）
-- 一行 = 一条费用明细；fee_scope 区分 goods/platform，deduct_status 区分 wait/deducted。
CREATE TABLE IF NOT EXISTS erp_temu_epr_fee (
  mall_id               TEXT    NOT NULL,
  site                  TEXT    NOT NULL DEFAULT 'agentseller',
  fee_scope             TEXT    NOT NULL,             -- goods | platform
  deduct_status         TEXT    NOT NULL,             -- wait | deducted | wait_refund | refunded
  item_key              TEXT    NOT NULL,             -- 显式单号/证书ID，缺失时哈希兜底
  cert_type             TEXT,
  cert_name             TEXT,
  region                TEXT,
  sku_id                TEXT,
  spu_id                TEXT,
  goods_name            TEXT,
  quantity              REAL,
  amount                REAL    NOT NULL DEFAULT 0,   -- 元
  original_amount       REAL,
  currency              TEXT    NOT NULL DEFAULT 'CNY',
  stat_date             TEXT,
  raw_json              TEXT    NOT NULL DEFAULT '{}',
  source_received_at    INTEGER,
  synced_at             TEXT    NOT NULL,
  PRIMARY KEY (mall_id, fee_scope, deduct_status, item_key)
);

CREATE INDEX IF NOT EXISTS idx_temu_epr_fee_mall_status
  ON erp_temu_epr_fee(mall_id, deduct_status);
