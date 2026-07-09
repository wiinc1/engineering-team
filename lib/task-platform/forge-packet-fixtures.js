const CORE_PACKET_VERSION = '2026-04-15';

function createCore(kind) {
  return {
    version: CORE_PACKET_VERSION,
    kind,
    taskId: 'TASK-123',
    taskVersion: '9',
    issuedAt: '2026-04-15T16:00:00Z',
    source: 'engineering-team',
    actor: {
      owner: 'main',
      role: 'adapter',
    },
    context: {
      projectId: 'engineering-team',
      domain: 'runtime',
      targetRepo: 'wiinc1/engineering-team',
    },
  };
}

function createExecutionStartPacket() {
  return {
    ...createCore('execution'),
    execution: {
      action: 'start',
      taskType: 'feature',
      priority: 'high',
      acceptanceCriteria: ['health endpoint boots', 'config validation runs'],
      affectsUi: false,
      summary: 'Start execution for the forgeadapter runtime bootstrap slice.',
      requestedOwner: 'main',
    },
  };
}

function createExecutionResumePacket() {
  return {
    ...createCore('execution'),
    execution: {
      action: 'resume',
      taskType: 'feature',
      priority: 'high',
      acceptanceCriteria: ['resume packet is deterministic', 'state is reloaded before execution'],
      affectsUi: false,
      summary: 'Resume execution for an existing task after a prior partial run.',
      resumeContext: {
        latestTaskState: 'Task is in progress and awaiting runtime continuation.',
        memorySummary: 'Hermes summary says config validation is complete and runtime work remains.',
        parentSessionId: 'sess_parent_123',
      },
    },
  };
}

function createExecutionDelegatePacket() {
  return {
    ...createCore('execution'),
    execution: {
      action: 'delegate',
      taskType: 'feature',
      priority: 'high',
      acceptanceCriteria: ['delegate packet is validated', 'target specialist receives context'],
      affectsUi: true,
      summary: 'Delegate a UI-impacting task to the assigned specialist.',
      resumeContext: {
        latestTaskState: 'Task is active and requires a specialist handoff.',
        memorySummary: 'Hermes summary says runtime is established and UI review is pending.',
        parentSessionId: 'sess_parent_123',
      },
      delegate: {
        targetAgent: 'ux',
        reason: 'UI-affecting work requires a UX specialist review and implementation pass.',
      },
    },
  };
}

function createReviewPendingPacket() {
  return {
    ...createCore('review'),
    review: {
      gate: 'qa',
      status: 'pending',
      questions: ['Are readiness semantics deterministic?', 'Do validation failures return remediation guidance?'],
      summary: 'QA review has been requested and is waiting on a reviewer decision.',
    },
  };
}

function createReviewApprovedPacket() {
  return {
    ...createCore('review'),
    review: {
      gate: 'architect',
      status: 'approved',
      summary: 'Architecture review approved the runtime projection and packet split.',
      decisionBy: {
        owner: 'architect-1',
        role: 'architect',
      },
      sessionId: 'sess_architect_1',
      nextAction: 'Resume execution and continue with the next runtime milestone.',
    },
  };
}

function createReviewChangesRequestedPacket() {
  return {
    ...createCore('review'),
    review: {
      gate: 'pm',
      status: 'changes_requested',
      summary: 'Product review requires clarification before approval.',
      decisionBy: {
        owner: 'pm-1',
        role: 'pm',
      },
      sessionId: 'sess_pm_1',
      findings: ['Clarify the remediation payload examples.', 'Document how review gate rejection differs from changes requested.'],
      blocking: true,
      nextAction: 'Update the contract docs and resubmit the PM review packet.',
    },
  };
}

function createReviewRejectedPacket() {
  return {
    ...createCore('review'),
    review: {
      gate: 'ux',
      status: 'rejected',
      summary: 'UX review rejected the current proposal because the control flow is incomplete.',
      decisionBy: {
        owner: 'ux-1',
        role: 'ux',
      },
      sessionId: 'sess_ux_1',
      findings: ['The delegate flow lacks the required runtime projection fields.', 'The rejection path is not documented for operators.'],
      blocking: true,
      nextAction: 'Revise the contract and reopen UX review with the missing runtime projection details.',
    },
  };
}

module.exports = {
  createCore,
  createExecutionStartPacket,
  createExecutionResumePacket,
  createExecutionDelegatePacket,
  createReviewPendingPacket,
  createReviewApprovedPacket,
  createReviewChangesRequestedPacket,
  createReviewRejectedPacket,
};