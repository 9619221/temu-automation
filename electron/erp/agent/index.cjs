"use strict";

// Agent 模块入口
// 组装各组件，提供 createAgent / startPatrol 等顶层 API

const { AgentLoop } = require("./loop.cjs");
const { ToolRouter } = require("./toolRouter.cjs");
const { PermissionEngine, DEFAULT_RULES, createDefaultPermissions } = require("./permissions.cjs");
const { ApprovalQueue } = require("./approvalQueue.cjs");
const { SnapshotEngine } = require("./snapshotEngine.cjs");
const { AgentMemory } = require("./memory.cjs");
const { LlmClient } = require("./llmClient.cjs");
const { getSystemPrompt } = require("./systemPrompt.cjs");
const { getSSEManager } = require("./sseManager.cjs");
const { AgentScheduler } = require("./scheduler.cjs");
const { SubAgentManager } = require("./subAgent.cjs");
const fs = require("fs");
const path = require("path");

function createAgent(options = {}) {
  const { db, services, attachCloudDb, apiKey, model } = options;

  // 1. 组装各组件
  const llmClient = new LlmClient({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
    model: model || process.env.AGENT_MODEL || "gpt-5.5",
  });

  const permissions = createDefaultPermissions();
  const approvalQueue = new ApprovalQueue({ db });
  const snapshotEngine = new SnapshotEngine({ db, attachCloudDb });
  const memory = new AgentMemory({ db });

  const toolRouter = new ToolRouter({
    db,
    services,
    snapshotEngine,
    memory,
    approvalQueue,
  });

  // 2. 加载 OPS_MANUAL.md（如果存在）
  let opsManual = "";
  const manualPath = path.join(__dirname, "..", "..", "..", "OPS_MANUAL.md");
  try {
    if (fs.existsSync(manualPath)) {
      opsManual = fs.readFileSync(manualPath, "utf-8");
    }
  } catch { /* ignore */ }

  const systemPrompt = getSystemPrompt(opsManual);

  // 3. 创建 Agent Loop
  const agent = new AgentLoop({
    llmClient,
    toolRouter,
    permissions,
    approvalQueue,
    memory,
    model: model || process.env.AGENT_MODEL || "gpt-5.5",
    systemPrompt,
  });

  // 4. 事件日志（保留控制台输出）
  agent.on("run:start", ({ runId, trigger }) => console.log(`[Agent] run:start ${runId} trigger=${trigger.type}`));
  agent.on("turn:start", ({ runId, turn }) => console.log(`[Agent] turn ${turn} (${runId})`));
  agent.on("thinking", ({ turn, text }) => console.log(`[Agent] turn ${turn} thinking: ${text.slice(0, 200)}`));
  agent.on("tool:start", ({ turn, tool }) => console.log(`[Agent] turn ${turn} tool:start ${tool}`));
  agent.on("tool:done", ({ turn, tool, result }) => console.log(`[Agent] turn ${turn} tool:done ${tool} → ${String(result).slice(0, 100)}`));
  agent.on("tool:denied", ({ turn, tool }) => console.log(`[Agent] turn ${turn} tool:denied ${tool}`));
  agent.on("tool:pending_approval", ({ turn, tool }) => console.log(`[Agent] turn ${turn} tool:pending_approval ${tool}`));
  agent.on("tool:approved", ({ turn, tool }) => console.log(`[Agent] turn ${turn} tool:approved ${tool}`));
  agent.on("tool:rejected", ({ turn, tool }) => console.log(`[Agent] turn ${turn} tool:rejected ${tool}`));
  agent.on("tool:error", ({ turn, tool, error }) => console.error(`[Agent] turn ${turn} tool:error ${tool}: ${error}`));
  agent.on("run:complete", ({ runId, turns }) => console.log(`[Agent] run:complete ${runId} in ${turns} turns`));
  agent.on("run:error", ({ runId, error }) => console.error(`[Agent] run:error ${runId}: ${error}`));
  agent.on("run:aborted", ({ runId }) => console.log(`[Agent] run:aborted ${runId}`));
  agent.on("run:max_turns", ({ runId }) => console.log(`[Agent] run:max_turns ${runId}`));

  // 5. 定时调度器
  const scheduler = new AgentScheduler({ db });

  const instance = {
    agent,
    approvalQueue,
    memory,
    snapshotEngine,
    permissions,
    toolRouter,
    scheduler,

    async startPatrol() {
      return await agent.run({ type: "patrol" });
    },

    async handleEvent(event, data) {
      return await agent.run({ type: "event", event, data });
    },

    async handleHumanMessage(message) {
      return await agent.run({ type: "human", message });
    },

    async handleFollowup(description, context) {
      return await agent.run({ type: "followup", description, context });
    },

    abort() {
      agent.abort();
    },

    destroy() {
      approvalQueue.destroy();
      scheduler.stop();
    },
  };

  // 6. 桥接 SSE
  const sse = getSSEManager();
  sse.bridgeAgent(instance);

  // 7. 启动调度器
  scheduler.setAgent(instance);
  scheduler.start();

  // 8. 把 scheduler 注入 toolRouter，让 schedule.followup 工具能用
  toolRouter._scheduler = scheduler;

  // 9. 子 Agent 管理器
  const subAgentManager = new SubAgentManager({
    llmClient,
    toolRouter,
    memory,
  });
  toolRouter._subAgentManager = subAgentManager;

  // 10. 自动经验沉淀 + 记忆衰减（挂载到 agent 事件上）
  agent.on("run:complete", ({ runId }) => {
    // 每天衰减一次（简单实现：每次 run 完成时检查）
    memory.decay().catch(() => {});
  });

  return instance;
}

module.exports = {
  createAgent,
  AgentLoop,
  ToolRouter,
  PermissionEngine,
  DEFAULT_RULES,
  ApprovalQueue,
  SnapshotEngine,
  AgentMemory,
  LlmClient,
};
