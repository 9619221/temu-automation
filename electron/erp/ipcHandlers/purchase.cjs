"use strict";

// ipc.cjs 拆分（逐域抽离）：purchase 域 handler 抽出（依赖注入）。
// 依赖注入 ipc.cjs 内的 runtime 函数与 wrapErpHandler。
function registerPurchaseHandlers(ipcMain, deps) {
  const { getPurchaseWorkbenchRuntime, performPurchaseActionRuntime, wrapErpHandler } = deps;

  ipcMain.handle(
    "erp:purchase:workbench",
    wrapErpHandler("erp:purchase:workbench", (_event, params) => getPurchaseWorkbenchRuntime(params || {})),
  );
  ipcMain.handle(
    "erp:purchase:action",
    wrapErpHandler("erp:purchase:action", (_event, payload) => performPurchaseActionRuntime(payload || {})),
  );
}

module.exports = { registerPurchaseHandlers };
