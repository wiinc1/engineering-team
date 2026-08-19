'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

it('keeps every persistent service spec on the bound canonical checkout', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-stack-contract-'));
  const bindingFile = path.join(fixture, 'repo-root.json');
  const binding = assertPersistentRepoRoot({ root: ROOT, bindingFile });
  const env = buildServiceEnv();
  const { specs } = buildServiceSpecs(env, { skipForgeadapter: true });

  assert.equal(env.FACTORY_STACK_REPO_ROOT, binding.repoRoot);
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
