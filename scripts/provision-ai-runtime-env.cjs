"use strict";

// 从 electron/default-credentials.cjs 的 getDefaultCredentials() 派生
// build/auto-image-gen-runtime/.env.local，保证打包进安装包的 image-studio
// 运行时凭证与桌面端 default-credentials 完全一致（verify:release 据此校验）。
//
// 背景：build:image-studio 会把本地 ~/auto-image-gen-dev/.env.local（开发态：
// 直连 vectorengine/grsai + 真实 sk-key）拷进 build/，与发布态（走 erp.temu.chat
// 云代理 + 半公开桌面 token）不一致，导致 verify:release 失败。此脚本在
// build:image-studio 之后、verify:release 之前覆盖为发布态，杜绝开发密钥进安装包。
//
// 尊重 TEMU_AI_PROXY_BASE / TEMU_AI_DESKTOP_TOKEN 覆盖：getDefaultCredentials()
// 本身读这些 env，所以特殊上游构建只需设这两个 env 即可，无需改本脚本。

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outPath = path.join(repoRoot, "build", "auto-image-gen-runtime", ".env.local");
const { getDefaultCredentials } = require(path.join(repoRoot, "electron", "default-credentials.cjs"));

const c = getDefaultCredentials();

// .env 键名 -> getDefaultCredentials 字段名（与 ~/auto-image-gen-dev/.env.local 同构）
const MAP = {
  ANALYZE_API_KEY: "analyzeApiKey",
  ANALYZE_BASE_URL: "analyzeBaseUrl",
  ANALYZE_MODEL: "analyzeModel",
  GENERATE_API_KEY: "generateApiKey",
  GENERATE_BASE_URL: "generateBaseUrl",
  GENERATE_MODEL: "generateModel",
  GPT_GENERATE_API_KEY: "gptGenerateApiKey",
  GPT_GENERATE_BASE_URL: "gptGenerateBaseUrl",
  GPT_GENERATE_MODEL: "gptGenerateModel",
  GENERATE_MODEL_OVERRIDES: "gptGenerateModelOverrides",
  GENERATE_QUALITY_TIER: "gptGenerateQualityTier",
  // 生图子进程鉴权 secret（Bearer）。漏了会让 /api/history 等本地接口报「未授权访问」。
  // 必须纳入白名单，否则本脚本的全覆盖写会把 build:image-studio 拷进来的 API_SECRET 抹掉。
  API_SECRET: "apiSecret",
};

const lines = [];
const missing = [];
for (const [envKey, credKey] of Object.entries(MAP)) {
  const v = c[credKey];
  if (v === undefined || v === null || v === "") missing.push(`${envKey}(${credKey})`);
  lines.push(`${envKey}=${v == null ? "" : String(v)}`);
}
if (missing.length) {
  throw new Error(`provision-ai-runtime-env: getDefaultCredentials() 缺字段: ${missing.join(", ")}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

const mask = (s) => (typeof s === "string" && s.length > 10 ? s.slice(0, 8) + `...(${s.length})` : String(s));
console.log(`[ok] provisioned ${path.relative(repoRoot, outPath)} from default-credentials.getDefaultCredentials()`);
console.log(`     ANALYZE_BASE_URL=${c.analyzeBaseUrl}  ANALYZE_MODEL=${c.analyzeModel}  ANALYZE_API_KEY=${mask(c.analyzeApiKey)}`);
console.log(`     GENERATE_BASE_URL=${c.generateBaseUrl}`);
