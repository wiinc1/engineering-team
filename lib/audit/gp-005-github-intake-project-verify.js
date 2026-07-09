const fs = require('node:fs');
const path = require('node:path');
const {
  applyLocalGoldenPathEnvIfNeeded,
  assertStagingRuntimeReady,
  resolveStagingRuntime,
} = require('../task-platform/staging-runtime');
const { authHeaders } = require('../../scripts/golden-path-smoke-lib');
const {
  postIssueWebhook,
  readStackState,
  stackHasAuditApi,
  DEFAULT_STACK_STATE,
} = require('./gp-002-github-intake-verify');
const { resolveForgeIntakeProvider, resolveWebhookSecret } = require('./forge-intake-verify');

async function fetchTaskDetail(runtime, taskId, jwtSecret) {
  const headers = authHeaders(jwtSecret, runtime.tenantId);
  const response = await runtime.fetchImpl(
    `${runtime.baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
    { headers },
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

function resolveGp005Runtime(options = {}) {
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: options.baseUrl,
    jwtSecret: options.jwtSecret,
    githubWebhookSecret: options.githubWebhookSecret,
    gitlabWebhookSecret: options.gitlabWebhookSecret,
    forgeIntakeProvider: options.forgeIntakeProvider || options.intakeProvider || 'github',
    gitlabBaseUrl: options.gitlabBaseUrl,
    gitlabProjectPath: options.gitlabProjectPath,
    outputDir: options.outputDir || 'observability/gp-005-staging',
  })));
  runtime.fetchImpl = options.fetchImpl || runtime.fetchImpl || fetch;
  return runtime;
}

function buildGp005Evidence(runtime, intakeProvider, issueNumber) {
  return {
    schemaVersion: '1.0',
    kind: intakeProvider === 'gitlab' ? 'gp-005-gitlab-intake-project-verify' : 'gp-005-github-intake-project-verify',
    intakeProvider,
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    issueNumber,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };
}

function addGp005RuntimeChecks(evidence, { hostedProfile, runtime, stackState, stackStatePath }) {
  if (hostedProfile) {
    evidence.summary.checks.push({ name: 'hosted_profile', ok: true, profile: runtime.profile });
    return;
  }
  evidence.summary.checks.push({ name: 'stack_state_present', ok: Boolean(stackState), stackStatePath });
  evidence.summary.checks.push({
    name: 'audit_api_process_alive',
    ok: stackHasAuditApi(stackState, { requireAlive: true }),
    pid: stackState?.processes?.find((entry) => entry.name === 'audit-api')?.pid ?? null,
  });
}

async function runGp005WebhookChecks(runtime, evidence, secret, issueNumber, deliveryPrefix) {
  const created = await postIssueWebhook(runtime, { issueNumber, deliveryId: `${deliveryPrefix}-create-${issueNumber}`, secret });
  const taskId = created.body?.taskId || created.body?.task_id || null;
  const projectId = created.body?.projectId || created.body?.projectBootstrap?.projectId || null;
  evidence.intake = { createStatus: created.status, body: created.body, taskId, projectId };
  evidence.summary.checks.push({
    name: 'intake_draft_created',
    ok: created.status === 201 && Boolean(taskId),
    status: created.status,
    taskId,
  });
  evidence.summary.checks.push({
    name: 'project_bootstrapped_on_intake',
    ok: Boolean(projectId) && created.body?.projectBootstrap?.projectId === projectId,
    projectId,
    projectName: created.body?.projectName || null,
  });

  const duplicate = await postIssueWebhook(runtime, { issueNumber, deliveryId: `${deliveryPrefix}-duplicate-${issueNumber}`, secret });
  evidence.duplicate = { status: duplicate.status, body: duplicate.body };
  evidence.summary.checks.push({
    name: 'duplicate_webhook_preserves_project_link',
    ok: duplicate.status === 202
      && duplicate.body?.taskId === taskId
      && (duplicate.body?.projectId || duplicate.body?.projectBootstrap?.projectId) === projectId,
    status: duplicate.status,
    projectId: duplicate.body?.projectId || duplicate.body?.projectBootstrap?.projectId || null,
  });
  return { created, taskId, projectId };
}

async function runGp005TaskDetailCheck(runtime, evidence, taskId, projectId) {
  const detail = taskId ? await fetchTaskDetail(runtime, taskId, runtime.jwtSecret) : { status: null, ok: false, body: {} };
  const task = detail.body?.data || detail.body || {};
  evidence.task = {
    status: detail.status,
    projectId: task.projectId || task.project_id || null,
    projectName: task.project?.name || task.projectName || null,
  };
  evidence.summary.checks.push({
    name: 'task_detail_shows_project_link',
    ok: detail.status === 200 && (task.projectId || task.project_id) === projectId,
    projectId: evidence.task.projectId,
  });
}

function buildGp005Complete(evidence, verifyPath, created, taskId, projectId, intakeProvider) {
  return {
    schemaVersion: '1.0',
    kind: 'gp-005-complete',
    milestone: 'GP-005',
    title: 'GitHub intake project bootstrap',
    generatedAt: evidence.generatedAt,
    profile: evidence.profile,
    baseUrl: evidence.baseUrl,
    summary: {
      passed: evidence.summary.passed,
      taskId,
      projectId,
      intakeProvider,
      forgeIssueUrl: created.body?.forgeIssueUrl || created.body?.gitlabIssueUrl || created.body?.githubIssueUrl || null,
    },
    exitCriteria: {
      intakeDraftCreated: evidence.summary.checks.find((check) => check.name === 'intake_draft_created')?.ok === true,
      projectBootstrapped: evidence.summary.checks.find((check) => check.name === 'project_bootstrapped_on_intake')?.ok === true,
      idempotentProjectLink: evidence.summary.checks.find((check) => check.name === 'duplicate_webhook_preserves_project_link')?.ok === true,
      taskShowsProject: evidence.summary.checks.find((check) => check.name === 'task_detail_shows_project_link')?.ok === true,
    },
    artifacts: { verify: path.relative(process.cwd(), path.resolve(verifyPath)) },
    notes: [
      'Requires FF_GITHUB_INTAKE_NORMALIZER=true and FF_GITHUB_INTAKE_PROJECT_BOOTSTRAP=true.',
      'Mirrors golden-path-phase0.js project bootstrap for GitHub issue intake (factory-intake / golden-path labels).',
    ],
  };
}

function writeGp005Artifacts(verifyPath, completePath, evidence, complete) {
  fs.writeFileSync(path.resolve(verifyPath), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.resolve(completePath), `${JSON.stringify(complete, null, 2)}\n`);
  evidence.artifacts.verify = verifyPath;
  evidence.artifacts.complete = completePath;
}

async function runGp005GithubIntakeProjectVerify(options = {}) {
  const runtime = resolveGp005Runtime(options);

  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const hostedProfile = options.hosted === true || runtime.profile === 'hosted-staging';
  const stackStatePath = options.stackStatePath || DEFAULT_STACK_STATE;
  const stackState = hostedProfile ? null : readStackState(stackStatePath);
  const secret = resolveWebhookSecret(runtime, options);
  const intakeProvider = resolveForgeIntakeProvider({ ...runtime, ...options });
  const issueNumber = Number(options.issueNumber || (910_000 + Math.floor(Math.random() * 89_000)));
  const deliveryPrefix = options.deliveryPrefix || 'gp-005-verify';

  const evidence = buildGp005Evidence(runtime, intakeProvider, issueNumber);
  addGp005RuntimeChecks(evidence, { hostedProfile, runtime, stackState, stackStatePath });
  const { created, taskId, projectId } = await runGp005WebhookChecks(runtime, evidence, secret, issueNumber, deliveryPrefix);
  await runGp005TaskDetailCheck(runtime, evidence, taskId, projectId);
  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  const completePath = options.completePath || path.join(outputDir, 'gp-005-complete.json');
  const verifyPath = options.verifyPath || path.join(outputDir, 'gp-005-github-intake-project-verify.json');
  const complete = buildGp005Complete(evidence, verifyPath, created, taskId, projectId, intakeProvider);
  writeGp005Artifacts(verifyPath, completePath, evidence, complete);
  return { evidence, complete };
}

module.exports = {
  runGp005GithubIntakeProjectVerify,
};
