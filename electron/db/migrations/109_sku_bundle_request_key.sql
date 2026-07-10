-- 组合装保存幂等键：前端超时重试用同一 key，后端命中已建记录直接返回，杜绝重复建单
-- @idempotent
ALTER TABLE erp_skus ADD COLUMN bundle_request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_skus_bundle_request_key
  ON erp_skus (company_id, bundle_request_key)
  WHERE bundle_request_key IS NOT NULL;
