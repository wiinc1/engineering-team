const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveGoldenPathStackPersistDir } = require('../../lib/task-platform/golden-path-phases');

test('resolveGoldenPathStackPersistDir prefers explicit stackPersistDir', () => {
  const resolved = resolveGoldenPathStackPersistDir(
    { persistDir: null },
    { phase0: { persistDir: 'observability/factory-delivery/stack/queue-1' } },
    { stackPersistDir: 'observability/custom-stack' },
  );
  assert.equal(resolved, path.resolve(process.cwd(), 'observability/custom-stack'));
});

test('resolveGoldenPathStackPersistDir falls back to phase0 persistDir when projection persistDir is null', () => {
  const resolved = resolveGoldenPathStackPersistDir(
    { persistDir: null },
    { phase0: { persistDir: 'observability/factory-delivery/stack/factory-abc' } },
    { persistDir: null },
  );
  assert.equal(resolved, path.resolve(process.cwd(), 'observability/factory-delivery/stack/factory-abc'));
});

test('resolveGoldenPathStackPersistDir derives factory queue stack path from evidence', () => {
  const resolved = resolveGoldenPathStackPersistDir(
    {},
    { factoryQueueId: 'factory-mqtest-123456' },
    {},
  );
  assert.equal(
    resolved,
    path.resolve(process.cwd(), 'observability/factory-delivery/stack/factory-mqtest-123456'),
  );
});

test('resolveGoldenPathStackPersistDir always returns an absolute path', () => {
  const resolved = resolveGoldenPathStackPersistDir({}, {}, {});
  assert.ok(path.isAbsolute(resolved));
});