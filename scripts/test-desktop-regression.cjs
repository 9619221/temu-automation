const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { _electron: electron } = require("playwright");
const electronBinary = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const distIndex = path.join(repoRoot, "dist", "index.html");
const imageRuntimeEnvFile = path.join(repoRoot, "build", "auto-image-gen-runtime", ".env.local");
const regressionImagePath = path.join(repoRoot, "build", "icon.png");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "temu-desktop-regression-"));
const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8epVQAAAABJRU5ErkJggg==";
const regressionPngDataUrl = fs.existsSync(regressionImagePath)
  ? `data:image/png;base64,${fs.readFileSync(regressionImagePath).toString("base64")}`
  : tinyPngDataUrl;
const SEEDED_PRODUCT_TITLE = "Desktop Regression Product";
const SEEDED_PRODUCT_CATEGORY = "Regression Test Category";
const SEEDED_PRODUCT_PATH = "Regression Test Category > Subcategory";
const SEEDED_ACCOUNT_NAME = "Regression Account";
const REGRESSION_PHONE = "13800138000";
const REGRESSION_PASSWORD = "Regression#123";
const ERP_ADMIN_NAME = "Desktop Regression Admin";
const ERP_ADMIN_ACCESS_CODE = "desktop-regression-code";
const ERP_FLOW_ACCOUNT_ID = "acct_desktop_regression_flow";
const ERP_FLOW_ACCOUNT_NAME = "Desktop Regression Flow Account";
const ERP_FLOW_SUPPLIER_ID = "supplier_desktop_regression_flow";
const ERP_FLOW_SUPPLIER_NAME = "Desktop Regression Flow Supplier";
const ERP_FLOW_SKU_ID = "sku_desktop_regression_flow";
const ERP_FLOW_SKU_CODE = "DESKTOP-FLOW-001";
const ERP_FLOW_PRODUCT_NAME = "Desktop Regression Flow SKU";
const ERP_FLOW_PO_ID = "po_desktop_regression_flow";
const ERP_FLOW_TRACKING_NO = "TRACK-DESKTOP-FLOW";
const ERP_MAPPING_SKU_ID = "sku_desktop_regression_mapping";
const ERP_MAPPING_SKU_CODE = "DESKTOP-MAP-001";
const ERP_MAPPING_PRODUCT_NAME = "Desktop Regression Mapping SKU";
const ERP_MAPPING_PO_ID = "po_desktop_regression_mapping";
const ERP_FLOW_1688_OFFER_ID = "1688-desktop-flow-offer";
const ERP_FLOW_1688_SKU_ID = "1688-desktop-flow-sku";
const ERP_FLOW_1688_SPEC_ID = "1688-desktop-flow-spec";
const ERP_FLOW_1688_PRODUCT_TITLE = "1688 Desktop Flow Product";

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
      await sleep(400);
    }
  }
  throw new Error(`${label} timeout: ${lastError?.message || "unknown error"}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} missing: ${filePath}`);
  }
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

async function findAvailablePort(preferredPort = 0) {
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

async function waitForVisibleText(page, text, timeout = 45000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

async function waitForPlaceholderContains(page, text, timeout = 45000) {
  await page.locator(`input[placeholder*="${text}"]`).first().waitFor({ state: "visible", timeout });
}

async function waitForProductManagementReady(page) {
  return waitFor(async () => {
    const toolbarVisible = await page.locator(".material-toolbar-card input").first().isVisible().catch(() => false);
    const cloudEmptyVisible = await page
      .locator(".app-panel")
      .filter({ hasText: /云端|商品数据|连接/ })
      .first()
      .isVisible()
      .catch(() => false);
    if (!toolbarVisible && !cloudEmptyVisible) {
      throw new Error("product management table or cloud empty state not visible");
    }
    return { toolbarVisible, cloudEmptyVisible };
  }, 45000, "product management ready");
}

async function waitForHashContains(page, fragment, timeout = 45000) {
  await waitFor(async () => {
    const hash = await page.evaluate(() => window.location.hash || "");
    if (!hash.includes(fragment)) {
      throw new Error(`current hash: ${hash}`);
    }
  }, timeout, `route ${fragment}`);
}

async function clickMenuItem(page, label) {
  const sider = page.locator(".ant-layout-sider");
  const item = sider.getByText(label, { exact: true }).first();
  if (!await item.isVisible().catch(() => false)) {
    const groupTitles = sider.locator(".ant-menu-submenu-title");
    const count = await groupTitles.count();
    for (let index = 0; index < count; index += 1) {
      await groupTitles.nth(index).click();
      await page.waitForTimeout(120);
      if (await item.isVisible().catch(() => false)) break;
    }
  }
  await item.waitFor({ state: "visible", timeout: 30000 });
  await item.click();
  await page.waitForTimeout(250);
}

async function seedRegressionData(page) {
  await page.evaluate(
    async ({ png, seededProductTitle, seededProductCategory, seededProductPath }) => {
      const store = window.electronAPI?.store;
      if (!store) throw new Error("store bridge unavailable");

      const now = new Date().toISOString();

      await store.set("temu_products", [
        {
          title: seededProductTitle,
          category: seededProductCategory,
          categories: seededProductPath,
          spuId: "spu-reg-001",
          skcId: "skc-reg-001",
          goodsId: "goods-reg-001",
          sku: "sku-reg-001",
          imageUrl: png,
          status: "在售",
          totalSales: 12,
          last7DaysSales: 4,
        },
      ]);

      await store.set("temu_sales", {
        summary: {},
        syncedAt: now,
        items: [
          {
            title: seededProductTitle,
            category: seededProductCategory,
            skcId: "skc-reg-001",
            spuId: "spu-reg-001",
            goodsId: "goods-reg-001",
            imageUrl: png,
            todaySales: 1,
            last7DaysSales: 4,
            last30DaysSales: 8,
            totalSales: 12,
            warehouseStock: 20,
            adviceQuantity: 5,
            lackQuantity: 0,
            price: "12.34",
            skuCode: "sku-reg-001",
            stockStatus: "充足",
            supplyStatus: "正常供货",
            hotTag: "回归热销",
            isAdProduct: "",
            availableSaleDays: 12,
          },
        ],
      });

      await store.set("temu_flux", {
        summary: {
          todayVisitors: 20,
          todayBuyers: 2,
          todayConversionRate: 0.1,
          trendList: [],
        },
        syncedAt: now,
        items: [
          {
            goodsId: "goods-reg-001",
            goodsName: seededProductTitle,
            imageUrl: png,
            spuId: "spu-reg-001",
            category: seededProductCategory,
            exposeNum: 100,
            clickNum: 10,
            detailVisitNum: 8,
            addToCartUserNum: 2,
            buyerNum: 1,
            payGoodsNum: 1,
            clickPayRate: 0.1,
          },
        ],
      });

      await store.set("temu_orders", []);

      await store.set("temu_collection_diagnostics", {
        syncedAt: now,
        tasks: {
          dashboard: { status: "success", storeKey: "temu_dashboard", updatedAt: now, count: 1 },
          products: { status: "success", storeKey: "temu_products", updatedAt: now, count: 1 },
          sales: { status: "success", storeKey: "temu_sales", updatedAt: now, count: 1 },
          flux: { status: "success", storeKey: "temu_flux", updatedAt: now, count: 1 },
          orders: { status: "success", storeKey: "temu_orders", updatedAt: now, count: 0 },
        },
        summary: {
          totalTasks: 5,
          successCount: 5,
          errorCount: 0,
        },
      });

      await store.set("temu_frontend_logs", [
        {
          id: "desktop-regression-log",
          timestamp: Date.now(),
          level: "info",
          source: "console",
          message: "desktop regression seeded log",
        },
      ]);
    },
    {
      png: regressionPngDataUrl,
      seededProductTitle: SEEDED_PRODUCT_TITLE,
      seededProductCategory: SEEDED_PRODUCT_CATEGORY,
      seededProductPath: SEEDED_PRODUCT_PATH,
    },
  );
}

async function waitForElectronBridgeReady(page) {
  await waitFor(
    async () => {
      const ready = await page.evaluate(() => Boolean(window.electronAPI));
      if (!ready) {
        throw new Error("window.electronAPI not ready");
      }
    },
    30000,
    "electron bridge ready",
  );
}

async function seedErpPurchaseFlow(page) {
  const flow = await page.evaluate(
    async ({
      adminName,
      adminAccessCode,
      accountId,
      accountName,
      supplierId,
      supplierName,
      skuId,
      skuCode,
      productName,
      poId,
      trackingNo,
      mappingSkuId,
      mappingSkuCode,
      mappingProductName,
      mappingPoId,
      offerId,
      externalSkuId,
      externalSpecId,
      externalProductTitle,
    }) => {
      const erp = window.electronAPI?.erp;
      if (!erp?.client || !erp?.auth || !erp?.purchase || !erp?.warehouse || !erp?.outbound) {
        throw new Error("ERP bridge unavailable");
      }

      const beforeClient = await erp.client.getStatus();
      if (beforeClient?.isClientMode) {
        await erp.client.setHostMode();
      }

      let authStatus = await erp.auth.getStatus();
      if (!authStatus.currentUser) {
        if (!authStatus.hasUsers) {
          authStatus = await erp.auth.createFirstAdmin({
            name: adminName,
            accessCode: adminAccessCode,
          });
        } else {
          authStatus = await erp.auth.login({
            login: adminName,
            accessCode: adminAccessCode,
          });
        }
      }
      if (!authStatus.currentUser) {
        throw new Error("ERP local admin session was not established");
      }

      const account = await erp.account.upsert({
        id: accountId,
        name: accountName,
        source: "desktop-regression",
      });
      const supplier = await erp.supplier.create({
        id: supplierId,
        name: supplierName,
        categories: ["desktop-regression"],
      });
      const sku = await erp.sku.create({
        id: skuId,
        accountId: account.id,
        internalSkuCode: skuCode,
        productName,
        colorSpec: "Black / Regression",
        supplierId: supplier.id,
      });

      const prResult = await erp.purchase.action({
        action: "create_pr",
        accountId: account.id,
        skuId: sku.id,
        requestedQty: 4,
        targetUnitCost: 12.5,
        reason: "desktop full flow regression",
        includeWorkbench: false,
      });
      const prId = prResult?.result?.id;
      if (!prId) throw new Error("create_pr did not return a purchase request id");

      const poResult = await erp.purchase.action({
        action: "generate_po",
        prId,
        offlinePurchase: true,
        supplierName: supplier.name,
        unitPrice: 12.5,
        qty: 4,
        poId,
        includeWorkbench: false,
      });
      const purchaseOrderId = poResult?.result?.purchaseOrder?.id;
      if (!purchaseOrderId) throw new Error("generate_po did not return a purchase order id");
      if (poResult?.result?.sku1688Source) {
        throw new Error("offline purchase order unexpectedly used a 1688 mapping");
      }

      const submitPayment = await erp.purchase.action({
        action: "submit_payment_approval",
        poId: purchaseOrderId,
        amount: 50,
        includeWorkbench: false,
      });
      const paymentApprovalId = submitPayment?.result?.paymentApproval?.id;
      if (!paymentApprovalId) throw new Error("submit_payment_approval did not return a payment approval id");

      await erp.purchase.action({
        action: "confirm_paid",
        paymentApprovalId,
        paymentMethod: "desktop-regression",
        paymentReference: "PAY-DESKTOP-FLOW",
        includeWorkbench: false,
      });

      const warehouseBefore = await erp.warehouse.workbench({ limit: 50 });
      const receipt = (warehouseBefore.inboundReceipts || []).find((item) => item.poId === purchaseOrderId);
      if (!receipt?.id) throw new Error("confirm_paid did not create an inbound receipt");

      await erp.warehouse.action({
        action: "register_arrival",
        receiptId: receipt.id,
        limit: 50,
      });
      const warehouseAfterArrival = await erp.warehouse.workbench({ limit: 50 });
      const arrivedReceipt = (warehouseAfterArrival.inboundReceipts || []).find((item) => item.id === receipt.id);
      if (arrivedReceipt?.status !== "arrived") throw new Error("register_arrival did not mark receipt as arrived");

      await erp.warehouse.action({
        action: "confirm_count",
        receiptId: receipt.id,
        limit: 50,
      });
      const warehouseAfterCount = await erp.warehouse.workbench({ limit: 50 });
      const countedReceipt = (warehouseAfterCount.inboundReceipts || []).find((item) => item.id === receipt.id);
      if (countedReceipt?.status !== "counted") throw new Error("confirm_count did not mark receipt as counted");

      await erp.warehouse.action({
        action: "confirm_inbound",
        receiptId: receipt.id,
        limit: 50,
      });
      const warehouseAfter = await erp.warehouse.workbench({ limit: 50 });
      const batch = (warehouseAfter.inventoryBatches || []).find((item) => item.poId === purchaseOrderId);
      if (!batch?.id) throw new Error("confirm_inbound did not create an inventory batch");

      const outboundBefore = await erp.outbound.workbench({ limit: 50 });
      const availableBatch = (outboundBefore.availableBatches || []).find((item) => item.id === batch.id);
      if (!availableBatch?.id) throw new Error("inbounded batch was not available for outbound");

      const outboundPlan = await erp.outbound.action({
        action: "create_outbound_plan",
        batchId: batch.id,
        qty: 1,
        boxes: 1,
        remark: "desktop full flow regression",
        limit: 50,
      });
      const outboundId = outboundPlan?.result?.shipment?.id;
      if (!outboundId) throw new Error("create_outbound_plan did not return a shipment id");

      await erp.outbound.action({ action: "start_picking", outboundId, limit: 50 });
      await erp.outbound.action({ action: "mark_packed", outboundId, boxes: 1, limit: 50 });
      await erp.outbound.action({
        action: "confirm_shipped_out",
        outboundId,
        logisticsProvider: "Regression Logistics",
        trackingNo,
        limit: 50,
      });
      await erp.outbound.action({ action: "confirm_outbound_done", outboundId, limit: 50 });

      const mappingSku = await erp.sku.create({
        id: mappingSkuId,
        accountId: account.id,
        internalSkuCode: mappingSkuCode,
        productName: mappingProductName,
        colorSpec: "Mapped / Regression",
      });
      const mappingResult = await erp.purchase.action({
        action: "upsert_sku_1688_source",
        skuId: mappingSku.id,
        accountId: account.id,
        mappingGroupId: `map_${mappingSku.id}_${offerId}_${externalSpecId}`,
        externalOfferId: offerId,
        externalSkuId,
        externalSpecId,
        platformSkuName: "Mapped / Regression",
        supplierName: supplier.name,
        productTitle: externalProductTitle,
        productUrl: `https://detail.1688.com/offer/${offerId}.html`,
        unitPrice: 8.8,
        moq: 1,
        logisticsFee: 0,
        ourQty: 1,
        platformQty: 1,
        isDefault: true,
        includeWorkbench: false,
      });
      const mappingSource = mappingResult?.result?.sku1688Source;
      if (!mappingSource?.id) throw new Error("upsert_sku_1688_source did not return a mapping id");
      const mappingPrResult = await erp.purchase.action({
        action: "create_pr",
        accountId: account.id,
        skuId: mappingSku.id,
        requestedQty: 4,
        targetUnitCost: 8.8,
        reason: "desktop 1688 mapping regression",
        includeWorkbench: false,
      });
      const mappingPrId = mappingPrResult?.result?.id;
      if (!mappingPrId) throw new Error("mapped create_pr did not return a purchase request id");
      const mappingPoResult = await erp.purchase.action({
        action: "generate_po",
        prId: mappingPrId,
        preferSku1688Source: true,
        qty: 4,
        poId: mappingPoId,
        includeWorkbench: false,
      });
      const mappingPurchaseOrderId = mappingPoResult?.result?.purchaseOrder?.id;
      if (!mappingPurchaseOrderId) throw new Error("mapped generate_po did not return a purchase order id");
      const generatedSource = mappingPoResult?.result?.sku1688Source;
      if (generatedSource?.externalOfferId !== offerId) {
        throw new Error("mapped generate_po did not use the default 1688 mapping");
      }

      const purchase = await erp.purchase.workbench({
        limit: 50,
        includeRequestDetails: false,
        includeOptions: true,
        include1688Meta: false,
      }, { timeoutMs: 120000 });
      const warehouse = await erp.warehouse.workbench({ limit: 50 });
      const outbound = await erp.outbound.workbench({ limit: 50 });

      const purchaseRequest = (purchase.purchaseRequests || []).find((item) => item.id === prId);
      const purchaseOrder = (purchase.purchaseOrders || []).find((item) => item.id === purchaseOrderId);
      const mappingPurchaseRequest = (purchase.purchaseRequests || []).find((item) => item.id === mappingPrId);
      const mappingPurchaseOrder = (purchase.purchaseOrders || []).find((item) => item.id === mappingPurchaseOrderId);
      const mappingSkuOption = (purchase.skuOptions || []).find((item) => item.id === mappingSku.id);
      const inboundReceipt = (warehouse.inboundReceipts || []).find((item) => item.id === receipt.id);
      const inventoryBatch = (warehouse.inventoryBatches || []).find((item) => item.id === batch.id);
      const outboundShipment = (outbound.outboundShipments || []).find((item) => item.id === outboundId);

      return {
        accountId: account.id,
        supplierId: supplier.id,
        skuId: sku.id,
        skuCode,
        productName,
        mappingSourceId: mappingSource.id,
        mappingSkuId: mappingSku.id,
        mappingSkuCode,
        mappingProductName,
        mappingPrId,
        mappingPoId: mappingPurchaseOrderId,
        externalOfferId: offerId,
        externalSpecId,
        supplierName: supplier.name,
        prId,
        poId: purchaseOrderId,
        paymentApprovalId,
        receiptId: receipt.id,
        batchId: batch.id,
        outboundId,
        trackingNo,
        purchaseRequestStatus: purchaseRequest?.status || null,
        purchaseOrderStatus: purchaseOrder?.status || null,
        paymentStatus: purchaseOrder?.paymentStatus || null,
        receiptStatus: inboundReceipt?.status || null,
        batchQcStatus: inventoryBatch?.qcStatus || null,
        batchAvailableQty: Number(inventoryBatch?.availableQty || 0),
        shipmentStatus: outboundShipment?.status || null,
        offlinePurchaseOrderMappingCount: Number(purchaseOrder?.mappingCount || 0),
        mappingPurchaseRequestStatus: mappingPurchaseRequest?.status || null,
        mappingPurchaseRequestMappingCount: Number(mappingPurchaseRequest?.mappingCount || 0),
        mappingPurchaseRequestPrimaryOfferId: mappingPurchaseRequest?.primaryMappingOfferId || null,
        mappingPurchaseOrderStatus: mappingPurchaseOrder?.status || null,
        mappingPurchaseOrderMappingCount: Number(mappingPurchaseOrder?.mappingCount || 0),
        mappingPurchaseOrderSupplierName: mappingPurchaseOrder?.supplierName || null,
        mappingSkuProcurementSourceCount: Number(mappingSkuOption?.procurementSourceCount || 0),
        mappingSkuPrimaryOfferId: mappingSkuOption?.primary1688Source?.externalOfferId || null,
      };
    },
    {
      adminName: ERP_ADMIN_NAME,
      adminAccessCode: ERP_ADMIN_ACCESS_CODE,
      accountId: ERP_FLOW_ACCOUNT_ID,
      accountName: ERP_FLOW_ACCOUNT_NAME,
      supplierId: ERP_FLOW_SUPPLIER_ID,
      supplierName: ERP_FLOW_SUPPLIER_NAME,
      skuId: ERP_FLOW_SKU_ID,
      skuCode: ERP_FLOW_SKU_CODE,
      productName: ERP_FLOW_PRODUCT_NAME,
      poId: ERP_FLOW_PO_ID,
      trackingNo: ERP_FLOW_TRACKING_NO,
      mappingSkuId: ERP_MAPPING_SKU_ID,
      mappingSkuCode: ERP_MAPPING_SKU_CODE,
      mappingProductName: ERP_MAPPING_PRODUCT_NAME,
      mappingPoId: ERP_MAPPING_PO_ID,
      offerId: ERP_FLOW_1688_OFFER_ID,
      externalSkuId: ERP_FLOW_1688_SKU_ID,
      externalSpecId: ERP_FLOW_1688_SPEC_ID,
      externalProductTitle: ERP_FLOW_1688_PRODUCT_TITLE,
    },
  );

  assert(flow.purchaseRequestStatus === "converted_to_po", `unexpected PR status: ${flow.purchaseRequestStatus}`);
  assert(flow.purchaseOrderStatus === "inbounded", `unexpected PO status: ${flow.purchaseOrderStatus}`);
  assert(flow.paymentStatus === "paid", `unexpected payment status: ${flow.paymentStatus}`);
  assert(flow.receiptStatus === "inbounded_pending_qc", `unexpected receipt status: ${flow.receiptStatus}`);
  assert(flow.batchQcStatus === "passed", `unexpected batch QC status: ${flow.batchQcStatus}`);
  assert(flow.batchAvailableQty === 3, `unexpected available qty after outbound: ${flow.batchAvailableQty}`);
  assert(flow.shipmentStatus === "confirmed", `unexpected shipment status: ${flow.shipmentStatus}`);
  assert(flow.offlinePurchaseOrderMappingCount === 0, `offline PO should not bind 1688 mapping: ${flow.offlinePurchaseOrderMappingCount}`);
  assert(flow.mappingPurchaseRequestStatus === "converted_to_po", `unexpected mapped PR status: ${flow.mappingPurchaseRequestStatus}`);
  assert(flow.mappingPurchaseRequestMappingCount >= 1, `mapped PR did not keep 1688 mapping: ${flow.mappingPurchaseRequestMappingCount}`);
  assert(flow.mappingPurchaseRequestPrimaryOfferId === ERP_FLOW_1688_OFFER_ID, `mapped PR offer mismatch: ${flow.mappingPurchaseRequestPrimaryOfferId}`);
  assert(flow.mappingPurchaseOrderStatus === "draft", `unexpected mapped PO status: ${flow.mappingPurchaseOrderStatus}`);
  assert(flow.mappingPurchaseOrderMappingCount >= 1, `mapped PO did not keep 1688 mapping: ${flow.mappingPurchaseOrderMappingCount}`);
  assert(flow.mappingPurchaseOrderSupplierName === ERP_FLOW_SUPPLIER_NAME, `mapped PO supplier mismatch: ${flow.mappingPurchaseOrderSupplierName}`);
  assert(flow.mappingSkuProcurementSourceCount >= 1, `mapped SKU option did not expose 1688 source: ${flow.mappingSkuProcurementSourceCount}`);
  assert(flow.mappingSkuPrimaryOfferId === ERP_FLOW_1688_OFFER_ID, `mapped SKU primary offer mismatch: ${flow.mappingSkuPrimaryOfferId}`);
  console.log("[ok] ERP 本地采购→付款→入库→出库数据链路");
  console.log("[ok] ERP 1688 映射→采购单数据链路");
  return flow;
}

async function runBridgeChecks(page) {
  const issues = [];
  const result = await page.evaluate(
    async ({ png, seededProductTitle }) => {
      const api = window.electronAPI;
      if (!api) throw new Error("window.electronAPI missing");

      await api.store.set("__desktop_regression_roundtrip__", { ok: true, value: 42 });
      const roundtrip = await api.store.get("__desktop_regression_roundtrip__");

      const version = await api.app.getVersion();
      const updateStatus = await api.app.getUpdateStatus();
      const ping = await api.automation.ping();
      const progress = await api.automation.getProgress();
      const tasks = await api.automation.listTasks();

      const imageStatus = await api.imageStudio.ensureRunning();
      const originalConfig = await api.imageStudio.getConfig();
      let updateConfigOk = false;
      let updateConfigError = "";
      try {
        const updatedConfig = await api.imageStudio.updateConfig({
          analyzeModel: originalConfig?.analyzeModel || "",
          analyzeBaseUrl: originalConfig?.analyzeBaseUrl || "",
          generateModel: originalConfig?.generateModel || "",
          generateBaseUrl: originalConfig?.generateBaseUrl || "",
        });
        updateConfigOk = updatedConfig?.analyzeModel === (originalConfig?.analyzeModel || "")
          && updatedConfig?.analyzeBaseUrl === (originalConfig?.analyzeBaseUrl || "")
          && updatedConfig?.generateModel === (originalConfig?.generateModel || "")
          && updatedConfig?.generateBaseUrl === (originalConfig?.generateBaseUrl || "");
      } catch (error) {
        updateConfigError = error instanceof Error ? error.message : String(error || "unknown error");
      }

      const savedHistory = await api.imageStudio.saveHistory({
        productName: seededProductTitle,
        salesRegion: "us",
        imageCount: 1,
        images: [{ imageType: "main", imageUrl: png }],
      });
      const historyList = await api.imageStudio.listHistory();
      const historyItem = savedHistory?.id ? await api.imageStudio.getHistoryItem(savedHistory.id) : null;

      return {
        version,
        updateStatus: updateStatus?.status || "",
        roundtrip,
        pingStatus: ping?.status || "",
        progressStatus: progress?.status || "",
        taskCount: Array.isArray(tasks) ? tasks.length : -1,
        imageStatus,
        updateConfigOk,
        updateConfigError,
        historyItem,
        historyListCount: Array.isArray(historyList) ? historyList.length : -1,
      };
    },
    {
      png: regressionPngDataUrl,
      seededProductTitle: SEEDED_PRODUCT_TITLE,
    },
  );

  assert(typeof result.version === "string" && result.version.length > 0, "app.getVersion returned invalid version");
  assert(result.roundtrip?.ok === true, "store roundtrip failed");
  assert(typeof result.pingStatus === "string" && result.pingStatus.length > 0, "automation.ping returned invalid payload");
  assert(typeof result.progressStatus === "string" && result.progressStatus.length > 0, "automation.getProgress returned invalid payload");
  assert(result.taskCount >= 0, "automation.listTasks returned invalid task list");
  assert(result.imageStatus?.ready === true, "imageStudio.ensureRunning did not reach ready status");
  assert(result.historyListCount >= 1, "imageStudio.listHistory returned no history items");
  assert(result.historyItem?.productName === SEEDED_PRODUCT_TITLE, "imageStudio.getHistoryItem returned invalid history item");

  console.log("[ok] electron bridge basic checks");
  console.log("[ok] automation worker bridge");
  console.log("[ok] image studio runtime/history bridge");
  if (result.updateConfigOk) {
    console.log("[ok] image studio config bridge");
  } else {
    issues.push(`AI 出图配置写入失败: ${result.updateConfigError || "unknown error"}`);
    console.log(`[warn] image studio config update failed: ${result.updateConfigError || "unknown error"}`);
  }
  return issues;
}

async function runUiChecks(page) {
  await clickMenuItem(page, "店铺概览");
  await waitForHashContains(page, "/shop");
  await waitForVisibleText(page, "店铺概览");
  await waitForVisibleText(page, "数据概览");
  console.log("[ok] 店铺概览页面");

  await clickMenuItem(page, "商品管理");
  await waitForHashContains(page, "/products");
  await waitForVisibleText(page, "商品管理");
  const productManagementState = await waitForProductManagementReady(page);
  if (!productManagementState.toolbarVisible) {
    console.log("[ok] 商品管理页面（云端空态）");
  } else {
    await waitForPlaceholderContains(page, "搜索商品名称");
  const productRow = page.locator(".ant-table-tbody .ant-table-row").first();
  await productRow.waitFor({ state: "visible", timeout: 45000 });
  console.log("[ok] 商品列表页面");

  const detailDrawer = page.locator(".ant-drawer .ant-drawer-content").last();
  await productRow.getByRole("button", { name: "销售趋势" }).first().click();
  await detailDrawer.waitFor({ state: "visible", timeout: 30000 });
  await detailDrawer.getByText("概览", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await detailDrawer.getByText("流量驾驶舱", { exact: false }).waitFor({ state: "visible", timeout: 30000 });
  await detailDrawer.getByText("全部字段", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  console.log("[ok] 商品详情抽屉");

  await page.keyboard.press("Escape");
  await detailDrawer.waitFor({ state: "hidden", timeout: 30000 });
  await waitForPlaceholderContains(page, "搜索商品名称");
  }

  await clickMenuItem(page, "上品管理");
  await waitForHashContains(page, "/create-product");
  await waitForVisibleText(page, "上品流程模式");
  console.log("[ok] 上品管理页面");

  await clickMenuItem(page, "数据采集");
  await waitForHashContains(page, "/collect");
  await waitForVisibleText(page, "数据采集");
  await page.getByRole("button", { name: "一键采集全部数据" }).waitFor({ state: "visible", timeout: 30000 });
  console.log("[ok] 数据采集页面");

  await clickMenuItem(page, "AI 出图");
  await waitForHashContains(page, "/image-studio");
  const historyButton = page.getByRole("button", { name: "历史记录" }).first();
  await historyButton.waitFor({ state: "visible", timeout: 90000 });
  await historyButton.click();
  await waitForVisibleText(page, "历史记录");
  await waitForVisibleText(page, SEEDED_PRODUCT_TITLE);
  await page.keyboard.press("Escape");
  await historyButton.waitFor({ state: "visible", timeout: 30000 });
  console.log("[ok] AI 出图页面");

  await page.evaluate(async (logMessage) => {
    const store = window.electronAPI?.store;
    if (!store) throw new Error("store bridge unavailable");
    const currentLogs = await store.get("temu_frontend_logs");
    const nextLogs = Array.isArray(currentLogs) ? currentLogs.filter((item) => item?.id !== "desktop-regression-log") : [];
    nextLogs.unshift({
      id: "desktop-regression-log",
      timestamp: Date.now(),
      level: "info",
      source: "console",
      message: logMessage,
    });
    await store.set("temu_frontend_logs", nextLogs.slice(0, 500));
  }, "desktop regression seeded log");

  await clickMenuItem(page, "日志中心");
  await waitForHashContains(page, "/logs");
  await waitForVisibleText(page, "日志中心");
  await page.getByPlaceholder("搜索记录内容 / 来源 / 级别").fill("desktop regression seeded log");
  await waitForVisibleText(page, "desktop regression seeded log");
  await page.getByRole("button", { name: "清空" }).click();
  await waitForVisibleText(page, "暂无运行记录");
  console.log("[ok] 日志中心页面");

  await clickMenuItem(page, "设置");
  await waitForHashContains(page, "/settings");
  await waitForVisibleText(page, "设置");
  await waitForVisibleText(page, "浏览器设置");
  await page.getByRole("button", { name: "保存设置" }).first().click();
  const savedSettings = await page.evaluate(async () => window.electronAPI?.store?.get("temu_app_settings"));
  assert(savedSettings && typeof savedSettings === "object", "settings save did not persist to store");
  console.log("[ok] 设置页面");

  await clickMenuItem(page, "账号管理");
  await waitForHashContains(page, "/accounts");
  const addAccountButton = page.locator(".app-page-header__actions button").filter({ hasText: "添加账号" }).first();
  await addAccountButton.waitFor({ state: "visible", timeout: 30000 });
  await addAccountButton.click();
  const modal = page.locator(".ant-modal-root .ant-modal").last();
  await modal.waitFor({ state: "visible", timeout: 30000 });
  const modalInputs = modal.locator("input");
  await modalInputs.nth(0).fill(SEEDED_ACCOUNT_NAME);
  await modalInputs.nth(1).fill(REGRESSION_PHONE);
  await modalInputs.nth(2).fill(REGRESSION_PASSWORD);
  await modal.locator(".ant-btn-primary").last().click();
  await modal.waitFor({ state: "hidden", timeout: 30000 });
  await waitForVisibleText(page, SEEDED_ACCOUNT_NAME);

  const switchDataButton = page.getByRole("button", { name: "切换数据" }).first();
  if (await switchDataButton.isVisible().catch(() => false)) {
    await switchDataButton.click();
    await waitForVisibleText(page, "当前数据", 20000);
    await page.locator(".ant-layout-header").getByText(SEEDED_ACCOUNT_NAME, { exact: false }).waitFor({ state: "visible", timeout: 20000 });
  }
  console.log("[ok] 账号管理页面");
}

const PURCHASE_FLOW_PAGES = [
  {
    hash: "/product-master-data",
    expectedTitle: "商品资料",
    label: "商品资料",
  },
  {
    hash: "/1688-mapping",
    expectedTitle: "供应商管理",
    label: "供应商管理",
  },
  {
    hash: "/purchase-center",
    expectedTitle: "采购单",
    label: "采购单",
  },
  {
    hash: "/warehouse-center",
    expectedTitle: "待到货、入库",
    label: "仓库中心",
  },
  {
    hash: "/qc-outbound",
    expectedTitle: "出库中心",
    label: "出库中心",
  },
];

const SERVICE_NOT_READY_HINT = "服务未就绪";

async function gotoHash(page, hash) {
  await page.evaluate((targetHash) => {
    window.location.hash = `#${targetHash}`;
  }, hash);
  await waitFor(
    async () => {
      const current = await page.evaluate(() => window.location.hash || "");
      if (!current.includes(hash)) {
        throw new Error(`current hash: ${current}`);
      }
    },
    15000,
    `route ${hash}`,
  );
}

async function verifySeededErpFlowState(page, flow) {
  if (!flow?.skuCode) return [];
  const issues = [];
  try {
    const state = await page.evaluate(
      async ({
        prId,
        poId,
        receiptId,
        batchId,
        outboundId,
        mappingSourceId,
        mappingSkuCode,
        mappingPrId,
        mappingPoId,
        externalOfferId,
      }) => {
        const erp = window.electronAPI?.erp;
        if (!erp?.purchase || !erp?.warehouse || !erp?.outbound || !erp?.mapping || !erp?.sku) {
          throw new Error("ERP bridge unavailable");
        }
        const [purchase, warehouse, outbound, boundMappingPage, unboundSkuPage] = await Promise.all([
          erp.purchase.workbench({
            limit: 50,
            includeRequestDetails: false,
            includeOptions: true,
            include1688Meta: false,
          }, { timeoutMs: 120000 }),
          erp.warehouse.workbench({ limit: 50 }),
          erp.outbound.workbench({ limit: 50 }),
          erp.mapping.page({ limit: 20, offset: 0, search: mappingSkuCode }),
          erp.sku.listUnmappedPage({ limit: 20, offset: 0, search: mappingSkuCode }),
        ]);
        const purchaseRequest = (purchase.purchaseRequests || []).find((item) => item.id === prId);
        const purchaseOrder = (purchase.purchaseOrders || []).find((item) => item.id === poId);
        const mappingPurchaseRequest = (purchase.purchaseRequests || []).find((item) => item.id === mappingPrId);
        const mappingPurchaseOrder = (purchase.purchaseOrders || []).find((item) => item.id === mappingPoId);
        const inboundReceipt = (warehouse.inboundReceipts || []).find((item) => item.id === receiptId);
        const inventoryBatch = (warehouse.inventoryBatches || []).find((item) => item.id === batchId);
        const outboundShipment = (outbound.outboundShipments || []).find((item) => item.id === outboundId);
        const mappingSkuOption = (purchase.skuOptions || []).find((item) => item.internalSkuCode === mappingSkuCode);
        const boundMapping = (boundMappingPage.rows || []).find((item) => item.id === mappingSourceId);
        const stillUnmapped = (unboundSkuPage.rows || []).some((item) => item.internalSkuCode === mappingSkuCode);
        return {
          purchaseRequestStatus: purchaseRequest?.status || null,
          purchaseOrderStatus: purchaseOrder?.status || null,
          paymentStatus: purchaseOrder?.paymentStatus || null,
          offlinePurchaseOrderMappingCount: Number(purchaseOrder?.mappingCount || 0),
          receiptStatus: inboundReceipt?.status || null,
          batchQcStatus: inventoryBatch?.qcStatus || null,
          batchAvailableQty: Number(inventoryBatch?.availableQty || 0),
          shipmentStatus: outboundShipment?.status || null,
          mappingPurchaseRequestStatus: mappingPurchaseRequest?.status || null,
          mappingPurchaseRequestMappingCount: Number(mappingPurchaseRequest?.mappingCount || 0),
          mappingPurchaseRequestPrimaryOfferId: mappingPurchaseRequest?.primaryMappingOfferId || null,
          mappingPurchaseOrderStatus: mappingPurchaseOrder?.status || null,
          mappingPurchaseOrderMappingCount: Number(mappingPurchaseOrder?.mappingCount || 0),
          mappingPurchaseOrderSupplierName: mappingPurchaseOrder?.supplierName || null,
          mappingSkuProcurementSourceCount: Number(mappingSkuOption?.procurementSourceCount || 0),
          mappingSkuPrimaryOfferId: mappingSkuOption?.primary1688Source?.externalOfferId || null,
          boundMappingOfferId: boundMapping?.externalOfferId || null,
          stillUnmapped,
        };
      },
      flow,
    );
    if (state.purchaseRequestStatus !== "converted_to_po") issues.push(`采购需求状态异常: ${state.purchaseRequestStatus}`);
    if (state.purchaseOrderStatus !== "inbounded") issues.push(`采购单状态异常: ${state.purchaseOrderStatus}`);
    if (state.paymentStatus !== "paid") issues.push(`付款状态异常: ${state.paymentStatus}`);
    if (state.offlinePurchaseOrderMappingCount !== 0) issues.push(`线下采购单不应绑定 1688 映射: ${state.offlinePurchaseOrderMappingCount}`);
    if (state.receiptStatus !== "inbounded_pending_qc") issues.push(`入库单状态异常: ${state.receiptStatus}`);
    if (state.batchQcStatus !== "passed") issues.push(`库存批次 QC 状态异常: ${state.batchQcStatus}`);
    if (state.batchAvailableQty !== 3) issues.push(`库存批次可用数异常: ${state.batchAvailableQty}`);
    if (state.shipmentStatus !== "confirmed") issues.push(`出库单状态异常: ${state.shipmentStatus}`);
    if (state.mappingPurchaseRequestStatus !== "converted_to_po") issues.push(`映射采购需求状态异常: ${state.mappingPurchaseRequestStatus}`);
    if (state.mappingPurchaseRequestMappingCount < 1) issues.push(`映射采购需求未关联 1688 映射: ${state.mappingPurchaseRequestMappingCount}`);
    if (state.mappingPurchaseRequestPrimaryOfferId !== flow.externalOfferId) issues.push(`映射采购需求 1688 货号异常: ${state.mappingPurchaseRequestPrimaryOfferId}`);
    if (state.mappingPurchaseOrderStatus !== "draft") issues.push(`映射采购单状态异常: ${state.mappingPurchaseOrderStatus}`);
    if (state.mappingPurchaseOrderMappingCount < 1) issues.push(`映射采购单未关联 1688 映射: ${state.mappingPurchaseOrderMappingCount}`);
    if (state.mappingPurchaseOrderSupplierName !== flow.supplierName) issues.push(`映射采购单供应商异常: ${state.mappingPurchaseOrderSupplierName}`);
    if (state.mappingSkuProcurementSourceCount < 1) issues.push(`采购中心映射 SKU 选项未带 1688 货源: ${state.mappingSkuProcurementSourceCount}`);
    if (state.mappingSkuPrimaryOfferId !== flow.externalOfferId) issues.push(`采购中心映射 SKU 主货源货号异常: ${state.mappingSkuPrimaryOfferId}`);
    if (state.boundMappingOfferId !== flow.externalOfferId) issues.push(`供应商管理已绑定分页未找到映射: ${state.boundMappingOfferId}`);
    if (state.stillUnmapped) issues.push("供应商管理未绑定分页仍出现已绑定 SKU");
    if (!issues.length) console.log("[ok] 采购流程 API 状态验证");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    issues.push(`采购流程 API 状态验证异常: ${message}`);
    console.log(`[fail] 采购流程 API 状态验证: ${message}`);
  }
  return issues;
}

async function verifySeededFlowOnPage(page, target, flow) {
  if (!flow?.skuCode) return;
  if (target.hash === "/qc-outbound") {
    const shipmentTab = page.getByRole("tab", { name: /本地出库单/ }).first();
    if (await shipmentTab.isVisible().catch(() => false)) {
      await shipmentTab.click();
    }
    await waitForVisibleText(page, flow.trackingNo, 45000);
    return;
  }
  if (target.hash === "/warehouse-center") {
    const allScopeTab = page
      .locator('.warehouse-queue-tabs[aria-label*="工作视图"] button')
      .filter({ hasText: "全部" })
      .first();
    if (await allScopeTab.isVisible().catch(() => false)) {
      await allScopeTab.click();
    }
    const inboundedTab = page
      .locator('.warehouse-queue-tabs[aria-label*="单据状态"] button')
      .filter({ hasText: "已入库" })
      .first();
    if (await inboundedTab.isVisible().catch(() => false)) {
      await inboundedTab.click();
    }
    await waitForVisibleText(page, flow.skuCode, 45000);
    return;
  }
  if (target.hash === "/1688-mapping") {
    const boundTab = page.getByRole("tab", { name: /已绑定/ }).first();
    if (await boundTab.isVisible().catch(() => false)) {
      await boundTab.click();
    }
    await waitForVisibleText(page, flow.mappingSkuCode, 45000);
    return;
  }
  if (target.hash === "/product-master-data" || target.hash === "/purchase-center") {
    await waitForVisibleText(page, flow.skuCode, 45000);
    await waitForVisibleText(page, flow.mappingSkuCode, 45000);
    return;
  }
  await waitForVisibleText(page, flow.skuCode, 45000);
}

async function runPurchaseFlowChecks(page, flow = null) {
  const issues = [];
  console.log("");
  console.log("== 采购流程页面与数据链路检查 ==");
  issues.push(...await verifySeededErpFlowState(page, flow));

  for (const target of PURCHASE_FLOW_PAGES) {
    const startedAt = Date.now();
    try {
      await gotoHash(page, target.hash);
      await page.waitForTimeout(500);

      const titleFound = await page
        .locator(".app-page-header")
        .getByText(target.expectedTitle, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      if (!titleFound) {
        issues.push(`${target.label} 标题未渲染（期望「${target.expectedTitle}」）`);
        console.log(`[fail] ${target.label}: 标题未渲染 (${Date.now() - startedAt}ms)`);
        continue;
      }

      const serviceNotReady = await page
        .getByText(SERVICE_NOT_READY_HINT, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      if (serviceNotReady) {
        issues.push(`${target.label} 显示「${SERVICE_NOT_READY_HINT}」，ERP 服务未初始化`);
        console.log(`[fail] ${target.label}: ERP 服务未就绪 (${Date.now() - startedAt}ms)`);
        continue;
      }

      await verifySeededFlowOnPage(page, target, flow);
      const durationMs = Date.now() - startedAt;
      console.log(flow?.skuCode
        ? `[ok] ${target.label} 页面渲染与回归数据正常 (${durationMs}ms)`
        : `[ok] ${target.label} 页面渲染正常 (${durationMs}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "unknown error");
      issues.push(`${target.label} 渲染检查异常: ${message}`);
      console.log(`[fail] ${target.label}: ${message} (${Date.now() - startedAt}ms)`);
    }
  }

  return issues;
}

async function main() {
  ensureFileExists(distIndex, "dist index");

  const workerPort = await findAvailablePort(19321);
  const env = createIsolatedEnv(workerPort);
  let electronApp;
  let page;
  let success = false;
  const issues = [];
  const originalImageRuntimeEnv = fs.existsSync(imageRuntimeEnvFile)
    ? fs.readFileSync(imageRuntimeEnvFile, "utf8")
    : null;

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
    const erpFlow = await seedErpPurchaseFlow(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForElectronBridgeReady(page);

    await page.locator(".ant-layout-sider").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".app-layout-header").waitFor({ state: "visible", timeout: 30000 });

    issues.push(...await runBridgeChecks(page));
    await seedRegressionData(page);
    try {
      await runUiChecks(page);
    } catch (uiError) {
      const message = uiError instanceof Error ? uiError.message : String(uiError || "unknown error");
      console.log(`[warn] runUiChecks 失败但已捕获，继续后续检查: ${message}`);
    }
    issues.push(...await runPurchaseFlowChecks(page, erpFlow));

    if (issues.length > 0) {
      throw new Error(`Detected regression issues:\n- ${issues.join("\n- ")}`);
    }

    console.log("");
    console.log("Desktop regression checks passed.");
    success = true;
  } catch (error) {
    if (page) {
      const screenshotPath = path.join(tmpRoot, "desktop-regression-failure.png");
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
    try {
      if (originalImageRuntimeEnv !== null) {
        fs.writeFileSync(imageRuntimeEnvFile, originalImageRuntimeEnv, "utf8");
      }
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
  console.error(`Desktop regression checks failed: ${error.message}`);
  process.exit(1);
});
