const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const workerEntry = path.join(repoRoot, "automation", "worker-entry.cjs");
const distIndex = path.join(repoRoot, "dist", "index.html");
const imageRuntimeEntry = path.join(repoRoot, "build", "auto-image-gen-runtime", "bootstrap.cjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "temu-smoke-"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} missing: ${filePath}`);
  }
  console.log(`[ok] ${label}: ${filePath}`);
}

function httpGet(url, timeout = 5000, authToken = "") {
  const options = { timeout };
  if (authToken) options.headers = { Authorization: `Bearer ${authToken}` };
  return new Promise((resolve, reject) => {
    const req = http.get(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

function httpPostJson(port, payload, timeout = 5000, authToken = "") {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: "/",
        timeout,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(body);
    req.end();
  });
}

async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`${label} timeout: ${lastError?.message || "unknown error"}`);
}

async function withSpawnedProcess(options, verify) {
  const logPath = options.logPath || path.join(tmpRoot, `${options.label}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const child = spawn(options.command, options.args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (child.stdout) child.stdout.pipe(logStream);
  if (child.stderr) child.stderr.pipe(logStream);

  let exited = false;
  let exitCode = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  try {
    const result = await verify({
      logPath,
      ensureRunning() {
        if (exited) {
          throw new Error(`${options.label} exited early with code ${exitCode}`);
        }
      },
    });
    return result;
  } finally {
    try {
      child.kill();
    } catch {}
    try {
      logStream.end();
    } catch {}
  }
}

async function checkWorker() {
  const port = 19321;
  const smokeToken = "smoke-test-token";
  const appUserData = path.join(tmpRoot, "worker-user-data");
  fs.mkdirSync(appUserData, { recursive: true });

  await withSpawnedProcess(
    {
      label: "worker",
      command: process.execPath,
      args: [workerEntry],
      env: {
        WORKER_PORT: String(port),
        WORKER_AUTH_TOKEN: smokeToken,
        APP_USER_DATA: appUserData,
        WORKER_BOOTSTRAP_LOG: path.join(tmpRoot, "worker-bootstrap.log"),
      },
    },
    async ({ ensureRunning, logPath }) => {
      await waitFor(async () => {
        ensureRunning();
        const response = await httpPostJson(port, { action: "ping", params: {} }, 3000, smokeToken);
        if (response.statusCode !== 200) {
          throw new Error(`worker ping status=${response.statusCode}`);
        }
        return response;
      }, 20000, "worker ping");
      const progressResponse = await httpGet(`http://127.0.0.1:${port}/progress`, 3000, smokeToken);
      if (progressResponse.statusCode !== 200) {
        throw new Error(`worker progress status=${progressResponse.statusCode}`);
      }
      const progress = JSON.parse(progressResponse.body);
      if (!progress || typeof progress.status !== "string") {
        throw new Error("worker progress payload missing status");
      }
      const tasksResponse = await httpGet(`http://127.0.0.1:${port}/tasks`, 3000, smokeToken);
      if (tasksResponse.statusCode !== 200) {
        throw new Error(`worker tasks status=${tasksResponse.statusCode}`);
      }
      const tasks = JSON.parse(tasksResponse.body);
      if (!Array.isArray(tasks)) {
        throw new Error("worker tasks payload is not an array");
      }
      console.log(`[ok] worker ping: ${logPath}`);
      console.log(`[ok] worker progress shape: ${logPath}`);
      console.log(`[ok] worker task snapshots: ${logPath}`);
    }
  );
}

async function checkImageRuntime() {
  const port = 3321;
  await withSpawnedProcess(
    {
      label: "image-runtime",
      command: process.execPath,
      args: [imageRuntimeEntry],
      cwd: path.dirname(imageRuntimeEntry),
      env: {
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
      },
    },
    async ({ ensureRunning, logPath }) => {
      await waitFor(async () => {
        ensureRunning();
        const response = await httpGet(`http://127.0.0.1:${port}/api/config`, 3000);
        if (response.statusCode < 200 || response.statusCode >= 500) {
          throw new Error(`image runtime status=${response.statusCode}`);
        }
        return response;
      }, 30000, "image runtime config");
      console.log(`[ok] image runtime config: ${logPath}`);
    }
  );
}

function checkReleasePrereqs() {
  const prepareResult = spawnSync(process.execPath, [path.join(__dirname, "prepare-node-runtime.cjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (prepareResult.status !== 0) {
    throw new Error("prepare-node-runtime failed");
  }

  const result = spawnSync(process.execPath, [path.join(__dirname, "verify-release-prereqs.cjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("verify-release-prereqs failed");
  }
}

async function main() {
  try {
    assertFileExists(distIndex, "dist index");
    assertFileExists(workerEntry, "worker entry");
    assertFileExists(imageRuntimeEntry, "image runtime entry");
    checkReleasePrereqs();
    await checkWorker();
    await checkImageRuntime();
    console.log("");
    console.log("Smoke checks passed.");
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((error) => {
  console.error("");
  console.error(`Smoke checks failed: ${error.message}`);
  process.exit(1);
});
