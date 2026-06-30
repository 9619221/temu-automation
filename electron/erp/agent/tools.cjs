"use strict";

const TOOL_DEFINITIONS = [
  // ── 查询类 ──
  {
    name: "erp.db.query",
    description: "执行只读SQL查询（SELECT），可查商品、成本、库存、采购、订单、结算等任何ERP数据。",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SELECT语句，用?做参数占位" },
        params: { type: "array", items: {} },
      },
      required: ["sql"],
    },
  },
  {
    name: "erp.snapshot.get_global",
    description: "全局运营快照：GMV、异常SKU、待处理项、指标环比。巡逻时先调这个。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "erp.reports.flow_analysis",
    description: "商品流量漏斗：曝光→点击→加购→支付。诊断流量异常用。",
    input_schema: {
      type: "object",
      properties: {
        stat_date: { type: "string", description: "YYYY-MM-DD，空=最新" },
        mall_id: { type: "string", description: "店铺ID，空=全部" },
      },
    },
  },
  {
    name: "erp.reports.sales_trend",
    description: "SKU销售趋势：日销量、GMV、转化率变化。",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", default: 7 },
        sku_code: { type: "string" },
      },
    },
  },
  {
    name: "erp.reports.reviews",
    description: "商品评论列表，支持按好评/差评过滤。",
    input_schema: {
      type: "object",
      properties: {
        sentiment: { type: "string", enum: ["positive", "negative", "all"], default: "all" },
        days: { type: "integer", default: 3 },
      },
    },
  },
  {
    name: "erp.reports.financial_summary",
    description: "财务摘要：各店铺结算金额、利润概览。",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", default: 7 },
        mall_id: { type: "string" },
      },
    },
  },

  // ── 行动类（自动执行）──
  {
    name: "erp.purchase.create_draft",
    description: "创建采购单草稿（不直接下单）。",
    input_schema: {
      type: "object",
      properties: {
        supplier_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { sku_code: { type: "string" }, quantity: { type: "integer" }, unit_price: { type: "number" } },
            required: ["sku_code", "quantity"],
          },
        },
        remark: { type: "string" },
      },
      required: ["items"],
    },
  },
  {
    name: "erp.image.generate_main_image",
    description: "触发AI生成商品主图，生成后需人工审批。",
    input_schema: {
      type: "object",
      properties: { sku_code: { type: "string" }, style_direction: { type: "string" } },
      required: ["sku_code"],
    },
  },
  {
    name: "erp.title.optimize",
    description: "AI优化商品标题。",
    input_schema: {
      type: "object",
      properties: { sku_code: { type: "string" }, current_title: { type: "string" } },
      required: ["sku_code"],
    },
  },

  // ── 行动类（需审批）──
  {
    name: "erp.purchase.confirm_order",
    description: "确认采购单，触发实际下单。需审批。",
    input_schema: {
      type: "object",
      properties: { purchase_order_id: { type: "string" }, reason: { type: "string" } },
      required: ["purchase_order_id", "reason"],
    },
  },
  {
    name: "erp.pricing.adjust_price",
    description: "调整商品价格。需审批。",
    input_schema: {
      type: "object",
      properties: { sku_code: { type: "string" }, new_price: { type: "number" }, reason: { type: "string" } },
      required: ["sku_code", "new_price", "reason"],
    },
  },
  {
    name: "erp.review.reply",
    description: "回复商品评论。需审批。",
    input_schema: {
      type: "object",
      properties: { review_id: { type: "string" }, reply_text: { type: "string" } },
      required: ["review_id", "reply_text"],
    },
  },

  // ── Agent 内部 ──
  {
    name: "agent.memory.recall",
    description: "检索历史经验。",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", default: 5 } },
      required: ["query"],
    },
  },
  {
    name: "agent.memory.save_experience",
    description: "保存运营经验到记忆系统。",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["title", "content"],
    },
  },
  {
    name: "agent.log.decision",
    description: "记录决策日志。",
    input_schema: {
      type: "object",
      properties: { observation: { type: "string" }, reasoning: { type: "string" }, decision: { type: "string" } },
      required: ["observation", "reasoning", "decision"],
    },
  },
  {
    name: "agent.report_issue",
    description: "上报运营问题到追踪系统。",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["purchase", "inventory", "review", "traffic", "finance"] },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["category", "severity", "title"],
    },
  },
];

function getToolDefinitions() { return TOOL_DEFINITIONS; }
function getToolByName(name) { return TOOL_DEFINITIONS.find(t => t.name === name); }

module.exports = { TOOL_DEFINITIONS, getToolDefinitions, getToolByName };
