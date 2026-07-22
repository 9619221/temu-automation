// ============================================================
// PG 增量复制器 · 主线程侧薄壳
// 实际复制跑在 pg-replicator-worker.js（worker 线程）——capture_events 的
// body_json 大块同步读会堵死主线程事件循环（2026-07-23 主线程方案实测翻车），
// 主线程只负责拉起 worker、转发 ingest 通知、崩溃退避重启。
// PG_MIRROR_URL 未配置时整体禁用（沿用外部 cron 镜像）。
// ============================================================
import { Worker } from "node:worker_threads";

let worker = null;
let enabled = false;
let respawnDelay = 5_000;
const RESPAWN_MAX_MS = 300_000;

function spawnWorker(pgUrl) {
  const workerPath = new URL("./pg-replicator-worker.js", import.meta.url);
  worker = new Worker(workerPath, { workerData: { pgUrl } });
  worker.on("error", (err) => {
    console.error("[pg-replicator] worker error:", err?.message);
  });
  worker.on("exit", (code) => {
    worker = null;
    if (!enabled) return;
    console.error(`[pg-replicator] worker exited (code=${code}), ${respawnDelay}ms 后重启`);
    const t = setTimeout(() => {
      if (enabled) spawnWorker(pgUrl);
    }, respawnDelay);
    if (typeof t.unref === "function") t.unref();
    respawnDelay = Math.min(respawnDelay * 2, RESPAWN_MAX_MS);
  });
  worker.unref(); // 不阻止进程退出
}

// 采集批次落库完成后调用（ingest.js 主线程收到 worker 完成消息处）；未启用时空操作
export function notifyIngest() {
  if (!enabled || !worker) return;
  try { worker.postMessage("ingest"); } catch { /* worker 正在重启，兜底定时器会补 */ }
}

export function startReplicator() {
  const pgUrl = process.env.PG_MIRROR_URL || "";
  if (!pgUrl) {
    console.log("[pg-replicator] PG_MIRROR_URL 未配置，复制器未启用（沿用外部 cron 镜像）");
    return false;
  }
  if (enabled) return true;
  enabled = true;
  spawnWorker(pgUrl);
  console.log("[pg-replicator] controller started (复制跑在 worker 线程)");
  return true;
}

export function stopReplicator() {
  enabled = false;
  const w = worker;
  worker = null;
  return w ? w.terminate().catch(() => {}) : Promise.resolve();
}
