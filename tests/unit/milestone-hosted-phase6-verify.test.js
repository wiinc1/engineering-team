const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMilestoneHostedPhase6Verify } = require('../../lib/audit/milestone-hosted-phase6-verify');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const CHANGED_FILES = [
  'lib/audit/milestone-hosted-phase6-verify.js',
  'tests/unit/milestone-hosted-phase6-verify.test.js',
];
const REQUIRED_CHECKS = ['build', 'unit tests', 'Merge readiness'];
const BRANCH_PROTECTION = { branch: 'main', requiredChecks: REQUIRED_CHECKS, source: 'github_branch_protection' };
const ROLLBACK_EVIDENCE = {
  environment: 'staging',
  commit_sha: COMMIT_SHA,
  rollback_target: 'release-previous',
  verification_status: 'verified',
  verified_at: '2026-07-05T00:00:00.000Z',
};
const RELEASE_ARTIFACT_COMMANDS = {
  build: 'npm run build',
  compatibility: 'npm run test:unit',
  vulnerability: 'npm audit --audit-level=high',
  secret: 'npm run secrets:scan',
};

function releaseProofOptions() {
  return {
    rollbackVerified: true,
    rollbackEvidence: ROLLBACK_EVIDENCE,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactCommands: RELEASE_ARTIFACT_COMMANDS,
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function releaseArtifactBase(artifactName, sourceSystem) {
  return {
    schema_version: '1.0',
    generated_by: 'release-artifact-evidence-builder',
    generated_at: '2026-07-05T00:00:00.000Z',
    environment: 'staging',
    commit_sha: COMMIT_SHA,
    source_system: sourceSystem,
    artifact_name: artifactName,
  };
}

function passedCheckArtifact(artifactName, checkName) {
  return {
    ...releaseArtifactBase(artifactName, 'command'),
    status: 'passed',
    check_name: checkName,
  };
}

function buildArtifacts(dir) {
  return {
    build: writeJson(path.join(dir, 'build.json'), passedCheckArtifact('build', 'build')),
    compatibility: writeJson(path.join(dir, 'compatibility-report.json'), passedCheckArtifact('compatibility-report', 'unit tests')),
    vulnerability: writeJson(path.join(dir, 'vulnerability-scan.json'), passedCheckArtifact('vulnerability-scan', 'Dependency vulnerability scan')),
    secret: writeJson(path.join(dir, 'secret-scan.json'), passedCheckArtifact('secret-scan', 'Secret scan')),
    immutable: writeJson(path.join(dir, 'immutable-artifact.json'), {
      ...releaseArtifactBase('immutable-artifact', 'git'),
      digest: 'abc123',
      artifact_id: `wiinc1/engineering-team@${COMMIT_SHA}`,
    }),
    deploy: writeJson(path.join(dir, 'deploy-record.json'), {
      ...releaseArtifactBase('deploy-record', 'deployment-provider'),
      deployed_sha: COMMIT_SHA,
      deployment_url: DEPLOYMENT_URL,
      rollback_target: 'release-previous',
      status: 'deployed',
    }),
    health: writeJson(path.join(dir, 'post-deploy-health.json'), {
      ...releaseArtifactBase('post-deploy-health', 'http-health-check'),
      checked_sha: COMMIT_SHA,
      deployment_url: DEPLOYMENT_URL,
      status: 'healthy',
      commit_verified: true,
    }),
    rollback: writeJson(path.join(dir, 'rollback-verification.json'), {
      ...releaseArtifactBase('rollback-verification', 'deployment-provider'),
      rollback_target: 'release-previous',
      verification_status: 'verified',
      verified_at: '2026-07-05T00:00:00.000Z',
    }),
  };
}

function realAutoMergeEvidence() {
  return {
    ok: true,
    skipped: false,
    simulated: false,
    reason: 'merged',
    merged: true,
    mergeCommitSha: COMMIT_SHA,
    mergedAt: '2026-07-04T12:30:00.000Z',
    prUrl: PR_URL,
    prNumber: 417,
  };
}

function realCandidateProof() {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    checks: [
      { name: 'build', status: 'completed', conclusion: 'success', source: 'github_check_run' },
      { name: 'unit tests', status: 'completed', conclusion: 'success', source: 'github_check_run' },
      { name: 'Merge readiness', status: 'completed', conclusion: 'success', source: 'github_check_run' },
    ],
    requiredChecks: REQUIRED_CHECKS,
    branchProtection: BRANCH_PROTECTION,
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    githubEvidenceSource: {
      provider: 'github',
      apiBaseUrl: 'https://api.github.com',
      collectedAt: '2026-07-04T12:00:00.000Z',
    },
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true },
    requireHealthCommit: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: ROLLBACK_EVIDENCE,
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
    changedFiles: CHANGED_FILES,
    implementationFiles: ['lib/audit/milestone-hosted-phase6-verify.js'],
    testFiles: ['tests/unit/milestone-hosted-phase6-verify.test.js'],
    testCommands: ['node --test tests/unit/milestone-hosted-phase6-verify.test.js'],
    testCommandResults: [{
      command: 'node --test tests/unit/milestone-hosted-phase6-verify.test.js',
      ok: true,
      exitCode: 0,
    }],
    localGit: { branch: 'feat/autonomous-real-proof', commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
    failures: [],
  };
}

function writeCandidateProof(dir) {
  return writeJson(path.join(dir, 'candidate-proof.json'), realCandidateProof());
}

function buildHostedEvidence(tmp, overrides = {}) {
  return {
    status: 'phase6_complete',
    baseUrl: 'https://api.factory.openclaw.app',
    operatorUrl: DEPLOYMENT_URL,
    engineeringTeam: { taskId: 'TSK-PROOF', templateTier: 'Standard' },
    forgeadapter: { taskId: 'TSK-GOLDENPROOF' },
    github: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/autonomous-real-proof',
      commitSha: COMMIT_SHA,
      merged: true,
      mergeCommitSha: COMMIT_SHA,
      mergedAt: '2026-07-04T12:30:00.000Z',
      prUrl: PR_URL,
      prNumber: 417,
      changedFiles: CHANGED_FILES,
      checks: [
        { name: 'build', status: 'completed', conclusion: 'success', source: 'github_check_run' },
        { name: 'unit tests', status: 'completed', conclusion: 'success', source: 'github_check_run' },
        { name: 'Merge readiness', status: 'completed', conclusion: 'success', source: 'github_check_run' },
      ],
      requiredChecks: REQUIRED_CHECKS,
      branchProtection: BRANCH_PROTECTION,
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
      evidenceSource: {
        provider: 'github',
        apiBaseUrl: 'https://api.github.com',
        collectedAt: '2026-07-04T12:00:00.000Z',
      },
    },
    change: { kind: 'bugfix', changedFiles: CHANGED_FILES },
    phase6: {
      api: {
        validation: { ok: true },
        autoMerge: realAutoMergeEvidence(),
        sreMonitoring: { agentSessionId: 'sre-session-1' },
      },
    },
    releaseEvidence: {
      environment: 'staging',
      artifacts: buildArtifacts(tmp),
      validation: { ok: true, skipped: false },
    },
    ...overrides,
  };
}

function hostedPhase6ProofRunOptions(tmp, outputPath, candidateProofPath, runPhasesFn) {
  return {
    baseUrl: 'https://api.factory.openclaw.app',
    jwtSecret: 'secret',
    pilot: {
      factoryQueueId: 'factory-proof',
      status: 'phase5_complete',
      engineeringTeam: { taskId: 'TSK-PROOF' },
      forgeadapter: { taskId: 'TSK-GOLDENPROOF' },
    },
    evidencePath: path.join(tmp, 'factory-evidence.json'),
    candidateProofPath,
    outputPath,
    branchName: 'feat/autonomous-real-proof',
    implementationCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    productionSafetyEvidence: 'observability/release/production-safety.json',
    rollbackTarget: 'release-previous',
    ...releaseProofOptions(),
    autoMerge: true,
    githubToken: 'gh-token',
    changeKind: 'bugfix',
    templateTier: 'Standard',
    changedFiles: CHANGED_FILES,
    runPhasesFn,
  };
}

function assertForwardedStrictOptions(captured, candidateProofPath) {
  assert.equal(captured.collectRealEvidence, true);
  assert.equal(captured.requireRealEvidence, true);
  assert.equal(captured.candidateProofPath, candidateProofPath);
  assert.equal(captured.agentDrivenPhases, true);
  assert.equal(captured.prUrl, PR_URL);
  assert.equal(captured.releaseEnv, 'staging');
  assert.equal(captured.deploymentUrl, DEPLOYMENT_URL);
  assert.equal(captured.productionSafetyEvidence, 'observability/release/production-safety.json');
  assert.equal(captured.rollbackTarget, 'release-previous');
  assert.equal(captured.rollbackEvidence, ROLLBACK_EVIDENCE);
  assert.equal(captured.rollbackVerified, true);
  assert.equal(captured.healthCheckPath, '/version');
  assert.equal(captured.requireHealthCommit, true);
  assert.deepEqual(captured.releaseArtifactCommands, RELEASE_ARTIFACT_COMMANDS);
  assert.equal(captured.autoMerge, true);
  assert.equal(captured.githubToken, 'gh-token');
  assert.equal(captured.changeKind, 'bugfix');
  assert.deepEqual(captured.changedFiles, CHANGED_FILES);
}

test('hosted phase 6 verify requires evidence and hosted base URL', async () => {
  await assert.rejects(
    () => runMilestoneHostedPhase6Verify({ baseUrl: 'https://api.factory.openclaw.app', jwtSecret: 'secret' }),
    /requires factory evidence/,
  );
});

test('hosted phase 6 verify rejects local base URL without override', async () => {
  await assert.rejects(
    () => runMilestoneHostedPhase6Verify({
      baseUrl: 'http://127.0.0.1:13000',
      jwtSecret: 'secret',
      pilot: { factoryQueueId: 'factory-test', status: 'phase5_complete' },
    }),
    /non-local base URL/,
  );
});

test('hosted phase 6 verify preflights real PR and deploy proof before replay', async () => {
  await assert.rejects(
    () => runMilestoneHostedPhase6Verify({
      baseUrl: 'https://api.factory.openclaw.app',
      jwtSecret: 'secret',
      pilot: { factoryQueueId: 'factory-test', status: 'phase5_complete' },
    }),
    /Hosted phase 6 replay preflight failed: .*pull request target.*deployment-url.*rollback-target.*rollback-verified/s,
  );
});

test('hosted phase 6 verify forwards strict real-evidence options to phase runner', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-phase6-proof-'));
  const outputPath = path.join(tmp, 'phase6-result.json');
  const candidateProofPath = writeCandidateProof(tmp);
  let captured = null;
  const result = await runMilestoneHostedPhase6Verify(hostedPhase6ProofRunOptions(
    tmp,
    outputPath,
    candidateProofPath,
    async (options) => {
      captured = options;
      writeJson(options.outputPath, buildHostedEvidence(tmp));
      return { evidence: { status: 'phase6_complete' }, outputPath: options.outputPath };
    },
  ));

  assert.equal(result.summary.passed, true);
  assert.equal(result.summary.realDeliveryAuditOk, true);
  assertForwardedStrictOptions(captured, candidateProofPath);
  assert.equal(result.artifacts.candidateProof, candidateProofPath);
});

test('hosted phase 6 verify fails summary when phase6 output is simulated evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-phase6-simulated-'));
  const outputPath = path.join(tmp, 'phase6-result.json');
  const candidateProofPath = writeCandidateProof(tmp);
  const result = await runMilestoneHostedPhase6Verify({
    baseUrl: 'https://api.factory.openclaw.app',
    jwtSecret: 'secret',
    pilot: {
      factoryQueueId: 'factory-proof',
      status: 'phase5_complete',
      engineeringTeam: { taskId: 'TSK-PROOF' },
      forgeadapter: { taskId: 'TSK-GOLDENPROOF' },
    },
    outputPath,
    candidateProofPath,
    branchName: 'feat/autonomous-real-proof',
    implementationCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    ...releaseProofOptions(),
    autoMerge: true,
    githubToken: 'gh-token',
    changeKind: 'bugfix',
    templateTier: 'Standard',
    changedFiles: CHANGED_FILES,
    runPhasesFn: async (options) => {
      writeJson(options.outputPath, {
        status: 'phase6_complete',
        baseUrl: 'http://127.0.0.1:13000',
        operatorUrl: 'http://127.0.0.1:15173',
        phase6: {
          api: {
            validation: { ok: true },
            sreMonitoring: { waiver: true },
          },
        },
      });
      return { evidence: { status: 'phase6_complete' }, outputPath: options.outputPath };
    },
  });

  assert.equal(result.summary.phase6Complete, true);
  assert.equal(result.summary.passed, false);
  assert.equal(result.summary.realDeliveryAuditOk, false);
  assert.match(result.realDeliveryAudit.failures.join('\n'), /hosted and non-local/);
  assert.match(result.realDeliveryAudit.failures.join('\n'), /SRE waiver is not valid/);
});
