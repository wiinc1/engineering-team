'use strict';

const crypto = require('crypto');
const { emptyCheckpoint } = require('@langchain/langgraph');
const { createPgPoolFromEnv } = require('../../audit/postgres');
const { createLeaseGuard, requireTenantBinding, withTenantBinding } = require('./binding');
const { GuardedPostgresSaver } = require('./checkpointer');
const { assertInvocationAllowed, runtimeConfig } = require('./config');
const { GRAPH_VERSION, STATE_SCHEMA_VERSION } = require('./constants');
const { asRuntimeError, LangGraphRuntimeError } = require('./errors');
const { compileFactoryGraph } = require('./graph');
const { deriveThreadId } = require('./identity');
const { createLangGraphLogger, createMetricSink, recordError } = require('./observability');
const { createPoolBudget } = require('./pool');
const { createThreadRegistry } = require('./registry');
const { projectFactoryState, validateFactoryState } = require('./state');
const { createDatabaseOwnershipGuard } = require('../../runtime-cutover');
const {
  beginLeaseHeartbeat, graphRunnableConfig, initialState, interruptFromSnapshot, sanitizeInterruptRow, throwIfAborted, timeout,
} = require('./runtime-support');
const operatorActions = require('./runtime-operator-actions');

function runtimeDependencies(options) {
  const clock = options.clock || { now: Date.now };
  const logger = options.logger || createLangGraphLogger({ baseDir: options.baseDir });
  const metrics = options.metrics || createMetricSink();
  const config = runtimeConfig({ ...options.config, pool: options.pool });
  const ownsPool = options.ownsPool ?? !options.pool;
  const sharedPool = options.pool || createPgPoolFromEnv(options.connectionString);
  const pool = options.runtimePool || createPoolBudget(sharedPool, config.poolBudget, metrics);
  const registry = options.registry || createThreadRegistry(pool, { schema: config.schema });
  const ownershipGuard = options.ownershipGuard || (config.ownershipEpoch
    ? createDatabaseOwnershipGuard(sharedPool, { scope: 'factory', engine: 'langgraph', epoch: config.ownershipEpoch })
    : null);
  const checkpointer = options.checkpointer || new GuardedPostgresSaver(pool, {
    logger, maxStateBytes: config.maxStateBytes, metrics, registry, schema: config.schema,
  });
  if (config.production && !(checkpointer instanceof GuardedPostgresSaver)) {
    throw new LangGraphRuntimeError('langgraph_configuration_invalid', { safeDetails: { reason: 'unguarded_checkpointer' } });
  }
  const graph = options.graph || compileFactoryGraph({
    checkpointer, clock, interruptAfter: options.interruptAfter, interruptBefore: options.interruptBefore,
    maxStateBytes: config.maxStateBytes, nodes: options.nodes,
    entryNode: options.entryNode, transitions: options.transitions,
  });
  return { checkpointer, clock, config, graph, logger, metrics, ownershipGuard, ownsPool, pool, registry, sharedPool };
}

class LangGraphRuntime {
  constructor(options) {
    Object.assign(this, runtimeDependencies(options));
    this.ready = false;
    this.closed = false;
  }

  async setup() {
    if (this.closed) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'closed' } });
    const result = await timeout((async () => {
      await this.checkpointer.setup();
      return this.pool.query(`
        SELECT to_regclass($1) AS registry, to_regclass($2) AS checkpoints,
               (SELECT MAX(v) FROM "${this.config.schema}".checkpoint_migrations) AS saver_version
      `, [`${this.config.schema}.factory_threads`, `${this.config.schema}.checkpoints`]);
    })(), this.config.operationTimeoutMs);
    if (!result.rows[0]?.registry || !result.rows[0]?.checkpoints || result.rows[0]?.saver_version == null) {
      throw new LangGraphRuntimeError('langgraph_migration_mismatch');
    }
    this.ready = true;
    this.logger.info('langgraph_runtime_setup', { graph_version: GRAPH_VERSION, state_schema_version: STATE_SCHEMA_VERSION, outcome: 'success' });
    return Object.freeze({ ready: true, graphVersion: GRAPH_VERSION, stateSchemaVersion: STATE_SCHEMA_VERSION });
  }

  assertReady() {
    if (!this.ready || this.closed) {
      throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: this.closed ? 'closed' : 'not_setup' } });
    }
    assertInvocationAllowed(this.config);
  }

  async withLease(state, action, onLeaseLost) {
    const owner = crypto.randomUUID();
    const lease = {
      tenantId: state.tenantId, threadId: state.threadId, owner, leaseMs: this.config.resumeLeaseMs,
    };
    await this.registry.acquireLease(lease);
    const leaseGuard = createLeaseGuard(owner);
    let rejectLeaseFailure;
    const leaseFailure = new Promise((_, reject) => { rejectLeaseFailure = reject; });
    const stopHeartbeat = beginLeaseHeartbeat(this.registry, lease, (error) => {
      leaseGuard.fail(error);
      onLeaseLost?.(error);
      rejectLeaseFailure(error);
    });
    const actionPromise = Promise.resolve().then(() => withTenantBinding({
      tenantId: state.tenantId, threadId: state.threadId, leaseGuard,
    }, action));
    const lifetime = Promise.resolve(actionPromise).finally(async () => {
      await stopHeartbeat();
      await this.registry.releaseLease(lease);
    });
    // Lease loss must reject the caller promptly, while lifetime continues to
    // fence the stale writer and retains ownership until it truly settles.
    lifetime.catch(() => {});
    return Promise.race([lifetime, leaseFailure]);
  }

  async registerState(state) {
    return this.registry.register({
      tenantId: state.tenantId, factoryRunId: state.factoryRunId, threadId: state.threadId,
      namespace: this.config.namespace, graphVersion: GRAPH_VERSION, stateSchemaVersion: STATE_SCHEMA_VERSION,
      retentionExpiresAt: new Date(this.clock.now() + this.config.retentionDays * 86_400_000).toISOString(),
    });
  }

  async invoke(input) {
    this.assertReady();
    await this.ownershipGuard?.assert();
    let state;
    const controller = new AbortController();
    try {
      const operation = (async () => {
        state = initialState(input, this.config, this.clock);
        await this.registerState(state);
        throwIfAborted(controller.signal);
        return this.withLease(state, async () => {
        const runnableConfig = graphRunnableConfig(state, controller.signal);
        try {
          const existing = await this.checkpointer.getTuple(runnableConfig);
          if (existing) throw new LangGraphRuntimeError('langgraph_concurrency_conflict', { safeDetails: { reason: 'thread_already_started' } });
          const result = await this.graph.invoke(state, runnableConfig);
          await this.updateCompletionStatus(state.tenantId, state.threadId, runnableConfig, result);
          return validateFactoryState(projectFactoryState(result), { maxBytes: this.config.maxStateBytes });
        } catch (error) {
          await this.updateLeaseStatus(state.tenantId, state.threadId, 'paused');
          throw error;
        }
        }, () => controller.abort());
      })();
      return await timeout(operation, this.config.operationTimeoutMs, { onTimeout: () => controller.abort() });
    } catch (error) {
      const resolved = asRuntimeError(error);
      recordError(this.metrics, this.logger, resolved, { thread_id: state?.threadId, graph_version: GRAPH_VERSION });
      throw resolved;
    }
  }

  async resume(input) {
    this.assertReady();
    await this.ownershipGuard?.assert();
    const threadId = input.threadId || deriveThreadId(input);
    const controller = new AbortController();
    try {
      const operation = (async () => {
        const record = await this.registry.assertBinding(input.tenantId, threadId);
        throwIfAborted(controller.signal);
        const state = { tenantId: input.tenantId, threadId, factoryRunId: record.factory_run_id };
        return this.withLease(state, async () => {
        const runnableConfig = graphRunnableConfig(state, controller.signal);
        try {
          const checkpoint = await this.checkpointer.getTuple(runnableConfig);
          if (!checkpoint) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'checkpoint_not_found' } });
          const result = await this.graph.invoke(null, runnableConfig);
          await this.updateCompletionStatus(input.tenantId, threadId, runnableConfig, result);
          return validateFactoryState(projectFactoryState(result), { maxBytes: this.config.maxStateBytes });
        } catch (error) {
          await this.updateLeaseStatus(input.tenantId, threadId, 'paused');
          throw error;
        }
        }, () => controller.abort());
      })();
      return await timeout(operation, this.config.operationTimeoutMs, { onTimeout: () => controller.abort() });
    } catch (error) {
      const resolved = asRuntimeError(error);
      recordError(this.metrics, this.logger, resolved, { thread_id: threadId, graph_version: GRAPH_VERSION });
      throw resolved;
    }
  }

  async updateCompletionStatus(tenantId, threadId, runnableConfig, resultState = null) {
    const snapshot = typeof this.graph.getState === 'function' ? await this.graph.getState(runnableConfig) : null;
    const paused = Array.isArray(snapshot?.next) && snapshot.next.length > 0;
    const lifecycleStatus = resultState?.lifecycleStatus || snapshot?.values?.lifecycleStatus;
    const status = paused
      ? 'paused'
      : lifecycleStatus === 'cancelled' ? 'cancelled'
        : ['failed', 'dead_letter'].includes(lifecycleStatus) ? 'failed' : 'completed';
    await this.updateLeaseStatus(tenantId, threadId, status);
    if (paused) await this.persistInterrupt(tenantId, threadId, snapshot);
    return status;
  }

  async persistInterrupt(tenantId, threadId, snapshot) {
    const pending = interruptFromSnapshot(snapshot);
    if (!pending) return null;
    if (!pending.checkpointId) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'interrupt_checkpoint' } });
    return this.registry.recordInterrupt({ ...pending, tenantId, threadId });
  }

  async runStatus(input) {
    return operatorActions.runStatus(this, input);
  }

  async resumeDecision(input) {
    return operatorActions.resumeDecision(this, input);
  }

  async retryNode(input) {
    return operatorActions.retryNode(this, input);
  }

  async cancel(input) {
    return operatorActions.cancel(this, input);
  }

  async updateLeaseStatus(tenantId, threadId, status) {
    const binding = requireTenantBinding(threadId);
    binding.leaseGuard.assertActive();
    return this.registry.updateStatusWithLease({
      tenantId, threadId, owner: binding.leaseGuard.owner, status,
    });
  }

  async health(input = {}) {
    const started = Date.now();
    try {
      return await timeout(this.performHealth(input, started), this.config.operationTimeoutMs);
    } catch (error) {
      throw asRuntimeError(error);
    }
  }

  async performHealth(input, started) {
    if (!this.ready || this.closed) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'not_ready' } });
    await this.pool.query('SELECT 1');
    const stats = await this.registry.stats();
    this.metrics.gauge('langgraph_active_threads', Number(stats.active || 0));
    this.metrics.gauge('langgraph_stale_threads', Number(stats.stale || 0));
    this.metrics.gauge('langgraph_active_interrupts', Number(stats.active_interrupts || 0));
    this.metrics.gauge('langgraph_active_interrupt_age_seconds', Number(stats.active_interrupt_age_seconds || 0));
    if (input.deep) await this.syntheticCheckpointProbe();
    return Object.freeze({
      status: 'ok', schema: this.config.schema, graphVersion: GRAPH_VERSION,
      stateSchemaVersion: STATE_SCHEMA_VERSION, activeThreads: Number(stats.active || 0),
      staleThreads: Number(stats.stale || 0), checkpointBytes: Number(stats.checkpoint_bytes || 0),
      deep: input.deep === true, durationMs: Date.now() - started,
    });
  }

  async syntheticCheckpointProbe() {
    const suffix = crypto.randomUUID().replace(/-/g, '');
    const tenantId = `health_${suffix.slice(0, 12)}`;
    const factoryRunId = `probe:${suffix.slice(0, 24)}`;
    const state = initialState({ tenantId, factoryRunId }, this.config, this.clock);
    await this.registry.register({
      tenantId, factoryRunId, threadId: state.threadId, namespace: this.config.namespace,
      graphVersion: GRAPH_VERSION, stateSchemaVersion: STATE_SCHEMA_VERSION,
      retentionExpiresAt: new Date(this.clock.now() + 60_000).toISOString(),
    });
    const runnableConfig = graphRunnableConfig(state);
    const channelVersions = Object.fromEntries(Object.keys(state).map((key) => [key, '1']));
    const checkpoint = { ...emptyCheckpoint(), channel_values: { ...state }, channel_versions: channelVersions, versions_seen: {} };
    const probe = withTenantBinding({ tenantId, threadId: state.threadId }, async () => {
        await this.checkpointer.put(runnableConfig, checkpoint, { source: 'health' }, channelVersions);
        const loaded = await this.checkpointer.getTuple(runnableConfig);
        if (!loaded) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'probe_read' } });
        if (loaded.metadata?.graph_version !== GRAPH_VERSION || Number(loaded.metadata?.state_schema_version) !== STATE_SCHEMA_VERSION) {
          throw new LangGraphRuntimeError('langgraph_version_unsupported', { safeDetails: { kind: 'health_probe' } });
        }
        await this.checkpointer.deleteThread(state.threadId);
    });
    const cleanup = () => this.cleanupSyntheticProbe(tenantId, state.threadId);
    probe.finally(cleanup).catch(() => {});
    try {
      await timeout(probe, this.config.operationTimeoutMs);
    } finally {
      await cleanup();
    }
  }

  async cleanupSyntheticProbe(tenantId, threadId) {
    const removeCheckpoint = withTenantBinding({ tenantId, threadId }, () => this.checkpointer.deleteThread(threadId));
    await timeout(removeCheckpoint, this.config.operationTimeoutMs).catch(() => {});
    await timeout(this.registry.remove(tenantId, threadId), this.config.operationTimeoutMs).catch(() => {});
  }

  async checkpointSummaries(tenantId, input) {
    if (!this.ready || this.closed) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable');
    return timeout(this.registry.summaries(tenantId, input), this.config.operationTimeoutMs);
  }

  async checkpointHistory(input) {
    if (!this.ready || this.closed) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable');
    const controller = new AbortController();
    const operation = (async () => {
      await this.registry.assertBinding(input.tenantId, input.threadId);
      throwIfAborted(controller.signal);
      const runnableConfig = graphRunnableConfig({ threadId: input.threadId });
      return withTenantBinding({ tenantId: input.tenantId, threadId: input.threadId }, async () => {
      const history = [];
      for await (const tuple of this.checkpointer.list(runnableConfig, { limit: Math.min(Number(input.limit) || 25, 100) })) {
        throwIfAborted(controller.signal);
        history.push(Object.freeze({
          checkpointId: tuple.config.configurable.checkpoint_id,
          parentCheckpointId: tuple.parentConfig?.configurable?.checkpoint_id || null,
          source: tuple.metadata?.source || null,
          step: Number.isInteger(tuple.metadata?.step) ? tuple.metadata.step : null,
          graphVersion: tuple.metadata?.graph_version,
          stateSchemaVersion: Number(tuple.metadata?.state_schema_version),
          createdAt: tuple.checkpoint.ts,
        }));
      }
      return Object.freeze(history);
      });
    })();
    return timeout(operation, this.config.operationTimeoutMs, { onTimeout: () => controller.abort() });
  }

  async pruneExpired(input = {}) {
    if (!this.ready || this.closed) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable');
    const controller = new AbortController();
    const operation = (async () => {
      const candidates = await this.registry.expired(input.limit);
      throwIfAborted(controller.signal);
      let pruned = 0;
      for (const candidate of candidates) {
        await withTenantBinding({ tenantId: candidate.tenant_id, threadId: candidate.thread_id }, async () => {
          await this.checkpointer.deleteThread(candidate.thread_id);
        });
        throwIfAborted(controller.signal);
        if (await this.registry.remove(candidate.tenant_id, candidate.thread_id)) pruned += 1;
        throwIfAborted(controller.signal);
      }
      this.metrics.increment('langgraph_retention_pruned_threads_total', {}, pruned);
      return Object.freeze({ pruned });
    })();
    return timeout(operation, this.config.operationTimeoutMs, { onTimeout: () => controller.abort() });
  }

  async close() {
    this.closed = true;
    this.ready = false;
    if (this.ownsPool && typeof this.sharedPool.end === 'function') {
      await timeout(this.sharedPool.end(), this.config.operationTimeoutMs);
    }
  }
}

function runtimeFacade(runtime) {
  return Object.freeze({
    checkpointHistory: runtime.checkpointHistory.bind(runtime),
    checkpointSummaries: runtime.checkpointSummaries.bind(runtime),
    checkpointer: runtime.checkpointer,
    close: runtime.close.bind(runtime),
    config: runtime.config,
    graph: runtime.graph,
    health: runtime.health.bind(runtime),
    invoke: runtime.invoke.bind(runtime),
    metrics: runtime.metrics,
    pool: runtime.sharedPool,
    pruneExpired: runtime.pruneExpired.bind(runtime),
    runStatus: runtime.runStatus.bind(runtime),
    registry: runtime.registry,
    resume: runtime.resume.bind(runtime),
    resumeDecision: runtime.resumeDecision.bind(runtime),
    retryNode: runtime.retryNode.bind(runtime),
    cancel: runtime.cancel.bind(runtime),
    setup: runtime.setup.bind(runtime),
  });
}

function createLangGraphRuntime(options = {}) {
  return runtimeFacade(new LangGraphRuntime(options));
}

module.exports = { createLangGraphRuntime, graphRunnableConfig, initialState, interruptFromSnapshot, sanitizeInterruptRow, timeout };
