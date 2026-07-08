"use strict";

// Agent 定时调度器
// 管理 followup 任务的定时触发 + 每日定时巡检（含飞书日报）+ 事件监测

const { queryAll, execute } = require("../../db/connection.cjs");
const { notifyAll } = require("./notifier.cjs");

class AgentScheduler {
  constructor(options = {}) {
    this._db = options.db;
    this._attachCloudDb = options.attachCloudDb || null;
    this._agentInstance = null;
    this._timer = null;
    this._checkInterval = options.checkInterval || 60_000;
    // 每日巡检时刻 "HH:MM"，设为 "off" 关闭
    this._patrolTime = process.env.AGENT_PATROL_TIME || "09:00";
    this._lastPatrolDay = "";
    // 事件监测间隔（分钟）
    this._eventCheckMin = Number(process.env.AGENT_EVENT_CHECK_MIN || 60);
    this._lastEventCheckAt = 0;
    this._lastEventFingerprint = "";
  }

  setAgent(agentInstance) {
    this._agentInstance = agentInstance;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this._checkInterval);
    this._tick();
    console.log("[Scheduler] started, checking every", this._checkInterval / 1000, "s");
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async schedule(description, context, delayMs) {
    if (!this._db) return { error: "数据库未初始化" };
    const fireAt = new Date(Date.now() + delayMs);
    await execute(this._db, `
      INSERT INTO erp_agent_followups (description, context, fire_at, status)
      VALUES ($1, $2, $3, 'pending')
    `, [description, JSON.stringify(context || {}), fireAt.toISOString()]);
    console.log("[Scheduler] scheduled followup:", description, "at", fireAt.toISOString());
    return { scheduled: true, fire_at: fireAt.toISOString() };
  }

  async listPending() {
    if (!this._db) return [];
    return queryAll(this._db, `
      SELECT id, description, context, fire_at, created_at
      FROM erp_agent_followups
      WHERE status = 'pending'
      ORDER BY fire_at ASC
    `);
  }

  async cancel(id) {
    if (!this._db) return;
    await execute(this._db, `UPDATE erp_agent_followups SET status = 'cancelled' WHERE id = $1`, [id]);
  }

  async _tick() {
    if (!this._db || !this._agentInstance) return;

    // 每日定时巡检 + 事件监测：不受 followup 是否在跑影响，但巡逻自身互斥
    this._checkDailyPatrol().catch(err => console.warn("[Scheduler] patrol check error:", err?.message));
    this._checkEvents().catch(err => console.warn("[Scheduler] event check error:", err?.message));

    if (this._agentInstance.agent.running) return;

    try {
      const due = await queryAll(this._db, `
        SELECT id, description, context
        FROM erp_agent_followups
        WHERE status = 'pending' AND fire_at <= datetime('now')
        ORDER BY fire_at ASC
        LIMIT 1
      `);

      if (due.length === 0) return;
      const item = due[0];

      await execute(this._db, `UPDATE erp_agent_followups SET status = 'fired' WHERE id = $1`, [item.id]);

      let ctx = {};
      try { ctx = JSON.parse(item.context || "{}"); } catch { /* ignore */ }

      console.log("[Scheduler] firing followup:", item.description);
      this._agentInstance.handleFollowup(item.description, ctx).catch(err => {
        console.error("[Scheduler] followup error:", err?.message || err);
      });
    } catch (err) {
      console.warn("[Scheduler] tick error:", err?.message);
    }
  }

  // ── 每日定时巡检 + 飞书日报 ──
  async _checkDailyPatrol() {
    if (this._patrolTime === "off") return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (this._lastPatrolDay === today) return;
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (hhmm < this._patrolTime) return;
    if (this._agentInstance.agent.hasRunOfType("patrol")) return;

    // 进程重启防重：查库确认今天还没跑过巡逻
    try {
      const rows = await queryAll(this._db, `
        SELECT started_at FROM erp_agent_runs
        WHERE trigger_type = 'patrol'
        ORDER BY started_at DESC
        LIMIT 1
      `);
      const last = rows[0]?.started_at ? String(rows[0].started_at).slice(0, 10) : "";
      if (last === today) {
        this._lastPatrolDay = today;
        return;
      }
    } catch { /* 查询失败不阻断巡逻 */ }

    this._lastPatrolDay = today;
    console.log("[Scheduler] 触发每日定时巡检");
    try {
      const { runId, turns, messages } = await this._agentInstance.startPatrol();
      const reply = extractReply(messages);
      const { persistRun } = require("./apiRoutes.cjs");
      persistRun(this._db, runId, "patrol", { source: "scheduler" }, turns, messages, reply).catch(() => {});
      const issueCount = await this._countTodayIssues(today);
      await notifyAll(
        `【鲁米斯日报 ${today}】\n${reply || "巡检完成，无异常摘要"}\n\n今日新增问题：${issueCount} 个\n详情见 ERP 工作台 → Agent 面板`
      );
    } catch (err) {
      console.error("[Scheduler] 定时巡检失败:", err?.message || err);
      await notifyAll(`【鲁米斯】${today} 定时巡检失败：${err?.message || err}`);
    }
  }

  async _countTodayIssues(today) {
    try {
      const rows = await queryAll(this._db, `
        SELECT COUNT(*) AS cnt FROM erp_agent_issues WHERE created_at >= $1
      `, [`${today}T00:00:00`]);
      return Number(rows[0]?.cnt || 0);
    } catch {
      return 0;
    }
  }

  // ── 事件监测：库存告警 / 新差评 / 采购滞留，指纹变化才唤醒 Agent ──
  async _checkEvents() {
    if (this._eventCheckMin <= 0) return;
    const now = Date.now();
    if (now - this._lastEventCheckAt < this._eventCheckMin * 60_000) return;
    this._lastEventCheckAt = now;

    const alerts = [];
    try {
      const lowStock = await queryAll(this._db, `
        SELECT internal_sku_code AS sku
        FROM erp_skus
        WHERE status = 'active' AND COALESCE(jst_actual_stock_qty, 0) <= 0
        ORDER BY internal_sku_code LIMIT 20
      `);
      if (lowStock.length > 0) {
        alerts.push({ type: "stock_out", detail: `${lowStock.length} 个在售 SKU 库存为 0`, keys: lowStock.map(r => r.sku) });
      }
    } catch { /* 表结构差异容错 */ }

    try {
      const stuck = await queryAll(this._db, `
        SELECT id FROM erp_purchase_orders
        WHERE status = 'paid' AND created_at < $1
        ORDER BY id LIMIT 20
      `, [new Date(now - 7 * 86400000).toISOString()]);
      if (stuck.length > 0) {
        alerts.push({ type: "purchase_stuck", detail: `${stuck.length} 个采购单已付款超 7 天未到货`, keys: stuck.map(r => r.id) });
      }
    } catch { /* ignore */ }

    // 新差评（近 3 天 ≤2 星，走 cloud 采集库）
    if (this._attachCloudDb) {
      try {
        const svc = require("../services/multiStoreReport.cjs");
        const result = await svc.buildReviews(this._db, {
          includeTest: false,
          attachCloudDb: this._attachCloudDb,
        });
        const negative = (result.rows || []).filter(r => Number(r.star || r.rating || 5) <= 2);
        if (negative.length > 0) {
          const keys = negative.map(r => String(r.review_id || r.id || `${r.mall_id || ""}_${r.sku || r.sku_code || ""}_${r.created_at || r.review_time || ""}`)).sort();
          alerts.push({ type: "negative_review", detail: `近 3 天有 ${negative.length} 条差评（≤2星）`, keys });
        }
      } catch { /* cloud 库不可用时跳过 */ }
    }

    if (alerts.length === 0) return;

    // 指纹：告警类型+涉及对象不变时不重复唤醒
    const fingerprint = JSON.stringify(alerts.map(a => [a.type, a.keys]));
    if (fingerprint === this._lastEventFingerprint) return;
    this._lastEventFingerprint = fingerprint;

    if (this._agentInstance.agent.hasRunOfType("event")) return;
    console.log("[Scheduler] 事件监测触发 Agent:", alerts.map(a => a.type).join(","));
    this._agentInstance.handleEvent(
      alerts.map(a => a.detail).join("；"),
      { alerts }
    ).catch(err => console.error("[Scheduler] event run error:", err?.message || err));
  }
}

// 从 messages 中提取最后一条 assistant 文本（与 apiRoutes._extractReply 同逻辑的精简版）
function extractReply(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const txt = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      if (txt) return txt;
    }
  }
  return "";
}

module.exports = { AgentScheduler };
