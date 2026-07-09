const test = require('node:test');
const assert = require('node:assert/strict');

const { LIFECYCLE_STAGES, VALID_LIFECYCLE_MAP, LifecycleStageGuard, LifecycleTransitionError, StageTransitionRecorder, METRICS, LIFECYCLE_TO_WORKFLOW } = require('../../lib/audit/lifecycle-enforcement');
const { VALID_STAGES } = require('../../src/features/task-creation/schema');

test('VALID_STAGES contains all 7 lifecycle stages', () => {
  assert.equal(VALID_STAGES.length, 7);
  assert.ok(VALID_STAGES.includes('INTAKE_DRAFT'));
  assert.ok(VALID_STAGES.includes('TASK_REFINEMENT'));
  assert.ok(VALID_STAGES.includes('OPERATOR_APPROVAL'));
  assert.ok(VALID_STAGES.includes('IMPLEMENTATION'));
  assert.ok(VALID_STAGES.includes('QA_VERIFICATION'));
  assert.ok(VALID_STAGES.includes('SRE_VERIFICATION'));
  assert.ok(VALID_STAGES.includes('CLOSEOUT'));
});

test('VALID_LIFECYCLE_MAP has correct numeric order', () => {
  assert.equal(VALID_LIFECYCLE_MAP.INTAKE_DRAFT, 0);
  assert.equal(VALID_LIFECYCLE_MAP.TASK_REFINEMENT, 1);
  assert.equal(VALID_LIFECYCLE_MAP.OPERATOR_APPROVAL, 2);
  assert.equal(VALID_LIFECYCLE_MAP.IMPLEMENTATION, 3);
  assert.equal(VALID_LIFECYCLE_MAP.QA_VERIFICATION, 4);
  assert.equal(VALID_LIFECYCLE_MAP.SRE_VERIFICATION, 5);
  assert.equal(VALID_LIFECYCLE_MAP.CLOSEOUT, 6);
});

test('LIFECYCLE_STAGES array has correct order', () => {
  assert.deepEqual(LIFECYCLE_STAGES, [
    'INTAKE_DRAFT',
    'TASK_REFINEMENT',
    'OPERATOR_APPROVAL',
    'IMPLEMENTATION',
    'QA_VERIFICATION',
    'SRE_VERIFICATION',
    'CLOSEOUT',
  ]);
});

test('LifecycleStageGuard allows sequential transitions', () => {
  const guard = new LifecycleStageGuard();

  assert.doesNotThrow(() => guard.validateTransition('INTAKE_DRAFT', 'TASK_REFINEMENT'));
  assert.doesNotThrow(() => guard.validateTransition('TASK_REFINEMENT', 'OPERATOR_APPROVAL'));
  assert.doesNotThrow(() => guard.validateTransition('OPERATOR_APPROVAL', 'IMPLEMENTATION'));
  assert.doesNotThrow(() => guard.validateTransition('IMPLEMENTATION', 'QA_VERIFICATION'));
  assert.doesNotThrow(() => guard.validateTransition('QA_VERIFICATION', 'SRE_VERIFICATION'));
  assert.doesNotThrow(() => guard.validateTransition('SRE_VERIFICATION', 'CLOSEOUT'));
});

test('LifecycleStageGuard blocks skip from INTAKE_DRAFT to OPERATOR_APPROVAL', () => {
  const guard = new LifecycleStageGuard();
  let err;
  try {
    guard.validateTransition('INTAKE_DRAFT', 'OPERATOR_APPROVAL');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof LifecycleTransitionError);
  assert.equal(err.code, 'INVALID_STAGE_TRANSITION');
  assert.equal(err.statusCode, 409);
  assert.deepEqual(err.allowedStages, ['TASK_REFINEMENT']);
});

test('LifecycleStageGuard blocks skip from INTAKE_DRAFT to IMPLEMENTATION', () => {
  const guard = new LifecycleStageGuard();
  let err;
  try {
    guard.validateTransition('INTAKE_DRAFT', 'IMPLEMENTATION');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof LifecycleTransitionError);
  assert.equal(err.code, 'INVALID_STAGE_TRANSITION');
  assert.equal(err.statusCode, 409);
  assert.ok(!err.allowedStages.includes('IMPLEMENTATION'));
});

test('LifecycleStageGuard blocks skip from IMPLEMENTATION to SRE_VERIFICATION', () => {
  const guard = new LifecycleStageGuard();
  let err;
  try {
    guard.validateTransition('IMPLEMENTATION', 'SRE_VERIFICATION');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof LifecycleTransitionError);
  assert.equal(err.code, 'INVALID_STAGE_TRANSITION');
  assert.equal(err.statusCode, 409);
  assert.deepEqual(err.allowedTransitions || err.allowedStages, ['QA_VERIFICATION']);
});

test('LifecycleStageGuard blocks transition from CLOSEOUT', () => {
  const guard = new LifecycleStageGuard();
  let err;
  try {
    guard.validateTransition('CLOSEOUT', 'INTAKE_DRAFT');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof LifecycleTransitionError);
  assert.equal(err.code, 'TASK_ALREADY_CLOSED');
});

test('LifecycleStageGuard allows same stage (no-op)', () => {
  const guard = new LifecycleStageGuard();
  assert.doesNotThrow(() => guard.validateTransition('INTAKE_DRAFT', 'INTAKE_DRAFT'));
  assert.doesNotThrow(() => guard.validateTransition('CLOSEOUT', 'CLOSEOUT'));
});

test('LifecycleStageGuard rejects invalid stage names', () => {
  const guard = new LifecycleStageGuard();
  let err;
  try {
    guard.validateTransition('INVALID_STAGE', 'TASK_REFINEMENT');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof LifecycleTransitionError);
  assert.equal(err.code, 'INVALID_STAGE');
});

test('LifecycleStageGuard.getAllowedTransitions returns correct stages', () => {
  const guard = new LifecycleStageGuard();
  assert.deepEqual(guard.getAllowedTransitions('INTAKE_DRAFT'), ['TASK_REFINEMENT']);
  assert.deepEqual(guard.getAllowedTransitions('IMPLEMENTATION'), ['QA_VERIFICATION']);
  assert.deepEqual(guard.getAllowedTransitions('CLOSEOUT'), []);
});

test('LifecycleStageGuard.getStages returns all 7 stages', () => {
  const guard = new LifecycleStageGuard();
  assert.deepEqual(guard.getStages(), LIFECYCLE_STAGES);
});

test('LifecycleStageGuard.toWorkflowStage maps correctly', () => {
  const guard = new LifecycleStageGuard();
  assert.equal(guard.toWorkflowStage('INTAKE_DRAFT'), 'DRAFT');
  assert.equal(guard.toWorkflowStage('TASK_REFINEMENT'), 'BACKLOG');
  assert.equal(guard.toWorkflowStage('OPERATOR_APPROVAL'), 'TODO');
  assert.equal(guard.toWorkflowStage('IMPLEMENTATION'), 'IMPLEMENTATION');
  assert.equal(guard.toWorkflowStage('QA_VERIFICATION'), 'QA_TESTING');
  assert.equal(guard.toWorkflowStage('SRE_VERIFICATION'), 'SRE_MONITORING');
  assert.equal(guard.toWorkflowStage('CLOSEOUT'), 'DONE');
});

test('LifecycleStageGuard.fromWorkflowStage maps correctly', () => {
  const guard = new LifecycleStageGuard();
  assert.equal(guard.fromWorkflowStage('DRAFT'), 'INTAKE_DRAFT');
  assert.equal(guard.fromWorkflowStage('BACKLOG'), 'TASK_REFINEMENT');
  assert.equal(guard.fromWorkflowStage('TODO'), 'OPERATOR_APPROVAL');
  assert.equal(guard.fromWorkflowStage('IMPLEMENTATION'), 'IMPLEMENTATION');
  assert.equal(guard.fromWorkflowStage('QA_TESTING'), 'QA_VERIFICATION');
  assert.equal(guard.fromWorkflowStage('SRE_MONITORING'), 'SRE_VERIFICATION');
  assert.equal(guard.fromWorkflowStage('DONE'), 'CLOSEOUT');
  assert.equal(guard.fromWorkflowStage('UNKNOWN'), null);
});

test('LifecycleTransitionError has correct properties', () => {
  const err = new LifecycleTransitionError('Test error', 'INVALID_STAGE_TRANSITION', ['STAGE_A']);
  assert.equal(err.name, 'LifecycleTransitionError');
  assert.equal(err.code, 'INVALID_STAGE_TRANSITION');
  assert.equal(err.statusCode, 409);
  assert.deepEqual(err.allowedStages, ['STAGE_A']);
});

test('METRICS records transitions and tracks error rates', () => {
  METRICS.clear();
  METRICS.recordTransition('TSK-1', 'INTAKE_DRAFT', 'TASK_REFINEMENT', 'allowed');
  METRICS.recordTransition('TSK-1', 'TASK_REFINEMENT', 'OPERATOR_APPROVAL', 'blocked');

  const key = 'TSK-1:TASK_REFINEMENT->OPERATOR_APPROVAL';
  assert.ok(METRICS.lifecycle_stage_transitions_total[key]);
  assert.equal(METRICS.lifecycle_stage_transitions_total[key].total, 1);
});

test('METRICS.getTransitionErrorRate returns correct ratio', () => {
  METRICS.clear();

  for (let i = 0; i < 10; i++) {
    METRICS.recordTransition(`TSK-ERR-${i}`, 'A', 'B', 'blocked');
  }
  for (let i = 0; i < 10; i++) {
    METRICS.recordTransition(`TSK-OK-${i}`, 'A', 'B', 'allowed');
  }

  const rate = METRICS.getTransitionErrorRate();
  assert.equal(rate, 0.5);
});

test('METRICS.clear resets all metrics', () => {
  METRICS.clear();
  METRICS.recordTransition('TSK-1', 'A', 'B', 'allowed');
  METRICS.clear();
  assert.equal(Object.keys(METRICS.lifecycle_stage_transitions_total).length, 0);
});

test('StageTransitionRecorder records to store', async () => {
  let recorded = null;
  const store = {
    appendEvent: async (data) => {
      recorded = data;
      return { event_id: 'evt-1' };
    },
    getTaskHistory: () => [],
  };

  const recorder = new StageTransitionRecorder(store);
  await recorder.record('TSK-1', {
    from_stage: 'INTAKE_DRAFT',
    to_stage: 'TASK_REFINEMENT',
    result: 'allowed',
    actor_id: 'user-123',
    actor_type: 'user',
  });

  assert.ok(recorded);
  assert.equal(recorded.eventType, 'task.stage_transition');
  assert.equal(recorded.payload.from_stage, 'INTAKE_DRAFT');
  assert.equal(recorded.payload.to_stage, 'TASK_REFINEMENT');
});

test('StageTransitionRecorder gets transition history', async () => {
  const events = [
    { event_type: 'task.stage_transition', payload: { from_stage: 'A', to_stage: 'B' }, occurred_at: '2024-01-01T00:00:00Z' },
    { event_type: 'task.created', payload: {} },
    { event_type: 'task.stage_transition', payload: { from_stage: 'B', to_stage: 'C' }, occurred_at: '2024-01-02T00:00:00Z' },
  ];

  const store = { getTaskHistory: () => events };
  const recorder = new StageTransitionRecorder(store);
  const history = await recorder.getTaskTransitionHistory('TSK-1');

  assert.equal(history.length, 2);
  assert.equal(history[0].payload.from_stage, 'A');
  assert.equal(history[1].payload.to_stage, 'C');
});
