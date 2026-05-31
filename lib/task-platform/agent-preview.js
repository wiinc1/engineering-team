const crypto = require('crypto');
const {
  classifySpecialistRequest,
  SPECIALIST_ROUTING_RULES,
} = require('../software-factory/delegation');
const { TASK_TYPE_TO_SPECIALIST, resolveTaskSpecialist } = require('../software-factory/task-dispatch');
const {
  normalizeAgentRole,
  normalizeCreateAiAgentInput,
  isSupportedAgentRole,
} = require('./ai-agents');
const {
  buildOpenClawArgs,
  resolveRuntimeAgent,
  resolveSpecialistMap,
} = require('../../scripts/openclaw-specialist-runner');
const { assemblePreview } = require('./agent-preview-surfaces');

const AGENT_ACTIVATION_PREVIEW_POLICY_VERSION = 'agent-activation-preview.v1';
const ALLOWED_SPECIALIST_FAMILIES = Object.freeze(['architect', 'engineer', 'qa', 'sre']);

function cloneJson(value, fallback = {}) {
  if (value === undefined) return fallback;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function readDelegationConfig(input = {}) {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const delegation = input.delegation && typeof input.delegation === 'object' && !Array.isArray(input.delegation)
    ? input.delegation
    : metadata.delegation && typeof metadata.delegation === 'object' && !Array.isArray(metadata.delegation)
      ? metadata.delegation
      : {};
  const enabled = input.delegationEnabled === true
    || input.delegation_enabled === true
    || metadata.delegationEnabled === true
    || metadata.delegation_enabled === true
    || delegation.enabled === true;
  return {
    enabled,
    specialist: normalizeAgentRole(
      delegation.specialist
      || delegation.specialistFamily
      || delegation.specialist_family
      || input.delegationSpecialist
      || input.delegation_specialist
      || input.role,
    ),
    runtimeAgent: delegation.runtimeAgent || delegation.runtime_agent || null,
    routeKeywords: Array.isArray(delegation.routeKeywords)
      ? delegation.routeKeywords
      : Array.isArray(delegation.route_keywords)
        ? delegation.route_keywords
        : [],
    taskTypes: Array.isArray(delegation.taskTypes)
      ? delegation.taskTypes
      : Array.isArray(delegation.task_types)
        ? delegation.task_types
        : [],
    sampleTaskType: delegation.sampleTaskType || delegation.sample_task_type || input.taskType || input.task_type || null,
    sampleRequest: String(
      delegation.sampleRequest
      || delegation.sample_request
      || input.sampleRequest
      || input.sample_request
      || '',
    ).trim(),
  };
}

function normalizePreviewAgent(input = {}, actorId = 'system') {
  try {
    return {
      agent: normalizeCreateAiAgentInput(input, actorId),
      normalizationErrors: [],
    };
  } catch (error) {
    const role = normalizeAgentRole(input.role);
    return {
      agent: {
        agent_id: String(input.agentId ?? input.agent_id ?? input.id ?? '').trim().toLowerCase(),
        display_name: String(input.displayName ?? input.display_name ?? input.agentId ?? input.agent_id ?? '').trim(),
        role,
        description: input.description == null ? null : String(input.description).trim() || null,
        execution_kind: String(input.executionKind ?? input.execution_kind ?? 'software-factory').trim() || 'software-factory',
        active: input.active !== false,
        assignable: input.active === false ? false : input.assignable !== false,
        environment_scope: String(input.environmentScope ?? input.environment_scope ?? 'default').trim() || 'default',
        metadata: cloneJson(input.metadata, {}),
        version: 1,
        created_by_actor_id: String(actorId || 'system'),
        updated_by_actor_id: String(actorId || 'system'),
      },
      normalizationErrors: [{
        code: error.code || 'invalid_agent',
        message: error.message,
        details: error.details || null,
      }],
    };
  }
}

function agentRecord(agent) {
  return {
    agentId: agent.agent_id,
    displayName: agent.display_name,
    role: normalizeAgentRole(agent.role),
    description: agent.description || null,
    executionKind: agent.execution_kind,
    active: agent.active !== false,
    assignable: agent.assignable !== false,
    environmentScope: agent.environment_scope || 'default',
    metadata: cloneJson(agent.metadata, {}),
    version: Number(agent.version || 1),
  };
}

function previewToken(preview) {
  const stable = JSON.stringify({
    policyVersion: preview.policyVersion,
    normalizedAgent: preview.normalizedAgent,
    duplicateConflicts: preview.duplicateConflicts,
    unsupportedCanonicalRole: preview.unsupportedCanonicalRole,
    delegationImpact: preview.delegationImpact,
    wouldCreateLiveAgent: preview.wouldCreateLiveAgent,
    wouldCreateDraftRequest: preview.wouldCreateDraftRequest,
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function detectRouteCollisions({ routeKeywords = [], taskTypes = [], specialist }) {
  const collisions = [];
  for (const keyword of routeKeywords.map(value => String(value || '').trim()).filter(Boolean)) {
    const route = classifySpecialistRequest(keyword);
    if (route.confidence !== 'none') {
      collisions.push({
        type: 'route_keyword',
        value: keyword,
        existingRoute: route.rule,
        expectedSpecialist: specialist,
      });
    }
  }
  for (const taskType of taskTypes.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)) {
    const existing = resolveTaskSpecialist(taskType);
    if (existing) {
      collisions.push({
        type: 'task_type',
        value: taskType,
        existingRoute: existing,
        expectedSpecialist: specialist,
      });
    }
  }
  return collisions;
}

function sampleRequestForSpecialist(specialist, configured = '') {
  if (configured) return configured;
  return {
    architect: 'architecture design review dry run',
    engineer: 'implement code dry run',
    qa: 'qa regression verification dry run',
    sre: 'sre monitoring runbook dry run',
  }[specialist] || `${specialist} dry run`;
}

function resolveRuntimeMapping({ delegation, env }) {
  const blockers = [];
  const specialist = delegation.specialist;
  let runtimeAgent = null;
  if (!ALLOWED_SPECIALIST_FAMILIES.includes(specialist)) {
    blockers.push({
      code: 'invalid_delegation_specialist',
      message: 'Delegation specialist must resolve to an allowed specialist family.',
      details: { specialist, allowed: ALLOWED_SPECIALIST_FAMILIES },
    });
  }

  try {
    resolveSpecialistMap(env);
    runtimeAgent = resolveRuntimeAgent(specialist, env);
    if (delegation.runtimeAgent && delegation.runtimeAgent !== runtimeAgent) {
      blockers.push({
        code: 'runtime_agent_mismatch',
        message: 'Configured runtime agent does not match the OpenClaw specialist map.',
        details: { expected: delegation.runtimeAgent, resolved: runtimeAgent },
      });
    }
  } catch (error) {
    blockers.push({
      code: 'missing_runtime_mapping',
      message: error.message,
      details: { specialist },
    });
  }
  return { blockers, runtimeAgent };
}

function routeCollisionBlockers(routeCollisions) {
  return routeCollisions.map(collision => ({
    code: 'route_collision',
    message: 'Delegation route collides with an existing specialist route.',
    details: collision,
  }));
}

function dryRunSampleInput(delegation) {
  return {
    request: sampleRequestForSpecialist(delegation.specialist, delegation.sampleRequest),
    taskType: delegation.sampleTaskType || null,
  };
}

function selectSampleSpecialist(sampleInput) {
  if (sampleInput.taskType) {
    const specialist = resolveTaskSpecialist(sampleInput.taskType);
    if (specialist) return specialist;
  }
  return classifySpecialistRequest(sampleInput.request).specialist;
}

function dryRunMismatchBlocker({ selectedSpecialist, expectedSpecialist, sampleInput }) {
  if (selectedSpecialist === expectedSpecialist) return null;
  return {
    code: 'dry_run_route_mismatch',
    message: 'Sample dry-run input does not route to the expected specialist.',
    details: { expected: expectedSpecialist, selected: selectedSpecialist, sampleInput },
  };
}

function dryRunOpenClawArgs({ runtimeAgent, specialist, sampleInput, agentId, env }) {
  if (!runtimeAgent) return [];
  return buildOpenClawArgs({
    payload: {
      specialist,
      request: sampleInput.request,
      delegationId: `preview-${agentId || 'agent'}`,
    },
    runtimeAgent,
    env,
  });
}

function evaluateDelegationDryRun({ delegation, agentId, env = process.env }) {
  const specialist = delegation.specialist;
  const runtime = resolveRuntimeMapping({ delegation, env });

  const routeCollisions = detectRouteCollisions(delegation);
  const sampleInput = dryRunSampleInput(delegation);
  const selectedSpecialist = selectSampleSpecialist(sampleInput);
  const mismatch = dryRunMismatchBlocker({ selectedSpecialist, expectedSpecialist: specialist, sampleInput });
  const blockers = [
    ...runtime.blockers,
    ...routeCollisionBlockers(routeCollisions),
    ...(mismatch ? [mismatch] : []),
  ];

  return {
    policyVersion: AGENT_ACTIVATION_PREVIEW_POLICY_VERSION,
    pass: blockers.length === 0,
    sampleInput,
    selectedSpecialist,
    runtimeAgent: runtime.runtimeAgent,
    openClawArgs: dryRunOpenClawArgs({ runtimeAgent: runtime.runtimeAgent, specialist, sampleInput, agentId, env }),
    routeCollisions,
    blockers,
  };
}

function duplicateConflictsFor(existing, normalizedAgent, ignoreAgentId) {
  return existing
    .filter(item => item.agentId === normalizedAgent.agentId && item.agentId !== ignoreAgentId)
    .map(item => ({ field: 'agentId', value: item.agentId, displayName: item.displayName, active: item.active }));
}

function delegationImpactFor({ agent, normalizedAgent, env }) {
  const delegation = readDelegationConfig(agent);
  if (!delegation.enabled) return { delegation, delegationImpact: { enabled: false, specialist: null, dryRun: null } };
  return {
    delegation,
    delegationImpact: {
      enabled: true,
      specialist: delegation.specialist,
      dryRun: evaluateDelegationDryRun({ delegation, agentId: normalizedAgent.agentId, env }),
    },
  };
}

function blockerList({ normalizationErrors, duplicateConflicts, roleSupported, normalizedAgent, delegationImpact }) {
  const duplicateBlockers = duplicateConflicts.map(conflict => ({
    code: 'duplicate_agent_id',
    message: 'An AI agent with this agentId already exists.',
    details: conflict,
  }));
  const roleBlockers = roleSupported ? [] : [{
    code: 'unsupported_agent_role',
    message: 'Agent role is not currently supported for live routing.',
    details: { role: normalizedAgent.role },
  }];
  return [...normalizationErrors, ...duplicateBlockers, ...roleBlockers, ...(delegationImpact.dryRun?.blockers || [])];
}

async function buildAiAgentPreview({ tenantId, actorId, agent, listAiAgents, env = process.env, ignoreAgentId = null }) {
  const normalizedPreview = normalizePreviewAgent(agent, actorId);
  const normalizedAgent = agentRecord(normalizedPreview.agent);
  const existing = typeof listAiAgents === 'function'
    ? await listAiAgents({ tenantId, includeInactive: true })
    : [];
  const duplicateConflicts = duplicateConflictsFor(existing, normalizedAgent, ignoreAgentId);
  const roleSupported = isSupportedAgentRole(normalizedAgent.role);
  const { delegation, delegationImpact } = delegationImpactFor({ agent, normalizedAgent, env });
  const blockers = blockerList({ normalizationErrors: normalizedPreview.normalizationErrors, duplicateConflicts, roleSupported, normalizedAgent, delegationImpact });
  const wouldCreateLiveAgent = blockers.length === 0 && normalizedAgent.active && normalizedAgent.assignable;
  const preview = assemblePreview({
    actorId,
    tenantId,
    policyVersion: AGENT_ACTIVATION_PREVIEW_POLICY_VERSION,
    normalizedAgent,
    duplicateConflicts,
    roleSupported,
    delegation,
    delegationImpact,
    wouldCreateLiveAgent,
    blockers,
  });
  return { ...preview, previewToken: previewToken(preview) };
}

function requiresDelegationActivationGate(input = {}) {
  const delegation = readDelegationConfig(input);
  const active = input.active !== false;
  return delegation.enabled && active;
}

function assertPreviewConfirmed({ preview, confirmation }) {
  if (!preview.wouldCreateLiveAgent || preview.blockers.length > 0) {
    const error = new Error('AI agent activation preview did not pass.');
    error.statusCode = 400;
    error.code = 'agent_activation_preview_failed';
    error.details = { blockers: preview.blockers };
    throw error;
  }
  if (!confirmation || confirmation.approved !== true || confirmation.token !== preview.previewToken) {
    const error = new Error('A confirmed activation preview is required before saving this delegation-enabled agent live.');
    error.statusCode = 400;
    error.code = 'preview_confirmation_required';
    error.details = { previewToken: preview.previewToken };
    throw error;
  }
}

module.exports = {
  AGENT_ACTIVATION_PREVIEW_POLICY_VERSION,
  ALLOWED_SPECIALIST_FAMILIES,
  assertPreviewConfirmed,
  buildAiAgentPreview,
  evaluateDelegationDryRun,
  readDelegationConfig,
  requiresDelegationActivationGate,
};
