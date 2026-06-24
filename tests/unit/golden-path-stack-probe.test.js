const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readGoldenPathStackState,
  resolveGoldenPathForgeAdapterUrl,
  resolveGoldenPathForgeAdapterToken,
  probeForgeAdapterHealth,
} = require('../../lib/task-platform/golden-path-stack-probe');

test('resolveGoldenPathForgeAdapterUrl prefers explicit option then env', () => {
  const previous = process.env.FORGEADAPTER_BASE_URL;
  process.env.FORGEADAPTER_BASE_URL = 'http://127.0.0.1:14010/';
  try {
    assert.equal(resolveGoldenPathForgeAdapterUrl({ forgeAdapterBaseUrl: 'http://custom/' }), 'http://custom');
    assert.equal(resolveGoldenPathForgeAdapterUrl({}), 'http://127.0.0.1:14010');
  } finally {
    if (previous == null) delete process.env.FORGEADAPTER_BASE_URL;
    else process.env.FORGEADAPTER_BASE_URL = previous;
  }
});

test('readGoldenPathStackState reads stack.json services', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-stack-'));
  const stateFile = path.join(dir, 'stack.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    services: {
      forgeadapter: { url: 'http://127.0.0.1:14010', token: 'stack-token' },
    },
  }));
  const state = readGoldenPathStackState(stateFile);
  assert.equal(resolveGoldenPathForgeAdapterUrl({ stackStateFile: stateFile }), 'http://127.0.0.1:14010');
  assert.equal(resolveGoldenPathForgeAdapterToken({ stackStateFile: stateFile }), 'stack-token');
  assert.equal(state.services.forgeadapter.token, 'stack-token');
});

test('probeForgeAdapterHealth reports ready endpoint status', async () => {
  const fetchImpl = async (url) => ({
    ok: url.endsWith('/ready'),
    status: url.endsWith('/ready') ? 200 : 404,
  });
  const healthy = await probeForgeAdapterHealth('http://forge.local', fetchImpl);
  assert.equal(healthy.ok, true);
  assert.equal(healthy.status, 200);

  const missing = await probeForgeAdapterHealth('', fetchImpl);
  assert.equal(missing.skipped, true);
  assert.equal(missing.reason, 'no_forgeadapter_url');
});