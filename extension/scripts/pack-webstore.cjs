#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const AdmZip = require("adm-zip");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(EXT_ROOT, "dist");
const MANIFEST_PATH = path.join(EXT_ROOT, "manifest.json");

function fail(message) {
  console.error(`[pack-webstore] ERROR: ${message}`);
  process.exit(1);
}

function toZipPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isExcludedRuntimeFile(relativePath) {
  const zipPath = toZipPath(relativePath);
  const segments = zipPath.split("/");
  const filename = segments[segments.length - 1];

  if (zipPath === "web/manifest.json" || zipPath === "web/rules.json") {
    return true;
  }

  if (segments.some((segment) => ["scripts", "dist", "node_modules", ".git"].includes(segment))) {
    return true;
  }

  return (
    /\.md$/i.test(filename) ||
    /\.(pem|key|p12|pfx|crt|cert|map)$/i.test(filename) ||
    /(?:private|secret)/i.test(filename)
  );
}

function addFileToZip(zip, relativePath, bytesOverride = null) {
  if (isExcludedRuntimeFile(relativePath)) return;

  const absolutePath = path.join(EXT_ROOT, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    fail(`runtime file missing: ${relativePath}`);
  }

  const bytes = bytesOverride || fs.readFileSync(absolutePath);
  zip.addFile(toZipPath(relativePath), bytes);
}

function addDirectoryToZip(zip, relativeDir) {
  const absoluteDir = path.join(EXT_ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
    fail(`runtime directory missing: ${relativeDir}`);
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (isExcludedRuntimeFile(relativePath)) continue;

    if (entry.isDirectory()) {
      addDirectoryToZip(zip, relativePath);
    } else if (entry.isFile()) {
      addFileToZip(zip, relativePath);
    }
  }
}

function assertNoRemoteCodeChannel() {
  const bridge = fs.readFileSync(path.join(EXT_ROOT, "web", "content", "bridge.js"), "utf8");
  const sw = fs.readFileSync(path.join(EXT_ROOT, "web", "background", "sw.js"), "utf8");
  const combined = `${bridge}\n${sw}`;
  const forbidden = [
    "FETCHSCRIPT",
    "/api/hook/v1/inject.js",
    "scriptContent",
    "createObjectURL",
  ];
  for (const needle of forbidden) {
    if (combined.includes(needle)) {
      fail(`remote code channel marker still present: ${needle}`);
    }
  }
}

function main() {
  try {
    childProcess.execFileSync("node", ["extension/scripts/build-bridge.cjs"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    childProcess.execFileSync("node", ["extension/scripts/build-web-root-compat.cjs"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  } catch (error) {
    fail(`extension build failed with exit code ${error.status ?? "unknown"}`);
  }

  assertNoRemoteCodeChannel();

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const version = manifest.version;
  if (!version) fail("manifest.json missing version");
  delete manifest.key;

  const zip = new AdmZip();
  addFileToZip(zip, "manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  addFileToZip(zip, "rules.json");
  addDirectoryToZip(zip, "web");

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const zipPath = path.join(DIST_DIR, `temu-monitor-webstore-${version}.zip`);
  zip.writeZip(zipPath);

  console.log(`[pack-webstore] version: ${version}`);
  console.log(`[pack-webstore] wrote: ${path.relative(REPO_ROOT, zipPath)}`);
  console.log(`[pack-webstore] size: ${fs.statSync(zipPath).size} bytes`);
}

main();
