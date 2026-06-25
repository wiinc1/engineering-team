const fs = require('node:fs');
const path = require('node:path');
const {
  applyLocalGoldenPathEnvIfNeeded,
  assertStagingRuntimeReady,
  resolveStagingRuntime,
} = require('../task-platform/staging-runtime');
const { authHeaders } = require('../../scripts/golden-path-smoke-lib');
const { waitForProjectedField } = require('./audit-workers-workflow-smoke');
const {
  buildIssuePayload,
  expectedForgeIssueUrl,
  postIssueWebhook,
  resolveForgeIntakeProvider,
  resolveWebhookSecret,
  readCreatedForgeIssueUrl,
} = require('./forge-intake-verify');

const DEFAULT_STACK_STATE = 'observability/golden-path-local-dev/stack.json';

function isProcessAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readStackState(stackStatePath = DEFAULT_STACK_STATE) {
  const resolved = path.resolve(stackStatePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function stackHasAuditApi(stackState, options = {}) {
  if (!stackState?.processes) return false;
  const entry = stackState.processes.find((processEntry) => processEntry.name === 'audit-api');
  if (!entry || Number(entry.pid) <= 0) return false;
  if (options.requireAlive === false) return true;
  return isProcessAlive(entry.pid);
}

async function fetchTaskHistory(runtime, taskId, jwtSecret) {
  const headers = authHeaders(jwtSecret, runtime.tenantId);
  const response = await runtime.fetchImpl(
    `${runtime.baseUrl.replace(/\/+$/, '')}/tasks/${encodeURIComponent(taskId)}/history`,
    { headers },
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

async function runGp002GithubIntakeVerify(options = {}) {
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: options.baseUrl,
    jwtSecret: options.jwtSecret,
    githubWebhookSecret: options.githubWebhookSecret,
    gitlabWebhookSecret: options.gitlabWebhookSecret,
    forgeIntakeProvider: options.forgeIntakeProvider || options.intakeProvider,
    gitlabBaseUrl: options.gitlabBaseUrl,
    gitlabProjectPath: options.gitlabProjectPath,
    outputDir: options.outputDir || 'observability/gp-002-staging',
  })));
  runtime.fetchImpl = options.fetchImpl || runtime.fetchImpl || fetch;
  const intakeProvider = resolveForgeIntakeProvider({ ...runtime, ...options });

  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const hostedProfile = options.hosted === true || runtime.profile === 'hosted-staging';
  const stackStatePath = options.stackStatePath || DEFAULT_STACK_STATE;
  const stackState = hostedProfile ? null : readStackState(stackStatePath);
  const secret = resolveWebhookSecret(runtime, options);
  const issueNumber = Number(options.issueNumber || (900_000 + Math.floor(Math.random() * 99_000)));
  const deliveryPrefix = options.deliveryPrefix || 'gp-002-verify';
  const expectedIssueUrl = expectedForgeIssueUrl(issueNumber, { ...runtime, ...options });

  const evidence = {
    schemaVersion: '1.0',
    kind: intakeProvider === 'gitlab' ? 'gp-002-gitlab-intake-verify' : 'gp-002-github-intake-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    intakeProvider,
    issueNumber,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };

  if (!hostedProfile) {
    evidence.summary.checks.push({
      name: 'stack_state_present',
      ok: Boolean(stackState),
      stackStatePath,
    });
    evidence.summary.checks.push({
      name: 'audit_api_process_alive',
      ok: stackHasAuditApi(stackState, { requireAlive: true }),
      pid: stackState?.processes?.find((entry) => entry.name === 'audit-api')?.pid ?? null,
    });
  } else {
    evidence.summary.checks.push({
      name: 'hosted_profile',
      ok: true,
      profile: runtime.profile,
    });
  }

  const created = await postIssueWebhook(runtime, {
    issueNumber,
    deliveryId: `${deliveryPrefix}-create-${issueNumber}`,
    secret,
  });
  const taskId = created.body?.taskId || created.body?.task_id || null;
  evidence.intake = {
    createStatus: created.status,
    body: created.body,
    taskId,
  };
  evidence.summary.checks.push({
    name: 'issues_opened_creates_intake_draft',
    ok: created.status === 201 && created.body?.created === true && Boolean(taskId),
    status: created.status,
    taskId,
    forgeIssueUrl: created.body?.forgeIssueUrl || created.body?.gitlabIssueUrl || created.body?.githubIssueUrl || null,
    intakeDraft: created.body?.intakeDraft === true,
    intakeProvider: created.provider || intakeProvider,
  });

  const duplicate = await postIssueWebhook(runtime, {
    issueNumber,
    deliveryId: `${deliveryPrefix}-duplicate-${issueNumber}`,
    secret,
  });
  evidence.duplicate = {
    status: duplicate.status,
    body: duplicate.body,
  };
  evidence.summary.checks.push({
    name: 'duplicate_webhook_returns_existing_task',
    ok: duplicate.status === 202
      && duplicate.body?.reason === 'existing_intake_task'
      && duplicate.body?.taskId === taskId,
    status: duplicate.status,
    taskId: duplicate.body?.taskId || null,
  });

  const jwtHeaders = authHeaders(runtime.jwtSecret, runtime.tenantId);
  const projection = taskId
    ? await waitForProjectedField(
      { fetchImpl: runtime.fetchImpl, baseUrl: runtime.baseUrl, tenantId: runtime.tenantId },
      taskId,
      jwtHeaders,
      (projected) => (
        projected.waiting_state === 'task_refinement'
        || projected.waitingState === 'task_refinement'
      ) && (
        projected.assignee === 'pm'
        || projected.current_owner === 'pm'
        || projected.owner?.actor_id === 'pm'
      ),
      { waitMs: options.waitMs, maxAttempts: options.maxAttempts },
    )
    : { ok: false, projected: null };

  evidence.projection = {
    ok: projection.ok,
    projected: projection.projected,
    attempts: projection.attempt,
  };
  evidence.summary.checks.push({
    name: 'task_waiting_for_pm_refinement',
    ok: projection.ok === true,
    waitingState: projection.projected?.waiting_state || projection.projected?.waitingState || null,
    assignee: projection.projected?.assignee
      || projection.projected?.current_owner
      || projection.projected?.owner?.actor_id
      || null,
    attempts: projection.attempt,
  });

  const history = taskId
    ? await fetchTaskHistory(runtime, taskId, runtime.jwtSecret)
    : { status: null, ok: false, body: {} };
  const createdEvent = (history.body?.items || []).find((item) => item.event_type === 'task.created');
  const recordedIssueUrl = readCreatedForgeIssueUrl(history.body, issueNumber, { ...runtime, ...options });
  evidence.history = {
    status: history.status,
    forgeIssueUrl: recordedIssueUrl,
    hasRefinementRequested: (history.body?.items || []).some((item) => item.event_type === 'task.refinement_requested'),
  };
  evidence.summary.checks.push({
    name: 'task_created_records_forge_issue_url',
    ok: history.status === 200 && recordedIssueUrl === expectedIssueUrl,
    forgeIssueUrl: recordedIssueUrl,
    expectedIssueUrl,
  });
  evidence.summary.checks.push({
    name: 'task_refinement_requested_recorded',
    ok: evidence.history.hasRefinementRequested === true,
  });

  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);

  const smokePath = options.smokePath || path.join(outputDir, 'gp-002-github-intake-smoke.json');
  const completePath = options.completePath || path.join(outputDir, 'gp-002-complete.json');
  const verifyPath = options.verifyPath || path.join(outputDir, 'gp-002-github-intake-verify.json');
  const canonicalSmokePath = options.canonicalSmokePath || 'observability/gp-002-github-intake-smoke.json';

  const smoke = {
    schemaVersion: '1.0',
    kind: 'gp-002-staging-smoke',
    generatedAt: evidence.generatedAt,
    baseUrl: runtime.baseUrl,
    issueNumber,
    status: created.status,
    ok: created.ok,
    body: created.body,
    summary: {
      passed: evidence.summary.checks.find((check) => check.name === 'issues_opened_creates_intake_draft')?.ok === true,
      taskId,
    },
  };

  const complete = {
    schemaVersion: '1.0',
    kind: 'gp-002-complete',
    milestone: 'GP-002',
    title: intakeProvider === 'gitlab' ? 'GitLab issue intake normalizer' : 'GitHub issue intake normalizer',
    generatedAt: evidence.generatedAt,
    profile: evidence.profile,
    baseUrl: evidence.baseUrl,
    summary: {
      passed: evidence.summary.passed,
      taskId,
      intakeProvider,
      forgeIssueUrl: created.body?.forgeIssueUrl || created.body?.gitlabIssueUrl || created.body?.githubIssueUrl || null,
    },
    exitCriteria: {
      intakeDraftCreated: evidence.summary.checks.find((check) => check.name === 'issues_opened_creates_intake_draft')?.ok === true,
      idempotentDuplicate: evidence.summary.checks.find((check) => check.name === 'duplicate_webhook_returns_existing_task')?.ok === true,
      pmRefinementWaiting: evidence.summary.checks.find((check) => check.name === 'task_waiting_for_pm_refinement')?.ok === true,
      forgeIssueUrlRecorded: evidence.summary.checks.find((check) => check.name === 'task_created_records_forge_issue_url')?.ok === true,
    },
    artifacts: {
      verify: path.relative(process.cwd(), path.resolve(verifyPath)),
      smoke: path.relative(process.cwd(), path.resolve(smokePath)),
      canonicalSmoke: canonicalSmokePath,
    },
    notes: [
      'Coordinated stack proof: npm run dev:golden-path:up with FF_GITLAB_INTAKE_NORMALIZER=true (default provider: gitlab).',
      'GitHub optional: FORGE_INTAKE_PROVIDER=github with FF_GITHUB_INTAKE_NORMALIZER=true.',
      'Opt-in via factory-intake label; GitLab uses X-Gitlab-Token (GITLAB_WEBHOOK_SECRET), GitHub uses signature (GITHUB_WEBHOOK_SECRET).',
      'Replaces manual seed-golden-path-phase0.js intake transcription for GP-002.',
    ],
  };

  fs.writeFileSync(path.resolve(verifyPath), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.resolve(smokePath), `${JSON.stringify(smoke, null, 2)}\n`);
  fs.writeFileSync(path.resolve(completePath), `${JSON.stringify(complete, null, 2)}\n`);
  fs.mkdirSync(path.dirname(path.resolve(canonicalSmokePath)), { recursive: true });
  fs.copyFileSync(path.resolve(smokePath), path.resolve(canonicalSmokePath));

  evidence.artifacts.verify = verifyPath;
  evidence.artifacts.smoke = smokePath;
  evidence.artifacts.complete = completePath;
  evidence.artifacts.canonicalSmoke = canonicalSmokePath;

  return { evidence, complete, smoke };
}

module.exports = {
  DEFAULT_STACK_STATE,
  buildIssuePayload,
  isProcessAlive,
  postIssueWebhook,
  readStackState,
  stackHasAuditApi,
  runGp002GithubIntakeVerify,
};