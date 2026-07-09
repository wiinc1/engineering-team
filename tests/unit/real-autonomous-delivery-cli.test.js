const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  VERIFICATION_REPORT_SCHEMA_VERSION,
  artifactDigestsFor,
  buildVerificationReport,
  expectedFinalEvidenceFailures,
  finalDeploymentUrl,
  finalMergeCommitSha,
  shouldPrintHelp,
  usageText,
} = require('../../scripts/verify-real-autonomous-delivery');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

test('real autonomous delivery CLI prints help without requiring evidence files', () => {
  assert.equal(shouldPrintHelp(['node', 'script', '-h']), true);
  assert.match(usageText(), /--candidate-proof/);
  assert.match(usageText(), /--merge-commit-sha/);
  assert.match(usageText(), /rejects local URLs/);

  const result = spawnSync(process.execPath, ['scripts/verify-real-autonomous-delivery.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/verify-real-autonomous-delivery\.js/);
  assert.match(result.stdout, /--release-env <staging\|prod>/);
  assert.equal(result.stderr, '');
});

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function writePrDiscoveryReport(filePath) {
  return writeJson(filePath, {
    schemaVersion: 'real-delivery-pr-target-discovery.v1',
    ok: true,
    failureCount: 0,
    failures: [],
    target: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/autonomous-real-proof',
      implementationCommitSha: COMMIT_SHA,
      prNumber: 417,
      prUrl: PR_URL,
      source: {
        provider: 'github',
        apiBaseUrl: 'https://api.github.com',
        collectedAt: '2026-07-05T00:00:00.000Z',
      },
    },
  });
}

function evidence(overrides = {}) {
  return {
    github: {
      branchName: 'feat/autonomous-real-proof',
      commitSha: COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 417,
    },
    releaseEvidence: {
      artifacts: {
        deploy: { deployment_url: DEPLOYMENT_URL },
      },
    },
    ...overrides,
  };
}

test('real autonomous delivery CLI expected identity accepts matching final evidence', () => {
  const failures = expectedFinalEvidenceFailures(evidence(), {
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    mergeCommitSha: MERGE_COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    deploymentUrl: DEPLOYMENT_URL,
  });

  assert.deepEqual(failures, []);
});

test('real autonomous delivery CLI expected identity rejects mismatched final evidence', () => {
  const failures = expectedFinalEvidenceFailures(evidence(), {
    branch: 'feat/different',
    commitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
    mergeCommitSha: '6b8f2e4d1c3a5b7e9d0f2a4c6e8b1d3f5a7c9012',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
    prNumber: 418,
    deploymentUrl: 'https://different-staging.openclaw.app',
  }).join('\n');

  assert.match(failures, /expected branch/);
  assert.match(failures, /expected commit SHA/);
  assert.match(failures, /expected merge commit SHA/);
  assert.match(failures, /expected pull request URL/);
  assert.match(failures, /expected pull request number/);
  assert.match(failures, /expected deployment URL/);
});

test('real autonomous delivery CLI expected identity rejects missing final evidence', () => {
  const failures = expectedFinalEvidenceFailures({
    github: {},
    releaseEvidence: { artifacts: {} },
  }, {
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    mergeCommitSha: MERGE_COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    deploymentUrl: DEPLOYMENT_URL,
  }).join('\n');

  assert.match(failures, /expected branch requires final GitHub branch evidence/);
  assert.match(failures, /expected commit SHA requires final GitHub commitSha evidence/);
  assert.match(failures, /expected merge commit SHA requires final merge commit evidence/);
  assert.match(failures, /expected pull request URL requires final GitHub prUrl evidence/);
  assert.match(failures, /expected pull request number requires final GitHub prNumber evidence/);
  assert.match(failures, /expected deployment URL requires final deploy evidence/);
});

test('real autonomous delivery CLI rejects expected merge commit when final evidence is missing it', () => {
  const payload = evidence({
    github: {
      branchName: 'feat/autonomous-real-proof',
      commitSha: COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 417,
    },
  });

  assert.deepEqual(expectedFinalEvidenceFailures(payload, {
    mergeCommitSha: MERGE_COMMIT_SHA,
  }), ['expected merge commit SHA requires final merge commit evidence']);
});

test('real autonomous delivery CLI can emit a JSON verification report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-verify-report-'));
  const evidencePath = writeJson(path.join(tmp, 'evidence.json'), {
    status: 'phase6_complete',
    releaseEvidence: { environment: 'staging', artifacts: {} },
    github: {},
  });
  const reportPath = path.join(tmp, 'verification-report.json');

  const result = spawnSync(process.execPath, [
    'scripts/verify-real-autonomous-delivery.js',
    '--json',
    '--report',
    reportPath,
    '--evidence',
    evidencePath,
    '--candidate-proof',
    path.join(tmp, 'missing-candidate-proof.json'),
    '--release-env',
    'staging',
    '--branch',
    'feat/autonomous-real-proof',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--merge-commit-sha',
    MERGE_COMMIT_SHA,
    '--pr-url',
    PR_URL,
    '--deployment-url',
    DEPLOYMENT_URL,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, VERIFICATION_REPORT_SCHEMA_VERSION);
  assert.equal(report.ok, false);
  assert.equal(report.releaseEnv, 'staging');
  assert.equal(report.evidencePath, evidencePath);
  assert.equal(report.candidateProofPath, path.join(tmp, 'missing-candidate-proof.json'));
  assert.equal(report.expected.branch, 'feat/autonomous-real-proof');
  assert.equal(report.expected.commitSha, COMMIT_SHA);
  assert.match(report.failures.join('\n'), /GitHub branchName is required/);
  assert.match(report.failures.join('\n'), /real-delivery candidate proof cannot be read/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('real autonomous delivery CLI hydrates expected PR identity from a discovery report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-verify-pr-report-'));
  const evidencePath = writeJson(path.join(tmp, 'evidence.json'), {
    status: 'phase6_complete',
    releaseEvidence: { environment: 'staging', artifacts: {} },
    github: {},
  });
  const prReportPath = writePrDiscoveryReport(path.join(tmp, 'pr-discovery.json'));

  const result = spawnSync(process.execPath, [
    'scripts/verify-real-autonomous-delivery.js',
    '--json',
    '--evidence',
    evidencePath,
    '--candidate-proof',
    path.join(tmp, 'missing-candidate-proof.json'),
    '--release-env',
    'staging',
    '--branch',
    'feat/autonomous-real-proof',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--use-pr-discovery-report',
    '--pr-discovery-report',
    prReportPath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.expected.prUrl, PR_URL);
  assert.equal(Number(report.expected.prNumber), 417);
  assert.match(report.failures.join('\n'), /expected pull request URL requires final GitHub prUrl evidence/);
});

test('real autonomous delivery report derives ok state from failures', () => {
  assert.deepEqual(buildVerificationReport({
    releaseEnv: 'staging',
    evidencePath: 'evidence.json',
    candidateProofPath: 'candidate.json',
    failures: [],
  }, { branch: 'feat/autonomous-real-proof' }), {
    schemaVersion: VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: true,
    releaseEnv: 'staging',
    evidencePath: 'evidence.json',
    candidateProofPath: 'candidate.json',
    artifactDigests: null,
    failureCount: 0,
    failures: [],
    expected: {
      branch: 'feat/autonomous-real-proof',
      commitSha: null,
      mergeCommitSha: null,
      prUrl: null,
      prNumber: null,
      deploymentUrl: null,
    },
  });
});

test('real autonomous delivery report records final artifact digests', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-digests-'));
  const evidencePath = writeJson(path.join(tmp, 'evidence.json'), { status: 'phase6_complete' });
  const candidateProofPath = writeJson(path.join(tmp, 'candidate-proof.json'), {
    schemaVersion: 'real-delivery-candidate-proof.v1',
  });
  const digests = artifactDigestsFor({ evidencePath, candidateProofPath }, tmp);

  assert.equal(digests.evidence.algorithm, 'sha256');
  assert.match(digests.evidence.value, /^[0-9a-f]{64}$/);
  assert.equal(digests.evidence.path, evidencePath);
  assert.equal(digests.candidateProof.algorithm, 'sha256');
  assert.match(digests.candidateProof.value, /^[0-9a-f]{64}$/);
  assert.equal(digests.candidateProof.path, candidateProofPath);
});

test('real autonomous delivery CLI reads deployment URL from release artifact files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-cli-'));
  const deployPath = writeJson(path.join(tmp, 'deploy-record.json'), {
    deployment_url: DEPLOYMENT_URL,
  });
  const payload = evidence({ releaseEvidence: { artifacts: { deploy: deployPath } } });

  assert.equal(finalDeploymentUrl(payload, tmp), DEPLOYMENT_URL);
  assert.deepEqual(expectedFinalEvidenceFailures(payload, {
    repoRoot: tmp,
    deploymentUrl: DEPLOYMENT_URL,
  }), []);
});

test('real autonomous delivery CLI reads merge commit SHA from deploy artifact files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-cli-'));
  const deployPath = writeJson(path.join(tmp, 'deploy-record.json'), {
    deployed_sha: MERGE_COMMIT_SHA,
  });
  const payload = evidence({
    github: {
      branchName: 'feat/autonomous-real-proof',
      commitSha: COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 417,
    },
    releaseEvidence: { artifacts: { deploy: deployPath } },
  });

  assert.equal(finalMergeCommitSha(payload, tmp), MERGE_COMMIT_SHA);
  assert.deepEqual(expectedFinalEvidenceFailures(payload, {
    repoRoot: tmp,
    mergeCommitSha: MERGE_COMMIT_SHA,
  }), []);
});
