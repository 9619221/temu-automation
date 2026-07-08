import { parentPort } from "node:worker_threads";
import crypto from "node:crypto";
import { getDb } from "./db/connection.js";
import { dispatchParsers } from "./parsers.js";

// ============================================================
// 采集入库 worker 线程：承接 /v1/batch 的「enrich + 落库 + parser」全部重活。
// 背景：better-sqlite3 是同步库，洪峰期在主线程写库会把事件循环卡死几十秒，
// login/dashboard/心跳全部 502（2026-07-08 事故）。主线程只做鉴权+入队+应答，
// 本 worker 串行消费，卡的只是自己。
// 注意：本文件的 enrich 逻辑与 routes/ingest.js 顶部工具函数保持同一语义，
// 改动需两处同步（worker 无法 import routes/ingest.js——会循环依赖）。
// ============================================================

const MAX_STORE_BODY = 200_000;
const NON_BUSINESS_PATH_RE = /\/bitable\/|\/space\/api\//;

function parseRequestBodyText(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  try {
    const params = new URLSearchParams(trimmed);
    const value = params.get("data") || params.get("param") || params.get("params");
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function attachRequestBody(responseBody, requestBodyText) {
  const requestBody = parseRequestBodyText(requestBodyText);
  if (!requestBody) return responseBody;
  if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
    return { ...responseBody, __request: requestBody };
  }
  return { result: responseBody, __request: requestBody };
}

const db = getDb();
// 与主线程连接并发写 WAL：碰撞时等锁而不是抛 SQLITE_BUSY
db.pragma("busy_timeout = 15000");

const insertEvt = db.prepare(`
  INSERT INTO capture_events
  (id, tenant_id, device_id, mall_id, site, page, kind, method, url, url_path, status, body_size, body_json, ts, captured_at, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const upsertStat = db.prepare(`
  INSERT INTO api_endpoint_stats (tenant_id, site, method, url_path, count_total, last_seen)
  VALUES (?, ?, ?, ?, 1, ?)
  ON CONFLICT(tenant_id, site, method, url_path)
  DO UPDATE SET count_total = count_total + 1, last_seen = excluded.last_seen
`);
const upsertMall = db.prepare(`
  INSERT INTO mall_accounts (id, tenant_id, site, mall_id, mall_name, last_seen)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(tenant_id, site, mall_id)
  DO UPDATE SET
    mall_name = COALESCE(excluded.mall_name, mall_accounts.mall_name),
    last_seen = excluded.last_seen
`);

function enrichOne(it, now) {
  const url = it.url || "";
  const url_path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || url;
  const method = (it.method || "GET").toUpperCase();
  const storedBody = attachRequestBody(it.body || null, it.requestBodyText);
  const parser_json = storedBody ? JSON.stringify(storedBody).slice(0, 1_000_000) : null;
  const skipRow = NON_BUSINESS_PATH_RE.test(url_path);
  const isPerfEvent = String(it.kind || "").startsWith("perf");
  const body_json = (isPerfEvent || !parser_json || parser_json.length > MAX_STORE_BODY) ? null : parser_json;
  return { id: crypto.randomUUID(), url, url_path, method, body_json, parser_json, skipRow, it };
}

const CHUNK = 150;

function processBatch({ tenant_id, device_id, items, now }) {
  let inserted = 0;
  const txChunk = db.transaction((chunk) => {
    for (const e of chunk) {
      if (e.skipRow) continue;
      insertEvt.run(
        e.id, tenant_id, device_id,
        e.it.mall_id || null, e.it.site || null, e.it.page || null,
        e.it.kind || "unknown", e.method, e.url, e.url_path,
        e.it.status ?? null, e.it.bodySize ?? null, e.body_json,
        Number(e.it.ts) || now, Number(e.it.captured_at) || now, now
      );
      upsertStat.run(tenant_id, e.it.site || "", e.method, e.url_path, now);
      if (e.it.mall_id) {
        upsertMall.run(crypto.randomUUID(), tenant_id, e.it.site || "", String(e.it.mall_id), e.it.mall_name || null);
      }
      inserted++;
    }
  });
  for (let i = 0; i < items.length; i += CHUNK) {
    const enriched = items.slice(i, i + CHUNK).map((it) => enrichOne(it, now));
    txChunk(enriched);
    try {
      const parserItems = enriched.filter((e) => !e.skipRow).map((e) => ({
        id: e.id,
        url_path: e.url_path,
        page: e.it.page || null,
        body_json: e.parser_json,
        ts: Number(e.it.ts) || now,
        mall_id: e.it.mall_id || null,
        site: e.it.site || null,
      }));
      dispatchParsers(db, { tenant_id, device_id }, parserItems);
    } catch (e) {
      console.warn("[ingest-worker] dispatchParsers failed:", e?.message);
    }
  }
  return inserted;
}

parentPort.on("message", (msg) => {
  try {
    const inserted = processBatch(msg);
    parentPort.postMessage({ id: msg.id, ok: true, inserted, itemCount: msg.items.length });
  } catch (e) {
    console.error("[ingest-worker] batch failed:", e?.message);
    parentPort.postMessage({ id: msg.id, ok: false, error: String(e?.message || e), itemCount: msg.items.length });
  }
});
