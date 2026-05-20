/**
 * 聚协云(jxy.erp321.com)网络被动录制器
 *
 * 用途:打开浏览器停在聚协云,由人工手动走业务流程,
 * 脚本在旁监听并把所有 API 请求/响应持续落盘,供后续反推数据来源。
 *
 * 这是一次性调研工具,不接入 ERP,不修改现有采集器。
 *
 * 运行:
 *   node scripts/record-juxieyun-network.cjs
 *   node scripts/record-juxieyun-network.cjs --url=https://jxy.erp321.com/purchaser/...
 *
 * 产物(logs/juxieyun-capture/):
 *   - requests.jsonl  每行一条:时间/方法/URL/postData/状态/响应体片段
 *   - bodies/<seq>.json  完整 JSON 响应体(便于细看字段)
 *
 * 录完后 Ctrl+C 结束。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_URL = "https://jxy.erp321.com/purchaser/user/login";
const MAX_INLINE_BODY = 4000; // jsonl 内联响应体截断长度
const MAX_FULL_BODY = 2_000_000; // 单个完整 body 文件上限

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function findChromeExecutable() {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    localAppData && path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  return candidates.find((item) => fs.existsSync(item)) || null;
}

async function main() {
  const targetUrl = readArg("url", DEFAULT_URL);
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  // 独立 profile,避免污染现有 jushuitan-chrome-profile;聚协云需单独登录
  const userDataDir = path.join(appData, "temu-automation", "juxieyun-record-profile");
  const outDir = path.join(__dirname, "..", "logs", "juxieyun-capture");
  const bodiesDir = path.join(outDir, "bodies");
  fs.mkdirSync(bodiesDir, { recursive: true });
  const jsonlPath = path.join(outDir, "requests.jsonl");
  const jsonlStream = fs.createWriteStream(jsonlPath, { flags: "a" });

  const { chromium } = require("playwright");
  fs.mkdirSync(userDataDir, { recursive: true });
  const executablePath = findChromeExecutable();
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: executablePath || undefined,
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  let seq = 0;
  const attach = (page) => {
    page.on("response", async (response) => {
      try {
        const request = response.request();
        const resourceType = request.resourceType();
        if (!["xhr", "fetch"].includes(resourceType)) return;
        const url = response.url();
        const contentType = response.headers()["content-type"] || "";
        // 只关心数据接口
        if (!/json|text\/plain/i.test(contentType)
          && !/api|ajax|query|list|search|load|webapi|\.aspx|\.ashx/i.test(url)) return;
        const postData = request.postData() || "";
        const body = await response.text().catch(() => "");
        seq += 1;
        const id = String(seq).padStart(5, "0");
        let savedFile = "";
        const trimmed = body.trim();
        if (trimmed && /^[{[]/.test(trimmed) && body.length <= MAX_FULL_BODY) {
          savedFile = path.join("bodies", `${id}.json`);
          fs.writeFileSync(path.join(outDir, savedFile), body);
        }
        const entry = {
          seq,
          ts: new Date().toISOString(),
          method: request.method(),
          url,
          status: response.status(),
          contentType,
          postData: postData.slice(0, 2000),
          bodyPreview: body.slice(0, MAX_INLINE_BODY),
          bodyLen: body.length,
          savedFile,
        };
        jsonlStream.write(`${JSON.stringify(entry)}\n`);
        console.log(`[${id}] ${request.method()} ${response.status()} ${url.slice(0, 110)}`);
      } catch {}
    });
  };

  context.pages().forEach(attach);
  context.on("page", attach);

  const page = context.pages()[0] || await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => {
    console.error(`[警告] 打开 ${targetUrl} 失败: ${e?.message || e}`);
  });
  await page.bringToFront().catch(() => {});

  console.log("====================================================");
  console.log(" 聚协云网络录制已启动");
  console.log(` 目标: ${targetUrl}`);
  console.log(` 落盘: ${jsonlPath}`);
  console.log(" 请在打开的浏览器里完成登录,然后手动走一遍业务流程。");
  console.log(" 完成后回到此终端按 Ctrl+C 结束录制。");
  console.log("====================================================");

  const shutdown = async () => {
    console.log("\n正在结束录制...");
    jsonlStream.end();
    await context.close().catch(() => {});
    console.log(`录制完成,共 ${seq} 条接口记录 -> ${jsonlPath}`);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // 浏览器被手动关闭时也收尾
  context.on("close", shutdown);
}

main().catch((error) => {
  console.error(`[致命] ${error?.stack || error}`);
  process.exit(1);
});
