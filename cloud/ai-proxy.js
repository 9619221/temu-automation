import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ============================================================
// 独立 AI 代理进程：只挂 /api/ai 路由，与采集(ingest)进程隔离。
// 背景：cloud 主进程收采集洪峰时事件循环长时间卡死（better-sqlite3
// 同步写 4GB 库），同进程的 AI 生图代理被殃及全灭（2026-07-08 事故）。
// 本进程无任何数据库依赖，采集再卡也不影响出图。
// 部署：systemd temu-ai-proxy.service，端口 AI_PROXY_PORT(默认 8790)，
// 两台网关的 /api/ai/* 均指向本进程。
// ============================================================

const { default: aiRoute } = await import("./routes/ai.js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.url}`);
  next();
});

app.use("/api/ai", aiRoute);

app.use((err, _req, res, _next) => {
  console.error("[err]", err);
  if (!res.headersSent) res.status(500).json({ error: err.message || "internal" });
});

const PORT = Number(process.env.AI_PROXY_PORT || 8790);
app.listen(PORT, process.env.AI_PROXY_BIND || "127.0.0.1", () => {
  console.log(`[ai-proxy] listening :${PORT}`);
});
