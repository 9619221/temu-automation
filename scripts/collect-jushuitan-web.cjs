const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");
const { JushuitanWebCollector, DEFAULT_JST_URL } = require("../electron/erp/jushuitanWebCollector.cjs");
const { JushuitanService } = require("../electron/erp/services/jushuitanService.cjs");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function readNumberArg(name, fallback) {
  const number = Number(readArg(name, ""));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const url = readArg("url", DEFAULT_JST_URL);
  const sourceKey = readArg("source", "");
  const maxPages = Math.max(1, Math.min(readNumberArg("pages", 1), 50));
  const waitMs = Math.max(10_000, Math.min(readNumberArg("wait-ms", 600_000), 1_800_000));
  const startedAt = Date.now();

  const db = openErpDatabase();
  runMigrations({ db });

  const collector = new JushuitanWebCollector();
  const service = new JushuitanService({
    db,
    webCollectorFactory: () => collector,
  });

  try {
    const opened = await service.openWebCollector({ url });
    console.log(JSON.stringify({ step: "opened", ...opened }, null, 2));

    let probe = null;
    while (Date.now() - startedAt < waitMs) {
      probe = await collector.collect({
        maxPages: 1,
        maxScrolls: 0,
        maxRecords: 30,
        captureNetwork: false,
      });
      console.log(JSON.stringify({
        step: "probe",
        url: probe.url,
        title: probe.title,
        loginLikely: probe.loginLikely,
        domCount: probe.domCount,
        networkCount: probe.networkCount,
      }));
      if (!probe.loginLikely) break;
      await sleep(8000);
    }

    if (probe?.loginLikely) {
      console.log(JSON.stringify({
        ok: false,
        needLogin: true,
        message: "聚水潭仍停在登录页，请在已打开的浏览器完成登录后重新运行采集。",
        url: probe.url,
        title: probe.title,
      }, null, 2));
      process.exitCode = 2;
      return;
    }

    const result = await service.collectWebPage({
      sourceKey: sourceKey || undefined,
      maxPages,
      maxScrolls: 5,
      autoNext: maxPages > 1,
      captureNetwork: true,
    }, { role: "admin", companyId: "company_default" });
    console.log(JSON.stringify({
      ok: true,
      sourceKey: result.sourceKey,
      label: result.label,
      importedRows: result.importedRows,
      domCount: result.domCount,
      networkCount: result.networkCount,
      pageCount: result.pageCount,
      url: result.url,
      title: result.title,
      jobId: result.jobId,
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    stack: error?.stack || "",
  }, null, 2));
  process.exitCode = 1;
});
