#!/usr/bin/env node

const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

const {
  closeErp,
  initializeErp,
  registerErpIpcHandlers,
} = require("../electron/erp/ipc.cjs");

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

function defaultDataDir() {
  if (process.env.ERP_DATA_DIR) return process.env.ERP_DATA_DIR;
  return path.join(defaultAppDataDir(), "data");
}

function defaultUserDataDir() {
  if (process.env.ERP_PROBE_USER_DATA) return process.env.ERP_PROBE_USER_DATA;
  return path.join(os.tmpdir(), "temu-erp-probe-runtime");
}

function defaultAppDataDir() {
  const roaming = process.env.APPDATA || path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  return path.join(roaming, "temu-automation");
}

function safeStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function summarizeCandidate(candidate) {
  return {
    id: candidate.id,
    supplierName: candidate.supplierName,
    productTitle: candidate.productTitle,
    unitPrice: candidate.unitPrice,
    moq: candidate.moq,
    productUrl: candidate.productUrl,
    externalOfferId: candidate.externalOfferId,
    externalSkuId: candidate.externalSkuId,
    externalSpecId: candidate.externalSpecId,
  };
}

async function main() {
  const keyword = process.argv[2] || process.env.ERP_1688_PROBE_KEYWORD || "cup";
  const requestedQty = Number(process.env.ERP_1688_PROBE_QTY || 2);
  const stamp = safeStamp();
  const idPrefix = `probe_1688_${stamp}`;
  const userDataDir = defaultUserDataDir();
  const dataDir = defaultDataDir();

  initializeErp({
    userDataDir,
    dataDir,
    backup: false,
  });
  const invoke = createInvoker();

  const probeAccessCode = crypto.randomUUID();
  await invoke("erp:user:upsert", {
    id: "probe_ops",
    name: "Probe Ops",
    role: "operations",
    status: "active",
    accessCode: probeAccessCode,
  });
  await invoke("erp:user:upsert", {
    id: "probe_buyer",
    name: "Probe Buyer",
    role: "buyer",
    status: "active",
    accessCode: probeAccessCode,
  });

  const account = await invoke("erp:account:upsert", {
    id: `${idPrefix}_acct`,
    name: `1688 purchase probe ${stamp}`,
    source: "probe",
    status: "online",
  });
  const sku = await invoke("erp:sku:create", {
    id: `${idPrefix}_sku`,
    accountId: account.id,
    internalSkuCode: `1688-PROBE-${stamp}`,
    productName: keyword,
    category: "1688 purchase probe",
    status: "active",
  });
  const purchaseRequestResult = await invoke("erp:purchase:action", {
    action: "create_purchase_request",
    accountId: account.id,
    skuId: sku.id,
    reason: `1688 purchase probe: ${keyword}`,
    requestedQty,
    targetUnitCost: Number(process.env.ERP_1688_PROBE_TARGET_COST || 20),
    evidence: [
      "Real 1688 official API sourcing",
      "Dry-run order only; no real order is submitted",
    ],
    actor: {
      id: "probe_ops",
      role: "operations",
    },
  });
  const purchaseRequest = purchaseRequestResult.result;

  const sourceResult = await invoke("erp:purchase:action", {
    action: "source_1688_keyword",
    prId: purchaseRequest.id,
    keyword,
    pageSize: 3,
    importLimit: 3,
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  });
  const importedCandidates = sourceResult.result.candidates || [];
  if (!importedCandidates.length) {
    throw new Error(`1688 returned no candidates for keyword: ${keyword}`);
  }

  const selectedCandidate = importedCandidates[0];
  let detailResult = null;
  let detailError = null;
  try {
    detailResult = await invoke("erp:purchase:action", {
      action: "refresh_1688_product_detail",
      candidateId: selectedCandidate.id,
      actor: {
        id: "probe_buyer",
        role: "buyer",
      },
    });
  } catch (error) {
    detailError = error?.message || String(error);
  }
  const candidateForPo = detailResult?.result?.candidate || selectedCandidate;
  const addressResult = await invoke("erp:purchase:action", {
    action: "save_1688_address",
    id: "probe_1688_address",
    label: "Probe Warehouse",
    fullName: "Probe Receiver",
    mobile: "13800000000",
    provinceText: "Zhejiang",
    cityText: "Hangzhou",
    areaText: "Xihu",
    address: "No. 1 Probe Road",
    postCode: "310000",
    isDefault: true,
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  });
  const poResult = await invoke("erp:purchase:action", {
    action: "generate_po",
    prId: purchaseRequest.id,
    candidateId: candidateForPo.id,
    qty: requestedQty,
    remark: "1688 purchase probe generated this PO without placing a real order",
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  });
  const purchaseOrder = poResult.result.purchaseOrder;

  const previewResult = await invoke("erp:purchase:action", {
    action: "preview_1688_order",
    poId: purchaseOrder.id,
    dryRun: true,
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  });
  const dryRunResult = await invoke("erp:purchase:action", {
    action: "push_1688_order",
    poId: purchaseOrder.id,
    dryRun: true,
    message: "1688 purchase probe dry-run; do not create a real order",
    actor: {
      id: "probe_buyer",
      role: "buyer",
    },
  });

  const dryRun = dryRunResult.result;
  await invoke("erp:user:upsert", {
    id: "probe_ops",
    name: "Probe Ops",
    role: "operations",
    status: "blocked",
  });
  await invoke("erp:user:upsert", {
    id: "probe_buyer",
    name: "Probe Buyer",
    role: "buyer",
    status: "blocked",
  });

  const summary = {
    ok: true,
    safeMode: "dryRun",
    dataDir,
    keyword,
    account: {
      id: account.id,
      name: account.name,
    },
    sku: {
      id: sku.id,
      internalSkuCode: sku.internalSkuCode,
      productName: sku.productName,
    },
    purchaseRequest: {
      id: purchaseRequest.id,
      status: purchaseRequest.status,
      requestedQty: purchaseRequest.requestedQty,
    },
    sourcing: {
      apiKey: sourceResult.result.apiKey,
      query: sourceResult.result.query,
      importedCount: sourceResult.result.importedCount,
      totalFound: sourceResult.result.totalFound,
      candidates: importedCandidates.map(summarizeCandidate),
    },
    productDetail: {
      ok: Boolean(detailResult),
      error: detailError,
      selectedSku: candidateForPo.externalSkuId || null,
      selectedSpec: candidateForPo.externalSpecId || null,
      priceRanges: candidateForPo.externalPriceRanges || [],
    },
    address: {
      id: addressResult.result.id,
      label: addressResult.result.label,
      addressParamPresent: Boolean(addressResult.result.addressParam),
    },
    purchaseOrder: {
      id: purchaseOrder.id,
      poNo: purchaseOrder.poNo,
      status: purchaseOrder.status,
      totalAmount: purchaseOrder.totalAmount,
      externalOrderId: purchaseOrder.externalOrderId,
    },
    previewOrder: {
      apiKey: previewResult.result.apiKey,
      outOrderId: previewResult.result.params?.outOrderId,
      cargoParamList: previewResult.result.params?.cargoParamList,
      addressParamPresent: Boolean(previewResult.result.params?.addressParam),
    },
    dryRunOrder: {
      apiKey: dryRun.apiKey,
      outOrderId: dryRun.params?.outOrderId,
      flow: dryRun.params?.flow,
      cargoParamList: dryRun.params?.cargoParamList,
      addressParamPresent: Boolean(dryRun.params?.addressParam),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => {
    try {
      closeErp();
    } catch {}
    process.exit(0);
  })
  .catch((error) => {
    try {
      closeErp();
    } catch {}
    console.error(JSON.stringify({
      ok: false,
      error: error?.message || String(error),
    }, null, 2));
    process.exit(1);
  });
