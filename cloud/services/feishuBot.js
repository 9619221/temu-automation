import crypto from "crypto";

const WEBHOOK_ENV_KEYS = ["FEISHU_BOT_WEBHOOK", "FEISHU_WEBHOOK_URL", "LARK_BOT_WEBHOOK"];
const SECRET_ENV_KEYS = ["FEISHU_BOT_SECRET", "FEISHU_SECRET", "LARK_BOT_SECRET"];

function firstEnv(keys, env = process.env) {
  for (const key of keys) {
    const value = String(env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

export function getFeishuConfig(env = process.env) {
  return {
    webhook: firstEnv(WEBHOOK_ENV_KEYS, env),
    secret: firstEnv(SECRET_ENV_KEYS, env),
  };
}

export function isFeishuConfigured(env = process.env) {
  return Boolean(getFeishuConfig(env).webhook);
}

export function redactWebhook(webhook) {
  const value = String(webhook || "");
  if (!value) return "";
  try {
    const url = new URL(value);
    const token = url.pathname.split("/").filter(Boolean).pop() || "";
    const suffix = token.length > 6 ? token.slice(-6) : token;
    return `${url.origin}/.../${suffix}`;
  } catch {
    return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : "***";
  }
}

export function createFeishuSign(timestamp, secret) {
  if (!secret) return "";
  const key = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", key).update("").digest("base64");
}

function cleanLine(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function buildFeishuText({ title, text, fields } = {}) {
  const lines = [];
  const safeTitle = cleanLine(title);
  const safeText = cleanLine(text);
  if (safeTitle) lines.push(safeTitle);
  if (safeText) lines.push(safeText);

  if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      if (value == null || value === "") continue;
      lines.push(`${key}: ${String(value)}`);
    }
  }

  return lines.join("\n").slice(0, 30000) || "Temu automation notification";
}

function isFeishuSuccess(body) {
  if (!body || typeof body !== "object") return true;
  const code = body.code ?? body.errcode ?? body.StatusCode;
  if (code == null) return true;
  return Number(code) === 0;
}

export async function sendFeishuText(message, options = {}) {
  const envConfig = getFeishuConfig(options.env || process.env);
  const webhook = String(options.webhook || envConfig.webhook || "").trim();
  const secret = String(options.secret || envConfig.secret || "").trim();
  const fetchImpl = options.fetch || globalThis.fetch;

  if (!webhook) {
    throw new Error("FEISHU_BOT_WEBHOOK is not configured");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this Node runtime");
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    msg_type: "text",
    content: {
      text: buildFeishuText(message),
    },
  };

  if (secret) {
    payload.timestamp = timestamp;
    payload.sign = createFeishuSign(timestamp, secret);
  }

  const response = await fetchImpl(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = { raw: responseText };
  }

  if (!response.ok || !isFeishuSuccess(body)) {
    const detail = body?.msg || body?.errmsg || body?.StatusMessage || responseText || response.statusText;
    throw new Error(`Feishu webhook failed (${response.status}): ${detail}`);
  }

  return {
    ok: true,
    status: response.status,
    body,
  };
}
