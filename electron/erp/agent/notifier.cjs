"use strict";

// 群机器人推送：巡检日报 / 事件告警
// 飞书（AGENT_FEISHU_WEBHOOK）+ 企业微信（AGENT_WECOM_WEBHOOK）双通道，
// 未配置的通道静默跳过（本地开发不强依赖）

const MAX_TEXT_LEN = 4000;

async function postJson(webhook, body, channel) {
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({}));
    // 飞书失败返回 code≠0，企微返回 errcode≠0
    const code = data.code ?? data.errcode ?? 0;
    if (code !== 0) {
      console.warn(`[Notifier] ${channel} 推送失败:`, code, data.msg || data.errmsg);
      return { ok: false, error: data.msg || data.errmsg };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[Notifier] ${channel} 推送异常:`, err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

async function sendFeishuText(text) {
  const webhook = process.env.AGENT_FEISHU_WEBHOOK || "";
  if (!webhook) return { skipped: true };
  return postJson(webhook, {
    msg_type: "text",
    content: { text: String(text).slice(0, MAX_TEXT_LEN) },
  }, "飞书");
}

async function sendWecomText(text) {
  const webhook = process.env.AGENT_WECOM_WEBHOOK || "";
  if (!webhook) return { skipped: true };
  return postJson(webhook, {
    msgtype: "text",
    text: { content: String(text).slice(0, MAX_TEXT_LEN) },
  }, "企微");
}

// 双通道齐发，任一成功即算送达
async function notifyAll(text) {
  const [feishu, wecom] = await Promise.all([sendFeishuText(text), sendWecomText(text)]);
  if (feishu.skipped && wecom.skipped) {
    console.log("[Notifier] 飞书/企微 webhook 均未配置，跳过推送");
    return { skipped: true };
  }
  return { ok: Boolean(feishu.ok || wecom.ok), feishu, wecom };
}

module.exports = { sendFeishuText, sendWecomText, notifyAll };
