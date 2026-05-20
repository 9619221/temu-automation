-- 复刻聚协云 robot1「TEMU销量数据导入ERP」目标表
-- 口径对齐聚水潭「送仓托管报表-Temu > 销售分析」(后端 CbReportApi/DeliveryWareSales)

-- 店铺维度销量(GetShopAnalysis 口径)
CREATE TABLE IF NOT EXISTS erp_temu_sales_shop (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  platform_shop_id TEXT NOT NULL,
  shop_name TEXT,
  erp_shop_id TEXT,
  currency TEXT,
  stat_date TEXT NOT NULL,
  quality_score_lt60 INTEGER NOT NULL DEFAULT 0,
  quality_score_60_70 INTEGER NOT NULL DEFAULT 0,
  quality_score_70_90 INTEGER NOT NULL DEFAULT 0,
  quality_score_90_100 INTEGER NOT NULL DEFAULT 0,
  today_sales_qty REAL NOT NULL DEFAULT 0,
  today_sales_amount REAL NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, platform_shop_id, stat_date)
);

-- SKU 维度销量(GetSkuAnalysis 口径)
CREATE TABLE IF NOT EXISTS erp_temu_sales_sku (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  platform_shop_id TEXT NOT NULL,
  shop_name TEXT,
  sys_product_code TEXT NOT NULL,
  sys_style_code TEXT,
  product_name TEXT,
  product_category TEXT,
  local_stock REAL NOT NULL DEFAULT 0,
  purchase_stock REAL NOT NULL DEFAULT 0,
  platform_stock REAL NOT NULL DEFAULT 0,
  quality_score_lt60 INTEGER NOT NULL DEFAULT 0,
  quality_score_60_70 INTEGER NOT NULL DEFAULT 0,
  quality_score_70_90 INTEGER NOT NULL DEFAULT 0,
  quality_score_90_100 INTEGER NOT NULL DEFAULT 0,
  sales_qty REAL NOT NULL DEFAULT 0,
  sales_amount REAL NOT NULL DEFAULT 0,
  currency TEXT,
  expected_income REAL NOT NULL DEFAULT 0,
  declared_price REAL,
  add_cart_7d REAL NOT NULL DEFAULT 0,
  add_cart_total REAL NOT NULL DEFAULT 0,
  stat_date_start TEXT NOT NULL,
  stat_date_end TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, platform_shop_id, sys_product_code, stat_date_start, stat_date_end)
);

-- 申报价格/调价日志(销售管理>申报价格日志 口径)
CREATE TABLE IF NOT EXISTS erp_temu_price_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  platform_shop_id TEXT NOT NULL,
  sys_product_code TEXT,
  skc TEXT NOT NULL,
  declared_price REAL,
  changed_price REAL,
  change_time TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, platform_shop_id, skc, change_time)
);

-- 机器人采集运行记录
CREATE TABLE IF NOT EXISTS erp_temu_robot_sync_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  robot_key TEXT NOT NULL,
  shop_count INTEGER NOT NULL DEFAULT 0,
  sku_count INTEGER NOT NULL DEFAULT 0,
  price_log_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_erp_temu_sales_shop_date
  ON erp_temu_sales_shop(company_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_erp_temu_sales_sku_shop
  ON erp_temu_sales_sku(company_id, platform_shop_id, stat_date_end);

CREATE INDEX IF NOT EXISTS idx_erp_temu_sales_sku_code
  ON erp_temu_sales_sku(company_id, sys_product_code);

CREATE INDEX IF NOT EXISTS idx_erp_temu_price_log_skc
  ON erp_temu_price_log(company_id, skc, change_time);

CREATE INDEX IF NOT EXISTS idx_erp_temu_robot_runs_company
  ON erp_temu_robot_sync_runs(company_id, started_at);
