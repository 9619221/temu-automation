const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "build", "node-runtime");
const outputPath = path.join(outputDir, "node.exe");

function resolveNodeSource() {
  const candidates = [
    process.env.TEMU_NODE_RUNTIME,
    process.env.NODE_EXE,
    process.execPath,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  throw new Error("未找到可用的 node.exe，请设置 TEMU_NODE_RUNTIME 后重试。");
}

function main() {
  const nodeSource = resolveNodeSource();
  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(outputPath)) {
    try {
      const sourceStat = fs.statSync(nodeSource);
      const outputStat = fs.statSync(outputPath);
      if (sourceStat.size === outputStat.size) {
        console.log(`[ok] node runtime already prepared: ${outputPath}`);
        return;
      }
    } catch {}
  }

  try {
    fs.copyFileSync(nodeSource, outputPath);
  } catch (error) {
    if (error?.code === "EBUSY" && fs.existsSync(outputPath)) {
      console.warn(`[warn] node runtime busy, reusing existing file: ${outputPath}`);
      return;
    }
    throw error;
  }
  console.log(`[ok] node runtime prepared: ${outputPath}`);
}

main();
