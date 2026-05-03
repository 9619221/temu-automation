const {
  BATCH_QC_STATUS,
  QC_INSPECTION_STATUS: QC,
} = require("../workflow/enums.cjs");
const { decideQCResult } = require("../workflow/validators.cjs");

const QC_ACTION_BY_STATUS = Object.freeze({
  [QC.PASSED]: "submit_qc_passed",
  [QC.PASSED_WITH_OBSERVATION]: "submit_qc_observation",
  [QC.PARTIAL_PASSED]: "submit_qc_partial",
  [QC.FAILED]: "submit_qc_failed",
  [QC.REWORK_REQUIRED]: "submit_qc_rework",
});

const BATCH_STATUS_BY_QC_STATUS = Object.freeze({
  [QC.PASSED]: BATCH_QC_STATUS.PASSED,
  [QC.PASSED_WITH_OBSERVATION]: BATCH_QC_STATUS.PASSED_WITH_OBSERVATION,
  [QC.PARTIAL_PASSED]: BATCH_QC_STATUS.PARTIAL_PASSED,
  [QC.FAILED]: BATCH_QC_STATUS.FAILED,
  [QC.REWORK_REQUIRED]: BATCH_QC_STATUS.REWORK_REQUIRED,
});

class QcService {
  constructor({ db, workflow, inventory }) {
    if (!db) throw new Error("QcService requires db");
    if (!workflow) throw new Error("QcService requires workflow");
    if (!inventory) throw new Error("QcService requires inventory");
    this.db = db;
    this.workflow = workflow;
    this.inventory = inventory;
  }

  startInspection(id, actor) {
    return this.workflow.transition({
      entityType: "qc_inspection",
      id,
      action: "start_qc",
      toStatus: QC.IN_PROGRESS,
      actor,
      patch: {
        inspector_id: actor?.id || null,
      },
    });
  }

  submitByPercent(input = {}) {
    const qc = this.workflow.getEntity("qc_inspection", input.id);
    const batch = this.inventory.getBatch(qc.batch_id);
    const decision = decideQCResult({
      actualSampleQty: input.actualSampleQty,
      defectiveQty: input.defectiveQty,
    });
    const toStatus = decision.recommendedStatus;
    const action = QC_ACTION_BY_STATUS[toStatus];
    if (!action) throw new Error(`Unsupported QC status decision: ${toStatus}`);

    const releasePlan = this.buildReleasePlan({
      batch,
      toStatus,
      defectRate: decision.defectRate,
      defectiveQty: Number(input.defectiveQty),
    });

    const transition = this.workflow.transition({
      entityType: "qc_inspection",
      id: input.id,
      action,
      toStatus,
      actor: input.actor,
      patch: {
        actual_sample_qty: Number(input.actualSampleQty),
        defective_qty: Number(input.defectiveQty),
        defect_rate: decision.defectRate,
        release_qty: releasePlan.releaseQty,
        blocked_qty: releasePlan.blockedQty,
        rework_qty: releasePlan.reworkQty,
        inspector_id: input.actor?.id || qc.inspector_id || null,
        remark: input.remark || qc.remark || null,
      },
    });

    const updatedBatch = this.inventory.releaseAfterQc({
      batchId: batch.id,
      qcStatus: BATCH_STATUS_BY_QC_STATUS[toStatus],
      releaseQty: releasePlan.releaseQty,
      blockedQty: releasePlan.blockedQty,
      defectiveQty: releasePlan.defectiveQty,
      reworkQty: releasePlan.reworkQty,
      sourceDocId: input.id,
      actor: input.actor,
    });

    return {
      ...decision,
      transition,
      releasePlan,
      batch: updatedBatch,
    };
  }

  buildReleasePlan(input = {}) {
    const blockedQty = Number(input.batch.blocked_qty || 0);
    if (input.toStatus === QC.PASSED || input.toStatus === QC.PASSED_WITH_OBSERVATION) {
      return {
        releaseQty: blockedQty,
        blockedQty: 0,
        defectiveQty: Number(input.defectiveQty || 0),
        reworkQty: 0,
      };
    }
    if (input.toStatus === QC.PARTIAL_PASSED) {
      const releaseQty = Math.max(0, Math.floor(blockedQty * (1 - input.defectRate)));
      return {
        releaseQty,
        blockedQty: blockedQty - releaseQty,
        defectiveQty: Number(input.defectiveQty || 0),
        reworkQty: 0,
      };
    }
    return {
      releaseQty: 0,
      blockedQty,
      defectiveQty: Number(input.defectiveQty || 0),
      reworkQty: 0,
    };
  }
}

module.exports = {
  QcService,
};
