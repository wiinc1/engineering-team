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
  isSpecialistDelegationEnabled,
  assertSpecialistDelegationEnabled,
};
