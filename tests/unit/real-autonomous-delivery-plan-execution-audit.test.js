const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PLAN_SCHEMA_VERSION } = require('../../scripts/plan-real-autonomous-delivery');
const { sha256 } = require('../../scripts/execute-real-autonomous-delivery-plan');
const {
  EXECUTION_AUDIT_SCHEMA_VERSION,
  FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
  auditPlanExecutionEvidence,
  executionReportFailures,
  finalVerificationCommandFailures,
  finalVerificationReportFailures,
} = require('../../scripts/verify-real-autonomous-delivery-plan-execution');

const SCRIPT = path.join(__dirname, '../..', 'scripts/verify-real-autonomous-delivery-plan-execution.js');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/418';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

function command(overrides = {}) {
  const argv = ['node', '-e', 'process.exit(0)'];
  return {
    id: 'candidate-proof',
    description: 'Collect candidate proof.',
    argv,
    command: "node -e 'process.exit(0)'",
    requires: [],
    ready: true,
    blockedBy: [],
    ...overrides,
  };
}

function defaultArtifacts(overrides = {}) {
  return {
    sourceEvidencePath: 'observability/golden-path-postgres-pilot.json',
    candidateProofPath: 'observability/real-delivery-candidate-proof.json',
    finalVerificationReportPath: 'observability/real-autonomous-delivery-verification-report.json',
    ...overrides,
  };
}

function finalVerificationCommand(reportPath) {
  const argv = ['node', 'scripts/verify-real-autonomous-delivery.js', '--report', reportPath];
  return command({
    id: 'final-verification',
    description: 'Verify final autonomous delivery evidence.',
    argv,
    command: argv.join(' '),
  });
}

function readyPlan(overrides = {}) {
  const artifacts = defaultArtifacts(overrides.artifacts);
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    ok: true,
    blocked: false,
    blockedBy: [],
    failureCount: 0,
    failures: [],
    inputs: {
      releaseEnv: 'staging',
      branchName: 'feat/real-delivery',
      implementationCommitSha: COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 418,
      deploymentUrl: DEPLOYMENT_URL,
    },
    commands: [
      command({ id: 'candidate-proof', command: "node -e 'process.exit(0)'" }),
      command({ id: 'hosted-preflight', command: "node -e 'process.exit(0)'" }),
    ],
    postMergeCommands: [
      command({ id: 'final-release-artifacts', command: "node -e 'process.exit(0)'" }),
      finalVerificationCommand(artifacts.finalVerificationReportPath),
    ],
    ...overrides,
    artifacts,
  };
}

function withFinalVerificationReportPath(plan, reportPath) {
  return {
    ...plan,
    artifacts: defaultArtifacts({ ...plan.artifacts, finalVerificationReportPath: reportPath }),
    postMergeCommands: (plan.postMergeCommands || []).map((item) => (
      item.id === 'final-verification' ? finalVerificationCommand(reportPath) : item
    )),
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function digestFor(filePath) {
  return { algorithm: 'sha256', value: sha256(fs.readFileSync(filePath)), path: filePath };
}

function reportFor(planPath, plan, stage, overrides = {}) {
  const selected = stage === 'post-merge' ? plan.postMergeCommands : plan.commands;
  const digest = sha256(fs.readFileSync(planPath, 'utf8'));
  const execute = stage === 'post-merge';
  return {
    ok: true,
    schemaVersion: 'real-autonomous-delivery-plan-execution.v1',
    planSchemaVersion: PLAN_SCHEMA_VERSION,
    planPath,
    planDigest: { algorithm: 'sha256', value: digest, source: 'file' },
    stage,
    commandId: null,
    execute,
    dryRun: !execute,
    commandCount: selected.length,
    failures: [],
    commands: selected.map((item) => ({
      id: item.id,
      command: item.command,
      ready: true,
      requires: item.requires || [],
    })),
    results: execute ? selected.map((item) => ({ id: item.id, status: 0, signal: null })) : [],
    ...overrides,
  };
}

function writeArtifacts(tmp, plan = readyPlan()) {
  const finalVerificationReportPath = path.join(tmp, 'final-verification.json');
  const sourceEvidencePath = writeJson(path.join(tmp, 'source-evidence.json'), { status: 'phase6_complete' });
  const candidateProofPath = writeJson(path.join(tmp, 'candidate-proof.json'), {
    schemaVersion: 'real-delivery-candidate-proof.v1',
  });
  const planWithEvidence = {
    ...plan,
    artifacts: defaultArtifacts({ ...plan.artifacts, sourceEvidencePath, candidateProofPath }),
  };
  const planWithArtifacts = withFinalVerificationReportPath(planWithEvidence, finalVerificationReportPath);
  const planPath = writeJson(path.join(tmp, 'real-delivery-plan.json'), planWithArtifacts);
  writeJson(finalVerificationReportPath, {
    schemaVersion: FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: true,
    failureCount: 0,
    failures: [],
    releaseEnv: 'staging',
    evidencePath: planWithArtifacts.artifacts.sourceEvidencePath,
    candidateProofPath: planWithArtifacts.artifacts.candidateProofPath,
    artifactDigests: {
      evidence: digestFor(planWithArtifacts.artifacts.sourceEvidencePath),
      candidateProof: digestFor(planWithArtifacts.artifacts.candidateProofPath),
    },
    expected: {
      branch: 'feat/real-delivery',
      commitSha: COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 418,
      deploymentUrl: DEPLOYMENT_URL,
    },
  });
  const preMergePath = writeJson(path.join(tmp, 'pre.json'), reportFor(planPath, planWithArtifacts, 'pre-merge'));
  const postMergePath = writeJson(path.join(tmp, 'post.json'), reportFor(planPath, planWithArtifacts, 'post-merge'));
  return { plan: planWithArtifacts, planPath, preMergePath, postMergePath, finalVerificationReportPath };
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
  });
}

function verifierOk() {
  return { ok: true, failures: [] };
}

function auditFixtureOptions(artifacts, overrides = {}) {
  return {
    planPath: artifacts.planPath,
    preMergeReportPath: artifacts.preMergePath,
    postMergeReportPath: artifacts.postMergePath,
    realAutonomousDeliveryVerifier: verifierOk,
    ...overrides,
  };
}

test('real delivery plan execution audit accepts matching pre and post reports', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-audit-'));
  const artifacts = writeArtifacts(tmp);
  const result = auditPlanExecutionEvidence(auditFixtureOptions(artifacts));

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, EXECUTION_AUDIT_SCHEMA_VERSION);
  assert.deepEqual(result.failures, []);
  assert.equal(result.planDigest.value, sha256(fs.readFileSync(artifacts.planPath, 'utf8')));
});

test('real delivery plan execution audit rejects stale final artifact digests', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-stale-digest-'));
  const artifacts = writeArtifacts(tmp);
  fs.writeFileSync(artifacts.plan.artifacts.sourceEvidencePath, '{"changed":true}\n');
  const result = auditPlanExecutionEvidence(auditFixtureOptions(artifacts));

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /artifactDigests\.evidence\.value must match current evidence artifact SHA-256/);
});

test('real delivery plan execution audit CLI rejects forged final verification artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-audit-cli-'));
  const { planPath, preMergePath, postMergePath } = writeArtifacts(tmp);
  const auditPath = path.join(tmp, 'audit.json');

  const result = runCli([
    '--plan', planPath,
    '--pre-merge-report', preMergePath,
    '--post-merge-report', postMergePath,
    '--report', auditPath,
    '--json',
  ]);

  assert.equal(result.status, 1);
  const stdoutReport = JSON.parse(result.stdout);
  assert.equal(stdoutReport.ok, false);
  assert.match(stdoutReport.failures.join('\n'), /independent final verification must pass/);
  assert.deepEqual(JSON.parse(fs.readFileSync(auditPath, 'utf8')), stdoutReport);
});

test('real delivery plan execution audit re-runs the final verifier', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-audit-verifier-'));
  const artifacts = writeArtifacts(tmp);
  const result = auditPlanExecutionEvidence(auditFixtureOptions(artifacts, {
    realAutonomousDeliveryVerifier: () => ({
      ok: false,
      failures: ['candidate proof local git clean evidence is required'],
    }),
  }));

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /independent final verification must pass: candidate proof local git clean evidence is required/);
});

test('real delivery plan execution audit rejects digest mismatch and failed post command', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-audit-bad-'));
  const finalVerificationReportPath = path.join(tmp, 'final-verification.json');
  const plan = withFinalVerificationReportPath(readyPlan(), finalVerificationReportPath);
  const planPath = writeJson(path.join(tmp, 'plan.json'), plan);
  writeJson(finalVerificationReportPath, {
    schemaVersion: FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: true,
    failureCount: 0,
    failures: [],
    releaseEnv: 'staging',
    evidencePath: plan.artifacts.sourceEvidencePath,
    candidateProofPath: plan.artifacts.candidateProofPath,
    expected: {
      branch: 'feat/real-delivery',
      commitSha: COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 418,
      deploymentUrl: DEPLOYMENT_URL,
    },
  });
  const preMergePath = writeJson(path.join(tmp, 'pre.json'), {
    ...reportFor(planPath, plan, 'pre-merge'),
    planDigest: { algorithm: 'sha256', value: '0'.repeat(64), source: 'file' },
  });
  const post = reportFor(planPath, plan, 'post-merge');
  post.results[1] = { id: 'final-verification', status: 1, signal: null };
  const postMergePath = writeJson(path.join(tmp, 'post.json'), post);

  const result = auditPlanExecutionEvidence({
    planPath,
    preMergeReportPath: preMergePath,
    postMergeReportPath: postMergePath,
    realAutonomousDeliveryVerifier: verifierOk,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /pre-merge execution report planDigest must match saved plan SHA-256/);
  assert.match(result.failures.join('\n'), /post-merge execution report command final-verification must exit with status 0/);
});

test('real delivery plan execution audit rejects missing report paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-audit-missing-'));
  const artifacts = writeArtifacts(tmp);
  const result = auditPlanExecutionEvidence({
    planPath: artifacts.planPath,
    realAutonomousDeliveryVerifier: verifierOk,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /pre-merge execution report path is required/);
  assert.match(result.failures.join('\n'), /post-merge execution report path is required/);
});

test('execution report validator checks selected command identity', () => {
  const failures = executionReportFailures('pre-merge execution report', {
    schemaVersion: 'real-autonomous-delivery-plan-execution.v1',
    ok: true,
    planSchemaVersion: PLAN_SCHEMA_VERSION,
    planDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    stage: 'pre-merge',
    execute: false,
    dryRun: true,
    commandCount: 1,
    failures: [],
    commands: [{ id: 'wrong', command: 'node -e true', ready: true }],
    results: [],
  }, {
    planDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    stage: 'pre-merge',
    execute: false,
    dryRun: true,
    commands: [command({ id: 'expected', command: 'node -e false' })],
  });

  assert.match(failures.join('\n'), /command 1 id must match plan command expected/);
  assert.match(failures.join('\n'), /command expected must match plan command text/);
});

test('execution audit requires a passing final verification report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-final-report-'));
  const finalVerificationReportPath = path.join(tmp, 'final-verification.json');
  const plan = withFinalVerificationReportPath(readyPlan(), finalVerificationReportPath);
  const planPath = writeJson(path.join(tmp, 'plan.json'), plan);
  const preMergePath = writeJson(path.join(tmp, 'pre.json'), reportFor(planPath, plan, 'pre-merge'));
  const postMergePath = writeJson(path.join(tmp, 'post.json'), reportFor(planPath, plan, 'post-merge'));
  writeJson(finalVerificationReportPath, {
    schemaVersion: FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: false,
    failureCount: 1,
    failures: ['candidate proof mismatch'],
    evidencePath: 'observability/unplanned.json',
    candidateProofPath: plan.artifacts.candidateProofPath,
  });

  const result = auditPlanExecutionEvidence({
    planPath,
    preMergeReportPath: preMergePath,
    postMergeReportPath: postMergePath,
    realAutonomousDeliveryVerifier: verifierOk,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /final verification report must be ok/);
  assert.match(result.failures.join('\n'), /final verification report failureCount must be 0/);
  assert.match(result.failures.join('\n'), /final verification report failures must be empty/);
  assert.match(result.failures.join('\n'), /final verification report evidencePath must match planned final evidence command input/);
});

test('final verification report validator checks schema and proof continuity targets', () => {
  const failures = finalVerificationReportFailures({
    schemaVersion: 'wrong',
    ok: true,
    failureCount: 0,
    failures: [],
    evidencePath: 'observability/wrong-evidence.json',
    candidateProofPath: 'observability/wrong-candidate.json',
  }, readyPlan());

  assert.match(failures.join('\n'), /schemaVersion must be real-autonomous-delivery-verification-report\.v1/);
  assert.match(failures.join('\n'), /evidencePath must match planned final evidence command input/);
  assert.match(failures.join('\n'), /candidateProofPath must match planned candidate proof/);
});

test('execution audit rejects final verification report path overrides and command mismatches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-report-path-'));
  const artifacts = writeArtifacts(tmp);
  const result = auditPlanExecutionEvidence({
    ...auditFixtureOptions(artifacts),
    finalVerificationReportPath: path.join(tmp, 'other-final-verification.json'),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /final verification report path override must match saved plan artifact path/);
});

test('final verification command validator requires --report to match the planned artifact', () => {
  const plan = readyPlan({
    postMergeCommands: [
      command({ id: 'final-release-artifacts', command: "node -e 'process.exit(0)'" }),
      finalVerificationCommand('observability/other-final-verification.json'),
    ],
  });
  const failures = finalVerificationCommandFailures(
    plan,
    plan.artifacts.finalVerificationReportPath,
  );

  assert.match(failures.join('\n'), /command --report must match final verification report path/);
});

test('final verification report validator checks expected identity against the plan', () => {
  const failures = finalVerificationReportFailures({
    schemaVersion: FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: true,
    failureCount: 0,
    failures: [],
    releaseEnv: 'prod',
    evidencePath: readyPlan().artifacts.sourceEvidencePath,
    candidateProofPath: readyPlan().artifacts.candidateProofPath,
    expected: {
      branch: 'feat/other',
      commitSha: COMMIT_SHA,
      mergeCommitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      prUrl: PR_URL,
      prNumber: 419,
      deploymentUrl: DEPLOYMENT_URL,
    },
  }, readyPlan());

  assert.match(failures.join('\n'), /releaseEnv must match saved plan/);
  assert.match(failures.join('\n'), /expected.branch must match saved plan/);
  assert.match(failures.join('\n'), /expected\.mergeCommitSha: actual non-fixture/);
  assert.match(failures.join('\n'), /expected.prNumber must match saved plan/);
});

test('final verification report validator requires merge commit proof', () => {
  const failures = finalVerificationReportFailures({
    schemaVersion: FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: true,
    failureCount: 0,
    failures: [],
    releaseEnv: 'staging',
    evidencePath: readyPlan().artifacts.sourceEvidencePath,
    candidateProofPath: readyPlan().artifacts.candidateProofPath,
    expected: {
      branch: 'feat/real-delivery',
      commitSha: COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 418,
      deploymentUrl: DEPLOYMENT_URL,
    },
  }, readyPlan());

  assert.match(failures.join('\n'), /expected\.mergeCommitSha is required/);
});
