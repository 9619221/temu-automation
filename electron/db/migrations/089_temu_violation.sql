-- @idempotent
-- Temu 违规处罚明细（商品维度），来源 agentseller 抓包（机器人主动采）：
-- /mms/tmod_punish/agent/merchant_appeal/entrance/list  违规申诉入口列表（含处罚明细）
-- /mms/island/punish/summary                            店铺级违规汇总（加站限制状态）
-- 一行 = 一个违规目标（target_id 即被处罚对象，goods 维度）；明细字段直解原始响应，
-- 不依赖云端泛化表 temu_operation_risk_snapshot（那边丢了申诉状态/站点数等字段）。
CREATE TABLE IF NOT EXISTS erp_temu_violation (
  mall_id               TEXT    NOT NULL,
  target_id             TEXT    NOT NULL,             -- punish_appeal_entrance_list[].target_id
  target_type           TEXT,                         -- goods
  goods_id              TEXT,
  spu_id                TEXT,
  goods_name            TEXT,
  goods_img_url         TEXT,
  source_punish_name    TEXT,                         -- 处罚来源（如 goodsAdInnerOffSite）
  leaf_reason_name      TEXT,                         -- 违规原因（如 欧盟刀具禁投）
  violation_desc        TEXT,
  punish_status_desc    TEXT,                         -- 违规处理中 等
  appeal_status         INTEGER,
  can_appeal            INTEGER,                      -- 0/1（源 can_not_appeal 取反）
  can_rectify           INTEGER,                      -- 0/1
  site_num              INTEGER,
  punish_num            INTEGER,
  stat_date             TEXT,
  raw_json              TEXT    NOT NULL DEFAULT '{}',
  source_received_at    INTEGER,
  synced_at             TEXT    NOT NULL,
  PRIMARY KEY (mall_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_temu_violation_mall
  ON erp_temu_violation(mall_id, punish_status_desc);

-- 店铺级违规汇总（island/punish/summary）：一店一行
CREATE TABLE IF NOT EXISTS erp_temu_violation_summary (
  mall_id               TEXT    NOT NULL,
  violation_count       INTEGER NOT NULL DEFAULT 0,
  add_site_limit_status INTEGER,                      -- 加站限制状态
  release_limit_time    TEXT,
  raw_json              TEXT    NOT NULL DEFAULT '{}',
  source_received_at    INTEGER,
  synced_at             TEXT    NOT NULL,
  PRIMARY KEY (mall_id)
);
