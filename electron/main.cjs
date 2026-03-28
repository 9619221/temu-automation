const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

// 全局捕获未处理异常，防止 EPIPE 等 pipe 错误崩溃 Electron
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") return; // 忽略 pipe 错误
  console.error("[Main] Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled rejection:", reason);
});

let mainWindow = null;
let worker = null;
let workerPort = 19280;
let workerReady = false;

// ============ Worker 管理（HTTP 通信，彻底避免 stdio 继承） ============

function findNodeExe() {
  const candidates = [
    "C:/New Folder/node.exe",
    "C:/Program Files/nodejs/node.exe",
    "C:/Program Files (x86)/nodejs/node.exe",
  ];
  const pathDirs = (process.env.PATH || "").split(";");
  for (const dir of pathDirs) {
    candidates.push(path.join(dir, "node.exe"));
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return "node";
}

function httpPost(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: 86400000,  // 24小时超时
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(buf);
            if (json.type === "error") reject(new Error(json.message));
            else resolve(json.data);
          } catch (e) {
            reject(new Error("Worker 返回无效 JSON: " + buf.substring(0, 200)));
          }
        });
      }
    );
    req.on("error", (e) => reject(new Error("Worker 通信失败: " + e.message)));
    req.on("timeout", () => { req.destroy(); reject(new Error("Worker 请求超时")); });
    req.write(data);
    req.end();
  });
}

function waitForWorker(port, maxWait = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > maxWait) {
        reject(new Error("Worker 启动超时"));
        return;
      }
      httpPost(port, { action: "ping" })
        .then(() => resolve(true))
        .catch(() => setTimeout(check, 500));
    }
    check();
  });
}

// 尝试关闭旧的 worker（通过端口文件找到）
async function shutdownOldWorker() {
  try {
    const portFile = path.join(app.getPath("userData"), "worker-port");
    if (fs.existsSync(portFile)) {
      const oldPort = parseInt(fs.readFileSync(portFile, "utf-8").trim());
      if (oldPort > 0) {
        console.log(`[Main] Trying to shutdown old worker on port ${oldPort}`);
        // 先尝试 shutdown 命令
        await httpPost(oldPort, { action: "shutdown" }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        // 如果还在运行，用系统命令杀掉
        try {
          const { execSync } = require("child_process");
          const out = execSync(`netstat -ano | findstr :${oldPort} | findstr LISTENING`, { encoding: "utf8" });
          const pids = [...new Set(out.trim().split(/\n/).map(l => l.trim().split(/\s+/).pop()))];
          for (const pid of pids) {
            try { execSync(`taskkill /F /PID ${pid}`); console.log(`[Main] Killed old worker PID ${pid}`); } catch {}
          }
        } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch {}
}

async function startWorker() {
  if (worker && workerReady) return;

  // 清理旧进程
  if (worker) {
    try { worker.kill(); } catch {}
    worker = null;
    workerReady = false;
  }

  // 先尝试关闭旧的 worker
  await shutdownOldWorker();

  const nodeExe = findNodeExe();
  const workerPath = path.join(__dirname, "../automation/worker.mjs");

  console.log(`[Main] Starting worker: ${nodeExe} ${workerPath} (port ${workerPort})`);

  // 关键：stdio 全部 ignore，不继承任何 handle
  worker = spawn(nodeExe, [workerPath], {
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
    windowsHide: true,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith("ELECTRON"))
      ),
      WORKER_PORT: String(workerPort),
    },
  });

  // 只读 stderr 用于调试日志（安全处理 EPIPE）
  if (worker.stderr) {
    worker.stderr.on("data", (d) => {
      try { console.error("[Worker]", d.toString()); } catch {}
    });
    worker.stderr.on("error", () => {}); // 忽略 pipe 错误
  }
  if (worker.stdout) {
    worker.stdout.on("error", () => {}); // 忽略 pipe 错误
  }

  worker.on("exit", (code) => {
    console.log(`[Main] Worker exited: ${code}`);
    worker = null;
    workerReady = false;
  });

  worker.on("error", (err) => {
    try { console.error("[Main] Worker spawn error:", err.message); } catch {}
    worker = null;
    workerReady = false;
  });

  // 等待 worker HTTP 服务就绪
  try {
    await waitForWorker(workerPort);
    workerReady = true;
    console.log(`[Main] Worker ready on port ${workerPort}`);
  } catch (e) {
    console.error("[Main] Worker 启动失败:", e.message);
    if (worker) { try { worker.kill(); } catch {} }
    worker = null;
    workerReady = false;
    throw e;
  }
}

async function sendCmd(action, params = {}) {
  if (!workerReady) {
    await startWorker();
  }
  return httpPost(workerPort, { action, params });
}

function stopWorker() {
  if (worker) {
    try { worker.kill(); } catch {}
    worker = null;
    workerReady = false;
  }
}

// ============ 窗口 ============

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    title: "Temu 自动化运营工具",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发模式：等待 Vite dev server 就绪（最多30秒）
  const devUrl = "http://localhost:1420";
  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

  if (isDev) {
    console.log("[Main] Dev mode: waiting for Vite server...");
    const maxWait = 30000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(devUrl, (res) => { res.resume(); resolve(true); });
          req.on("error", reject);
          req.setTimeout(2000, () => { req.destroy(); reject(new Error("timeout")); });
        });
        break;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.log("[Main] Loading from Vite dev server");
    mainWindow.loadURL(devUrl);
  } else {
    const distPath = path.join(__dirname, "../dist/index.html");
    if (fs.existsSync(distPath)) {
      console.log("[Main] Loading from dist");
      mainWindow.loadFile(distPath);
    } else {
      console.log("[Main] Fallback to dev URL");
      mainWindow.loadURL(devUrl);
    }
  }

  // DevTools: 按 F12 手动打开，不自动打开（避免遮挡页面）
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12") mainWindow.webContents.toggleDevTools();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await createWindow();
  // 启动时自动启动 worker，这样用户操作时不用等待
  try {
    await startWorker();
    console.log("[Main] Worker auto-started successfully");
  } catch (e) {
    console.error("[Main] Worker auto-start failed (will retry on demand):", e.message);
  }
});
app.on("window-all-closed", () => { stopWorker(); app.quit(); });
app.on("activate", () => { if (!mainWindow) createWindow(); });

// ============ IPC ============

ipcMain.handle("get-app-path", () => app.getPath("userData"));

ipcMain.handle("select-file", async (_e, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: filters || [{ name: "表格文件", extensions: ["xlsx", "xls", "csv"] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("automation:login", async (_, accountId, phone, password) => {
  return sendCmd("login", { accountId, phone, password });
});

ipcMain.handle("automation:scrape-products", async () => {
  return sendCmd("scrape_products");
});

ipcMain.handle("automation:scrape-orders", async () => {
  return sendCmd("scrape_orders");
});

ipcMain.handle("automation:scrape-sales", async () => {
  return sendCmd("scrape_sales");
});

ipcMain.handle("automation:scrape-flux", async () => {
  return sendCmd("scrape_flux");
});

ipcMain.handle("automation:scrape-dashboard", async () => {
  return sendCmd("scrape_dashboard");
});

ipcMain.handle("automation:scrape-aftersales", async () => {
  return sendCmd("scrape_aftersales");
});

ipcMain.handle("automation:scrape-soldout", async () => {
  return sendCmd("scrape_soldout");
});

ipcMain.handle("automation:scrape-goods-data", async () => {
  return sendCmd("scrape_goods_data");
});

ipcMain.handle("automation:scrape-activity", async () => {
  return sendCmd("scrape_activity");
});

ipcMain.handle("automation:scrape-performance", async () => {
  return sendCmd("scrape_performance");
});

ipcMain.handle("automation:scrape-all", async () => {
  return sendCmd("scrape_all");
});

ipcMain.handle("automation:create-product", async (_e, params) => {
  return sendCmd("create_product", params);
});

ipcMain.handle("automation:auto-pricing", async (_e, params) => {
  return sendCmd("auto_pricing", params);
});

ipcMain.handle("automation:pause-pricing", async () => {
  return sendCmd("pause_pricing");
});

ipcMain.handle("automation:resume-pricing", async () => {
  return sendCmd("resume_pricing");
});

ipcMain.handle("automation:list-drafts", async () => {
  return sendCmd("list_drafts");
});

ipcMain.handle("automation:retry-draft", async (_e, draftId) => {
  return sendCmd("retry_draft", { draftId });
});

ipcMain.handle("automation:delete-draft", async (_e, draftId) => {
  return sendCmd("delete_draft", { draftId });
});

ipcMain.handle("automation:get-progress", async () => {
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: workerPort, method: "GET", path: "/progress", timeout: 3000 }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { resolve({ running: false }); }
        });
      });
      req.on("error", () => resolve({ running: false }));
      req.on("timeout", () => { req.destroy(); resolve({ running: false }); });
      req.end();
    });
  } catch { return { running: false }; }
});

ipcMain.handle("automation:read-scrape-data", async (_e, key) => {
  return sendCmd("read_scrape_data", { key });
});

ipcMain.handle("automation:scrape-lifecycle", async () => { return sendCmd("scrape_lifecycle"); });
ipcMain.handle("automation:scrape-bidding", async () => { return sendCmd("scrape_bidding"); });
ipcMain.handle("automation:scrape-price-compete", async () => { return sendCmd("scrape_price_compete"); });
ipcMain.handle("automation:scrape-hot-plan", async () => { return sendCmd("scrape_hot_plan"); });
ipcMain.handle("automation:scrape-checkup", async () => { return sendCmd("scrape_checkup"); });
ipcMain.handle("automation:scrape-us-retrieval", async () => { return sendCmd("scrape_us_retrieval"); });
ipcMain.handle("automation:scrape-delivery", async () => { return sendCmd("scrape_delivery"); });

ipcMain.handle("automation:close", async () => {
  return sendCmd("close");
});

ipcMain.handle("automation:ping", async () => {
  return sendCmd("ping");
});

// ============ 文件存储 IPC ============

ipcMain.handle("store:get", (_, key) => {
  const filePath = path.join(app.getPath("userData"), `${key}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}
  return null;
});

ipcMain.handle("store:set", (_, key, data) => {
  const filePath = path.join(app.getPath("userData"), `${key}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return true;
});
