const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PLAN_SCHEMA_VERSION,
  buildPlanReport,
  optionsFromArgv,
  planInputFailures,
  resolvePlanOptions,
  shouldPrintHelp,
  usageText,
} = require('../../scripts/plan-real-autonomous-delivery');
const {
  localGitProofDefaults,
  repositoryFromRemoteUrl,
} = require('../../lib/task-platform/local-git-proof-inputs');

const SCRIPT = path.join(__dirname, '../..', 'scripts/plan-real-autonomous-delivery.js');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const BASE_URL = 'https://factory-api-staging.openclaw.app';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/418';

function cleanEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    ...overrides,
  };
}

function completeArgs() {
  return [
    'node',
    SCRIPT,
    '--no-git-defaults',
    '--release-env',
    'staging',
    '--base-url',
    BASE_URL,
    '--operator-url',
    DEPLOYMENT_URL,
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/real-delivery-plan',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--pr-url',
    PR_URL,
    '--github-token',
    'secret-token',
    '--deployment-url',
    DEPLOYMENT_URL,
    '--rollback-target',
    'release-previous',
    '--health-check-path',
    '/version',
    '--require-health-commit',
    '--candidate-test-command',
    'node --test tests/unit/real-autonomous-delivery-plan-cli.test.js',
    '--release-build-command',
    'npm run build',
    '--release-compatibility-command',
    'npm run test:unit',
    '--release-vulnerability-command',
    'npm audit --audit-level=high',
    '--release-secret-command',
    'npm run secrets:scan',
  ];
}

function runCli(args, env = cleanEnv()) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    env,
  });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function withoutArg(args, name) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      index += 1;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

function withArg(args, name, value) {
  const next = args.slice();
  const index = next.indexOf(name);
  assert.notEqual(index, -1);
  next[index + 1] = value;
  return next;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function pull(overrides = {}) {
  return {
    number: 418,
    html_url: PR_URL,
    head: {
      ref: 'feat/real-delivery-plan',
      sha: COMMIT_SHA,
    },
    ...overrides,
  };
}

function githubFetchMock({ pulls = [pull()] } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/repos/wiinc1/engineering-team/pulls?')) {
      return jsonResponse(pulls);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

function writePrDiscoveryReport(filePath, overrides = {}) {
  const { target: targetOverrides = {}, ...reportOverrides } = overrides;
  const report = {
    schemaVersion: 'real-delivery-pr-target-discovery.v1',
    ok: true,
    failureCount: 0,
    failures: [],
    inputs: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-plan',
      implementationCommitSha: COMMIT_SHA,
      hasGithubToken: true,
    },
    target: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-plan',
      implementationCommitSha: COMMIT_SHA,
      prNumber: 418,
      prUrl: PR_URL,
      source: {
        provider: 'github',
        apiBaseUrl: 'https://api.github.com',
        collectedAt: '2026-07-05T00:00:00.000Z',
      },
      ...targetOverrides,
    },
    ...reportOverrides,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

test('real autonomous delivery plan CLI prints help without validating inputs', () => {
  assert.equal(shouldPrintHelp(['node', SCRIPT, '--help']), true);
  assert.match(usageText(), /--candidate-test-command/);
  assert.match(usageText(), /--release-secret-command/);

  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/plan-real-autonomous-delivery\.js/);
  assert.equal(result.stderr, '');
});

test('real autonomous delivery plan rejects fake and local hosted proof inputs', () => {
  const failures = planInputFailures(optionsFromArgv([
    'node',
    SCRIPT,
    '--release-env',
    'staging',
    '--base-url',
    'http://127.0.0.1:13000',
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/real-delivery-plan',
    '--implementation-commit-sha',
    '0123456789abcdef0123456789abcdef01234567',
    '--pr-number',
    '271',
    '--github-token',
    'secret-token',
    '--deployment-url',
    'http://127.0.0.1:15173',
    '--rollback-target',
    'release-previous',
    '--health-check-path',
    '/version',
    '--require-health-commit',
    '--candidate-test-command',
    'npm run test:unit',
    '--release-build-command',
    'npm run build',
    '--release-compatibility-command',
    'npm run test:unit',
    '--release-vulnerability-command',
    'npm audit --audit-level=high',
    '--release-secret-command',
    'npm run secrets:scan',
  ], cleanEnv()));

  assert.match(failures.join('\n'), /implementation commit SHA: actual non-fixture/);
  assert.match(failures.join('\n'), /default pilot PR #271 is not valid real evidence/);
  assert.match(failures.join('\n'), /hosted base URL must be hosted and non-local/);
  assert.match(failures.join('\n'), /hosted deployment URL must be hosted and non-local/);
});

test('real autonomous delivery plan rejects default and detached candidate branches', () => {
  const mainFailures = planInputFailures(optionsFromArgv(withArg(completeArgs(), '--branch', 'main'), cleanEnv()));
  assert.match(mainFailures.join('\n'), /candidate branch must not be main/);

  const detachedFailures = planInputFailures(optionsFromArgv(withArg(completeArgs(), '--branch', 'HEAD'), cleanEnv()));
  assert.match(detachedFailures.join('\n'), /candidate branch cannot be detached HEAD/);
});

test('real autonomous delivery plan derives repository branch and commit from local git', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-git-'));
  git(tmp, ['init']);
  git(tmp, ['remote', 'add', 'github', 'https://github.com/wiinc1/engineering-team.git']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'proof defaults\n');
  git(tmp, ['add', 'README.md']);
  git(tmp, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  git(tmp, ['checkout', '-b', 'feat/local-proof-defaults']);

  const defaults = localGitProofDefaults(tmp);
  assert.equal(defaults.repository, 'wiinc1/engineering-team');
  assert.equal(defaults.branchName, 'feat/local-proof-defaults');
  assert.match(defaults.implementationCommitSha, /^[0-9a-f]{40}$/);
  assert.equal(defaults.workingTreeClean, true);
  assert.equal(defaults.dirtyFileCount, 0);

  const options = optionsFromArgv(['node', SCRIPT, '--repo-root', tmp], cleanEnv());
  assert.equal(options.repository, defaults.repository);
  assert.equal(options.branchName, defaults.branchName);
  assert.equal(options.implementationCommitSha, defaults.implementationCommitSha);
  assert.equal(options.localGitDefaultsUsed, true);
  assert.equal(options.workingTreeClean, true);
  assert.equal(options.dirtyFileCount, 0);
});

test('real autonomous delivery plan fails closed when local git worktree is dirty', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-dirty-git-'));
  git(tmp, ['init']);
  git(tmp, ['remote', 'add', 'github', 'https://github.com/wiinc1/engineering-team.git']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'proof defaults\n');
  git(tmp, ['add', 'README.md']);
  git(tmp, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  git(tmp, ['checkout', '-b', 'feat/local-proof-defaults']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'dirty proof defaults\n');

  const options = optionsFromArgv([...completeArgs(), '--repo-root', tmp].filter((arg) => arg !== '--no-git-defaults'), cleanEnv());
  const failures = planInputFailures(options);
  const report = buildPlanReport(options);

  assert.equal(options.localGitDefaultsUsed, true);
  assert.equal(options.workingTreeClean, false);
  assert.equal(options.dirtyFileCount, 1);
  assert.deepEqual(options.dirtyFiles, ['README.md']);
  assert.match(failures.join('\n'), /local git worktree must be clean before real delivery planning \(1 dirty files\)/);
  assert.equal(report.ok, false);
  assert.equal(report.inputs.workingTreeClean, false);
  assert.equal(report.inputs.dirtyFileCount, 1);
});

test('real autonomous delivery plan does not inspect local worktree when git defaults are disabled', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-no-git-defaults-'));
  git(tmp, ['init']);
  fs.writeFileSync(path.join(tmp, 'dirty.js'), 'module.exports = true;\n');

  const options = optionsFromArgv([...completeArgs(), '--repo-root', tmp], cleanEnv());
  const report = buildPlanReport(options);

  assert.equal(options.localGitDefaultsUsed, false);
  assert.equal(options.workingTreeClean, null);
  assert.equal(options.dirtyFileCount, null);
  assert.equal(report.ok, true);
  assert.equal(report.inputs.workingTreeClean, null);
  assert.equal(report.inputs.dirtyFileCount, null);
});

test('real autonomous delivery plan parses common remote URL shapes', () => {
  assert.equal(repositoryFromRemoteUrl('git@github.com:wiinc1/engineering-team.git'), 'wiinc1/engineering-team');
  assert.equal(repositoryFromRemoteUrl('ssh://git@github.com/wiinc1/engineering-team.git'), 'wiinc1/engineering-team');
  assert.equal(repositoryFromRemoteUrl('ssh://git@192.168.1.116:2424/wiinc1/engineering-team.git'), 'wiinc1/engineering-team');
});

test('real autonomous delivery plan emits redacted ordered command plan', () => {
  const report = buildPlanReport(optionsFromArgv(completeArgs(), cleanEnv()));

  assert.equal(report.schemaVersion, PLAN_SCHEMA_VERSION);
  assert.equal(report.ok, true);
  assert.equal(report.blocked, false);
  assert.deepEqual(report.blockedBy, []);
  assert.equal(report.failureCount, 0);
  assert.equal(report.inputs.hasGithubToken, true);
  assert.deepEqual(report.commands.map((item) => item.id), [
    'rollback-evidence',
    'release-artifacts',
    'production-safety',
    'candidate-proof',
    'hosted-preflight',
    'phase6-replay',
  ]);
  assert.equal(report.commands.every((item) => item.ready === true), true);
  assert.equal(report.commands.every((item) => item.blockedBy.length === 0), true);
  assert.equal(report.postMergeCommands.every((item) => item.ready === true), true);
  assert.equal(report.artifacts.finalVerificationReportPath, 'observability/real-autonomous-delivery-verification-report.json');
  assert.match(report.commands.find((item) => item.id === 'candidate-proof').command, /--collect-github-evidence/);
  assert.match(report.commands.find((item) => item.id === 'candidate-proof').command, /--repository wiinc1\/engineering-team/);
  assert.match(report.commands.find((item) => item.id === 'rollback-evidence').command, new RegExp(`--commit-sha ${COMMIT_SHA}`));
  assert.match(report.commands.find((item) => item.id === 'production-safety').command, /--release-artifact-dir observability\/release\/artifacts/);
  assert.match(report.commands.find((item) => item.id === 'hosted-preflight').command, /--auto-merge/);
  assert.match(report.postMergeCommands.find((item) => item.id === 'final-verification').command, /\$MERGE_COMMIT_SHA/);
  assert.match(report.postMergeCommands.find((item) => item.id === 'final-verification').command, /--report observability\/real-autonomous-delivery-verification-report\.json/);
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});

test('real autonomous delivery plan discovers the PR target from GitHub evidence', async () => {
  const fetchImpl = githubFetchMock();
  const options = optionsFromArgv([
    ...withoutArg(completeArgs(), '--pr-url'),
    '--discover-pr-target',
  ], cleanEnv());
  const resolved = await resolvePlanOptions({ ...options, fetchImpl }, cleanEnv());
  const report = buildPlanReport(resolved);

  assert.equal(resolved.prNumber, 418);
  assert.equal(resolved.prUrl, PR_URL);
  assert.equal(report.ok, true);
  assert.equal(report.inputs.prDiscovery.requested, true);
  assert.equal(report.inputs.prDiscovery.ok, true);
  assert.deepEqual(report.commands.map((item) => item.id), [
    'rollback-evidence',
    'release-artifacts',
    'production-safety',
    'candidate-proof',
    'hosted-preflight',
    'phase6-replay',
  ]);
  assert.match(report.commands.find((item) => item.id === 'hosted-preflight').command, /--pr-url https:\/\/github\.com\/wiinc1\/engineering-team\/pull\/418/);
  assert.match(fetchImpl.requests[0].url, /head=wiinc1%3Afeat%2Freal-delivery-plan/);
  assert.equal(fetchImpl.requests[0].init.headers.authorization, 'Bearer secret-token');
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});

test('real autonomous delivery plan hydrates the PR target from a discovery report', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-pr-report-'));
  const reportPath = path.join(tmp, 'pr-discovery.json');
  writePrDiscoveryReport(reportPath);
  const options = optionsFromArgv([
    ...withoutArg(completeArgs(), '--pr-url'),
    '--use-pr-discovery-report',
    '--pr-discovery-report',
    reportPath,
  ], cleanEnv());
  const resolved = await resolvePlanOptions(options, cleanEnv());
  const report = buildPlanReport(resolved);

  assert.equal(report.ok, true);
  assert.equal(resolved.prUrl, PR_URL);
  assert.equal(resolved.prNumber, 418);
  assert.equal(report.commands.some((item) => item.id === 'discover-pr-target'), false);
  assert.match(report.commands.find((item) => item.id === 'candidate-proof').command, /--pr-url https:\/\/github\.com\/wiinc1\/engineering-team\/pull\/418/);
  assert.match(report.commands.find((item) => item.id === 'candidate-proof').command, /--repository wiinc1\/engineering-team/);
});

test('real autonomous delivery plan fails closed on stale PR discovery reports', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-stale-pr-report-'));
  const reportPath = path.join(tmp, 'pr-discovery.json');
  writePrDiscoveryReport(reportPath, { target: { branchName: 'feat/other-branch' } });
  const options = optionsFromArgv([
    ...withoutArg(completeArgs(), '--pr-url'),
    '--use-pr-discovery-report',
    '--pr-discovery-report',
    reportPath,
  ], cleanEnv());
  const resolved = await resolvePlanOptions(options, cleanEnv());
  const report = buildPlanReport(resolved);

  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /PR target discovery failed: PR discovery report branch feat\/other-branch does not match expected feat\/real-delivery-plan/);
  assert.match(report.failures.join('\n'), /actual pull request target is required/);
});

test('real autonomous delivery plan reports PR discovery failures without hiding the required target gate', async () => {
  const options = optionsFromArgv([
    ...withoutArg(completeArgs(), '--pr-url'),
    '--discover-pr-target',
  ], cleanEnv());
  const resolved = await resolvePlanOptions({
    ...options,
    fetchImpl: githubFetchMock({
      pulls: [pull({ head: { ref: 'feat/real-delivery-plan', sha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210' } })],
    }),
  }, cleanEnv());
  const report = buildPlanReport(resolved);

  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /PR target discovery failed: discovered GitHub PR head SHA/);
  assert.match(report.failures.join('\n'), /actual pull request target is required/);
  assert.equal(report.inputs.prDiscovery.requested, true);
  assert.equal(report.inputs.prDiscovery.ok, false);
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});

test('real autonomous delivery plan CLI writes JSON report and redacts token', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-'));
  const reportPath = path.join(tmp, 'plan.json');
  const result = runCli([...completeArgs().slice(2), '--json', '--report', reportPath], cleanEnv());

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /secret-token/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, PLAN_SCHEMA_VERSION);
  assert.equal(report.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('real autonomous delivery plan reports missing hosted inputs in JSON mode', () => {
  const result = runCli(['--json', '--release-env', 'staging'], cleanEnv());

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.blocked, true);
  assert.deepEqual(report.blockedBy, report.failures);
  assert.match(report.failures.join('\n'), /GITHUB_TOKEN or GH_TOKEN is required/);
  assert.match(report.failures.join('\n'), /actual pull request target is required/);
  assert.match(report.failures.join('\n'), /at least one --candidate-test-command is required/);
  assert.equal(report.commands.every((item) => item.ready === false), true);
  assert.equal(report.postMergeCommands.every((item) => item.ready === false), true);
  assert.deepEqual(report.commands.find((item) => item.id === 'candidate-proof').blockedBy, report.failures);
  assert.match(report.commands.find((item) => item.id === 'candidate-proof').command, /--use-pr-discovery-report/);
  assert.doesNotMatch(report.commands.find((item) => item.id === 'rollback-evidence').command, /--rollback-target ''/);
  assert.doesNotMatch(report.commands.find((item) => item.id === 'production-safety').command, /--deployment-url ''/);
});

test('real autonomous delivery plan CLI fails closed when PR discovery lacks a token', () => {
  const result = runCli([
    '--json',
    '--no-git-defaults',
    '--discover-pr-target',
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/real-delivery-plan',
    '--implementation-commit-sha',
    COMMIT_SHA,
  ], cleanEnv());

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputs.prDiscovery.requested, true);
  assert.equal(report.inputs.prDiscovery.ok, false);
  assert.match(report.failures.join('\n'), /PR target discovery failed: GITHUB_TOKEN or GH_TOKEN is required/);
  assert.match(report.failures.join('\n'), /actual pull request target is required/);
});
