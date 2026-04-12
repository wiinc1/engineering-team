function isAuditFoundationEnabled(options = {}) {
  if (typeof options.auditFoundationEnabled === 'boolean') return options.auditFoundationEnabled;
  const raw = options.ffAuditFoundation ?? process.env.FF_AUDIT_FOUNDATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function isWorkflowEngineEnabled(options = {}) {
  if (typeof options.workflowEngineEnabled === 'boolean') return options.workflowEngineEnabled;
  const raw = options.ffWorkflowEngine ?? process.env.FF_WORKFLOW_ENGINE;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertAuditFoundationEnabled(options = {}) {
  if (!isAuditFoundationEnabled(options)) {
    const error = new Error('Audit foundation is disabled by ff_audit_foundation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_audit_foundation' };
    throw error;
  }
}

function isTaskCreationEnabled(options = {}) {
  if (typeof options.taskCreationEnabled === 'boolean') return options.taskCreationEnabled;
  const raw = options.ffTaskCreation ?? process.env.FF_TASK_CREATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertTaskCreationEnabled(options = {}) {
  if (!isTaskCreationEnabled(options)) {
    const error = new Error('Task creation is disabled by ff_task_creation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_task_creation' };
    throw error;
  }
}

function isArchitectSpecTieringEnabled(options = {}) {
  if (typeof options.architectSpecTieringEnabled === 'boolean') return options.architectSpecTieringEnabled;
  const raw = options.ffArchitectSpecTiering ?? process.env.FF_ARCHITECT_SPEC_TIERING;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertArchitectSpecTieringEnabled(options = {}) {
  if (!isArchitectSpecTieringEnabled(options)) {
    const error = new Error('Architect spec tiering is disabled by ff_architect_spec_tiering');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_architect_spec_tiering' };
    throw error;
  }
}

function isEngineerSubmissionEnabled(options = {}) {
  if (typeof options.engineerSubmissionEnabled === 'boolean') return options.engineerSubmissionEnabled;
  const raw = options.ffEngineerSubmission ?? process.env.FF_ENGINEER_SUBMISSION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertEngineerSubmissionEnabled(options = {}) {
  if (!isEngineerSubmissionEnabled(options)) {
    const error = new Error('Engineer submission is disabled by ff_engineer_submission');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_engineer_submission' };
    throw error;
  }
}

function isTaskLockingEnabled(options = {}) {
  if (typeof options.taskLockingEnabled === 'boolean') return options.taskLockingEnabled;
  const raw = options.ffTaskLocking ?? process.env.FF_TASK_LOCKING;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertTaskLockingEnabled(options = {}) {
  if (!isTaskLockingEnabled(options)) {
    const error = new Error('Task locking is disabled by ff_task_locking');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_task_locking' };
    throw error;
  }
}

function isStructuredCommentsEnabled(options = {}) {
  if (typeof options.structuredCommentsEnabled === 'boolean') return options.structuredCommentsEnabled;
  const raw = options.ffStructuredComments ?? process.env.FF_STRUCTURED_COMMENTS;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertStructuredCommentsEnabled(options = {}) {
  if (!isStructuredCommentsEnabled(options)) {
    const error = new Error('Structured comments are disabled by ff_structured_comments');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_structured_comments' };
    throw error;
  }
}

function isQaStageEnabled(options = {}) {
  if (typeof options.qaStageEnabled === 'boolean') return options.qaStageEnabled;
  const raw = options.ffQaStage ?? process.env.FF_QA_STAGE;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertQaStageEnabled(options = {}) {
  if (!isQaStageEnabled(options)) {
    const error = new Error('QA stage is disabled by ff_qa_stage');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_qa_stage' };
    throw error;
  }
}

function isQaContextRoutingEnabled(options = {}) {
  if (typeof options.qaContextRoutingEnabled === 'boolean') return options.qaContextRoutingEnabled;
  const raw = options.ffQaContextRouting ?? process.env.FF_QA_CONTEXT_ROUTING;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertQaContextRoutingEnabled(options = {}) {
  if (!isQaContextRoutingEnabled(options)) {
    const error = new Error('QA context routing is disabled by ff_qa_context_routing');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_qa_context_routing' };
    throw error;
  }
}

function assertWorkflowEngineEnabled(options = {}) {
  if (!isWorkflowEngineEnabled(options)) {
    const error = new Error('Workflow engine is disabled by ff_workflow_engine');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_workflow_engine' };
    throw error;
  }
}

function isSpecialistDelegationEnabled(options = {}) {
  if (typeof options.specialistDelegationEnabled === 'boolean') return options.specialistDelegationEnabled;
  const raw = options.ffSpecialistDelegation ?? process.env.FF_SPECIALIST_DELEGATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertSpecialistDelegationEnabled(options = {}) {
  if (!isSpecialistDelegationEnabled(options)) {
    const error = new Error('Specialist delegation is disabled by ff_specialist_delegation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_specialist_delegation' };
    throw error;
  }
}

module.exports = {
  isAuditFoundationEnabled,
  isWorkflowEngineEnabled,
  assertAuditFoundationEnabled,
  assertWorkflowEngineEnabled,
  isTaskCreationEnabled,
  assertTaskCreationEnabled,
  isArchitectSpecTieringEnabled,
  assertArchitectSpecTieringEnabled,
  isEngineerSubmissionEnabled,
  assertEngineerSubmissionEnabled,
  isTaskLockingEnabled,
  assertTaskLockingEnabled,
  isStructuredCommentsEnabled,
  assertStructuredCommentsEnabled,
  isQaStageEnabled,
  assertQaStageEnabled,
  isQaContextRoutingEnabled,
  assertQaContextRoutingEnabled,
  isSpecialistDelegationEnabled,
  assertSpecialistDelegationEnabled,
};
