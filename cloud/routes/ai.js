import { Router } from "express";
import { Readable } from "node:stream";
import { authMiddleware } from "../middleware/auth.js";

// ============================================================
// AI 代理：客户端只带自己的登录态(JWT)，真正的 AI Key 只存在
// 服务器环境变量里，永不下发到桌面端/扩展。
//
// 透传式设计：对任意上游路径与 body 原样转发，仅替换 Authorization
// 头为服务端持有的真 Key。这样桌面端只需把 baseUrl 指到本代理、
// 把 apiKey 换成用户 JWT，无需了解上游协议细节。
//   /api/ai/analyze/*   -> AI_ANALYZE_BASE_URL   (vectorengine, 图像分析/文本)
//   /api/ai/generate/*  -> AI_GENERATE_BASE_URL  (grsai, 生图)
// ============================================================

const r = Router();

// 注意：在“请求时”读取 env，而不是模块顶层常量。
// 因为 ESM import 会先于 server.js 的 dotenv.config() 执行，
// 顶层读 process.env 会拿不到 .env 里的值。
function getUpstream(kind) {
  if (kind === "generate") {
    return {
      base: process.env.AI_GENERATE_BASE_URL || "https://grsaiapi.com",
      key: process.env.AI_GENERATE_KEY || "",
    };
  }
  return {
    base: process.env.AI_ANALYZE_BASE_URL || "https://api.vectorengine.cn/v1",
    key: process.env.AI_ANALYZE_KEY || "",
  };
}

// 健康检查无需鉴权：只暴露“是否已配置 key”，不泄露 key 本身
r.get("/health", (_req, res) => {
  res.json({
    ok: true,
    analyze: Boolean(getUpstream("analyze").key),
    generate: Boolean(getUpstream("generate").key),
  });
});

// 鉴权：接受 cloud 用户 JWT；或桌面端共享 token(AI_DESKTOP_TOKEN)。
// 桌面端 image-studio 子进程用后者，避免下发真实 AI Key。
// 该 token 泄露可在服务端 .env 随时更换，且代理层可限流/记账。
function authOrDesktopToken(req, res, next) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || "");
  const tok = m && m[1];
  const desk = process.env.AI_DESKTOP_TOKEN || "";
  if (tok && desk && tok === desk) {
    req.user = { uid: "desktop", tid: "desktop", role: "desktop" };
    return next();
  }
  return authMiddleware(req, res, next);
}
r.use(authOrDesktopToken);

// 简易每用户限流：默认每分钟 60 次，防被盗用账号刷爆
const RL = new Map();
const RL_MAX = Number(process.env.AI_RATE_PER_MIN || 60);
function rateLimited(uid) {
  const now = Date.now();
  const e = RL.get(uid);
  if (!e || e.exp < now) {
    RL.set(uid, { n: 1, exp: now + 60000 });
    return false;
  }
  e.n += 1;
  return e.n > RL_MAX;
}

async function proxy(kind, req, res) {
  const up = getUpstream(kind);
  if (!up.key) {
    res.status(503).json({ error: `ai_${kind}_key_not_configured` });
    return;
  }
  if (rateLimited(req.user.uid)) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  const subPath = req.params[0] ? `/${req.params[0]}` : "";
  const qsIndex = req.originalUrl.indexOf("?");
  const qs = qsIndex >= 0 ? req.originalUrl.slice(qsIndex) : "";
  const url = up.base.replace(/\/+$/, "") + subPath + qs;

  const headers = {
    "Content-Type": req.headers["content-type"] || "application/json",
    Accept: req.headers["accept"] || "application/json",
    Authorization: `Bearer ${up.key}`,
  };

  const hasBody = !["GET", "HEAD"].includes(req.method);

  // 超时模型（流式与非流式分治）：
  //  - 连接超时 AI_CONNECT_TIMEOUT_MS(默认60s)：等待上游返回响应头
  //  - 流式空闲超时 AI_IDLE_TIMEOUT_MS(默认120s)：拿到 SSE 流后，连续这么久收不到任何
  //    字节才中止。grsai /v1/draw/* 这类持续推 processing 心跳、整体数分钟的生图流不会
  //    被误杀（旧实现用整体180s硬超时缓冲整流，长生图必撞墙 → 502 "operation was aborted"）。
  //  - 流式总时长上限 AI_MAX_STREAM_MS(默认600s)：防上游只推心跳永不结束导致连接泄漏
  //  - 非流式整体超时 AI_TIMEOUT_MS(默认180s)：analyze 等一次性 JSON 响应沿用旧语义
  const CONNECT_MS = Number(process.env.AI_CONNECT_TIMEOUT_MS || 60000);
  const IDLE_MS = Number(process.env.AI_IDLE_TIMEOUT_MS || 120000);
  const MAX_STREAM_MS = Number(process.env.AI_MAX_STREAM_MS || 600000);
  const TOTAL_MS = Number(process.env.AI_TIMEOUT_MS || 180000);

  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), CONNECT_MS);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: controller.signal,
    });
    const ct = upstream.headers.get("content-type") || "application/json";
    const isStream = /text\/event-stream/i.test(ct);

    if (isStream && upstream.body) {
      // —— SSE 流式透传：边收边发，不缓冲整流；空闲超时 + 总时长上限兜底 ——
      clearTimeout(timer);
      res.status(upstream.status);
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      const startedAt = Date.now();
      const node = Readable.fromWeb(upstream.body);
      let idleTimer = null;
      const stop = (reason) => {
        if (idleTimer) clearTimeout(idleTimer);
        if (!node.destroyed) node.destroy(new Error(reason));
        controller.abort();
      };
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          stop("max stream duration exceeded");
          return;
        }
        idleTimer = setTimeout(() => stop("idle timeout"), IDLE_MS);
      };
      armIdle();
      node.on("data", armIdle);
      node.on("end", () => {
        if (idleTimer) clearTimeout(idleTimer);
        console.log(`[ai] uid=${req.user.uid} tid=${req.user.tid} ${kind}${subPath} -> ${upstream.status} STREAM ${Date.now() - startedAt}ms`);
      });
      node.on("error", (e) => {
        if (idleTimer) clearTimeout(idleTimer);
        console.warn(`[ai] uid=${req.user.uid} ${kind}${subPath} STREAM ERROR ${String(e?.message || e)} ${Date.now() - startedAt}ms`);
        if (!res.writableEnded) res.destroy();
      });
      // 客户端提前断开：中止上游 fetch，避免 grsai 连接泄漏
      res.on("close", () => stop("client closed"));
      node.pipe(res);
      return;
    }

    // —— 非流式：缓冲整个响应体后一次性返回（沿用旧逻辑），整体超时 AI_TIMEOUT_MS ——
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), TOTAL_MS);
    const buf = Buffer.from(await upstream.arrayBuffer());
    console.log(`[ai] uid=${req.user.uid} tid=${req.user.tid} ${kind}${subPath} -> ${upstream.status} ${buf.length}B`);
    res.status(upstream.status);
    res.setHeader("Content-Type", ct);
    res.send(buf);
  } catch (e) {
    const msg = String(e?.message || e);
    console.warn(`[ai] uid=${req.user.uid} ${kind}${subPath} ERROR ${msg}`);
    if (!res.headersSent) {
      res.status(502).json({ error: "ai_upstream_error", detail: msg.slice(0, 300) });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  } finally {
    clearTimeout(timer);
  }
}

r.all("/analyze/*", (req, res) => proxy("analyze", req, res));
r.all("/generate/*", (req, res) => proxy("generate", req, res));

export default r;
