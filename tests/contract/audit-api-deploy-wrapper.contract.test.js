const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('authenticated browser API contract documents deploy bootstrap wrapper behavior', () => {
  const spec = fs.readFileSync(
    path.join(__dirname, '../../docs/api/authenticated-browser-app-openapi.yml'),
    'utf8'
  );

  assert.match(spec, /Vercel API entrypoints await deploy auth bootstrap/);
  assert.match(spec, /bootstrap failures fail closed/);
});
