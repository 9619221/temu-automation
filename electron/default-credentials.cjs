"use strict";

// AI 调用默认走云端代理（https://erp.temu.chat/api/ai）。真实 AI Key 只存在
// 服务器 .env，不再内置到客户端。这里内置的是“桌面端代理 token”（半公开，
// 可在服务端 .env 随时更换，并在代理层限流/记账），比内置真实 AI Key 安全得多。
// 用户仍可在 Settings -> AI 服务 填自己的 Key + BaseUrl 覆盖默认（改为直连自有上游）。

const PROXY_BASE = process.env.TEMU_AI_PROXY_BASE || "https://erp.temu.chat/api/ai";
// 桌面端代理 token（对应服务器 cloud .env 的 AI_DESKTOP_TOKEN）
const DESKTOP_TOKEN = process.env.TEMU_AI_DESKTOP_TOKEN || "0b8f5be546c34cd841ae485bb6a2305dacb9ff06422cbaa7";

function getDefaultCredentials() {
  return {
    analyzeApiKey: DESKTOP_TOKEN,
    analyzeBaseUrl: PROXY_BASE + "/analyze",
    analyzeModel: "gpt-5.5",
    generateApiKey: DESKTOP_TOKEN,
    generateBaseUrl: PROXY_BASE + "/generate",
    generateModel: "gpt-image-2",
    gptGenerateApiKey: DESKTOP_TOKEN,
    gptGenerateBaseUrl: PROXY_BASE + "/generate",
    gptGenerateModel: "gpt-image-2",
    gptGenerateModelOverrides: JSON.stringify({
      features: "gpt-image-2",
      closeup: "gpt-image-2",
      dimensions: "gpt-image-2",
    }),
    gptGenerateQualityTier: "premium",
  };
}

module.exports = { getDefaultCredentials };
