-- @idempotent
-- 存储每条报名记录关联的国家站点列表(如 [{"siteId":100,"siteName":"美国站"},…])
ALTER TABLE temu_activity_enroll_record ADD COLUMN sites_json TEXT;
