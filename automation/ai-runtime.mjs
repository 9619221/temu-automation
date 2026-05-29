import { createGeminiClient } from "./gemini-client.mjs";

export function normalizeChatBaseUrl(value, fallback = "") {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  return raw.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
}

export function normalizeGeminiBaseUrl(value, fallback = "") {
  return normalizeChatBaseUrl(value, fallback).replace(/\/v1$/i, "");
}

function createOpenAICompatibleClient({ apiKey, baseURL, fallbackBaseURL, timeout = 300000, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) return null;
  const endpointBase = normalizeChatBaseUrl(baseURL, fallbackBaseURL);
  return {
    chat: {
      completions: {
        create: async (params = {}) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          try {
            const response = await fetchImpl(`${endpointBase}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: params.model,
                messages: params.messages || [],
                temperature: params.temperature,
                max_tokens: params.max_tokens,
              }),
              signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) {
              const error = new Error(`OpenAI-compatible API ${response.status}: ${text.slice(0, 500)}`);
              error.status = response.status;
              throw error;
            }
            return JSON.parse(text);
          } finally {
            clearTimeout(timer);
          }
        },
      },
    },
  };
}

export function createAiRuntime(env = process.env) {
  // 方案 B：AI 默认走云端代理（真实 Key 只在服务器），统一 OpenAI 兼容协议。
  // 用户仍可用 VECTORENGINE_* env 覆盖为直连自有上游。
  const DEFAULT_AI_BASE_URL = "https://erp.temu.chat/api/ai/analyze";
  const DESKTOP_TOKEN = "0b8f5be546c34cd841ae485bb6a2305dacb9ff06422cbaa7";
  const AI_API_KEY = env.VECTORENGINE_API_KEY || DESKTOP_TOKEN;
  const AI_PRO_API_KEY = env.VECTORENGINE_PRO_API_KEY || "";
  const AI_BASE_URL = normalizeChatBaseUrl(env.VECTORENGINE_BASE_URL, DEFAULT_AI_BASE_URL);
  // 代理走 OpenAI 兼容端点，统一用 OpenAI 兼容模型（vectorengine 支持 gpt-5.5）
  const AI_MODEL = env.VECTORENGINE_MODEL || "gpt-5.5";
  const COMPARE_MODEL_CHAIN = (env.VECTORENGINE_COMPARE_MODELS
    || env.VECTORENGINE_COMPARE_MODEL
    || "gpt-5.5")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const ATTRIBUTE_AI_API_KEY = env.VECTORENGINE_ATTRIBUTE_API_KEY || AI_API_KEY;
  const ATTRIBUTE_AI_BASE_URL = normalizeChatBaseUrl(env.VECTORENGINE_ATTRIBUTE_BASE_URL, AI_BASE_URL);
  const ATTRIBUTE_AI_MODEL = env.VECTORENGINE_ATTRIBUTE_MODEL || AI_MODEL;

  let aiGeminiClient = null;
  function getAiGeminiClient() {
    if (aiGeminiClient || !AI_API_KEY) return aiGeminiClient;
    aiGeminiClient = createGeminiClient({ apiKey: AI_API_KEY, baseURL: normalizeGeminiBaseUrl(AI_BASE_URL) });
    return aiGeminiClient;
  }

  let aiGeminiProClient = null;
  function getAiGeminiProClient() {
    const proKey = AI_PRO_API_KEY || AI_API_KEY;
    if (aiGeminiProClient || !proKey) return aiGeminiProClient;
    aiGeminiProClient = createGeminiClient({ apiKey: proKey, baseURL: normalizeGeminiBaseUrl(AI_BASE_URL) });
    return aiGeminiProClient;
  }

  let aiOpenAICompatibleClient = null;
  function getAiOpenAICompatibleClient() {
    if (aiOpenAICompatibleClient || !AI_API_KEY) return aiOpenAICompatibleClient;
    aiOpenAICompatibleClient = createOpenAICompatibleClient({ apiKey: AI_API_KEY, baseURL: AI_BASE_URL, fallbackBaseURL: AI_BASE_URL });
    return aiOpenAICompatibleClient;
  }

  // 方案 B：统一走 OpenAI 兼容客户端（经云端代理），不再按模型名分流到 Gemini 原生协议
  function getAiClientForModel(_modelName) {
    return getAiOpenAICompatibleClient();
  }

  let attributeGeminiClient = null;
  function getAttributeGeminiClient() {
    if (attributeGeminiClient || !ATTRIBUTE_AI_API_KEY) return attributeGeminiClient;
    attributeGeminiClient = createGeminiClient({ apiKey: ATTRIBUTE_AI_API_KEY, baseURL: normalizeGeminiBaseUrl(ATTRIBUTE_AI_BASE_URL) });
    return attributeGeminiClient;
  }

  let attributeOpenAICompatibleClient = null;
  function getAttributeOpenAICompatibleClient() {
    if (attributeOpenAICompatibleClient || !ATTRIBUTE_AI_API_KEY) return attributeOpenAICompatibleClient;
    attributeOpenAICompatibleClient = createOpenAICompatibleClient({
      apiKey: ATTRIBUTE_AI_API_KEY,
      baseURL: ATTRIBUTE_AI_BASE_URL,
      fallbackBaseURL: AI_BASE_URL,
    });
    return attributeOpenAICompatibleClient;
  }

  // 方案 B：统一走 OpenAI 兼容客户端
  function getAttributeClientForModel(modelName) {
    return getAttributeOpenAICompatibleClient() || getAiClientForModel(modelName);
  }

  return {
    AI_API_KEY,
    AI_BASE_URL,
    AI_MODEL,
    COMPARE_MODEL_CHAIN,
    ATTRIBUTE_AI_API_KEY,
    ATTRIBUTE_AI_MODEL,
    getAiGeminiClient,
    getAiClientForModel,
    getAttributeClientForModel,
  };
}
