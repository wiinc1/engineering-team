const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const GATE_FILES = [
  'tests/browser/browser-quality-fixtures.ts',
  'tests/browser/browser-quality-accessibility.browser.spec.ts',
  'tests/browser/browser-quality-performance.browser.spec.ts',
  'tests/browser/browser-quality-visual.browser.spec.ts',
];

test('browser verification fixtures do not embed production secrets or credentials', () => {
  const source = GATE_FILES
    .map((filePath) => fs.readFileSync(path.join(ROOT, filePath), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /DATABASE_URL/i);
  assert.doesNotMatch(source, /RESEND_API_KEY/i);
  assert.doesNotMatch(source, /AUTH_SESSION_SECRET/i);
  assert.doesNotMatch(source, /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(source, /Bearer\s+[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.match(source, /apiBaseUrl: '\/api'/);
  assert.match(source, /idp\.example/);
});
