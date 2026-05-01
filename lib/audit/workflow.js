const { isWorkflowAuditEventType } = require('./event-types');

class WorkflowError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowError';
    this.code = 'workflow_violation';
    this.statusCode = 400;
  }
}

const STAGES = {
  DRAFT: 'DRAFT',
  BACKLOG: 'BACKLOG',
  ARCHITECT_REVIEW: 'ARCHITECT_REVIEW',
  TECHNICAL_SPEC: 'TECHNICAL_SPEC',
  IMPLEMENTATION: 'IMPLEMENTATION',
  CONTRACT_COVERAGE_AUDIT: 'CONTRACT_COVERAGE_AUDIT',
  QA_TESTING: 'QA_TESTING',
  SRE_MONITORING: 'SRE_MONITORING',
  PM_CLOSE_REVIEW: 'PM_CLOSE_REVIEW',
  VERIFY: 'VERIFY',
  REOPEN: 'REOPEN',
  DONE: 'DONE',
  // Legacy/Internal stages for compatibility with existing tests
  IN_PROGRESS: 'IN_PROGRESS',
  TODO: 'TODO',
};

const VALID_TRANSITIONS = {
  [STAGES.DRAFT]: [STAGES.BACKLOG],
  [STAGES.BACKLOG]: [STAGES.ARCHITECT_REVIEW, STAGES.TODO, STAGES.IN_PROGRESS],
  [STAGES.TODO]: [STAGES.BACKLOG, STAGES.ARCHITECT_REVIEW, STAGES.IN_PROGRESS],
  [STAGES.ARCHITECT_REVIEW]: [STAGES.TECHNICAL_SPEC],
  [STAGES.TECHNICAL_SPEC]: [STAGES.IMPLEMENTATION, STAGES.IN_PROGRESS],
  [STAGES.IN_PROGRESS]: [STAGES.TODO, STAGES.VERIFY, STAGES.QA_TESTING, STAGES.IMPLEMENTATION, STAGES.CONTRACT_COVERAGE_AUDIT],
  [STAGES.VERIFY]: [STAGES.DONE, STAGES.REOPEN],
  [STAGES.IMPLEMENTATION]: [STAGES.CONTRACT_COVERAGE_AUDIT, STAGES.QA_TESTING],
  [STAGES.CONTRACT_COVERAGE_AUDIT]: [STAGES.IMPLEMENTATION, STAGES.QA_TESTING],
  [STAGES.QA_TESTING]: [STAGES.IMPLEMENTATION, STAGES.SRE_MONITORING],
  [STAGES.REOPEN]: [STAGES.TODO, STAGES.IN_PROGRESS],
  [STAGES.SRE_MONITORING]: [STAGES.PM_CLOSE_REVIEW],
  [STAGES.PM_CLOSE_REVIEW]: [STAGES.DONE, STAGES.IMPLEMENTATION],
  [STAGES.DONE]: [STAGES.IMPLEMENTATION, STAGES.IN_PROGRESS], // Special case: backward
};

class WorkflowEngine {
  /**
   * Validates if a transition from fromStage to toStage is allowed.
   * @param {string} fromStage 
   * @param {string} toStage 
   * @param {object} payload The event payload containing rationale/artifacts for special transitions.
   * @throws WorkflowError if the transition is invalid.
   */
  validateTransition(fromStage, toStage, payload = {}) {
    if (fromStage === toStage) return;

    const allowed = VALID_TRANSITIONS[fromStage] || [];
    if (!allowed.includes(toStage)) {
      throw new WorkflowError(`Invalid transition: ${fromStage} → ${toStage}. Transition is not permitted.`);
    }

    // Special case: Done -> Implementation/In-Progress and PM close review -> Implementation
    if (
      (fromStage === STAGES.DONE && (toStage === STAGES.IMPLEMENTATION || toStage === STAGES.IN_PROGRESS))
      || (fromStage === STAGES.PM_CLOSE_REVIEW && toStage === STAGES.IMPLEMENTATION)
    ) {
      if (!payload.agreement_artifact || !payload.rationale) {
        throw new WorkflowError(`Backward transition from ${fromStage} to ${toStage} requires an agreement artifact and rationale.`);
      }
    }

    // Special case: No other backward transitions allowed
    const stageOrder = [
      STAGES.BACKLOG,
      STAGES.TODO,
      STAGES.ARCHITECT_REVIEW,
      STAGES.TECHNICAL_SPEC,
      STAGES.IMPLEMENTATION,
      STAGES.IN_PROGRESS,
      STAGES.CONTRACT_COVERAGE_AUDIT,
      STAGES.VERIFY,
      STAGES.REOPEN,
      STAGES.QA_TESTING,
      STAGES.SRE_MONITORING,
      STAGES.PM_CLOSE_REVIEW,
      STAGES.DONE,
    ];
    const fromIdx = stageOrder.indexOf(fromStage);
    const toIdx = stageOrder.indexOf(toStage);

    const allowedBackwardTransition = (fromStage === STAGES.DONE && (toStage === STAGES.IMPLEMENTATION || toStage === STAGES.IN_PROGRESS))
      || (fromStage === STAGES.QA_TESTING && toStage === STAGES.IMPLEMENTATION)
      || (fromStage === STAGES.CONTRACT_COVERAGE_AUDIT && toStage === STAGES.IMPLEMENTATION)
      || (fromStage === STAGES.PM_CLOSE_REVIEW && toStage === STAGES.IMPLEMENTATION)
      || (fromStage === STAGES.TODO && toStage === STAGES.BACKLOG)
      || (fromStage === STAGES.IN_PROGRESS && toStage === STAGES.TODO)
      || (fromStage === STAGES.REOPEN && (toStage === STAGES.TODO || toStage === STAGES.IN_PROGRESS));

    if (toIdx < fromIdx && !allowedBackwardTransition) {
      throw new WorkflowError(`Backward transitions are not allowed from ${fromStage} to ${toStage}.`);
    }
  }

  getStages() {
    return STAGES;
  }

  getStageOrder() {
    return [
      STAGES.BACKLOG,
      STAGES.TODO,
      STAGES.ARCHITECT_REVIEW,
      STAGES.TECHNICAL_SPEC,
      STAGES.IMPLEMENTATION,
      STAGES.IN_PROGRESS,
      STAGES.CONTRACT_COVERAGE_AUDIT,
      STAGES.VERIFY,
      STAGES.REOPEN,
      STAGES.QA_TESTING,
      STAGES.SRE_MONITORING,
      STAGES.PM_CLOSE_REVIEW,
      STAGES.DONE,
    ];
  }
}

module.exports = {
  WorkflowEngine,
  WorkflowError,
  STAGES,
};
