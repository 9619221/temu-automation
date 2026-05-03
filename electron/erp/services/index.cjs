const { ErpWorkflowService } = require("./workflowService.cjs");
const { PurchaseService } = require("./purchaseService.cjs");
const { InventoryService } = require("./inventoryService.cjs");
const { QcService } = require("./qcService.cjs");
const { OutboundService } = require("./outboundService.cjs");
const { WorkItemService } = require("./workItemService.cjs");

function createErpServices(db) {
  const workflow = new ErpWorkflowService({ db });
  const purchase = new PurchaseService({ workflow });
  const inventory = new InventoryService({ db, workflow });
  const qc = new QcService({ db, workflow, inventory });
  const outbound = new OutboundService({ db, workflow, inventory });
  const workItem = new WorkItemService({ db });

  return {
    workflow,
    purchase,
    inventory,
    qc,
    outbound,
    workItem,
  };
}

module.exports = {
  createErpServices,
  ErpWorkflowService,
  PurchaseService,
  InventoryService,
  QcService,
  OutboundService,
  WorkItemService,
};
