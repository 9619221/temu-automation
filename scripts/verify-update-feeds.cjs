const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(repoRoot, "release");
const packageJsonPath = path.join(repoRoot, "package.json");
const localLatestPath = path.join(releaseDir, "latest.yml");
const DEFAULT_GITHUB_FEED = "https://github.com/9619221/temu-automation/releases/latest/download/latest.yml";
const DEFAULT_ERP_FEED = "https://erp.temu.chat/releases/latest.yml";

function parseArgs(argv) {
  const options = {
    checkErp: false,
    githubFeed: DEFAULT_GITHUB_FEED,
    erpFeed: DEFAULT_ERP_FEED,
    allowErpVersions: new Set(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check-erp") {
      options.checkErp = true;
    } else if (arg === "--github-feed") {
      options.githubFeed = argv[++index];
    } else if (arg === "--erp-feed") {
      options.erpFeed = argv[++index];
    } else if (arg === "--expected") {
      options.expectedVersion = argv[++index];
    } else if (arg === "--allow-erp-version") {
      options.allowErpVersions.add(String(argv[++index] || "").trim());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function stripQuotes(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function parseLatestYml(content, label) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    let match = line.match(/^\s*version:\s*(.+?)\s*$/);
    if (match) result.version = stripQuotes(match[1]);
    match = line.match(/^\s*-\s*url:\s*(.+?)\s*$/);
    if (match && !result.url) result.url = stripQuotes(match[1]);
    match = line.match(/^\s*path:\s*(.+?)\s*$/);
    if (match) result.path = stripQuotes(match[1]);
    match = line.match(/^\s*sha512:\s*(.+?)\s*$/);
    if (match) result.sha512 = stripQuotes(match[1]);
    match = line.match(/^\s*size:\s*(\d+)\s*$/);
    if (match) result.size = Number(match[1]);
  }
  result.installerName = basenameFromUpdatePath(result.path || result.url);
  if (!result.version || !result.installerName || !result.sha512) {
    throw new Error(`${label} latest.yml is missing version/path/sha512`);
  }
  return result;
}

function basenameFromUpdatePath(value) {
  const raw = stripQuotes(value);
  try {
    const url = new URL(raw);
    return path.posix.basename(decodeURIComponent(url.pathname));
  } catch {
    return path.basename(raw.replace(/\\/g, "/"));
  }
}

function requestUrl(url, method = "GET", redirects = 8) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.request(parsed, { method, timeout: 30_000 }, (res) => {
      const location = res.headers.location;
      if (location && res.statusCode >= 300 && res.statusCode < 400 && redirects > 0) {
        res.resume();
        resolve(requestUrl(new URL(location, parsed).toString(), method, redirects - 1));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          url,
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`${method} ${url} timed out`)));
    req.on("error", reject);
    req.end();
  });
}

async function fetchText(url) {
  const response = await requestUrl(url, "GET");
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET ${url} failed with HTTP ${response.statusCode}`);
  }
  return response.body.toString("utf8");
}

async function headOk(url, expectedSize) {
  const response = await requestUrl(url, "HEAD");
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HEAD ${url} failed with HTTP ${response.statusCode}`);
  }
  const length = Number(response.headers["content-length"]);
  if (Number.isFinite(expectedSize) && Number.isFinite(length) && length !== expectedSize) {
    throw new Error(`HEAD ${url} size mismatch: ${length} !== ${expectedSize}`);
  }
  return { statusCode: response.statusCode, size: length || null };
}

function assetUrlFromFeed(feedUrl, assetName) {
  return new URL(assetName, feedUrl).toString();
}

function assertSameLatest(label, actual, expected) {
  const fields = ["version", "installerName", "sha512"];
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      throw new Error(`${label} ${field} mismatch: ${actual[field]} !== ${expected[field]}`);
    }
  }
  if (Number.isFinite(actual.size) && Number.isFinite(expected.size) && actual.size !== expected.size) {
    throw new Error(`${label} size mismatch: ${actual.size} !== ${expected.size}`);
  }
}

async function verifyRemoteFeed(label, feedUrl, expected, options = {}) {
  const content = await fetchText(feedUrl);
  const latest = parseLatestYml(content, `${label} remote`);
  const allowed = options.allowVersions || new Set();
  if (latest.version !== expected.version && !allowed.has(latest.version)) {
    throw new Error(`${label} version mismatch: ${latest.version} !== ${expected.version}`);
  }
  if (latest.version === expected.version) {
    assertSameLatest(label, latest, expected);
  } else {
    console.log(`[warn] ${label} is intentionally lagging at ${latest.version}`);
  }
  await headOk(assetUrlFromFeed(feedUrl, latest.installerName), latest.size || expected.size);
  if (expected.hasBlockmap) {
    await headOk(assetUrlFromFeed(feedUrl, `${latest.installerName}.blockmap`));
  }
  console.log(`[ok] ${label}: version=${latest.version}, installer=${latest.installerName}`);
  return latest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const expectedVersion = options.expectedVersion || pkg.version;
  const local = parseLatestYml(fs.readFileSync(localLatestPath, "utf8"), "local");
  if (local.version !== expectedVersion) {
    throw new Error(`local release version mismatch: ${local.version} !== ${expectedVersion}`);
  }

  const installerPath = path.join(releaseDir, local.installerName);
  const blockmapPath = path.join(releaseDir, `${local.installerName}.blockmap`);
  if (!fs.existsSync(installerPath)) throw new Error(`missing local installer: ${installerPath}`);
  local.hasBlockmap = fs.existsSync(blockmapPath);
  const actualSize = fs.statSync(installerPath).size;
  if (Number.isFinite(local.size) && actualSize !== local.size) {
    throw new Error(`local installer size mismatch: ${actualSize} !== ${local.size}`);
  }
  local.size = actualSize;
  console.log(`[ok] local: version=${local.version}, installer=${local.installerName}`);

  await verifyRemoteFeed("github", options.githubFeed, local);
  if (options.checkErp || options.allowErpVersions.size > 0) {
    await verifyRemoteFeed("erp", options.erpFeed, local, { allowVersions: options.allowErpVersions });
  }
}

main().catch((error) => {
  console.error(`[fail] ${error?.message || error}`);
  process.exit(1);
});
