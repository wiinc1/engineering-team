const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PREFLIGHT_REPORT_SCHEMA_VERSION,
  buildPreflightReport,
  buildPreflightOptions,
  evaluatePreflight,
  explicitReleaseEnvFailures,
  failureLines,
  resolvePreflightOptions,
  shouldPrintHelp,
  standaloneCandidateProofFailures,
  usageText,
} = require('../../scripts/preflight-real-autonomous-delivery');
const {
  COMMIT_SHA,
  PR_URL,
  cleanEnv,
  completeArgs,
  git,
  githubFetchMock,
  withoutArg,
  writeCandidateProof,
  writePrDiscoveryReport,
} = require('./helpers/real-autonomous-delivery-preflight-fixtures');

test('real autonomous delivery preflight CLI prints help without validating inputs', () => {
  assert.equal(shouldPrintHelp(['node', 'script', '--help']), true);
  assert.match(usageText(), /--base-url/);
  assert.match(usageText(), /--release-secret-command/);
  assert.match(usageText(), /npm run autonomy:verify-real-delivery-candidate/);
  assert.doesNotMatch(usageText(), /--generate-candidate-proof/);

  const result = spawnSync(process.execPath, ['scripts/preflight-real-autonomous-delivery.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/preflight-real-autonomous-delivery\.js/);
  assert.equal(result.stderr, '');
});

test('real autonomous delivery preflight reports missing hosted proof inputs before phase 6 runs', () => {
  const result = spawnSync(process.execPath, ['scripts/preflight-real-autonomous-delivery.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hosted release evidence requires --release-env staging or prod/);
  assert.match(result.stderr, /FAIL  real-autonomous-delivery-preflight: real-evidence phase 6 requires --auto-merge/);
  assert.match(result.stderr, /actual pull request target is required/);
  assert.match(result.stderr, /hosted prod release evidence requires --deployment-url/);
  assert.match(result.stderr, /hosted prod release evidence requires --candidate-proof/);
  assert.match(result.stderr, /hosted release evidence requires --release-secret-command/);
});

test('real autonomous delivery preflight can emit a redacted JSON readiness report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-report-'));
  const reportPath = path.join(tmp, 'preflight-report.json');
  const result = spawnSync(process.execPath, [
    'scripts/preflight-real-autonomous-delivery.js',
    '--json',
    '--report',
    reportPath,
    '--release-env',
    'staging',
    '--github-token',
    'super-secret-token',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /super-secret-token/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, PREFLIGHT_REPORT_SCHEMA_VERSION);
  assert.equal(report.ok, false);
  assert.equal(report.releaseEnv, 'staging');
  assert.equal(report.inputs.hasGithubToken, true);
  assert.equal(report.inputs.githubToken, undefined);
  assert.match(report.failures.join('\n'), /actual pull request target is required/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('real autonomous delivery preflight derives local git identity but still requires a PR target', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-git-'));
  git(tmp, ['init']);
  git(tmp, ['remote', 'add', 'github', 'https://github.com/wiinc1/engineering-team.git']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'preflight defaults\n');
  git(tmp, ['add', 'README.md']);
  git(tmp, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  git(tmp, ['checkout', '-b', 'feat/preflight-proof-defaults']);
  const commitSha = git(tmp, ['rev-parse', 'HEAD']);

  const options = buildPreflightOptions([
    'node',
    'scripts/preflight-real-autonomous-delivery.js',
    '--repo-root',
    tmp,
    '--release-env',
    'staging',
    '--pr-number',
    '418',
  ], cleanEnv());

  assert.equal(options.ciRepository, 'wiinc1/engineering-team');
  assert.equal(options.branchName, 'feat/preflight-proof-defaults');
  assert.equal(options.implementationCommitSha, commitSha);
  assert.equal(options.commitSha, commitSha);
  assert.equal(options.localGitDefaultsUsed, true);
  assert.equal(options.workingTreeClean, true);
  assert.equal(options.dirtyFileCount, 0);
  assert.doesNotMatch(evaluatePreflight(options).failures.join('\n'), /actual pull request target is required/);
});

test('real autonomous delivery preflight fails closed when local git worktree is dirty', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-dirty-git-'));
  const repoRoot = path.join(tmp, 'repo');
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  fs.mkdirSync(repoRoot);
  git(repoRoot, ['init']);
  git(repoRoot, ['remote', 'add', 'github', 'https://github.com/wiinc1/engineering-team.git']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'preflight defaults\n');
  git(repoRoot, ['add', 'README.md']);
  git(repoRoot, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  git(repoRoot, ['checkout', '-b', 'feat/preflight-proof-defaults']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'dirty preflight defaults\n');
  writeCandidateProof(candidateProofPath);

  const args = completeArgs(candidateProofPath).filter((arg) => arg !== '--no-git-defaults');
  const options = buildPreflightOptions(['node', ...args, '--repo-root', repoRoot], cleanEnv());
  const report = buildPreflightReport(evaluatePreflight(options), options);

  assert.equal(options.localGitDefaultsUsed, true);
  assert.equal(options.workingTreeClean, false);
  assert.equal(options.dirtyFileCount, 1);
  assert.deepEqual(options.dirtyFiles, ['README.md']);
  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /local git worktree must be clean before real delivery planning \(1 dirty files\)/);
  assert.equal(report.inputs.workingTreeClean, false);
  assert.equal(report.inputs.dirtyFileCount, 1);
});

test('real autonomous delivery preflight can disable local git defaults', () => {
  const options = buildPreflightOptions([
    'node',
    'scripts/preflight-real-autonomous-delivery.js',
    '--no-git-defaults',
    '--release-env',
    'staging',
  ], cleanEnv());

  assert.equal(options.ciRepository, '');
  assert.equal(options.branchName, '');
  assert.equal(options.implementationCommitSha, '');
  assert.equal(options.localGitDefaultsUsed, false);
  assert.equal(options.workingTreeClean, null);
  assert.equal(options.dirtyFileCount, null);
});

test('real autonomous delivery preflight accepts complete hosted phase6 inputs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  writeCandidateProof(candidateProofPath);

  const argv = ['node', ...completeArgs(candidateProofPath)];
  const options = buildPreflightOptions(argv, cleanEnv());

  assert.equal(options.collectRealEvidence, true);
  assert.equal(options.requireRealEvidence, true);
  assert.equal(options.fromPhase, 6);
  assert.equal(options.toPhase, 6);
  assert.equal(options.requireReadableCandidateProof, true);
  assert.equal(options.candidateProofPath, candidateProofPath);

  const result = spawnSync(process.execPath, completeArgs(candidateProofPath), {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS  real-autonomous-delivery-preflight: staging hosted phase6 inputs ready/);
  assert.equal(result.stderr, '');
});

test('real autonomous delivery preflight discovers the PR target before evaluating hosted inputs', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-discovery-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  writeCandidateProof(candidateProofPath);
  const fetchImpl = githubFetchMock();
  const argv = [
    'node',
    ...withoutArg(completeArgs(candidateProofPath), '--pr-url'),
    '--branch',
    'feat/queue-status-real-delivery',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--discover-pr-target',
  ];
  const options = buildPreflightOptions(argv, cleanEnv());
  const resolved = await resolvePreflightOptions({ ...options, fetchImpl }, cleanEnv());
  const evaluation = evaluatePreflight(resolved);

  assert.equal(resolved.prNumber, 418);
  assert.equal(resolved.prUrl, PR_URL);
  assert.equal(evaluation.ok, true);
  assert.equal(resolved.prDiscovery.ok, true);
  assert.match(fetchImpl.requests[0].url, /head=wiinc1%3Afeat%2Fqueue-status-real-delivery/);
  assert.equal(fetchImpl.requests[0].init.headers.authorization, 'Bearer gh-token');
});

test('real autonomous delivery preflight hydrates the PR target from a discovery report', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-report-pr-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  const prReportPath = path.join(tmp, 'pr-discovery.json');
  writeCandidateProof(candidateProofPath);
  writePrDiscoveryReport(prReportPath);
  const argv = [
    'node',
    ...withoutArg(completeArgs(candidateProofPath), '--pr-url'),
    '--branch',
    'feat/queue-status-real-delivery',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--use-pr-discovery-report',
    '--pr-discovery-report',
    prReportPath,
  ];
  const resolved = await resolvePreflightOptions(buildPreflightOptions(argv, cleanEnv()), cleanEnv());
  const evaluation = evaluatePreflight(resolved);

  assert.equal(resolved.prUrl, PR_URL);
  assert.equal(resolved.prNumber, 418);
  assert.equal(resolved.prDiscovery.ok, true);
  assert.equal(evaluation.ok, true);
});

test('real autonomous delivery preflight reports PR discovery failures without leaking credentials', async () => {
  const argv = [
    'node',
    'scripts/preflight-real-autonomous-delivery.js',
    '--json',
    '--no-git-defaults',
    '--release-env',
    'staging',
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/queue-status-real-delivery',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--discover-pr-target',
    '--github-token',
    'super-secret-token',
  ];
  const options = buildPreflightOptions(argv, cleanEnv());
  const resolved = await resolvePreflightOptions({
    ...options,
    fetchImpl: githubFetchMock({ pulls: [] }),
  }, cleanEnv());
  const report = buildPreflightReport(evaluatePreflight(resolved), resolved);

  assert.equal(report.ok, false);
  assert.equal(report.inputs.prDiscovery.requested, true);
  assert.equal(report.inputs.prDiscovery.ok, false);
  assert.match(report.failures.join('\n'), /PR target discovery failed: no open GitHub pull request found/);
  assert.match(report.failures.join('\n'), /actual pull request target is required/);
  assert.doesNotMatch(JSON.stringify(report), /super-secret-token/);
});

test('real autonomous delivery preflight rejects placeholder candidate proof JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-placeholder-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  fs.writeFileSync(candidateProofPath, '{}\n');

  const result = spawnSync(process.execPath, completeArgs(candidateProofPath), {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /candidate proof schemaVersion must be real-delivery-candidate-proof\.v1/);
  assert.match(result.stderr, /candidate proof must pass/);
  assert.match(result.stderr, /candidate proof deployment health must pass/);
});

test('real autonomous delivery preflight rejects candidate health proof from another deployment origin', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-health-origin-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  writeCandidateProof(candidateProofPath, {
    deploymentHealth: {
      ok: true,
      url: 'https://unrelated-factory.openclaw.app/version',
      status: 200,
      commitVerified: true,
    },
  });

  const result = spawnSync(process.execPath, completeArgs(candidateProofPath), {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /candidate proof deployment health URL must match deployment URL origin/);
});

test('real autonomous delivery preflight formats assertion failures as individual lines', () => {
  assert.deepEqual(
    failureLines(new Error('Real autonomous delivery preflight failed: first; second')),
    ['first', 'second'],
  );
});

test('real autonomous delivery preflight requires an explicit hosted release environment', () => {
  assert.deepEqual(
    explicitReleaseEnvFailures({ releaseEnv: '' }),
    ['hosted release evidence requires --release-env staging or prod'],
  );
  assert.deepEqual(
    explicitReleaseEnvFailures({ releaseEnv: 'development' }),
    ['hosted release evidence requires --release-env staging or prod'],
  );
  assert.deepEqual(explicitReleaseEnvFailures({ releaseEnv: 'production' }), []);
});

test('real autonomous delivery preflight requires candidate proof to be generated before hosted replay', () => {
  assert.deepEqual(standaloneCandidateProofFailures({ generateCandidateProof: false }), []);
  assert.deepEqual(
    standaloneCandidateProofFailures({ generateCandidateProof: true }),
    ['standalone real-delivery preflight requires an existing --candidate-proof; generate it with npm run autonomy:verify-real-delivery-candidate first'],
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-preflight-generate-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  writeCandidateProof(candidateProofPath);
  const result = spawnSync(process.execPath, [
    ...completeArgs(candidateProofPath),
    '--generate-candidate-proof',
    '--candidate-test-command',
    'npm run test:unit',
    '--risk-level',
    'low',
    '--production-safe',
    '--production-safety-evidence',
    'observability/release/production-safety.json',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnv(),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /standalone real-delivery preflight requires an existing --candidate-proof/);
});
