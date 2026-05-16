const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(repoRoot, "release");
const latestYmlPath = path.join(releaseDir, "latest.yml");

function basenameFromUpdatePath(value) {
  const raw = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return path.posix.basename(decodeURIComponent(url.pathname));
  } catch {
    return path.basename(raw.replace(/\\/g, "/"));
  }
}

function findInstallerName(content) {
  const candidates = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/);
    if (!match) continue;
    const name = basenameFromUpdatePath(match[1]);
    if (/^temu-automation-setup-.+\.exe$/i.test(name)) {
      candidates.push(name);
    }
  }
  if (candidates.length > 0) return candidates[0];

  const installers = fs.readdirSync(releaseDir)
    .filter((name) => /^temu-automation-setup-.+\.exe$/i.test(name))
    .map((name) => ({
      name,
      mtimeMs: fs.statSync(path.join(releaseDir, name)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return installers[0]?.name || "";
}

function normalizeLatestYml() {
  if (!fs.existsSync(latestYmlPath)) {
    throw new Error(`未找到 ${latestYmlPath}，请先执行 npm run dist:win`);
  }

  const content = fs.readFileSync(latestYmlPath, "utf8");
  const installerName = findInstallerName(content);
  if (!installerName) {
    throw new Error("latest.yml 中未找到安装包文件名");
  }

  const installerPath = path.join(releaseDir, installerName);
  const blockmapPath = path.join(releaseDir, `${installerName}.blockmap`);
  if (!fs.existsSync(installerPath)) {
    throw new Error(`未找到安装包：${installerPath}`);
  }
  if (!fs.existsSync(blockmapPath)) {
    throw new Error(`未找到差量元数据：${blockmapPath}`);
  }

  let normalized = content
    .replace(/^(\s*-\s*url:\s*).+$/m, `$1${installerName}`)
    .replace(/^(path:\s*).+$/m, `$1${installerName}`);

  if (/(?:^|\s)https?:\/\/github\.com\//i.test(normalized)) {
    throw new Error("latest.yml 仍包含 GitHub 直连地址，请检查发布元数据");
  }

  if (!normalized.endsWith("\n")) normalized += "\n";
  fs.writeFileSync(latestYmlPath, normalized, "utf8");
  console.log(`已归一化 release/latest.yml：${installerName}`);
}

normalizeLatestYml();
