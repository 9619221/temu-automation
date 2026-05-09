-- SKC 聚合快照：以商品 SKC 为主体，融合多个 endpoint 抽出的字段
-- 写入策略：parser 命中后 upsert，非空字段用 COALESCE 保留旧值
-- sources_json：记录每个字段最近一次由哪个 endpoint / event 提供，便于回溯

CREATE TABLE IF NOT EXISTS skc_snapshots (
  tenant_id TEXT NOT NULL,
  skc_id TEXT NOT NULL,

  product_id TEXT,
  mall_id TEXT,
  site TEXT,

  -- 商品基础
  title TEXT,
  category_id TEXT,
  category_name TEXT,
  status TEXT,
  thumb_url TEXT,
  spec_summary TEXT,

  -- 价格（cents 整数避免浮点精度，currency 单独存）
  declared_price_cents INTEGER,
  suggested_price_cents INTEGER,
  price_currency TEXT,

  -- 销量 / 库存（最新一次窗口的累计数）
  sales_total INTEGER,
  stock_available INTEGER,

  -- 合规 / 巡查
  compliance_status TEXT,

  -- 元数据
  sources_json TEXT,            -- {"<url_path>": "<event_id>", ...}
  first_seen_at INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,

  PRIMARY KEY (tenant_id, skc_id)
);

CREATE INDEX IF NOT EXISTS idx_skc_tenant_mall ON skc_snapshots(tenant_id, mall_id);
CREATE INDEX IF NOT EXISTS idx_skc_tenant_updated ON skc_snapshots(tenant_id, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skc_product ON skc_snapshots(tenant_id, product_id);
