const { parentPort, workerData } = require('worker_threads');
const ipc = require('./ipc.cjs');
const { openErpDatabaseReadonly } = require('../db/connection.cjs');

const { dbPath, index } = workerData;
// 复用统一的只读连接装配，pragma 逻辑单一来源（含「只读不可设 journal_mode」的修复）。
const db = openErpDatabaseReadonly(dbPath);

ipc.initErpReadonly(db);

const HANDLERS = {
  purchase_workbench: (args) => ipc.getPurchaseWorkbench(args),
  warehouse_workbench: (args) => ipc.getWarehouseWorkbench(args),
  qc_workbench: (args) => ipc.getQcWorkbench(args),
  outbound_workbench: (args) => ipc.getOutboundWorkbench(args),
};

parentPort.on('message', async ({ id, handler, args }) => {
  try {
    const fn = HANDLERS[handler];
    if (!fn) {
      throw new Error(`Unknown query handler: ${handler}`);
    }
    const result = await fn(args);
    parentPort.postMessage({ id, result: JSON.stringify(result) });
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || String(err) });
  }
});
