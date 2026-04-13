const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir } = require('../audit/logger');

function createTaskPlatformError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTaskId() {
  return `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function createFileTaskPlatformService(options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const filePath = path.join(baseDir, 'data', 'task-platform.json');

  function defaultState() {
    return {
      ai_agents: {},
      tasks: {},
      task_mutations: [],
      idempotency: {},
      task_sync_checkpoints: {},
    };
  }

  function loadState() {
    const state = readJson(filePath, defaultState());
    if (!state.ai_agents) state.ai_agents = {};
    if (!state.tasks) state.tasks = {};
    if (!state.task_mutations) state.task_mutations = [];
    if (!state.idempotency) state.idempotency = {};
    if (!state.task_sync_checkpoints) state.task_sync_checkpoints = {};

    return state;
  }

  function saveState(state) {
    writeJson(filePath, state);
  }

  function agentKey(tenantId, agentId) {
    return `${tenantId}::${agentId}`;
  }

  function taskKey(tenantId, taskId) {
    return `${tenantId}::${taskId}`;
  }

  function checkpointKey(tenantId, taskId) {
    return `${tenantId}::${taskId}`;
  }

  function ensureTenantAgents(state, tenantId) {
    for (const agent of options.agentRegistry || []) {
      const key = agentKey(tenantId, agent.id);
      if (!state.ai_agents[key]) {
        state.ai_agents[key] = {
          tenant_id: tenantId,
          agent_id: agent.id,
          display_name: agent.display_name,
          role: agent.role || null,
          execution_kind: 'software-factory',
          active: agent.active !== false,
          assignable: agent.active !== false,
          environment_scope: 'default',
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
    }
  }

  function normalizeOwner(agent) {
    if (!agent) return null;
    return {
      agentId: agent.agent_id,
      displayName: agent.display_name,
      role: agent.role || null,
      active: Boolean(agent.active),
      assignable: Boolean(agent.assignable),
    };
  }

  function normalizeTask(task, state) {
    return {
      taskId: task.task_id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      version: task.version,
      owner: task.owner_agent_id ? normalizeOwner(state.ai_agents[agentKey(task.tenant_id, task.owner_agent_id)] || null) : null,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      closedAt: task.closed_at || null,
    };
  }

  function requireAgent(state, tenantId, ownerAgentId) {
    if (ownerAgentId == null) return null;
    const agent = state.ai_agents[agentKey(tenantId, ownerAgentId)] || null;
    if (!agent) throw createTaskPlatformError(404, 'agent_not_found', 'AI agent not found', { ownerAgentId });
    if (!agent.active || !agent.assignable) {
      throw createTaskPlatformError(400, 'invalid_owner_agent', 'AI agent is not assignable', { ownerAgentId });
    }
    return agent;
  }

  function ensureSyncAgent(state, tenantId, ownerAgentId) {
    if (ownerAgentId == null) return null;
    const key = agentKey(tenantId, ownerAgentId);
    if (!state.ai_agents[key]) {
      state.ai_agents[key] = {
        tenant_id: tenantId,
        agent_id: ownerAgentId,
        display_name: ownerAgentId,
        role: 'imported',
        execution_kind: 'legacy-import',
        active: true,
        assignable: false,
        environment_scope: 'imported',
        metadata: { imported: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    return state.ai_agents[key];
  }

  function appendMutation(state, mutation) {
    state.task_mutations.push({
      mutation_id: state.task_mutations.length + 1,
      created_at: new Date().toISOString(),
      ...mutation,
    });
  }

  function upsertSyncCheckpoint(state, tenantId, taskId, updates = {}) {
    const key = checkpointKey(tenantId, taskId);
    const existing = state.task_sync_checkpoints[key] || {
      tenant_id: tenantId,
      task_id: taskId,
      canonical_version: 0,
      last_projected_audit_event_id: null,
      last_projected_sequence_number: null,
      sync_status: 'pending',
      last_synced_at: null,
      last_error: null,
    };
    state.task_sync_checkpoints[key] = {
      ...existing,
      ...updates,
    };
    return state.task_sync_checkpoints[key];
  }

  function recordIdempotency(state, tenantId, idempotencyKey, result) {
    if (!idempotencyKey) return;
    state.idempotency[`${tenantId}::${idempotencyKey}`] = result;
  }

  function readIdempotency(state, tenantId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return state.idempotency[`${tenantId}::${idempotencyKey}`] || null;
  }

  return {
    kind: 'file',
    listAiAgents({ tenantId, includeInactive = false }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      const agents = Object.values(state.ai_agents)
        .filter((agent) => agent.tenant_id === tenantId)
        .filter((agent) => includeInactive || agent.active);
      saveState(state);
      return agents.map((agent) => ({
        agentId: agent.agent_id,
        displayName: agent.display_name,
        role: agent.role || null,
        executionKind: agent.execution_kind,
        active: Boolean(agent.active),
        assignable: Boolean(agent.assignable),
        environmentScope: agent.environment_scope,
      }));
    },
    listTasks({ tenantId, ownerAgentId, status }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      saveState(state);
      return Object.values(state.tasks)
        .filter((task) => task.tenant_id === tenantId)
        .filter((task) => (ownerAgentId === undefined ? true : task.owner_agent_id === ownerAgentId))
        .filter((task) => (status === undefined ? true : task.status === status))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((task) => normalizeTask(task, state));
    },
    getTask({ tenantId, taskId }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      saveState(state);
      const task = state.tasks[taskKey(tenantId, taskId)] || null;
      return task ? normalizeTask(task, state) : null;
    },
    createTask({ tenantId, actorId, taskId = null, title, description = '', status, priority = null, ownerAgentId = null, idempotencyKey = null, requestId = null }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      const existing = readIdempotency(state, tenantId, idempotencyKey);
      if (existing) return existing;

      requireAgent(state, tenantId, ownerAgentId);
      const now = new Date().toISOString();
      const nextTaskId = taskId || makeTaskId();
      const task = {
        tenant_id: tenantId,
        task_id: nextTaskId,
        title: String(title || '').trim(),
        description: String(description || ''),
        status: String(status || '').trim(),
        priority,
        owner_agent_id: ownerAgentId,
        source_system: 'canonical',
        source_of_truth_version: 1,
        version: 1,
        created_at: now,
        updated_at: now,
        closed_at: null,
        last_audit_event_id: null,
        last_audit_sequence_number: null,
        migration_state: 'active',
        metadata: {},
      };
      state.tasks[taskKey(tenantId, nextTaskId)] = task;
      appendMutation(state, {
        tenant_id: tenantId,
        task_id: nextTaskId,
        task_version: 1,
        mutation_type: 'task_created',
        actor_id: actorId,
        actor_type: 'user',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        payload: {
          title: task.title,
          status: task.status,
          priority: task.priority,
          owner_agent_id: ownerAgentId,
        },
      });
      const result = normalizeTask(task, state);
      upsertSyncCheckpoint(state, tenantId, nextTaskId, {
        canonical_version: task.version,
        sync_status: 'active',
        last_synced_at: now,
        last_error: null,
      });
      recordIdempotency(state, tenantId, idempotencyKey, result);
      saveState(state);
      return result;
    },
    updateTask({ tenantId, taskId, actorId, version, idempotencyKey = null, requestId = null, title, description, status, priority }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      const existing = readIdempotency(state, tenantId, idempotencyKey);
      if (existing) return existing;
      const task = state.tasks[taskKey(tenantId, taskId)] || null;
      if (!task) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
      if (Number(version) !== Number(task.version)) {
        throw createTaskPlatformError(409, 'version_conflict', `Task version ${version} is stale; current version is ${task.version}`, { taskId, expectedVersion: task.version });
      }
      if (title !== undefined) task.title = String(title).trim();
      if (description !== undefined) task.description = String(description);
      if (status !== undefined) task.status = String(status).trim();
      if (priority !== undefined) task.priority = priority;
      task.version += 1;
      task.source_of_truth_version = Number(task.source_of_truth_version || task.version);
      task.updated_at = new Date().toISOString();
      appendMutation(state, {
        tenant_id: tenantId,
        task_id: taskId,
        task_version: task.version,
        mutation_type: 'task_updated',
        actor_id: actorId,
        actor_type: 'user',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        payload: { title, description, status, priority },
      });
      const result = normalizeTask(task, state);
      upsertSyncCheckpoint(state, tenantId, taskId, {
        canonical_version: task.version,
        sync_status: 'active',
        last_synced_at: task.updated_at,
        last_error: null,
      });
      recordIdempotency(state, tenantId, idempotencyKey, result);
      saveState(state);
      return result;
    },
    updateTaskOwner({ tenantId, taskId, actorId, version, ownerAgentId, idempotencyKey = null, requestId = null }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      const existing = readIdempotency(state, tenantId, idempotencyKey);
      if (existing) return existing;
      const task = state.tasks[taskKey(tenantId, taskId)] || null;
      if (!task) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
      if (Number(version) !== Number(task.version)) {
        throw createTaskPlatformError(409, 'version_conflict', `Task version ${version} is stale; current version is ${task.version}`, { taskId, expectedVersion: task.version });
      }
      requireAgent(state, tenantId, ownerAgentId);
      task.owner_agent_id = ownerAgentId ?? null;
      task.version += 1;
      task.updated_at = new Date().toISOString();
      appendMutation(state, {
        tenant_id: tenantId,
        task_id: taskId,
        task_version: task.version,
        mutation_type: 'task_owner_updated',
        actor_id: actorId,
        actor_type: 'user',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        payload: { owner_agent_id: ownerAgentId ?? null },
      });
      const result = normalizeTask(task, state);
      upsertSyncCheckpoint(state, tenantId, taskId, {
        canonical_version: task.version,
        sync_status: 'active',
        last_synced_at: task.updated_at,
        last_error: null,
      });
      recordIdempotency(state, tenantId, idempotencyKey, result);
      saveState(state);
      return result;
    },
    syncTaskFromProjection({
      tenantId,
      taskId,
      title,
      description = '',
      status,
      priority = null,
      ownerAgentId = null,
      sourceSystem = 'audit_projection_sync',
      lastAuditEventId = null,
      lastAuditSequenceNumber = null,
      migrationState = 'backfilled',
      metadata = {},
    }) {
      const state = loadState();
      ensureTenantAgents(state, tenantId);
      ensureSyncAgent(state, tenantId, ownerAgentId);
      const key = taskKey(tenantId, taskId);
      const existing = state.tasks[key] || null;
      const now = new Date().toISOString();
      const task = existing || {
        tenant_id: tenantId,
        task_id: taskId,
        title: title || taskId,
        description,
        status: status || 'BACKLOG',
        priority,
        owner_agent_id: ownerAgentId,
        version: 1,
        source_of_truth_version: 1,
        created_at: now,
        updated_at: now,
        closed_at: null,
        source_system: sourceSystem,
        last_audit_event_id: lastAuditEventId,
        last_audit_sequence_number: lastAuditSequenceNumber,
        migration_state: migrationState,
        metadata: { ...metadata },
      };
      const changed = !existing
        || task.title !== (title ?? task.title)
        || task.description !== (description ?? task.description)
        || task.status !== (status ?? task.status)
        || task.priority !== (priority ?? task.priority)
        || task.owner_agent_id !== (ownerAgentId ?? null)
        || task.last_audit_event_id !== lastAuditEventId
        || task.last_audit_sequence_number !== lastAuditSequenceNumber
        || task.migration_state !== migrationState;
      task.title = title ?? task.title;
      task.description = description ?? task.description;
      task.status = status ?? task.status;
      task.priority = priority ?? task.priority;
      task.owner_agent_id = ownerAgentId ?? null;
      if (changed && existing) task.version += 1;
      task.updated_at = now;
      task.source_system = sourceSystem;
      task.last_audit_event_id = lastAuditEventId;
      task.last_audit_sequence_number = lastAuditSequenceNumber;
      task.migration_state = migrationState;
      task.metadata = { ...(task.metadata || {}), ...metadata };
      if (!existing) task.created_at = now;
      state.tasks[key] = task;
      upsertSyncCheckpoint(state, tenantId, taskId, {
        canonical_version: task.version,
        last_projected_audit_event_id: lastAuditEventId,
        last_projected_sequence_number: lastAuditSequenceNumber,
        sync_status: 'synced',
        last_synced_at: now,
        last_error: null,
      });
      saveState(state);
      return normalizeTask(task, state);
    },
  };
}

module.exports = {
  createFileTaskPlatformService,
  createTaskPlatformError,
};
