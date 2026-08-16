'use strict';

const { PostgresSaver } = require('@langchain/langgraph-checkpoint-postgres');
const { currentTenantBinding, requireTenantBinding } = require('./binding');
const { GRAPH_VERSION, STATE_SCHEMA_VERSION } = require('./constants');
const { LangGraphRuntimeError, asRuntimeError } = require('./errors');
const { jsonBytes, validateFactoryState } = require('./state');

function checkpointState(checkpoint) {
  const values = checkpoint?.channel_values;
  if (!values || typeof values !== 'object') {
    throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'checkpoint_channels' } });
  }
  const candidate = values.__start__ && typeof values.__start__ === 'object'
    ? values.__start__
    : {
      schemaVersion: values.schemaVersion,
      graphVersion: values.graphVersion,
      tenantId: values.tenantId,
      factoryRunId: values.factoryRunId,
      threadId: values.threadId,
      lifecycleNode: values.lifecycleNode,
      completedNodes: values.completedNodes,
      artifacts: values.artifacts,
      decisions: values.decisions,
      attempt: values.attempt,
      updatedAt: values.updatedAt,
    };
  return candidate;
}

function leaseFencedPool(pool, schema) {
  return {
    get langGraphBudget() { return pool.langGraphBudget; },
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      const binding = currentTenantBinding();
      if (!binding) return client;
      return {
        release: (...args) => client.release(...args),
        async query(sql, values) {
          if (String(sql).trim().toUpperCase() === 'COMMIT') {
            binding.leaseGuard?.assertActive();
            const ownerPredicate = binding.leaseGuard
              ? 'AND lease_owner = $3 AND lease_expires_at > NOW()'
              : '';
            const values = binding.leaseGuard
              ? [binding.tenantId, binding.threadId, binding.leaseGuard.owner]
              : [binding.tenantId, binding.threadId];
            const result = await client.query(`SELECT 1 FROM "${schema}".factory_threads
              WHERE tenant_id = $1 AND thread_id = $2 ${ownerPredicate} FOR UPDATE`, values);
            if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
          }
          return client.query(sql, values);
        },
      };
    },
  };
}

function metadataContains(metadata, filter) {
  return Object.entries(filter || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return metadata?.[key] && metadataContains(metadata[key], value);
    }
    return metadata?.[key] === value;
  });
}

class GuardedPostgresSaver extends PostgresSaver {
  constructor(pool, options = {}) {
    super(leaseFencedPool(pool, options.schema), options.serde, { schema: options.schema });
    this.pendingAcceptance = new Map();
    this.registry = options.registry;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.maxStateBytes = options.maxStateBytes;
  }

  async assertBound(config, checkpoint = null) {
    const threadId = config?.configurable?.thread_id;
    const binding = requireTenantBinding(threadId);
    binding.leaseGuard?.assertActive();
    const record = await this.registry.assertBinding(binding.tenantId, threadId);
    if (binding.leaseGuard && (
      record.lease_owner !== binding.leaseGuard.owner
      || !record.lease_expires_at
      || Date.parse(record.lease_expires_at) <= Date.now()
    )) {
      throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
    }
    if (record.graph_version !== GRAPH_VERSION || Number(record.state_schema_version) !== STATE_SCHEMA_VERSION) {
      throw new LangGraphRuntimeError('langgraph_version_unsupported', { safeDetails: { kind: 'registry' } });
    }
    if (checkpoint) {
      const state = validateFactoryState(checkpointState(checkpoint), { maxBytes: this.maxStateBytes });
      if (state.tenantId !== binding.tenantId || state.threadId !== threadId || state.factoryRunId !== record.factory_run_id) {
        throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
      }
      return { binding, record, state };
    }
    return { binding, record };
  }

  async put(config, checkpoint, metadata, newVersions) {
    const started = Date.now();
    const acceptanceKey = `${config?.configurable?.thread_id}:${checkpoint?.id}`;
    let accept;
    let rejectAcceptance;
    const acceptance = new Promise((resolve, reject) => { accept = resolve; rejectAcceptance = reject; });
    acceptance.catch(() => {});
    this.pendingAcceptance.set(acceptanceKey, acceptance);
    try {
      const { binding, record, state } = await this.assertBound(config, checkpoint);
      const parentCheckpointId = config?.configurable?.checkpoint_id || null;
      if (parentCheckpointId !== (record.last_checkpoint_id || null)) {
        throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
      }
      const safeMetadata = {
        ...(metadata || {}),
        tenant_id: binding.tenantId,
        graph_version: GRAPH_VERSION,
        state_schema_version: STATE_SCHEMA_VERSION,
      };
      const result = await super.put(config, checkpoint, safeMetadata, newVersions);
      binding.leaseGuard?.assertActive();
      const sizeBytes = jsonBytes(state);
      await this.registry.recordCheckpoint({
        tenantId: binding.tenantId,
        threadId: state.threadId,
        owner: binding.leaseGuard?.owner || null,
        checkpointId: result.configurable.checkpoint_id,
        node: state.lifecycleNode,
        sizeBytes,
      });
      const duration = Date.now() - started;
      this.metrics.increment('langgraph_checkpoint_writes_total');
      this.metrics.observe('langgraph_checkpoint_write_latency_ms', duration);
      this.metrics.observe('langgraph_checkpoint_size_bytes', sizeBytes);
      this.logger.info('langgraph_checkpoint_written', {
        thread_id: state.threadId, checkpoint_id: result.configurable.checkpoint_id,
        node: state.lifecycleNode, graph_version: GRAPH_VERSION,
        state_schema_version: STATE_SCHEMA_VERSION, size_bytes: sizeBytes, duration_ms: duration, outcome: 'success',
      });
      accept();
      return result;
    } catch (error) {
      rejectAcceptance(asRuntimeError(error));
      this.metrics.increment('langgraph_checkpoint_errors_total', { operation: 'write', code: error?.code || 'unavailable' });
      throw asRuntimeError(error);
    } finally {
      if (this.pendingAcceptance.get(acceptanceKey) === acceptance) this.pendingAcceptance.delete(acceptanceKey);
    }
  }

  async getTuple(config) {
    const started = Date.now();
    try {
      const { record } = await this.assertBound(config);
      const requestedId = config?.configurable?.checkpoint_id;
      let checkpointId = record.last_checkpoint_id || null;
      let tuple;
      while (checkpointId) {
        tuple = await super.getTuple({
          ...config,
          configurable: { ...config.configurable, checkpoint_id: checkpointId },
        });
        if (!tuple || !requestedId || checkpointId === requestedId) break;
        checkpointId = tuple.parentConfig?.configurable?.checkpoint_id || null;
        tuple = undefined;
      }
      if (tuple) await this.assertBound(tuple.config, tuple.checkpoint);
      const duration = Date.now() - started;
      this.metrics.increment('langgraph_checkpoint_reads_total');
      this.metrics.observe('langgraph_checkpoint_read_latency_ms', duration);
      return tuple;
    } catch (error) {
      this.metrics.increment('langgraph_checkpoint_errors_total', { operation: 'read', code: error?.code || 'unavailable' });
      throw asRuntimeError(error);
    }
  }

  async *list(config, options) {
    const { record } = await this.assertBound(config);
    let checkpointId = record.last_checkpoint_id || null;
    let emitted = 0;
    const limit = options?.limit === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Number(options.limit) || 0);
    while (checkpointId && emitted < limit) {
      const tuple = await super.getTuple({
        ...config,
        configurable: { ...config.configurable, checkpoint_id: checkpointId },
      });
      if (!tuple) break;
      await this.assertBound(tuple.config, tuple.checkpoint);
      const beforeId = options?.before?.configurable?.checkpoint_id;
      if ((!beforeId || checkpointId < beforeId) && metadataContains(tuple.metadata, options?.filter)) {
        yield tuple;
        emitted += 1;
      }
      checkpointId = tuple.parentConfig?.configurable?.checkpoint_id || null;
    }
  }

  async putWrites(config, writes, taskId) {
    let { binding, record } = await this.assertBound(config);
    const checkpointId = config?.configurable?.checkpoint_id;
    let accepted = false;
    for (let attempt = 0; checkpointId && attempt < 50; attempt += 1) {
      accepted = checkpointId === record.last_checkpoint_id
        || await this.registry.isAcceptedCheckpoint({
          tenantId: binding.tenantId, threadId: binding.threadId,
          namespace: config.configurable.checkpoint_ns || '', checkpointId,
        });
      if (accepted) break;
      const key = `${binding.threadId}:${checkpointId}`;
      const pending = this.pendingAcceptance.get(key)
        || [...this.pendingAcceptance.entries()]
          .find(([candidate]) => candidate.startsWith(`${binding.threadId}:`))?.[1];
      if (pending) await pending;
      else await new Promise((resolve) => setTimeout(resolve, 2));
      ({ binding, record } = await this.assertBound(config));
    }
    if (!accepted) {
      throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
    }
    binding.leaseGuard?.assertActive();
    return super.putWrites(config, writes, taskId);
  }

  async deleteThread(threadId) {
    const binding = requireTenantBinding(threadId);
    await this.registry.assertBinding(binding.tenantId, threadId);
    return super.deleteThread(threadId);
  }
}

module.exports = { GuardedPostgresSaver, checkpointState };
