const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, overrides = {}) {
  return {
    authorization: `Bearer ${sign(
      {
        sub: 'execution-contract-refinement-tester',
        tenant_id: 'tenant-execution-contract-refinement',
        roles: ['admin'],
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
      },
      secret
    )}`,
  };
}

async function withServer(callback) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-contract-refinement-'));
  const secret = 'execution-contract-refinement-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const STANDARD_SECTIONS = ['1', '2', '3', '4', '6', '7', '10', '11', '12', '15', '16', '17'];

function standardSections() {
  return Object.fromEntries(
    STANDARD_SECTIONS.map((sectionId) => [sectionId, `Contract refinement section ${sectionId} is complete.`])
  );
}

async function createIntakeDraft({ baseUrl, secret }) {
  const response = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['contributor'] }) },
    body: JSON.stringify({
      title: 'Execution Contract refinement route',
      raw_requirements: 'Route reviewer section contributions through a versioned contract endpoint.',
    }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).taskId;
}

async function createApprovedStandardContract({ baseUrl, secret, taskId }) {
  const pmHeaders = {
    'content-type': 'application/json',
    ...authHeaders(secret, { sub: 'pm-152', roles: ['pm', 'reader'] }),
  };
  let response = await fetch(`${baseUrl}/tasks/${taskId}/execution-contract`, {
    method: 'POST',
    headers: pmHeaders,
    body: JSON.stringify({
      templateTier: 'Standard',
      sections: standardSections(),
      reviewers: {
        architect: { status: 'approved', actorId: 'architect-152' },
        ux: { status: 'approved', actorId: 'ux-152' },
        qa: { status: 'approved', actorId: 'qa-152' },
      },
    }),
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/tasks/${taskId}/execution-contract/approve`, {
    method: 'POST',
    headers: pmHeaders,
    body: JSON.stringify({ approvalNote: 'Approved before the material section review.' }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.version, 1);
}

async function submitArchitectSectionReview({ baseUrl, secret, taskId, version, body }) {
  return fetch(`${baseUrl}/api/v1/tasks/${taskId}/execution-contract/${version}/sections/6/review`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-152', roles: ['architect'] }),
    },
    body: JSON.stringify(body),
  });
}

test('execution-contract refinement OpenAPI documents the versioned section review surface', () => {
  const spec = fs.readFileSync(
    path.join(__dirname, '../../docs/api/execution-contract-refinement-openapi.yml'),
    'utf8'
  );

  for (const token of [
    '/api/v1/tasks/{taskId}/refinement/start',
    '/api/v1/tasks/{taskId}/execution-contract',
    '/api/v1/tasks/{taskId}/execution-contract/{version}/sections/{sectionId}/review',
    'PmRefinementStartRequest',
    'PmRefinementStartResponse',
    'task.refinement_started',
    'task.refinement_failed',
    'truthful runtime attribution',
    'delegation_artifact_path',
    'ExecutionContractSectionReviewRequest',
    'stale_execution_contract_review',
    'execution_contract_approval_blocked',
    'dispatch_ready',
  ]) {
    assert.match(spec, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('versioned section reviews persist reviewer contribution and stale approved versions stop dispatch readiness', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const taskId = await createIntakeDraft({ baseUrl, secret });
    await createApprovedStandardContract({ baseUrl, secret, taskId });

    let response = await submitArchitectSectionReview({
      baseUrl,
      secret,
      taskId,
      version: 1,
      body: {
        status: 'approved',
        comment: 'Architecture section now includes reviewer-owned integration evidence.',
        sectionPatch: {
          payloadJson: { integration_contract: 'section-review-route' },
          payloadSchemaVersion: 2,
        },
      },
    });
    assert.equal(response.status, 201);
    const sectionReview = await response.json();
    assert.equal(sectionReview.data.previousVersion, 1);
    assert.equal(sectionReview.data.version, 2);
    assert.equal(sectionReview.data.sectionReview.role, 'architect');
    assert.equal(sectionReview.data.contract.sections['6'].payload_json.integration_contract, 'section-review-route');

    response = await fetch(`${baseUrl}/tasks/${taskId}/execution-contract`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const projection = (await response.json()).data;
    assert.equal(projection.latest.version, 2);
    assert.equal(projection.approval, null);
    assert.equal(projection.latest.reviewers.architect.status, 'approved');
    assert.equal(projection.latest.sections['6'].approver, 'architect-152');

    response = await submitArchitectSectionReview({
      baseUrl,
      secret,
      taskId,
      version: 1,
      body: { status: 'approved' },
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'stale_execution_contract_review');
  });
});

// ownership companion for dual-remote #270 mirror (change-completeness evidence)
