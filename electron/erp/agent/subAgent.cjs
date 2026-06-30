"use strict";

// 子 Agent 系统
// 主 Agent 通过 agent.delegate 工具把数据采集任务委派给子 Agent
// 子 Agent 用更便宜的模型，只有只读工具权限

const { AgentLoop } = require("./loop.cjs");
const { TOOL_DEFINITIONS } = require("./tools.cjs");

// 子 Agent 只能用感知类工具 + 记忆检索
const READ_ONLY_PREFIXES = [
  "erp.snapshot.", "erp.reports.", "erp.inventory.get_",
  "erp.purchase.list_", "erp.supplier.", "erp.outbound.get_",
  "agent.memory.recall",
];

function isReadOnlyTool(name) {
  return READ_ONLY_PREFIXES.some(p => name.startsWith(p));
}

function getSubAgentTools() {
  return TOOL_DEFINITIONS.filter(t => isReadOnlyTool(t.name));
}

class SubAgentManager {
  constructor(options = {}) {
    this._llmClient = options.llmClient;
    this._toolRouter = options.toolRouter;
    this._memory = options.memory;
    this._subModel = options.subModel || process.env.SUB_AGENT_MODEL || "gpt-4o-mini";
    this._maxConcurrent = 3;
    this._running = 0;
  }

  async delegate(task) {
    if (this._running >= this._maxConcurrent) {
      return { error: `子 Agent 并发上限（${this._maxConcurrent}），请等待当前任务完成` };
    }

    this._running++;
    try {
      const subAgent = new AgentLoop({
        llmClient: this._llmClient,
        toolRouter: this._toolRouter,
        memory: this._memory,
        model: this._subModel,
        systemPrompt: SUB_AGENT_PROMPT,
      });

      // 限制子 Agent 只能用只读工具
      const originalGetTools = subAgent._toolRouter.getToolDefinitions.bind(subAgent._toolRouter);
      subAgent._toolRouter.getToolDefinitions = () => getSubAgentTools();

      const { messages, turns } = await subAgent.run({
        type: "human",
        message: task.instruction,
      });

      // 提取子 Agent 的回复
      let result = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === "assistant" && Array.isArray(m.content)) {
          const txt = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
          if (txt) { result = txt; break; }
        } else if (m.role === "assistant" && typeof m.content === "string" && m.content) {
          result = m.content; break;
        }
      }

      return {
        result: result || "子 Agent 未返回结果",
        turns,
        model: this._subModel,
      };
    } catch (error) {
      return { error: error?.message || String(error) };
    } finally {
      this._running--;
    }
  }
}

const SUB_AGENT_PROMPT = `你是鲁米斯（Lumis）的数据采集子 Agent。你的职责是根据指令，调用 ERP 数据查询工具收集信息，然后汇总成结构化的分析报告返回给主 Agent。

规则：
- 你只有只读查询权限，不能执行任何修改操作
- 收集到数据后，整理成清晰的要点列表
- 如果查询出错，说明错误原因
- 保持简洁，只返回关键数据和分析结论
- 用中文回复`;

module.exports = { SubAgentManager, getSubAgentTools };
