-- 之前 003 建过 device_mall_links 表，简化后通过 capture_events.mall_id 直接查
-- 已部署的环境跑这个迁移把死表清掉

DROP INDEX IF EXISTS idx_device_mall_tenant;
DROP TABLE IF EXISTS device_mall_links;
