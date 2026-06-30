"use strict";

// SSE 连接管理器
// 维护活跃 SSE 连接，桥接 AgentLoop EventEmitter → SSE 推送

class SSEManager {
  constructor() {
    this._clients = new Map(); // connId → { res, runId?, createdAt }
    this._nextId = 1;
  }

  addClient(res, runId) {
    const connId = `sse_${this._nextId++}`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    this._clients.set(connId, { res, runId: runId || null, createdAt: Date.now() });

    res.on("close", () => {
      this._clients.delete(connId);
    });

    return connId;
  }

  broadcast(event, data, runId) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, client] of this._clients) {
      if (client.runId && runId && client.runId !== runId) continue;
      try { client.res.write(payload); } catch { /* client gone */ }
    }
  }

  get clientCount() { return this._clients.size; }

  bridgeAgent(agentInstance) {
    const agent = agentInstance.agent;

    agent.on("run:start", (d) => this.broadcast("run:start", d, d.runId));
    agent.on("turn:start", (d) => this.broadcast("turn:start", d, d.runId));
    agent.on("thinking", (d) => this.broadcast("thinking", d, d.runId));
    agent.on("tool:start", (d) => this.broadcast("tool:start", d, d.runId));
    agent.on("tool:done", (d) => {
      const truncated = typeof d.result === "string" && d.result.length > 500
        ? d.result.slice(0, 500) + "..."
        : d.result;
      this.broadcast("tool:done", { ...d, result: truncated }, d.runId);
    });
    agent.on("tool:pending_approval", (d) => this.broadcast("tool:pending_approval", d, d.runId));
    agent.on("tool:approved", (d) => this.broadcast("tool:approved", d, d.runId));
    agent.on("tool:rejected", (d) => this.broadcast("tool:rejected", d, d.runId));
    agent.on("tool:denied", (d) => this.broadcast("tool:denied", d, d.runId));
    agent.on("tool:error", (d) => this.broadcast("tool:error", d, d.runId));
    agent.on("run:complete", (d) => this.broadcast("run:complete", d, d.runId));
    agent.on("run:error", (d) => this.broadcast("run:error", d, d.runId));
    agent.on("run:aborted", (d) => this.broadcast("run:aborted", d, d.runId));
    agent.on("run:max_turns", (d) => this.broadcast("run:max_turns", d, d.runId));
  }
}

// 单例
let _instance = null;
function getSSEManager() {
  if (!_instance) _instance = new SSEManager();
  return _instance;
}

module.exports = { SSEManager, getSSEManager };
