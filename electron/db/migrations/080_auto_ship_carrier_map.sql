-- @idempotent
-- 采购自动发货「快递映射表」：按 (店铺 mall_id, 商品 product_id) 配指定快递 + 揽收时段偏好。
-- 自动发货时按 product_id 查此表选快递/揽收；没配的退「默认策略」(见 erp_auto_ship_default)。
-- 维护方式：前端配置页 + Excel 批量导入。

CREATE TABLE IF NOT EXISTS erp_auto_ship_carrier_map (
  mall_id              TEXT NOT NULL,
  product_id           TEXT NOT NULL,           -- 商品(SPU)
  ext_code             TEXT,                     -- 货号(展示/Excel 对账用，非键)
  product_name         TEXT,                     -- 商品名(展示用)
  express_company_id   TEXT,                     -- 指定快递公司 ID(发货时在 logisticsmatch 候选里匹配)
  express_company_name TEXT,                     -- 快递公司名(展示 + 兜底按名匹配)
  pickup_pref          TEXT,                     -- 揽收时段偏好：morning(上午)/afternoon(下午)/evening(晚上)/asap(尽快)/HH:MM-HH:MM
  note                 TEXT,
  updated_at           TEXT,
  updated_by           TEXT,
  PRIMARY KEY (mall_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_auto_ship_map_mall ON erp_auto_ship_carrier_map(mall_id);
CREATE INDEX IF NOT EXISTS idx_auto_ship_map_ext ON erp_auto_ship_carrier_map(ext_code);

-- 默认策略(没命中映射表时用)。单行(id=1)。
-- carrier_strategy: cheapest(最便宜) / most_used(平台常用) / most_used_then_cheapest(常用优先退便宜)
CREATE TABLE IF NOT EXISTS erp_auto_ship_default (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  carrier_strategy TEXT NOT NULL DEFAULT 'most_used_then_cheapest',
  pickup_pref      TEXT DEFAULT 'asap',
  updated_at       TEXT,
  updated_by       TEXT
);
INSERT OR IGNORE INTO erp_auto_ship_default (id, carrier_strategy, pickup_pref) VALUES (1, 'most_used_then_cheapest', 'asap');
