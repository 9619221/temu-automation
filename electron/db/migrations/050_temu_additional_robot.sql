-- @idempotent
-- 复刻聚协云 robot「全托管数据补偿」JIT / VMI 目标表
-- 数据来源：cloud /v1/sync/temu-jit-vmi 增量拉取（扩展 SW 主动调 TEMU 接口写入 cloud）
-- 不再走桌面端 Playwright urgentOrders 任务

CREATE TABLE IF NOT EXISTS erp_temu_jit_status (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  platform_shop_id TEXT NOT NULL,
  shop_name TEXT,
  skc TEXT NOT NULL,
  sku_code TEXT,
  product_name TEXT,
  jit_status TEXT,
  jit_close_time TEXT,
  suggest_close INTEGER NOT NULL DEFAULT 0,
  stat_date TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, platform_shop_id, skc, stat_date)
);

CREATE TABLE IF NOT EXISTS erp_temu_vmi_suborder (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  platform_shop_id TEXT NOT NULL,
  shop_name TEXT,
  sub_order_id TEXT NOT NULL,
  skc TEXT,
  sku_code TEXT,
  product_name TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  order_status TEXT,
  order_type TEXT,
  create_time TEXT,
  stat_date TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, platform_shop_id, sub_order_id, stat_date)
);

ALTER TABLE erp_temu_robot_sync_runs ADD COLUMN jit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE erp_temu_robot_sync_runs ADD COLUMN vmi_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_erp_temu_jit_status_date
  ON erp_temu_jit_status(company_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_erp_temu_jit_status_skc
  ON erp_temu_jit_status(company_id, skc);

CREATE INDEX IF NOT EXISTS idx_erp_temu_vmi_suborder_date
  ON erp_temu_vmi_suborder(company_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_erp_temu_vmi_suborder_id
  ON erp_temu_vmi_suborder(company_id, sub_order_id);
