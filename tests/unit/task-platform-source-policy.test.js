const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const {
  MERGE_READINESS_SOURCE_POLICY_VERSION,
  evaluateMergeReadinessSourcePolicy,
} = require('../../lib/task-platform/merge-readiness-source-policy');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles = ['admin', 'reader']) {
  return {
    authorization: `Bearer ${sign({
      sub: 'source-policy-test',
      tenant_id: 'engineering-team',
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
    }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-source-policy-'));
  const secret = 'task-platform-source-policy-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

async function createTask(baseUrl, secret) {
  const response = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
    body: JSON.stringify({ title: 'Merge readiness source policy', status: 'READY_FOR_REVIEW' }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).data;
}

async function createReview(baseUrl, secret, taskId, body) {
  const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/merge-readiness-reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
    body: JSON.stringify({
      repository: 'wiinc1/engineering-team',
      pullRequestNumber: 113,
      commitSha: 'abcdef1234567',
      reviewStatus: 'passed',
      ...body,
    }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).data;
}

test('selects required sources from policy inputs and ignores non-required optional logs', () => {
  const result = evaluateMergeReadinessSourcePolicy({
    changedFiles: ['lib/auth/jwt.js', 'src/app/App.jsx', 'db/migrations/011_merge_policy.sql'],
    requiredChecks: [{ name: 'Repo validation', sourceUrl: 'https://github.com/wiinc1/engineering-team/actions/runs/113' }],
    executionContractEvidence: [{ id: 'contract-coverage', url: 'https://github.com/wiinc1/engineering-team/issues/113#contract' }],
    previewDeployment: { url: 'https://preview.example/pr-113' },
    deployment: { url: 'https://deploy.example/releases/113' },
    riskFlags: ['security', 'performance'],
    availableSources: [
      { id: 'pr-diff' },
      { type: 'standards_log' },
      { id: 'browser-validation' },
      { id: 'migration-plan' },
      { id: 'security-review' },
      { id: 'performance-validation' },
      { id: 'runtime-observability' },
      { id: 'debug-log', type: 'debug_log' },
    ],
  });

  const ids = new Set(result.requiredSources.map(source => source.id));
  for (const id of [
    'pr-diff',
    'repo-standards',
    'browser-validation',
    'migration-plan',
    'security-review',
    'performance-validation',
    'check:repo-validation',
    'execution-contract:contract-coverage',
    'preview-deployment',
    'deployment-evidence',
    'runtime-observability',
  ]) {
    assert.equal(ids.has(id), true, `${id} should be required`);
  }
  assert.equal(result.policyVersion, MERGE_READINESS_SOURCE_POLICY_VERSION);
  assert.equal(result.status, 'satisfied');
  assert.equal(result.mergeReadinessCheck.conclusion, 'success');
  assert.deepEqual(result.optionalSources.map(source => source.id), ['debug-log']);
});

test('assigns permission or configuration policy blocks to the relevant admin owner', () => {
  const result = evaluateMergeReadinessSourcePolicy({
    riskFlags: ['security'],
    evidenceAccess: {
      'security-review': { status: 'inaccessible', reason: 'missing_configuration' },
    },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.exceptions[0].type, 'policy_blocked');
  assert.equal(result.exceptions[0].owner, 'repo-admin');
  assert.equal(result.mergeReadinessCheck.conclusion, 'failure');
});

test('records explicit policy inventory and blocks reviews with missing required sources', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const task = await createTask(baseUrl, secret);
    const review = await createReview(baseUrl, secret, task.taskId, {
      changedFiles: ['lib/task-platform/index.js'],
      requiredChecks: [{ name: 'Repo validation' }],
    });

    assert.equal(review.reviewStatus, 'blocked');
    assert.equal(review.sourceInventory.policy_version, MERGE_READINESS_SOURCE_POLICY_VERSION);
    assert.equal(review.sourceInventory.status, 'blocked');
    assert.equal(review.classification.source_inventory_policy.status, 'blocked');
    assert.equal(review.metadata.merge_readiness_check.conclusion, 'failure');
    assert.ok(review.sourceInventory.required_sources.some(source => source.status === 'missing'));
    assert.ok(review.findings.some(finding => finding.type === 'missing_required_source'));
  });
});

test('marks inaccessible required evidence as error and raises policy-blocked exception ownership', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const task = await createTask(baseUrl, secret);
    const review = await createReview(baseUrl, secret, task.taskId, {
      deployment: { url: 'https://deploy.example/releases/113' },
      riskFlags: ['deployment'],
      evidenceAccess: {
        'runtime-observability': { status: 'inaccessible', reason: 'permission_denied' },
      },
    });

    const policy = review.classification.source_inventory_policy;
    assert.equal(review.reviewStatus, 'error');
    assert.deepEqual(policy.inaccessible_required_source_ids, ['runtime-observability']);
    assert.equal(policy.merge_readiness_check.conclusion, 'failure');
    assert.equal(policy.exceptions[0].type, 'policy_blocked');
    assert.equal(policy.exceptions[0].owner, 'sre');
    assert.ok(review.findings.some(finding => finding.type === 'required_evidence_inaccessible'));
    assert.ok(review.findings.some(finding => finding.type === 'policy_blocked'));
  });
});
