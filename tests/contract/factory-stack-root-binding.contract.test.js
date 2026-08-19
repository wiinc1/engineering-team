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
