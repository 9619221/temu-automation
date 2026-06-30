"use strict";

// Agent 定时调度器
// 管理 followup 任务的定时触发

const { queryAll, execute } = require("../../db/connection.cjs");

class AgentScheduler {
  constructor(options = {}) {
    this._db = options.db;
    this._agentInstance = null;
    this._timer = null;
    this._checkInterval = options.checkInterval || 60_000;
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
}

module.exports = { AgentScheduler };
