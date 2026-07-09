const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '../..');
const REAL_PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const STAGING_URL = 'https://factory-staging.openclaw.app';
const RELEASE_PROOF_ARGS = [
  '--rollback-verified',
  '--rollback-evidence',
  'observability/release/rollback-verification.json',
  '--health-check-path',
  '/version',
  '--require-health-commit',
  '--release-build-command',
  'npm run build',
  '--release-compatibility-command',
  'npm run test:unit',
  '--release-vulnerability-command',
  'npm audit --audit-level=high',
  '--release-secret-command',
  'npm run secrets:scan',
];

function prooflessEnv(overrides = {}) {
  return {
    ...process.env,
    PR_URL: '',
    GITHUB_PR_URL: '',
    PR_NUMBER: '',
    GITHUB_PR_NUMBER: '',
    CI_REPOSITORY: '',
    GITHUB_REPOSITORY: '',
    DEPLOYMENT_URL: '',
    PRODUCTION_URL: '',
    ROLLBACK_TARGET: '',
    ROLLBACK_VERIFIED: '',
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    FF_FACTORY_AUTO_MERGE: '',
    FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE: '',
    FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE: '',
    ...overrides,
  };
}

function runScript(scriptPath, args, env = prooflessEnv()) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
}

function writeHostedPhase6Stub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-phase6-cli-preflight-'));
  const evidencePath = path.join(dir, 'factory-evidence.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    factoryQueueId: 'factory-cli-preflight',
    status: 'phase5_complete',
    engineeringTeam: { taskId: 'TSK-CLI-PREFLIGHT' },
    forgeadapter: { taskId: 'TSK-GOLDEN-CLI-PREFLIGHT' },
  }, null, 2)}\n`);
  return evidencePath;
}

test('postgres replay wrapper fails real-evidence preflight before stack readiness', () => {
  const result = runScript('scripts/replay-golden-path-postgres.js', ['--collect-real-evidence']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Postgres golden-path replay preflight failed: .*pull request target/s);
  assert.doesNotMatch(result.stderr, /Golden-path stack is not ready/);
});

test('golden-path phase runner fails real-evidence mode before fixture delegation or evidence load', () => {
  const result = runScript('scripts/run-golden-path-phases.js', [
    '--agent-driven-phases',
    '--pr-url',
    REAL_PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    STAGING_URL,
    '--rollback-target',
    'release-previous',
    '--out',
    'observability/does-not-need-to-exist.json',
  ], prooflessEnv({
    FACTORY_USE_FIXTURE_DELEGATION: 'true',
    SPECIALIST_DELEGATION_RUNNER: '',
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Golden-path phase runner preflight failed: .*FACTORY_USE_FIXTURE_DELEGATION cannot be true/s);
  assert.doesNotMatch(result.stderr, /Missing pilot evidence/);
});

test('golden-path phase runner preflights missing real-evidence proof before evidence load', () => {
  const result = runScript('scripts/run-golden-path-phases.js', [
    '--collect-real-evidence',
    '--out',
    'observability/does-not-need-to-exist.json',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Golden-path phase runner preflight failed: .*pull request target/s);
  assert.doesNotMatch(result.stderr, /Missing pilot evidence/);
});

test('factory orchestrator worker opens durable queue before item-level real-evidence preflight', () => {
  const result = runScript('scripts/run-factory-orchestrator.js', [
    '--once',
    '--collect-real-evidence',
  ], prooflessEnv({
    FACTORY_QUEUE_DATABASE_URL: '',
    DATABASE_URL: '',
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FACTORY_QUEUE_DATABASE_URL or DATABASE_URL is required/);
  assert.doesNotMatch(result.stderr, /Factory orchestrator preflight failed/);
});

test('factory orchestrator worker does not reject item-supplied phase 6 proof before queue access', () => {
  const result = runScript('scripts/run-factory-orchestrator.js', [
    '--once',
    '--collect-real-evidence',
    '--pr-url',
    REAL_PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    STAGING_URL,
    '--rollback-target',
    'release-previous',
  ], prooflessEnv({
    FACTORY_QUEUE_DATABASE_URL: '',
    DATABASE_URL: '',
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FACTORY_QUEUE_DATABASE_URL or DATABASE_URL is required/);
  assert.doesNotMatch(result.stderr, /Factory orchestrator preflight failed/);
});

test('hosted phase6 wrapper preserves autonomy mode before replay', () => {
  const result = runScript('scripts/verify-milestone-hosted-phase6.js', [
    '--base-url',
    'https://api.factory.openclaw.app',
    '--jwt-secret',
    'secret',
    '--evidence-path',
    writeHostedPhase6Stub(),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Hosted phase 6 replay preflight failed: .*pull request target.*deployment-url.*rollback-target.*rollback-verified/s);
  assert.doesNotMatch(result.stderr, /Missing pilot evidence/);
});

test('hosted phase6 wrapper requires auto-merge before replay', () => {
  const result = runScript('scripts/verify-milestone-hosted-phase6.js', [
    '--base-url',
    'https://api.factory.openclaw.app',
    '--jwt-secret',
    'secret',
    '--evidence-path',
    writeHostedPhase6Stub(),
    '--pr-url',
    REAL_PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    STAGING_URL,
    '--rollback-target',
    'release-previous',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Hosted phase 6 replay preflight failed: .*real-evidence phase 6 requires --auto-merge.*requires GITHUB_TOKEN/s);
  assert.doesNotMatch(result.stderr, /Missing pilot evidence/);
});

test('hosted phase6 wrapper requires candidate proof before replay', () => {
  const result = runScript('scripts/verify-milestone-hosted-phase6.js', [
    '--base-url',
    'https://api.factory.openclaw.app',
    '--jwt-secret',
    'secret',
    '--evidence-path',
    writeHostedPhase6Stub(),
    '--pr-url',
    REAL_PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    STAGING_URL,
    '--rollback-target',
    'release-previous',
    '--auto-merge',
    '--github-token',
    'gh-token',
    ...RELEASE_PROOF_ARGS,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Hosted phase 6 replay preflight failed: .*candidate-proof/s);
  assert.doesNotMatch(result.stderr, /Missing pilot evidence/);
});

test('golden-path phase runner rejects unreadable candidate proof before evidence load', () => {
  const missingCandidateProof = path.join(os.tmpdir(), `missing-candidate-proof-${Date.now()}.json`);
  const result = runScript('scripts/run-golden-path-phases.js', [
    '--collect-real-evidence',
    '--pr-url',
    REAL_PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    STAGING_URL,
    '--rollback-target',
    'release-previous',
    '--auto-merge',
    '--github-token',
    'gh-token',
    ...RELEASE_PROOF_ARGS,
    '--candidate-proof',
    missingCandidateProof,
    '--out',
    'observability/does-not-need-to-exist.json',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Golden-path phase runner preflight failed: .*candidate proof cannot be read/s);
  assert.doesNotMatch(result.stderr, /Missing pilot evidence/);
});
