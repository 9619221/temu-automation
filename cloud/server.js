import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { migrate } from "./db/migrate.js";
import authRoute from "./routes/auth.js";
import ingestRoute from "./routes/ingest.js";
import hookRoute from "./routes/hook.js";
import dashboardRoute from "./routes/dashboard.js";
import notifyRoute from "./routes/notify.js";

dotenv.config();

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

app.use((err, _req, res, _next) => {
  console.error("[err]", err);
  res.status(500).json({ error: err.message || "internal" });
});

const PORT = Number(process.env.PORT || 8788);
app.listen(PORT, () => {
  console.log(`[cloud] listening on http://localhost:${PORT}`);
});
