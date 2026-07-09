const { STAGES: WORKFLOW_STAGES } = require('./workflow');

const LIFECYCLE_STAGES = Object.freeze([
  'INTAKE_DRAFT',
  'TASK_REFINEMENT',
  'OPERATOR_APPROVAL',
  'IMPLEMENTATION',
  'QA_VERIFICATION',
  'SRE_VERIFICATION',
  'CLOSEOUT',
]);

const VALID_LIFECYCLE_MAP = Object.freeze({
  INTAKE_DRAFT: 0,
  TASK_REFINEMENT: 1,
  OPERATOR_APPROVAL: 2,
  IMPLEMENTATION: 3,
  QA_VERIFICATION: 4,
  SRE_VERIFICATION: 5,
  CLOSEOUT: 6,
});

const VALID_TRANSITIONS = Object.freeze({
  INTAKE_DRAFT: ['TASK_REFINEMENT'],
  TASK_REFINEMENT: ['OPERATOR_APPROVAL'],
  OPERATOR_APPROVAL: ['IMPLEMENTATION'],
  IMPLEMENTATION: ['QA_VERIFICATION'],
  QA_VERIFICATION: ['SRE_VERIFICATION'],
  SRE_VERIFICATION: ['CLOSEOUT'],
});

const LIFECYCLE_TO_WORKFLOW = Object.freeze({
  INTAKE_DRAFT: WORKFLOW_STAGES.DRAFT,
  TASK_REFINEMENT: WORKFLOW_STAGES.BACKLOG,
  OPERATOR_APPROVAL: WORKFLOW_STAGES.TODO,
  IMPLEMENTATION: WORKFLOW_STAGES.IMPLEMENTATION,
  QA_VERIFICATION: WORKFLOW_STAGES.QA_TESTING,
  SRE_VERIFICATION: WORKFLOW_STAGES.SRE_MONITORING,
  CLOSEOUT: WORKFLOW_STAGES.DONE,
});

class LifecycleTransitionError extends Error {
  constructor(message, code, allowedStages) {
    super(message);
    this.name = 'LifecycleTransitionError';
    this.code = code;
    this.statusCode = 409;
    this.allowedStages = allowedStages || [];
  }
}

class LifecycleStageGuard {
  validateTransition(fromStage, toStage) {
    if (fromStage === toStage) return;

    const fromIdx = VALID_LIFECYCLE_MAP[fromStage];
    const toIdx = VALID_LIFECYCLE_MAP[toStage];

    if (fromIdx === undefined || toIdx === undefined) {
      throw new LifecycleTransitionError(
        `Unknown stage: ${fromStage} or ${toStage}`,
        'INVALID_STAGE',
        LIFECYCLE_STAGES.filter((s) => s !== fromStage),
      );
    }

    if (fromIdx === LIFECYCLE_STAGES.length - 1) {
      throw new LifecycleTransitionError(
        `Cannot transition from ${LIFECYCLE_STAGES[fromIdx]}: task is already closed.`,
        'TASK_ALREADY_CLOSED',
        [],
      );
    }

    const allowed = VALID_TRANSITIONS[fromStage] || [];
    if (!allowed.includes(toStage)) {
      throw new LifecycleTransitionError(
        `Invalid transition: ${fromStage} -> ${toStage}. Expected one of: ${allowed.join(', ')}.`,
        'INVALID_STAGE_TRANSITION',
        allowed,
      );
    }
  }

  getAllowedTransitions(stage) {
    return [...(VALID_TRANSITIONS[stage] || [])];
  }

  getStages() {
    return [...LIFECYCLE_STAGES];
  }

  toWorkflowStage(lifecycleStage) {
    const wf = LIFECYCLE_TO_WORKFLOW[lifecycleStage];
    if (!wf) {
      throw new LifecycleTransitionError(
        `No workflow mapping for lifecycle stage: ${lifecycleStage}`,
        'INVALID_STAGE',
        [],
      );
    }
    return wf;
  }

  fromWorkflowStage(workflowStage) {
    const entry = Object.entries(LIFECYCLE_TO_WORKFLOW).find(
      ([, val]) => val === workflowStage,
    );
    return entry ? entry[0] : null;
  }
}

const METRICS = {
  lifecycle_stage_transitions_total: {},

  recordTransition(taskId, fromStage, toStage, result) {
    const key = `${taskId}:${fromStage}->${toStage}`;
    if (!this.lifecycle_stage_transitions_total[key]) {
      this.lifecycle_stage_transitions_total[key] = {
        total: 0,
        allowed: 0,
        blocked: 0,
        lastResult: null,
      };
    }

    const entry = this.lifecycle_stage_transitions_total[key];
    entry.total += 1;
    entry.lastResult = result;
    if (result === 'allowed') entry.allowed += 1;
    if (result === 'blocked') entry.blocked += 1;
  },

  getTransitionErrorRate() {
    let total = 0;
    let errors = 0;
    for (const data of Object.values(this.lifecycle_stage_transitions_total)) {
      total += data.total || 0;
      errors += data.blocked || 0;
    }
    return total === 0 ? 0 : errors / total;
  },

  clear() {
    this.lifecycle_stage_transitions_total = {};
  },
};

class StageTransitionRecorder {
  constructor(store) {
    this.store = store;
  }

  async record(taskId, body) {
    const fromStage = body.from_stage || 'NONE';
    const toStage = body.to_stage || 'NONE';
    const result = body.result || 'allowed';
    METRICS.recordTransition(taskId, fromStage, toStage, result);

    return this.store.appendEvent({
      taskId,
      eventType: 'task.stage_transition',
      actorId: body.actor_id || body.actorId || 'unknown',
      actorType: body.actor_type || body.actorType || 'user',
      payload: {
        from_stage: fromStage,
        to_stage: toStage,
        result,
        actor_label: body.actor_label || body.actorLabel || null,
      },
    });
  }

  async getTaskTransitionHistory(taskId) {
    if (!this.store.getTaskHistory) return [];
    const history = await this.store.getTaskHistory(taskId);
    return (history || []).filter((e) => e?.event_type === 'task.stage_transition');
  }
}

module.exports = {
  LIFECYCLE_STAGES,
  VALID_LIFECYCLE_MAP,
  LifecycleStageGuard,
  LifecycleTransitionError,
  StageTransitionRecorder,
  METRICS,
  LIFECYCLE_TO_WORKFLOW,
};
