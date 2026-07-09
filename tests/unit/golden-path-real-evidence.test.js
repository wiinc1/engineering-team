const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertRealImplementationEvidence,
  assertRealPhase6Evidence,
  runGoldenPathPhases,
} = require('../../lib/task-platform/golden-path-phases');
const {
  isRealEvidenceRequired,
  resolveReleaseEvidenceEnvironment,
  runReleaseEvidenceValidation,
} = require('../../lib/task-platform/golden-path-real-evidence');
const { resolveImplementerArtifacts } = require('../../lib/task-platform/factory-agent-phases');
const { buildGoldenPathPhaseOptions, readRealEvidenceOptions } = require('../../scripts/run-golden-path-phases');
const {
  assertGoldenPathRealEvidencePreflight,
  collectGoldenPathRealEvidenceCliArgs,
  readGoldenPathRealEvidenceCliOptions,
} = require('../../lib/task-platform/golden-path-real-evidence-preflight');

const REAL_PROOF = Object.freeze({
  branchName: 'feat/autonomous-real-proof',
  commitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
  prNumber: 417,
});

const REAL_SCOPE = Object.freeze({
  changeKind: 'bugfix',
  templateTier: 'Standard',
  changedFiles: ['lib/task-platform/factory-delivery.js'],
});
const EXECUTED_CHECKS = Object.freeze([{ name: 'unit tests', conclusion: 'success' }]);
const REQUIRED_CHECKS = Object.freeze(['unit tests', 'Merge readiness']);
const BRANCH_PROTECTION = Object.freeze({ branch: 'main', requiredChecks: REQUIRED_CHECKS, source: 'github_branch_protection' });
const COMPLETE_RELEASE_PROOF = Object.freeze({
  rollbackVerified: true,
  rollbackEvidence: 'observability/release/rollback-verification.json',
  candidateProofPath: 'observability/real-delivery-candidate-proof.json',
  healthCheckPath: '/version',
  requireHealthCommit: true,
  releaseArtifactCommands: {
    build: 'npm run build',
    compatibility: 'npm run test:unit',
    vulnerability: 'npm audit --audit-level=high',
    secret: 'npm run secrets:scan',
  },
});

test('autonomous implementation proof rejects missing real branch, commit, and PR evidence', () => {
  assert.throws(
    () => assertRealImplementationEvidence({}, { agentDrivenPhases: true }),
    /actual branch name is required.*actual 40-character commit SHA is required.*actual pull request URL is required/s,
  );
});

test('golden-path phase CLI treats real-evidence collection as strict evidence mode', () => {
  const collected = readRealEvidenceOptions([
    'node',
    'scripts/run-golden-path-phases.js',
    '--collect-real-evidence',
    '--repository',
    'wiinc1/engineering-team',
    '--pr-number',
    '417',
    '--branch',
    REAL_PROOF.branchName,
    '--commit-sha',
    REAL_PROOF.commitSha,
    '--deployment-url',
    'https://factory-staging.openclaw.app',
    '--rollback-target',
    'release-previous',
    '--candidate-proof',
    'observability/real-delivery-candidate-proof.json',
    '--release-env',
    'staging',
  ]);
  assert.equal(collected.collectRealEvidence, true);
  assert.equal(collected.requireRealEvidence, true);
  assert.equal(collected.ciRepository, 'wiinc1/engineering-team');
  assert.equal(collected.prNumber, 417);
  assert.equal(collected.branchName, REAL_PROOF.branchName);
  assert.equal(collected.implementationCommitSha, REAL_PROOF.commitSha);
  assert.equal(collected.candidateProofPath, 'observability/real-delivery-candidate-proof.json');
  assert.equal(collected.releaseEnv, 'staging');

  const required = readRealEvidenceOptions(['node', 'scripts/run-golden-path-phases.js', '--require-real-evidence']);
  assert.equal(required.collectRealEvidence, false);
  assert.equal(required.requireRealEvidence, true);
});

test('golden-path phase CLI forwards auto-merge into phase 6 runner options', () => {
  const previousArgv = process.argv;
  const previousAutoMerge = process.env.FF_FACTORY_AUTO_MERGE;
  try {
    delete process.env.FF_FACTORY_AUTO_MERGE;
    process.argv = ['node', 'scripts/run-golden-path-phases.js', '--from', '6', '--to', '6', '--auto-merge'];
    assert.equal(readRealEvidenceOptions(process.argv).autoMerge, true);
    assert.equal(buildGoldenPathPhaseOptions().autoMerge, true);

    process.argv = ['node', 'scripts/run-golden-path-phases.js', '--from', '6', '--to', '6'];
    process.env.FF_FACTORY_AUTO_MERGE = 'true';
    assert.equal(readRealEvidenceOptions(process.argv).autoMerge, true);
    assert.equal(buildGoldenPathPhaseOptions().autoMerge, true);
  } finally {
    process.argv = previousArgv;
    if (previousAutoMerge == null) delete process.env.FF_FACTORY_AUTO_MERGE;
    else process.env.FF_FACTORY_AUTO_MERGE = previousAutoMerge;
  }
});

test('real-evidence preflight fails before replay without PR and hosted release proof inputs', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      collectRealEvidence: true,
      releaseEnv: 'prod',
      requireHealthyDeployment: false,
    }, { context: 'test replay' }),
    /test replay preflight failed: .*post-deploy health validation cannot be disabled.*pull request target.*deployment-url.*rollback-target.*rollback-verified.*candidate-proof/s,
  );
});

test('real-evidence preflight accepts staging PR target and deploy rollback inputs', () => {
  const result = assertGoldenPathRealEvidencePreflight({
    collectRealEvidence: true,
    branchName: REAL_PROOF.branchName, implementationCommitSha: REAL_PROOF.commitSha,
    prUrl: REAL_PROOF.prUrl,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    rollbackTarget: 'release-previous',
    ...COMPLETE_RELEASE_PROOF,
  });
  assert.equal(result.required, true);
});

test('real-evidence preflight rejects custom GitHub API base URLs', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      collectRealEvidence: true,
      prUrl: REAL_PROOF.prUrl,
      releaseEnv: 'staging',
      deploymentUrl: 'https://factory-staging.openclaw.app',
      rollbackTarget: 'release-previous',
      githubApiBaseUrl: 'http://127.0.0.1:9999',
    }, { context: 'test replay' }),
    /test replay preflight failed: GitHub evidence API base must be https:\/\/api\.github\.com/,
  );
});

test('real-evidence preflight rejects fixture specialist delegation', () => {
  const proofOptions = {
    collectRealEvidence: true,
    prUrl: REAL_PROOF.prUrl,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    rollbackTarget: 'release-previous',
    ...COMPLETE_RELEASE_PROOF,
  };
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      ...proofOptions,
      allowTestEnvInjection: true,
      env: { FACTORY_USE_FIXTURE_DELEGATION: 'true' },
    }, { context: 'test replay' }),
    /test replay preflight failed: FACTORY_USE_FIXTURE_DELEGATION cannot be true/,
  );
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      ...proofOptions,
      allowTestEnvInjection: true,
      env: { SPECIALIST_DELEGATION_RUNNER: 'node tests/fixtures/specialist-runtime-runner.js' },
    }, { context: 'test replay' }),
    /fixture specialist delegation runner is not valid autonomous evidence/,
  );
});

test('real-evidence preflight treats require mode as GitHub collection mode', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      requireRealEvidence: true,
      prUrl: REAL_PROOF.prUrl,
    }),
    /deployment-url.*rollback-target.*rollback-verified/s,
  );

  const result = assertGoldenPathRealEvidencePreflight({
    requireRealEvidence: true,
    branchName: REAL_PROOF.branchName,
    implementationCommitSha: REAL_PROOF.commitSha,
    prUrl: REAL_PROOF.prUrl,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    rollbackTarget: 'release-previous',
    ...COMPLETE_RELEASE_PROOF,
  });
  assert.equal(result.required, true);
});

test('real-evidence CLI helper forwards only proof-related args', () => {
  const argv = [
    'node',
    'scripts/replay-golden-path-postgres.js',
    '--base-url', 'http://127.0.0.1:13000',
    '--collect-real-evidence',
    '--pr-url', REAL_PROOF.prUrl,
    '--required-checks-json', JSON.stringify(REQUIRED_CHECKS),
    '--branch-protection-json', JSON.stringify(BRANCH_PROTECTION),
    '--deployment-url', 'https://factory-staging.openclaw.app',
    '--rollback-target', 'release-previous',
    '--auto-merge',
    '--allow-unhealthy-deployment',
  ];
  assert.deepEqual(collectGoldenPathRealEvidenceCliArgs(argv), [
    '--collect-real-evidence',
    '--auto-merge',
    '--pr-url', REAL_PROOF.prUrl,
    '--required-checks-json', JSON.stringify(REQUIRED_CHECKS),
    '--branch-protection-json', JSON.stringify(BRANCH_PROTECTION),
    '--deployment-url', 'https://factory-staging.openclaw.app',
    '--rollback-target', 'release-previous',
  ]);
  const options = readGoldenPathRealEvidenceCliOptions(argv, {});
  assert.equal(options.collectRealEvidence, true);
  assert.equal(options.autoMerge, true);
  assert.equal(options.prUrl, REAL_PROOF.prUrl);
  assert.deepEqual(options.requiredChecks, REQUIRED_CHECKS);
  assert.equal(options.branchProtection.source, 'github_branch_protection');
  assert.equal(options.requireHealthyDeployment, false);
});

test('real-evidence CLI helper parses explicit checks, branch protection, and merge-readiness payloads', () => {
  const options = readGoldenPathRealEvidenceCliOptions([
    'node',
    'scripts/run-factory-orchestrator.js',
    '--require-real-evidence',
    '--branch', REAL_PROOF.branchName,
    '--commit-sha', REAL_PROOF.commitSha,
    '--pr-url', REAL_PROOF.prUrl,
    '--checks-json', JSON.stringify(EXECUTED_CHECKS),
    '--required-checks-json', JSON.stringify(REQUIRED_CHECKS),
    '--branch-protection-json', JSON.stringify(BRANCH_PROTECTION),
    '--merge-readiness-json', JSON.stringify({ name: 'Merge readiness', reviewStatus: 'passed' }),
    '--changed-files-json', JSON.stringify(['lib/task-platform/factory-delivery.js']),
  ], {});

  assert.equal(options.requireRealEvidence, true);
  assert.deepEqual(options.checks, EXECUTED_CHECKS);
  assert.deepEqual(options.requiredChecks, REQUIRED_CHECKS);
  assert.equal(options.branchProtection.source, 'github_branch_protection');
  assert.deepEqual(options.mergeReadiness, { name: 'Merge readiness', reviewStatus: 'passed' });
  assert.deepEqual(options.changedFiles, ['lib/task-platform/factory-delivery.js']);
  assert.equal(options.checksProvided, true);
  assert.equal(options.requiredChecksProvided, true);
  assert.equal(options.mergeReadinessProvided, true);
});

test('golden-path phase runner parses manual branch-protection inventory evidence', () => {
  const previousArgv = process.argv;
  try {
    process.argv = [
      'node',
      'scripts/run-golden-path-phases.js',
      '--checks-json', JSON.stringify(EXECUTED_CHECKS),
      '--required-checks-json', JSON.stringify(REQUIRED_CHECKS),
      '--branch-protection-json', JSON.stringify(BRANCH_PROTECTION),
      '--merge-readiness-json', JSON.stringify({ name: 'Merge readiness', reviewStatus: 'passed' }),
    ];
    const options = buildGoldenPathPhaseOptions();
    assert.deepEqual(options.checks, EXECUTED_CHECKS);
    assert.deepEqual(options.requiredChecks, REQUIRED_CHECKS);
    assert.equal(options.branchProtection.source, 'github_branch_protection');
  } finally {
    process.argv = previousArgv;
  }
});

test('real-evidence collection options and env flags require strict proof', () => {
  const previousCollect = process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
  try {
    delete process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
    assert.equal(isRealEvidenceRequired({ collectRealEvidence: true }), true);

    process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE = 'true';
    assert.equal(isRealEvidenceRequired({}), true);
  } finally {
    if (previousCollect == null) delete process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
    else process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE = previousCollect;
  }
});

test('autonomous implementation proof rejects default pilot PR 271', () => {
  assert.throws(
    () => assertRealImplementationEvidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
      prNumber: 271,
    }),
    /default pilot PR #271/,
  );
});

test('autonomous implementation proof rejects PR number and URL mismatches', () => {
  assert.throws(
    () => assertRealImplementationEvidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
    }),
    /pull request number must match pull request URL/,
  );
});

test('autonomous implementation proof rejects non-GitHub and non-PR URLs', () => {
  assert.throws(
    () => assertRealImplementationEvidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      prUrl: 'https://git.example.com/wiinc1/engineering-team/pull/417',
    }),
    /pull request URL must be a github\.com pull request URL/,
  );
  assert.throws(
    () => assertRealImplementationEvidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      prUrl: 'https://github.com/wiinc1/engineering-team/issues/417',
    }),
    /pull request URL must be a github\.com pull request URL/,
  );
});

test('autonomous implementation proof accepts explicit real branch commit and PR evidence', () => {
  const proof = assertRealImplementationEvidence({}, {
    agentDrivenPhases: true,
    ...REAL_PROOF,
  });

  assert.equal(proof.branchName, REAL_PROOF.branchName);
  assert.equal(proof.commitSha, REAL_PROOF.commitSha);
  assert.equal(proof.prNumber, REAL_PROOF.prNumber);
});

test('autonomous release proof rejects skipped validation, SRE waivers, and missing merge readiness', () => {
  assert.throws(
    () => assertRealPhase6Evidence({}, {
      agentDrivenPhases: true,
      skipValidation: true,
      allowSreWaiver: true,
      requireHealthyDeployment: false,
      ...REAL_PROOF,
      ...REAL_SCOPE,
      releaseEvidenceValidator: () => ({ ok: false, stdout: 'missing deploy-record' }),
    }),
    /deploy validation cannot be skipped.*SRE waiver is not valid.*post-deploy health validation cannot be disabled.*branch-protection required check inventory.*GitHub Merge readiness/s,
  );
});

test('autonomous phase runner rejects skip validation and SRE waiver before partial real-evidence runs', async () => {
  await assert.rejects(
    () => runGoldenPathPhases({
      agentDrivenPhases: true,
      skipValidation: true,
      allowSreWaiver: true,
      requireHealthyDeployment: false,
      pilot: { status: 'phase1_complete' },
      baseUrl: 'http://127.0.0.1:13000',
      jwtSecret: 'test-secret',
    }),
    /cannot use skip validation or SRE waiver or disabled deployment health validation/,
  );
});

test('autonomous phase runner collects real evidence and fails without a PR target', async () => {
  await assert.rejects(
    () => runGoldenPathPhases({
      agentDrivenPhases: true,
      pilot: { status: 'phase1_complete' },
      baseUrl: 'http://127.0.0.1:13000',
      jwtSecret: 'test-secret',
    }),
    /requires an actual pull request target/,
  );
});

test('autonomous release proof rejects docs-only scope and missing code change evidence', () => {
  assert.throws(
    () => assertRealPhase6Evidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      changeKind: 'docs-only',
      templateTier: 'Simple',
      changedFiles: ['docs/runbook.md'],
      checks: [{ name: 'unit tests', conclusion: 'success', source: 'github_check_run' }],
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
      releaseEvidenceValidator: () => ({ ok: true, stdout: 'PASS release evidence' }),
    }),
    /code-bearing change kind is required.*implementation code file change/s,
  );
});

test('autonomous release proof rejects dev-only release evidence', () => {
  assert.throws(
    () => assertRealPhase6Evidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      ...REAL_SCOPE,
      releaseEnv: 'dev',
      checks: [{ name: 'unit tests', conclusion: 'success', source: 'github_check_run' }],
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
      releaseEvidenceValidator: () => ({ ok: true, stdout: 'PASS release evidence' }),
    }),
    /hosted staging\/prod release evidence is required; got dev/,
  );
});

test('autonomous release proof accepts successful test checks and passed merge readiness evidence', () => {
  const proof = assertRealPhase6Evidence({}, {
    agentDrivenPhases: true,
    ...REAL_PROOF,
    ...REAL_SCOPE,
    checks: [
      { name: 'unit tests', conclusion: 'success', source: 'github_check_run' },
      { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
    ],
    requiredChecks: REQUIRED_CHECKS, branchProtection: BRANCH_PROTECTION,
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    releaseEvidenceValidator: () => ({ ok: true, stdout: 'PASS release evidence' }),
  });

  assert.equal(proof.prNumber, REAL_PROOF.prNumber);
});

test('strict implementer artifact resolution refuses generated fallbacks', () => {
  assert.throws(
    () => resolveImplementerArtifacts({ delegated: true, message: 'implemented' }, { requireRealEvidence: true }),
    /branchName, commitSha, and prUrl/,
  );
});

test('strict implementer artifact resolution rejects malformed real evidence', () => {
  assert.throws(
    () => resolveImplementerArtifacts({
      delegated: true,
      message: JSON.stringify({
        branchName: REAL_PROOF.branchName,
        commitSha: 'not-a-real-sha',
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
        prNumber: 271,
      }),
    }, { requireRealEvidence: true }),
    /valid 40-character commitSha.*non-default prUrl/,
  );
});

test('strict implementer artifact resolution rejects mismatched PR evidence', () => {
  assert.throws(
    () => resolveImplementerArtifacts({
      delegated: true,
      message: JSON.stringify({
        ...REAL_PROOF,
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
      }),
    }, { requireRealEvidence: true }),
    /matching prNumber and prUrl/,
  );
});

test('strict implementer artifact resolution accepts real JSON artifacts', () => {
  const artifacts = resolveImplementerArtifacts({
    delegated: true,
    message: JSON.stringify(REAL_PROOF),
  }, { requireRealEvidence: true });

  assert.equal(artifacts.branchName, REAL_PROOF.branchName);
  assert.equal(artifacts.commitSha, REAL_PROOF.commitSha);
  assert.equal(artifacts.prUrl, REAL_PROOF.prUrl);
});

test('release evidence validation defaults to prod only for strict real-evidence mode', () => {
  assert.equal(resolveReleaseEvidenceEnvironment({ env: {} }), null);
  assert.equal(resolveReleaseEvidenceEnvironment({ releaseEnv: 'production', env: {} }), 'prod');
  assert.equal(resolveReleaseEvidenceEnvironment({ requireRealEvidence: true, env: {} }), 'prod');
});

test('release evidence validation reports hosted proof failures without throwing', async () => {
  const result = await runReleaseEvidenceValidation({
    releaseEnv: 'staging',
    env: {},
    releaseEvidenceValidator: ({ environment }) => ({
      ok: false,
      stdout: `FAIL ${environment} missing deploy-record`,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.environment, 'staging');
  assert.match(result.stdout, /missing deploy-record/);
});
