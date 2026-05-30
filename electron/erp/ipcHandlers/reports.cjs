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
      const data = await buildMultiStoreReport(erpState.db, { includeTest: payload?.includeTest });
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
}

module.exports = { registerReportsHandlers };
