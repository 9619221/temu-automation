#!/usr/bin/env node
/**
 * Live, sanitized watcher for Juxieyun TEMU settlement upload events.
 *
 * It watches local droplet task logs and records upload metadata only:
 * businessType/type/shopId/date range/fileName. It intentionally does not emit
 * tokens, cookies or signed upload URLs.
 */
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { inspectJuxieyunSettlementLogs, cleanFileName } = require("./inspect-juxieyun-settlement-logs.cjs");

function argValue(name, argv = process.argv) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : null;
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function defaultLogDir() {
  return path.join(process.env.APPDATA || "", "droplet-client", "logs", "tasks");
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function defaultOutFile() {
  return path.join(process.cwd(), "exports", `juxieyun-settlement-upload-events-${stamp()}.jsonl`);
}

function eventKey(ev) {
  return [ev.source, ev.time, ev.businessType, ev.type, ev.shopId, ev.area, ev.fileName].join("|");
}

function safeEvent(ev) {
  return {
    capturedAt: new Date().toISOString(),
    source: ev.source || "",
    time: ev.time || null,
    businessType: ev.businessType || "unknown",
    type: ev.type || "",
    shopId: ev.shopId || "",
    area: ev.area || "",
    rpaParam: ev.rpaParam || "",
    fileName: ev.fileName ? cleanFileName(ev.fileName) : "",
    ...(ev.localFile ? { localFile: ev.localFile } : {}),
    ...(ev.downloadStatus ? { downloadStatus: ev.downloadStatus } : {}),
  };
}

function printEvent(ev) {
  const area = ev.area ? `/${ev.area}` : "";
  const type = ev.type ? ` ${ev.type}` : "";
  const shop = ev.shopId ? ` shop=${ev.shopId}` : "";
  console.log(`[upload] ${ev.time || "?"} ${ev.businessType}${type}${area}${shop} file=${ev.fileName}`);
}

function readEvents(opts) {
  const report = inspectJuxieyunSettlementLogs({
    logDir: opts.logDir,
    file: opts.file,
    latest: opts.latest,
    includeRows: true,
    includeUrls: Boolean(opts.downloadDir),
  });
  return report.events || [];
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function safeBasename(name, fallback) {
  const base = path.basename(String(name || fallback || "upload.xlsx"));
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180) || "upload.xlsx";
}

function downloadToFile(url, file, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); }
    catch (error) { reject(error); return; }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      reject(new Error("unsupported protocol"));
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(parsed, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        downloadToFile(next, file, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const out = fs.createWriteStream(file);
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
      out.on("error", reject);
    });
    req.setTimeout(30_000, () => {
      req.destroy(new Error("download timeout"));
    });
    req.on("error", reject);
  });
}

async function attachDownload(ev, opts) {
  if (!opts.downloadDir) return ev;
  if (!ev.fileUrl) return { ...ev, downloadStatus: "missing-url" };

  const name = safeBasename(ev.fileName, `${ev.businessType || "upload"}-${Date.now()}.xlsx`);
  const file = path.join(opts.downloadDir, name);
  try {
    await downloadToFile(ev.fileUrl, file);
    return { ...ev, localFile: file, downloadStatus: "ok" };
  } catch (error) {
    return { ...ev, downloadStatus: `failed:${error.message || error}` };
  }
}

async function main() {
  const opts = {
    logDir: argValue("--log-dir") || defaultLogDir(),
    file: argValue("--file") || "",
    latest: !hasFlag("--all"),
    intervalMs: Number(argValue("--interval-ms") || 1000),
    durationMs: Number(argValue("--duration-ms") || 0),
    emitExisting: hasFlag("--emit-existing"),
    outFile: argValue("--out") || defaultOutFile(),
    downloadDir: argValue("--download-dir") || "",
  };

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  if (opts.downloadDir) fs.mkdirSync(opts.downloadDir, { recursive: true });

  const seen = new Set();
  if (!opts.emitExisting) {
    for (const ev of readEvents(opts)) seen.add(eventKey(ev));
  }

  console.log("Watching Juxieyun TEMU settlement upload events");
  console.log(`Log dir: ${opts.logDir}`);
  if (opts.file) console.log(`Log file: ${opts.file}`);
  console.log(`Mode: ${opts.latest ? "latest matching settlement log" : "all matching settlement logs"}`);
  console.log(`Output: ${opts.outFile}`);
  if (opts.downloadDir) console.log(`Download dir: ${opts.downloadDir}`);
  console.log("Press Ctrl+C to stop.");

  const startedAt = Date.now();
  while (true) {
    const fresh = [];
    for (const ev of readEvents(opts)) {
      const key = eventKey(ev);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(await attachDownload(ev, opts));
    }

    for (const ev of fresh) {
      fs.appendFileSync(opts.outFile, `${JSON.stringify(safeEvent(ev))}\n`, "utf8");
      printEvent(ev);
    }

    if (opts.durationMs > 0 && Date.now() - startedAt >= opts.durationMs) break;
    await sleep(Math.max(250, opts.intervalMs));
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
