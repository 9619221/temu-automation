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
  [appDataRoot, localAppDataRoot, tempRoot].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

  return {
    ...process.env,
    NODE_ENV: "production",
    APPDATA: appDataRoot,
    LOCALAPPDATA: localAppDataRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
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

async function waitForHashContains(page, fragment, timeout = 45000) {
  await waitFor(async () => {
    const hash = await page.evaluate(() => window.location.hash || "");
    if (!hash.includes(fragment)) {
      throw new Error(`current hash: ${hash}`);
    }
  }, timeout, `route ${fragment}`);
}

async function clickMenuItem(page, label) {
  const item = page.locator(".ant-layout-sider").getByText(label, { exact: true }).first();
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

  await clickMenuItem(page, "上品管理");
  await waitForHashContains(page, "/create-product");
  await waitForVisibleText(page, "上传商品表格");
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
  await page.getByRole("button", { name: "保存设置" }).click();
  const savedSettings = await page.evaluate(async () => window.electronAPI?.store?.get("temu_app_settings"));
  assert(savedSettings && typeof savedSettings === "object", "settings save did not persist to store");
  console.log("[ok] 设置页面");

  await clickMenuItem(page, "账号管理");
  await waitForHashContains(page, "/accounts");
  const addAccountButton = page.getByRole("button", { name: "添加账号" }).first();
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

    await page.locator(".ant-layout-sider").getByText("店铺概览", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });

    issues.push(...await runBridgeChecks(page));
    await seedRegressionData(page);
    await runUiChecks(page);

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
