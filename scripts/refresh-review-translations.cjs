// 把 erp_temu_reviews 未翻译的评论翻成简体中文存 comment_zh。独立 cron 进程。
// 中文评论原样存；外文评论批量调 LLM 翻译（复用 agent 的 ANALYZE_* LLM 配置，读 /opt/temu-agent-gen/.env）。
// 前端「评价」Tab 只显示 comment_zh（无则兜底显示原文）。
// 用法（crontab，错峰，如每 2 小时）：
//   33 */2 * * * cd /opt/temu-automation && node scripts/refresh-review-translations.cjs >> /var/log/temu-review-translate.log 2>&1
"use strict";
const fs = require("fs");
const Database = require("better-sqlite3");

const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const AGENT_ENV = process.env.AGENT_ENV || "/opt/temu-agent-gen/.env";
const BATCH = Math.max(1, Number(process.env.REVIEW_TRANSLATE_BATCH) || 20);     // 每批翻译条数
const MAX_PER_RUN = Math.max(1, Number(process.env.REVIEW_TRANSLATE_MAX) || 400); // 单轮最多翻多少条（控时长/成本）

function readEnv(p) {
  const o = {};
  try {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
  return o;
}

const env = readEnv(AGENT_ENV);
const KEY = process.env.ANALYZE_API_KEY || env.ANALYZE_API_KEY;
const BASE = process.env.ANALYZE_BASE_URL || env.ANALYZE_BASE_URL;
const MODEL = process.env.ANALYZE_MODEL || env.ANALYZE_MODEL || "gpt-5.5";

// 中文判定：CJK 占非空白字符 ≥30% 视为中文（原样存，不翻）
function isChinese(s) {
  const str = String(s || "");
  const cjk = (str.match(/[一-鿿]/g) || []).length;
  const len = str.replace(/\s/g, "").length;
  return len > 0 && cjk / len >= 0.3;
}

async function translateBatch(texts) {
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const r = await fetch(BASE.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "你是电商评论翻译助手。把买家商品评论翻成简体中文,简洁自然口语化。返回JSON数组(按输入顺序),已是中文的原样返回。只返回JSON数组,不要解释。" },
        { role: "user", content: "翻成简体中文,只返回JSON数组:\n\n" + numbered },
      ],
    }),
  });
  if (!r.ok) throw new Error("LLM HTTP " + r.status);
  const j = await r.json();
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "[]";
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array in LLM resp");
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr) || arr.length !== texts.length) {
    throw new Error("LLM array length mismatch " + (Array.isArray(arr) ? arr.length : "?") + "/" + texts.length);
  }
  return arr;
}

(async () => {
  if (!KEY || !BASE) {
    console.error(new Date().toISOString(), "review translate skipped: no LLM config (ANALYZE_API_KEY/BASE_URL)");
    process.exitCode = 1;
    return;
  }
  const db = new Database(ERP_DB);
  db.pragma("busy_timeout=60000");
  const rows = db.prepare(
    "SELECT id, comment FROM erp_temu_reviews WHERE comment_zh IS NULL AND comment IS NOT NULL AND comment <> '' ORDER BY created_at_ts DESC LIMIT ?"
  ).all(MAX_PER_RUN);
  const upd = db.prepare("UPDATE erp_temu_reviews SET comment_zh = ? WHERE id = ?");

  let zhKept = 0;
  let translated = 0;
  let errors = 0;
  const foreign = [];
  for (const r of rows) {
    if (isChinese(r.comment)) { upd.run(r.comment, r.id); zhKept++; }
    else foreign.push(r);
  }

  for (let i = 0; i < foreign.length; i += BATCH) {
    const batch = foreign.slice(i, i + BATCH);
    try {
      const out = await translateBatch(batch.map((r) => r.comment));
      const tx = db.transaction(() => { batch.forEach((r, k) => upd.run(String(out[k] || r.comment), r.id)); });
      tx();
      translated += batch.length;
    } catch (e) {
      errors += batch.length;
      console.error(new Date().toISOString(), "batch failed:", (e && e.message) || e);
    }
    await new Promise((res) => setTimeout(res, 300));
  }

  console.log(new Date().toISOString(), "review translate done", JSON.stringify({ scanned: rows.length, zhKept, translated, errors }));
  db.close();
})();
