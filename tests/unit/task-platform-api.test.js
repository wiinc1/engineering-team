const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const { createPostgresTaskPlatformService } = require('../../lib/task-platform/postgres');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, payload = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'platform-user', tenant_id: 'engineering-team', roles: ['admin', 'pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-api-'));
  const secret = 'task-platform-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('supports canonical task platform create/list/get/owner flows with optimistic concurrency', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.ok(payload.data.some((agent) => agent.agentId === 'qa'));

    response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        title: 'Canonical task',
        description: 'Created through v1 API',
        status: 'BACKLOG',
        priority: 'P1',
      }),
    });
    assert.equal(response.status, 201);
    payload = await response.json();
    const created = payload.data;
    assert.equal(created.version, 1);
    assert.equal(created.owner, null);

    response = await fetch(`${baseUrl}/api/v1/tasks/${created.taskId}`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/api/v1/tasks/${created.taskId}/owner`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['pm'] }),
      },
      body: JSON.stringify({
        ownerAgentId: 'qa',
        version: 1,
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.owner.agentId, 'qa');
    assert.equal(payload.data.version, 2);

    response = await fetch(`${baseUrl}/api/v1/tasks/${created.taskId}/owner`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['pm'] }),
      },
      body: JSON.stringify({
        ownerAgentId: null,
        version: 1,
      }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.error.code, 'version_conflict');

    response = await fetch(`${baseUrl}/api/v1/tasks`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].owner.agentId, 'qa');
  });
});

test('supports merge readiness review create/read/update, status validation, and current supersession', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        title: 'Merge readiness task',
        description: 'Validates structured review storage',
        status: 'READY_FOR_REVIEW',
        priority: 'P1',
      }),
    });
    assert.equal(response.status, 201);
    let payload = await response.json();
    const task = payload.data;

    const baseReview = {
      repository: 'wiinc1/engineering-team',
      pullRequestNumber: 128,
      commitSha: 'abcdef1234567890',
      reviewStatus: 'passed',
      policyVersion: 'merge-readiness-review-storage.v1',
      sourceInventory: {
        pullRequest: 'https://github.com/wiinc1/engineering-team/pull/128',
        requiredSources: ['issue', 'diff', 'checks'],
      },
      requiredCheckInventory: [
        { name: 'Repo validation', conclusion: 'success', sourceUrl: 'https://github.com/wiinc1/engineering-team/actions/runs/1' },
      ],
      reviewedLogSources: [
        { name: 'Repo validation', url: 'https://github.com/wiinc1/engineering-team/actions/runs/1/job/1' },
      ],
      findings: [
        { id: 'MRR-F-1', severity: 'info', summary: 'No blocking findings.' },
      ],
      classification: { decision: 'merge_ready' },
      owner: { actorId: 'principal-engineer' },
      rationale: { summary: 'All acceptance criteria were verified before ship.' },
      followUpLinks: [{ url: 'https://github.com/wiinc1/engineering-team/issues/112' }],
      approvals: [{ actorId: 'reviewer', approvedAt: '2026-05-02T12:00:00.000Z' }],
      metadata: { issueNumber: 112, audit: 'pre-ship' },
      githubCheckRunId: 9001,
    };

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify(baseReview),
    });
    assert.equal(response.status, 201);
    payload = await response.json();
    const firstReview = payload.data;
    assert.equal(firstReview.taskId, task.taskId);
    assert.equal(firstReview.repository, baseReview.repository);
    assert.equal(firstReview.pullRequestNumber, 128);
    assert.equal(firstReview.commitSha, baseReview.commitSha);
    assert.equal(firstReview.reviewStatus, 'passed');
    assert.equal(firstReview.policyVersion, 'merge-readiness-review-storage.v1');
    assert.equal(firstReview.githubCheckRunId, 9001);
    assert.equal(firstReview.recordVersion, 1);
    assert.equal(firstReview.isCurrent, true);
    assert.deepEqual(firstReview.findings, baseReview.findings);
    assert.deepEqual(firstReview.reviewedLogSources, baseReview.reviewedLogSources);
    assert.equal(firstReview.reviewerActorId, 'platform-user');
    assert.equal(firstReview.reviewerActorType, 'user');
    assert.ok(!JSON.stringify(firstReview).includes('raw log line'));

    const currentUrl = `${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews?repository=wiinc1%2Fengineering-team&pullRequestNumber=128&commitSha=abcdef1234567890`;
    response = await fetch(currentUrl, { headers: authHeaders(secret, { roles: ['reader'] }) });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.items.length, 1);
    assert.equal(payload.data.current.reviewId, firstReview.reviewId);

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        ...baseReview,
        reviewStatus: 'blocked',
        findings: [{ id: 'MRR-F-2', severity: 'blocker', summary: 'A required deployment check is pending.' }],
        metadata: { issueNumber: 112, supersedes: firstReview.reviewId },
      }),
    });
    assert.equal(response.status, 201);
    payload = await response.json();
    const secondReview = payload.data;
    assert.notEqual(secondReview.reviewId, firstReview.reviewId);
    assert.equal(secondReview.isCurrent, true);
    assert.equal(secondReview.reviewStatus, 'blocked');

    response = await fetch(`${currentUrl}&current=false`, { headers: authHeaders(secret, { roles: ['reader'] }) });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.items.length, 2);
    assert.equal(payload.data.items.filter((review) => review.isCurrent).length, 1);
    assert.equal(payload.data.current.reviewId, secondReview.reviewId);
    assert.equal(payload.data.items.find((review) => review.reviewId === firstReview.reviewId).isCurrent, false);

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        reviewId: secondReview.reviewId,
        recordVersion: secondReview.recordVersion,
        reviewStatus: 'passed',
        metadata: { issueNumber: 112, staleWriteProbe: false },
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    const updatedReview = payload.data;
    assert.equal(updatedReview.reviewStatus, 'passed');
    assert.equal(updatedReview.recordVersion, 2);
    assert.deepEqual(updatedReview.metadata, { issueNumber: 112, staleWriteProbe: false });

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        reviewId: secondReview.reviewId,
        recordVersion: secondReview.recordVersion,
        reviewStatus: 'blocked',
      }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.error.code, 'merge_readiness_review_version_conflict');

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        ...baseReview,
        commitSha: 'abcdef7654321',
        reviewStatus: 'green',
      }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.error.code, 'invalid_merge_readiness_status');

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        ...baseReview,
        commitSha: 'abc9999',
        reviewedLogSources: [{ name: 'Repo validation', url: 'https://github.com/wiinc1/engineering-team/actions/runs/1', content: 'raw log line' }],
      }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.error.code, 'full_log_content_not_allowed');
  });
});

test('documents and migrates merge readiness reviews with typed columns, JSONB payloads, and no findings child table', () => {
  const root = path.join(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'db/migrations/010_merge_readiness_reviews.sql'), 'utf8');
  const openapi = fs.readFileSync(path.join(root, 'docs/api/task-platform-openapi.yml'), 'utf8');
  const apiFiles = fs.readdirSync(path.join(root, 'docs/api'));

  for (const snippet of [
    'CREATE TABLE IF NOT EXISTS merge_readiness_reviews',
    'tenant_id TEXT NOT NULL',
    'task_id TEXT NOT NULL',
    'repository TEXT NOT NULL',
    'pull_request_number INTEGER NOT NULL',
    'commit_sha TEXT NOT NULL',
    'review_status TEXT NOT NULL',
    'is_current BOOLEAN NOT NULL DEFAULT TRUE',
    'policy_version TEXT NOT NULL',
    'record_version INTEGER NOT NULL DEFAULT 1',
    'github_check_run_id BIGINT',
    'reviewer_actor_id TEXT NOT NULL',
    'reviewer_actor_type TEXT NOT NULL',
    'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'REFERENCES tasks (tenant_id, task_id)',
    "CHECK (review_status IN ('pending', 'passed', 'blocked', 'stale', 'error'))",
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_readiness_reviews_current_identity',
    'WHERE is_current = true',
  ]) {
    assert.match(migration, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const jsonbColumn of [
    'source_inventory JSONB',
    'required_check_inventory JSONB',
    'reviewed_log_sources JSONB',
    'findings JSONB',
    'classification JSONB',
    'owner JSONB',
    'rationale JSONB',
    'follow_up_links JSONB',
    'approvals JSONB',
    'metadata JSONB',
  ]) {
    assert.match(migration, new RegExp(jsonbColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS merge_readiness_findings/i);
  assert.deepEqual(apiFiles.filter((file) => /merge-readiness/i.test(file) && file !== 'task-platform-openapi.yml'), []);

  for (const snippet of [
    '/tasks/{taskId}/merge-readiness-reviews:',
    'operationId: createTaskMergeReadinessReview',
    'operationId: listTaskMergeReadinessReviews',
    'operationId: updateTaskMergeReadinessReview',
    'MergeReadinessReviewStatus',
    'reviewedLogSources',
    'findings',
    'sourceInventory',
    'requiredCheckInventory',
    'followUpLinks',
    'recordVersion',
    'current',
    'Defaults to true. Set false to include historical superseded reviews.',
  ]) {
    assert.match(openapi, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('postgres merge readiness supersession rolls back prior current review when replacement insert fails', async () => {
  const reviews = [{
    tenant_id: 'engineering-team',
    review_id: 'MRR-PRIOR',
    task_id: 'TSK-ROLLBACK',
    repository: 'wiinc1/engineering-team',
    pull_request_number: 128,
    commit_sha: 'abcdef1234567890',
    review_status: 'passed',
    is_current: true,
    policy_version: 'merge-readiness-review-storage.v1',
    record_version: 1,
    github_check_run_id: 9001,
    source_inventory: {},
    required_check_inventory: [],
    reviewed_log_sources: [{ url: 'https://github.com/wiinc1/engineering-team/actions/runs/1' }],
    findings: [],
    classification: null,
    owner: null,
    rationale: null,
    follow_up_links: [],
    approvals: [],
    metadata: {},
    reviewer_actor_id: 'reviewer',
    reviewer_actor_type: 'system',
    created_at: '2026-05-02T12:00:00.000Z',
    updated_at: '2026-05-02T12:00:00.000Z',
  }];
  let snapshot = null;
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      queries.push(normalizedSql);
      if (normalizedSql === 'BEGIN') {
        snapshot = reviews.map((review) => ({ ...review }));
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql === 'ROLLBACK') {
        reviews.splice(0, reviews.length, ...snapshot.map((review) => ({ ...review })));
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql === 'COMMIT') {
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql.startsWith('SELECT task_id FROM tasks')) {
        return { rows: [{ task_id: params[1] }], rowCount: 1 };
      }
      if (normalizedSql.startsWith('UPDATE merge_readiness_reviews')) {
        for (const review of reviews) {
          if (
            review.tenant_id === params[0]
            && review.task_id === params[1]
            && review.repository === params[2]
            && review.pull_request_number === params[3]
            && review.commit_sha === params[4]
            && review.is_current
          ) {
            review.is_current = false;
            review.record_version += 1;
          }
        }
        return { rows: [], rowCount: 1 };
      }
      if (normalizedSql.startsWith('INSERT INTO merge_readiness_reviews')) {
        throw new Error('insert failed after supersession');
      }
      throw new Error(`unexpected query: ${normalizedSql}`);
    },
    release() {},
  };
  const service = createPostgresTaskPlatformService({
    pool: {
      connect: async () => client,
    },
  });

  await assert.rejects(
    () => service.createMergeReadinessReview({
      tenantId: 'engineering-team',
      taskId: 'TSK-ROLLBACK',
      repository: 'wiinc1/engineering-team',
      pullRequestNumber: 128,
      commitSha: 'abcdef1234567890',
      reviewStatus: 'blocked',
      reviewedLogSources: [{ url: 'https://github.com/wiinc1/engineering-team/actions/runs/2' }],
      findings: [{ id: 'F-rollback', severity: 'blocker' }],
    }),
    /insert failed after supersession/,
  );

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].is_current, true);
  assert.equal(reviews[0].record_version, 1);
  assert.ok(queries.includes('BEGIN'));
  assert.ok(queries.some((query) => query.startsWith('UPDATE merge_readiness_reviews')));
  assert.ok(queries.includes('ROLLBACK'));
  assert.ok(!queries.includes('COMMIT'));
});
