const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTaskCreatePayload,
  VALID_PRIORITIES,
  VALID_TASK_TYPES,
  VALID_STAGES,
} = require('../../src/features/task-creation/schema');

test('validateTaskCreatePayload returns valid for correct payload', () => {
  const payload = {
    title: 'Implement login flow',
    business_context: 'Users need to authenticate before accessing the dashboard',
    acceptance_criteria: 'Given a user visits the login page, when they enter valid credentials, then they are redirected to the dashboard',
    definition_of_done: 'Login page implemented, unit tests passing, E2E tests passing',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateTaskCreatePayload returns valid for raw intake requirements only', () => {
  const result = validateTaskCreatePayload({
    raw_requirements: 'Operator pasted unrefined requirements.',
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateTaskCreatePayload allows optional intake title', () => {
  const result = validateTaskCreatePayload({
    raw_requirements: 'Operator pasted unrefined requirements.',
    title: 'Optional intake title',
  });

  assert.equal(result.valid, true);
});

test('validateTaskCreatePayload rejects overlong intake title', () => {
  const result = validateTaskCreatePayload({
    raw_requirements: 'Operator pasted unrefined requirements.',
    title: 'x'.repeat(121),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('120 characters or fewer')));
});

test('validateTaskCreatePayload rejects blank raw intake requirements', () => {
  const result = validateTaskCreatePayload({
    raw_requirements: '   ',
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('raw_requirements')));
});

test('validateTaskCreatePayload rejects null payload', () => {
  const result = validateTaskCreatePayload(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some(e => e.includes('non-null object')));
});

test('validateTaskCreatePayload rejects non-object payload', () => {
  assert.equal(validateTaskCreatePayload('string').valid, false);
  assert.equal(validateTaskCreatePayload(123).valid, false);
  assert.equal(validateTaskCreatePayload(true).valid, false);
  assert.equal(validateTaskCreatePayload(undefined).valid, false);
});

test('validateTaskCreatePayload rejects missing title', () => {
  const payload = {
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('title')));
});

test('validateTaskCreatePayload rejects empty title', () => {
  const payload = {
    title: '',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('title')));
});

test('validateTaskCreatePayload rejects whitespace-only title', () => {
  const payload = {
    title: '   ',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('title')));
});

test('validateTaskCreatePayload rejects missing business_context', () => {
  const payload = {
    title: 'Task',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('business_context')));
});

test('validateTaskCreatePayload rejects missing acceptance_criteria', () => {
  const payload = {
    title: 'Task',
    business_context: 'context',
    definition_of_done: 'done',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('acceptance_criteria')));
});

test('validateTaskCreatePayload rejects missing definition_of_done', () => {
  const payload = {
    title: 'Task',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    priority: 'High',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('definition_of_done')));
});

test('validateTaskCreatePayload rejects invalid priority', () => {
  const payload = {
    title: 'Task',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'Urgent',
    task_type: 'Feature',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('priority')));
});

test('validateTaskCreatePayload rejects invalid task_type', () => {
  const payload = {
    title: 'Task',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'High',
    task_type: 'Improvement',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('task_type')));
});

test('validateTaskCreatePayload rejects multiple invalid fields', () => {
  const payload = {
    title: '',
    business_context: 'context',
    acceptance_criteria: 'criteria',
    definition_of_done: 'done',
    priority: 'Urgent',
    task_type: 'Improvement',
  };

  const result = validateTaskCreatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});

test('VALID_PRIORITIES contains expected values', () => {
  assert.deepEqual(VALID_PRIORITIES, ['Low', 'Medium', 'High', 'Critical']);
});

test('VALID_TASK_TYPES contains expected values', () => {
  assert.deepEqual(VALID_TASK_TYPES, ['Feature', 'Bug', 'Refactor', 'Debt', 'Docs']);
});

test('VALID_STAGES contains expected values', () => {
  assert.deepEqual(VALID_STAGES, ['DRAFT', 'BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
});

test('validateTaskCreatePayload accepts all valid priorities', () => {
  for (const priority of VALID_PRIORITIES) {
    const payload = {
      title: 'Task',
      business_context: 'context',
      acceptance_criteria: 'criteria',
      definition_of_done: 'done',
      priority,
      task_type: 'Feature',
    };

    const result = validateTaskCreatePayload(payload);
    assert.equal(result.valid, true, `Priority "${priority}" should be valid`);
  }
});

test('validateTaskCreatePayload accepts all valid task types', () => {
  for (const taskType of VALID_TASK_TYPES) {
    const payload = {
      title: 'Task',
      business_context: 'context',
      acceptance_criteria: 'criteria',
      definition_of_done: 'done',
      priority: 'High',
      task_type: taskType,
    };

    const result = validateTaskCreatePayload(payload);
    assert.equal(result.valid, true, `Task type "${taskType}" should be valid`);
  }
});
