const test = require('node:test');
const assert = require('node:assert/strict');

const modulePromise = import('../../src/features/task-detail/next-action.mjs');

test('contract: client next-action derivation does not require new server fields', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const model = {
    summary: {
      taskId: 'TSK-153',
      title: 'Derived next action',
      currentStage: 'QA_TESTING',
      currentOwner: 'qa',
      nextRequiredAction: 'QA verification required',
      freshness: { status: 'fresh', last_updated_at: '2026-05-15T10:00:00.000Z' },
    },
    detail: {
      task: { id: 'TSK-153', title: 'Derived next action', priority: 'P1', stage: 'QA_TESTING', status: 'active' },
      summary: {
        owner: { id: 'qa', label: 'QA Engineer' },
        blockedState: { isBlocked: false, waitingOn: null },
        timers: { freshness: 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' },
      },
      context: { qaResults: { summary: { total: 0 } } },
      meta: { freshness: { status: 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' }, permissions: {} },
    },
  };

  const result = resolveTaskDetailNextAction(model, { roles: ['qa'] });
  assert.equal(result.action, 'qa_verification');
  assert.equal(result.primaryHref, '#task-detail-qa-section');
});

test('contract: server-provided summary nextAction remains backwards-compatible input', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const result = resolveTaskDetailNextAction(
    {
      summary: { taskId: 'TSK-153', currentStage: 'DRAFT', currentOwner: 'pm' },
      detail: {
        task: { id: 'TSK-153', title: 'Refine scope', priority: 'P1', stage: 'DRAFT', status: 'waiting' },
        summary: {
          owner: { id: 'pm', label: 'PM' },
          nextAction: { label: 'PM refinement required', source: 'server' },
          blockedState: { isBlocked: false, waitingOn: 'PM refinement' },
          timers: { freshness: 'fresh' },
        },
        context: { intakeDraft: true },
        meta: { permissions: {}, freshness: { status: 'fresh' } },
      },
    },
    { roles: ['pm'] },
  );

  assert.equal(result.action, 'pm_refinement');
  assert.match(result.reason, /PM refinement/i);
});
