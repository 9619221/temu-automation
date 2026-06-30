import { useEffect, useRef, useState } from "react";

type AgentEvent =
  | { type: "run:start"; runId: string; trigger: { type: string } }
  | { type: "turn:start"; runId: string; turn: number }
  | { type: "thinking"; runId: string; turn: number; text: string }
  | { type: "tool:start"; runId: string; turn: number; tool: string; input?: any }
  | { type: "tool:done"; runId: string; turn: number; tool: string; result: string }
  | { type: "tool:pending_approval"; runId: string; turn: number; tool: string }
  | { type: "tool:approved"; runId: string; turn: number; tool: string }
  | { type: "tool:rejected"; runId: string; turn: number; tool: string }
  | { type: "tool:denied"; runId: string; turn: number; tool: string }
  | { type: "tool:error"; runId: string; turn: number; tool: string; error: string }
  | { type: "run:complete"; runId: string; turns: number }
  | { type: "run:error"; runId: string; error: string }
  | { type: "run:aborted"; runId: string }
  | { type: "run:max_turns"; runId: string }
  | { type: "reply"; runId: string; reply: string };

function getBaseUrl(): string {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "";
  return "https://erp.temu.chat";
}

export function useAgentSSE(onEvent: (event: AgentEvent) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const base = getBaseUrl();
    const es = new EventSource(`${base}/api/agent/stream`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const EVENTS = [
      "run:start", "turn:start", "thinking",
      "tool:start", "tool:done", "tool:pending_approval",
      "tool:approved", "tool:rejected", "tool:denied", "tool:error",
      "run:complete", "run:error", "run:aborted", "run:max_turns",
      "reply",
    ];

    for (const evt of EVENTS) {
      es.addEventListener(evt, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          cbRef.current({ type: evt, ...data } as AgentEvent);
        } catch { /* ignore */ }
      });
    }

    return () => { es.close(); setConnected(false); };
  }, []);

  return { connected };
}

// 工具名中文映射
const TOOL_ZH: Record<string, string> = {
  "db.query": "查询数据库",
  get_global_snapshot: "全局快照",
  flow_analysis: "流量分析",
  sales_trend: "销售趋势",
  get_stock_levels: "库存查询",
  reviews: "差评监控",
  list_orders: "订单列表",
  "supplier.list": "供应商",
  financial_summary: "财务汇总",
  get_pending: "待处理事项",
  competitor_prices: "竞品价格",
  create_draft: "创建草稿",
  process_normal: "常规发货",
  create_inbound: "创建入库",
  generate_main_image: "生成主图",
  "title.optimize": "标题优化",
  confirm_order: "确认订单",
  adjust_price: "调整价格",
  "review.reply": "回复评论",
  publish_to_live: "上线主图",
  "memory.recall": "回忆经验",
  "memory.save_experience": "保存经验",
  "schedule.followup": "定时跟进",
  "log.decision": "记录决策",
};

export function toolZh(name: string): string {
  return TOOL_ZH[name] || TOOL_ZH[name.split(".").pop() || ""] || name.split(".").pop() || name;
}

export type { AgentEvent };
