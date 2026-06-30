"use strict";

// 全局快照摘要引擎：把海量运营数据压缩成 Agent 可消费的 ~500 token 快照
// 纯 SQL + 规则引擎，不用 LLM，便宜快速可靠

const { queryAll, queryOne } = require("../../db/connection.cjs");

class SnapshotEngine {
  constructor(options = {}) {
    this._db = options.db;
    this._attachCloudDb = options.attachCloudDb;
  }

  async getGlobalSnapshot(input = {}) {
    const db = this._db;
    if (!db) return { error: "数据库未初始化" };

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const snapshot = {
      generated_at: new Date().toISOString(),
      date: today,
      sections: {},
    };

    // 1. 采购概况
    try {
      const purchaseSummary = await queryOne(db, `
        SELECT
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count,
          SUM(CASE WHEN status = 'approved_to_pay' THEN 1 ELSE 0 END) AS pending_payment_count,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
          SUM(CASE WHEN status = 'arrived' THEN 1 ELSE 0 END) AS arrived_count,
          SUM(CASE WHEN status = 'inbounded' THEN 1 ELSE 0 END) AS inbounded_count
        FROM erp_purchase_orders
        WHERE created_at > datetime('now', '-30 days')
      `, []);
      snapshot.sections.purchase = {
        label: "采购",
        draft: Number(purchaseSummary?.draft_count || 0),
        pending_payment: Number(purchaseSummary?.pending_payment_count || 0),
        paid_awaiting_arrival: Number(purchaseSummary?.paid_count || 0),
        arrived_awaiting_inbound: Number(purchaseSummary?.arrived_count || 0),
        completed: Number(purchaseSummary?.inbounded_count || 0),
      };
    } catch {
      snapshot.sections.purchase = { label: "采购", error: "查询失败" };
    }

    // 2. 库存预警
    try {
      const stockAlerts = await queryAll(db, `
        SELECT internal_sku_code AS sku_code, product_name AS name,
               CAST(COALESCE(jst_actual_stock_qty, 0) AS INTEGER) AS stock
        FROM erp_skus
        WHERE status = 'active' AND COALESCE(jst_actual_stock_qty, 0) < 50
        ORDER BY COALESCE(jst_actual_stock_qty, 0) ASC
        LIMIT 10
      `, []);
      snapshot.sections.inventory = {
        label: "库存预警",
        low_stock_count: stockAlerts.length,
        top_alerts: stockAlerts.map(r => ({
          sku: r.sku_code,
          name: (r.name || "").slice(0, 30),
          stock: r.stock,
        })),
      };
    } catch {
      snapshot.sections.inventory = { label: "库存预警", error: "查询失败" };
    }

    // 3. 流量数据
    try {
      const flowSummary = await queryAll(db, `
        SELECT m.mall_name, f.stat_date,
               SUM(CAST(f.expose_num AS INTEGER)) AS total_exposure,
               SUM(CAST(f.click_num AS INTEGER)) AS total_clicks,
               SUM(CAST(f.detail_visitor_num AS INTEGER)) AS total_detail,
               SUM(CAST(f.add_to_cart_user_num AS INTEGER)) AS total_cart,
               SUM(CAST(f.buyer_num AS INTEGER)) AS total_buyers
        FROM temu_product_flow_snapshot f
        LEFT JOIN erp_temu_malls m ON m.mall_id = f.mall_id
        WHERE f.stat_date >= $1
        GROUP BY m.mall_name, f.stat_date
        ORDER BY f.stat_date DESC
        LIMIT 10
      `, [sevenDaysAgo]);
      snapshot.sections.flow = {
        label: "流量概况",
        rows: flowSummary.map(r => ({
          store: r.mall_name,
          date: r.stat_date,
          exposure: Number(r.total_exposure || 0),
          clicks: Number(r.total_clicks || 0),
          detail_visitors: Number(r.total_detail || 0),
          cart_adds: Number(r.total_cart || 0),
          buyers: Number(r.total_buyers || 0),
        })),
      };
    } catch {
      snapshot.sections.flow = { label: "流量概况", note: "cloud数据暂不可用" };
    }

    // 4. 待处理项汇总
    try {
      const pendingItems = await queryOne(db, `
        SELECT
          (SELECT COUNT(*) FROM erp_work_items WHERE status = 'open') AS open_work_items,
          (SELECT COUNT(*) FROM erp_purchase_orders WHERE status = 'draft') AS draft_pos
      `, []);
      snapshot.sections.pending = {
        label: "待处理",
        open_work_items: Number(pendingItems?.open_work_items || 0),
        draft_purchase_orders: Number(pendingItems?.draft_pos || 0),
      };
    } catch {
      snapshot.sections.pending = { label: "待处理", error: "查询失败" };
    }

    // 5. Agent 审批队列
    try {
      const pendingApprovals = await queryOne(db, `
        SELECT COUNT(*) AS cnt FROM erp_agent_approvals WHERE status = 'pending'
      `, []);
      snapshot.sections.approvals = {
        label: "Agent审批",
        pending: Number(pendingApprovals?.cnt || 0),
      };
    } catch {
      snapshot.sections.approvals = { label: "Agent审批", pending: 0 };
    }

    return snapshot;
  }
}

module.exports = { SnapshotEngine };
