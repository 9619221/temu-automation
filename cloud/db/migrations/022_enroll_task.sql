-- 活动报名任务队列:桌面端建任务 → 扩展按 mall_id 拉取 → 在登录态页发 /enroll/submit → 回传结果
-- 指令下行通道(扩展只跟云端通信,不连本地 worker)
CREATE TABLE IF NOT EXISTS enroll_task (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  mall_id              TEXT NOT NULL,
  site                 TEXT,
  activity_type        INTEGER,
  activity_thematic_id TEXT NOT NULL,
  product_list_json    TEXT NOT NULL,            -- productList 数组(productId/activityStock/skcList/skuList/activityPrice分)
  status               TEXT NOT NULL DEFAULT 'pending',  -- pending|dispatched|done|failed
  result_json          TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at        TEXT,
  done_at              TEXT
);
-- 扩展按 (tenant, mall, status=pending) 拉取
CREATE INDEX IF NOT EXISTS idx_enroll_task_pull ON enroll_task(tenant_id, mall_id, status, created_at);
