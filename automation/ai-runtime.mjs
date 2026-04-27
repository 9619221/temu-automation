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
  const DEFAULT_AI_BASE_URL = "https://api.vectorengine.ai/v1";
  const AI_API_KEY = env.VECTORENGINE_API_KEY || "";
  const AI_PRO_API_KEY = env.VECTORENGINE_PRO_API_KEY || "";
  const AI_BASE_URL = normalizeChatBaseUrl(env.VECTORENGINE_BASE_URL, DEFAULT_AI_BASE_URL);
  const AI_MODEL = env.VECTORENGINE_MODEL || "gemini-3.1-flash-lite-preview";
  const COMPARE_MODEL_CHAIN = (env.VECTORENGINE_COMPARE_MODELS
    || env.VECTORENGINE_COMPARE_MODEL
    || "gemini-3.1-pro-preview,gemini-3.1-flash-preview,gemini-3.1-flash-lite-preview")
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

  function getAiClientForModel(modelName) {
    if (/^gemini/i.test(modelName || "") && /pro-preview/i.test(modelName || "")) {
      return getAiGeminiProClient() || getAiGeminiClient();
    }
    if (/^gemini/i.test(modelName || "")) return getAiGeminiClient();
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

  function getAttributeClientForModel(modelName) {
    if (/^gemini/i.test(modelName || "")) {
      return getAttributeGeminiClient();
    }
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
