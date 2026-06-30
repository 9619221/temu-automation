"use strict";

// 审批队列：Agent 的 Ask 权限操作在这里等待人工审批
// 支持：通过/拒绝/追问

const { EventEmitter } = require("events");
const { queryAll, queryOne, execute } = require("../../db/connection.cjs");

class ApprovalQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this._db = options.db;
    this._pendingResolvers = new Map(); // id → { resolve, timer }
    this._timeoutMs = options.timeoutMs || 3600000; // 默认 1 小时超时
  }

  async submit(item) {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 写入数据库
    if (this._db) {
      try {
        await execute(this._db, `
          INSERT INTO erp_agent_approvals
            (id, run_id, tool_name, tool_input, status, created_at)
          VALUES ($1, $2, $3, $4, 'pending', datetime('now'))
        `, [id, item.runId, item.toolName, JSON.stringify(item.toolInput || {})]);
      } catch (error) {
        console.warn("[ApprovalQueue] DB write failed:", error?.message);
      }
    }

    // 发送事件通知 UI
    this.emit("approval:requested", {
      id,
      runId: item.runId,
      turn: item.turn,
      toolName: item.toolName,
      toolInput: item.toolInput,
      timestamp: new Date().toISOString(),
    });

    // 等待用户决定
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pendingResolvers.delete(id);
        this._updateStatus(id, "timeout");
        this.emit("approval:timeout", { id });
        resolve(false);
      }, this._timeoutMs);

      this._pendingResolvers.set(id, { resolve, timer });
    });
  }

  async approve(approvalId) {
    const pending = this._pendingResolvers.get(approvalId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingResolvers.delete(approvalId);
      pending.resolve(true);
    }
    await this._updateStatus(approvalId, "approved");
    this.emit("approval:approved", { id: approvalId });
  }

  async reject(approvalId, reason = "") {
    const pending = this._pendingResolvers.get(approvalId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingResolvers.delete(approvalId);
      pending.resolve(false);
    }
    await this._updateStatus(approvalId, "rejected", reason);
    this.emit("approval:rejected", { id: approvalId, reason });
  }

  async listPending() {
    if (!this._db) return [];
    try {
      return await queryAll(this._db, `
        SELECT id, run_id, tool_name, tool_input, status, created_at
        FROM erp_agent_approvals
        WHERE status = 'pending'
        ORDER BY created_at ASC
      `, []);
    } catch {
      return [];
    }
  }

  async listRecent(limit = 50) {
    if (!this._db) return [];
    try {
      return await queryAll(this._db, `
        SELECT id, run_id, tool_name, tool_input, status, resolved_at, created_at
        FROM erp_agent_approvals
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
    } catch {
      return [];
    }
  }

  get pendingCount() {
    return this._pendingResolvers.size;
  }

  async _updateStatus(id, status, reason = "") {
    if (!this._db) return;
    try {
      await execute(this._db, `
        UPDATE erp_agent_approvals
        SET status = $1, reject_reason = $2, resolved_at = datetime('now')
        WHERE id = $3
      `, [status, reason, id]);
    } catch (error) {
      console.warn("[ApprovalQueue] status update failed:", error?.message);
    }
  }

  destroy() {
    for (const [id, { timer, resolve }] of this._pendingResolvers) {
      clearTimeout(timer);
      resolve(false);
    }
    this._pendingResolvers.clear();
  }
}

module.exports = { ApprovalQueue };
