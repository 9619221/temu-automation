const { TRANSITIONS } = require("./transitions.cjs");
const {
  WORK_ITEM_PRIORITY,
  QC_INSPECTION_STATUS,
} = require("./enums.cjs");

class WorkflowTransitionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WorkflowTransitionError";
    this.code = "ERP_WORKFLOW_TRANSITION_DENIED";
    this.details = details;
  }
}

function normalizeRole(role) {
  return String(role || "").trim();
}

function findTransition({ entityType, fromStatus, toStatus, action }) {
  const rules = TRANSITIONS[entityType] || [];
  return rules.find((item) => (
    item.action === action
    && item.to === toStatus
    && item.from.includes(fromStatus)
  )) || null;
}

function canTransition(input = {}) {
  const {
    entityType,
    fromStatus,
    toStatus,
    action,
    role,
  } = input;
  const transition = findTransition({ entityType, fromStatus, toStatus, action });
  if (!transition) return false;
  return transition.roles.includes(normalizeRole(role));
}

function assertTransition(input = {}) {
  if (canTransition(input)) return true;
  throw new WorkflowTransitionError(
    `Transition denied: ${input.entityType || "unknown"} ${input.fromStatus || "?"} -> ${input.toStatus || "?"} via ${input.action || "?"}`,
    {
      entityType: input.entityType,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      action: input.action,
      role: input.role,
    },
  );
}

function decideQCResult(input = {}) {
  const actualSampleQty = Number(input.actualSampleQty);
  const defectiveQty = Number(input.defectiveQty);
  const observationThreshold = Number.isFinite(Number(input.observationThreshold))
    ? Number(input.observationThreshold)
    : 0.05;
  const failureThreshold = Number.isFinite(Number(input.failureThreshold))
    ? Number(input.failureThreshold)
    : 0.15;

  if (!Number.isFinite(actualSampleQty) || actualSampleQty <= 0) {
    throw new Error("actualSampleQty must be greater than 0");
  }
  if (!Number.isFinite(defectiveQty) || defectiveQty < 0) {
    throw new Error("defectiveQty must be greater than or equal to 0");
  }
  if (defectiveQty > actualSampleQty) {
    throw new Error("defectiveQty cannot exceed actualSampleQty");
  }

  const defectRate = defectiveQty / actualSampleQty;
  if (defectRate === 0) {
    return {
      defectRate,
      recommendedStatus: QC_INSPECTION_STATUS.PASSED,
    };
  }
  if (defectRate <= observationThreshold) {
    return {
      defectRate,
      recommendedStatus: QC_INSPECTION_STATUS.PASSED_WITH_OBSERVATION,
      priority: WORK_ITEM_PRIORITY.P2,
    };
  }
  if (defectRate <= failureThreshold) {
    return {
      defectRate,
      recommendedStatus: QC_INSPECTION_STATUS.PARTIAL_PASSED,
      priority: WORK_ITEM_PRIORITY.P1,
    };
  }
  return {
    defectRate,
    recommendedStatus: QC_INSPECTION_STATUS.FAILED,
    priority: WORK_ITEM_PRIORITY.P0,
  };
}

module.exports = {
  WorkflowTransitionError,
  findTransition,
  canTransition,
  assertTransition,
  decideQCResult,
};

