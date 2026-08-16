'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  DOMAIN_EVENT,
  artifact,
  createProductionLifecycleHandlers,
  createQueueRepository,
  normalizeChildren,
} = require('../../lib/task-platform/langgraph-production-handlers');

function request(node, extras = {}) {
  return {
    run: {
      tenantId: 'engineering-team', factoryRunId: 'factory:281', taskId: 'TSK-281',
      projectId: 'PRJ-281', queueId: 'factory:281', version: 1,
    },
    lifecycle: {
      node, attempt: 1, idempotencyKey: `lg:test:${node}:1`, threadId: 'lg_test',
      completedNodes: [], qaAttempt: 0,
    },
    ...extras,
  };
}

function queueItem(overrides = {}) {
  return {
    tenantId: 'engineering-team', queueId: 'factory:281', taskId: 'TSK-281',
    projectId: 'PRJ-281', title: 'Production lifecycle', requirements: 'Ship safely',
    templateTier: 'Complex', changedFiles: ['lib/runtime.js'], githubIssueUrl: null,
    metadata: {
      lifecycle: { children: [{ id: 'api', dependencies: [] }, { id: 'ui', dependencies: ['api'] }] },
      realDelivery: {
        repository: 'wiinc1/engineering-team', branchName: 'feature/runtime-production-handler',
        implementationCommitSha: '6ec48864d3e74b38a83874f0171efddbd688f357',
        commitSha: '6ec48864d3e74b38a83874f0171efddbd688f357',
        mergeCommitSha: 'bdfc03d03c7261d9d1f131aee9edc6db2a836c77',
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/321', prNumber: 321,
        deploymentUrl: 'https://staging.example.test', healthCheckPath: '/health',
      },
    },
    ...overrides,
  };
}

function githubProof() {
  const mergeReadiness = {
    name: 'Merge readiness', reviewStatus: 'passed', status: 'completed',
    conclusion: 'success', source: 'github_check_run', url: 'https://github.com/checks/1',
  };
  return {
    repository: 'wiinc1/engineering-team', branchName: 'feature/runtime-production-handler',
    baseBranch: 'main', commitSha: '6ec48864d3e74b38a83874f0171efddbd688f357',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/321', prNumber: 321,
    changedFiles: ['lib/task-platform/langgraph-production-handlers.js'],
    checks: [mergeReadiness], requiredChecks: ['Merge readiness'], mergeReadiness,
    branchProtection: {
      source: 'github_branch_protection', requiredChecks: ['Merge readiness'],
    },
  };
}

function harness(overrides = {}) {
  const events = [];
  const calls = [];
  const item = queueItem();
  const queue = {
    async get() { return item; },
    async createIntake() { return item; },
    async close(input) { calls.push(['close', input]); },
  };
  const store = {
    kind: 'postgres',
    pool: { async query() { return { rows: [] }; } },
    async appendEvent(event) { events.push(event); return { event, duplicate: false }; },
  };
  const dependencies = {
    queue,
    async delegate(role) {
      calls.push(['delegate', role]);
      let message = '{"approved":true,"summary":"approved"}';
      if (role === 'qa') message = '{"outcome":"pass","findings":[]}';
      if (['jr-engineer', 'sr-engineer'].includes(role)) {
        message = JSON.stringify({
          branchName: 'feature/runtime-production-handler',
          commitSha: '6ec48864d3e74b38a83874f0171efddbd688f357',
          prUrl: 'https://github.com/wiinc1/engineering-team/pull/321',
        });
      }
      if (role === 'sre') message = '{"approved":true,"reason":"healthy","evidence":["health"]}';
      return {
        delegated: true, specialist: role, agentId: role === 'qa' ? 'qa-engineer' : role,
        message,
      };
    },
    async collectGitHub() { calls.push(['github']); return githubProof(); },
    async fetch(url, options) {
      calls.push(['fetch', url, options]);
      return {
        ok: true,
        async json() { return { commitSha: item.metadata.realDelivery.mergeCommitSha }; },
      };
    },
    ...overrides,
  };
  return {
    calls, events, item, queue, store,
    handlers: createProductionLifecycleHandlers({ store, env: {}, dependencies }),
  };
}

test('production handler bundle executes every lifecycle domain through canonical adapters', async () => {
  const { calls, events, handlers, item } = harness();
  assert.equal((await handlers.intake.create(request('intake'))).outcome, 'success');
  assert.equal((await handlers.refinement.refine(request('pm_refinement'))).delegation.handledBy, 'pm');
  const contract = await handlers.contracts.createAndApprove(request('execution_contract', {
    lifecycle: { ...request('execution_contract').lifecycle, decision: { action: 'accept', edits: null } },
  }));
  assert.equal(contract.decisions[0].outcome, 'approved');
  await handlers.architecture.handoff(request('architect_handoff'));
  assert.deepEqual(await handlers.children.plan(request('child_execution')), item.metadata.lifecycle.children);
  await handlers.children.execute(request('child_execution', {
    child: { id: 'api', dependencies: [] },
    lifecycle: { ...request('child_execution').lifecycle, namespace: 'child:api' },
  }));
  await handlers.implementation.execute(request('implementation'));
  const qa = await handlers.quality.verify(request('qa'));
  assert.equal(qa.qaOutcome, 'pass');
  await handlers.quality.fix(request('fix'));
  await handlers.review.approve(request('review'));
  const merge = await handlers.mergeReadiness.verify(request('merge_readiness'));
  assert.equal(merge.artifacts[0].reference, 'https://github.com/wiinc1/engineering-team/pull/321');
  const deployment = await handlers.deployment.deploy(request('deployment'));
  assert.equal(deployment.artifacts[0].reference, 'https://staging.example.test');
  await handlers.sre.monitor(request('sre'));
  await handlers.closeout.complete(request('closeout', {
    lifecycle: { ...request('closeout').lifecycle, decision: { action: 'accept', edits: null } },
  }));

  assert.ok(calls.some(([name]) => name === 'github'));
  assert.ok(calls.some(([name, url]) => name === 'fetch' && url === 'https://staging.example.test/health'));
  assert.ok(calls.some(([name]) => name === 'close'));
  assert.ok(events.some((event) => event.eventType === 'task.closed'));
  assert.ok(events.filter((event) => event.eventType === DOMAIN_EVENT).length >= 12);
  assert.ok(events.every((event) => event.source === 'langgraph-runtime'));
});

test('QA failure routes to remediation while malformed evidence fails closed', async () => {
  const failed = harness({
    async delegate(role) {
      return { delegated: true, specialist: role, agentId: 'qa-engineer', message: '{"outcome":"fail"}' };
    },
  });
  assert.equal((await failed.handlers.quality.verify(request('qa'))).qaOutcome, 'fail');
  const malformed = harness({
    async delegate(role) { return { delegated: true, specialist: role, agentId: 'qa-engineer', message: '{}' }; },
  });
  await assert.rejects(() => malformed.handlers.quality.verify(request('qa')), /pass or fail/);
});

test('approval, Git, and deployed revision gates fail closed', async () => {
  const common = harness();
  await assert.rejects(() => common.handlers.contracts.createAndApprove(request('execution_contract')), /accepted human decision/);
  await assert.rejects(() => common.handlers.closeout.complete(request('closeout')), /accepted human decision/);

  const noGit = harness({ async collectGitHub() { return null; } });
  await assert.rejects(() => noGit.handlers.mergeReadiness.verify(request('merge_readiness')), /Live Git provider evidence/);

  const wrongRevision = harness({
    async fetch() { return { ok: true, async json() { return { commitSha: '0'.repeat(40) }; } }; },
  });
  await assert.rejects(() => wrongRevision.handlers.deployment.deploy(request('deployment')), (error) => {
    assert.equal(error.code, 'deployment_health_failed');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('child and artifact normalization is bounded and deterministic', () => {
  assert.deepEqual(normalizeChildren([{ id: 'api', dependencies: [] }]), [{ id: 'api', dependencies: [] }]);
  assert.throws(() => normalizeChildren([{ id: '../api', dependencies: [] }]), /invalid/);
  assert.throws(() => normalizeChildren(new Array(129).fill({ id: 'api', dependencies: [] })), /at most 128/);
  assert.deepEqual(artifact('report', 'https://example.test/report'), {
    kind: 'report', reference: 'https://example.test/report',
    checksum: 'sha256:1e8f5cb3245d42438228141963853c5bc8a8b12ce6c42b13ae8d8d4974462152',
  });
});

test('canonical queue repository atomically creates and binds intake, then closes the run', async () => {
  const queries = [];
  const events = [];
  const row = {
    tenant_id: 'engineering-team', queue_id: 'factory:281', task_id: null, project_id: null,
    title: 'Production lifecycle', requirements: 'Ship safely', template_tier: 'Complex',
    changed_files: [], github_issue_url: null, metadata: {},
  };
  const client = {
    async query(sql, params) {
      queries.push([String(sql), params]);
      if (/SELECT tenant_id/.test(sql)) return { rows: [row] };
      return { rows: [] };
    },
    release() { queries.push(['RELEASE']); },
  };
  const store = {
    kind: 'postgres',
    pool: { async query() { return { rows: [] }; }, async connect() { return client; } },
    async appendEvent(event) { events.push(event); return { event, duplicate: false }; },
  };
  const repository = createQueueRepository(store);
  const created = await repository.createIntake(request('intake'));
  assert.match(created.taskId, /^TSK-LG[A-F0-9]{16}$/);
  assert.match(created.projectId, /^PRJ-[A-F0-9]{8}$/);
  assert.ok(queries.some(([sql]) => /FOR UPDATE/.test(sql)));
  assert.ok(queries.some(([sql]) => /UPDATE factory_delivery_queue/.test(sql)));
  assert.ok(queries.some(([sql]) => sql === 'COMMIT'));
  assert.equal(events[0].eventType, 'task.created');
  await repository.close(request('closeout'));
  assert.ok(queries.some(([sql]) => /SET stage = 'completed'/.test(sql)));
});

test('production composition rejects non-Postgres stores', () => {
  assert.throws(() => createProductionLifecycleHandlers({ store: { kind: 'file' } }), /canonical PostgreSQL/);
});
