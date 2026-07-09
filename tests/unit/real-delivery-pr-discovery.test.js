const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  REPORT_SCHEMA_VERSION,
  buildReport,
  discoveryInputFailures,
  optionsFromArgv,
  shouldPrintHelp,
  usageText,
} = require('../../scripts/discover-real-delivery-pr');
const {
  discoverGitHubPullRequestTarget,
  repositoryParts,
} = require('../../lib/task-platform/github-pr-target-discovery');

const SCRIPT = path.join(__dirname, '../..', 'scripts/discover-real-delivery-pr.js');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
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

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
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
      ref: 'feat/real-delivery-pr',
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

test('real delivery PR discovery fetches the open PR target for branch and commit', async () => {
  const fetchImpl = githubFetchMock();
  const target = await discoverGitHubPullRequestTarget({
    repository: 'wiinc1/engineering-team',
    branchName: 'feat/real-delivery-pr',
    implementationCommitSha: COMMIT_SHA,
    githubToken: 'token',
    fetchImpl,
  }, cleanEnv());

  assert.equal(target.prNumber, 418);
  assert.equal(target.prUrl, PR_URL);
  assert.equal(target.repository, 'wiinc1/engineering-team');
  assert.equal(target.branchName, 'feat/real-delivery-pr');
  assert.equal(target.implementationCommitSha, COMMIT_SHA);
  assert.match(fetchImpl.requests[0].url, /head=wiinc1%3Afeat%2Freal-delivery-pr/);
  assert.equal(fetchImpl.requests[0].init.headers.authorization, 'Bearer token');
});

test('real delivery PR discovery fails closed without token or with untrusted API base', async () => {
  await assert.rejects(
    () => discoverGitHubPullRequestTarget({
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-pr',
      fetchImpl: githubFetchMock(),
    }, cleanEnv()),
    /GITHUB_TOKEN or GH_TOKEN is required/,
  );
  await assert.rejects(
    () => discoverGitHubPullRequestTarget({
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-pr',
      githubToken: 'token',
      githubApiBaseUrl: 'https://github-proxy.local',
      fetchImpl: githubFetchMock(),
    }, cleanEnv()),
    /GitHub evidence API base must be https:\/\/api\.github\.com/,
  );
});

test('real delivery PR discovery rejects default PR and commit drift', async () => {
  await assert.rejects(
    () => discoverGitHubPullRequestTarget({
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-pr',
      githubToken: 'token',
      fetchImpl: githubFetchMock({ pulls: [pull({ number: 271 })] }),
    }, cleanEnv()),
    /default pilot PR #271/,
  );
  await assert.rejects(
    () => discoverGitHubPullRequestTarget({
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-pr',
      implementationCommitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
      githubToken: 'token',
      fetchImpl: githubFetchMock(),
    }, cleanEnv()),
    /does not match requested implementation commit/,
  );
});

test('real delivery PR discovery rejects missing or ambiguous PR targets', async () => {
  await assert.rejects(
    () => discoverGitHubPullRequestTarget({
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-pr',
      githubToken: 'token',
      fetchImpl: githubFetchMock({ pulls: [] }),
    }, cleanEnv()),
    /no open GitHub pull request found/,
  );
  await assert.rejects(
    () => discoverGitHubPullRequestTarget({
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-delivery-pr',
      githubToken: 'token',
      fetchImpl: githubFetchMock({ pulls: [pull(), pull({ number: 419 })] }),
    }, cleanEnv()),
    /multiple open GitHub pull requests found/,
  );
});

test('real delivery PR discovery CLI reports missing token without leaking secrets', () => {
  assert.equal(shouldPrintHelp(['node', SCRIPT, '--help']), true);
  assert.match(usageText(), /--github-token/);
  assert.deepEqual(repositoryParts('wiinc1/engineering-team'), {
    owner: 'wiinc1',
    repo: 'engineering-team',
    repository: 'wiinc1/engineering-team',
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-pr-discovery-'));
  const reportPath = path.join(tmp, 'report.json');
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--json',
    '--report',
    reportPath,
    '--no-git-defaults',
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/real-delivery-pr',
  ], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    env: cleanEnv({ GITHUB_TOKEN: '' }),
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(report.ok, false);
  assert.equal(report.inputs.hasGithubToken, false);
  assert.match(report.failures.join('\n'), /GITHUB_TOKEN or GH_TOKEN is required/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('real delivery PR discovery fails closed when local git worktree is dirty', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-pr-discovery-dirty-'));
  git(tmp, ['init']);
  git(tmp, ['remote', 'add', 'github', 'https://github.com/wiinc1/engineering-team.git']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'pr discovery defaults\n');
  git(tmp, ['add', 'README.md']);
  git(tmp, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  git(tmp, ['checkout', '-b', 'feat/real-delivery-pr']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'dirty pr discovery defaults\n');

  const options = optionsFromArgv([
    'node',
    SCRIPT,
    '--repo-root',
    tmp,
    '--github-token',
    'token',
  ], cleanEnv());
  const failures = discoveryInputFailures(options);
  const report = buildReport({ ok: false, options, failures });

  assert.equal(options.repository, 'wiinc1/engineering-team');
  assert.equal(options.branchName, 'feat/real-delivery-pr');
  assert.equal(options.workingTreeClean, false);
  assert.equal(options.dirtyFileCount, 1);
  assert.deepEqual(options.dirtyFiles, ['README.md']);
  assert.match(failures.join('\n'), /local git worktree must be clean before real delivery planning \(1 dirty files\)/);
  assert.equal(report.inputs.workingTreeClean, false);
  assert.equal(report.inputs.dirtyFileCount, 1);
});

test('real delivery PR discovery report redacts github token', () => {
  const options = optionsFromArgv([
    'node',
    SCRIPT,
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/real-delivery-pr',
    '--github-token',
    'super-secret-token',
  ], cleanEnv());
  const report = buildReport({ ok: false, options, failures: ['missing proof'] });

  assert.equal(report.inputs.hasGithubToken, true);
  assert.equal(report.inputs.githubToken, undefined);
  assert.doesNotMatch(JSON.stringify(report), /super-secret-token/);
});
