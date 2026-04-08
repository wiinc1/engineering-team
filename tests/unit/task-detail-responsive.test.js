const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appStyles = fs.readFileSync(path.join(__dirname, '../../src/app/styles.css'), 'utf8');
const shellStyles = fs.readFileSync(path.join(__dirname, '../../src/features/task-detail/TaskDetailActivityShell.module.css'), 'utf8');

test('task detail above-the-fold summary keeps tablet-specific responsive rules', () => {
  assert.match(appStyles, /@media \(max-width: 960px\)/);
  assert.match(appStyles, /\.task-detail-hero__title/);
  assert.match(appStyles, /\.summary-grid--hero/);
  assert.match(appStyles, /@media \(max-width: 800px\)[\s\S]*\.detail-sections\s*\{/);
});

test('task activity navigation keeps tablet and mobile responsive rules', () => {
  assert.match(shellStyles, /@media \(max-width: 960px\)/);
  assert.match(shellStyles, /\.tabs\s*\{[\s\S]*justify-content: space-between;/);
  assert.match(shellStyles, /@media \(max-width: 640px\)/);
  assert.match(shellStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
