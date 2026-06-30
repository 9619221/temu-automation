"use strict";

// Agent 记忆系统 v2
// - 关键词检索（LIKE）
// - 自动经验沉淀：run 完成后自动生成经验
// - 记忆衰减：长期未命中的记忆自动降低 confidence

const { queryAll, queryOne, execute } = require("../../db/connection.cjs");

class AgentMemory {
  constructor(options = {}) {
    this._db = options.db;
  }

  async recall(query, limit = 5) {
    if (!this._db || !query) return [];
    try {
      return await this._keywordRecall(query, limit);
    } catch (error) {
      console.warn("[AgentMemory] recall error:", error?.message);
      return [];
    }
  }

  async _keywordRecall(query, limit = 5) {
    const keywords = query.split(/\s+/).filter(Boolean).slice(0, 5);
    if (keywords.length === 0) return [];

    const params = [];
    let idx = 1;
    const parts = [];
    for (const kw of keywords) {
      const pattern = `%${kw}%`;
      parts.push(`(title LIKE $${idx} OR content LIKE $${idx + 1} OR tags LIKE $${idx + 2})`);
      params.push(pattern, pattern, pattern);
      idx += 3;
    }

    const where = parts.join(" OR ");
    const rows = await queryAll(this._db, `
      SELECT id, title, content, tags, created_at, confidence
      FROM erp_agent_memory
      WHERE status = 'active' AND (${where})
      ORDER BY confidence DESC, created_at DESC
      LIMIT $${idx}
    `, [...params, limit]);

    for (const r of rows) {
      execute(this._db, `
        UPDATE erp_agent_memory SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id = $1
      `, [r.id]).catch(() => {});
    }

    return rows.map(r => ({
      id: r.id, title: r.title, content: r.content,
      tags: r.tags, confidence: r.confidence, created_at: r.created_at,
    }));
  }

  async save(entry) {
    if (!this._db) return { error: "数据库未初始化" };
    try {
      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await execute(this._db, `
        INSERT INTO erp_agent_memory (id, title, content, tags, confidence, status, source, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))
      `, [
        id,
        entry.title,
        entry.content,
        Array.isArray(entry.tags) ? entry.tags.join(",") : (entry.tags || ""),
        entry.confidence || 0.7,
        "active",
        entry.source || "manual",
      ]);
      return { saved: true, id };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  async autoSaveExperience(runSummary) {
    if (!this._db || !runSummary) return;
    try {
      const { trigger, reply, toolsUsed } = runSummary;
      if (!reply || reply.length < 50) return;

      const title = `[自动] ${trigger || "运营"}经验 — ${new Date().toLocaleDateString("zh-CN")}`;
      const tags = toolsUsed ? toolsUsed.slice(0, 5).map(t => t.split(".").pop()) : [];

      await this.save({
        title,
        content: reply.slice(0, 1000),
        tags,
        confidence: 0.5,
        source: "auto",
      });
    } catch (err) {
      console.warn("[AgentMemory] auto save error:", err?.message);
    }
  }

  async decay() {
    if (!this._db) return;
    try {
      const result = await execute(this._db, `
        UPDATE erp_agent_memory
        SET confidence = MAX(0.1, confidence - 0.1),
            decay_at = datetime('now')
        WHERE status = 'active'
          AND (last_hit_at IS NULL OR last_hit_at < datetime('now', '-30 days'))
          AND (decay_at IS NULL OR decay_at < datetime('now', '-7 days'))
          AND confidence > 0.2
      `);
      if (result?.changes > 0) {
        console.log(`[AgentMemory] decayed ${result.changes} memories`);
      }

      await execute(this._db, `
        UPDATE erp_agent_memory
        SET status = 'inactive'
        WHERE status = 'active' AND confidence <= 0.1
      `);
    } catch (err) {
      console.warn("[AgentMemory] decay error:", err?.message);
    }
  }

  async listRecent(limit = 20) {
    if (!this._db) return [];
    try {
      return await queryAll(this._db, `
        SELECT id, title, content, tags, confidence, status, source, hit_count, created_at
        FROM erp_agent_memory
        WHERE status = 'active'
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
    } catch {
      return [];
    }
  }

  async deactivate(id) {
    if (!this._db) return;
    await execute(this._db, `UPDATE erp_agent_memory SET status = 'inactive' WHERE id = $1`, [id]);
  }
}

module.exports = { AgentMemory };
