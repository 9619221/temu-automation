#!/usr/bin/env node

const path = require("path");
const {
  closeErp,
  startErpHeadlessServer,
  runScheduledOrderSync,
  runScheduledMessageReprocess,
} = require("../electron/erp/ipc.cjs");

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
  // 启动后立即跑一次，不等首个 interval。
  setImmediate(() => { tickPurchaseAutoSync().catch((e) => console.warn("[order-sync] initial tick failed:", e?.message || e)); });
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
  setTimeout(() => {
    try { startPurchaseAutoSyncScheduler(); } catch (e) { console.warn("[order-sync] start failed:", e?.message || e); }
  }, 30 * 1000);
}

function shutdown(signal) {
  console.log(`[ERP Server] received ${signal}, shutting down...`);
  if (purchaseSchedulerTimer) { clearInterval(purchaseSchedulerTimer); purchaseSchedulerTimer = null; }
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
