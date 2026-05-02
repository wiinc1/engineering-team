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

const MERGE_READINESS_REVIEW_STATUSES = Object.freeze(['pending', 'passed', 'blocked', 'stale', 'error']);
const MERGE_READINESS_POLICY_VERSION = 'merge-readiness-review-storage.v1';
const MERGE_READINESS_JSON_FIELDS = Object.freeze([
  ['sourceInventory', 'source_inventory', {}],
  ['requiredCheckInventory', 'required_check_inventory', []],
  ['reviewedLogSources', 'reviewed_log_sources', []],
  ['findings', 'findings', []],
  ['classification', 'classification', null],
  ['owner', 'owner', null],
  ['rationale', 'rationale', null],
  ['followUpLinks', 'follow_up_links', []],
  ['approvals', 'approvals', []],
  ['metadata', 'metadata', {}],
]);

const FULL_LOG_FIELD_NAMES = Object.freeze(new Set([
  'body',
  'content',
  'fulllog',
  'fulllogcontent',
  'lines',
  'log',
  'logcontent',
  'loglines',
  'logtext',
  'raw',
  'rawlog',
  'rawlogcontent',
  'text',
  'transcript',
]));

function makeMergeReadinessReviewId() {
  return `MRR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function readField(input, camelName, snakeName = camelName) {
  if (Object.prototype.hasOwnProperty.call(input, camelName)) return input[camelName];
  if (Object.prototype.hasOwnProperty.call(input, snakeName)) return input[snakeName];
  return undefined;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function jsonWithDefault(input, camelName, snakeName, fallback) {
  const value = readField(input, camelName, snakeName);
  if (value === undefined) return cloneJson(fallback);
  return cloneJson(value);
}

function normalizeNonEmptyString(value, fieldName) {
  if (value === undefined || value === null) {
    throw createTaskPlatformError(400, `missing_${fieldName}`, `${fieldName} is required`, { field: fieldName });
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw createTaskPlatformError(400, `invalid_${fieldName}`, `${fieldName} must be a non-empty string`, { field: fieldName });
  }
  return normalized;
}

function normalizeOptionalString(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) {
    throw createTaskPlatformError(400, `invalid_${fieldName}`, `${fieldName} must be a non-empty string when provided`, { field: fieldName });
  }
  return normalized;
}

function normalizePositiveInteger(value, fieldName) {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw createTaskPlatformError(400, `invalid_${fieldName}`, `${fieldName} must be a positive integer`, { field: fieldName });
  }
  return normalized;
}

function normalizeOptionalPositiveInteger(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizePositiveInteger(value, fieldName);
}

function normalizeMergeReadinessStatus(value) {
  const status = normalizeNonEmptyString(value, 'review_status');
  if (!MERGE_READINESS_REVIEW_STATUSES.includes(status)) {
    throw createTaskPlatformError(400, 'invalid_merge_readiness_status', 'Merge readiness review status is invalid', {
      status,
      allowedStatuses: MERGE_READINESS_REVIEW_STATUSES,
    });
  }
  return status;
}

function normalizeCommitSha(value) {
  const commitSha = normalizeNonEmptyString(value, 'commit_sha');
  if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) {
    throw createTaskPlatformError(400, 'invalid_commit_sha', 'commit_sha must be a 7 to 40 character Git SHA', { commitSha });
  }
  return commitSha;
}

function normalizedLogFieldName(key) {
  return String(key || '').replace(/[-_]/g, '').toLowerCase();
}

function assertNoFullLogContent(value, fieldName) {
  const visit = (node, pathName) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${pathName}[${index}]`));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (FULL_LOG_FIELD_NAMES.has(normalizedLogFieldName(key))) {
        throw createTaskPlatformError(400, 'full_log_content_not_allowed', 'Reviewed source logs must be linked, not copied into merge readiness reviews', {
          field: fieldName,
          path: `${pathName}.${key}`,
        });
      }
      visit(child, `${pathName}.${key}`);
    }
  };
  visit(value, fieldName);
}

function normalizeCreateMergeReadinessReviewInput(input = {}) {
  const review = {
    tenant_id: normalizeNonEmptyString(readField(input, 'tenantId', 'tenant_id'), 'tenant_id'),
    review_id: normalizeOptionalString(readField(input, 'reviewId', 'review_id'), 'review_id') || makeMergeReadinessReviewId(),
    task_id: normalizeNonEmptyString(readField(input, 'taskId', 'task_id'), 'task_id'),
    repository: normalizeNonEmptyString(readField(input, 'repository'), 'repository'),
    pull_request_number: normalizePositiveInteger(readField(input, 'pullRequestNumber', 'pull_request_number'), 'pull_request_number'),
    commit_sha: normalizeCommitSha(readField(input, 'commitSha', 'commit_sha')),
    review_status: normalizeMergeReadinessStatus(readField(input, 'reviewStatus', 'review_status')),
    is_current: readField(input, 'isCurrent', 'is_current') === false ? false : true,
    policy_version: normalizeOptionalString(readField(input, 'policyVersion', 'policy_version'), 'policy_version') || MERGE_READINESS_POLICY_VERSION,
    record_version: 1,
    github_check_run_id: normalizeOptionalPositiveInteger(readField(input, 'githubCheckRunId', 'github_check_run_id'), 'github_check_run_id') ?? null,
    reviewer_actor_id: normalizeOptionalString(readField(input, 'reviewerActorId', 'reviewer_actor_id') ?? readField(input, 'actorId', 'actor_id'), 'reviewer_actor_id') || 'system',
    reviewer_actor_type: normalizeOptionalString(readField(input, 'reviewerActorType', 'reviewer_actor_type') ?? readField(input, 'actorType', 'actor_type'), 'reviewer_actor_type') || 'system',
  };

  for (const [camelName, snakeName, fallback] of MERGE_READINESS_JSON_FIELDS) {
    review[snakeName] = jsonWithDefault(input, camelName, snakeName, fallback);
  }
  assertNoFullLogContent(review.source_inventory, 'sourceInventory');
  assertNoFullLogContent(review.reviewed_log_sources, 'reviewedLogSources');
  return review;
}

function normalizeUpdateMergeReadinessReviewInput(input = {}) {
  const update = {
    tenant_id: normalizeNonEmptyString(readField(input, 'tenantId', 'tenant_id'), 'tenant_id'),
    task_id: normalizeNonEmptyString(readField(input, 'taskId', 'task_id'), 'task_id'),
    review_id: normalizeNonEmptyString(readField(input, 'reviewId', 'review_id'), 'review_id'),
    record_version: normalizePositiveInteger(readField(input, 'recordVersion', 'record_version'), 'record_version'),
  };

  const status = readField(input, 'reviewStatus', 'review_status');
  if (status !== undefined) update.review_status = normalizeMergeReadinessStatus(status);
  const policyVersion = readField(input, 'policyVersion', 'policy_version');
  if (policyVersion !== undefined) update.policy_version = normalizeOptionalString(policyVersion, 'policy_version');
  const githubCheckRunId = readField(input, 'githubCheckRunId', 'github_check_run_id');
  if (githubCheckRunId !== undefined) update.github_check_run_id = normalizeOptionalPositiveInteger(githubCheckRunId, 'github_check_run_id');
  const reviewerActorId = readField(input, 'reviewerActorId', 'reviewer_actor_id') ?? readField(input, 'actorId', 'actor_id');
  if (reviewerActorId !== undefined) update.reviewer_actor_id = normalizeOptionalString(reviewerActorId, 'reviewer_actor_id');
  const reviewerActorType = readField(input, 'reviewerActorType', 'reviewer_actor_type') ?? readField(input, 'actorType', 'actor_type');
  if (reviewerActorType !== undefined) update.reviewer_actor_type = normalizeOptionalString(reviewerActorType, 'reviewer_actor_type');

  for (const [camelName, snakeName] of MERGE_READINESS_JSON_FIELDS) {
    const value = readField(input, camelName, snakeName);
    if (value !== undefined) update[snakeName] = cloneJson(value);
  }
  if (update.source_inventory !== undefined) assertNoFullLogContent(update.source_inventory, 'sourceInventory');
  if (update.reviewed_log_sources !== undefined) assertNoFullLogContent(update.reviewed_log_sources, 'reviewedLogSources');
  return update;
}

function toIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  return value || null;
}

function normalizeMergeReadinessReviewRecord(record = {}) {
  const normalized = {
    tenantId: readField(record, 'tenantId', 'tenant_id'),
    reviewId: readField(record, 'reviewId', 'review_id'),
    taskId: readField(record, 'taskId', 'task_id'),
    repository: readField(record, 'repository'),
    pullRequestNumber: Number(readField(record, 'pullRequestNumber', 'pull_request_number')),
    commitSha: readField(record, 'commitSha', 'commit_sha'),
    reviewStatus: readField(record, 'reviewStatus', 'review_status'),
    isCurrent: Boolean(readField(record, 'isCurrent', 'is_current')),
    policyVersion: readField(record, 'policyVersion', 'policy_version'),
    recordVersion: Number(readField(record, 'recordVersion', 'record_version')),
    githubCheckRunId: readField(record, 'githubCheckRunId', 'github_check_run_id') == null ? null : Number(readField(record, 'githubCheckRunId', 'github_check_run_id')),
    reviewerActorId: readField(record, 'reviewerActorId', 'reviewer_actor_id'),
    reviewerActorType: readField(record, 'reviewerActorType', 'reviewer_actor_type'),
    createdAt: toIsoTimestamp(readField(record, 'createdAt', 'created_at')),
    updatedAt: toIsoTimestamp(readField(record, 'updatedAt', 'updated_at')),
  };
  for (const [camelName, snakeName, fallback] of MERGE_READINESS_JSON_FIELDS) {
    normalized[camelName] = jsonWithDefault(record, camelName, snakeName, fallback);
  }
  return normalized;
}

function sameMergeReadinessIdentity(review, identity) {
  return review.tenant_id === identity.tenant_id
    && review.task_id === identity.task_id
    && review.repository === identity.repository
    && Number(review.pull_request_number) === Number(identity.pull_request_number)
    && review.commit_sha === identity.commit_sha;
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
      merge_readiness_reviews: {},
    };
  }

  function loadState() {
    const state = readJson(filePath, defaultState());
    if (!state.ai_agents) state.ai_agents = {};
    if (!state.tasks) state.tasks = {};
    if (!state.task_mutations) state.task_mutations = [];
    if (!state.idempotency) state.idempotency = {};
    if (!state.task_sync_checkpoints) state.task_sync_checkpoints = {};
    if (!state.merge_readiness_reviews) state.merge_readiness_reviews = {};

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

  function reviewKey(tenantId, reviewId) {
    return `${tenantId}::${reviewId}`;
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
    createMergeReadinessReview(input = {}) {
      const state = loadState();
      const review = normalizeCreateMergeReadinessReviewInput(input);
      if (!state.tasks[taskKey(review.tenant_id, review.task_id)]) {
        throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId: review.task_id });
      }
      const key = reviewKey(review.tenant_id, review.review_id);
      if (state.merge_readiness_reviews[key]) {
        throw createTaskPlatformError(409, 'merge_readiness_review_exists', 'Merge readiness review already exists', { reviewId: review.review_id });
      }
      const now = new Date().toISOString();
      const record = {
        ...review,
        created_at: now,
        updated_at: now,
      };
      if (record.is_current) {
        for (const existing of Object.values(state.merge_readiness_reviews)) {
          if (existing.is_current && sameMergeReadinessIdentity(existing, record)) {
            existing.is_current = false;
            existing.record_version = Number(existing.record_version || 1) + 1;
            existing.updated_at = now;
          }
        }
      }
      state.merge_readiness_reviews[key] = record;
      saveState(state);
      return normalizeMergeReadinessReviewRecord(record);
    },
    listMergeReadinessReviews({ tenantId, taskId, repository, pullRequestNumber, commitSha, currentOnly = true }) {
      const state = loadState();
      if (!state.tasks[taskKey(tenantId, taskId)]) {
        throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
      }
      const normalizedPullRequestNumber = pullRequestNumber == null ? undefined : normalizePositiveInteger(pullRequestNumber, 'pull_request_number');
      const normalizedCommitSha = commitSha == null ? undefined : normalizeCommitSha(commitSha);
      return Object.values(state.merge_readiness_reviews)
        .filter((review) => review.tenant_id === tenantId && review.task_id === taskId)
        .filter((review) => (repository == null ? true : review.repository === repository))
        .filter((review) => (normalizedPullRequestNumber == null ? true : Number(review.pull_request_number) === normalizedPullRequestNumber))
        .filter((review) => (normalizedCommitSha == null ? true : review.commit_sha === normalizedCommitSha))
        .filter((review) => (currentOnly === false ? true : review.is_current))
        .sort((a, b) => {
          if (Boolean(a.is_current) !== Boolean(b.is_current)) return a.is_current ? -1 : 1;
          const repositoryOrder = a.repository.localeCompare(b.repository);
          if (repositoryOrder !== 0) return repositoryOrder;
          const prOrder = Number(a.pull_request_number) - Number(b.pull_request_number);
          if (prOrder !== 0) return prOrder;
          const shaOrder = a.commit_sha.localeCompare(b.commit_sha);
          if (shaOrder !== 0) return shaOrder;
          return String(b.updated_at).localeCompare(String(a.updated_at));
        })
        .map(normalizeMergeReadinessReviewRecord);
    },
    updateMergeReadinessReview(input = {}) {
      const state = loadState();
      const update = normalizeUpdateMergeReadinessReviewInput(input);
      const record = state.merge_readiness_reviews[reviewKey(update.tenant_id, update.review_id)] || null;
      if (!record || record.task_id !== update.task_id) {
        throw createTaskPlatformError(404, 'merge_readiness_review_not_found', 'Merge readiness review not found', { reviewId: update.review_id });
      }
      if (Number(record.record_version) !== Number(update.record_version)) {
        throw createTaskPlatformError(409, 'merge_readiness_review_version_conflict', `Merge readiness review version ${update.record_version} is stale; current version is ${record.record_version}`, {
          reviewId: update.review_id,
          expectedVersion: record.record_version,
        });
      }
      for (const field of [
        'review_status',
        'policy_version',
        'github_check_run_id',
        'reviewer_actor_id',
        'reviewer_actor_type',
        ...MERGE_READINESS_JSON_FIELDS.map(([, snakeName]) => snakeName),
      ]) {
        if (Object.prototype.hasOwnProperty.call(update, field)) {
          record[field] = update[field];
        }
      }
      record.record_version = Number(record.record_version) + 1;
      record.updated_at = new Date().toISOString();
      saveState(state);
      return normalizeMergeReadinessReviewRecord(record);
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
  MERGE_READINESS_REVIEW_STATUSES,
  MERGE_READINESS_POLICY_VERSION,
  MERGE_READINESS_JSON_FIELDS,
  normalizeCreateMergeReadinessReviewInput,
  normalizeMergeReadinessReviewRecord,
  normalizeUpdateMergeReadinessReviewInput,
};
