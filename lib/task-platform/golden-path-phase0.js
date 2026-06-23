const fs = require('node:fs');
const path = require('node:path');
const { signHmacJwt } = require('../auth/jwt');

const DEFAULT_BASE_URL = 'http://127.0.0.1:13000';
const DEFAULT_OUTPUT = 'observability/golden-path-pilot.json';

function buildUrl(baseUrl, route) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
}

function makeBearerToken({ jwtSecret, tenantId, actorId, roles }) {
  if (!jwtSecret) {
    throw new Error('AUTH_JWT_SECRET is required');
  }
  const now = Math.floor(Date.now() / 1000);
  return signHmacJwt({
    sub: actorId,
    tenant_id: tenantId,
    roles,
    iat: now,
    exp: now + 300,
  }, jwtSecret);
}

function authHeaders(context, roles) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${makeBearerToken({ ...context, roles })}`,
  };
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  return {
    status: response.status,
    ok: response.ok,
    body: await response.json().catch(() => ({})),
  };
}

function data(result) {
  return result?.body?.data;
}

async function apiSend(ctx, route, method, roles, body) {
  return fetchJson(ctx.fetchImpl, buildUrl(ctx.baseUrl, route), {
    method,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(ctx, roles),
    },
    body: JSON.stringify(body),
  });
}

async function apiGet(ctx, route, roles = ['reader']) {
  return fetchJson(ctx.fetchImpl, buildUrl(ctx.baseUrl, route), {
    headers: authHeaders(ctx, roles),
  });
}

function resolveOptions(options = {}) {
  const baseUrl = String(
    options.baseUrl
    || process.env.GOLDEN_PATH_BASE_URL
    || process.env.PROJECTS_PROD_BASE_URL
    || process.env.AUTH_PROD_BASE_URL
    || process.env.AUTH_PUBLIC_APP_URL
    || DEFAULT_BASE_URL,
  ).trim();

  const tenantId = String(
    options.tenantId
    || process.env.GOLDEN_PATH_TENANT_ID
    || process.env.PROJECTS_PROD_TENANT_ID
    || process.env.TENANT_ID
    || 'engineering-team',
  ).trim();

  return {
    fetchImpl: options.fetchImpl || fetch,
    baseUrl,
    tenantId,
    actorId: String(options.actorId || process.env.GOLDEN_PATH_ACTOR_ID || 'golden-path-operator').trim(),
    jwtSecret: options.jwtSecret || process.env.GOLDEN_PATH_JWT_SECRET || process.env.AUTH_JWT_SECRET,
    epicIssueNumber: Number(options.epicIssueNumber || process.env.GOLDEN_PATH_EPIC_ISSUE || 269),
    childIssueNumber: options.childIssueNumber != null ? Number(options.childIssueNumber) : null,
    childIssueUrl: options.childIssueUrl || null,
    outputPath: options.outputPath || DEFAULT_OUTPUT,
    projectName: options.projectName || `Golden Path Pilot - Issue ${options.childIssueNumber || 'TBD'}`,
  };
}

function buildTaskDescription({ childIssueUrl, epicIssueNumber, childIssueNumber }) {
  return [
    'Golden Path supervised pilot task (Phase 0 intake).',
    '',
    `Parent epic: https://github.com/wiinc1/engineering-team/issues/${epicIssueNumber}`,
    childIssueUrl ? `Pilot issue: ${childIssueUrl}` : (childIssueNumber ? `Pilot issue: #${childIssueNumber}` : ''),
    '',
    'Acceptance criteria:',
    '- GP-001–GP-027 logged in docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md',
    '- Intentional QA fail then retest pass',
    '- forgeadapter local-stack lifecycle exercised',
    '- PM + Architect close review recorded',
    '- Local deploy validation recorded (lint, test:unit, standards:check)',
    '',
    'Deliverable: docs-only README golden-path marker + evidence report.',
  ].filter(Boolean).join('\n');
}

async function runGoldenPathPhase0(options = {}) {
  const ctx = resolveOptions(options);
  if (!ctx.jwtSecret) {
    throw new Error('AUTH_JWT_SECRET (or GOLDEN_PATH_JWT_SECRET) is required');
  }

  const api = {};
  api.createProject = await apiSend(ctx, '/api/v1/projects', 'POST', ['pm'], {
    name: ctx.projectName,
    summary: 'Supervised golden-path pilot. One task only until closeout.',
    status: 'ACTIVE',
    metadata: {
      goldenPath: true,
      epicIssue: ctx.epicIssueNumber,
      childIssue: ctx.childIssueNumber,
      githubIssueUrl: ctx.childIssueUrl,
    },
  });

  if (!api.createProject.ok) {
    throw new Error(`Project create failed (${api.createProject.status}): ${JSON.stringify(api.createProject.body)}`);
  }

  const project = data(api.createProject);
  const projectId = project?.projectId;
  if (!projectId) {
    throw new Error('Project create succeeded but projectId is missing');
  }

  api.createTask = await apiSend(ctx, '/api/v1/tasks', 'POST', ['admin'], {
    title: 'Golden path pilot — README marker + evidence report',
    description: buildTaskDescription(ctx),
    status: 'DRAFT',
    priority: 'P2',
    metadata: {
      goldenPath: true,
      epicIssue: ctx.epicIssueNumber,
      childIssue: ctx.childIssueNumber,
      github_issue_url: ctx.childIssueUrl,
      intake_draft: true,
    },
  });

  if (!api.createTask.ok) {
    throw new Error(`Task create failed (${api.createTask.status}): ${JSON.stringify(api.createTask.body)}`);
  }

  const task = data(api.createTask);
  const taskId = task?.taskId;
  if (!taskId) {
    throw new Error('Task create succeeded but taskId is missing');
  }

  api.assignPm = await apiSend(ctx, `/api/v1/tasks/${encodeURIComponent(taskId)}/owner`, 'PATCH', ['pm'], {
    ownerAgentId: 'pm',
    version: task.version,
  });

  if (!api.assignPm.ok) {
    throw new Error(`PM owner assign failed (${api.assignPm.status}): ${JSON.stringify(api.assignPm.body)}`);
  }

  let assignedTask = data(api.assignPm);

  async function attachTaskWithVersionRetry() {
    let attachVersion = assignedTask.version;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attachAttempt = await apiSend(ctx, `/api/v1/tasks/${encodeURIComponent(taskId)}/project`, 'PATCH', ['pm'], {
        projectId,
        version: attachVersion,
      });
      if (attachAttempt.ok) {
        return attachAttempt;
      }
      const expectedVersion = attachAttempt.body?.error?.details?.expectedVersion;
      if (attachAttempt.status === 409 && Number.isInteger(expectedVersion)) {
        attachVersion = expectedVersion;
        continue;
      }
      return attachAttempt;
    }
    return apiSend(ctx, `/api/v1/tasks/${encodeURIComponent(taskId)}/project`, 'PATCH', ['pm'], {
      projectId,
      version: assignedTask.version,
    });
  }

  api.attachTask = await attachTaskWithVersionRetry();

  if (!api.attachTask.ok) {
    throw new Error(`Task attach failed (${api.attachTask.status}): ${JSON.stringify(api.attachTask.body)}`);
  }

  const attachedTask = data(api.attachTask);

  api.auditState = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/state`, ['reader']);

  const evidence = {
    schemaVersion: '1.0',
    epic: 'golden-path-autonomous-delivery',
    status: 'phase0_started',
    githubIssueUrl: ctx.childIssueUrl,
    githubEpicIssueUrl: `https://github.com/wiinc1/engineering-team/issues/${ctx.epicIssueNumber}`,
    engineeringTeam: {
      projectId,
      taskId,
      projectName: ctx.projectName,
      taskVersion: attachedTask?.version ?? assignedTask?.version ?? task.version,
      workflow: assignedTask?.workflow ?? null,
      auditStage: data(api.auditState)?.current_stage ?? null,
    },
    forgeadapter: {
      taskId: 'TSK-GOLDEN001',
      startJobId: null,
      completeJobId: null,
    },
    github: {
      prUrl: null,
      mergeCommitSha: null,
    },
    deploy: {
      operatorUrl: ctx.baseUrl,
    },
    stepsCompleted: ['GP-001', 'GP-002', 'GP-005'],
    manualInterventions: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    phase0: {
      mode: options.localBaseDir ? 'local_file_backend' : 'remote_api',
      localBaseDir: options.localBaseDir || null,
      baseUrl: ctx.baseUrl,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      api: {
        createProjectStatus: api.createProject.status,
        createTaskStatus: api.createTask.status,
        assignPmStatus: api.assignPm.status,
        attachTaskStatus: api.attachTask.status,
        auditStateStatus: api.auditState.status,
      },
    },
  };

  const outputPath = path.resolve(process.cwd(), ctx.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

  return evidence;
}

module.exports = {
  runGoldenPathPhase0,
  resolveOptions,
  buildTaskDescription,
};