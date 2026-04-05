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

module.exports = {
  isAuditFoundationEnabled,
  isWorkflowEngineEnabled,
  assertAuditFoundationEnabled,
  assertWorkflowEngineEnabled,
  isTaskCreationEnabled,
  assertTaskCreationEnabled,
};
