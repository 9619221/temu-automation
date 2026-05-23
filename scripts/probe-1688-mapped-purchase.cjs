#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

const { openErpDatabase } = require("../electron/db/connection.cjs");
const {
  closeErp,
  initializeErp,
  registerErpIpcHandlers,
} = require("../electron/erp/ipc.cjs");

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const eq = item.indexOf("=");
    if (eq > 0) {
      args.set(item.slice(0, eq), item.slice(eq + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(item, next);
      index += 1;
    } else {
      args.set(item, true);
    }
  }
  return args;
}

function argValue(args, name, fallback = null) {
  const value = args.get(name);
  if (value === true || value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function argFlag(args, name, envName = null) {
  if (args.has(name)) return true;
  if (!envName) return false;
  return ["1", "true", "yes", "on"].includes(String(process.env[envName] || "").toLowerCase());
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function defaultAppDataDir() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(roaming, "temu-automation");
}

function defaultSourceDataDir(args) {
  const explicit = argValue(args, "--source-data-dir")
    || argValue(args, "--data-dir")
    || process.env.ERP_SOURCE_DATA_DIR
    || process.env.ERP_DATA_DIR
    || process.env.ERP_DATA_PATH;
  if (explicit) return path.resolve(explicit);
  return path.join(defaultAppDataDir(), "data");
}

function createInvoker() {
  const handlers = new Map();
  const listeners = new Map();
  const fakeIpcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
      return this;
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
      return this;
    },
  };
  registerErpIpcHandlers(fakeIpcMain);
  return async function invoke(channel, payload) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return handler({}, payload);
  };
}

function openDbForDataDir(dataDir, options = {}) {
  return openErpDatabase({
    dataDir,
    ...options,
  });
}

async function backupSourceDataDir(sourceDataDir) {
  const dbPath = path.join(sourceDataDir, "erp.sqlite");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`ERP database not found: ${dbPath}`);
  }
  const targetDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "temu-1688-mapped-probe-"));
  const targetDbPath = path.join(targetDataDir, "erp.sqlite");
  const sourceDb = openDbForDataDir(sourceDataDir);
  try {
    await sourceDb.backup(targetDbPath);
  } finally {
    sourceDb.close();
  }
  return targetDataDir;
}

function pickCandidateRows(dataDir, { limit = 20, sourceId = null } = {}) {
  const db = openDbForDataDir(dataDir);
  try {
    const whereSource = sourceId ? "AND source.id = @source_id" : "";
    const rows = db.prepare(`
      SELECT
        source.id AS source_id,
        source.mapping_group_id,
        source.account_id,
        acct.name AS account_name,
        acct.company_id,
        acct.default_1688_purchase_account_id AS purchase_1688_account_id,
        auth.label AS purchase_1688_label,
        auth.member_id AS purchase_1688_member_id,
        source.sku_id,
        sku.internal_sku_code,
        sku.product_name,
        source.external_offer_id,
        source.external_sku_id,
        source.external_spec_id,
        source.unit_price,
        source.moq,
        source.our_qty,
        source.platform_qty,
        addr.id AS delivery_address_id,
        addr.address_id AS remote_delivery_address_id,
        addr.label AS delivery_address_label,
        addr.is_default AS delivery_address_is_default,
        source.updated_at
      FROM erp_sku_1688_sources source
      JOIN erp_skus sku ON sku.id = source.sku_id
      JOIN erp_accounts acct ON acct.id = source.account_id
      JOIN erp_1688_auth_settings auth
        ON auth.id = acct.default_1688_purchase_account_id
       AND auth.company_id = acct.company_id
      JOIN erp_1688_delivery_addresses addr
        ON addr.id = (
          SELECT sub.id
          FROM erp_1688_delivery_addresses sub
          WHERE sub.company_id = acct.company_id
            AND sub.purchase_1688_account_id = auth.id
            AND sub.status = 'active'
            AND COALESCE(sub.address_id, '') <> ''
          ORDER BY sub.is_default DESC, sub.updated_at DESC, sub.created_at DESC
          LIMIT 1
        )
      WHERE source.status = 'active'
        AND source.is_default = 1
        AND COALESCE(source.external_offer_id, '') <> ''
        AND COALESCE(source.external_spec_id, '') <> ''
        AND (
          COALESCE(source.external_sku_id, '') = ''
          OR source.external_sku_id != source.external_spec_id
        )
        AND COALESCE(acct.default_1688_purchase_account_id, '') <> ''
        AND auth.status = 'active'
        AND COALESCE(auth.app_key, '') <> ''
        AND COALESCE(auth.app_secret, '') <> ''
        AND (COALESCE(auth.access_token, '') <> '' OR COALESCE(auth.refresh_token, '') <> '')
        AND (sku.status IS NULL OR sku.status NOT IN ('deleted', 'blocked'))
        AND (acct.status IS NULL OR acct.status NOT IN ('deleted', 'blocked'))
        ${whereSource}
      ORDER BY source.updated_at DESC, source.created_at DESC
      LIMIT @limit
    `).all({
      limit,
      source_id: sourceId,
    });

    const seen = new Set();
    return rows.filter((row) => {
      const key = [
        row.account_id,
        row.sku_id,
        row.mapping_group_id || row.source_id,
        row.purchase_1688_account_id,
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } finally {
    db.close();
  }
}

function summarizeCargo(params = {}) {
  return (Array.isArray(params.cargoParamList) ? params.cargoParamList : []).map((item) => ({
    offerId: item.offerId || item.offer_id || null,
    specId: item.specId || item.spec_id || item.cargoSkuId || item.cargo_sku_id || null,
    quantity: item.quantity || null,
  }));
}

function summarizeAttemptCandidate(row = {}) {
  return {
    sourceId: row.source_id,
    mappingGroupId: row.mapping_group_id || null,
    accountId: row.account_id,
    accountName: row.account_name,
    skuId: row.sku_id,
    internalSkuCode: row.internal_sku_code,
    productName: row.product_name,
    offerId: row.external_offer_id,
    skuId1688: row.external_sku_id || null,
    specId1688: row.external_spec_id,
    purchase1688AccountId: row.purchase_1688_account_id,
    purchase1688Label: row.purchase_1688_label,
    deliveryAddressId: row.delivery_address_id,
    remoteDeliveryAddressId: row.remote_delivery_address_id,
  };
}

function collectProbeLogs(dataDir, ids = {}) {
  const db = openDbForDataDir(dataDir);
  try {
    const events = ids.prId
      ? db.prepare(`
        SELECT event_type, actor_role, created_at
        FROM erp_purchase_request_events
        WHERE pr_id = ?
        ORDER BY created_at ASC
      `).all(ids.prId)
      : [];
    const auditLogs = ids.poId
      ? db.prepare(`
        SELECT action, entity_type, actor_role, created_at
        FROM erp_audit_logs
        WHERE entity_id IN (?, ?)
        ORDER BY created_at ASC
      `).all(ids.prId || "", ids.poId)
      : [];
    const apiLogs = db.prepare(`
      SELECT api_key, action, status, error_message, created_at
      FROM erp_1688_api_call_log
      WHERE created_by = 'probe_buyer'
      ORDER BY created_at DESC
      LIMIT 8
    `).all();
    return { events, auditLogs, apiLogs };
  } finally {
    db.close();
  }
}

async function ensureProbeUsers(invoke) {
  const accessCode = crypto.randomUUID();
  await invoke("erp:user:upsert", {
    id: "probe_ops",
    name: "Probe Ops",
    role: "operations",
    status: "active",
    accessCode,
  });
  await invoke("erp:user:upsert", {
    id: "probe_buyer",
    name: "Probe Buyer",
    role: "buyer",
    status: "active",
    accessCode,
  });
}

async function disableProbeUsers(invoke) {
  for (const user of [
    { id: "probe_ops", name: "Probe Ops", role: "operations" },
    { id: "probe_buyer", name: "Probe Buyer", role: "buyer" },
  ]) {
    try {
      await invoke("erp:user:upsert", {
        ...user,
        status: "blocked",
      });
    } catch {}
  }
}

async function runCandidate(invoke, candidate, options = {}) {
  const requestedQty = options.qty;
  const livePush = Boolean(options.live);
  options.log?.(`create purchase request: ${candidate.internal_sku_code || candidate.sku_id}`);
  const requestResult = await invoke("erp:purchase:action", {
    action: "create_purchase_request",
    accountId: candidate.account_id,
    skuId: candidate.sku_id,
    requestedQty,
    targetUnitCost: candidate.unit_price || 0,
    reason: `1688 mapped purchase probe for ${candidate.internal_sku_code || candidate.sku_id}`,
    evidence: [
      `source=${candidate.source_id}`,
      livePush
        ? "live probe: real 1688 order push was explicitly confirmed"
        : "safe probe: real preview is allowed, order push is dry-run only",
    ],
    includeWorkbench: false,
    actor: {
      id: "probe_ops",
      role: "operations",
    },
  });
  const pr = requestResult.result;

  options.log?.(`generate PO from default 1688 mapping: pr=${pr.id}`);
  const poResult = await invoke("erp:purchase:action", {
    action: "generate_po",
    prId: pr.id,
    qty: requestedQty,
    preferSku1688Source: true,
    includeWorkbench: false,
    remark: livePush
      ? "1688 mapped purchase probe generated this PO before explicit live push"
      : "1688 mapped purchase probe generated this PO in a copied database",
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  });
  const po = poResult.result.purchaseOrder;

  const commonPayload = {
    poId: po.id,
    purchase1688AccountId: candidate.purchase_1688_account_id,
    deliveryAddressId: candidate.delivery_address_id,
    includeWorkbench: false,
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  };

  options.log?.(`validate push params: po=${po.id}`);
  const validateResult = await invoke("erp:purchase:action", {
    action: "validate_1688_order_push",
    ...commonPayload,
  });
  options.log?.(`build dry-run push params: po=${po.id}`);
  const dryRunResult = await invoke("erp:purchase:action", {
    action: "push_1688_order",
    ...commonPayload,
    dryRun: true,
    message: "1688 mapped purchase probe dry-run; do not create a real order",
  });

  let previewResult = null;
  if (!options.skipPreview) {
    options.log?.(`call real 1688 preview API: po=${po.id}`);
    previewResult = await invoke("erp:purchase:action", {
      action: "preview_1688_order",
      ...commonPayload,
      message: "1688 mapped purchase probe preview; no real order is created",
    });
  }
  const previewTotal = optionalNumber(previewResult?.result?.preview?.totalAmount);
  const maxPreviewTotal = optionalNumber(options.maxPreviewTotal);
  if (livePush && maxPreviewTotal !== null && previewTotal === null) {
    throw new Error("Preview total is unavailable; refusing live 1688 order push with a max-preview-total guard");
  }
  if (livePush && maxPreviewTotal !== null && previewTotal !== null && previewTotal > maxPreviewTotal) {
    throw new Error(`Preview total ${previewTotal} exceeds live max ${maxPreviewTotal}`);
  }

  let livePushResult = null;
  if (livePush) {
    options.log?.(`LIVE push real 1688 order: po=${po.id}`);
    livePushResult = await invoke("erp:purchase:action", {
      action: "push_1688_order",
      ...commonPayload,
      message: "1688 mapped purchase probe live push after explicit confirmation",
    });
  }

  return {
    candidate: summarizeAttemptCandidate(candidate),
    purchaseRequest: {
      id: pr.id,
      status: pr.status,
      requestedQty: pr.requestedQty,
    },
    purchaseOrder: {
      id: po.id,
      poNo: po.poNo,
      status: po.status,
      totalAmount: po.totalAmount,
      externalOrderId: po.externalOrderId || null,
    },
    validation: {
      ready: Boolean(validateResult.result.ready),
      apiKey: validateResult.result.apiKey,
      cargoCount: validateResult.result.cargoCount,
      hasAddress: Boolean(validateResult.result.hasAddress),
      outOrderId: validateResult.result.params?.outOrderId || null,
      cargoParamList: summarizeCargo(validateResult.result.params),
    },
    dryRunPush: {
      dryRun: Boolean(dryRunResult.result.dryRun),
      apiKey: dryRunResult.result.apiKey,
      outOrderId: dryRunResult.result.params?.outOrderId || null,
      flow: dryRunResult.result.params?.flow || null,
      hasAddress: Boolean(dryRunResult.result.params?.addressParam),
      cargoParamList: summarizeCargo(dryRunResult.result.params),
    },
    preview: previewResult ? {
      apiKey: previewResult.result.apiKey,
      totalAmount: previewResult.result.preview?.totalAmount ?? null,
      freight: previewResult.result.preview?.freight ?? null,
      purchaseOrderStatus: previewResult.result.purchaseOrder?.externalOrderStatus || null,
    } : {
      skipped: true,
    },
    livePush: livePushResult ? {
      apiKey: livePushResult.result.apiKey,
      externalOrderId: livePushResult.result.externalOrderId || null,
      purchaseOrderStatus: livePushResult.result.purchaseOrder?.status || null,
      externalOrderStatus: livePushResult.result.purchaseOrder?.externalOrderStatus || null,
      rawResponsePresent: Boolean(livePushResult.result.rawResponse),
    } : null,
  };
}

async function main() {
  const args = parseArgs();
  const quiet = argFlag(args, "--quiet");
  const log = (message) => {
    if (!quiet) console.error(`[1688-mapped-probe] ${message}`);
  };
  const sourceDataDir = defaultSourceDataDir(args);
  const inPlace = argFlag(args, "--in-place", "ERP_1688_PROBE_IN_PLACE");
  const live = argFlag(args, "--live", "ERP_1688_PROBE_LIVE");
  const skipPreview = argFlag(args, "--skip-preview", "ERP_1688_PROBE_SKIP_PREVIEW");
  const sourceId = argValue(args, "--source-id", process.env.ERP_1688_PROBE_SOURCE_ID || null);
  const maxAttempts = live ? 1 : Math.max(1, Number(argValue(args, "--max-attempts", process.env.ERP_1688_PROBE_MAX_ATTEMPTS || 8)));
  const qty = Math.max(1, Math.floor(Number(argValue(args, "--qty", process.env.ERP_1688_PROBE_QTY || 1))));
  const confirmLive = argValue(args, "--confirm-live", process.env.ERP_1688_PROBE_CONFIRM_LIVE || null);
  const maxPreviewTotal = optionalNumber(argValue(args, "--max-preview-total", process.env.ERP_1688_PROBE_MAX_PREVIEW_TOTAL || 500));

  if (live) {
    if (!inPlace) {
      throw new Error("Live 1688 order push requires --in-place so the created order is recorded in the real ERP database");
    }
    if (!sourceId) {
      throw new Error("Live 1688 order push requires --source-id to avoid trying multiple mappings");
    }
    if (skipPreview) {
      throw new Error("Live 1688 order push cannot use --skip-preview");
    }
    if (confirmLive !== "CREATE_1688_ORDER") {
      throw new Error("Live 1688 order push requires --confirm-live=CREATE_1688_ORDER");
    }
  }

  log(inPlace ? `using source database in place: ${sourceDataDir}` : `backing up source database: ${sourceDataDir}`);
  const dataDir = inPlace ? sourceDataDir : await backupSourceDataDir(sourceDataDir);
  log(`probe database: ${dataDir}`);
  const userDataDir = path.join(os.tmpdir(), `temu-1688-mapped-probe-runtime-${Date.now()}`);

  const candidates = pickCandidateRows(dataDir, {
    limit: Math.max(maxAttempts * 3, 20),
    sourceId,
  }).slice(0, maxAttempts);
  log(`selected ${candidates.length} candidate mapping(s)`);
  if (!candidates.length) {
    throw new Error("No default active 1688 SKU mappings with OAuth account and remote delivery address were found");
  }

  log("initializing ERP runtime");
  initializeErp({
    userDataDir,
    dataDir,
    backup: false,
  });
  const invoke = createInvoker();
  await ensureProbeUsers(invoke);

  const attempts = [];
  let success = null;
  try {
    for (const candidate of candidates) {
      try {
        log(`attempt source=${candidate.source_id}`);
        const result = await runCandidate(invoke, candidate, {
          qty,
          skipPreview,
          live,
          maxPreviewTotal,
          log,
        });
        attempts.push({
          ok: true,
          candidate: result.candidate,
          purchaseRequest: result.purchaseRequest,
          purchaseOrder: result.purchaseOrder,
          validation: result.validation,
          dryRunPush: result.dryRunPush,
          preview: result.preview,
          livePush: result.livePush,
        });
        success = result;
        log(`attempt succeeded: po=${result.purchaseOrder.id}`);
        break;
      } catch (error) {
        log(`attempt failed: ${error?.message || String(error)}`);
        attempts.push({
          ok: false,
          candidate: summarizeAttemptCandidate(candidate),
          error: error?.message || String(error),
        });
      }
    }
  } finally {
    await disableProbeUsers(invoke);
    closeErp();
  }

  const logs = success
    ? collectProbeLogs(dataDir, {
      prId: success.purchaseRequest.id,
      poId: success.purchaseOrder.id,
    })
    : collectProbeLogs(dataDir);
  const summary = {
    ok: Boolean(success),
    safeMode: inPlace ? "in-place-copy-disabled" : "temporary-db-copy",
    sourceDataDir,
    probeDataDir: dataDir,
    realPreviewCalled: Boolean(success && !skipPreview),
    realOrderCreated: Boolean(success?.livePush),
    live,
    maxPreviewTotal: maxPreviewTotal ?? null,
    qty,
    attempts,
    logs,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  try {
    closeErp();
  } catch {}
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
