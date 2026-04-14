const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkflowEngine, WorkflowError, STAGES } = require('../../lib/audit/workflow');

test('workflow engine accepts lifecycle ui transitions for verify and reopen loops', () => {
  const engine = new WorkflowEngine();

  assert.doesNotThrow(() => engine.validateTransition(STAGES.BACKLOG, STAGES.TODO));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.TODO, STAGES.BACKLOG));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.IN_PROGRESS, STAGES.TODO));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.IN_PROGRESS, STAGES.VERIFY));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.VERIFY, STAGES.DONE));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.VERIFY, STAGES.REOPEN));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.REOPEN, STAGES.TODO));
  assert.doesNotThrow(() => engine.validateTransition(STAGES.REOPEN, STAGES.IN_PROGRESS));
});

test('workflow engine still rejects unsupported lifecycle ui transitions', () => {
  const engine = new WorkflowEngine();

  assert.throws(() => engine.validateTransition(STAGES.BACKLOG, STAGES.VERIFY), WorkflowError);
  assert.throws(() => engine.validateTransition(STAGES.DONE, STAGES.TODO), WorkflowError);
});
