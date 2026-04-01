const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditStore } = require('../../lib/audit');

function makePool() {
  const events = [];
  return {
    async findEventByIdempotencyKey(tenantId, key) {
      return events.find(event => event.tenant_id === tenantId && event.idempotency_key === key) || null;
    },
    async nextSequenceNumber(tenantId, taskId) {
      return events.filter(event => event.tenant_id === tenantId && event.task_id === taskId).length + 1;
    },
    async insertEvent(event) {
      events.push(event);
    },
    async getTaskHistory(taskId, filters = {}) {
      return events.filter(event => event.task_id === taskId && (!filters.tenantId || event.tenant_id === filters.tenantId));
    },
    async getTaskCurrentState(taskId, filters = {}) {
      const taskEvents = events.filter(event => event.task_id === taskId && (!filters.tenantId || event.tenant_id === filters.tenantId));
      return taskEvents.length ? { task_id: taskId, tenant_id: taskEvents[0].tenant_id, last_event_id: taskEvents.at(-1).event_id } : null;
    },
    async getTaskRelationships() { return { child_task_ids: [], escalations: [], decisions: [] }; },
    async getTaskObservabilitySummary(taskId, filters = {}) {
      const taskEvents = await this.getTaskHistory(taskId, filters);
      return { task_id: taskId, event_count: taskEvents.length };
    },
    async rebuildProjections() { return { rebuiltEvents: events.length, rebuiltTasks: new Set(events.map(event => event.task_id)).size }; },
  };
}

test('postgres-backed store supports idempotent append semantics through injected pool', async () => {
  const pool = makePool();
  const store = createAuditStore({ backend: 'postgres', pool });

  const first = await store.appendEvent({
    taskId: 'TSK-500',
    tenantId: 'tenant-pg',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-500',
    payload: { title: 'Postgres task', initial_stage: 'BACKLOG' },
  });
  const duplicate = await store.appendEvent({
    taskId: 'TSK-500',
    tenantId: 'tenant-pg',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-500',
    payload: { title: 'Postgres task', initial_stage: 'BACKLOG' },
  });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);

  const history = await store.getTaskHistory('TSK-500', { tenantId: 'tenant-pg' });
  assert.equal(history.length, 1);
  assert.equal(history[0].sequence_number, 1);
});

test('postgres-backed store scopes idempotency by tenant through injected pool', async () => {
  const pool = makePool();
  const store = createAuditStore({ backend: 'postgres', pool });

  const first = await store.appendEvent({
    taskId: 'TSK-501',
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-501',
    payload: { title: 'Tenant A', initial_stage: 'BACKLOG' },
  });
  const second = await store.appendEvent({
    taskId: 'TSK-501',
    tenantId: 'tenant-b',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-501',
    payload: { title: 'Tenant B', initial_stage: 'BACKLOG' },
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.notEqual(first.event.event_id, second.event.event_id);
});
