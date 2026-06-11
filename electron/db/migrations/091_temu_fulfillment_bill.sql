-- @idempotent
-- Temu 履约费用流出（聚协云第⑧类「财务明细-流出/履约服务」），来源 agentseller 抓包（机器人主动采）：
--   /api/merchant/warehouse/express/bill/global/overview  空体返回履约费用汇总（record_type='overview'，每店一行）
--   /api/merchant/warehouse/express/bill/detail/list       分页返回履约费用明细（record_type='detail'，多行）
-- 一行 = 一个总览快照 或 一条费用明细；金额/字段名无非空真实样本，宽容提取，raw_json 全留待校准。
-- overview 为快照语义（同店覆盖）；detail 按 item_key 累积。
CREATE TABLE IF NOT EXISTS erp_temu_fulfillment_bill (
  mall_id              TEXT    NOT NULL,
  record_type          TEXT    NOT NULL,             -- overview / detail
  item_key             TEXT    NOT NULL,             -- overview 固定 '_overview'；detail 取账单号或内容 hash
  bill_type            TEXT,                          -- 费用类型（运费/仓储费/...）
  amount               REAL    NOT NULL DEFAULT 0,    -- 费用金额（元，流出为正数额）
  currency             TEXT    NOT NULL DEFAULT 'CNY',
  waybill_no           TEXT,                          -- 运单号（明细）
  stat_date            TEXT,                          -- 账单日期
  raw_json             TEXT    NOT NULL DEFAULT '{}',
  source_received_at   INTEGER,
  synced_at            TEXT    NOT NULL,
  PRIMARY KEY (mall_id, record_type, item_key)
);

CREATE INDEX IF NOT EXISTS idx_temu_fulfillment_bill_mall
  ON erp_temu_fulfillment_bill(mall_id, record_type);
