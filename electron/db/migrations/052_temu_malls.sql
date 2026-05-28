-- TEMU 店铺字典：mall_id ↔ 内部店号(028~077) ↔ TEMU 店名
-- 桥接云端 temu-cloud 的 mall_accounts 和桌面端运营视角
-- seed 脚本：scripts/seed-temu-malls.cjs（开发机+服务器都要跑）

CREATE TABLE IF NOT EXISTS erp_temu_malls (
  mall_id TEXT PRIMARY KEY,
  mall_name TEXT NOT NULL,
  store_code TEXT,
  site TEXT DEFAULT 'agentseller',
  status TEXT NOT NULL DEFAULT 'active',
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_erp_temu_malls_store_code ON erp_temu_malls(store_code);
CREATE INDEX IF NOT EXISTS idx_erp_temu_malls_status ON erp_temu_malls(status);
