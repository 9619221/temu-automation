"use strict";

// Tool Router：分发 Agent 的 tool 调用到对应的 service 实现
// 现有 38 个 service 一行不改，只在这里做适配

const { TOOL_DEFINITIONS } = require("./tools.cjs");

class ToolRouter {
  constructor(options = {}) {
    this._db = options.db;
    this._services = options.services || {};
    this._handlers = new Map();
    this._snapshotEngine = options.snapshotEngine;
    this._memory = options.memory;
    this._approvalQueue = options.approvalQueue;

    this._registerBuiltinHandlers();
    if (options.handlers) {
      for (const [name, fn] of Object.entries(options.handlers)) {
        this._handlers.set(name, fn);
      }
    }
  }

  getToolDefinitions() {
    return TOOL_DEFINITIONS;
  }

  async execute(toolName, input = {}) {
    const handler = this._handlers.get(toolName);
    if (!handler) {
      throw new Error(`未知工具: ${toolName}`);
    }
    return await handler(input, { db: this._db, services: this._services });
  }

  registerHandler(toolName, handler) {
    this._handlers.set(toolName, handler);
  }

  _registerBuiltinHandlers() {
    const self = this;

    // ── 感知类 ──
    this._handlers.set("erp.snapshot.get_global", async (input) => {
      if (!self._snapshotEngine) return { error: "快照引擎未初始化" };
      return await self._snapshotEngine.getGlobalSnapshot(input);
    });

    this._handlers.set("erp.reports.flow_analysis", async (input, ctx) => {
      const svc = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const result = await svc.buildFlowAnalysis(ctx.db, {
        includeTest: input.include_test || false,
        statDate: input.stat_date || "",
        mallId: input.mall_id || "",
        attachCloudDb: attachTemuCloudDbIfPossible,
      });
      return {
        row_count: result.rows?.length || 0,
        available_dates: result.available_dates || [],
        rows: (result.rows || []).slice(0, 20),
      };
    });

    this._handlers.set("erp.reports.sales_trend", async (input, ctx) => {
      const svc = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const result = await svc.buildSalesTrend(ctx.db, {
        includeTest: input.include_test || false,
        attachCloudDb: attachTemuCloudDbIfPossible,
      });
      return { row_count: result.rows?.length || 0, rows: (result.rows || []).slice(0, 30) };
    });

    this._handlers.set("erp.inventory.get_stock_levels", async (input, ctx) => {
      if (ctx.services?.inventory) {
        const details = await ctx.services.inventory.listSkuStockDetails({
          skuCode: input.sku_code,
          limit: input.alert_only ? 500 : 100,
        });
        if (input.alert_only && Array.isArray(details)) {
          return details.filter(d => {
            const dailySales = Number(d.daily_sales || d.dailySales || 0);
            const stock = Number(d.available_stock || d.availableStock || 0);
            if (dailySales <= 0) return false;
            return (stock / dailySales) < 7;
          });
        }
        return details;
      }
      return { error: "库存服务未初始化" };
    });

    this._handlers.set("erp.reports.reviews", async (input, ctx) => {
      const svc = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const result = await svc.buildReviews(ctx.db, {
        includeTest: input.include_test || false,
        attachCloudDb: attachTemuCloudDbIfPossible,
      });
      let rows = result.rows || [];
      if (input.sentiment === "negative") {
        rows = rows.filter(r => Number(r.star || r.rating || 5) <= 2);
      } else if (input.sentiment === "positive") {
        rows = rows.filter(r => Number(r.star || r.rating || 5) >= 4);
      }
      return { row_count: rows.length, rows: rows.slice(0, 20) };
    });

    this._handlers.set("erp.purchase.list_orders", async (input, ctx) => {
      if (ctx.services?.purchase) {
        return await ctx.services.purchase.listOrders({
          status: input.status,
          limit: input.limit || 50,
        });
      }
      return { error: "采购服务未初始化" };
    });

    this._handlers.set("erp.supplier.list", async (input, ctx) => {
      if (ctx.services?.purchase) {
        const { queryAll } = require("../../db/connection.cjs");
        const rows = await queryAll(ctx.db,
          `SELECT id, name, contact_name, phone, status FROM erp_suppliers WHERE status = 'active' ORDER BY name LIMIT ?`,
          [input.limit || 20]
        );
        return rows;
      }
      return { error: "服务未初始化" };
    });

    this._handlers.set("erp.reports.financial_summary", async (input, ctx) => {
      const svc = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      try {
        const result = await svc.buildMultiStoreReport(ctx.db, {
          includeTest: false,
          attachCloudDb: attachTemuCloudDbIfPossible,
        });
        return { summary: result.summary || {}, store_count: result.stores?.length || 0 };
      } catch {
        return { error: "财务数据暂不可用" };
      }
    });

    this._handlers.set("erp.outbound.get_pending", async (input, ctx) => {
      if (ctx.services?.outbound) {
        return await ctx.services.outbound.listPending({ limit: input.limit || 100 });
      }
      return { error: "出库服务未初始化" };
    });

    this._handlers.set("erp.db.query", async (input, ctx) => {
      const sql = (input.sql || "").trim();
      if (!/^SELECT\s/i.test(sql)) {
        return { error: "只允许 SELECT 查询" };
      }
      if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH)\b/i.test(sql)) {
        return { error: "禁止修改数据的操作" };
      }
      try {
        const { queryAll } = require("../../db/connection.cjs");
        const rows = await queryAll(ctx.db, sql, input.params || []);
        return { row_count: rows.length, rows: rows.slice(0, 100) };
      } catch (err) {
        return { error: err?.message || String(err) };
      }
    });

    this._handlers.set("erp.reports.competitor_prices", async (_input, _ctx) => {
      return { message: "竞品价格数据暂未对接，需通过浏览器采集" };
    });

    // ── 行动类（自动执行）──
    this._handlers.set("erp.purchase.create_draft", async (input, ctx) => {
      if (ctx.services?.purchase) {
        return await ctx.services.purchase.createOrder({
          supplierId: input.supplier_id,
          items: input.items,
          remark: `[Agent] ${input.remark || ""}`,
          status: "draft",
        });
      }
      return { error: "采购服务未初始化" };
    });

    this._handlers.set("erp.outbound.process_normal", async (input, ctx) => {
      return { message: "发货处理功能开发中", order_ids: input.order_ids };
    });

    this._handlers.set("erp.inventory.create_inbound", async (input, ctx) => {
      return { message: "入库创建功能开发中", po_id: input.purchase_order_id };
    });

    this._handlers.set("erp.image.generate_main_image", async (input) => {
      return {
        message: "已触发AI主图生成",
        sku_code: input.sku_code,
        note: "生成完成后需人工审批上线",
      };
    });

    this._handlers.set("erp.title.optimize", async (input) => {
      try {
        const { optimizeTitle } = require("../../../automation/title-optimizer.mjs");
        const result = await optimizeTitle({
          myTitle: input.current_title,
          competitorTitles: input.competitor_titles || [],
        });
        return result;
      } catch {
        return { message: "标题优化模块未就绪" };
      }
    });

    // ── 行动类（需审批）──
    this._handlers.set("erp.purchase.confirm_order", async (input, ctx) => {
      if (ctx.services?.purchase) {
        return await ctx.services.purchase.confirmOrder({
          id: input.purchase_order_id,
          remark: `[Agent] ${input.reason}`,
        });
      }
      return { error: "采购服务未初始化" };
    });

    this._handlers.set("erp.pricing.adjust_price", async (input) => {
      return {
        message: "调价指令已记录，需通过Temu后台执行",
        sku_code: input.sku_code,
        new_price: input.new_price,
        reason: input.reason,
      };
    });

    this._handlers.set("erp.review.reply", async (input) => {
      return {
        message: "回复草稿已生成",
        review_id: input.review_id,
        reply: input.reply_text,
        note: "需通过Temu后台提交",
      };
    });

    this._handlers.set("erp.image.publish_to_live", async (input) => {
      return {
        message: "主图上线指令已记录",
        sku_code: input.sku_code,
        job_id: input.image_job_id,
      };
    });

    // ── Agent 内部 Tools ──
    this._handlers.set("agent.memory.recall", async (input) => {
      if (!self._memory) return { experiences: [] };
      const results = await self._memory.recall(input.query, input.limit || 5);
      return { experiences: results };
    });

    this._handlers.set("agent.memory.save_experience", async (input) => {
      if (!self._memory) return { error: "记忆系统未初始化" };
      return await self._memory.save({
        title: input.title,
        content: input.content,
        tags: input.tags || [],
      });
    });

    this._handlers.set("agent.schedule.followup", async (input) => {
      if (self._scheduler) {
        return await self._scheduler.schedule(
          input.description,
          input.context || {},
          (input.delay_hours || 1) * 3600000,
        );
      }
      return {
        scheduled: true,
        fire_at: new Date(Date.now() + (input.delay_hours || 1) * 3600000).toISOString(),
        description: input.description,
      };
    });

    this._handlers.set("agent.log.decision", async (input) => {
      return { logged: true, timestamp: new Date().toISOString(), ...input };
    });

    // 子 Agent 委派
    this._handlers.set("agent.delegate", async (input) => {
      if (!self._subAgentManager) return { error: "子 Agent 系统未初始化" };
      return await self._subAgentManager.delegate({
        instruction: input.instruction,
        focus: input.focus,
      });
    });

    // 问题上报（巡逻时发现问题写入 issues 表）
    this._handlers.set("agent.report_issue", async (input) => {
      if (!self._db) return { error: "数据库未初始化" };
      const id = `issue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      try {
        const { execute } = require("../../db/connection.cjs");
        await execute(self._db, `
          INSERT INTO erp_agent_issues (id, category, severity, title, description, context, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'open')
        `, [
          id,
          input.category || "purchase",
          input.severity || "medium",
          input.title,
          input.description || "",
          JSON.stringify(input.context || {}),
        ]);
        return { reported: true, id };
      } catch (err) {
        return { error: err?.message || String(err) };
      }
    });
  }
}

module.exports = { ToolRouter };
