const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  buildPlist,
  buildServiceSpecs,
  inspectLaunchdPlist,
} = require('../../lib/task-platform/factory-stack/launchd');
const {
  buildServiceEnv,
  DEFAULT_PORTS,
  LABELS,
  ROOT,
  assertPersistentRepoRoot,
  readRepoRootBinding,
} = require('../../lib/task-platform/factory-stack/defaults');
const {
  probeHttp,
  evaluateFactoryStackAcceptance,
  probeWorkersHeartbeat,
} = require('../../lib/task-platform/factory-stack/health');
const { resolveDockerBin, dockerAvailable, ensurePostgres } = require('../../lib/task-platform/factory-stack/postgres');
const { ensureContainerEngine } = require('../../lib/task-platform/factory-stack/container-engine');
const { prepareUiAssets } = require('../../lib/task-platform/factory-stack/ui');

describe('factory-stack defaults', () => {
  it('builds live OpenClaw-oriented service env', () => {
    const env = buildServiceEnv();
    assert.equal(env.FACTORY_PROOF_PROFILE, 'live');
    assert.equal(env.FF_REAL_SPECIALIST_DELEGATION, 'true');
    assert.equal(env.GOLDEN_PATH_OPENCLAW_POST_APPROVAL_ARTIFACTS, 'true');
    assert.equal(env.GOLDEN_PATH_OPENCLAW_ARCHITECT_ENGINEER_ASSIGNMENT, 'true');
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

describe('factory-stack persistent root binding', () => {
  it('binds persistent services once and requires explicit root rebinds', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-root-binding-'));
    const bindingFile = path.join(fixture, 'repo-root.json');
    const first = assertPersistentRepoRoot({ root: ROOT, bindingFile });
    assert.equal(first.repoRoot, fs.realpathSync(ROOT));
    assert.equal(first.rebound, false);
    assert.equal(readRepoRootBinding(bindingFile), fs.realpathSync(ROOT));

    const repeated = assertPersistentRepoRoot({ root: ROOT, bindingFile });
    assert.equal(repeated.rebound, false);

    const alternate = path.join(path.dirname(ROOT), 'alternate-engineering-team');
    assert.throws(
      () => assertPersistentRepoRoot({ root: alternate, bindingFile, validateRoot: false }),
      { code: 'FACTORY_STACK_ROOT_CONFLICT' },
    );
    const rebound = assertPersistentRepoRoot({
      root: alternate,
      bindingFile,
      rebindRoot: true,
      validateRoot: false,
    });
    assert.equal(rebound.repoRoot, alternate);
    assert.equal(rebound.previousRoot, fs.realpathSync(ROOT));
    assert.equal(rebound.rebound, true);
  });

  it('rejects temporary and managed staging checkouts', () => {
    const bindingFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'factory-temp-root-')), 'binding.json');
    assert.throws(
      () => assertPersistentRepoRoot({ root: path.join(os.tmpdir(), 'engineering-team-staging'), bindingFile, validateRoot: false }),
      { code: 'FACTORY_STACK_TEMPORARY_ROOT' },
    );
    assert.throws(
      () => assertPersistentRepoRoot({ root: path.join(ROOT, '_checkouts', 'staging'), bindingFile, validateRoot: false }),
      { code: 'FACTORY_STACK_TEMPORARY_ROOT' },
    );
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
    assert.equal(specs.find((s) => s.key === 'ui').programArgs.includes('preview'), false);
  });
});

describe('factory-stack production UI', () => {
  it('builds and previews production UI assets while leaving development on the Vite server', () => {
    const calls = [];
    const productionEnv = { ...buildServiceEnv(), NODE_ENV: 'production' };
    const result = prepareUiAssets(productionEnv, {}, {
      execFileSync: (...args) => calls.push(args), existsSync: () => true, stdio: 'pipe',
    });
    assert.equal(result.built, true);
    assert.deepEqual(calls[0].slice(0, 2), ['npm', ['run', 'build:browser']]);
    assert.equal(calls[0][2].env.VITE_TASK_API_BASE_URL, '/backend');
    const productionUi = buildServiceSpecs(productionEnv, { skipForgeadapter: true }).specs
      .find((service) => service.key === 'ui');
    assert.ok(productionUi.programArgs.includes('preview'));
    assert.equal(productionUi.env.VITE_TASK_API_PROXY_TARGET, `http://127.0.0.1:${DEFAULT_PORTS.api}`);
    assert.equal(prepareUiAssets({ ...productionEnv, NODE_ENV: 'development' }, {}, {
      execFileSync: () => assert.fail('development UI must not build'),
    }).reason, 'development');
  });

  it('keeps the same-origin API proxy active in Vite preview', () => {
    const previous = process.env.VITE_TASK_API_PROXY_TARGET;
    process.env.VITE_TASK_API_PROXY_TARGET = 'http://127.0.0.1:23000';
    const configPath = require.resolve('../../vite.config.js');
    delete require.cache[configPath];
    try {
      const configure = require(configPath);
      const config = configure({ mode: 'production', command: 'serve' });
      assert.equal(config.preview.proxy['/backend'].target, 'http://127.0.0.1:23000');
      assert.equal(config.preview.proxy['/backend'].rewrite('/backend/health'), '/health');
    } finally {
      if (previous === undefined) delete process.env.VITE_TASK_API_PROXY_TARGET;
      else process.env.VITE_TASK_API_PROXY_TARGET = previous;
      delete require.cache[configPath];
    }
  });
});

describe('factory-stack launchd diagnostics', () => {
  it('reports stale temporary checkout paths with remediation', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-plist-status-'));
    const plist = path.join(fixture, 'stale.plist');
    fs.writeFileSync(plist, buildPlist({
      label: LABELS.api,
      programArgs: ['/usr/bin/node', '/private/tmp/engineering-team-staging/scripts/run-audit-api.js'],
      env: { FACTORY_STACK_REPO_ROOT: '/private/tmp/engineering-team-staging' },
      stdoutLog: path.join(fixture, 'out.log'),
      stderrLog: path.join(fixture, 'err.log'),
      workingDirectory: '/private/tmp/engineering-team-staging',
    }));
    const result = inspectLaunchdPlist(plist, { expectedRoot: ROOT });
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes('bound_root_conflict'));
    assert.ok(result.reasons.includes('stale_or_temporary_path'));
    assert.match(result.remediation, /factory:stack:restart/);
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

describe('factory-stack container engine recovery', () => {
  it('returns immediately when the configured Docker engine is running', async () => {
    const calls = [];
    const result = await ensureContainerEngine({
      dockerBin: '/mock/docker',
      execFileSyncImpl: (bin, args) => { calls.push([bin, args]); return 'running'; },
    });
    assert.equal(result.action, 'engine_already_running');
    assert.deepEqual(calls, [['/mock/docker', ['info']]]);
  });

  it('starts the OrbStack VM and waits for Docker readiness', async () => {
    let infoAttempts = 0;
    const calls = [];
    const result = await ensureContainerEngine({
      dockerBin: '/mock/docker',
      platform: 'darwin',
      env: { ORBCTL_BIN: '/mock/orbctl' },
      existsSyncImpl: () => true,
      sleepImpl: async () => {},
      execFileSyncImpl: (bin, args) => {
        calls.push([bin, args]);
        if (args[0] === 'info' && infoAttempts++ === 0) throw new Error('socket missing');
        if (args[0] === 'context') return 'orbstack\n';
        return 'ok';
      },
    });
    assert.equal(result.action, 'orbstack_started');
    assert.ok(calls.some(([bin, args]) => bin === '/mock/orbctl' && args.join(' ') === 'start --all'));
  });

  it('returns structured failure when OrbStack cannot start', async () => {
    const result = await ensureContainerEngine({
      dockerBin: '/mock/docker',
      platform: 'darwin',
      env: { ORBCTL_BIN: '/mock/orbctl' },
      existsSyncImpl: () => true,
      execFileSyncImpl: (bin, args) => {
        if (args[0] === 'info') throw new Error('socket missing');
        if (args[0] === 'context') return 'orbstack\n';
        if (bin === '/mock/orbctl') throw new Error('start denied');
        return 'ok';
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'orbstack_start_failed');
    assert.match(result.error, /start denied/);
  });
});

describe('factory-stack postgres recovery failure', () => {
  it('returns a structured engine failure instead of throwing', async () => {
    const result = await ensurePostgres({
      probePostgresImpl: async () => ({ ok: false, error: 'database unavailable' }),
      ensureContainerEngineImpl: async () => ({
        ok: false, action: 'orbstack_start_failed', error: 'start denied',
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'orbstack_start_failed');
    assert.equal(result.error, 'start denied');
    assert.ok(result.remediation.some((line) => line.includes('orbctl start --all')));
  });
});

function healthyAcceptanceFixture() {
  return {
    health: {
      ok: true,
      required: {
        postgres: { ok: true }, api: { ok: true }, openclaw: { ok: true }, workers: { ok: true },
      },
      claimTopology: { ui: { ok: true, required: true }, forgeadapter: { ok: true, required: true } },
    },
    launchd: {
      api: { loaded: true, running: true }, workers: { loaded: true, running: true },
      postgresEnsure: { loaded: true, running: true }, ui: { loaded: true, running: true },
      forgeadapter: { loaded: true, running: true },
    },
  };
}

function workerDownAcceptanceFixture() {
  const fixture = healthyAcceptanceFixture();
  fixture.health.ok = false;
  fixture.health.required.workers.ok = false;
  fixture.health.claimTopology.forgeadapter = { ok: false, required: false };
  fixture.launchd.workers = { loaded: false, running: false };
  fixture.launchd.forgeadapter = { loaded: false, running: false };
  return fixture;
}

describe('factory-stack #269 acceptance evaluator', () => {
  it('passes when health + launchd + runbooks are satisfied', () => {
    const { health, launchd } = healthyAcceptanceFixture();
    const result = evaluateFactoryStackAcceptance({ health, launchd, dockerAvailable: true });
    assert.equal(result.ok, true);
    assert.ok(result.criteria.every((c) => c.ok));
  });

  it('fails AC2 when workers are down', () => {
    const { health, launchd } = workerDownAcceptanceFixture();
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
