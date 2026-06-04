"use strict";

// ipc.cjs 拆分（逐域抽离）第一步：reports 域 handler 从 ipc.cjs 抽出。
// 依赖注入方式：ipc.cjs 内部的 erpState / remoteRequest / client runtime helpers 作为 deps 传入。
// 后续逐域抽离时，这些共享依赖应进一步提取为独立的「ERP 运行时」模块，彻底解耦。
function registerReportsHandlers(ipcMain, deps) {
  const { erpState, remoteRequest, shouldUseClientRuntime, ensureClientRuntime, requireErp } = deps;

  ipcMain.handle("erp:reports:multi-store", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/multi-store?include_test=${includeTest}`, {
          method: "GET",
        });
      }
      requireErp();
      const { buildMultiStoreReport } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const data = await buildMultiStoreReport(erpState.db, {
        includeTest: payload?.includeTest,
        attachCloudDb: attachTemuCloudDbIfPossible,
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 纯查本地 erp_temu_malls 字典表（mall_id → store_code），不依赖云端报表。
  // 售后页等只需把 mall_id 翻成「temu-0XX店铺」，用这个轻量端点，云端崩了也能映射。
  ipcMain.handle("erp:reports:mall-dict", async () => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/mall-dict`, { method: "GET" });
      }
      requireErp();
      const { _internal } = require("../services/multiStoreReport.cjs");
      const malls = _internal.readMallDictionary(erpState.db);
      return { ok: true, data: { malls } };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 设置店铺运营负责人（多店报表 - 店铺归属）。写 erp_temu_malls.owner。
  ipcMain.handle("erp:reports:set-mall-owner", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/set-mall-owner`, {
          method: "POST",
          body: { mall_id: payload?.mallId, owner: payload?.owner ?? null },
        });
      }
      requireErp();
      const { setMallOwner } = require("../services/multiStoreReport.cjs");
      const changes = setMallOwner(erpState.db, payload?.mallId, payload?.owner);
      return { ok: true, data: { changes } };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台「今日待办」闭环:列出所有已标记状态(已处理/已忽略)
  ipcMain.handle("erp:op-task:list", async () => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/op-task/list`, { method: "GET" });
      }
      requireErp();
      const { listOpTaskState } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: listOpTaskState(erpState.db) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台「今日待办」闭环:标记一条待办(status=done/ignored;status=null 撤销)
  ipcMain.handle("erp:op-task:set", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/op-task/set`, {
          method: "POST",
          body: { task_key: payload?.taskKey, status: payload?.status ?? null, owner: payload?.owner ?? null },
        });
      }
      requireErp();
      const { setOpTaskState } = require("../services/multiStoreReport.cjs");
      const changes = setOpTaskState(erpState.db, payload?.taskKey, payload?.status ?? null, payload?.owner ?? null);
      return { ok: true, data: { changes } };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 活动报名:桌面端把任务下发到云端 enroll_task(扩展按店拉取执行)。直连云端,host/client 同。
  ipcMain.handle("erp:enroll:create", async (_event, payload) => {
    try {
      const { createEnrollTasks } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: await createEnrollTasks(payload?.tasks || []) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  // 轮询报名任务结果
  ipcMain.handle("erp:enroll:status", async (_event, payload) => {
    try {
      const { pollEnrollResults } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: await pollEnrollResults(payload?.taskIds || []) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 销售管理：SKU 级销售明细（跨店）
  ipcMain.handle("erp:reports:sku-sales", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/sku-sales?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildSkuSales } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const data = buildSkuSales(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：风险待办明细
  ipcMain.handle("erp:reports:risk-list", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/risk-list?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildRiskList } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildRiskList(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：活动机会明细
  ipcMain.handle("erp:reports:activity-list", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/activity-list?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildActivityList } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildActivityList(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：店铺健康（店铺级体检）
  ipcMain.handle("erp:reports:shop-health", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/shop-health?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildShopHealth } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildShopHealth(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：备货在途（未完成备货/发货单）
  ipcMain.handle("erp:reports:stock-orders", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/stock-orders?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildStockOrders } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildStockOrders(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：销量趋势（店铺级每日序列）
  ipcMain.handle("erp:reports:sales-trend", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/sales-trend?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildSalesTrend } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildSalesTrend(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 采购单报表：采购单明细 + 汇总 + 状态分布 + 供应商TOP + 月趋势（纯本地 erp.sqlite）
  ipcMain.handle("erp:reports:purchase", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/purchase`, { method: "GET" });
      }
      requireErp();
      const { buildPurchaseReport } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildPurchaseReport(erpState.db, { includeTest: payload?.includeTest }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：商品运营面板（活动/合规/流量/限流四维集成,SPU级）
  ipcMain.handle("erp:reports:product-panel", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/product-panel?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { getProductPanelFast } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: getProductPanelFast(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：平台仓质检结果（官方采集,默认列不合格 + 疵点;不走 cloud）
  ipcMain.handle("erp:reports:openapi-qc", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/openapi-qc?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildOpenapiQc } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildOpenapiQc(erpState.db, { includeTest: payload?.includeTest }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：商品销量趋势（逐日，数据走 cloud 抓包快照，按 product_id 关联）
  ipcMain.handle("erp:reports:product-trend", async (_event, payload) => {
    try {
      const pid = encodeURIComponent(String(payload?.productId || ""));
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/product-trend?product_id=${pid}`, { method: "GET" });
      }
      requireErp();
      const { buildProductSalesTrend } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildProductSalesTrend(erpState.db, { productId: payload?.productId, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerReportsHandlers };
