'use strict';

const { randomUUID } = require('node:crypto');

const {
  PRODUCTION_SERVICE_BINDINGS,
  assertProductionLifecycleServices,
} = require('../software-factory/langgraph/production-ports');

function assertHandlers(handlers) {
  const missing = [];
  if (typeof handlers?.children?.plan !== 'function') missing.push('children.plan');
  if (typeof handlers?.children?.execute !== 'function') missing.push('children.execute');
  for (const [domain, method] of Object.values(PRODUCTION_SERVICE_BINDINGS)) {
    if (typeof handlers?.[domain]?.[method] !== 'function') missing.push(`${domain}.${method}`);
  }
  if (missing.length) throw new Error(`Incomplete LangGraph lifecycle handlers: ${missing.sort().join(', ')}`);
  return handlers;
}

function createCanonicalRunResolver(store) {
  if (store?.kind !== 'postgres' || typeof store?.pool?.query !== 'function') {
    throw new Error('Production LangGraph lifecycle handlers require the canonical PostgreSQL audit store.');
  }
  return async ({ tenantId, factoryRunId }) => {
    const result = await store.pool.query(`
      SELECT tenant_id, queue_id, task_id, project_id, attempts, updated_at
      FROM factory_delivery_queue
      WHERE tenant_id = $1 AND queue_id = $2
      LIMIT 1
    `, [tenantId, factoryRunId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      factoryRunId: row.queue_id,
      queueId: row.queue_id,
      taskId: row.task_id,
      projectId: row.project_id || null,
      version: Number(row.attempts || 0) + 1,
    };
  };
}

function createCanonicalLifecycleAudit(store) {
  if (store?.kind !== 'postgres' || typeof store?.pool?.query !== 'function'
    || typeof store?.appendEvent !== 'function') {
    throw new Error('Canonical PostgreSQL lifecycle ledger and audit appendEvent are required.');
  }
  return async (event) => {
    if (!['node_started', 'node_finished'].includes(event?.type)) {
      throw new Error('Canonical lifecycle audit only accepts node_started or node_finished.');
    }
    const inserted = await store.pool.query(`
      INSERT INTO langgraph_checkpoint.factory_lifecycle_events (
        event_id, tenant_id, factory_run_id, task_id, thread_id, event_type,
        node, attempt, outcome, delegation, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING *
    `, [
      randomUUID(), event.run.tenantId, event.run.factoryRunId, event.run.taskId || null,
      event.threadId, event.type, event.node, event.attempt, event.outcome || null,
      event.delegation ? JSON.stringify(event.delegation) : null, event.idempotencyKey,
    ]);
    const ledgerEvent = inserted.rows[0] || null;
    if (!event.run.taskId) return { event: ledgerEvent, duplicate: !ledgerEvent, canonicalAudit: null };
    const canonicalAudit = await store.appendEvent({
      tenantId: event.run.tenantId,
      taskId: event.run.taskId,
      eventType: event.type === 'node_started'
        ? 'task.langgraph_node_started'
        : 'task.langgraph_node_finished',
      actorId: 'system:langgraph-runtime',
      actorType: 'system',
      idempotencyKey: event.idempotencyKey,
      correlationId: event.threadId,
      source: 'langgraph-runtime',
      payload: {
        graph_version: 'factory-v1',
        factory_run_id: event.run.factoryRunId,
        node: event.node,
        attempt: event.attempt,
        ...(event.outcome ? { outcome: event.outcome } : {}),
        ...(event.delegation ? { delegation: event.delegation } : {}),
      },
    });
    return { event: ledgerEvent || canonicalAudit.event, duplicate: !ledgerEvent, canonicalAudit };
  };
}

function createCanonicalLifecycleServices({ store, handlers }) {
  const operations = assertHandlers(handlers);
  return assertProductionLifecycleServices({
    ...operations,
    runs: { resolve: createCanonicalRunResolver(store) },
    audit: { record: createCanonicalLifecycleAudit(store) },
  });
}

module.exports = {
  assertHandlers,
  createCanonicalLifecycleAudit,
  createCanonicalLifecycleServices,
  createCanonicalRunResolver,
};
