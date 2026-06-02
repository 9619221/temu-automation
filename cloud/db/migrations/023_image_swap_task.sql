-- 换图任务队列:前端/桌面端建任务(含图片 base64) → 扩展按 mall_id 拉取 → 登录态页上传素材+提交 image/edit → 回传结果
-- 方案 B:图片二进制由云端备成 base64 放进 images_json,扩展不 fetch 公网图(指令下行通道,扩展只跟云端通信,不连本地 worker)
CREATE TABLE IF NOT EXISTS image_swap_task (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  mall_id       TEXT NOT NULL,
  site          TEXT,
  product_id    TEXT NOT NULL,
  images_json   TEXT NOT NULL,                     -- [{base64,mime,name}] 轮播图 5-10 张
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending|dispatched|done|failed
  result_json   TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  done_at       TEXT
);
-- 扩展按 (tenant, mall, status=pending) 拉取
CREATE INDEX IF NOT EXISTS idx_image_swap_task_pull ON image_swap_task(tenant_id, mall_id, status, created_at);
