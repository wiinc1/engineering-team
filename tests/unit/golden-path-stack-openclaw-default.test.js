const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../../scripts/dev-golden-path/stack');
const { DEFAULTS } = require('../../scripts/dev-golden-path/constants');

test('golden-path stack defaults prefer live OpenClaw not mock', () => {
  assert.match(DEFAULTS.openclawLiveUrl, /18789/);
  assert.equal(DEFAULTS.openclawPort, 14001);

  const defaults = parseArgs(['node', 'stack.js', 'up']);
  assert.equal(defaults.useOpenclawMock, false);
  assert.equal(defaults.skipMocks, false);

  const mock = parseArgs(['node', 'stack.js', 'up', '--use-openclaw-mock']);
  assert.equal(mock.useOpenclawMock, true);

  const explicit = parseArgs(['node', 'stack.js', 'up', '--openclaw-url', 'http://127.0.0.1:18789']);
  assert.equal(explicit.externalOpenclaw, 'http://127.0.0.1:18789');
});
