const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { _electron: electron } = require("playwright");
const electronBinary = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const distIndex = path.join(repoRoot, "dist", "index.html");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "temu-purchase-button-timing-"));

const FLOW = {
  adminName: "Button Timing Admin",
  adminAccessCode: "button-timing-code",
  accountId: "acct_button_timing",
  accountName: "Button Timing Account",
  supplierId: "supplier_button_timing",
  supplierName: "Button Timing Supplier",
  skuId: "sku_button_timing_main",
  skuCode: "BTN-TIME-001",
  productName: "Button Timing Main SKU",
  mappedSkuId: "sku_button_timing_mapped",
  mappedSkuCode: "BTN-MAP-001",
  mappedProductName: "Button Timing Mapped SKU",
  partialSkuId: "sku_button_timing_partial",
  partialSkuCode: "BTN-PARTIAL-001",
  partialProductName: "Button Timing Partial SKU",
  offerId: "1688-button-timing-offer",
  externalSkuId: "1688-button-timing-sku",
  externalSpecId: "1688-button-timing-spec",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw new Error(`${label} timeout: ${lastError?.message || "unknown error"}`);
}

function reservePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen({ host: "127.0.0.1", port: preferredPort }, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : preferredPort;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve(port);
      });
    });
  });
}

async function findAvailablePort(preferredPort = 19321) {
  try {
    return await reservePort(preferredPort);
  } catch {
    return reservePort(0);
  }
}

function createIsolatedEnv(workerPort) {
  const appDataRoot = path.join(tmpRoot, "appdata");
  const localAppDataRoot = path.join(tmpRoot, "localappdata");
  const tempRoot = path.join(tmpRoot, "temp");
  const appUserDataRoot = path.join(tmpRoot, "user-data");
  [appDataRoot, localAppDataRoot, tempRoot, appUserDataRoot].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return {
    ...process.env,
    NODE_ENV: "production",
    APPDATA: appDataRoot,
    LOCALAPPDATA: localAppDataRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
    APP_USER_DATA: appUserDataRoot,
    TEMU_USER_DATA: appUserDataRoot,
    TEMU_WORKER_PORT: String(workerPort),
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
}

async function waitForElectronBridgeReady(page) {
  await waitFor(
    async () => {
      const ready = await page.evaluate(() => Boolean(window.electronAPI?.erp));
      if (!ready) throw new Error("window.electronAPI.erp not ready");
    },
    30000,
    "electron bridge ready",
  );
}

async function gotoHash(page, hash) {
  await page.evaluate((targetHash) => {
    window.location.hash = `#${targetHash}`;
  }, hash);
  await waitFor(
    async () => {
      const current = await page.evaluate(() => window.location.hash || "");
      if (!current.includes(hash)) throw new Error(`current hash: ${current}`);
    },
    15000,
    `route ${hash}`,
  );
  await page.waitForTimeout(400);
}

async function seedBaseData(page) {
  await page.evaluate(async (flow) => {
    const erp = window.electronAPI?.erp;
    if (!erp?.client || !erp?.auth || !erp?.account || !erp?.supplier || !erp?.sku || !erp?.purchase) {
      throw new Error("ERP bridge unavailable");
    }
    const client = await erp.client.getStatus();
    if (client?.isClientMode) await erp.client.setHostMode();
    let auth = await erp.auth.getStatus();
    if (!auth.currentUser) {
      auth = auth.hasUsers
        ? await erp.auth.login({ login: flow.adminName, accessCode: flow.adminAccessCode })
        : await erp.auth.createFirstAdmin({ name: flow.adminName, accessCode: flow.adminAccessCode });
    }
    if (!auth.currentUser) throw new Error("admin session was not established");

    const account = await erp.account.upsert({ id: flow.accountId, name: flow.accountName, source: "button-timing" });
    await erp.supplier.create({ id: flow.supplierId, name: flow.supplierName, categories: ["button-timing"] });
    await erp.sku.create({
      id: flow.skuId,
      accountId: account.id,
      internalSkuCode: flow.skuCode,
      productName: flow.productName,
      colorSpec: "Main / Timing",
    });
    const mappedSku = await erp.sku.create({
      id: flow.mappedSkuId,
      accountId: account.id,
      internalSkuCode: flow.mappedSkuCode,
      productName: flow.mappedProductName,
      colorSpec: "Mapped / Timing",
    });
    await erp.purchase.action({
      action: "upsert_sku_1688_source",
      skuId: mappedSku.id,
      accountId: account.id,
      mappingGroupId: `map_${mappedSku.id}_${flow.offerId}_${flow.externalSpecId}`,
      externalOfferId: flow.offerId,
      externalSkuId: flow.externalSkuId,
      externalSpecId: flow.externalSpecId,
      platformSkuName: "Mapped / Timing",
      supplierName: flow.supplierName,
      productTitle: "1688 Button Timing Product",
      productUrl: `https://detail.1688.com/offer/${flow.offerId}.html`,
      unitPrice: 8.8,
      moq: 1,
      logisticsFee: 0,
      ourQty: 1,
      platformQty: 1,
      isDefault: true,
      includeWorkbench: false,
    });
    await erp.purchase.action({
      action: "create_pr",
      accountId: account.id,
      skuId: mappedSku.id,
      requestedQty: 2,
      targetUnitCost: 8.8,
      reason: "button timing mapped PO",
      includeWorkbench: false,
    });
  }, FLOW);
}

async function seedPaidPartialReceipt(page) {
  return page.evaluate(async (flow) => {
    const erp = window.electronAPI?.erp;
    const sku = await erp.sku.create({
      id: flow.partialSkuId,
      accountId: flow.accountId,
      internalSkuCode: flow.partialSkuCode,
      productName: flow.partialProductName,
      colorSpec: "Partial / Timing",
    });
    const prResult = await erp.purchase.action({
      action: "create_pr",
      accountId: flow.accountId,
      skuId: sku.id,
      requestedQty: 2,
      targetUnitCost: 6.5,
      reason: "button timing partial inbound",
      includeWorkbench: false,
    });
    const prId = prResult?.result?.id;
    const poResult = await erp.purchase.action({
      action: "generate_po",
      prId,
      offlinePurchase: true,
      supplierName: flow.supplierName,
      unitPrice: 6.5,
      qty: 2,
      includeWorkbench: false,
    });
    const poId = poResult?.result?.purchaseOrder?.id;
    const payResult = await erp.purchase.action({
      action: "submit_payment_approval",
      poId,
      amount: 13,
      includeWorkbench: false,
    });
    await erp.purchase.action({
      action: "confirm_paid",
      paymentApprovalId: payResult?.result?.paymentApproval?.id,
      paymentMethod: "button-timing",
      paymentReference: "BTN-TIME-PARTIAL",
      includeWorkbench: false,
    });
    return { poId };
  }, FLOW);
}

async function installTimingHooks(page) {
  const hookStatus = await page.evaluate(() => {
    const erp = window.electronAPI?.erp;
    window.__erpTimingLog = [];
    window.__erpTimingSeq = 0;
    const wrap = (domain, method) => {
      const api = erp?.[domain];
      if (!api || typeof api[method] !== "function") return false;
      if (api[method].__timed) return true;
      const original = api[method].bind(api);
      const timed = async (...args) => {
        const payload = args[0] || {};
        const action = method === "action" ? String(payload.action || "") : "workbench";
        const entry = {
          seq: ++window.__erpTimingSeq,
          domain,
          method,
          action,
          startedAt: performance.now(),
        };
        try {
          const result = await original(...args);
          entry.ok = true;
          return result;
        } catch (error) {
          entry.ok = false;
          entry.error = String(error?.message || error || "unknown error");
          throw error;
        } finally {
          entry.durationMs = Math.round(performance.now() - entry.startedAt);
          window.__erpTimingLog.push(entry);
        }
      };
      timed.__timed = true;
      api[method] = timed;
      return api[method].__timed === true;
    };
    return {
      purchaseAction: wrap("purchase", "action"),
      purchaseWorkbench: wrap("purchase", "workbench"),
      warehouseAction: wrap("warehouse", "action"),
      warehouseWorkbench: wrap("warehouse", "workbench"),
      outboundAction: wrap("outbound", "action"),
      outboundWorkbench: wrap("outbound", "workbench"),
    };
  });
  return Object.values(hookStatus).every(Boolean);
}

async function resetTimingLog(page) {
  await page.evaluate(() => {
    window.__erpTimingLog = [];
  });
}

async function getTimingLog(page) {
  return page.evaluate(() => Array.isArray(window.__erpTimingLog) ? window.__erpTimingLog.slice() : []);
}

async function waitForTiming(page, domain, action, timeoutMs = 60000) {
  await waitFor(
    async () => {
      const found = await page.evaluate(({ domain: d, action: a }) => (
        Array.isArray(window.__erpTimingLog)
          && window.__erpTimingLog.some((entry) => entry.domain === d && entry.action === a && Number.isFinite(entry.durationMs))
      ), { domain, action });
      if (!found) throw new Error(`${domain}.${action} not logged`);
    },
    timeoutMs,
    `${domain}.${action}`,
  );
}

function summarizeLogs(logs) {
  const actionLogs = logs.filter((entry) => entry.method === "action");
  const workbenchLogs = logs.filter((entry) => entry.method === "workbench");
  const actionMs = actionLogs.reduce((sum, entry) => sum + Number(entry.durationMs || 0), 0);
  const workbenchMs = workbenchLogs.reduce((sum, entry) => sum + Number(entry.durationMs || 0), 0);
  return {
    actionMs: actionLogs.length ? actionMs : null,
    workbenchMs: workbenchLogs.length ? workbenchMs : null,
    actions: actionLogs.map((entry) => `${entry.domain}.${entry.action}:${entry.durationMs}ms`).join(", "),
    workbenches: workbenchLogs.map((entry) => `${entry.domain}:${entry.durationMs}ms`).join(", "),
  };
}

async function measure(results, page, label, click, waitUi, expectedAction, timingHooksInstalled = false) {
  await resetTimingLog(page);
  const startedAt = Date.now();
  await click();
  if (expectedAction && timingHooksInstalled) {
    await waitForTiming(page, expectedAction.domain, expectedAction.action, expectedAction.timeoutMs || 60000);
  }
  if (waitUi) await waitUi();
  await page.waitForTimeout(150);
  const uiMs = Date.now() - startedAt;
  const logs = summarizeLogs(await getTimingLog(page));
  results.push({
    label,
    uiMs,
    actionMs: logs.actionMs,
    workbenchMs: logs.workbenchMs,
    actions: logs.actions,
    workbenches: logs.workbenches,
  });
  console.log(`[timing] ${label}: UI ${uiMs}ms${logs.actions ? ` | ${logs.actions}` : ""}${logs.workbenches ? ` | workbench ${logs.workbenches}` : ""}`);
}

async function waitPurchaseRequestState(page, skuCode, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ skuCode: code, predicate }) => {
        const workbench = await window.electronAPI.erp.purchase.workbench({
          limit: 200,
          includeRequestDetails: false,
          includeOptions: false,
          include1688Meta: false,
        });
        const getSkuCode = (item) => item?.internalSkuCode || item?.skuCode || item?.internal_sku_code || item?.sku_code || item?.sku?.internalSkuCode || "";
        const row = (workbench.purchaseRequests || []).find((item) => getSkuCode(item) === code);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { skuCode, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitPurchaseOrderState(page, skuCode, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ skuCode: code, predicate }) => {
        const workbench = await window.electronAPI.erp.purchase.workbench({
          limit: 200,
          includeRequestDetails: false,
          includeOptions: false,
          include1688Meta: false,
        });
        const getSkuCode = (item) => item?.internalSkuCode || item?.skuCode || item?.internal_sku_code || item?.sku_code || item?.sku?.internalSkuCode || "";
        const row = (workbench.purchaseOrders || []).find((item) => getSkuCode(item) === code);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { skuCode, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitPurchaseOrderByIdState(page, poId, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ poId: id, predicate }) => {
        const workbench = await window.electronAPI.erp.purchase.workbench({
          limit: 200,
          includeRequestDetails: false,
          includeOptions: false,
          include1688Meta: false,
        });
        const row = (workbench.purchaseOrders || []).find((item) => item.id === id);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { poId, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitAnyPurchaseOrderState(page, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ predicate }) => {
        const workbench = await window.electronAPI.erp.purchase.workbench({
          limit: 200,
          includeRequestDetails: false,
          includeOptions: false,
          include1688Meta: false,
        });
        const fn = new Function("row", `return (${predicate})(row);`);
        const row = (workbench.purchaseOrders || []).find((item) => Boolean(fn(item)));
        if (!row) return { ok: false, reason: "missing" };
        return { ok: true, row };
      }, { predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitWarehouseBatchState(page, skuCode, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ skuCode: code, predicate }) => {
        const workbench = await window.electronAPI.erp.warehouse.workbench({ limit: 2000 });
        const getSkuCode = (item) => item?.internalSkuCode || item?.skuCode || item?.internal_sku_code || item?.sku_code || item?.sku?.internalSkuCode || "";
        const row = (workbench.inventoryBatches || []).find((item) => getSkuCode(item) === code);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { skuCode, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.qcStatus || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitWarehouseBatchByPoIdState(page, poId, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ poId: id, predicate }) => {
        const workbench = await window.electronAPI.erp.warehouse.workbench({ limit: 2000 });
        const row = (workbench.inventoryBatches || []).find((item) => item.poId === id || item.po_id === id);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { poId, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.qcStatus || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitWarehouseReceiptState(page, skuCode, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ skuCode: code, predicate }) => {
        const workbench = await window.electronAPI.erp.warehouse.workbench({ limit: 2000 });
        const getSkuCode = (item) => item?.internalSkuCode || item?.skuCode || item?.internal_sku_code || item?.sku_code || item?.sku?.internalSkuCode || "";
        const row = (workbench.inboundReceipts || []).find((item) => getSkuCode(item) === code);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { skuCode, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitWarehouseReceiptByPoIdState(page, poId, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ poId: id, predicate }) => {
        const workbench = await window.electronAPI.erp.warehouse.workbench({ limit: 2000 });
        const row = (workbench.inboundReceipts || []).find((item) => item.poId === id || item.po_id === id);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { poId, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitOutboundShipmentState(page, skuCode, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ skuCode: code, predicate }) => {
        const workbench = await window.electronAPI.erp.outbound.workbench({ limit: 200 });
        const getSkuCode = (item) => item?.internalSkuCode || item?.skuCode || item?.internal_sku_code || item?.sku_code || item?.sku?.internalSkuCode || "";
        const row = (workbench.outboundShipments || []).find((item) => getSkuCode(item) === code);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { skuCode, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitOutboundShipmentByPoIdState(page, poId, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ poId: id, predicate }) => {
        const workbench = await window.electronAPI.erp.outbound.workbench({ limit: 200 });
        const row = (workbench.outboundShipments || []).find((item) => item.poId === id || item.po_id === id);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { poId, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitOutboundShipmentByIdState(page, outboundId, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ outboundId: id, predicate }) => {
        const workbench = await window.electronAPI.erp.outbound.workbench({ limit: 200 });
        const row = (workbench.outboundShipments || []).find((item) => item.id === id);
        if (!row) return { ok: false, reason: "missing" };
        const fn = new Function("row", `return (${predicate})(row);`);
        return { ok: Boolean(fn(row)), row };
      }, { outboundId, predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || state.row?.status || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

async function waitAnyOutboundShipmentState(page, predicateSource, label, timeoutMs = 45000) {
  return waitFor(
    async () => {
      const state = await page.evaluate(async ({ predicate }) => {
        const workbench = await window.electronAPI.erp.outbound.workbench({ limit: 200 });
        const fn = new Function("row", `return (${predicate})(row);`);
        const row = (workbench.outboundShipments || []).find((item) => Boolean(fn(item)));
        if (!row) return { ok: false, reason: "missing" };
        return { ok: true, row };
      }, { predicate: predicateSource });
      if (!state.ok) throw new Error(`${label}: ${state.reason || "not ready"}`);
      return state.row;
    },
    timeoutMs,
    label,
  );
}

function button(page, name) {
  return page.locator("button").filter({ hasText: name }).first();
}

function visibleModal(page, title) {
  return page.locator(".ant-modal").filter({ hasText: title }).last();
}

async function waitButton(page, name, timeout = 45000) {
  await button(page, name).waitFor({ state: "visible", timeout });
}

async function runMeasurements(page, timingHooksInstalled) {
  const results = [];
  let offlinePoId = null;
  let outboundId = null;
  let partialPoId = null;

  await gotoHash(page, "/purchase-center");
  await page.locator(".app-page-header").getByText("采购中心", { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
  await page.getByText(FLOW.mappedSkuCode, { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });

  await measure(
    results,
    page,
    "采购中心 / 新建采购单（打开弹窗）",
    async () => button(page, "新建采购单").click(),
    async () => visibleModal(page, "新建采购单").waitFor({ state: "visible", timeout: 15000 }),
    null,
    timingHooksInstalled,
  );

  let modal = visibleModal(page, "新建采购单");
  await modal.locator(".ant-select-selector").first().click();
  await page.keyboard.type(FLOW.skuCode);
  await page.keyboard.press("Enter");
  const requestNumberInputs = modal.locator(".ant-input-number-input");
  await requestNumberInputs.nth(0).fill("4");
  await requestNumberInputs.nth(1).fill("12.5");

  await measure(
    results,
    page,
    "采购中心 / 创建采购单",
    async () => modal.getByRole("button", { name: "创建采购单", exact: true }).click(),
    async () => {
      await modal.waitFor({ state: "hidden", timeout: 45000 });
      await waitPurchaseRequestState(page, FLOW.skuCode, "(row) => row.status === 'submitted'", "main purchase request submitted");
      await page.getByText(FLOW.skuCode, { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
      await waitButton(page, "线下采购单");
    },
    { domain: "purchase", action: "create_pr" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "采购中心 / 生成采购单（已绑 1688 映射）",
    async () => button(page, "生成采购单").click(),
    async () => {
      await waitAnyPurchaseOrderState(page, "(row) => row.status === 'draft' && Number(row.mappingCount || 0) > 0", "mapped purchase order draft");
    },
    { domain: "purchase", action: "generate_po" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "采购中心 / 线下采购单（打开弹窗）",
    async () => button(page, "线下采购单").click(),
    async () => visibleModal(page, "线下采购单").waitFor({ state: "visible", timeout: 15000 }),
    null,
    timingHooksInstalled,
  );

  modal = visibleModal(page, "线下采购单");
  await modal.locator('input[placeholder*="手填供应商"]').first().fill(FLOW.supplierName);
  const offlineNumberInputs = modal.locator(".ant-input-number-input");
  if (!await offlineNumberInputs.nth(0).inputValue().catch(() => "")) {
    await offlineNumberInputs.nth(0).fill("12.5");
  }

  await measure(
    results,
    page,
    "采购中心 / 线下弹窗生成采购单",
    async () => modal.getByRole("button", { name: "生成采购单", exact: true }).click(),
    async () => {
      await modal.waitFor({ state: "hidden", timeout: 45000 });
      const row = await waitAnyPurchaseOrderState(page, "(row) => row.status === 'draft' && Number(row.mappingCount || 0) === 0", "offline purchase order draft");
      offlinePoId = row.id;
      await waitButton(page, "提交付款");
    },
    { domain: "purchase", action: "generate_po" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "采购中心 / 提交付款",
    async () => button(page, "提交付款").click(),
    async () => {
      await waitPurchaseOrderByIdState(page, offlinePoId, "(row) => row.status === 'approved_to_pay'", "offline purchase order approved to pay");
      await waitButton(page, "确认付款");
    },
    { domain: "purchase", action: "submit_payment_approval" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "采购中心 / 确认付款",
    async () => button(page, "确认付款").click(),
    async () => {
      await waitPurchaseOrderByIdState(page, offlinePoId, "(row) => row.status === 'paid' || row.paymentStatus === 'paid'", "offline purchase order paid");
      await waitWarehouseReceiptByPoIdState(page, offlinePoId, "(row) => row.status === 'pending_arrival'", "offline inbound receipt pending arrival");
      await page.getByText("已付款", { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
    },
    { domain: "purchase", action: "confirm_paid" },
    timingHooksInstalled,
  );

  await gotoHash(page, "/warehouse-center");
  await page.getByText(FLOW.skuCode, { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
  await waitButton(page, "入库");

  await measure(
    results,
    page,
    "仓库中心 / 入库",
    async () => button(page, "入库").click(),
    async () => waitFor(
      async () => {
        await waitWarehouseBatchByPoIdState(page, offlinePoId, "(row) => row.qcStatus === 'passed' && Number(row.availableQty || 0) > 0", "main inventory batch available");
        const visible = await button(page, "入库").isVisible().catch(() => false);
        if (visible) throw new Error("入库按钮仍可见");
      },
      45000,
      "inbound button hidden",
    ),
    { domain: "warehouse", action: "register_arrival" },
    timingHooksInstalled,
  );

  await gotoHash(page, "/qc-outbound");
  await page.getByText(FLOW.skuCode, { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
  await waitButton(page, "创建计划");

  await measure(
    results,
    page,
    "出库中心 / 创建计划（打开弹窗）",
    async () => button(page, "创建计划").click(),
    async () => visibleModal(page, "创建出库计划").waitFor({ state: "visible", timeout: 15000 }),
    null,
    timingHooksInstalled,
  );

  modal = visibleModal(page, "创建出库计划");
  await measure(
    results,
    page,
    "出库中心 / 创建出库计划",
    async () => modal.locator(".ant-modal-footer .ant-btn-primary").click(),
    async () => {
      await modal.waitFor({ state: "hidden", timeout: 45000 });
      const row = await waitAnyOutboundShipmentState(page, "(row) => row.status === 'pending_warehouse'", "outbound plan pending warehouse");
      outboundId = row.id;
      await waitButton(page, "开始拣货");
    },
    { domain: "outbound", action: "create_outbound_plan" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "出库中心 / 开始拣货",
    async () => button(page, "开始拣货").click(),
    async () => {
      await waitOutboundShipmentByIdState(page, outboundId, "(row) => row.status === 'picking'", "outbound picking");
      await waitButton(page, "打包完成");
    },
    { domain: "outbound", action: "start_picking" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "出库中心 / 打包完成",
    async () => button(page, "打包完成").click(),
    async () => {
      await waitOutboundShipmentByIdState(page, outboundId, "(row) => row.status === 'packed'", "outbound packed");
      await waitButton(page, "确认发出");
    },
    { domain: "outbound", action: "mark_packed" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "出库中心 / 确认发出（打开弹窗）",
    async () => button(page, "确认发出").click(),
    async () => visibleModal(page, "确认发出").waitFor({ state: "visible", timeout: 15000 }),
    null,
    timingHooksInstalled,
  );

  modal = visibleModal(page, "确认发出");
  await modal.locator("input").nth(0).fill("Button Timing Logistics");
  await modal.locator("input").nth(1).fill("BTN-TIME-TRACK");
  await measure(
    results,
    page,
    "出库中心 / 确认发出",
    async () => modal.locator(".ant-modal-footer .ant-btn-primary").click(),
    async () => {
      await modal.waitFor({ state: "hidden", timeout: 45000 });
      await waitOutboundShipmentByIdState(page, outboundId, "(row) => row.status === 'pending_ops_confirm'", "outbound pending ops confirm");
      await waitButton(page, "运营确认");
    },
    { domain: "outbound", action: "confirm_shipped_out" },
    timingHooksInstalled,
  );

  await measure(
    results,
    page,
    "出库中心 / 运营确认",
    async () => button(page, "运营确认").click(),
    async () => waitFor(
      async () => {
        await waitOutboundShipmentByIdState(page, outboundId, "(row) => row.status === 'confirmed'", "outbound confirmed");
        const visible = await button(page, "运营确认").isVisible().catch(() => false);
        if (visible) throw new Error("运营确认按钮仍可见");
      },
      45000,
      "ops confirm button hidden",
    ),
    { domain: "outbound", action: "confirm_outbound_done" },
    timingHooksInstalled,
  );

  const partialSeed = await seedPaidPartialReceipt(page);
  partialPoId = partialSeed.poId;
  await gotoHash(page, "/warehouse-center");
  await page.getByText(FLOW.partialSkuCode, { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
  await waitButton(page, "按实数入库");

  await measure(
    results,
    page,
    "仓库中心 / 按实数入库（打开明细）",
    async () => button(page, "按实数入库").click(),
    async () => {
      await visibleModal(page, "按实数入库").waitFor({ state: "visible", timeout: 45000 });
      await visibleModal(page, "按实数入库").getByRole("button", { name: "确认入库", exact: true }).waitFor({ state: "visible", timeout: 45000 });
    },
    { domain: "warehouse", action: "get_inbound_lines" },
    timingHooksInstalled,
  );

  modal = visibleModal(page, "按实数入库");
  await measure(
    results,
    page,
    "仓库中心 / 按实数入库确认",
    async () => modal.getByRole("button", { name: "确认入库", exact: true }).click(),
    async () => {
      await modal.waitFor({ state: "hidden", timeout: 45000 });
      await waitWarehouseBatchByPoIdState(page, partialPoId, "(row) => row.qcStatus === 'passed' && Number(row.availableQty || 0) > 0", "partial inventory batch available");
    },
    { domain: "warehouse", action: "confirm_count" },
    timingHooksInstalled,
  );

  return results;
}

async function main() {
  if (!fs.existsSync(distIndex)) {
    throw new Error(`dist index missing: ${distIndex}. Run npm run build first.`);
  }

  const workerPort = await findAvailablePort();
  const env = createIsolatedEnv(workerPort);
  let electronApp;
  let page;
  let success = false;
  try {
    electronApp = await electron.launch({
      executablePath: electronBinary,
      args: ["."],
      cwd: repoRoot,
      env,
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await waitForElectronBridgeReady(page);
    await seedBaseData(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForElectronBridgeReady(page);
    const timingHooksInstalled = await installTimingHooks(page);
    if (!timingHooksInstalled) {
      console.log("[info] Electron bridge is read-only; reporting click-to-state timings without internal action hooks.");
    }
    await page.locator(".ant-layout-sider").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".app-layout-header").waitFor({ state: "visible", timeout: 30000 });

    const results = await runMeasurements(page, timingHooksInstalled);
    console.log("");
    console.log("Purchase button timing results:");
    console.table(results.map((row) => ({
      button: row.label,
      uiMs: row.uiMs,
      actionMs: row.actionMs ?? "",
      workbenchMs: row.workbenchMs ?? "",
      actions: row.actions,
      workbenches: row.workbenches,
    })));
    success = true;
  } catch (error) {
    if (page) {
      const screenshotPath = path.join(tmpRoot, "purchase-button-timing-failure.png");
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.error(`Failure screenshot: ${screenshotPath}`);
      } catch {}
    }
    console.error(`Failure artifacts directory: ${tmpRoot}`);
    throw error;
  } finally {
    try {
      await electronApp?.close();
    } catch {}
    if (success) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error("");
  console.error(`Purchase button timing failed: ${error.message}`);
  process.exit(1);
});
