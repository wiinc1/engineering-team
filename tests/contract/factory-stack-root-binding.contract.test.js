'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ROOT,
  assertPersistentRepoRoot,
  buildServiceEnv,
} = require('../../lib/task-platform/factory-stack/defaults');
const {
  buildPlist,
  buildServiceSpecs,
  inspectLaunchdPlist,
} = require('../../lib/task-platform/factory-stack/launchd');
const { resolveFactoryConfig } = require('../../lib/task-platform/factory-delivery-shared');
const { validationSubprocessEnv } = require('../../lib/task-platform/golden-path-validation');

it('keeps delegated Phase 1 independent from downstream agent phases', () => {
  const config = resolveFactoryConfig({ queueBackend: 'postgres', agentDrivenPhases: true });
  assert.equal(config.agentDrivenPhases, true);
  assert.equal(config.agentDrivenPhase1, false);
});

it('routes a seeded Forge task through live architect assignment before readiness polling', () => {
  const deliverySource = fs.readFileSync(
    path.join(ROOT, 'lib/task-platform/factory-delivery.js'),
    'utf8',
  );
  const assignmentSource = fs.readFileSync(
    path.join(ROOT, 'lib/task-platform/factory-forge-architect-assignment.js'),
    'utf8',
  );
  const seedStart = deliverySource.indexOf('async function seedFactoryForgeTask');
  const assignment = deliverySource.indexOf(
    'await requestFactoryForgeArchitectAssignment(config, forgeTaskId)',
    seedStart,
  );
  const readiness = deliverySource.indexOf('await pollForgeExecutionReadiness(', seedStart);

  assert.ok(seedStart >= 0);
  assert.ok(assignment > seedStart);
  assert.ok(readiness > assignment);
  assert.match(assignmentSource, /architect-engineer-assignment/);
  assert.match(assignmentSource, /delegate: true/);
  assert.match(assignmentSource, /delegation\?\.delegated !== true/);
});

it('keeps every persistent service spec on the bound canonical checkout', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-stack-contract-'));
  const bindingFile = path.join(fixture, 'repo-root.json');
  const binding = assertPersistentRepoRoot({ root: ROOT, bindingFile });
  const env = buildServiceEnv();
  const { specs } = buildServiceSpecs(env, { skipForgeadapter: true });

  assert.equal(env.FACTORY_STACK_REPO_ROOT, binding.repoRoot);
  assert.equal(env.GOLDEN_PATH_OPENCLAW_POST_APPROVAL_ARTIFACTS, 'true');
  assert.equal(env.GOLDEN_PATH_OPENCLAW_ARCHITECT_ENGINEER_ASSIGNMENT, 'true');
  for (const spec of specs) {
    assert.equal(spec.workingDirectory, binding.repoRoot);
    for (const argument of spec.programArgs.filter((value) => path.isAbsolute(String(value)))) {
      if (argument === process.execPath) continue;
      assert.ok(argument.startsWith(`${binding.repoRoot}${path.sep}`), `${spec.key} escapes canonical root`);
    }
  }
});

it('binds Postgres recovery to an autonomous OrbStack engine start', () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, 'lib/task-platform/factory-stack/container-engine.js'),
    'utf8',
  );
  const postgresSource = fs.readFileSync(
    path.join(ROOT, 'lib/task-platform/factory-stack/postgres.js'),
    'utf8',
  );

  assert.match(engineSource, /\['start', '--all'\]/);
  assert.match(engineSource, /orbstack_start_failed/);
  assert.match(engineSource, /orbstack_start_timeout/);
  assert.match(postgresSource, /await ensureContainerEngineImpl/);
  assert.match(postgresSource, /docker_compose_failed/);
});

it('keeps GP-023 child validation isolated from persistent factory runtime state', () => {
  const env = validationSubprocessEnv({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    DATABASE_URL: 'postgres://live-factory',
    AUTH_JWT_SECRET: 'live-secret',
    FF_EXECUTION_CONTRACTS: 'true',
    FF_FACTORY_TRUSTED_SIMPLE_CLOSE: 'true',
    FACTORY_TRUSTED_DELIVERY: 'true',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    NODE_ENV: 'production',
  });
  const observed = JSON.parse(execFileSync(process.execPath, ['-e', [
    'const keys = [',
    "  'DATABASE_URL', 'AUTH_JWT_SECRET', 'FF_EXECUTION_CONTRACTS',",
    "  'FF_FACTORY_TRUSTED_SIMPLE_CLOSE', 'FACTORY_TRUSTED_DELIVERY',",
    "  'OPENCLAW_BASE_URL', 'ALLOW_FILE_AUDIT_BACKEND', 'NODE_ENV',",
    '];',
    'console.log(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));',
  ].join('\n')], { encoding: 'utf8', env }));

  assert.deepEqual(observed, {
    DATABASE_URL: null,
    AUTH_JWT_SECRET: null,
    FF_EXECUTION_CONTRACTS: null,
    FF_FACTORY_TRUSTED_SIMPLE_CLOSE: null,
    FACTORY_TRUSTED_DELIVERY: null,
    OPENCLAW_BASE_URL: null,
    ALLOW_FILE_AUDIT_BACKEND: 'true',
    NODE_ENV: 'test',
  });
});

it('accepts a canonical generated plist as configuration evidence', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-stack-plist-contract-'));
  const plist = path.join(fixture, 'api.plist');
  fs.writeFileSync(plist, buildPlist({
    label: 'com.engineering-team.factory-audit-api',
    programArgs: [process.execPath, path.join(ROOT, 'scripts', 'run-audit-api.js')],
    env: buildServiceEnv(),
    stdoutLog: path.join(fixture, 'out.log'),
    stderrLog: path.join(fixture, 'err.log'),
    workingDirectory: ROOT,
  }));
  assert.equal(inspectLaunchdPlist(plist).ok, true);
});

it('gives staging independent persistent identity, ports, state, and logs', () => {
  const script = `
    const value = require('./lib/task-platform/factory-stack/defaults');
    process.stdout.write(JSON.stringify({
      profile: value.PROFILE, labels: value.LABELS, ports: value.DEFAULT_PORTS,
      stateDir: value.STATE_DIR, binding: value.ROOT_BINDING_FILE, logs: value.logsHomeDir(),
    }));
  `;
  const env = {
    ...process.env, FACTORY_STACK_PROFILE: 'staging', FACTORY_STACK_STATE_DIR: '',
    FACTORY_STACK_ROOT_BINDING_FILE: '', FACTORY_STACK_LOG_DIR: '', FACTORY_STACK_API_PORT: '',
    FACTORY_STACK_UI_PORT: '', FACTORY_STACK_FA_PORT: '', FACTORY_STACK_PG_PORT: '',
  };
  const isolated = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8', env }));
  assert.equal(isolated.profile, 'staging');
  assert.equal(isolated.ports.api, 23000);
  assert.equal(isolated.ports.postgres, 25432);
  assert.ok(Object.values(isolated.labels).every((label) => label.includes('factory-staging-')));
  assert.match(isolated.stateDir, /engineering-team-factory\/profiles\/staging$/);
  assert.match(isolated.binding, /profiles\/staging\/repo-root\.json$/);
  assert.match(isolated.logs, /engineering-team-factory-staging$/);
});

it('serves production staging UI from built assets with the isolated API proxy', () => {
  const env = { ...buildServiceEnv(), NODE_ENV: 'production' };
  const ui = buildServiceSpecs(env, { skipForgeadapter: true }).specs
    .find((service) => service.key === 'ui');
  assert.ok(ui.programArgs.includes('preview'));
  assert.equal(ui.programArgs.includes('dev'), false);
  assert.equal(ui.env.VITE_TASK_API_BASE_URL, '/backend');
  assert.match(ui.env.VITE_TASK_API_PROXY_TARGET, /127\.0\.0\.1:\d+$/);
});
