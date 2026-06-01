-- 运营工作台「今日待办」闭环状态:把某条待办标记为已处理/已忽略,跨设备/跨用户共享
-- task_key 由前端按「店|SKC|SKU|问题类型」生成,稳定可复算(见 OperationsWorkbench.tsx todoTasks)
-- CREATE TABLE IF NOT EXISTS 本身幂等
CREATE TABLE IF NOT EXISTS op_task_state (
  task_key   TEXT PRIMARY KEY,
  status     TEXT NOT NULL,            -- 'done' | 'ignored'
  owner      TEXT,                     -- 标记人(预留)
  note       TEXT,
  updated_at INTEGER NOT NULL
);
