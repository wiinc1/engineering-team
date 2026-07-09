const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  collectRuntimeUrls,
  isLocalOrPrivateUrl,
  verifyRealAutonomousDeliveryEvidence,
} = require('../../lib/task-platform/real-autonomous-delivery-evidence');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901', OTHER_COMMIT_SHA = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const REAL_CHANGED_FILES = ['lib/task-platform/factory-delivery.js', 'tests/unit/real-autonomous-delivery-evidence.test.js'];
const GENERATED_AT = '2026-07-05T00:00:00.000Z';
function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function releaseArtifactBase(artifactName, sourceSystem) {
  return { schema_version: '1.0', generated_by: 'release-artifact-evidence-builder', generated_at: GENERATED_AT, artifact_name: artifactName, environment: 'staging', commit_sha: MERGE_COMMIT_SHA, source_system: sourceSystem };
}

function buildArtifacts(dir, overrides = {}) {
  const checkArtifact = (name, artifactName, overridesForArtifact = {}) => ({
    ...releaseArtifactBase(artifactName, 'command'),
    status: 'passed',
    check_name: name,
    ...(overridesForArtifact || {}),
  });
  return {
    build: writeJson(path.join(dir, 'build.json'), checkArtifact('build', 'build', overrides.build)),
    compatibility: writeJson(path.join(dir, 'compatibility-report.json'), checkArtifact('unit tests', 'compatibility-report', overrides.compatibility)),
    vulnerability: writeJson(path.join(dir, 'vulnerability-scan.json'), checkArtifact('Dependency vulnerability scan', 'vulnerability-scan', overrides.vulnerability)),
    secret: writeJson(path.join(dir, 'secret-scan.json'), checkArtifact('Secret scan', 'secret-scan', overrides.secret)),
    immutable: writeJson(path.join(dir, 'immutable-artifact.json'), { ...releaseArtifactBase('immutable-artifact', 'git'), digest: 'abc123', artifact_id: `wiinc1/engineering-team@${MERGE_COMMIT_SHA}`, ...(overrides.immutable || {}) }),
    deploy: writeJson(path.join(dir, 'deploy-record.json'), { ...releaseArtifactBase('deploy-record', 'deployment-provider'), deployed_sha: MERGE_COMMIT_SHA, deployment_url: DEPLOYMENT_URL, rollback_target: 'release-previous', status: 'deployed', ...(overrides.deploy || {}) }),
    health: writeJson(path.join(dir, 'post-deploy-health.json'), { ...releaseArtifactBase('post-deploy-health', 'http-health-check'), checked_sha: MERGE_COMMIT_SHA, deployment_url: DEPLOYMENT_URL, status: 'healthy', commit_verified: true, ...(overrides.health || {}) }),
    rollback: writeJson(path.join(dir, 'rollback-verification.json'), { ...releaseArtifactBase('rollback-verification', 'deployment-provider'), rollback_target: 'release-previous', verification_status: 'verified', ...(overrides.rollback || {}) }),
  };
}
function realGithubEvidence() {
  return {
    repository: 'wiinc1/engineering-team',
    branchName: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    merged: true,
    mergeCommitSha: MERGE_COMMIT_SHA,
    mergedAt: '2026-07-04T12:30:00.000Z',
    prUrl: PR_URL,
    prNumber: 417,
    changedFiles: REAL_CHANGED_FILES,
    checks: ['build', 'unit tests', 'Merge readiness']
      .map((name) => ({ name, status: 'completed', conclusion: 'success', source: 'github_check_run' })),
    requiredChecks: ['build', 'unit tests', 'Merge readiness'],
    branchProtection: { branch: 'main', requiredChecks: ['build', 'unit tests', 'Merge readiness'], source: 'github_branch_protection' },
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    evidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-04T12:00:00.000Z' },
  };
}

function realAutoMergeEvidence() {
  return { ok: true, skipped: false, simulated: false, reason: 'merged', merged: true, mergeCommitSha: MERGE_COMMIT_SHA, mergedAt: '2026-07-04T12:30:00.000Z', prUrl: PR_URL, prNumber: 417 };
}

function realEvidence(dir, overrides = {}) {
  return {
    status: 'phase6_complete',
    baseUrl: 'https://api.factory.openclaw.app',
    operatorUrl: DEPLOYMENT_URL,
    github: realGithubEvidence(),
    engineeringTeam: { templateTier: 'Standard' },
    change: { kind: 'bugfix', changedFiles: REAL_CHANGED_FILES },
    phase6: { api: { validation: { ok: true }, autoMerge: realAutoMergeEvidence() } },
    releaseEvidence: {
      environment: 'staging',
      artifacts: buildArtifacts(dir, overrides.artifacts),
      validation: { ok: true, skipped: false },
    },
    ...overrides.evidence,
  };
}

function realCandidateProof(overrides = {}) {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417, checks: realGithubEvidence().checks, requiredChecks: realGithubEvidence().requiredChecks, mergeReadiness: realGithubEvidence().mergeReadiness, githubEvidenceSource: realGithubEvidence().evidenceSource,
    branchProtection: realGithubEvidence().branchProtection,
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true }, requireHealthCommit: true, requireFinalReleaseProof: true, verifyDeploymentHealth: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: { environment: 'staging', commit_sha: COMMIT_SHA, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' },
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
    changedFiles: REAL_CHANGED_FILES,
    implementationFiles: ['lib/task-platform/factory-delivery.js'],
    testFiles: ['tests/unit/real-autonomous-delivery-evidence.test.js'],
    testCommands: ['node --test tests/unit/real-autonomous-delivery-evidence.test.js'],
    testCommandResults: [{ command: 'node --test tests/unit/real-autonomous-delivery-evidence.test.js', ok: true, exitCode: 0 }],
    localGit: { branch: 'feat/autonomous-real-proof', commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
    failures: [],
    ...overrides,
  };
}

test('isLocalOrPrivateUrl rejects local and private runtime URLs', () => {
  assert.equal(isLocalOrPrivateUrl('http://127.0.0.1:13000'), true);
  assert.equal(isLocalOrPrivateUrl('http://192.168.1.10:13000'), true);
  assert.equal(isLocalOrPrivateUrl(DEPLOYMENT_URL), false);
});

test('collectRuntimeUrls only collects runtime URL fields', () => {
  const urls = collectRuntimeUrls({
    baseUrl: 'https://api.factory.openclaw.app',
    github: { url: 'https://github.com/wiinc1/engineering-team/pull/417' },
    deploy: { deployment_url: DEPLOYMENT_URL },
  });
  assert.deepEqual(urls.map((entry) => entry.path), ['$.baseUrl', '$.deploy.deployment_url']);
});

test('real autonomous delivery audit rejects malformed hosted URLs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-invalid-url-'));
  const evidence = realEvidence(tmp, { artifacts: { deploy: { deployment_url: 'not-a-url' }, health: { deployment_url: 'not-a-url' } }, evidence: { baseUrl: 'not-a-url' } });
  const failures = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence }).failures.join('\n');
  assert.match(failures, /\$\.baseUrl must be a valid http\(s\) URL/);
  assert.match(failures, /deploy-record\.deployment_url must be a valid http\(s\) URL/);
  assert.match(failures, /post-deploy-health\.deployment_url must be a valid http\(s\) URL/);
});

test('real autonomous delivery audit accepts hosted code-change proof with rollback evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp),
    candidateProof: realCandidateProof(),
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test('real autonomous delivery audit requires candidate proof even when callers try to disable it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-missing-candidate-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp),
    requireCandidateProof: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /real-delivery candidate proof is required/);
});

test('real autonomous delivery audit accepts matching candidate proof continuity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-match-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp),
    candidateProof: realCandidateProof(),
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test('real autonomous delivery audit rejects mismatched candidate proof continuity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-mismatch-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp),
    candidateProof: realCandidateProof({
      branch: 'feat/unrelated-branch',
      commitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
      prNumber: 418,
      deploymentUrl: 'https://unrelated-factory.openclaw.app', deploymentHealth: { ok: false, url: 'https://unrelated-factory.openclaw.app', status: 503 }, verifyDeploymentHealth: false,
      rollbackTarget: 'release-other',
      changedFiles: ['lib/task-platform/unrelated.js'],
      testCommandResults: [{ command: 'node --test tests/unit/unrelated.test.js', ok: false, exitCode: 1 }],
      sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 1, failureCount: 1, failures: [{ path: 'lib/task-platform/unrelated.js' }] },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /commitSha must match final GitHub commitSha/);
  assert.match(result.failures.join('\n'), /prNumber must match final GitHub prNumber/);
  assert.match(result.failures.join('\n'), /prUrl must match final GitHub prUrl/);
  assert.match(result.failures.join('\n'), /branch must match final GitHub branch/);
  assert.match(result.failures.join('\n'), /files must appear in final GitHub changed files/);
  assert.match(result.failures.join('\n'), /deploymentUrl must match final deploy health evidence/);
  assert.match(result.failures.join('\n'), /rollbackTarget must match final rollback evidence/);
  assert.match(result.failures.join('\n'), /test command must pass/);
  assert.match(result.failures.join('\n'), /source integrity must pass/);
});

test('real autonomous delivery audit rejects candidate test files outside changed-file scope', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-test-scope-'));
  const changedFiles = ['lib/task-platform/factory-delivery.js'];
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      evidence: {
        github: { ...realGithubEvidence(), changedFiles },
        change: { kind: 'bugfix', changedFiles },
      },
    }),
    candidateProof: realCandidateProof({
      changedFiles,
      implementationFiles: changedFiles,
      testFiles: ['tests/unit/real-autonomous-delivery-evidence.test.js'],
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /test files must be included in changedFiles/);
});

test('real autonomous delivery audit rejects final PR files outside candidate scope', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-extra-files-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      github: {
        ...realEvidence(tmp).github,
        changedFiles: [...REAL_CHANGED_FILES, 'lib/task-platform/unreviewed-extra.js'],
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence,
    candidateProof: realCandidateProof(),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /must stay within real-delivery candidate proof scope/);
});

test('real autonomous delivery audit rejects mismatched release environments', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-env-mismatch-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp),
    releaseEnv: 'prod',
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release evidence environment staging must match requested release environment prod/);
  assert.match(result.failures.join('\n'), /deploy-record.environment must match release environment prod/);
});

test('real autonomous delivery audit rejects release artifacts from another environment', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-artifact-env-mismatch-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      artifacts: {
        deploy: { environment: 'prod' },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /deploy-record.environment must match release environment staging/);
});

test('real autonomous delivery audit rejects deploy proof that does not match GitHub merge commit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-release-sha-mismatch-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      github: {
        ...realGithubEvidence(),
        mergeCommitSha: OTHER_COMMIT_SHA,
      },
      phase6: {
        api: {
          validation: { ok: true },
          autoMerge: {
            ...realAutoMergeEvidence(),
            mergeCommitSha: OTHER_COMMIT_SHA,
          },
        },
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /deploy-record\.deployed_sha must match GitHub mergeCommitSha/);
  assert.match(result.failures.join('\n'), /post-deploy-health\.checked_sha must match GitHub mergeCommitSha/);
});

test('real autonomous delivery audit rejects missing production-safe release artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-thin-release-'));
  const evidence = realEvidence(tmp);
  delete evidence.releaseEvidence.artifacts.vulnerability;
  delete evidence.releaseEvidence.artifacts.secret;
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /vulnerability-scan artifact is required/);
  assert.match(result.failures.join('\n'), /secret-scan artifact is required/);
});

test('real autonomous delivery audit rejects fixture release artifact SHAs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-fixture-sha-'));
  const fixtureSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      artifacts: {
        deploy: { deployed_sha: fixtureSha },
        health: { checked_sha: fixtureSha },
        build: { commit_sha: fixtureSha },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /deploy-record\.deployed_sha must be a non-fixture 40-character commit SHA/);
  assert.match(result.failures.join('\n'), /post-deploy-health\.checked_sha must be a non-fixture 40-character commit SHA/);
  assert.match(result.failures.join('\n'), /build\.commit_sha must be a non-fixture 40-character commit SHA/);
});

test('real autonomous delivery audit rejects hand-fed GitHub proof without API provenance', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-github-source-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      github: {
        ...realEvidence(tmp).github,
        evidenceSource: { provider: 'manual', apiBaseUrl: 'https://example.test', collectedAt: 'not-a-date' },
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /GitHub proof must be collected from GitHub API/);
  assert.match(result.failures.join('\n'), /GitHub proof API base must be https:\/\/api\.github\.com/);
  assert.match(result.failures.join('\n'), /GitHub proof collectedAt timestamp is required/);
});

test('real autonomous delivery audit rejects simulated phase 6 auto-merge evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-simulated-merge-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      phase6: {
        api: {
          validation: { ok: true },
          autoMerge: {
            ok: true,
            skipped: true,
            simulated: true,
            reason: 'missing_github_token',
            prUrl: PR_URL,
            prNumber: 417,
          },
        },
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /phase 6 auto-merge cannot be simulated/);
  assert.match(result.failures.join('\n'), /phase 6 auto-merge cannot be skipped/);
  assert.match(result.failures.join('\n'), /phase 6 auto-merge mergeCommitSha is required/);
});

test('real autonomous delivery audit rejects auto-merge commit drift from GitHub proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-merge-drift-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      phase6: {
        api: {
          validation: { ok: true },
          autoMerge: {
            ok: true,
            skipped: false,
            simulated: false,
            reason: 'merged',
            mergeCommitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
            prUrl: PR_URL,
            prNumber: 417,
          },
        },
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /auto-merge mergeCommitSha must match GitHub mergeCommitSha/);
});

test('real autonomous delivery audit rejects open GitHub PR proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-open-pr-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      github: {
        ...realEvidence(tmp).github,
        merged: false,
        mergeCommitSha: undefined,
        mergedAt: undefined,
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /GitHub proof must confirm the pull request is merged/);
  assert.match(result.failures.join('\n'), /GitHub mergeCommitSha is required/);
  assert.match(result.failures.join('\n'), /GitHub mergedAt timestamp is required/);
});

test('real autonomous delivery audit rejects auto-merge PR drift from GitHub proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-merge-pr-drift-'));
  const evidence = realEvidence(tmp, {
    evidence: {
      phase6: {
        api: {
          validation: { ok: true },
          autoMerge: {
            ok: true,
            skipped: false,
            simulated: false,
            reason: 'merged',
            mergeCommitSha: MERGE_COMMIT_SHA,
            prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
            prNumber: 418,
          },
        },
      },
    },
  });
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /auto-merge prNumber must match GitHub prNumber/);
  assert.match(result.failures.join('\n'), /auto-merge prUrl must match GitHub prUrl/);
});

test('real autonomous delivery audit rejects localhost default-PR docs-only proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simulated-delivery-'));
  const evidence = realEvidence(tmp, {
    artifacts: {
      deploy: { deployment_url: 'http://127.0.0.1:15173' },
      health: { deployment_url: 'http://127.0.0.1:15173' },
      rollback: { verification_status: 'skipped' },
    },
    evidence: {
      baseUrl: 'http://127.0.0.1:13000',
      operatorUrl: 'http://127.0.0.1:15173',
      github: {
        branchName: 'golden-path-local',
        commitSha: 'not-a-real-sha',
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
        prNumber: 271,
        changedFiles: ['docs/runbook.md'],
        checks: [{ name: 'lint', conclusion: 'success' }],
        mergeReadiness: null,
      },
      change: { kind: 'docs-only', changedFiles: ['docs/runbook.md'] },
      releaseEvidence: {
        environment: 'dev',
        artifacts: buildArtifacts(tmp, {
          deploy: { deployment_url: 'http://127.0.0.1:15173' },
          health: { deployment_url: 'http://127.0.0.1:15173' },
          rollback: { verification_status: 'skipped' },
        }),
        validation: { ok: false, skipped: true, reason: 'manual-seed' },
      },
    },
  });

  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /baseUrl.*hosted and non-local/);
  assert.match(result.failures.join('\n'), /default pilot PR #271|40-character commit SHA/);
  assert.match(result.failures.join('\n'), /code-bearing change kind|required/);
  assert.match(result.failures.join('\n'), /rollback-verification.verification_status must be verified/);
});

test('real autonomous delivery CLI fails historical local evidence artifacts', () => {
  const result = spawnSync(process.execPath, [
    'scripts/verify-real-autonomous-delivery.js',
    '--evidence',
    'observability/milestone-hosted-staging/milestone-hosted-phase6-verify.json',
  ], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /real autonomous delivery evidence failed/);
  assert.match(result.stderr, /phase6_complete|hosted and non-local|required/);
});
