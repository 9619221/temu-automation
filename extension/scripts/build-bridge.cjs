#!/usr/bin/env node
// 构建脚本：把 web/background/hook-config.js 的常量同步到 web/content 下的内联文件，
// 让 content script 在 document_start 同步可用，无需异步等 service worker 回包。
//
// 用法: node scripts/build-bridge.cjs
// 产物: web/content/_config.generated.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "web/background/hook-config.js");
const OUT = path.join(ROOT, "web/content/_config.generated.js");

const src = fs.readFileSync(SRC, "utf8");

// 用 vm sandbox 执行：把所有 export const 转成 module.exports（最小 ESM 仿真）
const cjsified = src.replace(/^export\s+const\s+/gm, "exports.").replace(/^export\s+/gm, "exports.");

const sandbox = { exports: {}, console };
sandbox.module = { exports: sandbox.exports };
vm.createContext(sandbox);
vm.runInContext(cjsified, sandbox);

const cfg = {
  URL_WHITELIST: sandbox.exports.URL_WHITELIST || [],
  URL_BLACKLIST: sandbox.exports.URL_BLACKLIST || [],
  EVENT_NAME: sandbox.exports.EVENT_NAME,
  BYPASS_SYMBOL_KEY: sandbox.exports.BYPASS_SYMBOL_KEY,
  GENERATED_AT: new Date().toISOString(),
  WHITELIST_COUNT: (sandbox.exports.URL_WHITELIST || []).length,
};

const out = `// ! 自动生成，勿手改 — 由 scripts/build-bridge.cjs 同步自 hook-config.js
// 生成时间: ${cfg.GENERATED_AT}
// 白名单数量: ${cfg.WHITELIST_COUNT}
window.__TEMU_MONITOR_BUILD_CONFIG__ = ${JSON.stringify(cfg, null, 2)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, "utf8");

console.log(`[build-bridge] wrote ${path.relative(ROOT, OUT)}`);
console.log(`[build-bridge] whitelist: ${cfg.WHITELIST_COUNT} entries, blacklist: ${cfg.URL_BLACKLIST.length}`);
