-- @idempotent
-- TEMU「今日首单发货」物化表(运营工作台总览统计卡)。
-- 数据源:bg.shiporderv2.get 按发货时间(deliverTimeFrom/To)拉,筛 subPurchaseOrderBasicVO.isFirst=true,
-- 按采购子单号(WB, subPurchaseOrderSn)去重。一行 = 某店某天发出的一个首单。
-- 采集 electron/erp/services/temuOpenApiFirstShip.cjs;定时刷新 scripts/refresh-openapi-firstship.cjs。
-- ext_code(货号)发货单接口常为空,留待 join 补。

CREATE TABLE IF NOT EXISTS erp_temu_firstship_daily (
  mall_id                TEXT NOT NULL,
  stat_date              TEXT NOT NULL,         -- 发货日(北京时区 YYYY-MM-DD)
  sub_purchase_order_sn  TEXT NOT NULL,         -- 采购子单号/备货单 WB...(首单去重键)
  delivery_order_sn      TEXT,                  -- 发货单号 FH...
  product_skc_id         TEXT,
  ext_code               TEXT,                  -- 货号(发货单接口常为空)
  deliver_time           INTEGER,               -- 实际发货时间(epoch ms)
  synced_at              TEXT NOT NULL,
  PRIMARY KEY (mall_id, stat_date, sub_purchase_order_sn)
);
CREATE INDEX IF NOT EXISTS idx_firstship_date ON erp_temu_firstship_daily(stat_date);
CREATE INDEX IF NOT EXISTS idx_firstship_mall_date ON erp_temu_firstship_daily(mall_id, stat_date);
