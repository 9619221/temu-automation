-- @idempotent
-- Temu 账户概览（聚协云第①类 AccountAmount），来源 agentseller 抓包（机器人主动采）：
-- /api/merchant/payment/account/amount/info  空体返回该店账户余额汇总（result 是对象）
-- 一行 = 一个店铺的账户余额快照；同步为快照语义（同店重复采集 UPSERT 覆盖，金额随最新抓包）。
-- 金额字段名无非空真实样本，按常见命名宽容提取，raw_json 全留待校准。
CREATE TABLE IF NOT EXISTS erp_temu_account_overview (
  mall_id                  TEXT    NOT NULL,
  available_amount         REAL    NOT NULL DEFAULT 0,   -- 可用余额（元）
  in_transit_amount        REAL    NOT NULL DEFAULT 0,   -- 在途/待入账金额
  pending_settle_amount    REAL    NOT NULL DEFAULT 0,   -- 待结算金额
  frozen_amount            REAL    NOT NULL DEFAULT 0,   -- 冻结金额
  withdrawable_amount      REAL    NOT NULL DEFAULT 0,   -- 可提现金额
  total_amount             REAL    NOT NULL DEFAULT 0,   -- 账户总额
  currency                 TEXT    NOT NULL DEFAULT 'CNY',
  raw_json                 TEXT    NOT NULL DEFAULT '{}',
  source_received_at       INTEGER,
  synced_at                TEXT    NOT NULL,
  PRIMARY KEY (mall_id)
);
