-- @idempotent
-- Temu 资金限制（提现冻结规则），来源 agentseller 抓包（机器人主动采）：
-- /api/merchant/fund-frozen/rules  空体一次返回该店全部冻结项（result.rules 数组）
-- 一行 = 一个冻结原因；同步为全量替换语义（同店重复采集 UPSERT 覆盖，金额随最新抓包）。
CREATE TABLE IF NOT EXISTS erp_temu_fund_frozen (
  mall_id               TEXT    NOT NULL,
  frozen_type           TEXT    NOT NULL,             -- goods_refund_cost / advertising_expenses / ...
  reason                TEXT,
  amount                REAL    NOT NULL DEFAULT 0,   -- 元（源是 "￥7.40" 字符串，入库前剥符号）
  currency              TEXT    NOT NULL DEFAULT 'CNY',
  unfreeze_condition    TEXT,
  description           TEXT,
  raw_json              TEXT    NOT NULL DEFAULT '{}',
  source_received_at    INTEGER,
  synced_at             TEXT    NOT NULL,
  PRIMARY KEY (mall_id, frozen_type)
);

CREATE INDEX IF NOT EXISTS idx_temu_fund_frozen_mall
  ON erp_temu_fund_frozen(mall_id);
