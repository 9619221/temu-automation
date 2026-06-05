-- @idempotent
-- TEMU「今日创建商品」物化表(各店概览「今日创建」列)。
-- 数据源:bg.glo.goods.list.get 按 createdAtStart/End=当天(北京)拉,一行 = 某店某天创建的一个 SKC。
-- 采集 electron/erp/services/temuOpenApiGoodsCreated.cjs;定时刷新 scripts/refresh-openapi-goods-created.cjs。
CREATE TABLE IF NOT EXISTS erp_temu_goods_created_daily (
  mall_id          TEXT NOT NULL,
  stat_date        TEXT NOT NULL,         -- 创建日(北京时区 YYYY-MM-DD)
  product_skc_id   TEXT NOT NULL,
  product_id       TEXT,
  skc_site_status  INTEGER,               -- 站点状态 0未发布/100在售/200下架/300删除
  created_at       INTEGER,               -- 创建时间(epoch ms)
  synced_at        TEXT NOT NULL,
  PRIMARY KEY (mall_id, stat_date, product_skc_id)
);
CREATE INDEX IF NOT EXISTS idx_goods_created_date ON erp_temu_goods_created_daily(stat_date);
CREATE INDEX IF NOT EXISTS idx_goods_created_mall_date ON erp_temu_goods_created_daily(mall_id, stat_date);
