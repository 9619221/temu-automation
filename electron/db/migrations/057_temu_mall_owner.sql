-- @idempotent
-- 给 TEMU 店铺字典加「运营负责人」列，支撑多店报表按人聚合（一人多店）。
-- 由桌面端「多店报表 - 店铺归属」入口人工维护。
ALTER TABLE erp_temu_malls ADD COLUMN owner TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_temu_malls_owner ON erp_temu_malls(owner);
