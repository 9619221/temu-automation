"use strict";

// LLM 客户端：OpenAI 兼容格式（支持向量引擎等代理）

const DEFAULT_API_URL = "https://api.vectorengine.cn/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.5";

class LlmClient {
  constructor(options = {}) {
    this._apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this._baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_API_URL;
    this._defaultModel = options.model || process.env.AGENT_MODEL || DEFAULT_MODEL;
    this._fetchImpl = options.fetch || globalThis.fetch;
    this._maxRetries = options.maxRetries || 2;
  }

  async chat({ model, system, messages, tools, max_tokens = 2048 }) {
    // 构建 OpenAI 格式 messages（system 放在 messages[0]）
    const oaiMessages = [];
    if (system) {
      oaiMessages.push({ role: "system", content: system });
    }
    for (const msg of messages) {
      oaiMessages.push(...this._convertMessage(msg));
    }

    const body = {
      model: model || this._defaultModel,
      max_tokens,
      messages: oaiMessages,
    };

    // OpenAI tools 格式：{ type: "function", function: { name, description, parameters } }
    // OpenAI 要求 name 只能 [a-zA-Z0-9_-]，把 . 替换成 __
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: "function",
        function: {
          name: t.name.replace(/\./g, "__"),
          description: t.description,
          parameters: t.input_schema || t.parameters || { type: "object", properties: {} },
        },
      }));
    }

    let lastError;
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const response = await this._fetchImpl(this._baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this._apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const status = response.status;
          if ((status === 429 || status === 529) && attempt < this._maxRetries) {
            const retryAfter = Number(response.headers.get("retry-after") || 5);
            await sleep(retryAfter * 1000);
            continue;
          }
          throw new Error(`LLM API ${status}: ${text.slice(0, 300)}`);
        }

        const data = await response.json();
        return this._parseResponse(data);
      } catch (error) {
        lastError = error;
        if (attempt < this._maxRetries && isRetryable(error)) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  // 把 Agent Loop 内部消息格式转成 OpenAI messages
  _convertMessage(msg) {
    if (msg.role === "assistant") {
      // Agent Loop 用 Claude 风格的 content blocks，需要转成 OpenAI 格式
      if (Array.isArray(msg.content)) {
        let text = "";
        const toolCalls = [];
        for (const block of msg.content) {
          if (block.type === "text") text += block.text;
          if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name.replace(/\./g, "__"),
                arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {}),
              },
            });
          }
        }
        const oaiMsg = { role: "assistant", content: text || null };
        if (toolCalls.length > 0) oaiMsg.tool_calls = toolCalls;
        return [oaiMsg];
      }
      return [{ role: "assistant", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }];
    }

    if (msg.role === "user") {
      // tool_result 列表 → 多条 role:"tool" 消息
      if (Array.isArray(msg.content)) {
        const results = msg.content.filter(c => c.type === "tool_result");
        if (results.length > 0) {
          return results.map(r => ({
            role: "tool",
            tool_call_id: r.tool_use_id,
            content: typeof r.content === "string" ? r.content : JSON.stringify(r.content || ""),
          }));
        }
        // 普通 content blocks
        const text = msg.content.map(c => c.text || "").join("");
        return [{ role: "user", content: text }];
      }
      return [{ role: "user", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }];
    }

    return [msg];
  }

  // 把 OpenAI 响应转成 Agent Loop 期望的 Claude 风格格式
  _parseResponse(data) {
    const choice = data.choices?.[0];
    if (!choice) {
      return { content: [], stop_reason: "end_turn", usage: data.usage || {} };
    }

    const msg = choice.message || {};
    const content = [];

    // 文本内容
    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }

    // tool_calls → Claude 风格的 tool_use blocks
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { input = {}; }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: (tc.function?.name || "").replace(/__/g, "."),
          input,
        });
      }
    }

    const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";

    return {
      content,
      stop_reason: stopReason,
      usage: data.usage || {},
      model: data.model,
    };
  }
}

function isRetryable(error) {
  const msg = String(error?.message || "");
  return msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("TimeoutError") ||
         msg.includes("abort") || msg.includes("fetch failed") || msg.includes("529") || msg.includes("overloaded");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { LlmClient };
