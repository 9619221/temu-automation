#!/usr/bin/env node

const path = require("path");
const { closeErp, startErpHeadlessServer } = require("../electron/erp/ipc.cjs");

function readOption(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
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
}

function shutdown(signal) {
  console.log(`[ERP Server] received ${signal}, shutting down...`);
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
