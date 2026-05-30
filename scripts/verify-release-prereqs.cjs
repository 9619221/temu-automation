const fs = require("fs");
const https = require("https");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const aiRuntimeEnvPath = path.join(repoRoot, "build", "auto-image-gen-runtime", ".env.local");
const defaultCredentialsPath = path.join(repoRoot, "electron", "default-credentials.cjs");

function resolveResourcePath(resourcePath) {
  if (!resourcePath || typeof resourcePath !== "string") return null;
  if (path.isAbsolute(resourcePath)) return resourcePath;
  return path.resolve(repoRoot, resourcePath);
}

function checkPathExists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readEnvFile(filePath) {
  const env = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return env;
}

function getMaskedLength(value) {
  return typeof value === "string" ? value.length : 0;
}

function assertAiCredentialsMatchRuntimeEnv(env) {
  const { getDefaultCredentials } = require(defaultCredentialsPath);
  const baked = getDefaultCredentials();
  if (!baked.analyzeApiKey || baked.analyzeApiKey !== env.ANALYZE_API_KEY) {
    throw new Error("electron/default-credentials.cjs 的 analyzeApiKey 与 build/auto-image-gen-runtime/.env.local 不一致");
  }
  if (!baked.analyzeBaseUrl || baked.analyzeBaseUrl !== env.ANALYZE_BASE_URL) {
    throw new Error("electron/default-credentials.cjs 的 analyzeBaseUrl 与 build/auto-image-gen-runtime/.env.local 不一致");
  }
  if (!baked.analyzeModel || baked.analyzeModel !== env.ANALYZE_MODEL) {
    throw new Error("electron/default-credentials.cjs 的 analyzeModel 与 build/auto-image-gen-runtime/.env.local 不一致");
  }
}

function assertExtensionResourceConfigured(buildConfig) {
  const extraResources = Array.isArray(buildConfig.extraResources) ? buildConfig.extraResources : [];
  const extensionResource = extraResources.find((resource) => (
    resource
    && typeof resource === "object"
    && resource.from === "extension"
    && resource.to === "extension"
  ));
  if (!extensionResource) {
    throw new Error("build.extraResources must copy extension to resources/extension");
  }
  for (const relativePath of [
    "manifest.json",
    "rules.json",
    path.join("web", "background", "sw.js"),
    path.join("web", "content", "bridge.js"),
    path.join("web", "manifest.json"),
    path.join("web", "rules.json"),
  ]) {
    const filePath = path.join(repoRoot, "extension", relativePath);
    if (!checkPathExists(filePath)) {
      throw new Error(`Extension package file missing: ${filePath}`);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "extension", "manifest.json"), "utf8"));
  const webManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "extension", "web", "manifest.json"), "utf8"));
  const rootRules = JSON.parse(fs.readFileSync(path.join(repoRoot, "extension", "rules.json"), "utf8"));
  const webRules = JSON.parse(fs.readFileSync(path.join(repoRoot, "extension", "web", "rules.json"), "utf8"));
  const forbiddenPermission = (manifest.permissions || []).find((permission) => (
    typeof permission === "string" && permission.startsWith("declarativeNetRequest")
  ));
  if (forbiddenPermission || manifest.declarative_net_request || webManifest.declarative_net_request) {
    throw new Error("Extension must not reference declarativeNetRequest static rules; Chrome rejects the legacy rules.json on some installs");
  }
  if (!Array.isArray(rootRules) || !Array.isArray(webRules)) {
    throw new Error("extension rules.json files must parse as JSON arrays");
  }
  if (webManifest.background?.service_worker !== "background/sw.js") {
    throw new Error("extension/web/manifest.json must be loadable from the web directory");
  }
  console.log("[ok] extension extraResource configured for resources/extension");
}

function verifyAnalyzeKey(env) {
  const apiKey = env.ANALYZE_API_KEY || "";
  const baseUrl = (env.ANALYZE_BASE_URL || "").replace(/\/+$/, "");
  const model = env.ANALYZE_MODEL || "";
  if (!apiKey || !baseUrl || !model) {
    throw new Error("AI runtime .env.local 缺少 ANALYZE_API_KEY / ANALYZE_BASE_URL / ANALYZE_MODEL");
  }

  const endpoint = new URL(`${baseUrl}/chat/completions`);
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 8,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: endpoint.pathname + endpoint.search,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 60_000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`ANALYZE_API_KEY 连通性检查失败: HTTP ${res.statusCode}, body=${text.slice(0, 180)}`));
          return;
        }
        console.log(`[ok] ANALYZE_API_KEY live check: HTTP ${res.statusCode}, keyLength=${getMaskedLength(apiKey)}, model=${model}`);
        resolve();
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("ANALYZE_API_KEY 连通性检查超时"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const buildConfig = pkg.build || {};
  const extraResources = Array.isArray(buildConfig.extraResources) ? buildConfig.extraResources : [];
  const checks = [];

  checks.push({
    label: "build/icon.ico",
    path: path.join(repoRoot, "build", "icon.ico"),
  });

  for (const resource of extraResources) {
    if (!resource || typeof resource !== "object" || !resource.from) continue;
    checks.push({
      label: `extraResource:${resource.to || resource.from}`,
      path: resolveResourcePath(resource.from),
    });
  }

  const missing = [];
  for (const check of checks) {
    const exists = checkPathExists(check.path);
    const prefix = exists ? "[ok]" : "[missing]";
    console.log(`${prefix} ${check.label}: ${check.path}`);
    if (!exists) {
      missing.push(check);
    }
  }

  if (missing.length > 0) {
    console.error("");
    console.error("Release prerequisite check failed.");
    console.error("Missing paths:");
    for (const check of missing) {
      console.error(`- ${check.path}`);
    }
    process.exit(1);
  }

  assertExtensionResourceConfigured(buildConfig);

  const aiEnv = readEnvFile(aiRuntimeEnvPath);
  assertAiCredentialsMatchRuntimeEnv(aiEnv);
  console.log(`[ok] AI analyze credential files agree: keyLength=${getMaskedLength(aiEnv.ANALYZE_API_KEY)}, model=${aiEnv.ANALYZE_MODEL || ""}`);
  await verifyAnalyzeKey(aiEnv);

  console.log("");
  console.log("Release prerequisite check passed.");
}

main().catch((error) => {
  console.error("");
  console.error("Release prerequisite check failed.");
  console.error(error?.message || error);
  process.exit(1);
});
