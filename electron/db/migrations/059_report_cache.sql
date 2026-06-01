-- @idempotent
-- 报表物化缓存表:cron 独立进程预聚合重查询(如商品运营面板),temu-erp 直接查表(毫秒、不阻塞、不碰 cloud 实时)
CREATE TABLE IF NOT EXISTS erp_report_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT,
  updated_at TEXT
);
