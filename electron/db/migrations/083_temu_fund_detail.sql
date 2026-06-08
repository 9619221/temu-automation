-- @idempotent
-- 对账中心账务明细（seller.kuajingmaihuo.com /api/merchant/fund/detail/pageSearch）
-- 被动 hook 抓包落地：售后赔付/仓储费/EPR/广告/推广等费用明细
CREATE TABLE IF NOT EXISTS erp_temu_fund_detail (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  mall_id             TEXT    NOT NULL,
  trans_sn            TEXT,                         -- 交易流水号(transSn),去重主键
  batch_id            TEXT,
  transaction_time    TEXT,                         -- 账务时间
  create_time         TEXT,                         -- 创建时间
  money_change_type   INTEGER,                      -- 1=流入 2=流出
  fund_type           INTEGER,                      -- 100结算 200提现 500退费 800赔付 900代付 1000其他 ...
  fund_type_desc      TEXT,                         -- 账务类型描述
  currency            TEXT    DEFAULT 'CNY',         -- 币种
  amount              REAL,                         -- 收支金额(带正负号)
  origin_amount       REAL,                         -- 原始金额
  remark              TEXT,                         -- 费用备注(推广服务费/仓储综合服务费/EPR费用 等)
  remark_prompt       TEXT,
  biz_type            TEXT,
  source_region       TEXT,
  query_id            TEXT,
  site                TEXT    DEFAULT 'kuajingmaihuo', -- 来源后台标识
  captured_at         TEXT    DEFAULT (datetime('now')),
  updated_at          TEXT    DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_detail_mall_trans
  ON erp_temu_fund_detail(mall_id, trans_sn);

CREATE INDEX IF NOT EXISTS idx_fund_detail_mall_time
  ON erp_temu_fund_detail(mall_id, transaction_time);

CREATE INDEX IF NOT EXISTS idx_fund_detail_fund_type
  ON erp_temu_fund_detail(fund_type, money_change_type);
