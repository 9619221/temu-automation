const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const ipc = require('./ipc.cjs');

const { dbPath, index } = workerData;
const db = new Database(dbPath, { readonly: true });
db.pragma('journal_mode = WAL');
db.pragma('query_only = ON');
db.pragma('busy_timeout = 10000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.__erpDbPath = dbPath;

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
