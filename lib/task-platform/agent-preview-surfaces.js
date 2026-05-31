function liveSurfaceImpact({ roleSupported, normalizedAgent, wouldCreateLiveAgent }) {
  return {
    assignmentControlImpact: {
      visibleForNewAssignment: wouldCreateLiveAgent,
      reason: wouldCreateLiveAgent ? 'active_assignable_supported_role' : 'blocked_or_not_assignable',
    },
    roleInboxImpact: {
      routedRole: roleSupported ? normalizedAgent.role : null,
      visibleInRoleInbox: wouldCreateLiveAgent && !!normalizedAgent.role,
    },
    pmOverviewBucketImpact: {
      bucket: roleSupported ? normalizedAgent.role : 'unsupported',
      visibleInBucket: wouldCreateLiveAgent && !!normalizedAgent.role,
    },
  };
}

function fallbackBehavior(delegation) {
  return {
    failClosed: delegation.enabled,
    coordinatorFallbackAllowedOnActivationFailure: false,
    reason: delegation.enabled ? 'delegation_activation_requires_passing_dry_run' : 'delegation_not_enabled',
  };
}

function permissionsImpact(delegation) {
  return {
    requiredToPreview: delegation.enabled ? ['agents:write', 'agent-delegation:write'] : ['agents:write'],
    requiredToSave: delegation.enabled ? ['agents:write', 'agent-delegation:write'] : ['agents:write'],
  };
}

function previewAudit({ actorId, tenantId, normalizedAgent }) {
  return {
    mutationType: 'agent_activation_previewed',
    actorId,
    tenantId,
    payload: {
      after: normalizedAgent,
      impactedCapabilities: ['assignment_controls', 'role_inboxes', 'pm_overview', 'delegation', 'reporting'],
    },
  };
}

function assemblePreview(input) {
  return {
    policyVersion: input.policyVersion,
    normalizedAgent: input.normalizedAgent,
    duplicateConflicts: input.duplicateConflicts,
    unsupportedCanonicalRole: { unsupported: !input.roleSupported, role: input.normalizedAgent.role },
    ...liveSurfaceImpact(input),
    delegationImpact: input.delegationImpact,
    fallbackBehavior: fallbackBehavior(input.delegation),
    permissionsImpact: permissionsImpact(input.delegation),
    reportingImpact: { dimensions: ['agent_id', 'role', 'active', 'assignable', 'delegation_enabled', 'runtime_agent'] },
    auditEventPreview: previewAudit(input),
    wouldCreateLiveAgent: input.wouldCreateLiveAgent,
    wouldCreateDraftRequest: !input.wouldCreateLiveAgent,
    blockers: input.blockers,
  };
}

module.exports = {
  assemblePreview,
};
