const DEFAULT_PILOT_AGENT_ROLES = Object.freeze(['pm', 'architect', 'engineer', 'qa', 'sre']);

const DEFAULT_PILOT_AGENTS = Object.freeze([
  {
    agentId: 'pm',
    displayName: 'Pilot Product Manager',
    role: 'pm',
    description: 'Pilot PM agent for intake, refinement, approval, and closeout ownership.',
  },
  {
    agentId: 'architect',
    displayName: 'Pilot Architect',
    role: 'architect',
    description: 'Pilot architecture agent for design review and technical handoff ownership.',
  },
  {
    agentId: 'engineer',
    displayName: 'Pilot Engineer',
    role: 'engineer',
    description: 'Pilot implementation agent for app-dispatched OpenClaw specialist work.',
  },
  {
    agentId: 'engineer-jr',
    displayName: 'Pilot Jr Engineer',
    role: 'engineer',
    description: 'Pilot Jr implementation agent for tier-dispatched OpenClaw specialist work.',
  },
  {
    agentId: 'engineer-sr',
    displayName: 'Pilot Sr Engineer',
    role: 'engineer',
    description: 'Pilot Sr implementation agent for tier-dispatched OpenClaw specialist work.',
  },
  {
    agentId: 'engineer-principal',
    displayName: 'Pilot Principal Engineer',
    role: 'engineer',
    description: 'Pilot Principal implementation agent for high-risk tier-dispatched work.',
  },
  {
    agentId: 'qa',
    displayName: 'Pilot QA',
    role: 'qa',
    description: 'Pilot QA agent for verification and regression evidence ownership.',
  },
  {
    agentId: 'sre',
    displayName: 'Pilot SRE',
    role: 'sre',
    description: 'Pilot SRE agent for monitoring and operational closeout ownership.',
  },
]);

function normalizePilotAgent(agent = {}) {
  return {
    agentId: String(agent.agentId || agent.agent_id || agent.id || '').trim().toLowerCase(),
    displayName: String(agent.displayName || agent.display_name || agent.agentId || agent.id || '').trim(),
    role: String(agent.role || '').trim().toLowerCase(),
    description: agent.description == null ? null : String(agent.description).trim() || null,
    executionKind: String(agent.executionKind || agent.execution_kind || 'software-factory').trim() || 'software-factory',
    active: true,
    assignable: true,
    environmentScope: String(agent.environmentScope || agent.environment_scope || 'pilot').trim() || 'pilot',
    metadata: {
      ...(agent.metadata && typeof agent.metadata === 'object' && !Array.isArray(agent.metadata) ? agent.metadata : {}),
      seededFor: 'supervised-autonomous-pilot',
      requiredBy: 'issue-247',
    },
  };
}

function needsPilotAgentUpdate(existing, desired) {
  if (!existing) return false;
  return existing.displayName !== desired.displayName
    || existing.role !== desired.role
    || (existing.description || null) !== desired.description
    || existing.executionKind !== desired.executionKind
    || existing.environmentScope !== desired.environmentScope
    || existing.active !== true
    || existing.assignable !== true
    || existing.metadata?.seededFor !== desired.metadata.seededFor
    || existing.metadata?.requiredBy !== desired.metadata.requiredBy;
}

async function maybeAwait(value) {
  return value && typeof value.then === 'function' ? value : Promise.resolve(value);
}

function assertPilotAgentService(taskPlatform) {
  if (!taskPlatform || typeof taskPlatform.listAiAgents !== 'function' || typeof taskPlatform.createAiAgent !== 'function') {
    throw new Error('taskPlatform with listAiAgents and createAiAgent is required');
  }
}

async function existingPilotAgentsById(taskPlatform, tenantId) {
  const existingAgents = await maybeAwait(taskPlatform.listAiAgents({ tenantId, includeInactive: true }));
  return new Map(existingAgents.map(agent => [agent.agentId, agent]));
}

async function createPilotAgent({ taskPlatform, tenantId, actorId, desired }) {
  const agent = await maybeAwait(taskPlatform.createAiAgent({
    tenantId,
    actorId,
    agent: desired,
    idempotencyKey: `pilot-agent-seed:${tenantId}:${desired.agentId}`,
    source: 'pilot-agent-seed',
  }));
  return { action: 'created', agent };
}

async function updatePilotAgent({ taskPlatform, tenantId, actorId, desired, existing }) {
  if (typeof taskPlatform.updateAiAgent !== 'function') {
    throw new Error(`Existing pilot agent ${desired.agentId} needs update, but updateAiAgent is unavailable`);
  }
  const agent = await maybeAwait(taskPlatform.updateAiAgent({
    tenantId,
    actorId,
    agentId: desired.agentId,
    patch: { ...desired, version: existing.version },
    idempotencyKey: `pilot-agent-seed:${tenantId}:${desired.agentId}:v${existing.version}`,
    source: 'pilot-agent-seed',
  }));
  return { action: 'updated', agent };
}

async function ensurePilotAgent(input) {
  const existing = input.existingById.get(input.desired.agentId) || null;
  if (!existing) return createPilotAgent(input);
  if (needsPilotAgentUpdate(existing, input.desired)) {
    return updatePilotAgent({ ...input, existing });
  }
  return { action: 'unchanged', agent: existing };
}

function summarizePilotAgentResults({ tenantId, actorId, results }) {
  const activeAssignableRoles = new Set(
    results
      .map(result => result.agent)
      .filter(agent => agent.active && agent.assignable)
      .map(agent => agent.role),
  );
  const missingRoles = DEFAULT_PILOT_AGENT_ROLES.filter(role => !activeAssignableRoles.has(role));

  return {
    tenantId,
    actorId,
    requiredRoles: [...DEFAULT_PILOT_AGENT_ROLES],
    created: results.filter(result => result.action === 'created').map(result => result.agent.agentId),
    updated: results.filter(result => result.action === 'updated').map(result => result.agent.agentId),
    unchanged: results.filter(result => result.action === 'unchanged').map(result => result.agent.agentId),
    missingRoles,
    ok: missingRoles.length === 0,
    agents: results.map(result => ({ action: result.action, ...result.agent })),
  };
}

async function ensurePilotAgents({ taskPlatform, tenantId = 'engineering-team', actorId = 'system:pilot-agent-seed', agents = DEFAULT_PILOT_AGENTS } = {}) {
  assertPilotAgentService(taskPlatform);
  const existingById = await existingPilotAgentsById(taskPlatform, tenantId);
  const results = [];
  for (const desired of agents.map(normalizePilotAgent)) {
    results.push(await ensurePilotAgent({ taskPlatform, tenantId, actorId, desired, existingById }));
  }
  return summarizePilotAgentResults({ tenantId, actorId, results });
}

module.exports = {
  DEFAULT_PILOT_AGENT_ROLES,
  DEFAULT_PILOT_AGENTS,
  ensurePilotAgents,
  normalizePilotAgent,
};
