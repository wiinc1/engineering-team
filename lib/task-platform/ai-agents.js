const SUPPORTED_AI_AGENT_ROLES = Object.freeze(['pm', 'architect', 'engineer', 'qa', 'sre', 'human']);
const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const ROLE_REQUEST_ID_PATTERN = /^ARR-[A-F0-9]{8}$/;

const ROLE_ALIASES = Object.freeze({
  architecture: 'architect',
  architect: 'architect',
  engineering: 'engineer',
  engineer: 'engineer',
  human: 'human',
  pm: 'pm',
  product: 'pm',
  'product-manager': 'pm',
  'product_manager': 'pm',
  qa: 'qa',
  quality: 'qa',
  sre: 'sre',
});

function cloneJson(value, fallback = {}) {
  if (value === undefined) return fallback;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function createAgentPlatformError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeAgentRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[normalized] || normalized || null;
}

function assertSupportedAgentRole(role) {
  const normalized = normalizeAgentRole(role);
  if (!SUPPORTED_AI_AGENT_ROLES.includes(normalized)) {
    throw createAgentPlatformError(400, 'unsupported_agent_role', 'AI agent role is not supported', {
      role,
      supportedRoles: SUPPORTED_AI_AGENT_ROLES,
    });
  }
  return normalized;
}

function isSupportedAgentRole(role) {
  return SUPPORTED_AI_AGENT_ROLES.includes(normalizeAgentRole(role));
}

function normalizeOptionalBoolean(value, field, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw createAgentPlatformError(400, `invalid_${field}`, `${field} must be a boolean`, { field });
  }
  return value;
}

function normalizeMetadata(metadata) {
  const normalized = cloneJson(metadata, {});
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw createAgentPlatformError(400, 'invalid_metadata', 'metadata must be an object', { field: 'metadata' });
  }
  return normalized;
}

function makeAgentRoleRequestId(randomBytes = require('crypto').randomBytes) {
  return `ARR-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function normalizeAgentId(agentId) {
  const normalized = String(agentId || '').trim().toLowerCase();
  if (!AGENT_ID_PATTERN.test(normalized)) {
    throw createAgentPlatformError(400, 'invalid_agent_slug', 'agentId must be a lowercase slug starting with a letter', {
      field: 'agentId',
      pattern: AGENT_ID_PATTERN.source,
    });
  }
  return normalized;
}

function normalizeDisplayName(displayName) {
  const normalized = String(displayName || '').trim();
  if (!normalized) {
    throw createAgentPlatformError(400, 'missing_display_name', 'displayName is required', { field: 'displayName' });
  }
  return normalized;
}

function normalizeRequestedRole(role) {
  const normalized = normalizeAgentRole(role);
  if (!normalized) {
    throw createAgentPlatformError(400, 'missing_requested_role', 'requestedRole is required', { field: 'requestedRole' });
  }
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(normalized)) {
    throw createAgentPlatformError(400, 'invalid_requested_role', 'requestedRole must be a lowercase role slug', {
      field: 'requestedRole',
    });
  }
  return normalized;
}

function normalizeOptionalDescription(description) {
  if (description === undefined || description === null) return null;
  return String(description).trim() || null;
}

function normalizeAgentVersion(version) {
  const normalized = typeof version === 'number' ? version : Number(version);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw createAgentPlatformError(400, 'invalid_version', 'version must be a positive integer', { field: 'version' });
  }
  return normalized;
}

function normalizeCreateAiAgentInput(input = {}, actorId = 'system') {
  const active = normalizeOptionalBoolean(input.active, 'active', true);
  const assignable = active ? normalizeOptionalBoolean(input.assignable, 'assignable', true) : false;
  return {
    agent_id: normalizeAgentId(input.agentId ?? input.agent_id ?? input.id),
    display_name: normalizeDisplayName(input.displayName ?? input.display_name),
    role: assertSupportedAgentRole(input.role),
    description: normalizeOptionalDescription(input.description),
    execution_kind: String(input.executionKind ?? input.execution_kind ?? 'software-factory').trim() || 'software-factory',
    active,
    assignable,
    environment_scope: String(input.environmentScope ?? input.environment_scope ?? 'default').trim() || 'default',
    metadata: normalizeMetadata(input.metadata),
    version: 1,
    created_by_actor_id: String(input.createdByActorId ?? input.created_by_actor_id ?? actorId ?? 'system'),
    updated_by_actor_id: String(input.updatedByActorId ?? input.updated_by_actor_id ?? actorId ?? 'system'),
  };
}

function normalizeUpdateAiAgentInput(input = {}, current = {}) {
  const version = normalizeAgentVersion(input.version);
  if (Number(current.version || 1) !== version) {
    throw createAgentPlatformError(409, 'agent_version_conflict', `AI agent version ${version} is stale; current version is ${current.version || 1}`, {
      agentId: current.agent_id,
      expectedVersion: current.version || 1,
    });
  }

  const update = { version };
  if (Object.prototype.hasOwnProperty.call(input, 'displayName') || Object.prototype.hasOwnProperty.call(input, 'display_name')) {
    update.display_name = normalizeDisplayName(input.displayName ?? input.display_name);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'role')) {
    update.role = assertSupportedAgentRole(input.role);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    update.description = normalizeOptionalDescription(input.description);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'metadata')) {
    update.metadata = normalizeMetadata(input.metadata);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'assignable')) {
    update.assignable = normalizeOptionalBoolean(input.assignable, 'assignable', undefined) === true;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'active')) {
    update.active = normalizeOptionalBoolean(input.active, 'active', undefined) === true;
    if (!update.active) update.assignable = false;
  }
  if (current.active === false && update.active !== true) update.assignable = false;
  return update;
}

function normalizeAiAgentRecord(record = {}) {
  return {
    agentId: record.agent_id,
    displayName: record.display_name,
    role: normalizeAgentRole(record.role),
    description: record.description || null,
    executionKind: record.execution_kind,
    active: record.active !== false,
    assignable: record.assignable !== false,
    environmentScope: record.environment_scope || 'default',
    metadata: cloneJson(record.metadata, {}),
    version: Number(record.version || 1),
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
    createdByActorId: record.created_by_actor_id || null,
    updatedByActorId: record.updated_by_actor_id || null,
  };
}

function normalizeAgentRoleRequestInput(input = {}, actorId = 'system', options = {}) {
  const requestedRole = normalizeRequestedRole(input.requestedRole ?? input.requested_role ?? input.role);
  const requestId = String(input.requestId ?? input.request_id ?? options.requestId ?? makeAgentRoleRequestId()).trim().toUpperCase();
  if (!ROLE_REQUEST_ID_PATTERN.test(requestId)) {
    throw createAgentPlatformError(400, 'invalid_role_request_id', 'requestId must match ARR-XXXXXXXX', {
      field: 'requestId',
    });
  }
  return {
    request_id: requestId,
    requested_role: requestedRole,
    display_name: normalizeDisplayName(input.displayName ?? input.display_name ?? requestedRole),
    justification: String(input.justification ?? input.reason ?? '').trim() || null,
    status: 'requested',
    live_routing_enabled: false,
    metadata: normalizeMetadata(input.metadata),
    requested_by_actor_id: String(input.requestedByActorId ?? input.requested_by_actor_id ?? actorId ?? 'system'),
  };
}

function normalizeAgentRoleRequestRecord(record = {}) {
  return {
    requestId: record.request_id,
    requestedRole: normalizeAgentRole(record.requested_role),
    displayName: record.display_name,
    justification: record.justification || null,
    status: record.status || 'requested',
    liveRoutingEnabled: record.live_routing_enabled === true,
    metadata: cloneJson(record.metadata, {}),
    requestedByActorId: record.requested_by_actor_id || null,
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  };
}

function agentMutationAction(before, after) {
  if (!before) return 'agent_created';
  if (before.active !== false && after.active === false) return 'agent_deactivated';
  return 'agent_updated';
}

module.exports = {
  SUPPORTED_AI_AGENT_ROLES,
  agentMutationAction,
  assertSupportedAgentRole,
  createAgentPlatformError,
  isSupportedAgentRole,
  normalizeAiAgentRecord,
  normalizeAgentRoleRequestInput,
  normalizeAgentRoleRequestRecord,
  normalizeAgentRole,
  normalizeCreateAiAgentInput,
  normalizeUpdateAiAgentInput,
};
