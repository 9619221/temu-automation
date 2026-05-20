/**
 * 聚协云运行时抢拷器:robot1 一跑,聚协云会把 robot.code 解密成 raw_robot.code
 * 落到插件目录(运行后删除)。本脚本高频轮询,一出现立即拷走,并抓新任务日志。
 * 只读取产品自身在本机生成的明文,不修改聚协云任何文件。
 */
const fs = require("fs");
const path = require("path");

const PP = path.join(process.env.APPDATA, "droplet-client", "pluginPackages");
const TASKS_LOG = path.join(process.env.APPDATA, "droplet-client", "logs", "tasks");
const OUT = path.join(__dirname, "..", "logs", "juxieyun-capture", "runtime");
fs.mkdirSync(OUT, { recursive: true });

const ROBOT1 = "6548830bb109da9db3dd0606"; // TEMU销量数据导入ERP
const seen = new Map(); // src -> last size copied
const startedAt = Date.now();

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function snapshot(src, label) {
  try {
    const st = fs.statSync(src);
    if (seen.get(src) === st.size && st.size > 0) return;
    seen.set(src, st.size);
    const dst = path.join(OUT, `${label}__${ts()}__${st.size}b${path.extname(src) || ".txt"}`);
    fs.copyFileSync(src, dst);
    console.log(`[抢到] ${label} ${st.size}B -> ${path.basename(dst)}`);
  } catch (e) {
    if (e.code !== "ENOENT" && e.code !== "EBUSY") console.log(`[err] ${label}: ${e.message}`);
  }
}

function scan() {
  // 1) 所有插件目录下的解密源码 / 参数文件
  let dirs = [];
  try { dirs = fs.readdirSync(PP); } catch {}
  for (const d of dirs) {
    const inner = path.join(PP, d, d);
    for (const f of ["raw_robot.code", "raw_args", "args.json", "raw_robot_args.code"]) {
      const fp = path.join(inner, f);
      if (fs.existsSync(fp)) snapshot(fp, `${d === ROBOT1 ? "ROBOT1" : d.slice(0, 6)}_${f}`);
    }
  }
  // 2) 本次启动后新增/更新的任务日志
  try {
    for (const lf of fs.readdirSync(TASKS_LOG)) {
      const fp = path.join(TASKS_LOG, lf);
      const st = fs.statSync(fp);
      if (st.mtimeMs >= startedAt - 5000) snapshot(fp, `tasklog_${lf.slice(0, 12)}`);
    }
  } catch {}
}

console.log("====================================================");
console.log(" 聚协云运行时抢拷器已启动");
console.log(` robot1 插件: ${ROBOT1} (TEMU销量数据导入ERP)`);
console.log(` 产物落盘: ${OUT}`);
console.log(" 现在请在聚协云里【手动运行 robot1(TEMU销量数据导入ERP)】");
console.log(" 抢到 ROBOT1_raw_robot.code 即说明拿到解密源码。");
console.log("====================================================");

const timer = setInterval(scan, 150);
process.on("SIGINT", () => { clearInterval(timer); console.log("\n停止抢拷。"); process.exit(0); });
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
