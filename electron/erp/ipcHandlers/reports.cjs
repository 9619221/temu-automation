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
      const { getMultiStoreReportFast } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const data = await getMultiStoreReportFast(erpState.db, {
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

  // 结算报表：独立端点，支持自定义时间段
  ipcMain.handle("erp:reports:settlement", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        const qs = new URLSearchParams();
        if (payload?.startDate) qs.set("start_date", payload.startDate);
        if (payload?.endDate) qs.set("end_date", payload.endDate);
        return await remoteRequest(`/api/erp/reports/settlement?${qs}`, { method: "GET" });
      }
      requireErp();
      const { querySettlementData } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      const data = querySettlementData(erpState.db, {
        startDate: payload?.startDate || null,
        endDate: payload?.endDate || null,
        attachCloudDb: attachTemuCloudDbIfPossible,
      });
      return { ok: true, data };
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

  // 运营工作台：商品数据看板（抓包 goodsDataShow）
  ipcMain.handle("erp:reports:goods-data-snapshot", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        const qs = new URLSearchParams();
        if (payload?.includeTest) qs.set("include_test", "1");
        if (payload?.mallId) qs.set("mall_id", payload.mallId);
        return await remoteRequest(`/api/erp/reports/goods-data-snapshot?${qs}`, { method: "GET" });
      }
      requireErp();
      const { buildGoodsDataSnapshot } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildGoodsDataSnapshot(erpState.db, { includeTest: payload?.includeTest, mallId: payload?.mallId, attachCloudDb: attachTemuCloudDbIfPossible }) };
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
      const { getOpenapiQcFast } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: getOpenapiQcFast(erpState.db, { includeTest: payload?.includeTest }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：今日首单发货(官方采集物化,读当天 erp_temu_firstship_daily)
  ipcMain.handle("erp:reports:firstship-today", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/firstship-today`, { method: "GET" });
      }
      requireErp();
      const { buildFirstShipToday } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildFirstShipToday(erpState.db, {}) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：今日创建商品(官方采集物化,读当天 erp_temu_goods_created_daily)
  ipcMain.handle("erp:reports:goods-created-today", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/goods-created-today`, { method: "GET" });
      }
      requireErp();
      const { buildGoodsCreatedToday } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildGoodsCreatedToday(erpState.db, {}) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：商品品质看板（Temu 后台「商品品质看板」抓包 → cloud.capture_events 解析:品质分/售后率/问题分布）
  ipcMain.handle("erp:reports:quality-panel", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/quality-panel?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { getQualityPanelFast } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: getQualityPanelFast(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：商品评价（Chrome 扩展抓包采集 → erp_temu_reviews;不走官方 API。默认全部评价按时间倒序）
  ipcMain.handle("erp:reports:reviews", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/reviews?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildReviews } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildReviews(erpState.db, { includeTest: payload?.includeTest }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：高价限流清单（被 Temu「高价流量受限」的商品,抓包 cloud.temu_operation_risk_snapshot;官方 API 无此数据）
  ipcMain.handle("erp:reports:high-price-flow", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/high-price-flow?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildHighPriceFlowList } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildHighPriceFlowList(erpState.db, { includeTest: payload?.includeTest, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：高价限流详情（点击商品弹窗,返回该商品的 SKU 级限流明细 + 站点列表）
  ipcMain.handle("erp:reports:high-price-flow-detail", async (_event, payload) => {
    try {
      const { mallId, productId } = payload || {};
      if (!mallId || !productId) return { ok: false, error: "mallId and productId required" };
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/high-price-flow-detail?mall_id=${encodeURIComponent(mallId)}&product_id=${encodeURIComponent(productId)}`, { method: "GET" });
      }
      requireErp();
      const { getHighPriceFlowDetail } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: getHighPriceFlowDetail(erpState.db, { mallId, productId, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 运营工作台：平台质检——点击实时拉某质检单的疵点照片(私有图签名会失效,故实时调详情拿新签名+后端带 referer 拉)
  ipcMain.handle("erp:reports:qc-flaw-images", async (_event, payload) => {
    try {
      const mallId = payload?.mallId || "";
      const qcBillId = payload?.qcBillId || "";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/qc-flaw-images?mall_id=${encodeURIComponent(mallId)}&qc_bill_id=${encodeURIComponent(qcBillId)}`, { method: "GET" });
      }
      requireErp();
      const { fetchQcFlawImages } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: await fetchQcFlawImages(erpState.db, { mallId, qcBillId }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle("erp:reports:warehouse-inventory", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/warehouse-inventory?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { buildWarehouseInventory } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildWarehouseInventory(erpState.db, { includeTest: payload?.includeTest }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 管线概览（ERP 侧生命周期）
  ipcMain.handle("erp:reports:pipeline-overview", async (_event, payload) => {
    try {
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        const force = payload?.force ? "1" : "0";
        return await remoteRequest(`/api/erp/reports/pipeline-overview?force=${force}`, { method: "GET" });
      }
      requireErp();
      const { buildPipelineOverview } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      return { ok: true, data: buildPipelineOverview(erpState.db, { force: !!payload?.force, attachCloudDb: attachTemuCloudDbIfPossible }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  // 单品风险标签
  ipcMain.handle("erp:reports:product-risk-tags", async (_event, payload) => {
    try {
      const codes = payload?.skuCodes || (payload?.skuCode ? [payload.skuCode] : []);
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest("/api/erp/reports/product-risk-tags", { method: "POST", body: { skuCodes: codes } });
      }
      requireErp();
      const { buildProductRiskTags } = require("../services/multiStoreReport.cjs");
      return { ok: true, data: buildProductRiskTags(erpState.db, { skuCodes: codes }) };
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
  // 运营工作台：SKU 站点绑定异常（扩展抓包 queryFullyOtherMessage → cloud snapshot → ERP 物化）
  ipcMain.handle("erp:reports:site-exceptions", async (_event, payload) => {
    try {
      const includeTest = payload?.includeTest ? "1" : "0";
      if (shouldUseClientRuntime()) {
        ensureClientRuntime();
        return await remoteRequest(`/api/erp/reports/site-exceptions?include_test=${includeTest}`, { method: "GET" });
      }
      requireErp();
      const { syncSiteExceptionsFromCapture, buildSiteExceptionList } = require("../services/multiStoreReport.cjs");
      const { attachTemuCloudDbIfPossible } = require("../lanServer.cjs");
      syncSiteExceptionsFromCapture(erpState.db, { attachCloudDb: attachTemuCloudDbIfPossible });
      return { ok: true, data: buildSiteExceptionList(erpState.db, { includeTest: payload?.includeTest }) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerReportsHandlers };
