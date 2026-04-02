const fs = require("fs");
const os = require("os");
const path = require("path");
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

function createIsolatedEnv() {
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
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
}

async function waitForVisibleText(page, text, timeout = 45000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

async function waitForPlaceholder(page, text, timeout = 45000) {
  await page.getByPlaceholder(text).first().waitFor({ state: "visible", timeout });
}

async function clickMenuItem(page, label) {
  const item = page.locator(".ant-layout-sider").getByText(label, { exact: true }).first();
  await item.waitFor({ state: "visible", timeout: 30000 });
  await item.click();
  await page.waitForTimeout(250);
}

async function seedRegressionData(page) {
  await page.evaluate(async ({ tinyPngDataUrl: png }) => {
    const store = window.electronAPI?.store;
    if (!store) throw new Error("store bridge unavailable");

    const now = new Date().toISOString();

    await store.set("temu_products", [
      {
        title: "自动化回归测试商品",
        category: "测试类目",
        categories: "测试类目 > 子类目",
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
          title: "自动化回归测试商品",
          category: "测试类目",
          skcId: "skc-reg-001",
          spuId: "spu-reg-001",
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
          hotTag: "测试热卖",
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
          goodsName: "自动化回归测试商品",
          imageUrl: png,
          spuId: "spu-reg-001",
          category: "测试类目",
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
        sales: {
          status: "success",
          storeKey: "temu_sales",
          updatedAt: now,
        },
        orders: {
          status: "success",
          storeKey: "temu_orders",
          updatedAt: now,
        },
        flux: {
          status: "success",
          storeKey: "temu_flux",
          updatedAt: now,
        },
      },
      summary: {
        totalTasks: 3,
        successCount: 3,
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
  }, { tinyPngDataUrl });
}

async function runBridgeChecks(page) {
  const issues = [];
  const result = await page.evaluate(async ({ regressionPngDataUrl: png }) => {
    const api = window.electronAPI;
    if (!api) throw new Error("window.electronAPI missing");

    async function dataUrlToNativeImagePayload(dataUrl, name = "regression.png") {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      return {
        name,
        type: blob.type || "image/png",
        size: blob.size,
        buffer,
      };
    }

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
    const nativeImage = await dataUrlToNativeImagePayload(png);
    const analysis = await api.imageStudio.analyze({
      files: [nativeImage],
      productMode: "single",
    });
    const aiPlans = await api.imageStudio.generatePlans({
      analysis,
      imageTypes: ["main"],
      salesRegion: "us",
      imageSize: "800x800",
      productMode: "single",
    });
    const startedGenerate = await api.imageStudio.startGenerate({
      files: [nativeImage],
      plans: Array.isArray(aiPlans) ? aiPlans.slice(0, 1) : [],
      productMode: "single",
      salesRegion: "us",
      runInBackground: false,
      imageLanguage: "en",
      imageSize: "800x800",
      productName: analysis?.productName || "自动化回归测试商品",
    });
    const generateResult = await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        unsubscribe?.();
        reject(new Error("imageStudio.startGenerate timeout"));
      }, 240000);
      const unsubscribe = api.onImageStudioEvent?.((payload) => {
        if (!payload || payload.jobId !== startedGenerate?.jobId) return;
        if (payload.type === "generate:complete") {
          window.clearTimeout(timeout);
          unsubscribe?.();
          resolve(payload);
          return;
        }
        if (payload.type === "generate:error") {
          window.clearTimeout(timeout);
          unsubscribe?.();
          reject(new Error(payload.error || payload.message || "AI 出图失败"));
        }
      });
      if (!unsubscribe) {
        window.clearTimeout(timeout);
        reject(new Error("imageStudio event bridge unavailable"));
      }
    });
    const savedHistory = await api.imageStudio.saveHistory({
      productName: "自动化回归测试商品",
      salesRegion: "us",
      imageCount: 1,
      images: [{ imageType: "main", imageUrl: png }],
    });
    const generatedPlans = await api.imageStudio.generatePlans({
      analysis: {
        productName: "自动化回归测试商品",
        category: "测试类目",
        sellingPoints: ["免打孔安装", "优质不锈钢材质"],
        materials: "stainless steel",
        colors: "silver",
        targetAudience: ["renters"],
        usageScenes: ["kitchen"],
        estimatedDimensions: "20cm x 8cm x 5cm",
      },
      imageTypes: ["main", "features"],
      salesRegion: "us",
      imageSize: "800x800",
      productMode: "single",
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
      analysis,
      updateConfigOk,
      updateConfigError,
      generatedPlansCount: Array.isArray(generatedPlans) ? generatedPlans.length : -1,
      aiGeneratedPlansCount: Array.isArray(aiPlans) ? aiPlans.length : -1,
      generateResult,
      historyItem,
      historyListCount: Array.isArray(historyList) ? historyList.length : -1,
      originalConfig,
    };
  }, { regressionPngDataUrl });

  assert(typeof result.version === "string" && result.version.length > 0, "app.getVersion returned invalid version");
  assert(result.roundtrip?.ok === true, "store roundtrip failed");
  assert(typeof result.pingStatus === "string" && result.pingStatus.length > 0, "automation.ping returned invalid payload");
  assert(typeof result.progressStatus === "string" && result.progressStatus.length > 0, "automation.getProgress returned invalid payload");
  assert(result.taskCount >= 0, "automation.listTasks returned invalid task list");
  assert(typeof result.imageStatus?.status === "string", "imageStudio.ensureRunning returned invalid status");
  assert(typeof result.analysis?.productName === "string" && result.analysis.productName.length > 0, "imageStudio.analyze returned invalid analysis");
  assert(result.aiGeneratedPlansCount > 0, "imageStudio.generatePlans returned no AI plans");
  assert(Array.isArray(result.generateResult?.results) && result.generateResult.results.length > 0, "imageStudio.startGenerate returned no generated images");
  assert(typeof result.generateResult.results[0]?.imageUrl === "string" && result.generateResult.results[0].imageUrl.length > 0, "imageStudio.startGenerate returned invalid image url");
  assert(result.generatedPlansCount > 0, "imageStudio.generatePlans returned no plans");
  assert(result.historyListCount >= 1, "imageStudio.listHistory returned no history items");
  assert(result.historyItem?.productName === "自动化回归测试商品", "imageStudio.getHistoryItem returned invalid history item");

  console.log("[ok] electron bridge basic checks");
  console.log("[ok] automation worker bridge");
  console.log("[ok] image studio analyze/generate bridge");
  if (result.updateConfigOk) {
    console.log("[ok] image studio config/history bridge");
  } else {
    issues.push(`AI 出图配置写入失败: ${result.updateConfigError || "unknown error"}`);
    console.log(`[warn] image studio config update failed: ${result.updateConfigError || "unknown error"}`);
    console.log("[ok] image studio history bridge");
  }
  return issues;
}

async function runUiChecks(page) {
  const issues = [];
  await clickMenuItem(page, "店铺概览");
  await waitForVisibleText(page, "数据概览");
  await waitForVisibleText(page, "流量分析");
  console.log("[ok] 店铺概览页面");

  await clickMenuItem(page, "商品管理");
  await waitForPlaceholder(page, "搜索商品名称/SKC/SPU/货号");
  await page.getByRole("button", { name: "查看详情" }).first().waitFor({ state: "visible", timeout: 45000 });
  console.log("[ok] 商品列表页面");

  await page.getByRole("button", { name: "查看详情" }).first().click();
  await waitForVisibleText(page, "自动化回归测试商品");
  await waitForVisibleText(page, "基本信息");
  await waitForVisibleText(page, "流量数据");
  console.log("[ok] 商品详情页面");

  await page.getByRole("button", { name: "返回" }).first().click();
  await waitForPlaceholder(page, "搜索商品名称/SKC/SPU/货号");

  await clickMenuItem(page, "上品管理");
  await waitForVisibleText(page, "上传商品表格");
  console.log("[ok] 上品管理页面");

  await clickMenuItem(page, "AI 出图");
  await waitForVisibleText(page, "拖拽商品图片到此处", 90000);
  await page.getByRole("button", { name: "历史记录" }).click();
  await waitForVisibleText(page, "历史记录");
  await waitForVisibleText(page, "自动化回归测试商品");
  await page.keyboard.press("Escape");
  await waitForVisibleText(page, "拖拽商品图片到此处");
  console.log("[ok] AI 出图页面");

  await clickMenuItem(page, "数据采集");
  await waitForVisibleText(page, "一键采集全部数据");
  console.log("[ok] 数据采集页面");

  await clickMenuItem(page, "账号管理");
  await waitForVisibleText(page, "添加账号");
  await page.getByRole("button", { name: "添加账号" }).click();
  const modal = page.locator(".ant-modal-root .ant-modal").last();
  await modal.waitFor({ state: "visible", timeout: 30000 });
  await modal.getByPlaceholder("例：我的Temu店铺").fill("回归测试店");
  await modal.getByPlaceholder("请输入手机号").fill("13800138000");
  await modal.getByPlaceholder("请输入密码").fill("Regression#123");
  await modal.locator(".ant-btn-primary").last().click();
  await waitForVisibleText(page, "回归测试店");
  await page.getByRole("button", { name: "切换数据" }).first().click();
  try {
    await waitForVisibleText(page, "当前数据", 15000);
  } catch (error) {
    issues.push("账号页切换数据后，列表里的“当前数据”状态没有按预期出现");
    console.log("[warn] 账号页未及时显示“当前数据”状态");
  }
  try {
    await page.locator(".ant-layout-header").getByText("回归测试店").waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    issues.push("切换数据账号后，顶部活动账号标签没有同步显示新账号名称");
    console.log("[warn] 顶部活动账号标签未同步更新");
  }
  console.log("[ok] 账号管理页面");

  await clickMenuItem(page, "任务管理");
  await waitForVisibleText(page, "任务页现在直接接入真实后端任务");
  console.log("[ok] 任务管理页面");

  await clickMenuItem(page, "日志中心");
  await waitForVisibleText(page, "前端日志页");
  await waitForVisibleText(page, "desktop regression seeded log");
  await page.getByRole("button", { name: "清空日志" }).click();
  await waitForVisibleText(page, "暂无前端日志");
  console.log("[ok] 日志中心页面");

  await clickMenuItem(page, "设置");
  await waitForVisibleText(page, "版本与更新");
  await page.getByRole("button", { name: "保存设置" }).click();
  const savedSettings = await page.evaluate(async () => {
    return window.electronAPI?.store?.get("temu_app_settings");
  });
  assert(savedSettings && typeof savedSettings === "object", "settings save did not persist to store");
  console.log("[ok] 设置页面");

  await clickMenuItem(page, "账号管理");
  await waitForVisibleText(page, "添加账号");
  console.log("[ok] 账号页二次进入未卡死");

  return issues;
}

async function main() {
  ensureFileExists(distIndex, "dist index");

  const env = createIsolatedEnv();
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

    await waitForVisibleText(page, "Temu 运营助手", 30000);
    issues.push(...await runBridgeChecks(page));
    await seedRegressionData(page);
    issues.push(...await runUiChecks(page));

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
