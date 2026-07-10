const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlist } = require('../../lib/task-platform/factory-stack/launchd');
const { buildServiceEnv, DEFAULT_PORTS } = require('../../lib/task-platform/factory-stack/defaults');
const { probeHttp } = require('../../lib/task-platform/factory-stack/health');

describe('factory-stack defaults', () => {
  it('builds live OpenClaw-oriented service env', () => {
    const env = buildServiceEnv();
    assert.equal(env.FACTORY_PROOF_PROFILE, 'live');
    assert.equal(env.FF_REAL_SPECIALIST_DELEGATION, 'true');
    assert.match(env.OPENCLAW_BASE_URL, /18789|OPENCLAW/);
    assert.equal(env.PORT, String(DEFAULT_PORTS.api));
    assert.match(env.DATABASE_URL, /15432|postgres/);
  });
});

describe('factory-stack launchd plist', () => {
  it('renders KeepAlive RunAtLoad plist with env', () => {
    const xml = buildPlist({
      label: 'com.engineering-team.factory-audit-api',
      programArgs: ['/usr/bin/node', 'scripts/run-audit-api.js'],
      env: { PORT: '13000', FACTORY_PROOF_PROFILE: 'live' },
      stdoutLog: '/tmp/api.out',
      stderrLog: '/tmp/api.err',
      workingDirectory: '/tmp/repo',
    });
    assert.match(xml, /com\.engineering-team\.factory-audit-api/);
    assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(xml, /FACTORY_PROOF_PROFILE/);
    assert.match(xml, /scripts\/run-audit-api\.js/);
  });
});

describe('factory-stack health probe', () => {
  it('returns structured failure for unreachable urls', async () => {
    const result = await probeHttp('http://127.0.0.1:1/health', { timeoutMs: 200 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.ok(result.error);
  });
});
