const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateTaskId,
  parseTaskId,
  isValidTaskId,
  TASK_ID_PREFIX,
  TASK_ID_SEQUENCE_MIN,
  TASK_ID_SEQUENCE_MAX,
  TASK_ID_PATTERN,
} = require('../../src/features/task-creation/types');

test('generateTaskId creates valid task IDs', () => {
  assert.equal(generateTaskId(1), 'TSK-001');
  assert.equal(generateTaskId(42), 'TSK-042');
  assert.equal(generateTaskId(100), 'TSK-100');
  assert.equal(generateTaskId(999), 'TSK-999');
  assert.equal(generateTaskId(1000), 'TSK-1000');
  assert.equal(generateTaskId(99999), 'TSK-99999');
});

test('generateTaskId uses correct prefix', () => {
  const id = generateTaskId(1);
  assert.ok(id.startsWith(TASK_ID_PREFIX + '-'));
});

test('generateTaskId throws for sequence below minimum', () => {
  assert.throws(
    () => generateTaskId(0),
    (err) => {
      assert.ok(err instanceof RangeError);
      assert.ok(err.message.includes('between'));
      return true;
    }
  );
});

test('generateTaskId throws for negative sequence', () => {
  assert.throws(
    () => generateTaskId(-1),
    (err) => {
      assert.ok(err instanceof RangeError);
      return true;
    }
  );
});

test('generateTaskId throws for sequence above maximum', () => {
  assert.throws(
    () => generateTaskId(TASK_ID_SEQUENCE_MAX + 1),
    (err) => {
      assert.ok(err instanceof RangeError);
      return true;
    }
  );
});

test('generateTaskId throws for non-integer sequence', () => {
  assert.throws(() => generateTaskId(1.5), RangeError);
  assert.throws(() => generateTaskId(NaN), RangeError);
});

test('parseTaskId extracts sequence from valid task ID', () => {
  assert.equal(parseTaskId('TSK-001'), 1);
  assert.equal(parseTaskId('TSK-042'), 42);
  assert.equal(parseTaskId('TSK-100'), 100);
  assert.equal(parseTaskId('TSK-99999'), 99999);
});

test('parseTaskId returns null for invalid formats', () => {
  assert.equal(parseTaskId(''), null);
  assert.equal(parseTaskId('TSK'), null);
  assert.equal(parseTaskId('TSK-1'), null);
  assert.equal(parseTaskId('TSK-12'), null);
  assert.equal(parseTaskId('TASK-001'), null);
  assert.equal(parseTaskId('001'), null);
  assert.equal(parseTaskId(null), null);
  assert.equal(parseTaskId(undefined), null);
  assert.equal(parseTaskId(123), null);
});

test('isValidTaskId returns true for valid IDs', () => {
  assert.equal(isValidTaskId('TSK-001'), true);
  assert.equal(isValidTaskId('TSK-042'), true);
  assert.equal(isValidTaskId('TSK-999'), true);
  assert.equal(isValidTaskId('TSK-1000'), true);
  assert.equal(isValidTaskId('TSK-99999'), true);
});

test('isValidTaskId returns false for invalid IDs', () => {
  assert.equal(isValidTaskId(''), false);
  assert.equal(isValidTaskId('TSK'), false);
  assert.equal(isValidTaskId('TSK-1'), false);
  assert.equal(isValidTaskId('TSK-12'), false);
  assert.equal(isValidTaskId('TASK-001'), false);
  assert.equal(isValidTaskId('not-an-id'), false);
});

test('TASK_ID_PATTERN matches expected formats', () => {
  assert.ok(TASK_ID_PATTERN.test('TSK-001'));
  assert.ok(TASK_ID_PATTERN.test('TSK-999'));
  assert.ok(TASK_ID_PATTERN.test('TSK-1000'));
  assert.ok(TASK_ID_PATTERN.test('TSK-99999'));
  assert.ok(!TASK_ID_PATTERN.test('TSK-1'));
  assert.ok(!TASK_ID_PATTERN.test('TSK-12'));
  assert.ok(!TASK_ID_PATTERN.test('TASK-001'));
});

test('constants are exported correctly', () => {
  assert.equal(TASK_ID_PREFIX, 'TSK');
  assert.equal(TASK_ID_SEQUENCE_MIN, 1);
  assert.equal(TASK_ID_SEQUENCE_MAX, 99999);
});
