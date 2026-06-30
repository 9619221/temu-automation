"use strict";

// Agent HTTP API 路由
// 被 lanServer 的 handleRequest 调用，返回 true 表示已处理

const { queryAll, queryOne, execute } = require("../../db/connection.cjs");
const { getSSEManager } = require("./sseManager.cjs");

async function handleAgentRoute(pathname, method, body, ctx) {
  const { db, agentInstance, sendJson, sendError, res } = ctx;
  if (!pathname.startsWith("/api/agent/")) return false;

  const route = pathname.slice("/api/agent/".length);

  // ─── SSE 实时推送 ───
  if (route === "stream" && method === "GET") {
    if (!res) return sendError(500, "SSE 不可用");
    const url = new URL(pathname, "http://localhost");
    // 从 query 中取 runId (由 lanServer 传入或从 pathname 解析)
    const runId = ctx.query?.runId || null;
    const sse = getSSEManager();
    sse.addClient(res, runId);
    return true; // 不要 sendJson，连接保持
  }

  // ─── 审批相关 ───
  if (route === "approvals/pending" && method === "GET") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const list = await agentInstance.approvalQueue.listPending();
    return sendJson({ items: list });
  }

  if (route === "approvals/recent" && method === "GET") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const list = await agentInstance.approvalQueue.listRecent(50);
    return sendJson({ items: list });
  }

  if (route === "approvals/approve" && method === "POST") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const { id } = body || {};
    if (!id) return sendError(400, "缺少 id");
    await agentInstance.approvalQueue.approve(id);
    return sendJson({ ok: true });
  }

  if (route === "approvals/reject" && method === "POST") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const { id, reason } = body || {};
    if (!id) return sendError(400, "缺少 id");
    await agentInstance.approvalQueue.reject(id, reason || "");
    return sendJson({ ok: true });
  }

  // ─── Agent 控制 ───
  if (route === "start-patrol" && method === "POST") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    if (agentInstance.agent.running) return sendError(409, "Agent 正在运行中");
    try {
      const { runId, turns, messages } = await agentInstance.startPatrol();
      const reply = _extractReply(messages);
      _persistRun(db, runId, "patrol", {}, turns, messages, reply).catch(() => {});
      return sendJson({ started: true, runId, reply });
    } catch (err) {
      console.error("[Agent] patrol error:", err?.message || err);
      return sendError(500, err?.message || "巡逻失败");
    }
  }

  if (route === "send-message" && method === "POST") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    if (agentInstance.agent.running) return sendError(409, "Agent 正在运行中");
    const { message } = body || {};
    if (!message) return sendError(400, "缺少 message");
    try {
      const { runId, turns, messages } = await agentInstance.handleHumanMessage(message);
      const reply = _extractReply(messages);
      _persistRun(db, runId, "human", { message }, turns, messages, reply).catch(() => {});
      getSSEManager().broadcast("reply", { runId, reply }, runId);
      return sendJson({ started: true, runId, reply });
    } catch (err) {
      console.error("[Agent] message error:", err?.message || err);
      getSSEManager().broadcast("run:error", { error: err?.message || "执行失败" });
      return sendError(500, err?.message || "执行失败");
    }
  }

  if (route === "abort" && method === "POST") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    agentInstance.abort();
    return sendJson({ aborted: true });
  }

  if (route === "status" && method === "GET") {
    if (!agentInstance) return sendJson({ initialized: false });
    return sendJson({
      initialized: true,
      running: agentInstance.agent.running,
      pending_approvals: agentInstance.approvalQueue.pendingCount,
    });
  }

  // ─── 记忆 ───
  if (route === "memory/list" && method === "GET") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const list = await agentInstance.memory.listRecent(30);
    return sendJson({ items: list });
  }

  if (route === "memory/recall" && method === "POST") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const { query, limit } = body || {};
    if (!query) return sendError(400, "缺少 query");
    const results = await agentInstance.memory.recall(query, limit || 5);
    return sendJson({ items: results });
  }

  // ─── 快照 ───
  if (route === "snapshot" && method === "GET") {
    if (!agentInstance) return sendError(503, "Agent 未初始化");
    const snapshot = await agentInstance.snapshotEngine.getGlobalSnapshot();
    return sendJson(snapshot);
  }

  // ─── Issues (问题追踪) ───
  if (route === "issues" && method === "GET") {
    const status = ctx.query?.status || null;
    const category = ctx.query?.category || null;
    let where = "1=1";
    const params = [];
    let idx = 1;
    if (status) { where += ` AND status = $${idx++}`; params.push(status); }
    if (category) { where += ` AND category = $${idx++}`; params.push(category); }
    const rows = await queryAll(db, `
      SELECT * FROM erp_agent_issues
      WHERE ${where}
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 200
    `, params);
    return sendJson({ items: rows });
  }

  if (route === "issues/stats" && method === "GET") {
    const stats = await queryAll(db, `
      SELECT category,
             SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS active_count,
             SUM(CASE WHEN severity = 'critical' AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS critical_count,
             COUNT(*) AS total_count
      FROM erp_agent_issues
      GROUP BY category
    `);
    const trend = await queryAll(db, `
      SELECT date(created_at) AS day,
             category,
             COUNT(*) AS count
      FROM erp_agent_issues
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY day, category
      ORDER BY day
    `);
    return sendJson({ stats, trend });
  }

  if (route.startsWith("issues/") && route.split("/").length === 2 && method === "POST") {
    const issueId = route.split("/")[1];
    const { status: newStatus, resolution } = body || {};
    if (!newStatus) return sendError(400, "缺少 status");
    await execute(db, `
      UPDATE erp_agent_issues
      SET status = $1, resolution = $2, resolved_by = 'user', resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = $3
    `, [newStatus, resolution || "", issueId]);
    return sendJson({ ok: true });
  }

  // ─── Runs (运行历史) ───
  if (route === "runs" && method === "GET") {
    const rows = await queryAll(db, `
      SELECT id, trigger_type, status, turns, reply, issue_count, started_at, finished_at, error
      FROM erp_agent_runs
      ORDER BY started_at DESC
      LIMIT 50
    `);
    return sendJson({ items: rows });
  }

  if (route.startsWith("runs/") && route.split("/").length === 2 && method === "GET") {
    const runId = route.split("/")[1];
    const run = await queryOne(db, `SELECT * FROM erp_agent_runs WHERE id = $1`, [runId]);
    if (!run) return sendError(404, "Run 不存在");
    const events = await queryAll(db, `
      SELECT * FROM erp_agent_run_events WHERE run_id = $1 ORDER BY id
    `, [runId]);
    return sendJson({ run, events });
  }

  // ─── 定时任务 ───
  if (route === "followups" && method === "GET") {
    const rows = await queryAll(db, `
      SELECT * FROM erp_agent_followups
      WHERE status = 'pending'
      ORDER BY fire_at ASC
    `);
    return sendJson({ items: rows });
  }

  if (route === "followups/cancel" && method === "POST") {
    const { id } = body || {};
    if (!id) return sendError(400, "缺少 id");
    await execute(db, `UPDATE erp_agent_followups SET status = 'cancelled' WHERE id = $1`, [id]);
    return sendJson({ ok: true });
  }

  return false;
}

// 从 messages 中提取最后一条 assistant 文本回复
function _extractReply(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const txt = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      if (txt) return txt;
    } else if (m.role === "assistant" && typeof m.content === "string" && m.content) {
      return m.content;
    }
  }
  return "";
}

// 持久化 run 记录
async function _persistRun(db, runId, triggerType, triggerData, turns, messages, reply) {
  if (!db) return;
  try {
    await execute(db, `
      INSERT INTO erp_agent_runs (id, trigger_type, trigger_data, status, turns, reply, finished_at)
      VALUES ($1, $2, $3, 'completed', $4, $5, datetime('now'))
      ON CONFLICT (id) DO UPDATE SET status='completed', turns=$4, reply=$5, finished_at=datetime('now')
    `, [runId, triggerType, JSON.stringify(triggerData || {}), turns, reply || ""]);

    // 持久化关键事件到 run_events
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            await execute(db, `
              INSERT INTO erp_agent_run_events (run_id, event_type, content) VALUES ($1, 'thinking', $2)
            `, [runId, block.text.slice(0, 2000)]);
          }
          if (block.type === "tool_use") {
            await execute(db, `
              INSERT INTO erp_agent_run_events (run_id, event_type, tool_name, content) VALUES ($1, 'tool_call', $2, $3)
            `, [runId, block.name, JSON.stringify(block.input || {}).slice(0, 2000)]);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Agent] persist run error:", err?.message);
  }
}

module.exports = { handleAgentRoute };
