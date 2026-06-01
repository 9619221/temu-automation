-- 覆盖索引：让 shop-monitor / stats 等「按 mall 聚合采集量」的查询只读索引、不回表。
--
-- 背景：capture_events 的 body_json（原始响应体）内联在行里，表已膨胀到 GB 级。
-- shop-monitor 的 `SUM(received_at>=?) / MAX(ts) GROUP BY mall_id` 原本只 SEARCH tenant
-- 但需回表读每一行的 received_at/ts → 实际读遍整张表（含 body_json 页）。在内存放不下
-- 全表时，page cache 一旦失效，回表读 = 全盘磁盘 IO，better-sqlite3 同步阻塞整个进程
-- → 雪崩。本覆盖索引含聚合所需的全部列，使查询走 COVERING INDEX，索引仅几十 MB、常驻
-- cache，不再回表读 body_json。
--
-- 列顺序：(tenant_id, mall_id) 用于 WHERE + GROUP BY；ts/received_at/site 供覆盖聚合。
CREATE INDEX IF NOT EXISTS idx_capture_events_cover_mall
  ON capture_events(tenant_id, mall_id, ts, received_at, site);
