const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('task-detail barrel points browser consumers at the browser-safe adapter entry', () => {
  const barrelPath = path.join(__dirname, '../../src/features/task-detail/index.ts');
  const source = fs.readFileSync(barrelPath, 'utf8');

  assert.match(source, /export \* from '\.\/adapter\.browser';/);
  assert.doesNotMatch(source, /export \* from '\.\/adapter';/);
});
