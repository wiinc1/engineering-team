const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createFileAuditStore } = require('../../lib/audit/store');
const { createExecutionContractDraft, REQUIRED_SECTIONS_BY_TIER } = require('../../lib/audit/execution-contracts');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-perf-'));
}

test('file-backed audit store stays within baseline append/query budgets', () => {
  const store = createFileAuditStore({ baseDir: makeTempDir(), projectionMode: 'sync' });
  const totalEvents = 250;

  const appendStart = performance.now();
  for (let index = 0; index < totalEvents; index += 1) {
    store.appendEvent({
      tenantId: 'tenant-perf',
      taskId: `TSK-PERF-${String(index % 25).padStart(3, '0')}`,
      eventType: index % 5 === 0 ? 'task.stage_changed' : 'task.comment_workflow_recorded',
      actorId: 'perf-runner',
      actorType: 'agent',
      idempotencyKey: `perf:${index}`,
      payload: index % 5 === 0
        ? { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' }
        : { comment_type: 'note', body: `event-${index}` },
    });
  }
  const appendDuration = performance.now() - appendStart;

  const historyStart = performance.now();
  const history = store.getTaskHistory('TSK-PERF-001', { tenantId: 'tenant-perf' });
  const historyDuration = performance.now() - historyStart;

  const stateStart = performance.now();
  const state = store.getTaskCurrentState('TSK-PERF-001', { tenantId: 'tenant-perf' });
  const stateDuration = performance.now() - stateStart;

  assert.equal(history.length > 0, true);
  assert.ok(state);
  assert.ok(appendDuration < 2500, `append budget exceeded: ${appendDuration}ms`);
  assert.ok(historyDuration < 150, `history query budget exceeded: ${historyDuration}ms`);
  assert.ok(stateDuration < 150, `state query budget exceeded: ${stateDuration}ms`);
});

test('async projection worker drains a bounded backlog within baseline budget', async () => {
  const store = createFileAuditStore({ baseDir: makeTempDir(), projectionMode: 'async' });
  const totalEvents = 150;

  for (let index = 0; index < totalEvents; index += 1) {
    store.appendEvent({
      tenantId: 'tenant-perf',
      taskId: 'TSK-PERF-ASYNC',
      eventType: index === 0 ? 'task.created' : 'task.comment_workflow_recorded',
      actorId: 'perf-runner',
      actorType: 'agent',
      idempotencyKey: `async:${index}`,
      payload: index === 0 ? { title: 'Async perf task', initial_stage: 'BACKLOG' } : { comment_type: 'note', body: `note-${index}` },
    });
  }

  const started = performance.now();
  const result = await store.processProjectionQueue(200);
  const duration = performance.now() - started;

  assert.equal(result.processed, totalEvents);
  assert.ok(duration < 2500, `projection queue budget exceeded: ${duration}ms`);
  assert.equal(store.getTaskHistory('TSK-PERF-ASYNC', { tenantId: 'tenant-perf' }).length, totalEvents);
});

test('close-review escalation and projection stay within baseline budget', () => {
  const store = createFileAuditStore({ baseDir: makeTempDir(), projectionMode: 'sync' });

  store.appendEvent({
    tenantId: 'tenant-perf',
    taskId: 'TSK-PERF-CLOSE',
    eventType: 'task.created',
    actorId: 'perf-runner',
    actorType: 'agent',
    idempotencyKey: 'perf-close:create',
    payload: { title: 'Perf close task', initial_stage: 'PM_CLOSE_REVIEW', acceptance_criteria: ['Keep close review governed.'] },
  });

  const started = performance.now();
  store.appendEvent({
    tenantId: 'tenant-perf',
    taskId: 'TSK-PERF-CLOSE',
    eventType: 'task.escalated',
    actorId: 'pm-1',
    actorType: 'user',
    idempotencyKey: 'perf-close:exceptional-dispute',
    payload: {
      reason: 'exceptional_dispute',
      severity: 'high',
      summary: 'PM disputes whether cancellation is safer than reopening implementation.',
      recommendation_summary: 'Human stakeholder should decide whether to cancel or reopen implementation.',
      rationale: 'The task can still ship if implementation resumes.',
      waiting_state: 'awaiting_human_stakeholder_escalation',
      next_required_action: 'Human stakeholder escalation required for exceptional dispute.',
    },
  });
  const appendDuration = performance.now() - started;

  const readStart = performance.now();
  const state = store.getTaskCurrentState('TSK-PERF-CLOSE', { tenantId: 'tenant-perf' });
  const history = store.getTaskHistory('TSK-PERF-CLOSE', { tenantId: 'tenant-perf' });
  const readDuration = performance.now() - readStart;

  assert.equal(state.waiting_state, 'awaiting_human_stakeholder_escalation');
  assert.equal(history.length, 2);
  assert.ok(appendDuration < 250, `close escalation append budget exceeded: ${appendDuration}ms`);
  assert.ok(readDuration < 150, `close escalation read budget exceeded: ${readDuration}ms`);
});

test('execution contract structured metadata versioning stays within baseline budget', () => {
  const sections = Object.fromEntries(REQUIRED_SECTIONS_BY_TIER.Complex.map((sectionId) => [
    sectionId,
    `Perf completed Complex section ${sectionId}.`,
  ]));
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-perf-contract',
    payload: {
      intake_draft: true,
      title: 'Metadata hash performance',
      raw_requirements: 'Version structured metadata changes without slowing contract saves.',
    },
  }];
  const summary = {
    task_id: 'TSK-PERF-CONTRACT',
    title: 'Metadata hash performance',
    intake_draft: true,
    operator_intake_requirements: 'Version structured metadata changes without slowing contract saves.',
  };

  const initial = createExecutionContractDraft({
    taskId: 'TSK-PERF-CONTRACT',
    summary,
    history,
    actorId: 'pm-perf',
    body: { templateTier: 'Complex', sections },
  });

  const started = performance.now();
  const updated = createExecutionContractDraft({
    taskId: 'TSK-PERF-CONTRACT',
    summary,
    history,
    actorId: 'pm-perf',
    previousContract: initial.contract,
    body: {
      templateTier: 'Complex',
      sections: {
        ...sections,
        6: {
          title: 'Architecture & Integration',
          body: 'Perf completed Complex section 6.',
          ownerRole: 'architect',
          contributor: 'architect-perf',
          approvalStatus: 'approved',
          payloadSchemaVersion: 2,
          payloadJson: {
            integration: {
              mode: 'approved',
              dependencies: Array.from({ length: 20 }, (_, index) => `dependency-${index}`),
            },
          },
          provenanceReferences: ['CONTEXT.md', 'docs/templates/USER_STORY_TEMPLATE.md'],
        },
      },
    },
  });
  const duration = performance.now() - started;

  assert.equal(updated.materialChange, true);
  assert.equal(updated.contract.version, 2);
  assert.ok(duration < 250, `execution contract metadata versioning budget exceeded: ${duration}ms`);
});
