#!/usr/bin/env node

const path = require("path");
const fs = require("fs");

process.env.ERP_WAL_AUTOCHECKPOINT = "0";

const {
  closeErp,
  startErpHeadlessServer,
  runScheduledOrderSync,
  runScheduledMessageReprocess,
  getPurchaseWorkbench,
} = require("../electron/erp/ipc.cjs");
const { CronScheduler } = require("../electron/erp/cronScheduler.cjs");

function readOption(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function envFlag(name, defaultOn = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return defaultOn;
  return !["0", "false", "off", "no"].includes(String(raw).toLowerCase());
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let purchaseSchedulerTimer = null;
let purchaseSchedulerRunning = false;
async function tickPurchaseAutoSync() {
  if (purchaseSchedulerRunning) return;
  if (cronScheduler) {
    const status = cronScheduler.getStatus();
    const running = Object.entries(status).find(([k, v]) => k !== "_queueLength" && v && v.running);
    if (running) {
      console.log(`[order-sync] skipped: cron "${running[0]}" is running`);
      return;
    }
  }
  purchaseSchedulerRunning = true;
  try {
    const maxAgeHours = envNumber("ERP_PURCHASE_AUTO_SYNC_MAX_AGE_HOURS", 168);
    const limit = Math.min(envNumber("ERP_PURCHASE_AUTO_SYNC_LIMIT", 50), 200);
    const orderOut = await runScheduledOrderSync({
      maxAgeHours,
      limit,
      logger: (e) => { try { console.log("[order-sync]", JSON.stringify(e)); } catch {} },
    });
    if (orderOut && orderOut.processed > 0) {
      console.log(`[order-sync] tick processed=${orderOut.processed} bound=${orderOut.bound || 0}`);
    }
    const msgLimit = Math.min(envNumber("ERP_PURCHASE_MSG_REPROCESS_LIMIT", 100), 500);
    const msgMaxAgeHours = envNumber("ERP_PURCHASE_MSG_REPROCESS_MAX_AGE_HOURS", maxAgeHours);
    const msgOut = await runScheduledMessageReprocess({
      maxAgeHours: msgMaxAgeHours,
      limit: msgLimit,
      logger: (e) => { try { console.log("[msg-reprocess]", JSON.stringify(e)); } catch {} },
    });
    if (msgOut && msgOut.processed > 0) {
      console.log(`[msg-reprocess] tick processed=${msgOut.processed} promoted=${msgOut.promoted || 0}`);
    }
  } catch (e) {
    console.warn("[order-sync] tick failed:", e?.message || e);
  } finally {
    purchaseSchedulerRunning = false;
  }
}

function startPurchaseAutoSyncScheduler() {
  if (!envFlag("ERP_PURCHASE_AUTO_SYNC", true)) {
    console.log("[order-sync] scheduler disabled (ERP_PURCHASE_AUTO_SYNC=0)");
    return;
  }
  const intervalMin = Math.max(1, envNumber("ERP_PURCHASE_AUTO_SYNC_INTERVAL_MIN", 10));
  purchaseSchedulerTimer = setInterval(tickPurchaseAutoSync, intervalMin * 60 * 1000);
  console.log(`[order-sync] scheduler started, interval=${intervalMin}min`);
  setImmediate(() => { tickPurchaseAutoSync().catch((e) => console.warn("[order-sync] initial tick failed:", e?.message || e)); });
}

// ─── 串行子进程调度器（替代 6 个独立 cron 进程） ───

let cronScheduler = null;

function setupCronScheduler(erpDbPath) {
  if (!envFlag("ERP_INTERNAL_CRON", true)) {
    console.log("[cron-scheduler] disabled (ERP_INTERNAL_CRON=0)");
    return null;
  }
  const CLOUD_DB = process.env.TEMU_CLOUD_DB_PATH || "/opt/temu-cloud/data/temu-cloud.sqlite";
  const scriptsDir = __dirname;
  const envBase = { ERP_DB: erpDbPath, TEMU_CLOUD_DB_PATH: CLOUD_DB };

  const scheduler = new CronScheduler({ erpDbPath });

  scheduler.register("sku-sales", 15 * 60 * 1000,
    path.join(scriptsDir, "refresh-openapi-sku-sales.cjs"), envBase);

  scheduler.register("product-panel", 20 * 60 * 1000,
    path.join(scriptsDir, "refresh-product-panel.cjs"), { ...envBase, CLOUD_DB });

  scheduler.register("ops-reports", 20 * 60 * 1000,
    path.join(scriptsDir, "refresh-ops-reports.cjs"), { ...envBase, CLOUD_DB });

  scheduler.register("openapi-consign", 6 * 60 * 60 * 1000,
    path.join(scriptsDir, "refresh-openapi-consign.cjs"), envBase);

  scheduler.register("consign-snapshot", 6 * 60 * 60 * 1000,
    path.join(scriptsDir, "rebuild-consign-snapshot.cjs"), { ...envBase, OPENAPI_CONSIGN: "1" });

  scheduler.register("firstship", 30 * 60 * 1000,
    path.join(scriptsDir, "refresh-openapi-firstship.cjs"), envBase);

  scheduler.register("goods-created", 30 * 60 * 1000,
    path.join(scriptsDir, "refresh-openapi-goods-created.cjs"), envBase);

  scheduler.register("qc", 3 * 60 * 60 * 1000,
    path.join(scriptsDir, "refresh-openapi-qc.cjs"), { ...envBase, QC_SINCE_DAYS: "7" });

  if (envFlag("ERP_SETTLEMENT_INCOME_AUTO_SYNC", true)) {
    const settlementIntervalMin = Math.max(1, envNumber("ERP_SETTLEMENT_INCOME_SYNC_INTERVAL_MIN", 30));
    scheduler.register("settlement-income", settlementIntervalMin * 60 * 1000,
      path.join(scriptsDir, "sync-temu-settlement-income.cjs"), envBase);
  }

  cronScheduler = scheduler;
  return { scheduler };
}

async function main() {
  const port = Number(readOption("port", process.env.ERP_PORT || 19380));
  const bindAddress = readOption("bind", process.env.ERP_BIND_ADDRESS || "0.0.0.0");
  const dataDir = readOption("data-dir", process.env.ERP_DATA_DIR || path.resolve(process.cwd(), "data"));
  const result = await startErpHeadlessServer({
    port,
    bindAddress,
    dataDir,
  });

  console.log("[ERP Server] database:", result.initResult.dbPath);
  console.log("[ERP Server] migrations:", result.initResult.migrations.map((item) => `${item.key}:${item.status}`).join(", "));
  if (result.bootstrap.created) {
    console.log(`[ERP Server] bootstrapped admin: ${result.bootstrap.name}`);
  } else if (result.bootstrap.reason === "missing_env") {
    console.log("[ERP Server] no users yet. Set ERP_ADMIN_NAME and ERP_ADMIN_CODE before first start.");
  }
  console.log("[ERP Server] listening:", result.lanStatus.primaryUrl);
  for (const url of result.lanStatus.lanUrls || []) {
    console.log("[ERP Server] LAN:", url);
  }
  // 30s: order-sync（轻量网络+小写入；settlement-income 已移入 cron 子进程调度）
  setTimeout(() => {
    try { startPurchaseAutoSyncScheduler(); } catch (e) { console.warn("[order-sync] start failed:", e?.message || e); }
  }, 30 * 1000);

  // 45s: prewarm（18MB大查询）。有 worker 池时走 worker，主线程不阻塞；否则主线程直跑（原行为）。
  setTimeout(() => {
    const t0 = Date.now();
    console.log("[prewarm] firing purchase/workbench ...");
    const { prewarmPurchaseWorkbench } = require("../electron/erp/lanServer.cjs");
    prewarmPurchaseWorkbench(getPurchaseWorkbench, result.queryPool || null)
      .then((len) => console.log(`[prewarm] purchase/workbench done t=${Date.now() - t0}ms bodyLen=${len}`))
      .catch((e) => console.warn(`[prewarm] purchase/workbench failed: ${e.message}`));
  }, 45_000);

  // 120s: cron 串行调度器（各任务再依次错开 10s；在 prewarm 完成后启动，避免争磁盘）
  try {
    const cron = setupCronScheduler(result.initResult.dbPath);
    if (cron) cron.scheduler.start(300 * 1000);
  } catch (e) {
    console.warn("[cron-scheduler] setup failed:", e?.message || e);
  }
}

function shutdown(signal) {
  console.log(`[ERP Server] received ${signal}, shutting down...`);
  if (purchaseSchedulerTimer) { clearInterval(purchaseSchedulerTimer); purchaseSchedulerTimer = null; }
  if (cronScheduler) { cronScheduler.stop(); cronScheduler = null; }
  Promise.resolve(closeErp()).finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[ERP Server] failed:", error);
  try {
    closeErp();
  } catch {}
  process.exit(1);
});
