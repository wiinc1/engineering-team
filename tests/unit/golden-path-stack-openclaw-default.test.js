const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, resolveUpstreamUrls } = require('../../scripts/dev-golden-path/stack');
const { DEFAULTS } = require('../../scripts/dev-golden-path/constants');
const { defaultOpenclawUrl } = require('../../lib/task-platform/factory-stack/defaults');

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

test('resolveUpstreamUrls defaults to live gateway without mock flag (GitLab #271)', async () => {
  const options = parseArgs(['node', 'stack.js', 'up', '--skip-mocks']);
  // Force no external override so live default is used.
  options.externalOpenclaw = '';
  options.externalHermes = 'http://127.0.0.1:14002';
  options.useOpenclawMock = false;
  options.skipMocks = true;
  const resolved = await resolveUpstreamUrls(options);
  assert.match(resolved.openclawUrl, /18789/);
  assert.equal(resolved.mockServers.length, 0);
});

test('factory-stack service env defaults to live OpenClaw', () => {
  assert.match(defaultOpenclawUrl(), /18789/);
});
