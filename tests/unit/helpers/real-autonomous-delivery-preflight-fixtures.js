const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const {
  REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
} = require('../../../lib/task-platform/real-delivery-candidate-proof');
const { productionSafetyEvidence } = require('./production-safety-fixture');

const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/418';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';

function cleanEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FACTORY_USE_FIXTURE_DELEGATION: 'false',
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    FF_FACTORY_AUTO_MERGE: '',
    ...overrides,
  };
}

function completeArgs(candidateProofPath) {
  return [
    'scripts/preflight-real-autonomous-delivery.js',
    '--no-git-defaults',
    '--base-url',
    'https://api.factory.openclaw.app',
    '--operator-url',
    DEPLOYMENT_URL,
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/queue-status-real-delivery',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--pr-url',
    PR_URL,
    '--auto-merge',
    '--github-token',
    'gh-token',
    '--deployment-url',
    DEPLOYMENT_URL,
    '--rollback-target',
    'release-previous',
    '--rollback-evidence',
    'observability/release/rollback-verification.json',
    '--rollback-verified',
    '--candidate-proof',
    candidateProofPath,
    '--require-health-commit',
    '--health-check-path',
    '/version',
    '--release-build-command',
    'npm run build',
    '--release-compatibility-command',
    'npm run test:unit',
    '--release-vulnerability-command',
    'npm audit --audit-level=high',
    '--release-secret-command',
    'npm run secrets:scan',
    '--release-env',
    'staging',
  ];
}

function candidateGithubProof() {
  return {
    checks: [
      { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
      { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
    ],
    requiredChecks: ['Unit tests', 'Merge readiness'],
    branchProtection: {
      branch: 'main',
      requiredChecks: ['Unit tests', 'Merge readiness'],
      source: 'github_branch_protection',
    },
    mergeReadiness: { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
    githubEvidenceSource: {
      provider: 'github',
      apiBaseUrl: 'https://api.github.com',
      collectedAt: '2026-07-05T00:00:00.000Z',
    },
  };
}

function candidateReleaseProof() {
  return {
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true },
    requireHealthCommit: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: {
      environment: 'staging',
      commit_sha: COMMIT_SHA,
      rollback_target: 'release-previous',
      verification_status: 'verified',
      verified_at: '2026-07-05T00:00:00.000Z',
    },
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
  };
}

function candidateScopeProof(testCommand) {
  return {
    changedFiles: [
      'lib/task-platform/factory-delivery-queue-status.js',
      'tests/unit/factory-queue-status.test.js',
    ],
    implementationFiles: ['lib/task-platform/factory-delivery-queue-status.js'],
    testFiles: ['tests/unit/factory-queue-status.test.js'],
    testCommands: [testCommand],
    testCommandResults: [{ command: testCommand, ok: true, exitCode: 0 }],
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
  };
}

function candidateProof(overrides = {}) {
  const testCommand = 'node --test tests/unit/factory-queue-status.test.js';
  return {
    schemaVersion: REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
    generatedAt: '2026-07-05T00:00:00.000Z',
    ok: true,
    branch: 'feat/queue-status-real-delivery',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 418,
    ...candidateGithubProof(),
    ...candidateReleaseProof(),
    ...candidateScopeProof(testCommand),
    localGit: { branch: 'feat/queue-status-real-delivery', commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    failures: [],
    ...overrides,
  };
}

function writeCandidateProof(filePath, overrides = {}) {
  fs.writeFileSync(filePath, `${JSON.stringify(candidateProof(overrides), null, 2)}\n`);
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
      ref: 'feat/queue-status-real-delivery',
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
      branchName: 'feat/queue-status-real-delivery',
      implementationCommitSha: COMMIT_SHA,
      hasGithubToken: true,
    },
    target: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/queue-status-real-delivery',
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

module.exports = {
  COMMIT_SHA,
  DEPLOYMENT_URL,
  PR_URL,
  candidateProof,
  cleanEnv,
  completeArgs,
  git,
  githubFetchMock,
  pull,
  withoutArg,
  writeCandidateProof,
  writePrDiscoveryReport,
};
