-- @idempotent
-- SKU 站点绑定异常（来源 agentseller queryFullyOtherMessage）：
-- 一行 = 一个 SKU 在一个站点的绑定异常（受物流渠道限制等导致不可售）。
CREATE TABLE IF NOT EXISTS erp_sku_site_exceptions (
  mall_id             TEXT    NOT NULL,
  sku_id              TEXT    NOT NULL,
  site_name           TEXT    NOT NULL,           -- 异常站点名称（如"土耳其"）
  goods_id            TEXT,
  skc_id              TEXT,
  check_code          TEXT,                        -- 异常原因代码
  exception_reason    TEXT,                        -- 异常原因文字描述
  exception_time      TEXT,                        -- 异常发生时间
  sku_spec            TEXT,                        -- SKU 属性（颜色/尺寸等）
  raw_json            TEXT    NOT NULL DEFAULT '{}',
  source              TEXT    NOT NULL DEFAULT 'robot',
  source_received_at  INTEGER,
  synced_at           TEXT    NOT NULL,
  PRIMARY KEY (mall_id, sku_id, site_name)
);

CREATE INDEX IF NOT EXISTS idx_sku_site_exc_mall
  ON erp_sku_site_exceptions(mall_id);
CREATE INDEX IF NOT EXISTS idx_sku_site_exc_goods
  ON erp_sku_site_exceptions(mall_id, goods_id);
