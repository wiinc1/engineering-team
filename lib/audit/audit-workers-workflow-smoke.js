const crypto = require('node:crypto');

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text().catch(() => '');
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, ok: response.ok, body, text };
}

function taskApiPath(taskId, suffix = '') {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}${suffix}`;
}

async function waitForProjectedField(ctx, taskId, authHeaders, predicate, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 6);
  const waitMs = Number(options.waitMs || 1000);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await fetchJson(
      ctx.fetchImpl,
      `${ctx.baseUrl.replace(/\/+$/, '')}${taskApiPath(taskId, '/state')}`,
      { headers: authHeaders },
    );
    const projected = state.body?.data || state.body || {};
    if (state.status === 200 && predicate(projected)) {
      return { ok: true, attempt, projected, status: state.status };
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return { ok: false, attempt: maxAttempts, projected: null, status: null };
}

async function runIntakeProjectionSmoke(ctx, authHeaders, options = {}) {
  const idempotencyKey = `gp-007-intake-smoke:${crypto.randomUUID()}`;
  const create = await fetchJson(
    ctx.fetchImpl,
    `${ctx.baseUrl.replace(/\/+$/, '')}/tasks`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        title: 'GP-007 intake projection smoke',
        raw_requirements: 'Verify intake draft projection updates next_required_action without manual catch-up.',
      }),
    },
  );

  const taskId = create.body?.taskId || create.body?.task_id || create.body?.data?.task_id || null;
  const wait = taskId
    ? await waitForProjectedField(
      ctx,
      taskId,
      authHeaders,
      (projected) => Boolean(
        projected.next_required_action
        || projected.nextRequiredAction
        || projected.waiting_state === 'task_refinement'
        || projected.waitingState === 'task_refinement',
      ),
      options,
    )
    : { ok: false, projected: null, status: null, attempt: 0 };

  return {
    createStatus: create.status,
    taskId,
    projected: wait.projected,
    ok: create.status === 201 && wait.ok,
    attempts: wait.attempt,
  };
}

async function runAuditWorkersWorkflowSmoke(options = {}) {
  const ctx = {
    fetchImpl: options.fetchImpl || fetch,
    baseUrl: String(options.baseUrl || '').trim(),
    tenantId: String(options.tenantId || 'engineering-team').trim(),
  };
  const authHeaders = options.authHeaders || {};
  const evidence = {
    schemaVersion: '1.0',
    kind: 'audit-workers-workflow-smoke',
    generatedAt: new Date().toISOString(),
    baseUrl: ctx.baseUrl,
    summary: { passed: false, checks: [] },
    intake: null,
  };

  evidence.intake = await runIntakeProjectionSmoke(ctx, authHeaders, options);
  evidence.summary.checks.push({
    name: 'intake_draft_created',
    ok: evidence.intake.createStatus === 201,
    status: evidence.intake.createStatus,
    taskId: evidence.intake.taskId,
  });
  evidence.summary.checks.push({
    name: 'intake_next_required_action_projected',
    ok: evidence.intake.ok === true,
    nextRequiredAction: evidence.intake.projected?.next_required_action
      || evidence.intake.projected?.nextRequiredAction
      || null,
    waitingState: evidence.intake.projected?.waiting_state
      || evidence.intake.projected?.waitingState
      || null,
    attempts: evidence.intake.attempts,
  });

  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  return evidence;
}

module.exports = {
  runAuditWorkersWorkflowSmoke,
  runIntakeProjectionSmoke,
  waitForProjectedField,
};