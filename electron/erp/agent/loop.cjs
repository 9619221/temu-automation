"use strict";

const { EventEmitter } = require("events");

// Agent 核心循环：Observe → Orient → Decide → Act → Reflect
// 参照 Claude Code 的 Gather → Act → Verify 自适应循环

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 50;
const MAX_TOOL_RESULT_CHARS = 8000;

class AgentLoop extends EventEmitter {
  constructor(options = {}) {
    super();
    this._llmClient = options.llmClient;        // { chat(messages, tools) → response }
    this._toolRouter = options.toolRouter;       // { execute(name, input) → result }
    this._permissions = options.permissions;     // { check(toolName, input) → 'allow'|'ask'|'deny' }
    this._approvalQueue = options.approvalQueue; // { submit(item) → Promise<boolean> }
    this._contextManager = options.contextManager;
    this._memory = options.memory;
    this._model = options.model || DEFAULT_MODEL;
    this._systemPrompt = options.systemPrompt || "";
    this._running = false;
    this._abortController = null;
  }

  get running() { return this._running; }

  async run(trigger) {
    if (this._running) throw new Error("Agent loop already running");
    this._running = true;
    this._abortController = new AbortController();

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.emit("run:start", { runId, trigger });

    try {
      const messages = await this._buildInitialMessages(trigger);
      const tools = this._toolRouter.getToolDefinitions();
      let turnCount = 0;

      while (turnCount < MAX_TURNS) {
        if (this._abortController.signal.aborted) {
          this.emit("run:aborted", { runId });
          break;
        }

        turnCount++;
        this.emit("turn:start", { runId, turn: turnCount });

        const response = await this._llmClient.chat({
          model: this._model,
          system: this._systemPrompt,
          messages,
          tools,
          max_tokens: 4096,
        });

        const assistantMessage = { role: "assistant", content: response.content };
        messages.push(assistantMessage);

        // 处理 response 中的每个 content block
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === "text" && block.text) {
            this.emit("thinking", { runId, turn: turnCount, text: block.text });
          }

          if (block.type === "tool_use") {
            const result = await this._handleToolUse(runId, turnCount, block);
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result.content });
            this.emit("tool:done", { runId, turn: turnCount, tool: block.name, result: result.content });
          }
        }

        // 如果有 tool 调用，把结果追加到 messages 继续循环
        if (toolResults.length > 0) {
          messages.push({ role: "user", content: toolResults });
          continue;
        }

        // 没有 tool 调用 = LLM 认为任务完成
        if (response.stop_reason === "end_turn") {
          this.emit("run:complete", { runId, turns: turnCount });
          break;
        }
      }

      if (turnCount >= MAX_TURNS) {
        this.emit("run:max_turns", { runId, turns: turnCount });
      }

      return { runId, turns: turnCount, messages };
    } catch (error) {
      this.emit("run:error", { runId, error: error.message || String(error) });
      throw error;
    } finally {
      this._running = false;
      this._abortController = null;
    }
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
    }
  }

  async _buildInitialMessages(trigger) {
    const messages = [];

    // 1. 如果有记忆系统，检索相关经验
    let memoryContext = "";
    if (this._memory) {
      const experiences = await this._memory.recall(trigger.description || trigger.type || "");
      if (experiences.length > 0) {
        memoryContext = "\n\n## 相关历史经验\n" + experiences.map(e => `- ${e.content}`).join("\n");
      }
    }

    // 2. 构建触发消息
    let content = "";
    switch (trigger.type) {
      case "patrol":
        content = "开始运营巡逻。请先调用 get_global_snapshot 获取全局数据快照，识别异常项，按优先级逐个处理。";
        break;
      case "event":
        content = `收到事件通知：${trigger.event}。请分析情况并决定行动。\n\n事件详情：${JSON.stringify(trigger.data || {})}`;
        break;
      case "human":
        content = trigger.message || "用户发起了对话";
        break;
      case "followup":
        content = `定时跟进检查：${trigger.description}。请检查之前决策的效果。`;
        break;
      default:
        content = trigger.message || "请开始工作";
    }

    if (memoryContext) {
      content += memoryContext;
    }

    messages.push({ role: "user", content });
    return messages;
  }

  async _handleToolUse(runId, turn, toolBlock) {
    const { id, name, input } = toolBlock;
    this.emit("tool:start", { runId, turn, tool: name, input });

    // 1. 权限检查
    if (this._permissions) {
      const permission = this._permissions.check(name, input);

      if (permission === "deny") {
        this.emit("tool:denied", { runId, turn, tool: name });
        return { content: JSON.stringify({ error: `操作被禁止: ${name}` }) };
      }

      if (permission === "ask") {
        this.emit("tool:pending_approval", { runId, turn, tool: name, input });

        if (this._approvalQueue) {
          const approved = await this._approvalQueue.submit({
            runId, turn, toolName: name, toolInput: input,
            toolUseId: id,
          });
          if (!approved) {
            this.emit("tool:rejected", { runId, turn, tool: name });
            return { content: JSON.stringify({ error: "用户拒绝了该操作", tool: name }) };
          }
          this.emit("tool:approved", { runId, turn, tool: name });
        }
      }
    }

    // 2. 执行工具
    try {
      const result = await this._toolRouter.execute(name, input);
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      const truncated = resultStr.length > MAX_TOOL_RESULT_CHARS
        ? resultStr.slice(0, MAX_TOOL_RESULT_CHARS) + "\n...(结果已截断)"
        : resultStr;
      return { content: truncated };
    } catch (error) {
      this.emit("tool:error", { runId, turn, tool: name, error: error.message });
      return { content: JSON.stringify({ error: error.message || String(error) }) };
    }
  }
}

module.exports = { AgentLoop };
