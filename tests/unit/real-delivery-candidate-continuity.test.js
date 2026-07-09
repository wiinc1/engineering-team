const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateProofFailures } = require('../../lib/task-platform/real-delivery-candidate-continuity');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const CHANGED_FILES = [
  'lib/task-platform/factory-delivery.js',
  'tests/unit/real-delivery-candidate-continuity.test.js',
];
const CANDIDATE_CHECKS = [
  { name: 'unit tests', conclusion: 'success', source: 'github_check_run' },
  { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
];
const CANDIDATE_REQUIRED_CHECKS = ['unit tests', 'Merge readiness'];
const CANDIDATE_BRANCH_PROTECTION = { branch: 'main', requiredChecks: CANDIDATE_REQUIRED_CHECKS, source: 'github_branch_protection' };
const CANDIDATE_ROLLBACK_EVIDENCE = {
  environment: 'staging',
  commit_sha: COMMIT_SHA,
  rollback_target: 'release-previous',
  verification_status: 'verified',
  verified_at: '2026-07-05T00:00:00.000Z',
};
const CANDIDATE_PRODUCTION_SAFETY = productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA });

function finalEvidence() {
  return {
    github: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/autonomous-real-proof',
      commitSha: COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 417,
      changedFiles: CHANGED_FILES,
      checks: CANDIDATE_CHECKS,
      requiredChecks: CANDIDATE_REQUIRED_CHECKS,
      branchProtection: CANDIDATE_BRANCH_PROTECTION,
      mergeReadiness: { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
    },
    releaseEvidence: {
      artifacts: {
        deploy: { deployment_url: DEPLOYMENT_URL },
        health: { deployment_url: DEPLOYMENT_URL },
        rollback: { rollback_target: 'release-previous' },
      },
    },
  };
}

function candidateProof(overrides = {}) {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    repository: 'wiinc1/engineering-team',
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    checks: CANDIDATE_CHECKS,
    requiredChecks: CANDIDATE_REQUIRED_CHECKS,
    branchProtection: CANDIDATE_BRANCH_PROTECTION,
    mergeReadiness: { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
    githubEvidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' },
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true },
    requireHealthCommit: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: CANDIDATE_ROLLBACK_EVIDENCE,
    riskLevel: 'low',
    productionSafe: true,
    changedFiles: CHANGED_FILES,
    implementationFiles: ['lib/task-platform/factory-delivery.js'],
    testFiles: ['tests/unit/real-delivery-candidate-continuity.test.js'],
    testCommands: ['node --test tests/unit/real-delivery-candidate-continuity.test.js'],
    testCommandResults: [{
      command: 'node --test tests/unit/real-delivery-candidate-continuity.test.js',
      ok: true,
      exitCode: 0,
    }],
    localGit: { branch: 'feat/autonomous-real-proof', commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
    productionSafetyEvidence: CANDIDATE_PRODUCTION_SAFETY,
    failures: [],
    ...overrides,
  };
}

test('candidate continuity requires final-proof mode and passing deployment health', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      deploymentHealth: { ok: false, url: DEPLOYMENT_URL, status: 503 },
      requireFinalReleaseProof: false,
      verifyDeploymentHealth: false,
    }),
  }, 'staging');

  assert.match(failures.join('\n'), /final release proof required/);
  assert.match(failures.join('\n'), /deployment health verification must be enabled/);
  assert.match(failures.join('\n'), /deployment health must pass/);
});

test('candidate continuity rejects boolean-only rollback proof', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      rollbackEvidence: null,
    }),
  }, 'staging').join('\n');

  assert.match(failures, /real-delivery candidate proof rollback-verification artifact is required/);
});

test('candidate continuity rejects boolean-only production safety proof', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({ productionSafetyEvidence: null }),
  }, 'staging').join('\n');

  assert.match(failures, /real-delivery candidate proof production-safety artifact is required/);
});

test('candidate continuity accepts final-proof mode with passing deployment health', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof(),
  }, 'staging');

  assert.deepEqual(failures, []);
});

test('candidate continuity requires clean local git evidence', () => {
  const missing = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({ localGit: undefined }),
  }, 'staging').join('\n');
  const dirty = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      localGit: {
        branch: 'feat/autonomous-real-proof',
        commitSha: COMMIT_SHA,
        workingTreeClean: false,
        dirtyFileCount: 2,
        dirtyFiles: ['lib/task-platform/factory-delivery.js', 'tests/unit/real-delivery-candidate-continuity.test.js'],
      },
    }),
  }, 'staging').join('\n');

  assert.match(missing, /local git clean evidence is required/);
  assert.match(dirty, /local git worktree must be clean \(2 dirty files\)/);
});

test('candidate continuity requires executed results for the listed test commands', () => {
  const listedCommand = 'node --test tests/unit/real-delivery-candidate-continuity.test.js';
  const missingCommand = 'node --test tests/unit/factory-delivery.test.js';
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      testCommands: [listedCommand, missingCommand],
      testCommandResults: [{
        command: 'node --test tests/unit/unrelated.test.js',
        ok: true,
        exitCode: 0,
      }],
    }),
  }, 'staging').join('\n');

  assert.match(failures, /test command result must match a listed command/);
  assert.match(failures, /must include executed result for listed test command/);
});

test('candidate continuity rejects non-zero test command exit codes', () => {
  const command = 'node --test tests/unit/real-delivery-candidate-continuity.test.js';
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      testCommands: [command],
      testCommandResults: [{
        command,
        ok: true,
        exitCode: 1,
      }],
    }),
  }, 'staging').join('\n');

  assert.match(failures, /test command exitCode must be 0/);
});

test('candidate continuity rejects required-check inventory drift from final GitHub proof', () => {
  const failures = candidateProofFailures({
    ...finalEvidence(),
    github: {
      ...finalEvidence().github,
      requiredChecks: ['unit tests', 'Merge readiness', 'Secret scan'],
      branchProtection: {
        branch: 'main',
        requiredChecks: ['unit tests', 'Merge readiness', 'Secret scan'],
        source: 'github_branch_protection',
      },
    },
  }, {
    requireCandidateProof: true,
    candidateProof: candidateProof(),
  }, 'staging').join('\n');

  assert.match(failures, /requiredChecks must match final GitHub requiredChecks/);
  assert.match(failures, /branchProtection requiredChecks must match final GitHub branchProtection/);
});

test('candidate continuity rejects repository drift from final GitHub proof', () => {
  const failures = candidateProofFailures({
    ...finalEvidence(),
    github: {
      ...finalEvidence().github,
      repository: 'wiinc1/other-repo',
    },
  }, {
    requireCandidateProof: true,
    candidateProof: candidateProof(),
  }, 'staging').join('\n');

  assert.match(failures, /repository must match final GitHub repository/);
});

test('candidate continuity rejects Merge readiness drift from final GitHub proof', () => {
  const failures = candidateProofFailures({
    ...finalEvidence(),
    github: {
      ...finalEvidence().github,
      mergeReadiness: { name: 'Deployment safety', conclusion: 'success', source: 'github_check_run' },
    },
  }, {
    requireCandidateProof: true,
    candidateProof: candidateProof(),
  }, 'staging').join('\n');

  assert.match(failures, /mergeReadiness must match final GitHub mergeReadiness/);
});

test('candidate continuity requires hosted health checks to prove the commit', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200 },
      requireHealthCommit: false,
    }),
  }, 'staging').join('\n');

  assert.match(failures, /must require health commit verification/);
  assert.match(failures, /deployment health must prove candidate commit SHA/);
});

test('candidate continuity rejects deployment health proof from another origin', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      deploymentHealth: {
        ok: true,
        url: 'https://unrelated-factory.openclaw.app/version',
        status: 200,
        commitVerified: true,
      },
    }),
  }, 'staging').join('\n');

  assert.match(failures, /real-delivery candidate proof deployment health URL must match deployment URL origin/);
});

test('candidate continuity requires candidate GitHub checks and API provenance', () => {
  const failures = candidateProofFailures(finalEvidence(), {
    requireCandidateProof: true,
    candidateProof: candidateProof({
      checks: [],
      requiredChecks: [],
      mergeReadiness: null,
      githubEvidenceSource: null,
    }),
  }, 'staging').join('\n');

  assert.match(failures, /real-delivery candidate proof GitHub checks are required/);
  assert.match(failures, /real-delivery candidate proof GitHub candidate proof must be collected from GitHub API/);
});

test('candidate continuity requires final GitHub identity and changed-file evidence', () => {
  const failures = candidateProofFailures({
    github: {},
    change: { changedFiles: CHANGED_FILES },
    releaseEvidence: finalEvidence().releaseEvidence,
  }, {
    requireCandidateProof: true,
    candidateProof: candidateProof(),
  }, 'staging').join('\n');

  assert.match(failures, /final GitHub commitSha evidence is required/);
  assert.match(failures, /final GitHub prUrl evidence is required/);
  assert.match(failures, /final GitHub prNumber evidence is required/);
  assert.match(failures, /final GitHub branch evidence is required/);
  assert.match(failures, /final GitHub changed files are required/);
});
