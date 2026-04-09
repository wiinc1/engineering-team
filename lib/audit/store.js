const fs = require('fs');
const path = require('path');
const { createAuditLogger, ensureDir } = require('./logger');
const {
  defaultMetrics,
  makeTenantScopedKey,
  makeProjectionKey,
  matchesTenant,
  matchesFilters,
  toHistoryEntry,
  buildCurrentState,
  buildRelationshipState,
  createCanonicalEvent,
} = require('./core');
const { createPostgresAuditStore } = require('./postgres');
const { assertAuditFoundationEnabled, isWorkflowEngineEnabled, isArchitectSpecTieringEnabled, isEngineerSubmissionEnabled } = require('./feature-flags');
const { resolveAuditBackend } = require('./config');
const { WorkflowEngine, WorkflowError, STAGES } = require('./workflow');
const { deriveReviewQuestions, isReviewQuestionEventType } = require('./review-questions');

function lastArchitectHandoffFromHistory(history = []) {
  return history.find((event) => event?.event_type === 'task.architect_handoff_recorded') || null;
}

function lastEngineerSubmissionFromHistory(history = []) {
  return history.find((event) => event?.event_type === 'task.engineer_submission_recorded') || null;
}

function createAdapterBackedPostgresStore(options = {}) {
  const pool = options.pool;
  async function appendEvent(input) {
    assertAuditFoundationEnabled(options);
    const tenantId = input.tenantId || 'engineering-team';
    const duplicate = await pool.findEventByIdempotencyKey.length >= 2
      ? await pool.findEventByIdempotencyKey(tenantId, input.idempotencyKey)
      : await pool.findEventByIdempotencyKey(input.idempotencyKey);
    if (duplicate) return { event: duplicate, duplicate: true };
    const sequenceNumber = await pool.nextSequenceNumber.length >= 2
      ? await pool.nextSequenceNumber(tenantId, input.taskId)
      : await pool.nextSequenceNumber(input.taskId);
    const event = createCanonicalEvent(input, sequenceNumber);
    await pool.insertEvent(event);
    return { event, duplicate: false };
  }
  return {
    kind: 'postgres',
    appendEvent,
    async getTaskHistory(taskId, filters = {}) { assertAuditFoundationEnabled(options); return pool.getTaskHistory(taskId, filters); },
    async getTaskCurrentState(taskId, filters = {}) { assertAuditFoundationEnabled(options); return pool.getTaskCurrentState(taskId, filters); },
    async getTaskCurrentStates(taskIds = [], filters = {}) { assertAuditFoundationEnabled(options); return pool.getTaskCurrentStates(taskIds, filters); },
    async listTaskSummaries(filters = {}) { assertAuditFoundationEnabled(options); return pool.listTaskSummaries(filters); },
    async getTaskRelationships(taskId, filters = {}) { assertAuditFoundationEnabled(options); return pool.getTaskRelationships(taskId, filters); },
    async getTaskObservabilitySummary(taskId, filters = {}) { assertAuditFoundationEnabled(options); return pool.getTaskObservabilitySummary(taskId, filters); },
    async rebuildProjections() { assertAuditFoundationEnabled(options); return pool.rebuildProjections(); },
  };
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function nextSequenceNumberFromEvents(filePath, tenantId, taskId) {
  const events = readJsonLines(filePath);
  return events.filter(event => event.tenant_id === tenantId && event.task_id === taskId).length + 1;
}

function writeJsonLines(filePath, rows) {
  ensureDir(path.dirname(filePath));
  const content = rows.map(row => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, content ? `${content}\n` : '');
}

function createFileAuditStore(options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const dataDir = path.join(baseDir, 'data');
  const logger = options.logger || createAuditLogger(baseDir);
  const projectionMode = options.projectionMode || 'sync';
  const maxAttempts = Number(options.maxAttempts || 5);
  const historyLatencyRegressionThresholdMs = Number(options.historyLatencyRegressionThresholdMs || process.env.AUDIT_HISTORY_LATENCY_REGRESSION_MS || 250);

  const files = {
    events: path.join(dataDir, 'workflow-audit-events.jsonl'),
    idempotency: path.join(dataDir, 'workflow-audit-idempotency.json'),
    currentState: path.join(dataDir, 'task-current-state-projection.json'),
    history: path.join(dataDir, 'task-history-projection.json'),
    relationships: path.join(dataDir, 'task-relationship-projection.json'),
    metrics: path.join(dataDir, 'workflow-audit-metrics.json'),
    projectionQueue: path.join(dataDir, 'workflow-audit-projection-queue.jsonl'),
    outbox: path.join(dataDir, 'workflow-audit-outbox.jsonl'),
    projectionDeadLetter: path.join(dataDir, 'workflow-audit-projection-dead-letter.jsonl'),
    outboxDeadLetter: path.join(dataDir, 'workflow-audit-outbox-dead-letter.jsonl'),
  };

  function updateQueueLagMetrics(metrics) {
    const queue = readJsonLines(files.projectionQueue);
    const pending = queue.filter(entry => !entry.published_at && entry.status !== 'processed' && entry.status !== 'dead_letter');
    metrics.projection_checkpoint = queue.filter(entry => entry.status === 'processed').length;
    metrics.outbox_checkpoint = readJsonLines(files.outbox).filter(entry => entry.status === 'processed' || entry.status === 'published').length;
    if (!pending.length) {
      metrics.workflow_projection_lag_seconds = 0;
      return metrics;
    }
    const oldestOccurredAt = pending
      .map(entry => Date.parse(entry.event?.occurred_at || entry.available_at || new Date().toISOString()))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b)[0];
    metrics.workflow_projection_lag_seconds = Math.max(0, Math.floor((Date.now() - oldestOccurredAt) / 1000));
    return metrics;
  }

  function readMetricsWithLag() {
    const metrics = readJson(files.metrics, defaultMetrics());
    return updateQueueLagMetrics(metrics);
  }

  function writeMetrics(metrics) {
    writeJson(files.metrics, updateQueueLagMetrics(metrics));
  }

  function applyEventToProjections(event) {
    const historyProjection = readJson(files.history, {});
    const projectionKey = makeProjectionKey(event.tenant_id, event.task_id);
    const taskHistory = historyProjection[projectionKey] || [];
    taskHistory.push(toHistoryEntry(event));
    historyProjection[projectionKey] = taskHistory.sort((a, b) => a.sequence_number - b.sequence_number);
    writeJson(files.history, historyProjection);

    const currentState = readJson(files.currentState, {});
    currentState[projectionKey] = buildCurrentState(currentState[projectionKey], event);
    writeJson(files.currentState, currentState);

    const relationships = readJson(files.relationships, {});
    relationships[projectionKey] = buildRelationshipState(relationships[projectionKey], event);
    writeJson(files.relationships, relationships);
  }

  function appendEvent(input) {
    assertAuditFoundationEnabled(options);
    const startedAt = Date.now();
    ensureDir(dataDir);
    const idempotencyIndex = readJson(files.idempotency, {});
    const metrics = readMetricsWithLag();
    const tenantId = input.tenantId || 'engineering-team';
    const idempotencyKey = makeTenantScopedKey(tenantId, input.idempotencyKey);
    if (idempotencyIndex[idempotencyKey]) {
      return { event: idempotencyIndex[idempotencyKey], duplicate: true };
    }
    try {
      const sequenceNumber = nextSequenceNumberFromEvents(files.events, tenantId, input.taskId);
      const event = createCanonicalEvent(input, sequenceNumber);
      fs.appendFileSync(files.events, `${JSON.stringify(event)}\n`);
      fs.appendFileSync(files.projectionQueue, `${JSON.stringify({ offset: sequenceNumber, event, attempts: 0, status: 'pending', available_at: new Date().toISOString() })}\n`);
      fs.appendFileSync(files.outbox, `${JSON.stringify({ offset: sequenceNumber, event, attempts: 0, status: 'pending', available_at: new Date().toISOString(), published_at: null })}\n`);
      idempotencyIndex[idempotencyKey] = event;
      writeJson(files.idempotency, idempotencyIndex);

      if (projectionMode === 'sync') {
        applyEventToProjections(event);
        metrics.workflow_projection_events_processed_total += 1;
        metrics.projection_checkpoint += 1;
      }

      metrics.workflow_audit_events_written_total += 1;
      metrics.last_write_duration_ms = Date.now() - startedAt;
      writeMetrics(metrics);
      logger.info({
        feature: 'ff_audit_foundation',
        action: 'audit_ingest',
        outcome: 'accepted',
        task_id: event.task_id,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        correlation_id: event.correlation_id,
        trace_id: event.trace_id,
        duration_ms: metrics.last_write_duration_ms,
      });
      return { event, duplicate: false };
    } catch (error) {
      metrics.workflow_audit_write_failures_total += 1;
      metrics.last_write_duration_ms = Date.now() - startedAt;
      writeMetrics(metrics);
      logger.error({ feature: 'ff_audit_foundation', action: 'audit_write', outcome: 'error', tenant_id: tenantId, task_id: input.taskId, idempotency_key: input.idempotencyKey, error_message: error.message, duration_ms: metrics.last_write_duration_ms });
      throw error;
    }
  }

  function getTaskHistory(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const metrics = readMetricsWithLag();
    const startedAt = Date.now();
    try {
      metrics.workflow_history_queries_total += 1;
      const projectionKey = makeProjectionKey(filters.tenantId, taskId);
      let events = (readJson(files.history, {})[projectionKey] || []).filter(event => matchesTenant(event, filters.tenantId));
      events = events.filter(event => matchesFilters(event, filters));
      const limit = filters.limit ? Number(filters.limit) : undefined;
      const cursor = filters.cursor ? Number(filters.cursor) : undefined;
      events = events.sort((a, b) => b.sequence_number - a.sequence_number);
      if (Number.isFinite(cursor)) events = events.filter(event => event.sequence_number < cursor);
      if (Number.isFinite(limit)) events = events.slice(0, limit);
      return events;
    } catch (error) {
      metrics.workflow_history_errors_total += 1;
      logger.error({ feature: 'ff_audit_foundation', action: 'history_query', outcome: 'error', task_id: taskId, error_message: error.message });
      throw error;
    } finally {
      metrics.last_history_query_duration_ms = Date.now() - startedAt;
      if (metrics.last_history_query_duration_ms > historyLatencyRegressionThresholdMs) {
        metrics.workflow_history_query_latency_regressions_total += 1;
        logger.error({ feature: 'ff_audit_foundation', action: 'history_query_latency', outcome: 'regression', task_id: taskId, tenant_id: filters.tenantId || null, duration_ms: metrics.last_history_query_duration_ms, threshold_ms: historyLatencyRegressionThresholdMs });
      }
      writeMetrics(metrics);
    }
  }
  function getTaskCurrentState(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const metrics = readMetricsWithLag();
    metrics.workflow_current_state_queries_total += 1;
    writeMetrics(metrics);
    const result = readJson(files.currentState, {})[makeProjectionKey(filters.tenantId, taskId)] || null;
    return !result || !matchesTenant(result, filters.tenantId) ? null : result;
  }

  function getTaskCurrentStates(taskIds = [], filters = {}) {
    assertAuditFoundationEnabled(options);
    const metrics = readMetricsWithLag();
    metrics.workflow_current_state_queries_total += 1;
    writeMetrics(metrics);
    const all = readJson(files.currentState, {});
    return taskIds.reduce((acc, taskId) => {
      const result = all[makeProjectionKey(filters.tenantId, taskId)] || null;
      acc[taskId] = !result || !matchesTenant(result, filters.tenantId) ? null : result;
      return acc;
    }, {});
  }

  function listTaskSummaries(filters = {}) {
    assertAuditFoundationEnabled(options);
    const metrics = readMetricsWithLag();
    metrics.workflow_current_state_queries_total += 1;
    writeMetrics(metrics);

    const states = Object.values(readJson(files.currentState, {}))
      .filter(state => matchesTenant(state, filters.tenantId))
      .sort((left, right) => String(right.last_occurred_at || '').localeCompare(String(left.last_occurred_at || '')));

    const historyProjection = readJson(files.history, {});
    return states.map((state) => {
      const history = historyProjection[makeProjectionKey(state.tenant_id, state.task_id)] || [];
      const createdEvent = history.find(event => event.event_type === 'task.created');
      const latestEvent = history[history.length - 1] || null;
      const queueEvent = [...history].reverse().find((event) => ['task.assigned', 'task.priority_changed', 'task.stage_changed', 'task.escalated', 'task.decision_recorded'].includes(event.event_type)) || latestEvent || createdEvent || null;
      return {
        task_id: state.task_id,
        tenant_id: state.tenant_id,
        title: createdEvent?.payload?.title || latestEvent?.payload?.title || state.task_id,
        priority: state.priority,
        current_stage: state.current_stage,
        current_owner: state.assignee,
        owner: state.assignee
          ? {
              actor_id: state.assignee,
              display_name: state.assignee,
            }
          : null,
        blocked: Boolean(state.blocked),
        closed: Boolean(state.closed),
        waiting_state: state.waiting_state || latestEvent?.payload?.waiting_state || null,
        next_required_action: state.next_required_action || latestEvent?.payload?.next_required_action || null,
        queue_entered_at: state.queue_entered_at || queueEvent?.occurred_at || state.last_occurred_at || null,
        wip_owner: state.wip_owner || null,
        wip_started_at: state.wip_started_at || null,
        freshness: {
          status: state.last_occurred_at && (Date.now() - Date.parse(state.last_occurred_at)) > 5 * 60 * 1000 ? 'stale' : 'fresh',
          last_updated_at: state.last_occurred_at || null,
        },
      };
    });
  }
  function getTaskRelationships(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const metrics = readMetricsWithLag();
    metrics.workflow_relationship_queries_total += 1;
    writeMetrics(metrics);
    const projectionKey = makeProjectionKey(filters.tenantId, taskId);
    const result = readJson(files.relationships, {})[projectionKey] || null;
    const state = readJson(files.currentState, {})[projectionKey] || null;
    if (!result || (filters.tenantId && (!state || state.tenant_id !== filters.tenantId))) return null;
    return result;
  }
  function getTaskObservabilitySummary(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const metrics = readMetricsWithLag();
    metrics.workflow_observability_queries_total += 1;
    writeMetrics(metrics);
    const history = getTaskHistory(taskId, filters);
    const state = getTaskCurrentState(taskId, filters);
    if (!state) return null;
    const lastUpdatedAt = state.last_occurred_at || null;
    const freshnessStatus = lastUpdatedAt && (Date.now() - Date.parse(lastUpdatedAt)) > 5 * 60 * 1000 ? 'stale' : 'fresh';
    return {
      task_id: taskId,
      tenant_id: state.tenant_id,
      status: freshnessStatus === 'stale' ? 'degraded' : 'ok',
      last_updated_at: lastUpdatedAt,
      freshness: { status: freshnessStatus, last_updated_at: lastUpdatedAt },
      degraded: freshnessStatus === 'stale',
      event_count: history.length,
      last_event_id: state.last_event_id,
      last_event_type: state.last_event_type,
      last_occurred_at: state.last_occurred_at,
      current_stage: state.current_stage,
      closed: state.closed,
      key_signals: {
        projection_lag_seconds: readMetricsWithLag().workflow_projection_lag_seconds,
        blocked: Boolean(state.blocked),
        closed: Boolean(state.closed),
      },
      approved_correlation_ids: [...new Set(history.map(event => event.correlation_id).filter(Boolean))].slice(0, 10),
      approved_links: [],
      privileged_links: [],
      correlation_ids: [...new Set(history.map(event => event.correlation_id).filter(Boolean))],
      trace_ids: [...new Set(history.map(event => event.trace_id).filter(Boolean))],
      metrics: readMetricsWithLag(),
    };
  }

  function processQueue(filePath, deadLetterPath, handler, metricName, failureMetricName, limit = 100) {
    assertAuditFoundationEnabled(options);
    const queue = readJsonLines(filePath);
    const metrics = readMetricsWithLag();
    const now = Date.now();
    const deadLetter = readJsonLines(deadLetterPath);
    let processed = 0;
    let failures = 0;

    const nextQueue = queue.map(entry => {
      if (processed >= limit) return entry;
      if (entry.published_at) return entry;
      if (entry.status === 'dead_letter') return entry;
      if (entry.available_at && Date.parse(entry.available_at) > now) return entry;
      try {
        handler(entry.event);
        processed += 1;
        return { ...entry, status: 'processed', published_at: new Date().toISOString() };
      } catch (error) {
        failures += 1;
        const attempts = (entry.attempts || 0) + 1;
        const next = {
          ...entry,
          attempts,
          status: attempts >= maxAttempts ? 'dead_letter' : 'pending',
          available_at: new Date(now + Math.min(300000, attempts * 15000)).toISOString(),
          last_error: error.message,
        };
        logger.error({
          feature: 'ff_audit_foundation',
          action: metricName === 'workflow_projection_events_processed_total' ? 'projection_apply' : 'outbox_publish',
          outcome: next.status,
          task_id: entry.event?.task_id,
          event_id: entry.event?.event_id,
          error_message: error.message,
        });
        if (next.status === 'dead_letter') deadLetter.push(next);
        return next;
      }
    }).filter(entry => entry.status !== 'dead_letter');

    metrics[metricName] += processed;
    metrics[failureMetricName] += failures;
    writeMetrics(metrics);
    writeJsonLines(filePath, nextQueue);
    writeJsonLines(deadLetterPath, deadLetter);
    return { processed, failed: failures, deadLettered: deadLetter.length };
  }

  function rebuildProjections() {
    assertAuditFoundationEnabled(options);
    const events = readJsonLines(files.events);
    const nextHistory = {};
    const nextCurrentState = {};
    const nextRelationships = {};
    const nextIdempotency = {};
    for (const event of events) {
      const projectionKey = makeProjectionKey(event.tenant_id, event.task_id);
      const taskHistory = nextHistory[projectionKey] || [];
      taskHistory.push(toHistoryEntry(event));
      nextHistory[projectionKey] = taskHistory.sort((a, b) => a.sequence_number - b.sequence_number);
      nextCurrentState[projectionKey] = buildCurrentState(nextCurrentState[projectionKey], event);
      nextRelationships[projectionKey] = buildRelationshipState(nextRelationships[projectionKey], event);
      nextIdempotency[makeTenantScopedKey(event.tenant_id, event.idempotency_key)] = event;
    }
    writeJson(files.history, nextHistory);
    writeJson(files.currentState, nextCurrentState);
    writeJson(files.relationships, nextRelationships);
    writeJson(files.idempotency, nextIdempotency);
    const metrics = readMetricsWithLag();
    metrics.workflow_projection_rebuilds_total += 1;
    metrics.last_rebuild_at = new Date().toISOString();
    writeMetrics(metrics);
    return { rebuiltEvents: events.length, rebuiltTasks: Object.keys(nextHistory).length };
  }

  return {
    kind: 'file',
    appendEvent,
    getTaskHistory,
    getTaskCurrentState,
    getTaskCurrentStates,
    listTaskSummaries,
    getTaskRelationships,
    getTaskObservabilitySummary,
    rebuildProjections,
    processProjectionQueue(limit = 100) {
      return processQueue(files.projectionQueue, files.projectionDeadLetter, applyEventToProjections, 'workflow_projection_events_processed_total', 'workflow_projection_failures_total', limit);
    },
    processOutbox(publisher, limit = 100) {
      return processQueue(files.outbox, files.outboxDeadLetter, publisher, 'workflow_outbox_events_published_total', 'workflow_outbox_publish_failures_total', limit);
    },
    files,
    readMetrics: () => readMetricsWithLag(),
  };
}

function createAuditStore(options = {}) {
  let store;
  if (options.pool && typeof options.pool.findEventByIdempotencyKey === 'function') {
    store = createAdapterBackedPostgresStore(options);
  } else {
    const backend = resolveAuditBackend(options);
    if (backend === 'postgres') {
      store = createPostgresAuditStore(options);
    } else {
      store = createFileAuditStore(options);
    }
  }

  if (isWorkflowEngineEnabled(options)) {
    const engine = new WorkflowEngine();
    const originalAppendEvent = store.appendEvent;

    store.appendEvent = async function(input) {
      if (input.eventType === 'task.stage_changed') {
        const state = await store.getTaskCurrentState(input.taskId, { tenantId: input.tenantId });
        const fromStage = state?.current_stage || STAGES.BACKLOG;
        const toStage = input.payload?.to_stage;

        if (!toStage) {
          throw new Error('to_stage is required for task.stage_changed events');
        }

        if (fromStage === STAGES.ARCHITECT_REVIEW && toStage === STAGES.TECHNICAL_SPEC) {
          const history = await store.getTaskHistory(input.taskId, { tenantId: input.tenantId, limit: 500 });
          const questions = deriveReviewQuestions(history);
          if (questions.summary.unresolvedBlockingCount > 0) {
            throw new WorkflowError('Architect Review cannot be completed while blocking review questions remain unresolved.');
          }
        }

        if (
          isArchitectSpecTieringEnabled(options)
          && fromStage === STAGES.TECHNICAL_SPEC
          && (toStage === STAGES.IMPLEMENTATION || toStage === STAGES.IN_PROGRESS)
        ) {
          const history = await store.getTaskHistory(input.taskId, { tenantId: input.tenantId, limit: 500 });
          const handoff = lastArchitectHandoffFromHistory(history);
          if (!handoff || !handoff.payload?.ready_for_engineering) {
            throw new WorkflowError('Implementation cannot begin until the architect handoff is submitted and marked ready for engineering.');
          }
        }

        if (
          isEngineerSubmissionEnabled(options)
          && [STAGES.IMPLEMENTATION, STAGES.IN_PROGRESS].includes(fromStage)
          && toStage === STAGES.QA_TESTING
        ) {
          const history = await store.getTaskHistory(input.taskId, { tenantId: input.tenantId, limit: 500 });
          const submission = lastEngineerSubmissionFromHistory(history);
          if (!submission || (!submission.payload?.commit_sha && !submission.payload?.pr_url)) {
            throw new WorkflowError('QA handoff cannot be completed until engineer submission includes a commit SHA or PR URL.');
          }
        }

        engine.validateTransition(fromStage, toStage, input.payload);
      }

      if (input.eventType === 'task.closed') {
        const state = await store.getTaskCurrentState(input.taskId, { tenantId: input.tenantId });
        const fromStage = state?.current_stage || STAGES.BACKLOG;
        engine.validateTransition(fromStage, STAGES.DONE, input.payload);
      }

      if (isReviewQuestionEventType(input.eventType)) {
        const state = await store.getTaskCurrentState(input.taskId, { tenantId: input.tenantId });
        if (state?.current_stage !== STAGES.ARCHITECT_REVIEW) {
          throw new WorkflowError('Review questions can only be created or updated during Architect Review.');
        }
      }

      if (input.eventType === 'task.architect_handoff_recorded') {
        if (!isArchitectSpecTieringEnabled(options)) {
          throw new WorkflowError('Architect spec tiering is disabled.');
        }
        const state = await store.getTaskCurrentState(input.taskId, { tenantId: input.tenantId });
        const currentStage = state?.current_stage || STAGES.BACKLOG;
        if (![STAGES.ARCHITECT_REVIEW, STAGES.TECHNICAL_SPEC].includes(currentStage)) {
          throw new WorkflowError('Architect handoff can only be recorded during Architect Review or Technical Spec.');
        }
      }

      if (input.eventType === 'task.engineer_submission_recorded') {
        if (!isEngineerSubmissionEnabled(options)) {
          throw new WorkflowError('Engineer submission is disabled.');
        }
        const state = await store.getTaskCurrentState(input.taskId, { tenantId: input.tenantId });
        const currentStage = state?.current_stage || STAGES.BACKLOG;
        if (![STAGES.IMPLEMENTATION, STAGES.IN_PROGRESS].includes(currentStage)) {
          throw new WorkflowError('Engineer submission can only be recorded during Implementation.');
        }
      }

      return originalAppendEvent.call(store, input);
    };
  }

  return store;
}

module.exports = {
  createAuditStore,
  createFileAuditStore,
  createPostgresAuditStore,
};
