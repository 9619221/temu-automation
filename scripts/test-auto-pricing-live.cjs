const path = require("path");
const { _electron: electron } = require("playwright");
const electronBinary = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const electronMode = process.env.TEMU_ELECTRON_MODE || process.env.NODE_ENV || "development";
const filePath = process.env.TEMU_AUTOPRICING_FILE
  || "C:\\Users\\Administrator\\Desktop\\商品文件夹\\2037723977643692033_已筛选_排除后.xlsx";
const startRow = Number(process.env.TEMU_AUTOPRICING_START_ROW || 0);
const count = Number(process.env.TEMU_AUTOPRICING_COUNT || 1);
const timeoutMs = Number(process.env.TEMU_AUTOPRICING_TIMEOUT_MS || 15 * 60 * 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeout, label) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeout) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`${label} timeout: ${lastError?.message || "unknown error"}`);
}

async function invoke(page, expression, arg) {
  return page.evaluate(expression, arg);
}

async function main() {
  let electronApp = null;
  let page = null;
  let electronProcess = null;
  try {
    if (!require("fs").existsSync(filePath)) {
      throw new Error(`测试表格不存在: ${filePath}`);
    }

    electronApp = await electron.launch({
      executablePath: electronBinary,
      args: ["."],
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: electronMode,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });
    electronProcess = electronApp.process();
    if (electronProcess?.stdout) {
      electronProcess.stdout.on("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) console.log(`[electron:out] ${text}`);
      });
    }
    if (electronProcess?.stderr) {
      electronProcess.stderr.on("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) console.log(`[electron:err] ${text}`);
      });
    }

    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await waitFor(async () => {
      const ready = await page.evaluate(() => Boolean(window.electronAPI?.automation));
      if (!ready) throw new Error("window.electronAPI not ready");
      return true;
    }, 30000, "electron bridge ready");

    const contextInfo = await invoke(page, async ({ targetFilePath, nextStartRow, nextCount }) => {
      const store = window.electronAPI?.store;
      const automation = window.electronAPI?.automation;
      const accounts = await store?.get?.("temu_accounts");
      const activeAccountId = await store?.get?.("temu_active_account_id");
      const tasks = await automation?.listTasks?.();
      return {
        activeAccountId,
        accountCount: Array.isArray(accounts) ? accounts.length : 0,
        targetFilePath,
        nextStartRow,
        nextCount,
        runningTaskIds: Array.isArray(tasks)
          ? tasks.filter((task) => task?.running).map((task) => task.taskId)
          : [],
      };
    }, { targetFilePath: filePath, nextStartRow: startRow, nextCount: count });

    console.log(`[live] mode=${electronMode}`);
    console.log(`[live] file=${contextInfo.targetFilePath}`);
    console.log(`[live] activeAccountId=${contextInfo.activeAccountId || "none"} accountCount=${contextInfo.accountCount}`);
    if (Array.isArray(contextInfo.runningTaskIds) && contextInfo.runningTaskIds.length > 0) {
      console.log(`[live] runningTasks=${contextInfo.runningTaskIds.join(",")}`);
    }

    const startResult = await invoke(page, async ({ targetFilePath, nextStartRow, nextCount }) => {
      return window.electronAPI?.automation?.autoPricing?.({
        csvPath: targetFilePath,
        startRow: nextStartRow,
        count: nextCount,
      });
    }, { targetFilePath: filePath, nextStartRow: startRow, nextCount: count });

    if (!startResult?.taskId && !startResult?.task?.taskId) {
      throw new Error(`启动自动化上品失败: ${JSON.stringify(startResult)}`);
    }

    const taskId = startResult.taskId || startResult.task.taskId;
    console.log(`[live] taskId=${taskId} accepted=${Boolean(startResult.accepted)}`);
    if (startResult?.message) {
      console.log(`[live] message=${startResult.message}`);
    }

    let lastStatusLine = "";
    const finalSnapshot = await waitFor(async () => {
      const snapshot = await invoke(page, async (nextTaskId) => {
        return window.electronAPI?.automation?.getTaskProgress?.(nextTaskId);
      }, taskId);
      if (!snapshot) {
        throw new Error("任务快照为空");
      }

      const progressLine = [
        snapshot.status || "unknown",
        `${Number(snapshot.completed || 0)}/${Number(snapshot.total || 0)}`,
        snapshot.current || "",
        snapshot.step || "",
        snapshot.message || "",
      ].filter(Boolean).join(" | ");

      if (progressLine !== lastStatusLine) {
        lastStatusLine = progressLine;
        console.log(`[live] ${progressLine}`);
      }

      if (snapshot.running) {
        throw new Error("任务仍在执行");
      }

      if (["completed", "failed", "interrupted", "paused"].includes(snapshot.status)) {
        return snapshot;
      }

      throw new Error(`任务尚未结束: ${snapshot.status || "unknown"}`);
    }, timeoutMs, "auto pricing task");

    console.log("[live] finalSnapshot=");
    console.log(JSON.stringify(finalSnapshot, null, 2));

    const results = Array.isArray(finalSnapshot?.results) ? finalSnapshot.results : [];
    const failedItems = results.filter((item) => !item?.success);
    if (finalSnapshot?.status !== "completed") {
      throw new Error(finalSnapshot?.message || `任务未完成，状态=${finalSnapshot?.status || "unknown"}`);
    }
    if (results.length < count) {
      throw new Error(`任务已完成，但结果数不足: ${results.length}/${count}`);
    }
    if (failedItems.length > 0) {
      throw new Error(`存在失败商品: ${failedItems.map((item) => item?.message || "unknown error").join(" || ")}`);
    }

    console.log("");
    console.log("Live auto pricing test passed.");
  } finally {
    try {
      await electronApp?.close();
    } catch {}
  }
}

main().catch((error) => {
  console.error("");
  console.error(`Live auto pricing test failed: ${error.message}`);
  process.exit(1);
});
