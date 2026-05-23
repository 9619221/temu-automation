import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { authMiddleware } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = Router();

// hook 脚本本体：默认从同 monorepo 下扩展的 web/page/hook.js 读
// 部署时可以把 hook.js 拷到 cloud/data/hook.js 走自定义路径
const HOOK_PATH = process.env.HOOK_PATH
  ? path.resolve(process.env.HOOK_PATH)
  : path.resolve(__dirname, "../../extension/web/page/hook.js");

let cache = null; // { content, etag, mtime }

function loadHook() {
  const content = fs.readFileSync(HOOK_PATH, "utf8");
  const stat = fs.statSync(HOOK_PATH);
  const etag = `"${crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)}"`;
  cache = { content, etag, mtime: stat.mtimeMs };
  return cache;
}

function getHookFresh() {
  if (!cache) return loadHook();
  try {
    const stat = fs.statSync(HOOK_PATH);
    if (stat.mtimeMs !== cache.mtime) return loadHook();
  } catch {}
  return cache;
}

r.get("/v1/inject.js", authMiddleware, (req, res) => {
  let h;
  try { h = getHookFresh(); }
  catch (e) { return res.status(500).json({ error: "hook_load_failed", detail: String(e.message) }); }

  const ifNone = req.headers["if-none-match"];
  if (ifNone === h.etag) return res.status(304).end();
  res.setHeader("ETag", h.etag);
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.send(h.content);
});

// 配置热更（白名单 / 黑名单）
// M2 阶段：从扩展端 hook-config.js 提取 export const，简单 vm 沙箱
// M3 阶段：改成数据库可编辑
r.get("/v1/config", authMiddleware, async (req, res) => {
  try {
    const cfgPath = path.resolve(__dirname, "../../extension/web/background/hook-config.js");
    const src = fs.readFileSync(cfgPath, "utf8");
    const cjsified = src.replace(/^export\s+const\s+/gm, "exports.").replace(/^export\s+/gm, "exports.");
    const sandbox = { exports: {} };
    sandbox.module = { exports: sandbox.exports };
    const vm = await import("vm");
    vm.createContext(sandbox);
    vm.runInContext(cjsified, sandbox);
    res.json({
      URL_WHITELIST: sandbox.exports.URL_WHITELIST || [],
      URL_BLACKLIST: sandbox.exports.URL_BLACKLIST || [],
      URL_DISCOVERY_ALLOWLIST: sandbox.exports.URL_DISCOVERY_ALLOWLIST || [],
      DISCOVERY_MAX_BODY_CHARS: sandbox.exports.DISCOVERY_MAX_BODY_CHARS || 60000,
      EVENT_NAME: sandbox.exports.EVENT_NAME,
      BYPASS_SYMBOL_KEY: sandbox.exports.BYPASS_SYMBOL_KEY,
      version: cache?.etag || "unknown",
    });
  } catch (e) {
    res.status(500).json({ error: "config_load_failed", detail: String(e.message) });
  }
});

export default r;
