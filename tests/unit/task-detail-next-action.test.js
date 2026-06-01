const test = require('node:test');
const assert = require('node:assert/strict');

const modulePromise = import('../../src/features/task-detail/next-action.mjs');

function screen(overrides = {}) {
  const stage = overrides.stage || 'IMPLEMENTATION';
  const status = overrides.status || 'active';
  const ownerId = overrides.owner === null ? null : overrides.ownerId || 'engineer';
  return {
    route: { taskId: overrides.taskId || 'TSK-153' },
    summary: {
      taskId: overrides.taskId || 'TSK-153',
      title: overrides.title || 'Role-specific next action',
      currentStage: stage,
      currentOwner: ownerId,
      nextRequiredAction: overrides.nextRequiredAction || null,
      freshness: { status: overrides.freshness || 'fresh', last_updated_at: '2026-05-15T10:00:00.000Z' },
      blocked: Boolean(overrides.blocked),
      closed: status === 'done',
      waitingState: overrides.waitingState || null,
    },
    detail: {
      task: { id: overrides.taskId || 'TSK-153', title: overrides.title || 'Role-specific next action', priority: 'P1', stage, status },
      summary: {
        owner: overrides.owner === null ? null : { id: ownerId, label: overrides.ownerLabel || 'Engineer' },
        nextAction: overrides.nextAction === null ? null : { label: overrides.nextAction || overrides.nextRequiredAction || 'Ship the next workflow step' },
        blockedState: { isBlocked: Boolean(overrides.blocked), waitingOn: overrides.waitingOn || overrides.waitingState || null },
        timers: { queueAgeLabel: '5m', freshness: overrides.freshness || 'fresh' },
      },
      context: {
        intakeDraft: Boolean(overrides.intakeDraft),
        closeGovernance: overrides.closeGovernance || null,
        executionContract: overrides.executionContract || null,
        sreMonitoring: overrides.monitoring || null,
      },
      blockers: overrides.blocked ? [{ id: 'blk-1', label: overrides.waitingOn || 'External blocker' }] : [],
      meta: {
        permissions: overrides.permissions || {},
        freshness: { status: overrides.freshness || 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' },
      },
    },
  };
}

function principal(...roles) {
  return { sub: 'actor-1', tenant_id: 'tenant-a', roles };
}

test('next-action resolver prioritizes PM refinement for intake drafts', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const result = resolveTaskDetailNextAction(
    screen({ stage: 'DRAFT', intakeDraft: true, nextAction: 'PM refinement required' }),
    principal('pm', 'reader'),
  );
  assert.equal(result.action, 'pm_refinement');
  assert.equal(result.role, 'pm');
  assert.equal(result.primaryHref, '#task-detail-overview-section');
  assert.match(result.reason, /PM refinement/i);
  assert.equal(result.statusFacts.find((fact) => fact.label === 'PM refinement').value, 'Requested/pending');
});

test('next-action resolver distinguishes active and completed PM refinement', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const inProgress = resolveTaskDetailNextAction(
    screen({ stage: 'DRAFT', intakeDraft: true, executionContract: { active: true, latest: { version: 1 } } }),
    principal('pm', 'reader'),
  );
  const complete = resolveTaskDetailNextAction(
    screen({
      stage: 'DRAFT',
      intakeDraft: true,
      executionContract: { latest: { version: 1, status: 'approved' }, approval: { approvedAt: '2026-05-15T10:00:00.000Z' } },
    }),
    principal('pm', 'reader'),
  );
  assert.equal(inProgress.statusFacts.find((fact) => fact.label === 'PM refinement').value, 'In progress');
  assert.equal(complete.statusFacts.find((fact) => fact.label === 'PM refinement').value, 'Complete');
});

test('next-action resolver routes unassigned PM work to assignment controls', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const result = resolveTaskDetailNextAction(screen({ owner: null, ownerId: null, stage: 'BACKLOG' }), principal('pm'));
  assert.equal(result.action, 'pm_assignment');
  assert.equal(result.primaryLabel, 'Assign owner');
  assert.equal(result.primaryHref, '#task-detail-assignment-panel');
});

test('next-action resolver prioritizes QA verification with evidence requirements', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const result = resolveTaskDetailNextAction(
    screen({ stage: 'QA_TESTING', ownerId: 'qa', ownerLabel: 'QA Engineer', nextAction: 'QA verification required' }),
    principal('qa', 'reader'),
  );
  assert.equal(result.action, 'qa_verification');
  assert.equal(result.primaryLabel, 'Submit QA result');
  assert.ok(result.evidence.includes('Outcome'));
});

test('next-action resolver prioritizes SRE monitoring state and expiry context', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const result = resolveTaskDetailNextAction(
    screen({
      stage: 'SRE_MONITORING',
      nextAction: 'SRE monitoring validation is required.',
      monitoring: { state: 'active', canApprove: true, timeRemainingLabel: '47h remaining' },
    }),
    principal('sre', 'reader'),
  );
  assert.equal(result.action, 'sre_monitoring');
  assert.equal(result.primaryLabel, 'Approve monitoring');
  assert.deepEqual(result.statusFacts.at(-1), { label: 'Expiry', value: '47h remaining' });
});

test('next-action resolver hides edit controls for reader-only sessions', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const result = resolveTaskDetailNextAction(
    screen({ blocked: true, waitingOn: 'PR merge', nextAction: 'PM decision required' }),
    principal('reader'),
  );
  assert.equal(result.action, 'read_only_status');
  assert.equal(result.controlsAvailable, false);
  assert.equal(result.primaryHref, null);
  assert.match(result.reason, /PR merge|PM decision/);
});

test('next-action resolver handles architect, engineer, and human action paths', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  assert.equal(resolveTaskDetailNextAction(screen({ stage: 'ARCHITECT_REVIEW' }), principal('architect')).action, 'architect_handoff');
  assert.equal(resolveTaskDetailNextAction(screen({ stage: 'IMPLEMENTATION' }), principal('engineer')).action, 'engineer_implementation_handoff');
  assert.equal(
    resolveTaskDetailNextAction(
      screen({ closeGovernance: { humanDecision: { required: true, summary: 'Human close decision required.' } } }),
      principal('stakeholder'),
    ).action,
    'human_decision',
  );
});

test('next-action resolver keeps passive done and stale states visible', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const done = resolveTaskDetailNextAction(screen({ status: 'done', stage: 'DONE', nextAction: null }), principal('pm'));
  const stale = resolveTaskDetailNextAction(screen({ stage: 'DONE', nextAction: null, freshness: 'stale' }), principal('reader'));
  assert.equal(done.action, 'done_passive_review');
  assert.equal(done.tone, 'success');
  assert.equal(stale.controlsAvailable, false);
  assert.equal(stale.tone, 'warning');
});

test('next-action feature flag parser supports runtime rollback values', async () => {
  const { isTaskDetailNextActionRedesignEnabled } = await modulePromise;
  assert.equal(isTaskDetailNextActionRedesignEnabled({ ff_task_detail_next_action_redesign: '0' }), false);
  assert.equal(isTaskDetailNextActionRedesignEnabled({ ffTaskDetailNextActionRedesign: 'enabled' }), true);
});
