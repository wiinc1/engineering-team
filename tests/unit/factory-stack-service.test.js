const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildPlist,
  buildServiceSpecs,
} = require('../../lib/task-platform/factory-stack/launchd');
const {
  buildServiceEnv,
  DEFAULT_PORTS,
  LABELS,
} = require('../../lib/task-platform/factory-stack/defaults');
const {
  probeHttp,
  evaluateFactoryStackAcceptance,
  probeWorkersHeartbeat,
} = require('../../lib/task-platform/factory-stack/health');
const { resolveDockerBin, dockerAvailable } = require('../../lib/task-platform/factory-stack/postgres');

describe('factory-stack defaults', () => {
  it('builds live OpenClaw-oriented service env', () => {
    const env = buildServiceEnv();
    assert.equal(env.FACTORY_PROOF_PROFILE, 'live');
    assert.equal(env.FF_REAL_SPECIALIST_DELEGATION, 'true');
    assert.match(env.OPENCLAW_BASE_URL, /18789|OPENCLAW/);
    assert.equal(env.PORT, String(DEFAULT_PORTS.api));
    assert.match(env.DATABASE_URL, /15432|postgres/);
    assert.equal(env.ET_FORGE_DISPATCH_ENABLED, 'true');
  });

  it('defines launchd labels for full claim topology', () => {
    assert.equal(LABELS.api, 'com.engineering-team.factory-audit-api');
    assert.equal(LABELS.workers, 'com.engineering-team.factory-audit-workers');
    assert.equal(LABELS.ui, 'com.engineering-team.factory-ui');
    assert.equal(LABELS.forgeadapter, 'com.engineering-team.factory-forgeadapter');
    assert.equal(LABELS.postgresEnsure, 'com.engineering-team.factory-postgres-ensure');
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

  it('builds service specs including postgres ensure, api, workers, ui', () => {
    const { specs, skipped } = buildServiceSpecs(buildServiceEnv(), {
      skipForgeadapter: true,
    });
    const keys = specs.map((s) => s.key);
    assert.deepEqual(keys.filter((k) => k !== 'forgeadapter'), ['postgresEnsure', 'api', 'workers', 'ui']);
    assert.equal(skipped.forgeadapter, true);
    assert.ok(specs.find((s) => s.key === 'postgresEnsure').programArgs.some((a) => String(a).includes('factory-stack-postgres-watch')));
  });
});

describe('factory-stack health probe', () => {
  it('returns structured failure for unreachable urls', async () => {
    const result = await probeHttp('http://127.0.0.1:1/health', { timeoutMs: 200 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.ok(result.error);
  });

  it('probeWorkersHeartbeat returns structured launchd shape', () => {
    const hb = probeWorkersHeartbeat();
    assert.equal(typeof hb.ok, 'boolean');
    assert.ok(hb.launchd);
    assert.equal(hb.launchd.label, LABELS.workers);
  });
});

describe('factory-stack postgres docker resolution', () => {
  it('exposes docker bin resolution without throwing', () => {
    const bin = resolveDockerBin();
    assert.ok(bin === null || typeof bin === 'string');
    assert.equal(typeof dockerAvailable(), 'boolean');
  });
});

describe('factory-stack #269 acceptance evaluator', () => {
  it('passes when health + launchd + runbooks are satisfied', () => {
    const health = {
      ok: true,
      required: {
        postgres: { ok: true },
        api: { ok: true },
        openclaw: { ok: true },
        workers: { ok: true },
      },
      claimTopology: {
        ui: { ok: true, required: true },
        forgeadapter: { ok: true, required: true },
      },
    };
    const launchd = {
      api: { loaded: true, running: true },
      workers: { loaded: true, running: true },
      postgresEnsure: { loaded: true, running: true },
      ui: { loaded: true, running: true },
      forgeadapter: { loaded: true, running: true },
    };
    const result = evaluateFactoryStackAcceptance({ health, launchd, dockerAvailable: true });
    assert.equal(result.ok, true);
    assert.ok(result.criteria.every((c) => c.ok));
  });

  it('fails AC2 when workers are down', () => {
    const health = {
      ok: false,
      required: {
        postgres: { ok: true },
        api: { ok: true },
        openclaw: { ok: true },
        workers: { ok: false },
      },
      claimTopology: {
        ui: { ok: true, required: true },
        forgeadapter: { ok: false, required: false },
      },
    };
    const launchd = {
      api: { loaded: true, running: true },
      workers: { loaded: false, running: false },
      postgresEnsure: { loaded: true, running: true },
      ui: { loaded: true, running: true },
      forgeadapter: { loaded: false, running: false },
    };
    const result = evaluateFactoryStackAcceptance({ health, launchd, dockerAvailable: true });
    assert.equal(result.ok, false);
    assert.equal(result.criteria.find((c) => c.id === 'AC2').ok, false);
  });
});

describe('factory-stack compose durability', () => {
  it('uses restart unless-stopped and persistent volume', () => {
    const compose = fs.readFileSync(path.join(process.cwd(), 'docker-compose.golden-path.yml'), 'utf8');
    assert.match(compose, /restart:\s*unless-stopped/);
    assert.match(compose, /factory_pgdata/);
    assert.doesNotMatch(compose, /tmpfs:/);
  });
});
