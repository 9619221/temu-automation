import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { migrate } from "./db/migrate.js";
import { getDb } from "./db/connection.js";
import authRoute from "./routes/auth.js";
import ingestRoute from "./routes/ingest.js";
import hookRoute from "./routes/hook.js";
import dashboardRoute from "./routes/dashboard.js";
import notifyRoute from "./routes/notify.js";
import aiRoute from "./routes/ai.js";

dotenv.config();

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const r = migrate();
console.log(`[boot] migrations: ${r.ran} ran (${r.total} total)`);

const app = express();
app.use(cors({ exposedHeaders: ["ETag"] }));
app.use(express.json({ limit: "20mb" }));
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.url} ua="${(req.headers["user-agent"] || "").slice(0, 60)}"`);
  next();
});

// 静态控制台：访问 /console / /console.html
app.use("/console", express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  // 根路径重定向到控制台（旧 JSON 元信息搬到 /api/_meta）
  res.redirect("./console/console.html");
});
app.get("/api/_meta", (_req, res) => {
  res.json({ name: "temu-monitor-cloud", version: "0.1.0", ts: Date.now() });
});

app.use("/api/auth", authRoute);
app.use("/api/ingest", ingestRoute);
app.use("/api/hook", hookRoute);
app.use("/api/dashboard", dashboardRoute);
app.use("/api/notify", notifyRoute);
app.use("/api/ai", aiRoute);

app.use((err, _req, res, _next) => {
  console.error("[err]", err);
  res.status(500).json({ error: err.message || "internal" });
});

// 定期清理：防止 capture_events 等表无限膨胀
const CLEANUP_INTERVAL = 6 * 3600_000;
function runCleanup() {
  try {
    const db = getDb();
    const now = Date.now();
    const del = db.prepare("DELETE FROM capture_events WHERE received_at < ?").run(now - 3 * 86400_000);
    const nul = db.prepare("UPDATE capture_events SET body_json = NULL WHERE body_json IS NOT NULL AND received_at < ?").run(now - 2 * 3600_000);
    const rsk = db.prepare("UPDATE temu_operation_risk_snapshot SET raw_json = NULL WHERE raw_json IS NOT NULL AND first_seen_at < datetime('now', '-7 days')").run();
    const stk = db.prepare("UPDATE temu_stock_order_snapshot SET raw_json = NULL WHERE raw_json IS NOT NULL AND first_seen_at < datetime('now', '-7 days')").run();
    const hb = db.prepare("DELETE FROM agent_heartbeats WHERE received_at < ?").run(now - 30 * 86400_000);
    db.pragma("wal_checkpoint(TRUNCATE)");
    console.log(`[cleanup] capture_events: -${del.changes} rows, body_json nulled: ${nul.changes}, risk raw: ${rsk.changes}, stock raw: ${stk.changes}, heartbeats: -${hb.changes}`);
  } catch (e) {
    console.error("[cleanup] error:", e.message);
  }
}
setInterval(runCleanup, CLEANUP_INTERVAL);
setTimeout(runCleanup, 60_000);

const PORT = Number(process.env.PORT || 8788);
// 默认只绑本机回环：公网只能经 Caddy TLS 反代进来，杜绝直连明文端口。
// 局域网自托管模式可用 BIND_ADDRESS=0.0.0.0 覆盖。
const HOST = process.env.BIND_ADDRESS || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`[cloud] listening on http://${HOST}:${PORT}`);
});
