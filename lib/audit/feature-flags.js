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

function isTaskAssignmentEnabled(options = {}) {
  if (typeof options.taskAssignmentEnabled === 'boolean') return options.taskAssignmentEnabled;
  const raw = options.ffAssignAiAgentToTask ?? process.env.FF_ASSIGN_AI_AGENT_TO_TASK;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertTaskAssignmentEnabled(options = {}) {
  if (!isTaskAssignmentEnabled(options)) {
    const error = new Error('Task assignment is disabled by ff_assign_ai_agent_to_task');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_assign_ai_agent_to_task' };
    throw error;
  }
}

function isTaskAssignmentKillSwitchEnabled(options = {}) {
  if (typeof options.taskAssignmentKillSwitchEnabled === 'boolean') return options.taskAssignmentKillSwitchEnabled;
  const raw = options.ffAssignAiAgentToTaskKillswitch ?? process.env.FF_ASSIGN_AI_AGENT_TO_TASK_KILLSWITCH;
  if (raw === undefined || raw === null || raw === '') return false;
  return ['1', 'true', 'on', 'enabled', 'yes'].includes(String(raw).trim().toLowerCase());
}

function assertTaskAssignmentNotKilled(options = {}) {
  if (isTaskAssignmentKillSwitchEnabled(options)) {
    const error = new Error('Task assignment is disabled by ff_assign_ai_agent_to_task_killswitch');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_assign_ai_agent_to_task_killswitch' };
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

function isSreMonitoringEnabled(options = {}) {
  if (typeof options.sreMonitoringEnabled === 'boolean') return options.sreMonitoringEnabled;
  const raw = options.ffSreMonitoring
    ?? options.ff_sre_monitoring
    ?? options['ff-sre-monitoring']
    ?? process.env.FF_SRE_MONITORING;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertSreMonitoringEnabled(options = {}) {
  if (!isSreMonitoringEnabled(options)) {
    const error = new Error('SRE monitoring is disabled by ff_sre_monitoring');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_sre_monitoring' };
    throw error;
  }
}

function isChildTaskCreationEnabled(options = {}) {
  if (typeof options.childTaskCreationEnabled === 'boolean') return options.childTaskCreationEnabled;
  const raw = options.ffChildTaskCreation
    ?? options.ff_child_task_creation
    ?? options['ff-child-task-creation']
    ?? process.env.FF_CHILD_TASK_CREATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertChildTaskCreationEnabled(options = {}) {
  if (!isChildTaskCreationEnabled(options)) {
    const error = new Error('Child task creation is disabled by ff_child_task_creation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_child_task_creation' };
    throw error;
  }
}

function isCloseCancellationEnabled(options = {}) {
  if (typeof options.closeCancellationEnabled === 'boolean') return options.closeCancellationEnabled;
  const raw = options.ffCloseCancellation
    ?? options.ff_close_cancellation
    ?? options['ff-close-cancellation']
    ?? process.env.FF_CLOSE_CANCELLATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertCloseCancellationEnabled(options = {}) {
  if (!isCloseCancellationEnabled(options)) {
    const error = new Error('Close cancellation is disabled by ff_close_cancellation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_close_cancellation' };
    throw error;
  }
}

function isReassignmentGhostingEnabled(options = {}) {
  if (typeof options.reassignmentGhostingEnabled === 'boolean') return options.reassignmentGhostingEnabled;
  const raw = options.ffReassignmentGhosting ?? process.env.FF_REASSIGNMENT_GHOSTING;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertReassignmentGhostingEnabled(options = {}) {
  if (!isReassignmentGhostingEnabled(options)) {
    const error = new Error('Reassignment and ghosting workflow is disabled by ff_reassignment_ghosting');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_reassignment_ghosting' };
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
  const raw = options.ffRealSpecialistDelegation
    ?? options.ffSpecialistDelegation
    ?? process.env.FF_REAL_SPECIALIST_DELEGATION
    ?? process.env.FF_SPECIALIST_DELEGATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertSpecialistDelegationEnabled(options = {}) {
  if (!isSpecialistDelegationEnabled(options)) {
    const error = new Error('Specialist delegation is disabled by ff_real_specialist_delegation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_real_specialist_delegation' };
    throw error;
  }
}

function isGitHubSyncEnabled(options = {}) {
  if (typeof options.githubSyncEnabled === 'boolean') return options.githubSyncEnabled;
  const raw = options.ffGitHubSync ?? process.env.FF_GITHUB_SYNC;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertGitHubSyncEnabled(options = {}) {
  if (!isGitHubSyncEnabled(options)) {
    const error = new Error('GitHub sync is disabled by ff_github_sync');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_github_sync' };
    throw error;
  }
}

function isDependencyPlannerEnabled(options = {}) {
  if (typeof options.dependencyPlannerEnabled === 'boolean') return options.dependencyPlannerEnabled;
  const raw = options.ffDependencyPlanner ?? process.env.FF_DEPENDENCY_PLANNER;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertDependencyPlannerEnabled(options = {}) {
  if (!isDependencyPlannerEnabled(options)) {
    const error = new Error('Dependency planner is disabled by ff_dependency_planner');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_dependency_planner' };
    throw error;
  }
}

function isOrchestrationSchedulerEnabled(options = {}) {
  if (typeof options.orchestrationSchedulerEnabled === 'boolean') return options.orchestrationSchedulerEnabled;
  const raw = options.ffOrchestrationScheduler ?? process.env.FF_ORCHESTRATION_SCHEDULER;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertOrchestrationSchedulerEnabled(options = {}) {
  if (!isOrchestrationSchedulerEnabled(options)) {
    const error = new Error('Orchestration scheduler is disabled by ff_orchestration_scheduler');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_orchestration_scheduler' };
    throw error;
  }
}

function isOrchestrationVisibilityEnabled(options = {}) {
  if (typeof options.orchestrationVisibilityEnabled === 'boolean') return options.orchestrationVisibilityEnabled;
  const raw = options.ffOrchestrationVisibility ?? process.env.FF_ORCHESTRATION_VISIBILITY;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

module.exports = {
  isAuditFoundationEnabled,
  isWorkflowEngineEnabled,
  assertAuditFoundationEnabled,
  assertWorkflowEngineEnabled,
  isTaskCreationEnabled,
  assertTaskCreationEnabled,
  isTaskAssignmentEnabled,
  assertTaskAssignmentEnabled,
  isTaskAssignmentKillSwitchEnabled,
  assertTaskAssignmentNotKilled,
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
  isSreMonitoringEnabled,
  assertSreMonitoringEnabled,
  isChildTaskCreationEnabled,
  assertChildTaskCreationEnabled,
  isCloseCancellationEnabled,
  assertCloseCancellationEnabled,
  isReassignmentGhostingEnabled,
  assertReassignmentGhostingEnabled,
  isSpecialistDelegationEnabled,
  assertSpecialistDelegationEnabled,
  isGitHubSyncEnabled,
  assertGitHubSyncEnabled,
  isDependencyPlannerEnabled,
  assertDependencyPlannerEnabled,
  isOrchestrationSchedulerEnabled,
  assertOrchestrationSchedulerEnabled,
  isOrchestrationVisibilityEnabled,
};
