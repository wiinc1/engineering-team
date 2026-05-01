const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createAuditStore } = require('./store');
const { authorize } = require('./authz');
const { createJwtVerifier, signHmacJwt, getBearerToken, buildPrincipalFromClaims, verifyBrowserAuthCode } = require('../auth/jwt');
const { createAuditLogger } = require('./logger');
const {
  isAuditFoundationEnabled,
  isWorkflowEngineEnabled,
  assertAuditFoundationEnabled,
  assertWorkflowEngineEnabled,
  assertGitHubSyncEnabled,
  assertTaskCreationEnabled,
  assertIntakeDraftCreationEnabled,
  assertExecutionContractsEnabled,
  assertTaskAssignmentEnabled,
  assertTaskAssignmentNotKilled,
  assertArchitectSpecTieringEnabled,
  assertEngineerSubmissionEnabled,
  assertTaskLockingEnabled,
  assertStructuredCommentsEnabled,
  assertQaStageEnabled,
  assertQaContextRoutingEnabled,
  assertSreMonitoringEnabled,
  assertChildTaskCreationEnabled,
  isCloseCancellationEnabled,
  assertCloseCancellationEnabled,
  assertReassignmentGhostingEnabled,
  isDependencyPlannerEnabled,
  assertDependencyPlannerEnabled,
  assertOrchestrationSchedulerEnabled,
  isOrchestrationVisibilityEnabled,
} = require('./feature-flags');
const { isWorkflowAuditEventType } = require('./event-types');
const { resolveAgentRegistry, findAgentById } = require('./agents');
const { WorkflowError, STAGES } = require('./workflow');
const { deriveReviewQuestions, REVIEW_QUESTION_STATES } = require('./review-questions');
const { deriveWorkflowThreads, WORKFLOW_COMMENT_TYPES, WORKFLOW_THREAD_STATES, defaultNotificationTargets, normalizeCommentType, normalizeArray: normalizeThreadArray } = require('./workflow-threads');
const { deriveImplementationHistory, deriveQaResults, normalizeArray: normalizeQaArray } = require('./qa-results');
const { createTaskLockPayload, getActiveTaskLock, isTaskLockEventType } = require('./task-locks');
const { inferTaskIdsFromWebhook, normalizeWebhookPr, verifyGitHubWebhookSignature } = require('./github');
const { collectLinkedPrs, summarizePrStatus } = require('./linked-prs');
const { buildOrchestrationView, evaluateOrchestrationStart } = require('./orchestration');
const {
  EXECUTION_CONTRACT_APPROVED_ACTION,
  EXECUTION_CONTRACT_NEXT_ACTION,
  EXECUTION_CONTRACT_OWNER,
  EXECUTION_CONTRACT_REVIEW_ACTION,
  EXECUTION_CONTRACT_WAITING_STATE,
  ARTIFACT_BUNDLE_APPROVED_ACTION,
  ARTIFACT_BUNDLE_REVIEW_ACTION,
  VERIFICATION_REPORT_GENERATED_ACTION,
  approveExecutionContractArtifactBundle,
  contractMarkdown,
  createExecutionContractDraft,
  createExecutionContractArtifactBundle,
  createExecutionContractVerificationReportSkeleton,
  deriveExecutionContractProjection,
  evaluateExecutionContractDispatchReadiness,
  evaluateExecutionContractApprovalReadiness,
  isIntakeDraftSummary,
  normalizeArtifactIdentity,
  validateExecutionContract,
} = require('./execution-contracts');
const { createTaskPlatformService } = require('../task-platform');
const { ConflictError, NotFoundError, ValidationError, validateRequest, withErrorHandling } = require('../http/standard');
const { isLocalLikeEnvironment } = require('./config');
const { createMagicLinkAuthService, sanitizeNextPath } = require('../auth/magic-link');

const ENGINEER_TIERS = Object.freeze(['Principal', 'Sr', 'Jr']);
const ENGINEER_CHECK_IN_INTERVAL_MINUTES = 15;
const MISSED_CHECK_IN_THRESHOLD = 2;
const TECHNICAL_SPEC_FIELDS = Object.freeze(['summary', 'scope', 'design', 'rolloutPlan']);
const MONITORING_SPEC_FIELDS = Object.freeze(['service', 'dashboardUrls', 'alertPolicies', 'runbook', 'successMetrics']);
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const GITHUB_PR_URL_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:\/?\S*)?$/i;
const BROWSER_SESSION_TTL_SECONDS = 60 * 60;
const GITHUB_SYNC_STALE_MS = 5 * 60 * 1000;
const SRE_MONITORING_WINDOW_HOURS = 48;
const SRE_MONITORING_WINDOW_MS = SRE_MONITORING_WINDOW_HOURS * 60 * 60 * 1000;
const UNTITLED_INTAKE_DRAFT_TITLE = 'Untitled intake draft';
const PM_REFINEMENT_REQUIRED_ACTION = 'PM refinement required';
const INTAKE_DRAFT_TITLE_MAX_LENGTH = 120;
const INTAKE_CREATION_FAILED_ACTION = 'Review failed intake creation before retrying PM refinement routing';

function normalizeTaskCreateBody(body = {}) {
  const hasRawRequirements = Object.prototype.hasOwnProperty.call(body, 'raw_requirements')
    || Object.prototype.hasOwnProperty.call(body, 'rawRequirements');
  const rawRequirementsValue = body.raw_requirements ?? body.rawRequirements;
  if (hasRawRequirements) {
    if (typeof rawRequirementsValue !== 'string' || rawRequirementsValue.trim().length === 0) {
      throw createHttpError(400, 'invalid_raw_requirements', 'raw_requirements is required and must be a non-empty string');
    }
    const rawRequirements = rawRequirementsValue.trim();
    if (body.title != null && typeof body.title !== 'string') {
      throw createHttpError(400, 'invalid_intake_title', 'title must be a string when provided');
    }
    const trimmedTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (trimmedTitle.length > INTAKE_DRAFT_TITLE_MAX_LENGTH) {
      throw createHttpError(400, 'invalid_intake_title', `title must be ${INTAKE_DRAFT_TITLE_MAX_LENGTH} characters or fewer`);
    }
    const title = trimmedTitle || UNTITLED_INTAKE_DRAFT_TITLE;
    return {
      mode: 'intake',
      title,
      rawRequirements,
      priority: body.priority || null,
      taskType: body.task_type || body.taskType || null,
      idempotencyKey: body.idempotencyKey || null,
      actorType: body.actorType || 'user',
    };
  }

  if (!body.title || !body.business_context || !body.acceptance_criteria || !body.definition_of_done || !body.priority || !body.task_type) {
    throw createHttpError(400, 'missing_required_fields', 'The following fields are required: raw_requirements, or legacy title, business_context, acceptance_criteria, definition_of_done, priority, task_type');
  }

  return {
    mode: 'legacy',
    title: body.title,
    businessContext: body.business_context,
    acceptanceCriteria: body.acceptance_criteria,
    definitionOfDone: body.definition_of_done,
    priority: body.priority,
    taskType: body.task_type,
    idempotencyKey: body.idempotencyKey || null,
    actorType: body.actorType || 'user',
  };
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        const error = new Error('request body too large');
        error.code = 'payload_too_large';
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('invalid json body');
        error.code = 'invalid_json';
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 1024 * 1024) {
        const error = new Error('request body too large');
        error.code = 'payload_too_large';
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function uniqTaskRefs(refs = []) {
  const seen = new Set();
  const result = [];
  for (const ref of refs) {
    if (!ref?.taskId || !ref?.tenantId) continue;
    const key = `${ref.tenantId}::${ref.taskId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ taskId: ref.taskId, tenantId: ref.tenantId });
  }
  return result;
}

async function resolveWebhookTaskRefs(store, taskIds = [], pr = null) {
  const [textMatches, linkedMatches] = await Promise.all([
    typeof store.resolveTaskRefs === 'function' ? store.resolveTaskRefs(taskIds) : [],
    pr && typeof store.findTaskRefsByLinkedPr === 'function' ? store.findTaskRefsByLinkedPr(pr) : [],
  ]);
  return uniqTaskRefs([...(textMatches || []), ...(linkedMatches || [])]);
}


function sendJson(res, statusCode, payload, requestId, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': requestId,
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload, requestId, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'x-request-id': requestId,
  });
  res.end(payload);
}

function sendRedirect(res, statusCode, location, requestId, extraHeaders = {}) {
  res.writeHead(statusCode, {
    location,
    'x-request-id': requestId,
    ...extraHeaders,
  });
  res.end();
}

function parseBooleanOption(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toPrometheus(metrics) {
  return Object.entries(metrics)
    .map(([key, value]) => (typeof value === 'number' ? `# TYPE ${key} gauge\n${key} ${value}` : null))
    .filter(Boolean)
    .join('\n') + '\n';
}

async function getRequestContext(req, options = {}) {
  const token = getBearerToken(req);
  if (token) {
    const verifier = options.jwtVerifier || createJwtVerifier({
      secret: options.jwtSecret || process.env.AUTH_JWT_SECRET,
      issuer: options.jwtIssuer || process.env.AUTH_JWT_ISSUER,
      audience: options.jwtAudience || process.env.AUTH_JWT_AUDIENCE,
      jwks: options.jwtJwks,
      jwksUrl: options.jwtJwksUrl || process.env.AUTH_JWT_JWKS_URL,
      jwksCacheMs: Number.parseInt(options.jwtJwksCacheMs || process.env.AUTH_JWT_JWKS_CACHE_MS || '', 10),
    });
    const claims = await verifier.verify(token);
    return buildPrincipalFromClaims(claims, options);
  }
  if (options.authService) {
    const cookieContext = await options.authService.getSessionContext(req);
    if (cookieContext) return cookieContext;
  }
  if (options.allowLegacyHeaders) {
    return {
      tenantId: req.headers['x-tenant-id'] || null,
      actorId: req.headers['x-actor-id'] || null,
      roles: String(req.headers['x-roles'] || '').split(',').map(v => v.trim()).filter(Boolean),
      authType: 'legacy-header',
    };
  }
  return null;
}

function createErrorResponse(error, requestId) {
  return {
    error: {
      code: error.code || 'internal_error',
      error_id: error.errorId || undefined,
      message: error.message || 'Internal server error',
      details: error.details || undefined,
      request_id: requestId,
      requestId,
    },
  };
}

function createAssignmentError(statusCode, code, message, details) {
  const error = createHttpError(statusCode, code, message, details);
  error.errorId = `ERR_TASK_ASSIGNMENT_${String(code || 'UNKNOWN').toUpperCase()}`;
  return error;
}

const validateAssignmentRequest = (body) => validateRequest(body, {
  properties: {
    agentId: { type: 'string' },
  },
});

const validateTaskPlatformCreateRequest = (body) => validateRequest(body, {
  required: ['title', 'status'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string' },
    priority: { type: 'string' },
    ownerAgentId: { type: 'string' },
    idempotencyKey: { type: 'string' },
  },
});

const validateTaskPlatformUpdateRequest = (body) => validateRequest(body, {
  required: ['version'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string' },
    priority: { type: 'string' },
    version: { type: 'integer' },
    idempotencyKey: { type: 'string' },
  },
});

const validateTaskPlatformOwnerRequest = (body) => validateRequest(body, {
  required: ['version'],
  properties: {
    ownerAgentId: { type: 'string' },
    version: { type: 'integer' },
    idempotencyKey: { type: 'string' },
  },
});

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeError(error) {
  if (error?.statusCode) return error;
  const normalized = new Error(error?.message || 'Internal server error');
  normalized.statusCode = 500;
  normalized.code = error?.code || 'internal_error';
  normalized.details = error?.details;
  normalized.errorId = error?.errorId;
  return normalized;
}

async function updateStoreMetrics(store, mutator) {
  if (typeof store.updateMetrics === 'function') {
    return store.updateMetrics(mutator);
  }
  return null;
}

async function recordAssignmentMetric(store, updates = {}) {
  await updateStoreMetrics(store, (metrics) => {
    metrics.feature_task_assignment_requests_total = Number(metrics.feature_task_assignment_requests_total || 0) + Number(updates.requests || 0);
    metrics.feature_task_assignment_errors_total = Number(metrics.feature_task_assignment_errors_total || 0) + Number(updates.errors || 0);
    metrics.feature_task_assignment_business_metric = Number(metrics.feature_task_assignment_business_metric || 0) + Number(updates.businessSuccess || 0);
    if (updates.durationMs != null) {
      metrics.feature_task_assignment_duration_ms_last = Number(updates.durationMs);
    }
  });
}

async function recordDependencyPlannerMetric(store, updates = {}) {
  await updateStoreMetrics(store, (metrics) => {
    metrics.feature_dependency_planner_requests_total = Number(metrics.feature_dependency_planner_requests_total || 0) + Number(updates.requests || 0);
    metrics.feature_dependency_planner_errors_total = Number(metrics.feature_dependency_planner_errors_total || 0) + Number(updates.errors || 0);
    metrics.feature_dependency_planner_ready_work_total = Number(metrics.feature_dependency_planner_ready_work_total || 0) + Number(updates.readyWork || 0);
    metrics.feature_dependency_planner_invalid_graph_total = Number(metrics.feature_dependency_planner_invalid_graph_total || 0) + Number(updates.invalidGraphs || 0);
    if (updates.durationMs != null) {
      metrics.feature_dependency_planner_duration_seconds_last = Number(updates.durationMs) / 1000;
    }
  });
}

async function recordOrchestrationSchedulerMetric(store, updates = {}) {
  await updateStoreMetrics(store, (metrics) => {
    metrics.feature_orchestration_scheduler_requests_total = Number(metrics.feature_orchestration_scheduler_requests_total || 0) + Number(updates.requests || 0);
    metrics.feature_orchestration_scheduler_errors_total = Number(metrics.feature_orchestration_scheduler_errors_total || 0) + Number(updates.errors || 0);
    metrics.feature_orchestration_scheduler_dispatch_total = Number(metrics.feature_orchestration_scheduler_dispatch_total || 0) + Number(updates.dispatches || 0);
    metrics.feature_orchestration_scheduler_fallback_total = Number(metrics.feature_orchestration_scheduler_fallback_total || 0) + Number(updates.fallbacks || 0);
    metrics.feature_orchestration_scheduler_duplicate_skip_total = Number(metrics.feature_orchestration_scheduler_duplicate_skip_total || 0) + Number(updates.duplicateSkips || 0);
    if (updates.durationMs != null) {
      metrics.feature_orchestration_scheduler_duration_seconds_last = Number(updates.durationMs) / 1000;
    }
  });
}

async function recordOrchestrationVisibilityMetric(store, updates = {}) {
  await updateStoreMetrics(store, (metrics) => {
    metrics.feature_orchestration_visibility_requests_total = Number(metrics.feature_orchestration_visibility_requests_total || 0) + Number(updates.requests || 0);
    metrics.feature_orchestration_visibility_errors_total = Number(metrics.feature_orchestration_visibility_errors_total || 0) + Number(updates.errors || 0);
    metrics.feature_orchestration_visibility_view_total = Number(metrics.feature_orchestration_visibility_view_total || 0) + Number(updates.views || 0);
    if (updates.durationMs != null) {
      metrics.feature_orchestration_visibility_duration_seconds_last = Number(updates.durationMs) / 1000;
    }
  });
}

function getAssignmentFeatureState(options = {}) {
  return {
    enabled: typeof assertTaskAssignmentEnabled === 'function'
      ? (() => {
          try {
            assertTaskAssignmentEnabled(options);
            return true;
          } catch {
            return false;
          }
        })()
      : true,
    killed: (() => {
      try {
        assertTaskAssignmentNotKilled(options);
        return false;
      } catch {
        return true;
      }
    })(),
  };
}

async function requireTenantAccess(req, options) {
  try {
    const context = await getRequestContext(req, options);
    if (!context?.tenantId || !context?.actorId) {
      throw createHttpError(401, 'missing_auth_context', 'Bearer token with tenant and actor claims is required');
    }
    if (options.authService) {
      await options.authService.requireCsrf(req, context);
    }
    return context;
  } catch (error) {
    if (!error.statusCode) {
      throw createHttpError(401, 'invalid_token', error.message);
    }
    throw error;
  }
}

function requirePermission(context, permission) {
  if (!authorize(context, permission)) {
    throw createHttpError(403, 'forbidden', `missing permission: ${permission}`, { permission });
  }
}

function hasAnyRole(context, roles = []) {
  return roles.some(role => context?.roles?.includes(role));
}

function formatActor(actorId, fallbackLabel = 'Unassigned') {
  if (!actorId) {
    return { id: null, label: fallbackLabel, kind: 'unassigned' };
  }

  return {
    id: actorId,
    label: actorId,
    kind: 'assigned',
  };
}

function inferTaskStatus(summary) {
  if (summary?.closed || summary?.current_stage === 'DONE') return 'done';
  if (summary?.blocked) return 'blocked';
  if (summary?.waiting_state) return 'waiting';
  return 'active';
}

function toSentenceCase(value) {
  return String(value || '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function formatDurationFromMs(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const minutes = Math.floor(value / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function lastDefinedPayloadValue(history = [], keys = []) {
  for (const event of history) {
    const payload = event?.payload || {};
    for (const key of keys) {
      if (payload[key] != null && payload[key] !== '') return payload[key];
    }
  }
  return null;
}

function normalizeMultilineList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatSpecSectionValue(value) {
  if (Array.isArray(value)) {
    return value.join('\n');
  }
  return String(value || '').trim();
}

function findLatestArchitectHandoff(history = []) {
  return history.find((event) => event?.event_type === 'task.architect_handoff_recorded') || null;
}

function architectHandoffFromEvent(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    version: Number(payload.version) || 1,
    readyForEngineering: Boolean(payload.ready_for_engineering),
    engineerTier: payload.engineer_tier || null,
    tierRationale: payload.tier_rationale || '',
    technicalSpec: {
      summary: payload.technical_spec?.summary || '',
      scope: payload.technical_spec?.scope || '',
      design: payload.technical_spec?.design || '',
      rolloutPlan: payload.technical_spec?.rolloutPlan || '',
    },
    monitoringSpec: {
      service: payload.monitoring_spec?.service || '',
      dashboardUrls: normalizeMultilineList(payload.monitoring_spec?.dashboardUrls),
      alertPolicies: normalizeMultilineList(payload.monitoring_spec?.alertPolicies),
      runbook: payload.monitoring_spec?.runbook || '',
      successMetrics: normalizeMultilineList(payload.monitoring_spec?.successMetrics),
    },
    submittedAt: event.occurred_at || null,
    submittedBy: event.actor_id || null,
  };
}

function formatArchitectHandoffTechnicalSpec(handoff) {
  if (!handoff) return null;
  return TECHNICAL_SPEC_FIELDS
    .map((field) => formatSpecSectionValue(handoff.technicalSpec?.[field]))
    .filter(Boolean)
    .join('\n\n');
}

function formatArchitectHandoffMonitoringSpec(handoff) {
  if (!handoff) return null;
  return MONITORING_SPEC_FIELDS
    .map((field) => formatSpecSectionValue(handoff.monitoringSpec?.[field]))
    .filter(Boolean)
    .join('\n\n');
}

function findLatestEngineerSubmission(history = []) {
  return history.find((event) => event?.event_type === 'task.engineer_submission_recorded') || null;
}

function normalizeCommitSha(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizePrUrl(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function engineerSubmissionFromEvent(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    version: Number(payload.version) || 1,
    commitSha: payload.commit_sha || '',
    prUrl: payload.pr_url || '',
    primaryReference: payload.primary_reference || null,
    preview: payload.preview || null,
    submittedAt: event.occurred_at || null,
    submittedBy: event.actor_id || null,
  };
}

function normalizeEngineerTier(value, fallback = null) {
  const normalized = String(value || '').trim();
  return ENGINEER_TIERS.includes(normalized) ? normalized : fallback;
}

function buildTierAssigneeId(tier) {
  switch (normalizeEngineerTier(tier, null)) {
    case 'Sr':
      return 'engineer-sr';
    case 'Principal':
      return 'engineer-principal';
    case 'Jr':
      return 'engineer-jr';
    default:
      return null;
  }
}

function getEffectiveEngineerTier(state, history = []) {
  return normalizeEngineerTier(state?.engineer_tier, null)
    || normalizeEngineerTier(architectHandoffFromEvent(findLatestArchitectHandoff(history))?.engineerTier, null)
    || 'Jr';
}

function getNextEngineerTier(tier) {
  switch (normalizeEngineerTier(tier, null)) {
    case 'Jr':
      return 'Sr';
    case 'Sr':
      return 'Principal';
    default:
      return null;
  }
}

function summarizeActivitySignal(event) {
  const payload = event?.payload || {};
  switch (event?.event_type) {
    case 'task.check_in_recorded':
      return {
        type: 'check_in',
        occurredAt: event.occurred_at || null,
        actorId: event.actor_id || null,
        assignee: payload.assignee || null,
        summary: payload.summary || '',
        evidence: normalizeMultilineList(payload.evidence || payload.references || []),
      };
    case 'task.engineer_submission_recorded':
      return {
        type: 'implementation_submission',
        occurredAt: event.occurred_at || null,
        actorId: event.actor_id || null,
        assignee: payload.assignee || null,
        summary: payload.primary_reference?.label || payload.commit_sha || payload.pr_url || 'Implementation submitted',
        evidence: [payload.commit_sha, payload.pr_url].filter(Boolean),
      };
    default:
      return null;
  }
}

function findLatestActivitySignal(history = [], assignee = null) {
  for (const event of history) {
    const summary = summarizeActivitySignal(event);
    if (!summary) continue;
    if (assignee) {
      const eventAssignee = String(summary.assignee || '').trim().toLowerCase();
      const targetAssignee = String(assignee || '').trim().toLowerCase();
      if (eventAssignee) {
        if (eventAssignee !== targetAssignee) continue;
      } else if (targetAssignee !== 'engineer' && targetAssignee !== 'engineer-jr' && targetAssignee !== 'engineer-sr' && targetAssignee !== 'engineer-principal') {
        continue;
      }
    }
    return summary;
  }
  return null;
}

function computeMissedCheckIns(lastSignalAt, referenceTime = new Date().toISOString()) {
  const lastTimestamp = Date.parse(lastSignalAt || '');
  const referenceTimestamp = Date.parse(referenceTime || '');
  if (!Number.isFinite(lastTimestamp) || !Number.isFinite(referenceTimestamp) || referenceTimestamp <= lastTimestamp) {
    return 0;
  }
  const elapsedMinutes = Math.floor((referenceTimestamp - lastTimestamp) / 60000);
  return Math.max(0, Math.floor(elapsedMinutes / ENGINEER_CHECK_IN_INTERVAL_MINUTES));
}

function findLatestSkillEscalation(history = []) {
  return history.find((event) => event?.event_type === 'task.skill_escalation_requested') || null;
}

function findLatestRetierEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.retiered') || null;
}

function findLatestReassignmentEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.reassigned') || null;
}

function findLatestGhostingReviewEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.ghosting_review_created') || null;
}

function toSkillEscalationSummary(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    requestedAt: event.occurred_at || null,
    requestedBy: event.actor_id || null,
    currentEngineerTier: payload.current_engineer_tier || null,
    requestedTier: payload.requested_tier || null,
    reason: payload.reason || payload.summary || '',
    beforeStart: payload.before_start !== false,
  };
}

function toRetierSummary(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    occurredAt: event.occurred_at || null,
    actorId: event.actor_id || null,
    previousEngineerTier: payload.previous_engineer_tier || null,
    engineerTier: payload.engineer_tier || null,
    tierRationale: payload.tier_rationale || '',
    reason: payload.reason || '',
  };
}

function toReassignmentSummary(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    occurredAt: event.occurred_at || null,
    actorId: event.actor_id || null,
    previousAssignee: payload.previous_assignee || null,
    assignee: payload.assignee || null,
    reason: payload.reason || '',
    mode: payload.mode || 'manual',
    previousEngineerTier: payload.previous_engineer_tier || null,
    engineerTier: payload.engineer_tier || null,
    missedCheckIns: Number(payload.missed_check_ins || 0),
    transferSummary: payload.transfer_summary || null,
  };
}

function toGhostingReviewSummary(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    createdAt: event.occurred_at || null,
    createdBy: event.actor_id || null,
    reviewTaskId: payload.review_task_id || null,
    title: payload.title || null,
    linkedParentTaskId: payload.parent_task_id || null,
    reason: payload.reason || '',
  };
}

async function appendWorkflowThreadNotification({
  store,
  taskId,
  tenantId,
  actorId,
  actorType = 'user',
  commentType = 'escalation',
  title,
  body,
  blocking = true,
  linkedEventId = null,
  notificationTargets = ['architect'],
  idempotencyKey,
  occurredAt,
}) {
  const threadId = `wf-${crypto.randomUUID().slice(0, 8)}`;
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.workflow_thread_created',
    actorId,
    actorType,
    idempotencyKey,
    occurredAt,
    payload: {
      thread_id: threadId,
      comment_type: commentType,
      title,
      body,
      blocking,
      linked_event_id: linkedEventId,
      notification_targets: notificationTargets,
      waiting_state: blocking ? 'awaiting_architect_decision' : null,
      next_required_action: blocking ? 'Architect review is required before delivery can continue.' : null,
    },
    source: 'http',
  });
  return { threadId, eventId: result.event.event_id };
}

function buildTransferredContextSummary({ taskId, summary, state, history = [], assignee, engineerTier, reason, mode, occurredAt }) {
  const latestActivity = findLatestActivitySignal(history, state?.assignee || null);
  const latestSubmission = engineerSubmissionFromEvent(findLatestEngineerSubmission(history));
  const workflowThreads = deriveWorkflowThreads(history);
  const unresolvedThreads = workflowThreads.items
    .filter((item) => item.state !== WORKFLOW_THREAD_STATES.RESOLVED)
    .slice(0, 3)
    .map((item) => item.title);
  const blockers = history
    .filter((event) => event.event_type === 'task.blocked')
    .slice(0, 3)
    .map((event) => event.payload?.summary || event.payload?.reason)
    .filter(Boolean);

  return {
    generated_at: occurredAt,
    task_id: taskId,
    title: summary.title,
    prior_assignee: state?.assignee || null,
    new_assignee: assignee || null,
    previous_engineer_tier: getEffectiveEngineerTier(state, history),
    new_engineer_tier: engineerTier || null,
    mode,
    reason,
    business_context: summary.business_context || null,
    latest_activity: latestActivity,
    latest_implementation_reference: latestSubmission?.primaryReference || latestSubmission?.commitSha || latestSubmission?.prUrl || null,
    unresolved_threads: unresolvedThreads,
    blockers,
  };
}

function inferCanonicalOwnerRole(ownerId) {
  const normalized = String(ownerId || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'engineer' || normalized.startsWith('engineer-')) return 'engineer';
  if (normalized === 'architect' || normalized.startsWith('architect-')) return 'architect';
  if (normalized === 'qa' || normalized.startsWith('qa-')) return 'qa';
  if (normalized === 'sre' || normalized.startsWith('sre-')) return 'sre';
  if (normalized === 'pm' || normalized.startsWith('pm-')) return 'pm';
  return null;
}

function assertCurrentActorMatchesTaskAssignee(context, state, allowedRoles = []) {
  if (hasAnyRole(context, ['admin'])) return;
  const assigneeRole = inferCanonicalOwnerRole(state?.assignee);
  if (!assigneeRole || !allowedRoles.includes(assigneeRole) || !context?.roles?.includes(assigneeRole)) {
    throw createHttpError(403, 'forbidden', 'Only the currently assigned owner may perform this action.', {
      assignee: state?.assignee || null,
      allowed_roles: allowedRoles,
    });
  }
}

function lastQaResultEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.qa_result_recorded') || null;
}

function hasMutationPermission(context) {
  return authorize(context, 'events:write') || authorize(context, 'assignment:write');
}

function requireMutationPermission(context) {
  if (!hasMutationPermission(context)) {
    throw createHttpError(403, 'forbidden', 'missing permission: events:write or assignment:write');
  }
}

function canManageOrchestration(context) {
  return context.roles.includes('pm') || context.roles.includes('admin');
}

function requireOrchestrationPermission(context) {
  if (!canManageOrchestration(context)) {
    throw createHttpError(403, 'forbidden', 'Only PM/admin may manage orchestration.');
  }
}

function buildLockError(lock) {
  return createHttpError(409, 'task_locked', `This task is currently locked by ${lock.ownerId}. Refresh to see the latest state or retry after the lock expires.`, {
    lock: {
      owner_id: lock.ownerId,
      acquired_at: lock.acquiredAt,
      expires_at: lock.expiresAt,
      reason: lock.reason || null,
      action: lock.action || null,
    },
  });
}

function isArchitectReadOnlyCheckIn(input = {}) {
  if (input.resource !== 'events') return false;
  if (input.eventType !== 'task.comment_workflow_recorded') return false;
  return String(input.payload?.comment_type || '').trim().toLowerCase() === 'architect_check_in';
}

async function assertTaskUnlockedForMutation({ store, taskId, tenantId, actorId, resource, eventType, payload, options, requestBody }) {
  if (isArchitectReadOnlyCheckIn({ resource, eventType, payload: requestBody?.payload || payload })) {
    return null;
  }

  const state = await (typeof store.getTaskCurrentStateForMutation === 'function'
    ? store.getTaskCurrentStateForMutation(taskId, { tenantId })
    : store.getTaskCurrentState(taskId, { tenantId }));
  if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
  const activeLock = getActiveTaskLock(state);
  if (!activeLock) return null;
  if (activeLock.ownerId === actorId) return activeLock;

  if (options) {
    try {
      await store.appendEvent({
        taskId,
        tenantId,
        eventType: 'task.lock_conflict',
        actorId,
        actorType: 'user',
        idempotencyKey: `${resource || 'mutation'}-lock-conflict:${taskId}:${actorId}:${state.last_event_id || 'initial'}`,
        payload: {
          requested_by: actorId,
          resource: resource || 'mutation',
          blocking_owner_id: activeLock.ownerId,
          lock_expires_at: activeLock.expiresAt,
        },
        source: 'http',
      });
    } catch {}
  }
  throw buildLockError(activeLock);
}

async function loadTaskStateForMutation(store, taskId, tenantId) {
  return typeof store.getTaskCurrentStateForMutation === 'function'
    ? store.getTaskCurrentStateForMutation(taskId, { tenantId })
    : store.getTaskCurrentState(taskId, { tenantId });
}

function validateWorkflowThreadBody(body = {}) {
  const title = String(body.title || '').trim();
  const threadBody = String(body.body || '').trim();
  const commentType = normalizeCommentType(body.commentType);
  if (!title) {
    throw createHttpError(400, 'missing_thread_title', 'Workflow thread title is required.');
  }
  if (!threadBody) {
    throw createHttpError(400, 'missing_thread_body', 'Workflow thread body is required.');
  }
  return {
    title,
    body: threadBody,
    comment_type: commentType,
    blocking: body.blocking === true,
    linked_event_id: String(body.linkedEventId || '').trim() || null,
    notification_targets: normalizeThreadArray(body.notificationTargets).length
      ? normalizeThreadArray(body.notificationTargets)
      : defaultNotificationTargets(commentType, body.blocking === true),
  };
}

function validateWorkflowThreadReplyBody(body = {}, action) {
  const text = String(body.body || body.resolution || '').trim();
  if (!text) {
    throw createHttpError(400, 'missing_thread_message', `${action} text is required.`);
  }
  return text;
}

function buildQaEscalationPackage({ taskId, summary, architectHandoff, implementationHistory, latestFailedQa, body, context }) {
  const findings = normalizeQaArray(body.findings);
  const reproductionSteps = normalizeQaArray(body.reproductionSteps);
  const stackTraces = normalizeQaArray(body.stackTraces);
  const envLogs = normalizeQaArray(body.envLogs);
  const scenarios = normalizeQaArray(body.scenarios);
  const recipientAgentId = summary.current_owner || null;
  const recipientRole = 'engineer';
  const requiredEngineerTier = architectHandoff?.engineerTier || null;
  const escalationChain = latestFailedQa ? ['qa', 'engineer', 'pm'] : ['qa', 'engineer'];

  return {
    task_id: taskId,
    summary: String(body.summary || '').trim(),
    failing_scenarios: scenarios,
    findings,
    reproduction_steps: reproductionSteps,
    stack_traces: stackTraces,
    env_logs: envLogs,
    pm_requirements: {
      business_context: summary.business_context || null,
      acceptance_criteria: Array.isArray(summary.acceptance_criteria) ? summary.acceptance_criteria : [],
      definition_of_done: Array.isArray(summary.definition_of_done) ? summary.definition_of_done : [],
    },
    architect_context: architectHandoff
      ? {
          engineer_tier: architectHandoff.engineerTier,
          tier_rationale: architectHandoff.tierRationale,
          technical_spec: architectHandoff.technicalSpec,
          monitoring_spec: architectHandoff.monitoringSpec,
        }
      : null,
    previous_fix_history: implementationHistory.map((entry) => ({
      version: entry.version,
      primary_reference: entry.primaryReference,
      commit_sha: entry.commitSha || null,
      pr_url: entry.prUrl || null,
      submitted_at: entry.submittedAt,
      submitted_by: entry.submittedBy,
    })),
    routing: {
      recipient_role: recipientRole,
      recipient_agent_id: recipientAgentId,
      required_engineer_tier: requiredEngineerTier,
      escalation_chain: escalationChain,
    },
    notification_preview: {
      headline: `QA ${body.outcome === 'fail' ? 'failure' : 'update'} for ${taskId}`,
      recipient_role: recipientRole,
      recipient_agent_id: recipientAgentId,
      required_engineer_tier: requiredEngineerTier,
      highlights: [
        String(body.summary || '').trim(),
        reproductionSteps[0] || null,
        scenarios[0] || null,
      ].filter(Boolean),
      collapsed_sections: {
        stack_trace_count: stackTraces.length,
        env_log_count: envLogs.length,
      },
      escalation_chain: escalationChain,
    },
    attachment_strategy: {
      stack_traces: stackTraces.length > 5 ? 'collapsed_after_summary' : 'inline_summary',
      env_logs: envLogs.length > 5 ? 'collapsed_after_summary' : 'inline_summary',
    },
    generated_by: context.actorId,
  };
}

async function releaseActiveLockAfterTransition({
  store,
  taskId,
  tenantId,
  actorId,
  actorType = 'user',
  source = 'http',
  idempotencyKey,
}) {
  const state = await loadTaskStateForMutation(store, taskId, tenantId);
  const activeLock = getActiveTaskLock(state);
  if (!activeLock || activeLock.ownerId !== actorId) return null;
  return store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.lock_released',
    actorId,
    actorType,
    idempotencyKey,
    payload: {
      owner_id: activeLock.ownerId,
      released_by: actorId,
      release_reason: 'transition_completed',
    },
    source,
  });
}

function validateQaResultBody(body = {}) {
  const outcome = String(body.outcome || '').trim().toLowerCase();
  if (!['pass', 'fail'].includes(outcome)) {
    throw createHttpError(400, 'invalid_qa_outcome', 'QA outcome must be pass or fail.');
  }
  const summary = String(body.summary || '').trim();
  if (!summary) {
    throw createHttpError(400, 'missing_qa_summary', 'QA summary is required.');
  }

  const normalized = {
    outcome,
    summary,
    scenarios: normalizeQaArray(body.scenarios),
    findings: normalizeQaArray(body.findings),
    reproduction_steps: normalizeQaArray(body.reproductionSteps),
    stack_traces: normalizeQaArray(body.stackTraces),
    env_logs: normalizeQaArray(body.envLogs),
    retest_scope: normalizeQaArray(body.retestScope),
  };

  if (outcome === 'fail') {
    const missingFields = [];
    if (!normalized.scenarios.length) missingFields.push('scenarios');
    if (!normalized.findings.length) missingFields.push('findings');
    if (!normalized.reproduction_steps.length) missingFields.push('reproductionSteps');
    if (!normalized.stack_traces.length) missingFields.push('stackTraces');
    if (!normalized.env_logs.length) missingFields.push('envLogs');
    if (missingFields.length) {
      throw createHttpError(400, 'missing_qa_failure_context', 'Failing QA submissions require scenarios, findings, reproduction steps, stack traces, and environment logs.', {
        missing_fields: missingFields,
      });
    }
  }

  return normalized;
}

function validateEngineerSubmissionBody(body = {}) {
  const commitSha = normalizeCommitSha(body.commitSha);
  const prUrl = normalizePrUrl(body.prUrl);
  const missingFields = [];
  const invalidFields = [];

  if (!commitSha && !prUrl) {
    missingFields.push('commitShaOrPrUrl');
  }
  if (commitSha && !COMMIT_SHA_PATTERN.test(commitSha)) {
    invalidFields.push('commitSha');
  }
  if (prUrl && !GITHUB_PR_URL_PATTERN.test(prUrl)) {
    invalidFields.push('prUrl');
  }

  if (missingFields.length) {
    throw createHttpError(400, 'missing_required_engineer_metadata', 'Engineer submission requires a commit SHA or GitHub PR URL before QA handoff.', { missing_fields: missingFields });
  }
  if (invalidFields.length) {
    throw createHttpError(400, 'invalid_engineer_metadata', 'Engineer submission metadata must use an accepted commit SHA or GitHub PR URL format.', { invalid_fields: invalidFields });
  }

  const primaryReference = prUrl
    ? { type: 'pr_url', label: prUrl, value: prUrl }
    : { type: 'commit_sha', label: commitSha, value: commitSha };

  return {
    commit_sha: commitSha,
    pr_url: prUrl,
    primary_reference: primaryReference,
    preview: {
      commitSha: commitSha || null,
      prUrl: prUrl || null,
      acceptedFormats: {
        commitSha: '7-40 hexadecimal characters',
        prUrl: 'https://github.com/<owner>/<repo>/pull/<number>',
      },
    },
  };
}

function validateArchitectHandoffBody(body = {}) {
  const technicalSpec = body.technicalSpec || {};
  const monitoringSpec = body.monitoringSpec || {};
  const engineerTier = String(body.engineerTier || '').trim();
  const tierRationale = String(body.tierRationale || '').trim();
  const readyForEngineering = body.readyForEngineering === true;

  const missingFields = [];
  for (const field of TECHNICAL_SPEC_FIELDS) {
    if (!String(technicalSpec[field] || '').trim()) missingFields.push(`technicalSpec.${field}`);
  }
  for (const field of MONITORING_SPEC_FIELDS) {
    const value = field === 'service' || field === 'runbook'
      ? String(monitoringSpec[field] || '').trim()
      : normalizeMultilineList(monitoringSpec[field]);
    if (!value || (Array.isArray(value) && !value.length)) missingFields.push(`monitoringSpec.${field}`);
  }
  if (!ENGINEER_TIERS.includes(engineerTier)) missingFields.push('engineerTier');
  if (!tierRationale) missingFields.push('tierRationale');
  if (!readyForEngineering) missingFields.push('readyForEngineering');

  if (missingFields.length) {
    throw createHttpError(400, 'missing_required_architect_fields', 'Architect handoff requires all technical, monitoring, and tier fields before engineering can start.', { missing_fields: missingFields });
  }

  return {
    ready_for_engineering: true,
    engineer_tier: engineerTier,
    tier_rationale: tierRationale,
    technical_spec: {
      summary: String(technicalSpec.summary).trim(),
      scope: String(technicalSpec.scope).trim(),
      design: String(technicalSpec.design).trim(),
      rolloutPlan: String(technicalSpec.rolloutPlan).trim(),
    },
    monitoring_spec: {
      service: String(monitoringSpec.service).trim(),
      dashboardUrls: normalizeMultilineList(monitoringSpec.dashboardUrls),
      alertPolicies: normalizeMultilineList(monitoringSpec.alertPolicies),
      runbook: String(monitoringSpec.runbook).trim(),
      successMetrics: normalizeMultilineList(monitoringSpec.successMetrics),
    },
  };
}

function canManageSreMonitoring(context) {
  return hasAnyRole(context, ['sre', 'admin']);
}

function canRecordCloseReviewRecommendation(context) {
  return hasAnyRole(context, ['pm', 'architect', 'admin']);
}

function canRecordHumanCloseDecision(context) {
  return hasAnyRole(context, ['stakeholder', 'admin']);
}

function canRequestCloseReviewBacktrack(context) {
  return hasAnyRole(context, ['pm', 'architect', 'admin']);
}

function canCompletePmBusinessContext(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canManageExecutionContracts(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canApproveExecutionContracts(context) {
  return hasAnyRole(context, ['stakeholder', 'pm', 'admin']);
}

function assertNoRestrictedAnomalyWorkflowEventWrite(context, eventType) {
  if (eventType === 'task.pm_business_context_completed' && !canCompletePmBusinessContext(context)) {
    throw createHttpError(403, 'forbidden', 'Only PM/admin may complete machine-generated business context.');
  }
  if (eventType === 'task.unblocked') {
    throw createHttpError(403, 'forbidden', 'Active anomaly-child blocks may only be cleared by the linked child resolution flow.');
  }
}

function assertNoRestrictedExecutionContractEventWrite(eventType) {
  if (eventType === 'task.execution_contract_approved') {
    throw createHttpError(403, 'forbidden', 'Execution Contract approval must use the dedicated approval endpoint so reviewer gates and blocking-question checks run.');
  }
  if (eventType === 'task.execution_contract_artifact_bundle_approved') {
    throw createHttpError(403, 'forbidden', 'Execution Contract artifact-bundle approval must use the dedicated approval endpoint so PM, section-owner, and operator gates run.');
  }
  if (eventType === 'task.execution_contract_artifact_bundle_generated') {
    throw createHttpError(403, 'forbidden', 'Execution Contract artifact bundles must use the dedicated generation endpoint so display-ID naming and review-bundle rules run.');
  }
  if (eventType === 'task.execution_contract_verification_report_generated') {
    throw createHttpError(403, 'forbidden', 'Execution Contract verification report skeletons must use the dedicated generation endpoint so approved-contract evidence and dispatch gates run.');
  }
}

function validateSreMonitoringStartBody(body = {}) {
  const deploymentEnvironment = String(body.deploymentEnvironment || '').trim();
  const deploymentUrl = String(body.deploymentUrl || '').trim();
  const deploymentVersion = String(body.deploymentVersion || '').trim();
  const deploymentStatus = String(body.deploymentStatus || 'success').trim().toLowerCase();
  const evidence = normalizeMultilineList(body.evidence);

  const missingFields = [];
  if (!deploymentEnvironment) missingFields.push('deploymentEnvironment');
  if (!deploymentUrl) missingFields.push('deploymentUrl');
  if (!deploymentVersion) missingFields.push('deploymentVersion');
  if (missingFields.length) {
    throw createHttpError(400, 'missing_required_sre_monitoring_fields', 'Starting SRE monitoring requires deployment environment, deployment URL, and deployment version.', { missing_fields: missingFields });
  }
  if (!['success', 'healthy', 'stable'].includes(deploymentStatus)) {
    throw createHttpError(400, 'invalid_deployment_status', 'Deployment status must confirm a successful or stable deploy.');
  }

  return {
    deployment_environment: deploymentEnvironment,
    deployment_url: deploymentUrl,
    deployment_version: deploymentVersion,
    deployment_status: deploymentStatus,
    evidence,
  };
}

function validateSreApprovalBody(body = {}) {
  const reason = String(body.reason || '').trim();
  const evidence = normalizeMultilineList(body.evidence);
  if (!reason) {
    throw createHttpError(400, 'missing_sre_approval_reason', 'SRE approval requires an explicit reason.');
  }
  return { reason, evidence };
}

function inferCloseDecisionActorRole(context, allowedRoles = []) {
  for (const role of allowedRoles) {
    if (hasAnyRole(context, [role])) return role;
  }
  return hasAnyRole(context, ['admin']) && allowedRoles.length ? allowedRoles[0] : null;
}

function toCloseGovernanceDecisionEvents(history = []) {
  return history
    .filter((event) => event?.event_type === 'task.decision_recorded' || event?.event_type === 'task.decision_revised')
    .map((event) => ({
      id: event.event_id,
      occurredAt: event.occurred_at || null,
      actorId: event.actor_id || null,
      decisionType: String(event.payload?.decision_type || '').trim().toLowerCase(),
      actorRole: String(event.payload?.actor_role || event.payload?.role || '').trim().toLowerCase(),
      outcome: String(event.payload?.outcome || '').trim().toLowerCase(),
      summary: String(event.payload?.summary || event.payload?.recommendation_summary || event.payload?.decision_summary || '').trim() || null,
      rationale: String(event.payload?.rationale || event.payload?.reason || '').trim() || null,
      artifact: event.payload?.artifact || null,
      confirmationRequired: event.payload?.confirmation_required === true,
    }));
}

function deriveCloseGovernanceDecisionContext(summary, history = []) {
  const decisionEvents = toCloseGovernanceDecisionEvents(history);
  const findLatestDecision = (predicate) => decisionEvents.find(predicate) || null;
  const pmCancellationRecommendation = findLatestDecision((event) => event.decisionType === 'cancellation_recommendation' && event.actorRole === 'pm');
  const architectCancellationRecommendation = findLatestDecision((event) => event.decisionType === 'cancellation_recommendation' && event.actorRole === 'architect');
  const humanDecision = findLatestDecision((event) => event.decisionType === 'human_close_decision');
  const backtrackDecision = findLatestDecision((event) => event.decisionType === 'close_backtrack');
  const latestEscalation = history.find((event) => event?.event_type === 'task.escalated'
    && (event?.payload?.reason === 'sre_monitoring_window_expired' || event?.payload?.reason === 'exceptional_dispute')) || null;
  const requestMoreContextEvents = decisionEvents.filter((event) => event.decisionType === 'human_close_decision' && event.outcome === 'request_more_context');
  const backtrackRecommendations = decisionEvents.filter((event) => event.decisionType === 'close_backtrack'
    && (event.actorRole === 'pm' || event.actorRole === 'architect'));
  const dualCancellationRecommendations = Boolean(pmCancellationRecommendation && architectCancellationRecommendation);
  const humanDecisionReady = dualCancellationRecommendations || Boolean(latestEscalation);

  return {
    decisionEvents,
    pmCancellationRecommendation,
    architectCancellationRecommendation,
    humanDecision,
    backtrackDecision,
    latestEscalation,
    requestMoreContextEvents,
    backtrackRecommendations,
    dualCancellationRecommendations,
    humanDecisionReady,
    latestDecision: humanDecision || architectCancellationRecommendation || pmCancellationRecommendation || backtrackDecision || null,
    escalationAwaitingHumanDecision: summary?.waiting_state === 'awaiting_human_stakeholder_escalation',
  };
}

function validateCloseCancellationRecommendationBody(body = {}) {
  const summary = String(body.summary || '').trim();
  const rationale = String(body.rationale || body.reason || '').trim();
  const artifact = body.artifact && typeof body.artifact === 'object' && !Array.isArray(body.artifact)
    ? body.artifact
    : null;
  if (!summary) {
    throw createHttpError(400, 'missing_close_recommendation_summary', 'Cancellation recommendation requires a concise summary.');
  }
  if (!rationale) {
    throw createHttpError(400, 'missing_close_recommendation_rationale', 'Cancellation recommendation requires an explicit rationale.');
  }
  return { summary, rationale, artifact };
}

function validateExceptionalDisputeBody(body = {}) {
  const summary = String(body.summary || '').trim();
  const rationale = String(body.rationale || body.reason || '').trim();
  const recommendation = String(body.recommendation || body.recommendationSummary || '').trim();
  const severity = String(body.severity || '').trim().toLowerCase() || 'high';
  const artifact = body.artifact && typeof body.artifact === 'object' && !Array.isArray(body.artifact)
    ? body.artifact
    : null;
  if (!summary) {
    throw createHttpError(400, 'missing_exceptional_dispute_summary', 'Exceptional dispute escalation requires a concise summary.');
  }
  if (!rationale) {
    throw createHttpError(400, 'missing_exceptional_dispute_rationale', 'Exceptional dispute escalation requires an explicit rationale.');
  }
  if (!recommendation) {
    throw createHttpError(400, 'missing_exceptional_dispute_recommendation', 'Exceptional dispute escalation requires a recommendation summary.');
  }
  if (!['warning', 'high', 'critical'].includes(severity)) {
    throw createHttpError(400, 'invalid_exceptional_dispute_severity', 'Exceptional dispute escalation severity must be warning, high, or critical.');
  }
  return { summary, rationale, recommendation, severity, artifact };
}

function validateHumanCloseDecisionBody(body = {}) {
  const outcome = String(body.outcome || '').trim().toLowerCase();
  const summary = String(body.summary || '').trim();
  const rationale = String(body.rationale || body.reason || '').trim();
  const confirmationRequired = body.confirmationRequired === true;
  if (!['approve', 'reject', 'request_more_context'].includes(outcome)) {
    throw createHttpError(400, 'invalid_human_close_outcome', 'Human close decisions must be approve, reject, or request_more_context.');
  }
  if (!summary) {
    throw createHttpError(400, 'missing_human_close_summary', 'Human close decisions require a summary.');
  }
  if (outcome === 'request_more_context' && !rationale) {
    throw createHttpError(400, 'missing_human_close_rationale', 'Requesting more context requires a rationale.');
  }
  return { outcome, summary, rationale, confirmationRequired };
}

function validateCloseBacktrackBody(body = {}) {
  const reasonCode = String(body.reasonCode || body.reason_code || '').trim().toLowerCase();
  const rationale = String(body.rationale || body.reason || '').trim();
  const agreementArtifact = String(body.agreementArtifact || body.agreement_artifact || '').trim();
  const summary = String(body.summary || '').trim();
  const allowedReasonCodes = ['open_child_tasks', 'open_pull_requests', 'monitoring_degraded', 'criteria_gap', 'cancellation_rejected', 'other'];
  if (!allowedReasonCodes.includes(reasonCode)) {
    throw createHttpError(400, 'invalid_close_backtrack_reason', 'Close backtrack reason must use the documented taxonomy.', { allowed_reason_codes: allowedReasonCodes });
  }
  if (!rationale) {
    throw createHttpError(400, 'missing_close_backtrack_rationale', 'Close backtrack requires a rationale.');
  }
  if (!agreementArtifact) {
    throw createHttpError(400, 'missing_close_backtrack_agreement_artifact', 'Close backtrack requires an agreement artifact.');
  }
  return { reasonCode, rationale, agreementArtifact, summary };
}

function buildMonitoringAnomalyPrefill({ parentTaskId, telemetry = null, monitoring = null } = {}) {
  const service = String(monitoring?.architectMonitoringSpec?.service || '').trim();
  const keySignals = Object.entries(telemetry?.key_signals || {})
    .map(([key, value]) => `${key}: ${String(value)}`)
    .filter(Boolean);
  const drilldowns = monitoring?.telemetry?.drilldowns || {};
  const deployment = monitoring?.deployment || null;
  const signalSummary = keySignals.slice(0, 3).join('; ');
  const anomalySummary = signalSummary
    ? `${service || 'Service'} anomaly detected during ${deployment?.environment || 'production'} monitoring: ${signalSummary}.`
    : deployment?.version
      ? `${service || 'Service'} anomaly detected after deployment ${deployment.version}.`
      : (service ? `${service} anomaly requires tracked investigation.` : '');
  return {
    service,
    anomalySummary,
    metrics: keySignals.slice(0, 5),
    logs: [
      drilldowns.logs ? `Log drilldown: ${drilldowns.logs}` : null,
      deployment?.url ? `Deployment evidence: ${deployment.url}` : null,
    ].filter(Boolean),
    errorSamples: [
      drilldowns.traces ? `Trace drilldown: ${drilldowns.traces}` : null,
      drilldowns.metrics ? `Metrics drilldown: ${drilldowns.metrics}` : null,
    ].filter(Boolean),
  };
}

function validateMonitoringAnomalyChildTaskBody(body = {}, { parentTaskId, parentTitle, telemetry, monitoring } = {}) {
  const prefill = buildMonitoringAnomalyPrefill({ parentTaskId, telemetry, monitoring });
  const service = String(body.service || prefill.service || '').trim();
  const anomalySummary = String(body.anomalySummary || prefill.anomalySummary || '').trim();
  const title = String(body.title || `Investigate ${service || 'production'} anomaly for ${parentTaskId}`).trim();
  const metrics = normalizeMultilineList(body.metrics).length
    ? normalizeMultilineList(body.metrics)
    : prefill.metrics;
  const logs = normalizeMultilineList(body.logs).length
    ? normalizeMultilineList(body.logs)
    : prefill.logs;
  const errorSamples = normalizeMultilineList(body.errorSamples).length
    ? normalizeMultilineList(body.errorSamples)
    : prefill.errorSamples;

  const missingFields = [];
  if (!service) missingFields.push('service');
  if (!anomalySummary) missingFields.push('anomalySummary');
  if (!metrics.length) missingFields.push('metrics');
  if (!logs.length) missingFields.push('logs');
  if (!errorSamples.length) missingFields.push('errorSamples');
  if (missingFields.length) {
    throw createHttpError(400, 'missing_required_monitoring_anomaly_fields', 'Monitoring anomaly child-task creation requires service, anomaly summary, metrics, logs, and error samples.', {
      missing_fields: missingFields,
    });
  }

  const parentLabel = parentTitle ? `${parentTaskId} ${parentTitle}` : parentTaskId;
  const deploymentLabel = monitoring?.deployment?.environment
    ? `${monitoring.deployment.environment}${monitoring.deployment.version ? ` ${monitoring.deployment.version}` : ''}`
    : 'deployment context unavailable';
  const telemetryLinks = monitoring?.telemetry?.drilldowns || {};
  const references = [
    telemetryLinks.metrics ? `Metrics: ${telemetryLinks.metrics}` : null,
    telemetryLinks.logs ? `Logs: ${telemetryLinks.logs}` : null,
    telemetryLinks.traces ? `Traces: ${telemetryLinks.traces}` : null,
  ].filter(Boolean);

  return {
    title,
    service,
    anomaly_summary: anomalySummary,
    metrics,
    logs,
    error_samples: errorSamples,
    business_context: [
      '[Machine-generated anomaly context. PM should refine business impact before architect work starts.]',
      `Parent task: ${parentLabel}`,
      `Affected service: ${service}`,
      `Anomaly summary: ${anomalySummary}`,
      `Deployment context: ${deploymentLabel}`,
      references.length ? `Telemetry references: ${references.join(' | ')}` : 'Telemetry references: unavailable',
      'Metrics:',
      ...metrics.map((entry) => `- ${entry}`),
      'Logs:',
      ...logs.map((entry) => `- ${entry}`),
      'Error samples:',
      ...errorSamples.map((entry) => `- ${entry}`),
    ].join('\n'),
    acceptance_criteria: [
      `Telemetry evidence for ${service} is reviewed and root-cause hypotheses are documented.`,
      `PM confirms business context and customer impact for parent task ${parentTaskId} before Architect details begin.`,
      `Parent-child lineage remains visible across both task records.`,
    ],
    definition_of_done: [
      'PM business context is updated for the anomaly child task.',
      'An architect-ready investigation package exists or mitigation work is routed explicitly.',
      `Parent task ${parentTaskId} is unblocked or its blocking reason is refreshed with the latest anomaly status.`,
    ],
    task_type: 'Bug',
    assignee: 'pm',
    prefill,
  };
}

function validatePmBusinessContextCompletionBody(body = {}) {
  const businessContext = String(body.businessContext || body.business_context || '').trim();
  if (!businessContext) {
    throw createHttpError(400, 'missing_business_context', 'Finalized PM business context is required.');
  }
  return { business_context: businessContext };
}

function findLatestSreMonitoringStart(history = []) {
  return history.find((event) => event?.event_type === 'task.sre_monitoring_started') || null;
}

function findLatestSreApproval(history = []) {
  return history.find((event) => event?.event_type === 'task.sre_approval_recorded') || null;
}

function findLatestSreExpiryEscalation(history = []) {
  return history.find((event) => event?.event_type === 'task.escalated' && event?.payload?.reason === 'sre_monitoring_window_expired') || null;
}

function findLatestPmBusinessContextCompletion(history = []) {
  return history.find((event) => event?.event_type === 'task.pm_business_context_completed') || null;
}

function findLatestAnomalyContextEvent(history = []) {
  return history.find((event) => event?.payload?.anomaly_context) || null;
}

function findActiveTaskBlock(history = []) {
  const latestUnblockedIndex = history.findIndex((event) => event?.event_type === 'task.unblocked');
  const candidateHistory = latestUnblockedIndex === -1 ? history : history.slice(0, latestUnblockedIndex);
  return candidateHistory.find((event) => event?.event_type === 'task.blocked') || null;
}

function findActiveAnomalyChildBlock(history = []) {
  const latestUnblockedIndex = history.findIndex((event) => event?.event_type === 'task.unblocked');
  const candidateHistory = latestUnblockedIndex === -1 ? history : history.slice(0, latestUnblockedIndex);
  return candidateHistory.find((event) => event?.event_type === 'task.blocked' && event?.payload?.child_task_id) || null;
}

function formatDurationFromNow(targetIso) {
  if (!targetIso) return 'Not started';
  const diffMs = Date.parse(targetIso) - Date.now();
  const absMs = Math.abs(diffMs);
  const hours = Math.floor(absMs / (60 * 60 * 1000));
  const minutes = Math.floor((absMs % (60 * 60 * 1000)) / (60 * 1000));
  const label = `${hours}h ${minutes}m`;
  return diffMs < 0 ? `${label} overdue` : label;
}

function buildTelemetryDrilldowns(telemetry = {}, architectHandoff = null) {
  const links = Array.isArray(telemetry?.links) ? telemetry.links : [];
  const dashboardUrls = Array.isArray(architectHandoff?.monitoringSpec?.dashboardUrls)
    ? architectHandoff.monitoringSpec.dashboardUrls
    : [];
  const alertPolicies = Array.isArray(architectHandoff?.monitoringSpec?.alertPolicies)
    ? architectHandoff.monitoringSpec.alertPolicies
    : [];
  const metricsLink = links.find((entry) => /metric/i.test(entry?.label || entry?.type || ''))?.url || dashboardUrls[0] || null;
  const logsLink = links.find((entry) => /log/i.test(entry?.label || entry?.type || ''))?.url || null;
  const tracesLink = links.find((entry) => /trace/i.test(entry?.label || entry?.type || ''))?.url || null;
  return {
    metrics: metricsLink,
    logs: logsLink,
    traces: tracesLink,
    dashboards: dashboardUrls,
    alertPolicies,
    runbook: architectHandoff?.monitoringSpec?.runbook || null,
  };
}

function buildSreEvidenceSnapshot({ telemetry = {}, linkedPrs = [], engineerSubmission = null, startPayload = null }) {
  return {
    deployment: startPayload ? {
      environment: startPayload.deployment_environment || null,
      url: startPayload.deployment_url || null,
      version: startPayload.deployment_version || null,
      status: startPayload.deployment_status || null,
    } : null,
    telemetry: {
      freshness: telemetry?.freshness?.status || 'unknown',
      degraded: Boolean(telemetry?.degraded),
      eventCount: Number(telemetry?.event_count || 0),
      keySignals: telemetry?.key_signals || {},
    },
    engineerSubmission: engineerSubmission ? {
      version: engineerSubmission.version || null,
      commitSha: engineerSubmission.commitSha || null,
      prUrl: engineerSubmission.prUrl || null,
      primaryReference: engineerSubmission.primaryReference || null,
    } : null,
    linkedPullRequests: linkedPrs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      repository: pr.repository,
      merged: pr.merged,
      updatedAt: pr.updatedAt,
      url: pr.url,
    })),
  };
}

function deriveSreMonitoringProjection({
  taskId,
  summary,
  history = [],
  relationships = {},
  telemetry = null,
}) {
  const architectHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
  const engineerSubmission = engineerSubmissionFromEvent(findLatestEngineerSubmission(history));
  const linkedPrs = collectLinkedPrs(history, relationships, taskId);
  const startEvent = findLatestSreMonitoringStart(history);
  const approvalEvent = findLatestSreApproval(history);
  const expiryEvent = findLatestSreExpiryEscalation(history);
  const startPayload = startEvent?.payload || null;
  const windowStartedAt = startEvent?.occurred_at || null;
  const windowEndsAt = startPayload?.window_ends_at || (windowStartedAt ? new Date(Date.parse(windowStartedAt) + SRE_MONITORING_WINDOW_MS).toISOString() : null);
  const mergedPrs = linkedPrs.filter((pr) => pr.merged);
  const timeRemainingMs = windowEndsAt ? Date.parse(windowEndsAt) - Date.now() : null;
  const expired = Number.isFinite(timeRemainingMs) ? timeRemainingMs <= 0 : false;
  const drilldowns = buildTelemetryDrilldowns(telemetry, architectHandoff);
  const telemetryFresh = telemetry?.freshness?.status === 'fresh' && !telemetry?.degraded;
  const canStart = summary?.current_stage === STAGES.SRE_MONITORING && !startEvent && mergedPrs.length > 0;
  const canApprove = summary?.current_stage === STAGES.SRE_MONITORING && Boolean(startEvent) && !approvalEvent && !expiryEvent && telemetryFresh && !summary?.blocked;
  const riskLevel = expiryEvent || expired || telemetry?.degraded
    ? 'high'
    : timeRemainingMs != null && timeRemainingMs <= 12 * 60 * 60 * 1000
      ? 'medium'
      : 'low';

  return {
    active: summary?.current_stage === STAGES.SRE_MONITORING || Boolean(startEvent) || Boolean(approvalEvent) || Boolean(expiryEvent),
    state: approvalEvent ? 'approved' : expiryEvent ? 'escalated' : startEvent ? (expired ? 'expired' : 'active') : 'pending_start',
    canStart,
    canApprove,
    windowHours: SRE_MONITORING_WINDOW_HOURS,
    windowStartedAt,
    windowEndsAt,
    timeRemainingMs: timeRemainingMs != null ? Math.max(0, timeRemainingMs) : null,
    timeRemainingLabel: formatDurationFromNow(windowEndsAt),
    expired,
    riskLevel,
    approval: approvalEvent ? {
      approvedAt: approvalEvent.occurred_at,
      approvedBy: approvalEvent.actor_id || null,
      reason: approvalEvent.payload?.reason || null,
      evidence: approvalEvent.payload?.evidence || [],
      snapshot: approvalEvent.payload?.evidence_snapshot || null,
    } : null,
    escalation: expiryEvent ? {
      escalatedAt: expiryEvent.occurred_at,
      severity: expiryEvent.payload?.severity || 'warning',
      reason: expiryEvent.payload?.reason || null,
    } : null,
    deployment: startPayload ? {
      environment: startPayload.deployment_environment || null,
      url: startPayload.deployment_url || null,
      version: startPayload.deployment_version || null,
      status: startPayload.deployment_status || null,
      evidence: startPayload.evidence || [],
      startedBy: startEvent.actor_id || null,
    } : null,
    linkedPrs,
    commitSha: engineerSubmission?.commitSha || null,
    prUrl: engineerSubmission?.prUrl || null,
    engineerSubmission,
    telemetry: telemetry ? {
      freshness: telemetry.freshness?.status || 'unknown',
      degraded: Boolean(telemetry.degraded),
      eventCount: Number(telemetry.event_count || 0),
      keySignals: telemetry.key_signals || {},
      drilldowns,
    } : {
      freshness: 'unknown',
      degraded: false,
      eventCount: 0,
      keySignals: {},
      drilldowns,
    },
    architectMonitoringSpec: architectHandoff?.monitoringSpec || null,
  };
}

function deriveCloseGovernanceProjection({
  summary,
  history = [],
  linkedPrs = [],
  childTaskSummaries = [],
  sreMonitoring = null,
  options = {},
}) {
  const enabled = isCloseCancellationEnabled(options);
  const acceptanceCriteria = Array.isArray(summary?.acceptance_criteria)
    ? summary.acceptance_criteria
    : String(summary?.acceptance_criteria || '')
        .split(/\n+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  const childTasks = childTaskSummaries.map((child) => ({
    id: child.task_id,
    title: child.title || child.task_id,
    stage: child.current_stage || null,
    closed: Boolean(child.closed) || String(child.current_stage || '').toUpperCase() === STAGES.DONE,
    blocked: Boolean(child.blocked),
  }));
  const closedPullRequests = linkedPrs.filter((pr) => pr && (pr.merged || String(pr.state || '').toLowerCase() === 'closed'));
  const openPullRequests = linkedPrs.filter((pr) => !pr || (!pr.merged && String(pr.state || '').toLowerCase() !== 'closed'));
  const closedChildren = childTasks.filter((child) => child.closed);
  const openChildren = childTasks.filter((child) => !child.closed);
  const {
    decisionEvents,
    pmCancellationRecommendation,
    architectCancellationRecommendation,
    humanDecision,
    backtrackDecision,
    latestEscalation,
    requestMoreContextEvents,
    dualCancellationRecommendations,
    humanDecisionReady,
    latestDecision,
    escalationAwaitingHumanDecision,
  } = deriveCloseGovernanceDecisionContext(summary, history);
  const escalationProjection = latestEscalation ? {
    source: latestEscalation.payload?.reason === 'sre_monitoring_window_expired' ? 'monitoring_expiry' : 'exceptional_dispute',
    summary: String(latestEscalation.payload?.summary || '').trim() || 'Human stakeholder escalation is required.',
    recommendation: String(latestEscalation.payload?.recommendation_summary || latestEscalation.payload?.next_required_action || '').trim()
      || (latestEscalation.payload?.reason === 'sre_monitoring_window_expired'
        ? 'Decide whether to cancel the release or reopen implementation after monitoring expired without approval.'
        : 'Review the dispute and choose whether to approve, reject, or request more context.'),
    rationale: String(latestEscalation.payload?.rationale || '').trim() || null,
    severity: latestEscalation.payload?.severity || 'warning',
    occurredAt: latestEscalation.occurred_at || null,
    actorId: latestEscalation.actor_id || null,
    artifact: latestEscalation.payload?.artifact || null,
    awaitingHumanDecision: escalationAwaitingHumanDecision,
  } : null;
  const readinessChecklist = [
    {
      key: 'acceptance-criteria',
      label: 'Acceptance criteria documented',
      status: acceptanceCriteria.length > 0 ? 'ready' : 'missing',
      detail: acceptanceCriteria.length ? `${acceptanceCriteria.length} acceptance criteria recorded.` : 'No acceptance criteria are recorded for final close review.',
    },
    {
      key: 'monitoring-resolved',
      label: 'Monitoring outcome resolved',
      status: sreMonitoring?.state === 'approved' ? 'ready' : sreMonitoring?.state === 'escalated' ? 'blocked' : 'pending',
      detail: sreMonitoring?.state === 'approved'
        ? 'SRE monitoring completed with approval.'
        : sreMonitoring?.state === 'escalated'
          ? 'Monitoring expired or escalated and now requires human resolution.'
          : 'SRE monitoring has not produced a final approval yet.',
    },
    {
      key: 'pull-requests',
      label: 'Linked pull requests closed',
      status: linkedPrs.length === 0 ? 'missing' : openPullRequests.length === 0 ? 'ready' : 'blocked',
      detail: linkedPrs.length === 0
        ? 'No linked pull requests are available for close review.'
        : openPullRequests.length === 0
          ? `${closedPullRequests.length} linked pull request${closedPullRequests.length === 1 ? '' : 's'} closed or merged.`
          : `${openPullRequests.length} linked pull request${openPullRequests.length === 1 ? '' : 's'} still open.`,
    },
    {
      key: 'child-tasks',
      label: 'Child tasks resolved',
      status: childTasks.length === 0 ? 'ready' : openChildren.length === 0 ? 'ready' : 'blocked',
      detail: childTasks.length === 0
        ? 'No linked child tasks remain open.'
        : openChildren.length === 0
          ? `${closedChildren.length} linked child task${closedChildren.length === 1 ? '' : 's'} closed.`
          : `${openChildren.length} linked child task${openChildren.length === 1 ? '' : 's'} still open.`,
    },
  ];
  const readinessBlocked = Boolean(summary?.blocked) || readinessChecklist.some((item) => item.status === 'blocked');
  const readinessMissing = readinessChecklist.some((item) => item.status === 'missing');
  const readinessReady = !readinessBlocked && !readinessMissing && readinessChecklist.every((item) => item.status === 'ready');
  const humanDecisionRequired = summary?.current_stage === STAGES.PM_CLOSE_REVIEW
    && (summary?.waiting_state === 'awaiting_human_stakeholder_escalation'
      || (dualCancellationRecommendations && humanDecision?.outcome !== 'approve' && humanDecision?.outcome !== 'reject')
      || requestMoreContextEvents.length > 0)
    || escalationAwaitingHumanDecision;

  return {
    enabled,
    active: enabled && (summary?.current_stage === STAGES.PM_CLOSE_REVIEW || decisionEvents.length > 0 || Boolean(escalationProjection)),
    readiness: {
      ready: readinessReady,
      state: readinessReady ? 'ready' : readinessBlocked ? 'blocked' : readinessMissing ? 'missing_inputs' : 'pending',
      checklist: readinessChecklist,
      normalizedSignals: {
        acceptanceCriteriaRecorded: acceptanceCriteria.length > 0,
        monitoringResolved: sreMonitoring?.state === 'approved',
        linkedPrsClosed: linkedPrs.length > 0 && openPullRequests.length === 0,
        childTasksClosed: openChildren.length === 0,
      },
    },
    cancellation: {
      proposed: Boolean(pmCancellationRecommendation || architectCancellationRecommendation),
      awaitingSecondRecommendation: Boolean(pmCancellationRecommendation) !== Boolean(architectCancellationRecommendation),
      awaitingHumanDecision: Boolean(dualCancellationRecommendations)
        && (!humanDecision || humanDecision.outcome === 'request_more_context'),
      recommendations: {
        pm: pmCancellationRecommendation ? {
          actorId: pmCancellationRecommendation.actorId,
          occurredAt: pmCancellationRecommendation.occurredAt,
          outcome: pmCancellationRecommendation.outcome || 'recommend_cancel',
          summary: pmCancellationRecommendation.summary,
          rationale: pmCancellationRecommendation.rationale,
          artifact: pmCancellationRecommendation.artifact,
        } : null,
        architect: architectCancellationRecommendation ? {
          actorId: architectCancellationRecommendation.actorId,
          occurredAt: architectCancellationRecommendation.occurredAt,
          outcome: architectCancellationRecommendation.outcome || 'recommend_cancel',
          summary: architectCancellationRecommendation.summary,
          rationale: architectCancellationRecommendation.rationale,
          artifact: architectCancellationRecommendation.artifact,
        } : null,
      },
      requestMoreContextCount: requestMoreContextEvents.length,
      latestHumanDecisionOutcome: humanDecision?.outcome || null,
    },
    humanDecision: {
      required: Boolean(humanDecisionRequired),
      decisionReady: Boolean(humanDecisionReady),
      status: humanDecision?.outcome === 'approve'
        ? 'approved'
        : humanDecision?.outcome === 'reject'
          ? 'rejected'
          : requestMoreContextEvents.length > 0
            ? 'requested_more_context'
            : humanDecisionRequired
              ? 'awaiting_decision'
              : 'not_required',
      summary: humanDecision?.summary
        || (dualCancellationRecommendations
          ? 'Human stakeholder review is waiting on the aligned PM and Architect recommendation.'
          : escalationProjection?.summary
            || escalationProjection?.recommendation
            || summary?.next_required_action
            || null),
      pendingReason: humanDecisionReady
        ? null
        : 'Human review is not decision-ready until both PM and Architect recommendations are recorded or an escalation is raised.',
      latestDecision: humanDecision ? {
        actorId: humanDecision.actorId,
        occurredAt: humanDecision.occurredAt,
        outcome: humanDecision.outcome || null,
        summary: humanDecision.summary,
        rationale: humanDecision.rationale,
        confirmationRequired: humanDecision.confirmationRequired,
      } : null,
      availableActions: ['approve', 'reject', 'request_more_context'],
    },
    escalation: escalationProjection,
    backtrack: {
      available: summary?.current_stage === STAGES.PM_CLOSE_REVIEW && readinessBlocked,
      latestReason: backtrackDecision?.rationale || backtrackDecision?.summary || null,
      latestReasonCode: backtrackDecision?.outcome || null,
      latestRequestedAt: backtrackDecision?.occurredAt || null,
    },
    latestDecision: latestDecision ? {
      type: latestDecision.decisionType || null,
      actorRole: latestDecision.actorRole || null,
      actorId: latestDecision.actorId,
      outcome: latestDecision.outcome || null,
      summary: latestDecision.summary,
      rationale: latestDecision.rationale,
      occurredAt: latestDecision.occurredAt,
    } : null,
  };
}

function summarizeTaskForDetail(taskId, state, history = []) {
  const createdEvent = history.find(event => event.event_type === 'task.created');
  const refinementRequestedEvent = history.find(event => event.event_type === 'task.refinement_requested');
  const executionContract = deriveExecutionContractProjection(history);
  const newestEvent = history[0] || null;
  const pmBusinessContextCompletion = findLatestPmBusinessContextCompletion(history);
  const latestPayload = newestEvent?.payload || {};
  const title = createdEvent?.payload?.title || latestPayload.title || taskId;
  const operatorIntakeRequirements = refinementRequestedEvent?.payload?.raw_requirements
    || createdEvent?.payload?.raw_requirements
    || null;
  const intakeDraft = Boolean(createdEvent?.payload?.intake_draft || refinementRequestedEvent?.payload?.intake_draft || operatorIntakeRequirements);
  const now = Date.now();
  const lastOccurredAt = state?.last_occurred_at || newestEvent?.occurred_at || null;
  const ageMs = lastOccurredAt ? Math.max(0, now - Date.parse(lastOccurredAt)) : null;
  const freshnessStatus = ageMs == null
    ? 'unknown'
    : ageMs > 5 * 60 * 1000
      ? 'stale'
      : 'fresh';
  const reviewQuestions = deriveReviewQuestions(history);
  const hasBlockingReviewQuestions = reviewQuestions.summary.unresolvedBlockingCount > 0;

  return {
    task_id: taskId,
    tenant_id: state.tenant_id,
    title,
    priority: state.priority,
    current_stage: state.current_stage,
    current_owner: state.assignee,
    owner: state.assignee
      ? {
          actor_id: state.assignee,
          display_name: state.assignee,
        }
      : null,
    blocked: Boolean(state.blocked) || hasBlockingReviewQuestions,
    waiting_state: hasBlockingReviewQuestions ? 'pm_review_question_resolution' : state.waiting_state || latestPayload.waiting_state || (intakeDraft ? 'task_refinement' : null),
    next_required_action: hasBlockingReviewQuestions ? 'Resolve blocking architect review questions' : state.next_required_action || latestPayload.next_required_action || (intakeDraft ? PM_REFINEMENT_REQUIRED_ACTION : null),
    freshness: {
      status: freshnessStatus,
      last_updated_at: lastOccurredAt,
    },
    status_indicator: freshnessStatus,
    status: {
      blocked: Boolean(state.blocked) || hasBlockingReviewQuestions,
      waiting_state: hasBlockingReviewQuestions ? 'pm_review_question_resolution' : state.waiting_state || latestPayload.waiting_state || (intakeDraft ? 'task_refinement' : null),
      closed: Boolean(state.closed),
      freshness: freshnessStatus,
    },
    closed: Boolean(state.closed),
    intake_draft: intakeDraft,
    operator_intake_requirements: operatorIntakeRequirements,
    business_context: pmBusinessContextCompletion?.payload?.business_context || createdEvent?.payload?.business_context || null,
    acceptance_criteria: createdEvent?.payload?.acceptance_criteria || null,
    definition_of_done: createdEvent?.payload?.definition_of_done || null,
    task_type: createdEvent?.payload?.task_type || null,
    execution_contract: executionContract,
    queue_entered_at: state.queue_entered_at || null,
    wip_owner: state.wip_owner || null,
    wip_started_at: state.wip_started_at || null,
    lock: getActiveTaskLock(state),
    latest_qa_outcome: state.latest_qa_outcome || null,
  };
}

function summarizeTaskForList(summary) {
  return {
    task_id: summary.task_id,
    tenant_id: summary.tenant_id,
    title: summary.title,
    task_type: summary.task_type || null,
    priority: summary.priority,
    current_stage: summary.current_stage,
    current_owner: summary.current_owner,
    owner: summary.owner,
    blocked: Boolean(summary.blocked),
    closed: Boolean(summary.closed),
    intake_draft: Boolean(summary.intake_draft),
    operator_intake_requirements: summary.operator_intake_requirements || null,
    execution_contract: summary.execution_contract || { active: false, latest: null, latestVersion: null },
    waiting_state: summary.waiting_state || null,
    next_required_action: summary.next_required_action || null,
    queue_entered_at: summary.queue_entered_at || null,
    wip_owner: summary.wip_owner || null,
    wip_started_at: summary.wip_started_at || null,
    freshness: summary.freshness,
  };
}

function summarizeGitHubSync(relationships, linkedPrs = []) {
  const sync = relationships?.github_sync || null;
  if (!sync) {
    return {
      label: linkedPrs.length ? 'Awaiting GitHub sync' : 'No GitHub sync data',
      state: linkedPrs.length ? 'pending' : 'empty',
      lastSyncedAt: null,
      stale: false,
      deliveryId: null,
    };
  }
  const lastSyncedAt = sync.last_synced_at || null;
  const stale = lastSyncedAt ? (Date.now() - Date.parse(lastSyncedAt)) > GITHUB_SYNC_STALE_MS : false;
  return {
    label: stale ? 'GitHub sync stale' : 'GitHub sync current',
    state: stale ? 'stale' : (sync.status || 'ok'),
    lastSyncedAt,
    stale,
    deliveryId: sync.last_delivery_id || null,
  };
}

function isTaskDetailPageEnabled() {
  const rawValue = String(process.env.FF_TASK_DETAIL_PAGE ?? '1').trim().toLowerCase();
  return rawValue !== '0' && rawValue !== 'false' && rawValue !== 'off';
}

function buildTaskDetailViewModel({
  taskId,
  summary,
  relationships,
  history,
  telemetry,
  childTaskSummaries = [],
  parentTaskSummary = null,
  context,
  timelineHistory = history,
  timelinePageInfo = null,
  options = {},
}) {
  const status = inferTaskStatus(summary);
  const newestEvent = history[0] || null;
  const createdEvent = history.find(event => event.event_type === 'task.created');
  const canViewHistory = authorize(context, 'history:read');
  const reviewQuestions = deriveReviewQuestions(history);
  const workflowThreads = deriveWorkflowThreads(history);
  const canViewRelationships = authorize(context, 'relationships:read');
  const canViewTelemetry = authorize(context, 'observability:read');
  const canViewLinkedPrMetadata = canViewRelationships;
  const linkedPrs = canViewLinkedPrMetadata ? collectLinkedPrs(history, relationships, taskId) : [];
  const prStatus = summarizePrStatus(linkedPrs);
  const githubSync = canViewLinkedPrMetadata ? summarizeGitHubSync(relationships, linkedPrs) : null;
  const architectHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
  const implementationHistory = deriveImplementationHistory(history);
  const engineerSubmission = engineerSubmissionFromEvent(findLatestEngineerSubmission(history));
  const qaResults = deriveQaResults(history);
  const sreMonitoring = deriveSreMonitoringProjection({ taskId, summary, history, relationships, telemetry });
  const skillEscalation = toSkillEscalationSummary(findLatestSkillEscalation(history));
  const latestRetier = toRetierSummary(findLatestRetierEvent(history));
  const latestReassignment = toReassignmentSummary(findLatestReassignmentEvent(history));
  const ghostingReview = toGhostingReviewSummary(findLatestGhostingReviewEvent(history));
  const latestActivitySignal = findLatestActivitySignal(history, summary.current_owner || null);
  const missedCheckIns = computeMissedCheckIns(latestActivitySignal?.occurredAt, new Date().toISOString());
  const technicalSpec = formatArchitectHandoffTechnicalSpec(architectHandoff) || lastDefinedPayloadValue(history, ['technical_spec', 'technicalSpec']);
  const monitoringSpec = formatArchitectHandoffMonitoringSpec(architectHandoff) || lastDefinedPayloadValue(history, ['monitoring_spec', 'monitoringSpec']);
  const anomalyContextEvent = findLatestAnomalyContextEvent(history);
  const anomalyContext = anomalyContextEvent?.payload?.anomaly_context || null;
  const pmBusinessContextReview = findLatestPmBusinessContextCompletion(history);
  const queueStartedAt = summary.queue_entered_at || createdEvent?.occurred_at || null;
  const activeBlockerEvent = summary.blocked ? findActiveTaskBlock(history) : null;
  const activeAnomalyBlockerEvent = summary.blocked ? findActiveAnomalyChildBlock(history) : null;
  const blockerEvents = [activeAnomalyBlockerEvent, activeBlockerEvent]
    .filter((event, index, items) => event && items.findIndex((candidate) => candidate?.event_id === event?.event_id) === index);
  const commentEvents = canViewHistory ? history.filter(event => event.event_type === 'task.comment_workflow_recorded') : [];
  const childTasks = canViewRelationships ? childTaskSummaries.map((child) => ({
    id: child.task_id,
    title: child.title || child.task_id,
    stage: child.current_stage || null,
    status: inferTaskStatus(child),
    owner: formatActor(child.current_owner),
    blocked: Boolean(child.blocked),
      waitingState: child.waiting_state || null,
  })) : [];
  const canViewOrchestration = canViewRelationships && isDependencyPlannerEnabled(options) && isOrchestrationVisibilityEnabled(options);
  const orchestration = canViewOrchestration
    ? buildOrchestrationView({
        relationships,
        childTaskSummaries,
      })
    : null;
  const closeGovernance = deriveCloseGovernanceProjection({
    summary,
    history,
    linkedPrs,
    childTaskSummaries,
    sreMonitoring,
    options,
  });
  const blockedChildren = childTasks.filter((child) => child.status === 'blocked');
  const childStatus = childTasks.length
    ? blockedChildren.length
      ? 'blocked'
      : childTasks.every((child) => child.status === 'done')
        ? 'done'
        : childTasks.some((child) => child.status === 'waiting')
          ? 'waiting'
          : 'active'
    : 'empty';
  const blockers = blockerEvents.map((event) => {
    const ageMs = event.occurred_at ? Math.max(0, Date.now() - Date.parse(event.occurred_at)) : null;
    const blockingChild = childTasks.find((child) => child.id === event.payload?.child_task_id) || null;
    return {
      id: event.event_id,
      type: event.payload?.blocker_type || event.payload?.waiting_state || 'workflow_blocker',
      label: event.payload?.summary || event.payload?.reason || 'Task is blocked',
      reason: event.payload?.reason || null,
      source: blockingChild
        ? 'child_task'
        : event.payload?.external_dependency
          ? 'external_dependency'
          : event.payload?.review_required
            ? 'review'
            : event.payload?.approval_required
              ? 'approval'
              : summary.waiting_state || 'workflow',
      owner: formatActor(event.payload?.owner_id || null, 'No blocker owner'),
      ageLabel: formatDurationFromMs(ageMs) || 'Unknown age',
      occurredAt: event.occurred_at || null,
      childTaskId: event.payload?.child_task_id || null,
      childTask: blockingChild ? {
        id: blockingChild.id,
        title: blockingChild.title,
        stage: blockingChild.stage,
        status: blockingChild.status,
        owner: blockingChild.owner,
        waitingState: blockingChild.waitingState,
      } : null,
      freezeScope: Array.isArray(event.payload?.freeze_scope) ? event.payload.freeze_scope : [],
      viewable: event.payload?.viewable !== false,
      commentable: event.payload?.commentable !== false,
      nextRequiredAction: event.payload?.next_required_action || null,
    };
  });

  return {
    task: {
      id: summary.task_id,
      title: summary.title,
      priority: summary.priority,
      stage: summary.current_stage,
      status,
    },
    summary: {
      owner: formatActor(summary.current_owner),
      workflowStage: {
        value: summary.current_stage,
        label: summary.current_stage ? toSentenceCase(summary.current_stage) : 'Unknown stage',
      },
      nextAction: {
        label: summary.next_required_action || 'No next step defined',
        source: summary.next_required_action ? 'system' : 'none',
        overdue: telemetry?.freshness?.status === 'stale',
        waitingOn: summary.waiting_state ? toSentenceCase(summary.waiting_state) : null,
      },
      prStatus,
      githubSync,
      childStatus: {
        label: childTasks.length ? `${childTasks.length} linked child tasks` : 'No child tasks',
        state: childStatus,
        total: childTasks.length,
        blockedCount: blockedChildren.length,
      },
      timers: {
        queueEnteredAt: queueStartedAt,
        queueAgeLabel: queueStartedAt ? formatDurationFromMs(Math.max(0, Date.now() - Date.parse(queueStartedAt))) : 'Not started',
        lastUpdatedAt: summary.freshness?.last_updated_at || null,
        freshness: summary.freshness?.status || 'unknown',
        sreWindowLabel: sreMonitoring.windowEndsAt ? sreMonitoring.timeRemainingLabel : 'Not started',
      },
      blockedState: {
        isBlocked: status === 'blocked' || workflowThreads.summary.unresolvedBlockingCount > 0,
        label: status === 'blocked' || workflowThreads.summary.unresolvedBlockingCount > 0 ? 'Blocked' : status === 'waiting' ? 'Waiting' : status === 'done' ? 'Done' : 'Active',
        waitingOn: reviewQuestions.summary.unresolvedBlockingCount > 0
          ? 'PM review question resolution'
          : workflowThreads.summary.unresolvedBlockingCount > 0
            ? 'Workflow thread resolution'
            : summary.waiting_state ? toSentenceCase(summary.waiting_state) : null,
      },
    },
    reviewQuestions: {
      summary: reviewQuestions.summary,
      pinned: canViewHistory
        ? reviewQuestions.items
            .filter((item) => item.blocking && item.state !== REVIEW_QUESTION_STATES.RESOLVED)
            .map((item) => ({ id: item.id, prompt: item.prompt, state: item.state }))
        : [],
      items: canViewHistory
        ? reviewQuestions.items.map((item) => ({
            id: item.id,
            prompt: item.prompt,
            blocking: item.blocking,
            state: item.state,
            createdAt: item.createdAt,
            createdBy: item.createdBy,
            answer: item.answer,
            resolution: item.resolution,
            resolvedAt: item.resolvedAt,
            resolvedBy: item.resolvedBy,
            lastUpdatedAt: item.lastUpdatedAt,
            messages: item.messages,
          }))
        : [],
    },
    blockers,
    context: {
      intakeDraft: Boolean(summary.intake_draft),
      operatorIntakeRequirements: summary.operator_intake_requirements || null,
      executionContract: summary.execution_contract || { active: false, latest: null, latestVersion: null },
      businessContext: summary.business_context || null,
      acceptanceCriteria: Array.isArray(summary.acceptance_criteria)
        ? summary.acceptance_criteria
        : String(summary.acceptance_criteria || '')
            .split(/\n+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
      definitionOfDone: Array.isArray(summary.definition_of_done)
        ? summary.definition_of_done
        : String(summary.definition_of_done || '')
            .split(/\n+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
      technicalSpec,
      monitoringSpec,
      architectHandoff,
      engineerSubmission,
      implementationHistory,
      qaResults,
      sreMonitoring,
      skillEscalation,
      retiering: latestRetier,
      reassignment: latestReassignment,
      ghostingReview,
      activityMonitoring: {
        requiredCheckInIntervalMinutes: ENGINEER_CHECK_IN_INTERVAL_MINUTES,
        missedCheckIns,
        threshold: MISSED_CHECK_IN_THRESHOLD,
        thresholdReached: missedCheckIns >= MISSED_CHECK_IN_THRESHOLD,
        lastActivity: latestActivitySignal,
      },
      transferredContext: latestReassignment?.transferSummary || null,
      anomalyChildTask: anomalyContext ? {
        machineGenerated: anomalyContext.machine_generated !== false,
        sourceTaskId: anomalyContext.source_task_id || null,
        service: anomalyContext.service || null,
        summary: anomalyContext.summary || null,
        metrics: Array.isArray(anomalyContext.metrics) ? anomalyContext.metrics : [],
        logs: Array.isArray(anomalyContext.logs) ? anomalyContext.logs : [],
        errorSamples: Array.isArray(anomalyContext.error_samples) ? anomalyContext.error_samples : [],
        prefill: anomalyContext.prefill || null,
        finalizedByPm: Boolean(anomalyContext.finalized_by_pm),
        finalizedAt: anomalyContext.finalized_at || null,
        finalizedBy: anomalyContext.finalized_by || null,
      } : null,
      pmBusinessContextReview: pmBusinessContextReview ? {
        completedAt: pmBusinessContextReview.occurred_at || null,
        completedBy: pmBusinessContextReview.actor_id || null,
        finalized: true,
      } : {
        completedAt: null,
        completedBy: null,
        finalized: false,
      },
      closeGovernance,
    },
    relations: {
      linkedPrs,
      githubSync,
      parentTask: parentTaskSummary ? {
        id: parentTaskSummary.task_id,
        title: parentTaskSummary.title || parentTaskSummary.task_id,
        stage: parentTaskSummary.current_stage || null,
        status: inferTaskStatus(parentTaskSummary),
        owner: formatActor(parentTaskSummary.current_owner),
        blocked: Boolean(parentTaskSummary.blocked),
        waitingState: parentTaskSummary.waiting_state || null,
      } : null,
      childTasks,
    },
    orchestration,
    activity: {
      comments: commentEvents.slice(0, 10).map((event) => ({
        id: event.event_id,
        actor: formatActor(event.actor_id, event.actor_id || 'Unknown actor'),
        summary: event.summary,
        body: event.payload?.body || null,
        occurredAt: event.occurred_at,
      })),
      workflowThreads: canViewHistory
        ? workflowThreads
        : { items: [], summary: { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 } },
      auditLog: canViewHistory ? timelineHistory.map((event) => ({
        id: event.event_id,
        type: event.event_type,
        summary: event.summary,
        actor: formatActor(event.actor_id, event.actor_id || 'Unknown actor'),
        occurredAt: event.occurred_at,
      })) : [],
      auditLogPageInfo: canViewHistory ? timelinePageInfo : null,
    },
    telemetry: !canViewTelemetry
      ? {
          availability: 'restricted',
          lastUpdatedAt: null,
          summary: {},
          emptyStateReason: 'Telemetry is hidden for this session.',
          access: {
            restricted: true,
            scope: 'none',
            omission_applied: true,
            omitted_fields: ['telemetry'],
          },
        }
      : telemetry
        ? {
            availability: telemetry.access?.restricted ? 'restricted' : telemetry.degraded ? 'stale' : telemetry.event_count ? 'available' : 'empty',
            lastUpdatedAt: telemetry.last_updated_at || null,
            summary: telemetry.key_signals || {},
            links: telemetry.links || [],
            emptyStateReason: telemetry.event_count ? null : 'No telemetry signals are linked to this task yet.',
            access: telemetry.access,
          }
        : {
            availability: 'error',
            lastUpdatedAt: null,
            summary: {},
            emptyStateReason: 'Telemetry unavailable.',
            access: null,
          },
    meta: {
      lock: summary.lock
        ? {
            ownerId: summary.lock.ownerId,
            acquiredAt: summary.lock.acquiredAt,
            expiresAt: summary.lock.expiresAt,
            reason: summary.lock.reason,
            action: summary.lock.action,
          }
        : null,
      permissions: {
        canViewComments: canViewHistory,
        canViewAuditLog: canViewHistory,
        canViewTelemetry: canViewTelemetry,
        canViewChildTasks: canViewRelationships,
        canViewLinkedPrMetadata,
        canViewOrchestration,
      },
      freshness: {
        status: summary.freshness?.status || 'unknown',
        lastUpdatedAt: summary.freshness?.last_updated_at || null,
        liveUpdates: false,
        refreshBehavior: 'manual_refresh',
      },
    },
  };
}

function toTelemetryResponse(summary, context) {
  const privileged = hasAnyRole(context, ['admin', 'sre', 'contributor']);
  const base = {
    task_id: summary.task_id,
    tenant_id: summary.tenant_id,
    status: summary.status,
    last_updated_at: summary.last_updated_at,
    freshness: summary.freshness,
    degraded: summary.degraded,
    event_count: summary.event_count,
    stale: summary.freshness?.status === 'stale',
    key_signals: summary.key_signals,
    correlation: {
      approved_correlation_ids: summary.approved_correlation_ids || [],
      approved_links: summary.approved_links || [],
    },
    access: {
      restricted: !privileged,
      scope: privileged ? 'operator' : 'summary_only',
      omission_applied: !privileged,
      omitted_fields: privileged ? [] : ['trace_ids', 'metrics', 'privileged_links'],
    },
  };

  if (privileged) {
    return {
      ...base,
      last_event_id: summary.last_event_id,
      last_event_type: summary.last_event_type,
      current_stage: summary.current_stage,
      correlation_ids: summary.correlation_ids,
      trace_ids: summary.trace_ids,
      metrics: summary.metrics,
      links: summary.privileged_links || [],
    };
  }

  return base;
}

function normalizeHistoryItem(item) {
  return {
    item_id: item.event_id,
    event_id: item.event_id,
    tenant_id: item.tenant_id,
    event_type: item.event_type,
    event_type_label: item.event_type,
    occurred_at: item.occurred_at,
    recorded_at: item.recorded_at,
    actor: {
      actor_id: item.actor_id,
      actor_type: item.actor_type,
      display_name: item.actor_id,
    },
    actor_id: item.actor_id,
    actor_type: item.actor_type,
    sequence_number: item.sequence_number,
    summary: item.summary,
    display: {
      summary: item.summary,
      event_type_label: item.event_type,
      is_known_type: isWorkflowAuditEventType(item.event_type),
      fallback_used: !isWorkflowAuditEventType(item.event_type),
    },
    correlation: item.correlation_id || item.trace_id
      ? {
          correlation_id: item.correlation_id || null,
          trace_id: item.trace_id || null,
        }
      : null,
    source: item.source,
    payload: item.payload,
  };
}

function wantsPaginatedHistory(url) {
  return url.searchParams.has('limit') || url.searchParams.has('cursor');
}

function buildPaginatedHistoryResponse(items, limit) {
  const boundedLimit = Number.isFinite(limit) ? limit : items.length;
  const last = items.at(-1) || null;
  return {
    items: items.map(normalizeHistoryItem),
    page_info: {
      limit: boundedLimit,
      next_cursor: items.length === boundedLimit && last ? String(last.sequence_number) : null,
      has_more: items.length === boundedLimit,
    },
  };
}

function formatAssignmentOwner(agent) {
  if (!agent) return null;
  return {
    agentId: agent.id,
    displayName: agent.display_name,
    role: agent.role,
  };
}

function findTaskTitleFromHistory(history = [], fallbackTaskId) {
  const created = history.find((event) => event?.event_type === 'task.created');
  return created?.payload?.title || fallbackTaskId;
}

async function syncCanonicalTaskFromAuditState(taskPlatform, store, tenantId, taskId) {
  const [state, history] = await Promise.all([
    store.getTaskCurrentState(taskId, { tenantId }),
    store.getTaskHistory(taskId, { tenantId, limit: 100 }),
  ]);
  if (!state) return null;
  return taskPlatform.syncTaskFromProjection({
    tenantId,
    taskId,
    title: findTaskTitleFromHistory(history, taskId),
    status: state.current_stage || 'BACKLOG',
    priority: state.priority || null,
    ownerAgentId: state.assignee || null,
    sourceSystem: 'audit_projection_sync',
  });
}

async function trySyncCanonicalTask(taskPlatform, store, tenantId, taskId, logger, metadata = {}) {
  try {
    await syncCanonicalTaskFromAuditState(taskPlatform, store, tenantId, taskId);
  } catch (error) {
    logger.error({
      feature: 'task_platform_sync',
      action: 'compatibility_sync',
      outcome: 'error',
      tenant_id: tenantId,
      task_id: taskId,
      error_code: error.code || 'internal_error',
      error_message: error.message,
      ...metadata,
    });
  }
}

function isResolvedTaskState(state = {}) {
  return Boolean(state?.closed) || String(state?.current_stage || '').toUpperCase() === STAGES.DONE;
}

async function maybeReleaseParentAnomalyBlock({
  store,
  taskPlatform,
  tenantId,
  childTaskId,
  actorId,
  actorType = 'user',
  logger,
  source = 'http',
}) {
  const [childState, childHistory] = await Promise.all([
    store.getTaskCurrentState(childTaskId, { tenantId }),
    store.getTaskHistory(childTaskId, { tenantId, limit: 500 }),
  ]);
  if (!childState || !isResolvedTaskState(childState)) return null;
  const childCreated = childHistory.find((event) => event?.event_type === 'task.created');
  const parentTaskId = childCreated?.payload?.parent_task_id || null;
  if (!parentTaskId) return null;

  const [parentState, parentHistory] = await Promise.all([
    store.getTaskCurrentState(parentTaskId, { tenantId }),
    store.getTaskHistory(parentTaskId, { tenantId, limit: 500 }),
  ]);
  if (!parentState?.blocked) return null;
  const activeBlock = findActiveTaskBlock(parentHistory);
  if (!activeBlock || activeBlock.payload?.child_task_id !== childTaskId) return null;

  const result = await store.appendEvent({
    taskId: parentTaskId,
    tenantId,
    eventType: 'task.unblocked',
    actorId: actorId || 'system:anomaly-child-resolution',
    actorType,
    idempotencyKey: `anomaly-child:unblock:${parentTaskId}:${childTaskId}:${childState.last_event_id || 'resolved'}`,
    payload: {
      child_task_id: childTaskId,
      reason: `Linked anomaly child task ${childTaskId} reached a resolved state.`,
      summary: `Parent task resumed after anomaly child task ${childTaskId} was resolved.`,
      waiting_state: null,
      next_required_action: 'Parent task may continue through the normal SRE monitoring workflow.',
    },
    source,
  });
  await trySyncCanonicalTask(taskPlatform, store, tenantId, parentTaskId, logger, { route: 'anomaly_child_parent_unblocked' });
  return result;
}

function createAssignmentIdempotencyKey(req, taskId, state, agentId) {
  return req.headers['idempotency-key']
    || req.headers['x-idempotency-key']
    || `assignment:${taskId}:${agentId || 'unassigned'}:${state?.last_event_id || 'initial'}`;
}

function normalizeRoutePath(pathname = '') {
  if (pathname === '/api' || pathname === '/api/') return '/';
  if (pathname.startsWith('/api/')) return pathname.slice(4) || '/';
  if (pathname === '/backend' || pathname === '/backend/') return '/';
  return pathname.startsWith('/backend/') ? pathname.slice('/backend'.length) || '/' : pathname;
}

function createReviewQuestionId() {
  return `rq-${crypto.randomUUID().slice(0, 8)}`;
}

function requireTrustedBrowserAuthCode(authCode, options = {}) {
  const raw = String(authCode || '').trim();
  if (!raw) {
    throw createHttpError(400, 'missing_auth_code', 'The authCode field is required.');
  }

  try {
    return verifyBrowserAuthCode(
      raw,
      options.browserAuthCodeSecret || process.env.AUTH_BROWSER_AUTH_CODE_SECRET || options.jwtSecret || process.env.AUTH_JWT_SECRET,
      {
        issuer: options.browserAuthCodeIssuer || process.env.AUTH_BROWSER_AUTH_CODE_ISSUER,
        audience: options.browserAuthCodeAudience || process.env.AUTH_BROWSER_AUTH_CODE_AUDIENCE,
      },
    );
  } catch {
    throw createHttpError(401, 'invalid_auth_code', 'The sign-in code is invalid, expired, or untrusted.');
  }
}

function canAskReviewQuestion(context) {
  return hasAnyRole(context, ['architect', 'admin']);
}

function canAnswerReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canResolveReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canReopenReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin', 'architect']);
}

function canManageArchitectHandoff(context) {
  return hasAnyRole(context, ['architect', 'admin']);
}

function canManageEngineerSubmission(context) {
  return hasAnyRole(context, ['engineer', 'admin']);
}

function canRequestSkillEscalation(context) {
  return hasAnyRole(context, ['engineer', 'admin']);
}

function canManageReassignmentGhosting(context) {
  return hasAnyRole(context, ['architect', 'admin']);
}

function validateSkillEscalationBody(body = {}) {
  const reason = String(body.reason || body.summary || '').trim();
  const requestedTier = normalizeEngineerTier(body.requestedTier, null);
  if (!reason) {
    throw createHttpError(400, 'missing_skill_escalation_reason', 'A concise reason is required for responsible above-skill escalation.');
  }
  return {
    reason,
    requested_tier: requestedTier,
  };
}

function validateCheckInBody(body = {}) {
  const summary = String(body.summary || '').trim();
  const evidence = normalizeMultilineList(body.evidence || body.references || []);
  if (!summary) {
    throw createHttpError(400, 'missing_check_in_summary', 'Check-ins require a concrete progress summary.');
  }
  return { summary, evidence };
}

function validateRetierBody(body = {}) {
  const engineerTier = normalizeEngineerTier(body.engineerTier, null);
  const tierRationale = String(body.tierRationale || '').trim();
  const reason = String(body.reason || '').trim();
  if (!engineerTier) {
    throw createHttpError(400, 'invalid_engineer_tier', 'Engineer tier must be one of Principal, Sr, or Jr.');
  }
  if (!tierRationale) {
    throw createHttpError(400, 'missing_tier_rationale', 'Tier rationale is required when re-tiering work.');
  }
  return { engineer_tier: engineerTier, tier_rationale: tierRationale, reason };
}

function validateReassignmentBody(body = {}) {
  const mode = String(body.mode || 'manual').trim().toLowerCase();
  const reason = String(body.reason || '').trim();
  const assignee = body.assignee == null ? null : String(body.assignee).trim();
  const engineerTier = body.engineerTier == null ? null : normalizeEngineerTier(body.engineerTier, null);
  if (!['manual', 'above_skill', 'inactivity'].includes(mode)) {
    throw createHttpError(400, 'invalid_reassignment_mode', 'Reassignment mode must be manual, above_skill, or inactivity.');
  }
  if (!reason) {
    throw createHttpError(400, 'missing_reassignment_reason', 'A reassignment reason is required.');
  }
  if (body.engineerTier != null && !engineerTier) {
    throw createHttpError(400, 'invalid_engineer_tier', 'Engineer tier must be one of Principal, Sr, or Jr.');
  }
  return { mode, reason, assignee: assignee || null, engineer_tier: engineerTier };
}

async function loadReviewQuestionContext(store, taskId, tenantId, questionId) {
  const [state, history] = await Promise.all([
    store.getTaskCurrentState(taskId, { tenantId }),
    store.getTaskHistory(taskId, { tenantId, limit: 500 }),
  ]);
  if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
  const questions = deriveReviewQuestions(history);
  const question = questionId ? questions.items.find((item) => item.id === questionId) : null;
  return { state, history, questions, question };
}

function reviewQuestionWorkflowPayload(questions, base = {}) {
  const unresolvedBlockingCount = questions.summary.unresolvedBlockingCount;
  return {
    ...base,
    blocked: unresolvedBlockingCount > 0,
    waiting_state: unresolvedBlockingCount > 0 ? 'pm_review_question_resolution' : null,
    next_required_action: unresolvedBlockingCount > 0 ? 'Resolve blocking architect review questions' : null,
  };
}

async function recordIntakeCreationFailure({
  store,
  context,
  body,
  taskId,
  createdTaskId,
  idempotencyKey,
  failedStep,
  error,
}) {
  if (!createdTaskId) return;
  try {
    await store.appendEvent({
      taskId: createdTaskId || taskId,
      tenantId: context.tenantId,
      eventType: 'task.intake_creation_failed',
      actorId: context.actorId,
      actorType: body.actorType,
      idempotencyKey: `${idempotencyKey}:failure:${failedStep}`,
      payload: {
        intake_draft: true,
        failed_step: failedStep,
        failure_message: String(error?.message || 'Task creation step failed').slice(0, 240),
        raw_requirements_length: typeof body.rawRequirements === 'string' ? body.rawRequirements.length : 0,
        waiting_state: 'intake_creation_failed',
        next_required_action: INTAKE_CREATION_FAILED_ACTION,
      },
      source: 'http',
    });
  } catch {
    // Best-effort compensating event only; preserve the primary creation failure.
  }
}

async function persistTaskCreation({
  store,
  taskPlatform,
  context,
  body,
  taskId,
  idempotencyKey,
  isIntakeDraft,
  requestId,
}) {
  let failedStep = 'task.created';
  let createdTaskId = null;
  try {
    const created = await store.appendEvent({
      taskId,
      tenantId: context.tenantId,
      eventType: 'task.created',
      actorId: context.actorId,
      actorType: body.actorType,
      idempotencyKey,
      payload: {
        title: body.title,
        ...(isIntakeDraft ? {
          raw_requirements: body.rawRequirements,
          intake_draft: true,
          waiting_state: 'task_refinement',
          next_required_action: PM_REFINEMENT_REQUIRED_ACTION,
          assignee: 'pm',
        } : {
          business_context: body.businessContext,
          acceptance_criteria: body.acceptanceCriteria,
          definition_of_done: body.definitionOfDone,
        }),
        priority: body.priority,
        task_type: body.taskType,
        initial_stage: 'DRAFT',
      },
      source: 'http',
    });
    createdTaskId = created.event.task_id;
    let refinementRequested = null;

    if (isIntakeDraft) {
      failedStep = 'task.refinement_requested';
      refinementRequested = await store.appendEvent({
        taskId: createdTaskId,
        tenantId: context.tenantId,
        eventType: 'task.refinement_requested',
        actorId: context.actorId,
        actorType: body.actorType,
        idempotencyKey: `${idempotencyKey}:refinement`,
        payload: {
          intake_draft: true,
          raw_requirements: body.rawRequirements,
          assignee: 'pm',
          waiting_state: 'task_refinement',
          next_required_action: PM_REFINEMENT_REQUIRED_ACTION,
          routing_reason: 'Raw operator intake requires Product Manager refinement before implementation.',
        },
        source: 'http',
      });
    }

    failedStep = 'task_platform.create';
    await Promise.resolve(taskPlatform.createTask({
      tenantId: context.tenantId,
      actorId: context.actorId,
      taskId: createdTaskId,
      title: body.title,
      description: isIntakeDraft ? body.rawRequirements : body.businessContext,
      status: 'DRAFT',
      priority: body.priority,
      ownerAgentId: isIntakeDraft ? 'pm' : null,
      idempotencyKey: `task-platform:create:${createdTaskId}`,
      requestId,
    }));

    return { created, createdTaskId, refinementRequested };
  } catch (error) {
    if (isIntakeDraft) {
      await recordIntakeCreationFailure({
        store,
        context,
        body,
        taskId,
        createdTaskId,
        idempotencyKey,
        failedStep,
        error,
      });
    }
    throw createHttpError(500, 'task_creation_failed', 'Task creation did not complete.', { failed_step: failedStep });
  }
}

async function loadExecutionContractContext(store, taskId, tenantId) {
  const [state, history] = await Promise.all([
    store.getTaskCurrentState(taskId, { tenantId }),
    store.getTaskHistory(taskId, { tenantId, limit: 500 }),
  ]);
  if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
  const summary = summarizeTaskForDetail(taskId, state, history);
  return {
    state,
    history,
    summary,
    projection: deriveExecutionContractProjection(history),
  };
}

function assertExecutionContractSourceIsIntake(summary, history) {
  if (!isIntakeDraftSummary(summary, history)) {
    throw createHttpError(409, 'execution_contract_requires_intake_draft', 'Execution Contracts can only be generated from an Intake Draft.', {
      current_stage: summary?.current_stage || null,
    });
  }
}

async function recordExecutionContractVersion({ store, taskId, tenantId, context, body, source = 'http' }) {
  const { history, summary, projection } = await loadExecutionContractContext(store, taskId, tenantId);
  assertExecutionContractSourceIsIntake(summary, history);
  const previousContract = projection.latest || null;
  const { contract, materialChange, previousVersion } = createExecutionContractDraft({
    taskId,
    summary,
    history,
    body,
    actorId: context.actorId,
    previousContract,
  });
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_version_recorded',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract:${taskId}:v${contract.version}:${contract.material_hash}`,
    payload: {
      version: contract.version,
      previous_version: previousVersion,
      material_change: materialChange,
      material_hash: contract.material_hash,
      owner: EXECUTION_CONTRACT_OWNER,
      waiting_state: EXECUTION_CONTRACT_WAITING_STATE,
      next_required_action: EXECUTION_CONTRACT_NEXT_ACTION,
      contract,
    },
    source,
  });
  return { result, contract, materialChange, previousVersion };
}

async function validateLatestExecutionContract({ store, taskId, tenantId, context, body = {}, source = 'http' }) {
  const { projection } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', { task_id: taskId });
  }
  const validation = validateExecutionContract(projection.latest);
  const valid = validation.status === 'valid';
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_validated',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract-validate:${taskId}:v${projection.latest.version}:${projection.latest.material_hash}`,
    payload: {
      version: projection.latest.version,
      validation,
      waiting_state: valid ? 'execution_contract_review_ready' : EXECUTION_CONTRACT_WAITING_STATE,
      next_required_action: valid ? 'Generate Markdown story for operator review.' : EXECUTION_CONTRACT_NEXT_ACTION,
    },
    source,
  });
  return { result, validation, contract: projection.latest };
}

async function generateExecutionContractMarkdown({ store, taskId, tenantId, context, body = {}, source = 'http' }) {
  const { projection } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', { task_id: taskId });
  }
  const validation = validateExecutionContract(projection.latest);
  if (validation.status !== 'valid') {
    throw createHttpError(409, 'execution_contract_invalid', 'Markdown can only be generated after required contract sections are complete.', {
      missing_sections: validation.missingSections,
      missing_fields: validation.missingFields,
    });
  }
  const markdown = contractMarkdown(projection.latest);
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_markdown_generated',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract-markdown:${taskId}:v${projection.latest.version}:${projection.latest.material_hash}`,
    payload: {
      version: projection.latest.version,
      validation,
      markdown,
      authoritative: false,
      waiting_state: 'operator_contract_review',
      next_required_action: EXECUTION_CONTRACT_REVIEW_ACTION,
    },
    source,
  });
  return { result, validation, contract: projection.latest, markdown };
}

async function approveLatestExecutionContract({ store, taskId, tenantId, context, body = {}, source = 'http' }) {
  const { projection, history } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', { task_id: taskId });
  }
  const validation = validateExecutionContract(projection.latest);
  if (validation.status !== 'valid') {
    throw createHttpError(409, 'execution_contract_invalid', 'Only valid Execution Contracts can be approved.', {
      missing_sections: validation.missingSections,
      missing_fields: validation.missingFields,
    });
  }
  const workflowThreads = deriveWorkflowThreads(history).items;
  const reviewQuestions = deriveReviewQuestions(history).items;
  const approvalSummary = evaluateExecutionContractApprovalReadiness(projection.latest, {
    workflowThreads,
    reviewQuestions,
  });
  if (!approvalSummary.canApprove) {
    throw createHttpError(409, 'execution_contract_approval_blocked', 'Operator Approval is blocked until required reviewer approvals are recorded and blocking questions are resolved.', {
      approval_summary: approvalSummary,
      missing_required_approvals: approvalSummary.missingRequiredApprovals,
      unresolved_blocking_questions: approvalSummary.unresolvedBlockingQuestions,
    });
  }
  const approvedAt = new Date().toISOString();
  const committedScope = {
    ...(projection.latest.committed_scope || {}),
    commitment_status: 'committed',
    approved_version: projection.latest.version,
    approved_at: approvedAt,
    approved_by: context.actorId,
  };
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_approved',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract-approve:${taskId}:v${projection.latest.version}:${projection.latest.material_hash}`,
    occurredAt: approvedAt,
    payload: {
      version: projection.latest.version,
      validation,
      approval_summary: approvalSummary,
      committed_scope: committedScope,
      authoritative: true,
      waiting_state: 'execution_contract_approved',
      next_required_action: EXECUTION_CONTRACT_APPROVED_ACTION,
      approval_note: String(body.approvalNote || body.approval_note || '').trim() || null,
    },
    source,
  });
  return { result, validation, contract: projection.latest, committedScope, approvalSummary };
}

async function generateExecutionContractVerificationReportSkeleton({ store, taskId, tenantId, context, body = {}, source = 'http' }) {
  const { projection } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', { task_id: taskId });
  }
  if (!projection.approval || Number(projection.approval.version) !== Number(projection.latest.version)) {
    throw createHttpError(409, 'execution_contract_not_approved', 'Verification report skeletons can only be generated after the latest Execution Contract is approved.', {
      latest_version: projection.latest.version,
    });
  }
  const identity = normalizeArtifactIdentity({ taskId, contract: projection.latest, body });
  if (!identity.valid_for_committed_repo) {
    throw createHttpError(409, 'invalid_artifact_display_id', 'Verification report skeletons require a TSK-123-style display ID before implementation dispatch.', {
      task_id: taskId,
      requested_display_id: identity.requested_display_id,
      environment: identity.environment,
      collision_policy: identity.collision_policy,
    });
  }
  const generatedAt = new Date().toISOString();
  const verificationReport = createExecutionContractVerificationReportSkeleton({
    taskId,
    contract: projection.latest,
    body,
    actorId: context.actorId,
    generatedAt,
  });
  const dispatchGate = evaluateExecutionContractDispatchReadiness({
    contract: projection.latest,
    verificationReport,
  });
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_verification_report_generated',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract-verification-report:${taskId}:v${projection.latest.version}:${projection.latest.material_hash}:${verificationReport.report_id}`,
    occurredAt: generatedAt,
    payload: {
      version: projection.latest.version,
      report_id: verificationReport.report_id,
      verification_report: verificationReport,
      dispatch_gate: dispatchGate,
      waiting_state: 'verification_report_ready',
      next_required_action: VERIFICATION_REPORT_GENERATED_ACTION,
    },
    source,
  });
  return {
    result,
    verificationReport: result.event?.payload?.verification_report || verificationReport,
    dispatchGate: result.event?.payload?.dispatch_gate || dispatchGate,
  };
}

async function generateExecutionContractArtifactBundle({ store, taskId, tenantId, context, body = {}, source = 'http' }) {
  const { projection, history } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', { task_id: taskId });
  }
  if (!projection.approval || Number(projection.approval.version) !== Number(projection.latest.version)) {
    throw createHttpError(409, 'execution_contract_not_approved', 'Repo artifacts can only be generated after the latest Execution Contract is approved.', {
      latest_version: projection.latest.version,
    });
  }
  const identity = normalizeArtifactIdentity({ taskId, contract: projection.latest, body });
  if (!identity.valid_for_committed_repo) {
    throw createHttpError(409, 'invalid_artifact_display_id', 'Production repo artifacts require a TSK-123-style display ID; staging/local artifacts must use a non-production alias.', {
      task_id: taskId,
      requested_display_id: identity.requested_display_id,
      environment: identity.environment,
      collision_policy: identity.collision_policy,
    });
  }
  const generatedAt = new Date().toISOString();
  const artifactBundle = createExecutionContractArtifactBundle({
    taskId,
    contract: projection.latest,
    history,
    body,
    actorId: context.actorId,
    approvalSummary: projection.approval.approvalSummary || {},
    generatedAt,
  });
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_artifact_bundle_generated',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract-artifacts:${taskId}:v${projection.latest.version}:${projection.latest.material_hash}:${artifactBundle.bundle_id}`,
    occurredAt: generatedAt,
    payload: {
      version: projection.latest.version,
      bundle_id: artifactBundle.bundle_id,
      artifact_bundle: artifactBundle,
      waiting_state: 'artifact_bundle_review',
      next_required_action: ARTIFACT_BUNDLE_REVIEW_ACTION,
    },
    source,
  });
  return { result, artifactBundle };
}

async function approveLatestExecutionContractArtifactBundle({ store, taskId, tenantId, context, body = {}, source = 'http' }) {
  const { projection } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.artifacts) {
    throw createHttpError(404, 'execution_contract_artifact_bundle_not_found', 'No generated artifact bundle exists for the latest Execution Contract version.', { task_id: taskId });
  }
  const approvedAt = new Date().toISOString();
  const artifactBundle = approveExecutionContractArtifactBundle({
    bundle: projection.artifacts,
    body,
    actorId: context.actorId,
    approvedAt,
  });
  if (!artifactBundle.approval_summary.canCommit || !artifactBundle.commit_policy.commit_allowed) {
    throw createHttpError(409, 'artifact_bundle_approval_blocked', 'Artifact bundle approval is blocked until PM, section-owner, and exception-triggered operator approvals are recorded.', {
      approval_summary: artifactBundle.approval_summary,
      missing_required_approvals: artifactBundle.approval_summary.missingRequiredApprovals,
      commit_policy: artifactBundle.commit_policy,
    });
  }
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_artifact_bundle_approved',
    actorId: context.actorId,
    actorType: body.actorType || 'user',
    idempotencyKey: body.idempotencyKey || `execution-contract-artifacts-approve:${taskId}:${artifactBundle.bundle_id}`,
    occurredAt: approvedAt,
    payload: {
      version: artifactBundle.contract_version,
      bundle_id: artifactBundle.bundle_id,
      artifact_bundle: artifactBundle,
      approval_summary: artifactBundle.approval_summary,
      commit_policy: artifactBundle.commit_policy,
      waiting_state: 'artifact_bundle_commit_ready',
      next_required_action: ARTIFACT_BUNDLE_APPROVED_ACTION,
    },
    source,
  });
  return { result, artifactBundle };
}

function createAuditApiServer(options = {}) {
  const store = options.store || createAuditStore(options);
  const logger = options.logger || createAuditLogger(options.baseDir || process.cwd());
  const jwtVerifier = options.jwtVerifier || createJwtVerifier({
    secret: options.jwtSecret || process.env.AUTH_JWT_SECRET,
    issuer: options.jwtIssuer || process.env.AUTH_JWT_ISSUER,
    audience: options.jwtAudience || process.env.AUTH_JWT_AUDIENCE,
    jwks: options.jwtJwks,
    jwksUrl: options.jwtJwksUrl || process.env.AUTH_JWT_JWKS_URL,
    jwksCacheMs: Number.parseInt(options.jwtJwksCacheMs || process.env.AUTH_JWT_JWKS_CACHE_MS || '', 10),
  });
  const internalBrowserAuthEnabled = parseBooleanOption(
    options.enableInternalBrowserAuthBootstrap ?? process.env.AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP,
    isLocalLikeEnvironment(options),
  );
  const runtimeOptions = {
    ...options,
    jwtVerifier,
    enableInternalBrowserAuthBootstrap: internalBrowserAuthEnabled,
  };
  runtimeOptions.authService = options.authService || createMagicLinkAuthService({
    pool: options.pool,
    connectionString: options.connectionString,
    publicAppUrl: options.publicAppUrl,
    runtimeEnv: options.runtimeEnv,
    sessionSecret: options.sessionSecret,
    emailTransport: options.emailTransport,
  });
  const agentRegistry = resolveAgentRegistry(options);
  const taskPlatform = options.taskPlatform || createTaskPlatformService({
    baseDir: options.baseDir || process.cwd(),
    pool: options.pool,
    connectionString: options.connectionString,
    agentRegistry,
    defaultTenantId: 'engineering-team',
  });
  const server = http.createServer(async (req, res) => {
    const requestId = req.headers['x-request-id'] || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`);
    const startedAt = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const routePath = normalizeRoutePath(url.pathname);

    try {
      if (routePath === '/healthz') {
        return sendJson(res, 200, { ok: true, backend: store.kind, ff_audit_foundation: isAuditFoundationEnabled(options) }, requestId);
      }

      if (routePath === '/health/task-assignment' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'metrics:read');
        const featureState = getAssignmentFeatureState(runtimeOptions);
        const activeAgents = agentRegistry.filter((agent) => agent.active);
        return sendJson(res, 200, {
          ok: featureState.enabled && !featureState.killed && activeAgents.length > 0,
          feature: {
            flag: 'ff_assign_ai_agent_to_task',
            enabled: featureState.enabled,
            kill_switch_flag: 'ff_assign_ai_agent_to_task_killswitch',
            killed: featureState.killed,
          },
          dependencies: {
            agent_registry_active_count: activeAgents.length,
            backend: store.kind,
          },
        }, requestId);
      }

      if (routePath === '/internal/smoke-test/task-assignment' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'metrics:read');
        assertTaskAssignmentEnabled(runtimeOptions);
        assertTaskAssignmentNotKilled(runtimeOptions);
        const activeAgents = agentRegistry.filter((agent) => agent.active);
        if (!activeAgents.length) {
          throw createAssignmentError(503, 'smoke_failed', 'Task assignment smoke test failed: no active agents are assignable', { active_agent_count: 0 });
        }
        return sendJson(res, 200, {
          ok: true,
          checks: [
            { name: 'feature_flag', ok: true },
            { name: 'kill_switch', ok: true },
            { name: 'active_agent_registry', ok: true, count: activeAgents.length },
          ],
        }, requestId);
      }

      if (routePath === '/github/webhooks' && req.method === 'POST') {
        assertGitHubSyncEnabled(runtimeOptions);
        const rawBody = await parseRawBody(req);
        try {
          verifyGitHubWebhookSignature(
            rawBody,
            req.headers['x-hub-signature-256'],
            runtimeOptions.githubWebhookSecret || process.env.GITHUB_WEBHOOK_SECRET,
          );
        } catch (error) {
          throw createHttpError(401, 'invalid_github_signature', error.message);
        }

        const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        const eventName = String(req.headers['x-github-event'] || '').trim();
        const deliveryId = String(req.headers['x-github-delivery'] || crypto.createHash('sha256').update(rawBody).digest('hex')).trim();
        const isPullRequestComment = eventName === 'issue_comment' && payload.issue?.pull_request;
        if (!['pull_request', 'issue_comment'].includes(eventName) || (eventName === 'issue_comment' && !isPullRequestComment)) {
          return sendJson(res, 202, { received: true, ignored: true, reason: 'unsupported_event', event: eventName || null }, requestId);
        }

        const taskIds = inferTaskIdsFromWebhook(eventName, payload);
        const pr = normalizeWebhookPr(payload);
        const taskRefs = await resolveWebhookTaskRefs(store, taskIds, pr);
        if (!pr || !taskRefs.length) {
          return sendJson(res, 202, { received: true, ignored: true, reason: 'no_linked_task', event: eventName || null, deliveryId }, requestId);
        }

        const eventType = isPullRequestComment ? 'task.github_pr_comment_recorded' : 'task.github_pr_synced';
        const action = String(payload.action || '').trim() || 'unknown';
        for (const { taskId, tenantId } of taskRefs) {
          await store.appendEvent({
            taskId,
            tenantId,
            eventType,
            actorId: `github:${payload.sender?.login || 'webhook'}`,
            actorType: 'system',
            idempotencyKey: `github:${deliveryId}:${eventName}:${taskId}`,
            payload: {
              delivery_id: deliveryId,
              github_event: eventName,
              github_action: action,
              linked_pr: { ...pr, task_id: taskId },
              comment_body: payload.comment?.body || null,
              comment_url: payload.comment?.html_url || null,
              sync_status: 'ok',
            },
            source: 'github-webhook',
          });
        }

        logger.info({
          feature: 'ff_github_sync',
          action: 'github_webhook_processed',
          outcome: 'success',
          request_id: requestId,
          delivery_id: deliveryId,
          github_event: eventName,
          github_action: action,
          matched_task_count: taskRefs.length,
          duration_ms: Date.now() - startedAt,
        });
        return sendJson(res, 202, {
          received: true,
          deliveryId,
          event: eventName,
          action,
          matchedTaskIds: taskRefs.map((ref) => ref.taskId),
          matchedTasks: taskRefs,
        }, requestId);
      }

      if (routePath === '/auth/session' && req.method === 'POST') {
        if (!runtimeOptions.enableInternalBrowserAuthBootstrap) {
          throw createHttpError(404, 'internal_browser_auth_disabled', 'Internal browser auth bootstrap is disabled in this environment.');
        }
        const body = await parseJson(req);
        const { actorId, tenantId, roles } = requireTrustedBrowserAuthCode(body.authCode, runtimeOptions);
        const sessionSigningSecret = runtimeOptions.jwtSecret || process.env.AUTH_JWT_SECRET;
        if (!sessionSigningSecret) {
          throw createHttpError(501, 'browser_session_not_supported', 'Browser session bootstrap requires AUTH_JWT_SECRET or jwtSecret to sign compatibility tokens.');
        }
        const expiresAt = new Date(Date.now() + BROWSER_SESSION_TTL_SECONDS * 1000).toISOString();
        const claims = {
          sub: actorId,
          tenant_id: tenantId,
          roles,
          exp: Math.floor(Date.parse(expiresAt) / 1000),
        };
        const jwtIssuer = runtimeOptions.jwtIssuer || process.env.AUTH_JWT_ISSUER;
        const jwtAudience = runtimeOptions.jwtAudience || process.env.AUTH_JWT_AUDIENCE;
        if (jwtIssuer) claims.iss = jwtIssuer;
        if (jwtAudience) claims.aud = jwtAudience;

        return sendJson(res, 200, {
          success: true,
          data: {
            accessToken: signHmacJwt(claims, sessionSigningSecret),
            expiresAt,
            claims: {
              tenant_id: tenantId,
              actor_id: actorId,
              roles,
            },
          },
        }, requestId);
      }

      if (routePath === '/auth/magic-link/request' && req.method === 'POST') {
        const body = await parseJson(req);
        const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
        const result = await runtimeOptions.authService.requestMagicLink({
          email: body.email,
          next: body.next,
          ip,
        });
        return sendJson(res, 200, result, requestId);
      }

      if (routePath === '/auth/magic-link/consume' && req.method === 'GET') {
        try {
          const result = await runtimeOptions.authService.consumeMagicLink({
            token: url.searchParams.get('token'),
            next: url.searchParams.get('next'),
          });
          return sendRedirect(res, 302, result.next || '/tasks', requestId, {
            'set-cookie': runtimeOptions.authService.buildSessionCookies(result.sessionToken, result.csrfToken, result.expiresAt),
          });
        } catch (error) {
          const reason = encodeURIComponent(error.code || 'magic_link_failed');
          return sendRedirect(res, 302, `/sign-in?reason=${reason}`, requestId);
        }
      }

      if (routePath === '/auth/me' && req.method === 'GET') {
        const context = await getRequestContext(req, runtimeOptions);
        if (!context?.tenantId || !context?.actorId) {
          throw createHttpError(401, 'missing_auth_context', 'A browser session is required.');
        }
        return sendJson(res, 200, {
          data: {
            actorId: context.actorId,
            tenantId: context.tenantId,
            roles: context.roles || [],
            authType: context.authType,
            expiresAt: context.session?.expiresAt || null,
          },
        }, requestId);
      }

      if (routePath === '/auth/logout' && req.method === 'POST') {
        const context = await requireTenantAccess(req, runtimeOptions);
        if (context.authType === 'cookie-session') {
          await runtimeOptions.authService.revokeSession(req);
        }
        return sendJson(res, 200, { success: true }, requestId, {
          'set-cookie': runtimeOptions.authService.buildClearCookies(),
        });
      }

      if (routePath === '/auth/users' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        if (!hasAnyRole(context, ['admin'])) throw createHttpError(403, 'forbidden', 'Admin role is required to manage users.');
        return sendJson(res, 200, { data: await runtimeOptions.authService.listUsers() }, requestId);
      }

      if (routePath === '/auth/users' && req.method === 'POST') {
        const context = await requireTenantAccess(req, runtimeOptions);
        if (!hasAnyRole(context, ['admin'])) throw createHttpError(403, 'forbidden', 'Admin role is required to manage users.');
        const body = await parseJson(req);
        const existing = (await runtimeOptions.authService.listUsers()).find((user) => user.email === String(body.email || '').trim().toLowerCase());
        const nextRoles = Array.isArray(body.roles) ? body.roles : String(body.roles || '').split(',').map((role) => role.trim()).filter(Boolean);
        const nextStatus = body.status || existing?.status || 'active';
        if (existing?.actorId === context.actorId && (String(nextStatus).toLowerCase() === 'disabled' || !nextRoles.includes('admin'))) {
          throw createHttpError(400, 'self_admin_protection', 'Admins cannot disable their own account or remove their own admin role.');
        }
        const user = await runtimeOptions.authService.upsertUser({
          email: body.email,
          tenantId: body.tenantId,
          actorId: body.actorId,
          roles: nextRoles,
          status: nextStatus,
        }, context);
        return sendJson(res, 200, { data: user }, requestId);
      }

      const authUserMatch = routePath.match(/^\/auth\/users\/([^/]+)$/);
      if (authUserMatch && req.method === 'PATCH') {
        const context = await requireTenantAccess(req, runtimeOptions);
        if (!hasAnyRole(context, ['admin'])) throw createHttpError(403, 'forbidden', 'Admin role is required to manage users.');
        const existing = (await runtimeOptions.authService.listUsers()).find((user) => user.userId === authUserMatch[1]);
        if (!existing) throw createHttpError(404, 'auth_user_not_found', 'Auth user not found.');
        const body = await parseJson(req);
        const nextRoles = Array.isArray(body.roles)
          ? body.roles
          : body.roles == null
            ? existing.roles
            : String(body.roles || '').split(',').map((role) => role.trim()).filter(Boolean);
        const nextStatus = body.status ?? existing.status;
        if (existing.actorId === context.actorId && (String(nextStatus).toLowerCase() === 'disabled' || !nextRoles.includes('admin'))) {
          throw createHttpError(400, 'self_admin_protection', 'Admins cannot disable their own account or remove their own admin role.');
        }
        const user = await runtimeOptions.authService.upsertUser({
          email: existing.email,
          tenantId: body.tenantId ?? existing.tenantId,
          actorId: body.actorId ?? existing.actorId,
          roles: nextRoles,
          status: nextStatus,
        }, context);
        return sendJson(res, 200, { data: user }, requestId);
      }

      if (routePath === '/v1/ai-agents' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'agents:read');
        const items = await withErrorHandling(async () => taskPlatform.listAiAgents({
          tenantId: context.tenantId,
          includeInactive: url.searchParams.get('includeInactive') === 'true',
        }))();
        return sendJson(res, 200, { data: items }, requestId);
      }

      if (routePath === '/v1/tasks' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'state:read');
        const data = await withErrorHandling(async () => taskPlatform.listTasks({
          tenantId: context.tenantId,
          ownerAgentId: url.searchParams.has('ownerAgentId') ? url.searchParams.get('ownerAgentId') : undefined,
          status: url.searchParams.has('status') ? url.searchParams.get('status') : undefined,
        }))();
        return sendJson(res, 200, { data }, requestId);
      }

      if (routePath === '/v1/tasks' && req.method === 'POST') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'tasks:create');
        const body = validateTaskPlatformCreateRequest(await parseJson(req));
        const result = await withErrorHandling(async () => taskPlatform.createTask({
          tenantId: context.tenantId,
          actorId: context.actorId,
          title: body.title,
          description: body.description,
          status: body.status,
          priority: body.priority,
          ownerAgentId: body.ownerAgentId ?? null,
          idempotencyKey: body.idempotencyKey || null,
          requestId,
        }))();
        await store.appendEvent({
          taskId: result.taskId,
          tenantId: context.tenantId,
          eventType: 'task.created',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: body.idempotencyKey || `v1-create:${result.taskId}`,
          payload: {
            title: result.title,
            priority: result.priority,
            assignee: result.owner?.agentId || null,
            initial_stage: result.status,
          },
          source: 'task-platform-http',
        });
        return sendJson(res, 201, { data: result }, requestId);
      }

      const v1TaskMatch = routePath.match(/^\/v1\/tasks\/([^/]+)$/);
      const v1TaskOwnerMatch = routePath.match(/^\/v1\/tasks\/([^/]+)\/owner$/);

      if (v1TaskMatch && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'state:read');
        const data = await withErrorHandling(async () => taskPlatform.getTask({
          tenantId: context.tenantId,
          taskId: v1TaskMatch[1],
        }))();
        if (!data) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: v1TaskMatch[1] });
        return sendJson(res, 200, { data }, requestId);
      }

      if (v1TaskMatch && req.method === 'PATCH') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'events:write');
        const body = validateTaskPlatformUpdateRequest(await parseJson(req));
        const data = await withErrorHandling(async () => taskPlatform.updateTask({
          tenantId: context.tenantId,
          taskId: v1TaskMatch[1],
          actorId: context.actorId,
          version: body.version,
          title: body.title,
          description: body.description,
          status: body.status,
          priority: body.priority,
          idempotencyKey: body.idempotencyKey || null,
          requestId,
        }))();
        return sendJson(res, 200, { data }, requestId);
      }

      if (v1TaskOwnerMatch && req.method === 'PATCH') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'assignment:write');
        const body = validateTaskPlatformOwnerRequest(await parseJson(req));
        const data = await withErrorHandling(async () => taskPlatform.updateTaskOwner({
          tenantId: context.tenantId,
          taskId: v1TaskOwnerMatch[1],
          actorId: context.actorId,
          version: body.version,
          ownerAgentId: body.ownerAgentId ?? null,
          idempotencyKey: body.idempotencyKey || null,
          requestId,
        }))();
        await store.appendEvent({
          taskId: data.taskId,
          tenantId: context.tenantId,
          eventType: data.owner ? 'task.assigned' : 'task.unassigned',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: body.idempotencyKey || `v1-owner:${data.taskId}:${data.version}`,
          payload: data.owner ? { assignee: data.owner.agentId } : { previous_assignee: null },
          source: 'task-platform-http',
        });
        return sendJson(res, 200, { data }, requestId);
      }

      if (!isAuditFoundationEnabled(runtimeOptions)) {
        throw createHttpError(503, 'feature_disabled', 'Audit foundation is disabled by ff_audit_foundation', { feature: 'ff_audit_foundation' });
      }

      if (routePath === '/metrics' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'metrics:read');
        const metrics = store.readMetrics ? await store.readMetrics() : {};
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'metrics', duration_ms: Date.now() - startedAt });
        return sendText(res, 200, toPrometheus(metrics), requestId);
      }

      if (routePath === '/projections/process' && req.method === 'POST') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'projections:rebuild');
        if (!store.processProjectionQueue) throw createHttpError(501, 'not_supported', 'Projection processing is not supported by this store');
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'projection_queue', limit: Number(url.searchParams.get('limit') || 100), duration_ms: Date.now() - startedAt });
        return sendJson(res, 202, await store.processProjectionQueue(Number(url.searchParams.get('limit') || 100)), requestId);
      }

      if (routePath === '/ai-agents' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'agents:read');
        assertTaskAssignmentEnabled(runtimeOptions);
        assertTaskAssignmentNotKilled(runtimeOptions);
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'ai_agents', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, { items: agentRegistry.filter(agent => agent.active) }, requestId);
      }

      if (routePath === '/tasks' && req.method === 'POST') {
        assertTaskCreationEnabled(runtimeOptions);
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'tasks:create');
        const body = normalizeTaskCreateBody(await parseJson(req));

        const taskId = `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const idempotencyKey = body.idempotencyKey || `create:${taskId}`;
        const isIntakeDraft = body.mode === 'intake';
        if (isIntakeDraft) assertIntakeDraftCreationEnabled(runtimeOptions);

        const { created, createdTaskId, refinementRequested } = await persistTaskCreation({
          store,
          taskPlatform,
          context,
          body,
          taskId,
          idempotencyKey,
          isIntakeDraft,
          requestId,
        });

        logger.info({
          feature: 'ff_task_creation',
          action: isIntakeDraft ? 'intake_draft_created' : 'task_created',
          outcome: 'success',
          request_id: requestId,
          task_id: createdTaskId,
          tenant_id: context.tenantId,
          actor_id: context.actorId,
          duration_ms: Date.now() - startedAt,
        });

        return sendJson(res, 201, {
          taskId: createdTaskId,
          status: 'DRAFT',
          intakeDraft: isIntakeDraft,
          nextRequiredAction: isIntakeDraft ? PM_REFINEMENT_REQUIRED_ACTION : null,
          refinementEventId: refinementRequested?.event?.event_id || null,
          createdAt: created.event.occurred_at,
        }, requestId);
      }
      if (routePath === '/tasks' && req.method === 'GET') {
        const context = await requireTenantAccess(req, runtimeOptions);
        requirePermission(context, 'state:read');
        if (typeof store.listTaskSummaries !== 'function') {
          throw createHttpError(501, 'not_supported', 'Task list summaries are not supported by this store');
        }
        const items = await store.listTaskSummaries({ tenantId: context.tenantId });
        const enrichedItems = await Promise.all(items.map(async (item) => {
          const [state, relationships, telemetry, initialHistory] = await Promise.all([
            store.getTaskCurrentState(item.task_id, { tenantId: context.tenantId }),
            typeof store.getTaskRelationships === 'function' ? store.getTaskRelationships(item.task_id, { tenantId: context.tenantId }) : Promise.resolve({}),
            typeof store.getTaskObservabilitySummary === 'function' ? store.getTaskObservabilitySummary(item.task_id, { tenantId: context.tenantId }) : Promise.resolve(null),
            typeof store.getTaskHistory === 'function' ? store.getTaskHistory(item.task_id, { tenantId: context.tenantId, limit: 500 }) : Promise.resolve([]),
          ]);
          const finalSummary = summarizeTaskForDetail(item.task_id, state || item, initialHistory);
          const monitoring = deriveSreMonitoringProjection({
            taskId: item.task_id,
            summary: finalSummary,
            history: initialHistory,
            relationships,
            telemetry,
          });
          const relationshipChildIds = Array.isArray(relationships?.child_task_ids) ? relationships.child_task_ids : [];
          const childTaskSummaries = relationshipChildIds
            .map((childTaskId) => items.find((candidate) => candidate.task_id === childTaskId))
            .filter(Boolean);
          const linkedPrs = collectLinkedPrs(initialHistory, relationships, item.task_id);
          const closeGovernance = deriveCloseGovernanceProjection({
            summary: finalSummary,
            history: initialHistory,
            linkedPrs,
            childTaskSummaries,
            sreMonitoring: monitoring,
            options: runtimeOptions,
          });
          return {
            ...summarizeTaskForList(finalSummary),
            monitoring,
            close_governance: closeGovernance,
          };
        }));
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'task_list', result_count: items.length, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, { items: enrichedItems }, requestId);
      }

      const summaryMatch = routePath.match(/^\/tasks\/([^/]+)$/);
      const assignmentMatch = routePath.match(/^\/tasks\/([^/]+)\/assignment$/);
      const lockMatch = routePath.match(/^\/tasks\/([^/]+)\/lock$/);
      const skillEscalationMatch = routePath.match(/^\/tasks\/([^/]+)\/skill-escalation$/);
      const checkInsMatch = routePath.match(/^\/tasks\/([^/]+)\/check-ins$/);
      const retierMatch = routePath.match(/^\/tasks\/([^/]+)\/retier$/);
      const reassignmentMatch = routePath.match(/^\/tasks\/([^/]+)\/reassignment$/);
      const sreMonitoringMatch = routePath.match(/^\/tasks\/([^/]+)\/sre-monitoring\/(start|approve|anomaly-child-task)$/);
      const pmBusinessContextMatch = routePath.match(/^\/tasks\/([^/]+)\/pm-business-context$/);
      const closeReviewCancellationMatch = routePath.match(/^\/tasks\/([^/]+)\/close-review\/cancellation-recommendation$/);
      const closeReviewExceptionalDisputeMatch = routePath.match(/^\/tasks\/([^/]+)\/close-review\/exceptional-dispute$/);
      const closeReviewHumanDecisionMatch = routePath.match(/^\/tasks\/([^/]+)\/close-review\/human-decision$/);
      const closeReviewBacktrackMatch = routePath.match(/^\/tasks\/([^/]+)\/close-review\/backtrack$/);
      const architectHandoffMatch = routePath.match(/^\/tasks\/([^/]+)\/architect-handoff$/);
      const engineerSubmissionMatch = routePath.match(/^\/tasks\/([^/]+)\/engineer-submission$/);
      const executionContractMatch = routePath.match(/^\/tasks\/([^/]+)\/execution-contract(?:\/(validate|markdown|approve|artifacts|verification-report)(?:\/(approve))?)?$/);
      const orchestrationMatch = routePath.match(/^\/tasks\/([^/]+)\/orchestration$/);
      const workflowThreadsMatch = routePath.match(/^\/tasks\/([^/]+)\/workflow-threads$/);
      const workflowThreadActionMatch = routePath.match(/^\/tasks\/([^/]+)\/workflow-threads\/([^/]+)\/(replies|resolve|reopen)$/);
      const qaResultsMatch = routePath.match(/^\/tasks\/([^/]+)\/qa-results$/);
      const reviewQuestionsMatch = routePath.match(/^\/tasks\/([^/]+)\/review-questions$/);
      const reviewQuestionActionMatch = routePath.match(/^\/tasks\/([^/]+)\/review-questions\/([^/]+)\/(answers|resolve|reopen)$/);
      const resourceMatch = routePath.match(/^\/tasks\/([^/]+)\/(detail|events|history|state|relationships|observability-summary)$/);
      if (!summaryMatch && !resourceMatch && !assignmentMatch && !lockMatch && !skillEscalationMatch && !checkInsMatch && !retierMatch && !reassignmentMatch && !sreMonitoringMatch && !pmBusinessContextMatch && !closeReviewCancellationMatch && !closeReviewExceptionalDisputeMatch && !closeReviewHumanDecisionMatch && !closeReviewBacktrackMatch && !architectHandoffMatch && !engineerSubmissionMatch && !executionContractMatch && !orchestrationMatch && !workflowThreadsMatch && !workflowThreadActionMatch && !qaResultsMatch && !reviewQuestionsMatch && !reviewQuestionActionMatch) throw createHttpError(404, 'not_found', 'Route not found');
      const taskId = (summaryMatch || resourceMatch || assignmentMatch || lockMatch || skillEscalationMatch || checkInsMatch || retierMatch || reassignmentMatch || sreMonitoringMatch || pmBusinessContextMatch || closeReviewCancellationMatch || closeReviewExceptionalDisputeMatch || closeReviewHumanDecisionMatch || closeReviewBacktrackMatch || architectHandoffMatch || engineerSubmissionMatch || executionContractMatch || orchestrationMatch || workflowThreadsMatch || workflowThreadActionMatch || qaResultsMatch || reviewQuestionsMatch || reviewQuestionActionMatch)[1];
      const resource = assignmentMatch
        ? 'assignment'
        : lockMatch
          ? 'lock'
        : skillEscalationMatch
          ? 'skill-escalation'
        : checkInsMatch
          ? 'check-ins'
        : retierMatch
          ? 'retier'
        : reassignmentMatch
          ? 'reassignment'
          : sreMonitoringMatch
            ? `sre-monitoring:${sreMonitoringMatch[2]}`
        : pmBusinessContextMatch
          ? 'pm-business-context'
          : closeReviewCancellationMatch
            ? 'close-review:cancellation-recommendation'
            : closeReviewExceptionalDisputeMatch
              ? 'close-review:exceptional-dispute'
            : closeReviewHumanDecisionMatch
              ? 'close-review:human-decision'
              : closeReviewBacktrackMatch
                ? 'close-review:backtrack'
          : architectHandoffMatch
            ? 'architect-handoff'
        : engineerSubmissionMatch
          ? 'engineer-submission'
        : executionContractMatch
          ? `execution-contract${executionContractMatch[2] ? `:${executionContractMatch[2]}` : ''}${executionContractMatch[3] ? `:${executionContractMatch[3]}` : ''}`
        : orchestrationMatch
          ? 'orchestration'
        : workflowThreadsMatch
          ? 'workflow-threads'
        : workflowThreadActionMatch
          ? `workflow-thread-${workflowThreadActionMatch[3]}`
        : qaResultsMatch
          ? 'qa-results'
        : reviewQuestionsMatch
          ? 'review-questions'
          : reviewQuestionActionMatch
            ? `review-question-${reviewQuestionActionMatch[3]}`
            : resourceMatch
              ? resourceMatch[2]
              : 'summary';
      const questionId = reviewQuestionActionMatch ? reviewQuestionActionMatch[2] : null;
      const workflowThreadId = workflowThreadActionMatch ? workflowThreadActionMatch[2] : null;
      const context = await requireTenantAccess(req, runtimeOptions);

      if (resource === 'execution-contract' && req.method === 'GET') {
        assertExecutionContractsEnabled(runtimeOptions);
        requirePermission(context, 'state:read');
        const { projection } = await loadExecutionContractContext(store, taskId, context.tenantId);
        if (!projection.latest) {
          throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', { task_id: taskId });
        }
        return sendJson(res, 200, { success: true, data: projection }, requestId);
      }
      if (resource === 'execution-contract' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canManageExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may manage Execution Contracts.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, contract, materialChange, previousVersion } = await recordExecutionContractVersion({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_version_recorded' });
        return sendJson(res, result.duplicate ? 200 : 201, {
          success: true,
          data: {
            taskId,
            version: contract.version,
            previousVersion,
            materialChange,
            templateTier: contract.template_tier,
            status: contract.status,
            validation: contract.validation,
            contract,
            recordedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'execution-contract:validate' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canManageExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may validate Execution Contracts.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, validation, contract } = await validateLatestExecutionContract({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_validated' });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            version: contract.version,
            validation,
            validatedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'execution-contract:markdown' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canManageExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may generate Execution Contract Markdown.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, validation, contract, markdown } = await generateExecutionContractMarkdown({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_markdown_generated' });
        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            version: contract.version,
            validation,
            authoritative: false,
            markdown,
            generatedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'execution-contract:markdown' && req.method === 'GET') {
        assertExecutionContractsEnabled(runtimeOptions);
        requirePermission(context, 'state:read');
        const { projection } = await loadExecutionContractContext(store, taskId, context.tenantId);
        if (!projection.markdown) {
          throw createHttpError(404, 'execution_contract_markdown_not_found', 'No generated Markdown story exists for the latest Execution Contract version.', { task_id: taskId });
        }
        return sendJson(res, 200, { success: true, data: projection.markdown }, requestId);
      }
      if (resource === 'execution-contract:verification-report' && req.method === 'GET') {
        assertExecutionContractsEnabled(runtimeOptions);
        requirePermission(context, 'state:read');
        const { projection } = await loadExecutionContractContext(store, taskId, context.tenantId);
        if (!projection.verificationReport) {
          throw createHttpError(404, 'execution_contract_verification_report_not_found', 'No verification report skeleton exists for the latest Execution Contract version.', { task_id: taskId });
        }
        return sendJson(res, 200, { success: true, data: projection.verificationReport }, requestId);
      }
      if (resource === 'execution-contract:verification-report' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canManageExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may generate Execution Contract verification report skeletons.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, verificationReport, dispatchGate } = await generateExecutionContractVerificationReportSkeleton({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_verification_report_generated' });
        return sendJson(res, result.duplicate ? 200 : 201, {
          success: true,
          data: {
            taskId,
            version: verificationReport.contract_version,
            reportId: verificationReport.report_id,
            status: verificationReport.status,
            path: verificationReport.path,
            required: verificationReport.required,
            requiredEvidence: verificationReport.required_evidence,
            links: verificationReport.links,
            dispatchGate,
            verificationReport,
            generatedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'execution-contract:artifacts' && req.method === 'GET') {
        assertExecutionContractsEnabled(runtimeOptions);
        requirePermission(context, 'state:read');
        const { projection } = await loadExecutionContractContext(store, taskId, context.tenantId);
        if (!projection.artifacts) {
          throw createHttpError(404, 'execution_contract_artifact_bundle_not_found', 'No generated artifact bundle exists for the latest Execution Contract version.', { task_id: taskId });
        }
        return sendJson(res, 200, { success: true, data: projection.artifacts }, requestId);
      }
      if (resource === 'execution-contract:artifacts' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canManageExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may generate Execution Contract repo artifact bundles.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, artifactBundle } = await generateExecutionContractArtifactBundle({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_artifact_bundle_generated' });
        return sendJson(res, result.duplicate ? 200 : 201, {
          success: true,
          data: {
            taskId,
            version: artifactBundle.contract_version,
            bundleId: artifactBundle.bundle_id,
            status: artifactBundle.status,
            displayId: artifactBundle.display_id,
            slug: artifactBundle.slug,
            generatedArtifacts: artifactBundle.generated_artifacts,
            links: artifactBundle.links,
            prGuidance: artifactBundle.pr_guidance,
            approvalRouting: artifactBundle.approval_routing,
            approvalSummary: artifactBundle.approval_summary,
            commitPolicy: artifactBundle.commit_policy,
            artifactBundle,
            generatedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'execution-contract:artifacts:approve' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canApproveExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only stakeholder, PM, or admin may approve Execution Contract repo artifact bundles.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, artifactBundle } = await approveLatestExecutionContractArtifactBundle({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_artifact_bundle_approved' });
        return sendJson(res, result.duplicate ? 200 : 201, {
          success: true,
          data: {
            taskId,
            version: artifactBundle.contract_version,
            bundleId: artifactBundle.bundle_id,
            status: artifactBundle.status,
            displayId: artifactBundle.display_id,
            links: artifactBundle.links,
            prGuidance: artifactBundle.pr_guidance,
            approvalSummary: artifactBundle.approval_summary,
            commitPolicy: artifactBundle.commit_policy,
            artifactBundle,
            approvedAt: result.event.occurred_at,
            approvedBy: context.actorId,
          },
        }, requestId);
      }
      if (resource === 'execution-contract:approve' && req.method === 'POST') {
        assertExecutionContractsEnabled(runtimeOptions);
        if (!canApproveExecutionContracts(context)) throw createHttpError(403, 'forbidden', 'Only stakeholder, PM, or admin may approve Execution Contracts.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const { result, validation, contract, committedScope, approvalSummary } = await approveLatestExecutionContract({
          store,
          taskId,
          tenantId: context.tenantId,
          context,
          body,
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'execution_contract_approved' });
        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            version: contract.version,
            status: 'approved',
            validation,
            committedScope,
            approvalSummary,
            approvedAt: result.event.occurred_at,
            approvedBy: context.actorId,
          },
        }, requestId);
      }

      if (resource === 'lock' && req.method === 'GET') {
        assertTaskLockingEnabled(runtimeOptions);
        requireMutationPermission(context);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        return sendJson(res, 200, { lock: getActiveTaskLock(state) }, requestId);
      }
      if (resource === 'lock' && req.method === 'POST') {
        assertTaskLockingEnabled(runtimeOptions);
        requireMutationPermission(context);
        const body = await parseJson(req);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const activeLock = getActiveTaskLock(state);
        if (activeLock && activeLock.ownerId !== context.actorId) {
          try {
            await store.appendEvent({
              taskId,
              tenantId: context.tenantId,
              eventType: 'task.lock_conflict',
              actorId: context.actorId,
              actorType: body.actorType || 'user',
              idempotencyKey: body.idempotencyKey || `lock-conflict:${taskId}:${context.actorId}:${state.last_event_id || 'initial'}`,
              payload: {
                requested_by: context.actorId,
                blocking_owner_id: activeLock.ownerId,
                lock_expires_at: activeLock.expiresAt,
              },
              source: body.source || 'http',
            });
          } catch {}
          throw buildLockError(activeLock);
        }

        const payload = createTaskLockPayload({
          actorId: context.actorId,
          reason: body.reason,
          action: body.action,
          ttlSeconds: body.ttlSeconds,
        });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.lock_acquired',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `lock-acquire:${taskId}:${context.actorId}:${payload.expires_at}`,
          payload,
          source: body.source || 'http',
        });
        return sendJson(res, 200, { success: true, data: { lock: getActiveTaskLock({ ...state, lock_owner: payload.owner_id, lock_acquired_at: payload.acquired_at, lock_expires_at: payload.expires_at, lock_reason: payload.reason, lock_action: payload.action }), updatedAt: result.event.occurred_at } }, requestId);
      }
      if (resource === 'lock' && req.method === 'DELETE') {
        assertTaskLockingEnabled(runtimeOptions);
        requireMutationPermission(context);
        const body = await parseJson(req).catch(() => ({}));
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const activeLock = getActiveTaskLock(state);
        if (!activeLock) {
          return sendJson(res, 200, { success: true, data: { released: false, reason: 'no_active_lock' } }, requestId);
        }
        if (activeLock.ownerId !== context.actorId && !hasAnyRole(context, ['admin'])) {
          throw createHttpError(403, 'forbidden', 'Only the lock holder or admin may release the active task lock.');
        }
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.lock_released',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `lock-release:${taskId}:${context.actorId}:${state.last_event_id || 'initial'}`,
          payload: {
            owner_id: activeLock.ownerId,
            released_by: context.actorId,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 200, { success: true, data: { released: true, updatedAt: result.event.occurred_at } }, requestId);
      }

      if (resource === 'workflow-threads' && req.method === 'GET') {
        assertStructuredCommentsEnabled(runtimeOptions);
        requirePermission(context, 'history:read');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        return sendJson(res, 200, deriveWorkflowThreads(history), requestId);
      }
      if (resource === 'workflow-threads' && req.method === 'POST') {
        assertStructuredCommentsEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const normalized = validateWorkflowThreadBody(body);
        const threadId = `wt-${crypto.randomUUID().slice(0, 8)}`;
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_created',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread:${taskId}:${threadId}`,
          payload: {
            thread_id: threadId,
            ...normalized,
            state: WORKFLOW_THREAD_STATES.OPEN,
            blocked: normalized.blocking,
            waiting_state: normalized.blocking ? 'workflow_thread_resolution' : null,
            next_required_action: normalized.blocking ? `Resolve blocking ${normalized.comment_type} thread.` : null,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 201, { threadId, eventId: result.event.event_id, occurredAt: result.event.occurred_at }, requestId);
      }
      if (resource === 'workflow-thread-replies' && req.method === 'POST') {
        assertStructuredCommentsEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const replyText = validateWorkflowThreadReplyBody(body, 'Reply');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const thread = deriveWorkflowThreads(history).items.find((item) => item.id === workflowThreadId);
        if (!thread) throw createHttpError(404, 'workflow_thread_not_found', 'Workflow thread not found.', { thread_id: workflowThreadId });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_reply_added',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread-reply:${taskId}:${workflowThreadId}:${history[0]?.event_id || 'initial'}`,
          payload: {
            thread_id: workflowThreadId,
            comment_type: thread.commentType,
            blocking: thread.blocking,
            body: replyText,
            linked_event_id: thread.linkedEventId,
            notification_targets: thread.notificationTargets,
            waiting_state: thread.blocking && thread.state !== WORKFLOW_THREAD_STATES.RESOLVED ? 'workflow_thread_resolution' : null,
            next_required_action: thread.blocking && thread.state !== WORKFLOW_THREAD_STATES.RESOLVED ? `Resolve blocking ${thread.commentType} thread.` : null,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'workflow-thread-resolve' && req.method === 'POST') {
        assertStructuredCommentsEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const resolutionText = validateWorkflowThreadReplyBody(body, 'Resolution');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const thread = deriveWorkflowThreads(history).items.find((item) => item.id === workflowThreadId);
        if (!thread) throw createHttpError(404, 'workflow_thread_not_found', 'Workflow thread not found.', { thread_id: workflowThreadId });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_resolved',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread-resolve:${taskId}:${workflowThreadId}:${history[0]?.event_id || 'initial'}`,
          payload: {
            thread_id: workflowThreadId,
            comment_type: thread.commentType,
            blocking: thread.blocking,
            resolution: resolutionText,
            body: resolutionText,
            linked_event_id: thread.linkedEventId,
            notification_targets: thread.notificationTargets,
            waiting_state: null,
            next_required_action: null,
            blocked: false,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'workflow-thread-reopen' && req.method === 'POST') {
        assertStructuredCommentsEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const reopenText = validateWorkflowThreadReplyBody(body, 'Reopen');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const thread = deriveWorkflowThreads(history).items.find((item) => item.id === workflowThreadId);
        if (!thread) throw createHttpError(404, 'workflow_thread_not_found', 'Workflow thread not found.', { thread_id: workflowThreadId });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_reopened',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread-reopen:${taskId}:${workflowThreadId}:${history[0]?.event_id || 'initial'}`,
          payload: {
            thread_id: workflowThreadId,
            comment_type: thread.commentType,
            blocking: thread.blocking,
            body: reopenText,
            linked_event_id: thread.linkedEventId,
            notification_targets: thread.notificationTargets,
            waiting_state: thread.blocking ? 'workflow_thread_resolution' : null,
            next_required_action: thread.blocking ? `Resolve blocking ${thread.commentType} thread.` : null,
            blocked: thread.blocking,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }

      if (resource === 'qa-results' && req.method === 'GET') {
        assertQaStageEnabled(runtimeOptions);
        requirePermission(context, 'history:read');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        return sendJson(res, 200, deriveQaResults(history), requestId);
      }
      if (resource === 'qa-results' && req.method === 'POST') {
        assertQaStageEnabled(runtimeOptions);
        assertQaContextRoutingEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const normalized = validateQaResultBody(body);
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.QA_TESTING) {
          throw createHttpError(409, 'invalid_stage', 'QA results can only be submitted while the task is in QA Testing.', { current_stage: state.current_stage });
        }
        const summary = summarizeTaskForDetail(taskId, state, history);
        const architectHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
        const implementationHistory = deriveImplementationHistory(history);
        const qaResults = deriveQaResults(history);
        const currentImplementation = implementationHistory[0] || null;
        const latestFailedQa = qaResults.latestFailed;
        const runId = `qa-${crypto.randomUUID().slice(0, 8)}`;
        const isRetest = Boolean(latestFailedQa && currentImplementation && currentImplementation.version > (latestFailedQa.implementationVersion || 0));
        const escalationPackage = normalized.outcome === 'fail'
          ? buildQaEscalationPackage({ taskId, summary, architectHandoff, implementationHistory, latestFailedQa, body: normalized, context })
          : null;

        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.qa_result_recorded',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `qa-result:${taskId}:${runId}`,
          payload: {
            run_id: runId,
            run_kind: isRetest ? 'retest' : 'initial',
            prior_run_id: isRetest ? latestFailedQa?.runId || null : null,
            outcome: normalized.outcome,
            summary: normalized.summary,
            scenarios: normalized.scenarios,
            findings: normalized.findings,
            reproduction_steps: normalized.reproduction_steps,
            stack_traces: normalized.stack_traces,
            env_logs: normalized.env_logs,
            retest_scope: normalized.retest_scope,
            implementation_version: currentImplementation?.version || 0,
            implementation_reference: currentImplementation?.primaryReference || null,
            escalation_package: escalationPackage,
            routed_to_stage: normalized.outcome === 'pass' ? STAGES.SRE_MONITORING : STAGES.IMPLEMENTATION,
          },
          source: body.source || 'http',
        });

        const transitionPayload = normalized.outcome === 'pass'
          ? {
              from_stage: STAGES.QA_TESTING,
              to_stage: STAGES.SRE_MONITORING,
              qa_run_id: runId,
              next_required_action: 'SRE monitoring validation is required.',
            }
          : {
              from_stage: STAGES.QA_TESTING,
              to_stage: STAGES.IMPLEMENTATION,
              qa_run_id: runId,
              waiting_state: 'engineering_fix_required',
              next_required_action: 'Address QA findings and resubmit implementation metadata.',
            };
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.stage_changed',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: `qa-stage-route:${taskId}:${runId}`,
          payload: transitionPayload,
          source: body.source || 'http',
        });
        await releaseActiveLockAfterTransition({
          store,
          taskId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          source: body.source || 'http',
          idempotencyKey: `lock-release:${taskId}:${runId}:qa-stage-transition`,
        });
        return sendJson(res, 201, {
          success: true,
          data: {
            runId,
            outcome: normalized.outcome,
            runKind: isRetest ? 'retest' : 'initial',
            routedToStage: normalized.outcome === 'pass' ? STAGES.SRE_MONITORING : STAGES.IMPLEMENTATION,
            implementationReference: currentImplementation?.primaryReference || null,
            escalationPackage,
            updatedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'sre-monitoring:start' && req.method === 'POST') {
        assertSreMonitoringEnabled(runtimeOptions);
        if (!canManageSreMonitoring(context)) throw createHttpError(403, 'forbidden', 'Only SRE/admin may start the monitoring window.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validateSreMonitoringStartBody(await parseJson(req));
        const [state, history, relationships, telemetry] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
          typeof store.getTaskRelationships === 'function' ? store.getTaskRelationships(taskId, { tenantId: context.tenantId }) : Promise.resolve({}),
          typeof store.getTaskObservabilitySummary === 'function' ? store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId }) : Promise.resolve(null),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.SRE_MONITORING) {
          throw createHttpError(409, 'invalid_stage', 'SRE monitoring can only start while the task is in SRE monitoring.', { current_stage: state.current_stage });
        }
        const summary = summarizeTaskForDetail(taskId, state, history);
        const monitoring = deriveSreMonitoringProjection({ taskId, summary, history, relationships, telemetry });
        if (monitoring.windowStartedAt) {
          throw createHttpError(409, 'sre_monitoring_already_started', 'SRE monitoring has already started for this task.', { started_at: monitoring.windowStartedAt });
        }
        if (!monitoring.linkedPrs.some((pr) => pr.merged)) {
          throw createHttpError(409, 'merged_pr_required', 'SRE monitoring requires at least one merged linked pull request before the monitoring window can start.');
        }

        const windowEndsAt = new Date(Date.now() + SRE_MONITORING_WINDOW_MS).toISOString();
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.sre_monitoring_started',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `sre-monitoring-start:${taskId}:${windowEndsAt}`,
          payload: {
            ...body,
            window_hours: SRE_MONITORING_WINDOW_HOURS,
            window_ends_at: windowEndsAt,
            waiting_state: null,
            next_required_action: 'Observe production telemetry and approve early only if the rollout is stable.',
            evidence_snapshot: buildSreEvidenceSnapshot({
              telemetry,
              linkedPrs: monitoring.linkedPrs,
              engineerSubmission: monitoring.engineerSubmission,
              startPayload: body,
            }),
          },
          source: 'http',
        });

        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            windowStartedAt: result.event.occurred_at,
            windowEndsAt,
            deploymentEnvironment: body.deployment_environment,
            deploymentUrl: body.deployment_url,
            deploymentVersion: body.deployment_version,
          },
        }, requestId);
      }
      if (resource === 'sre-monitoring:approve' && req.method === 'POST') {
        assertSreMonitoringEnabled(runtimeOptions);
        if (!canManageSreMonitoring(context)) throw createHttpError(403, 'forbidden', 'Only SRE/admin may approve SRE monitoring.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validateSreApprovalBody(await parseJson(req));
        const [state, history, relationships, telemetry] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
          typeof store.getTaskRelationships === 'function' ? store.getTaskRelationships(taskId, { tenantId: context.tenantId }) : Promise.resolve({}),
          typeof store.getTaskObservabilitySummary === 'function' ? store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId }) : Promise.resolve(null),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.SRE_MONITORING) {
          throw createHttpError(409, 'invalid_stage', 'SRE approval can only happen while the task is in SRE monitoring.', { current_stage: state.current_stage });
        }
        const summary = summarizeTaskForDetail(taskId, state, history);
        const monitoring = deriveSreMonitoringProjection({ taskId, summary, history, relationships, telemetry });
        if (!monitoring.windowStartedAt) {
          throw createHttpError(409, 'sre_monitoring_not_started', 'SRE monitoring must be started before early approval is available.');
        }
        if (monitoring.expired || monitoring.escalation) {
          throw createHttpError(409, 'sre_monitoring_window_expired', 'The SRE monitoring window has already expired and escalated.');
        }
        if (monitoring.approval) {
          throw createHttpError(409, 'sre_monitoring_already_approved', 'This task already has an SRE approval.');
        }
        if (telemetry?.degraded || telemetry?.freshness?.status !== 'fresh') {
          throw createHttpError(409, 'telemetry_not_stable', 'Early approval requires fresh, stable telemetry.');
        }
        const activeBlock = state.blocked ? findActiveTaskBlock(history) : null;
        if (activeBlock?.payload?.freeze_scope?.includes('stage_transitions')) {
          throw createHttpError(409, 'task_blocked_by_anomaly_child', activeBlock.payload?.reason || 'The parent task is blocked by a linked anomaly child task.', {
            child_task_id: activeBlock.payload?.child_task_id || null,
          });
        }

        const approval = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.sre_approval_recorded',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `sre-monitoring-approve:${taskId}:${state.last_event_id || 'initial'}`,
          payload: {
            reason: body.reason,
            evidence: body.evidence,
            evidence_snapshot: buildSreEvidenceSnapshot({
              telemetry,
              linkedPrs: monitoring.linkedPrs,
              engineerSubmission: monitoring.engineerSubmission,
              startPayload: monitoring.deployment ? {
                deployment_environment: monitoring.deployment.environment,
                deployment_url: monitoring.deployment.url,
                deployment_version: monitoring.deployment.version,
                deployment_status: monitoring.deployment.status,
              } : null,
            }),
            waiting_state: 'awaiting_human_close_review',
            next_required_action: 'Human close review is required before final closure.',
          },
          source: 'http',
        });
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.stage_changed',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `sre-monitoring-stage-route:${taskId}:${approval.event.event_id}`,
          payload: {
            from_stage: STAGES.SRE_MONITORING,
            to_stage: STAGES.PM_CLOSE_REVIEW,
            waiting_state: 'awaiting_human_close_review',
            next_required_action: 'Human close review is required before final closure.',
          },
          source: 'http',
        });

        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            approvedAt: approval.event.occurred_at,
            approvedBy: context.actorId,
            nextStage: STAGES.PM_CLOSE_REVIEW,
          },
        }, requestId);
      }
      if (resource === 'sre-monitoring:anomaly-child-task' && req.method === 'POST') {
        assertSreMonitoringEnabled(runtimeOptions);
        assertChildTaskCreationEnabled(runtimeOptions);
        if (!canManageSreMonitoring(context)) throw createHttpError(403, 'forbidden', 'Only SRE/admin may create anomaly child tasks.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const [state, history, relationships, telemetry] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
          typeof store.getTaskRelationships === 'function' ? store.getTaskRelationships(taskId, { tenantId: context.tenantId }) : Promise.resolve({}),
          typeof store.getTaskObservabilitySummary === 'function' ? store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId }) : Promise.resolve(null),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.SRE_MONITORING) {
          throw createHttpError(409, 'invalid_stage', 'Monitoring anomaly child tasks can only be created while the parent task is in SRE monitoring.', { current_stage: state.current_stage });
        }

        const summary = summarizeTaskForDetail(taskId, state, history);
        const monitoring = deriveSreMonitoringProjection({ taskId, summary, history, relationships, telemetry });
        const body = validateMonitoringAnomalyChildTaskBody(await parseJson(req), {
          parentTaskId: taskId,
          parentTitle: summary.title,
          telemetry,
          monitoring,
        });
        const childTaskId = `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const occurredAt = new Date().toISOString();

        const created = await store.appendEvent({
          taskId: childTaskId,
          tenantId: context.tenantId,
          eventType: 'task.created',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `anomaly-child:create:${taskId}:${childTaskId}`,
          occurredAt,
          payload: {
            title: body.title,
            business_context: body.business_context,
            acceptance_criteria: body.acceptance_criteria,
            definition_of_done: body.definition_of_done,
            priority: 'P0',
            task_type: body.task_type,
            initial_stage: STAGES.BACKLOG,
            assignee: body.assignee,
            parent_task_id: taskId,
            waiting_state: 'pm_business_context_required',
            next_required_action: 'PM must review and complete the machine-generated business context before Architect details begin.',
            anomaly_context: {
              machine_generated: true,
              source_task_id: taskId,
              service: body.service,
              summary: body.anomaly_summary,
              metrics: body.metrics,
              logs: body.logs,
              error_samples: body.error_samples,
              prefill: body.prefill,
            },
          },
          source: 'http',
        });
        await store.appendEvent({
          taskId: childTaskId,
          tenantId: context.tenantId,
          eventType: 'task.priority_changed',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `anomaly-child:priority:${childTaskId}`,
          occurredAt,
          payload: {
            priority: 'P0',
            previous_priority: null,
            reason: 'monitoring_anomaly_child_default',
            summary: `Priority elevated to P0 because ${childTaskId} was created from a live monitoring anomaly.`,
            waiting_state: 'pm_business_context_required',
            next_required_action: 'PM must review and complete the machine-generated business context before Architect details begin.',
          },
          source: 'http',
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, childTaskId, logger, { route: 'anomaly_child_task_create' });
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.child_link_added',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `anomaly-child:link:${taskId}:${childTaskId}`,
          occurredAt,
          payload: {
            child_task_id: childTaskId,
            relationship_type: 'monitoring_anomaly',
            service: body.service,
            summary: body.anomaly_summary,
          },
          source: 'http',
        });
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.blocked',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `anomaly-child:block:${taskId}:${childTaskId}`,
          occurredAt,
          payload: {
            blocker_type: 'child_task',
            child_task_id: childTaskId,
            waiting_state: 'child_task_investigation',
            reason: `Linked anomaly child task ${childTaskId} must be resolved before the parent can continue.`,
            summary: `Parent task paused for anomaly investigation in ${body.service}.`,
            next_required_action: 'Track the linked child task investigation. Parent comments and review remain available, but stage changes and closure should stay paused until the child is resolved.',
            freeze_scope: ['stage_transitions', 'closure'],
            viewable: true,
            commentable: true,
          },
          source: 'http',
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'anomaly_child_task_parent_blocked' });

        return sendJson(res, 201, {
          success: true,
          data: {
            parentTaskId: taskId,
            childTaskId,
            createdAt: created.event.occurred_at,
            priority: 'P0',
            status: STAGES.BACKLOG,
            waitingState: 'pm_business_context_required',
          },
        }, requestId);
      }
      if (resource === 'pm-business-context' && req.method === 'POST') {
        if (!canCompletePmBusinessContext(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may complete machine-generated business context.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validatePmBusinessContextCompletionBody(await parseJson(req));
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.BACKLOG) {
          throw createHttpError(409, 'invalid_stage', 'PM business context review can only be completed while the anomaly child task is in Backlog.', { current_stage: state.current_stage });
        }
        if (state.waiting_state !== 'pm_business_context_required') {
          throw createHttpError(409, 'pm_business_context_not_required', 'This task is not currently waiting on PM business context review.');
        }
        if (findLatestPmBusinessContextCompletion(history)) {
          throw createHttpError(409, 'pm_business_context_already_completed', 'PM business context review has already been completed for this task.');
        }
        const createdEvent = history.find((event) => event?.event_type === 'task.created');
        const anomalyContext = createdEvent?.payload?.anomaly_context || null;
        const finalizedAt = new Date().toISOString();
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.pm_business_context_completed',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `pm-business-context:${taskId}:${state.last_event_id || 'initial'}`,
          payload: {
            business_context: body.business_context,
            completed_by: context.actorId,
            completed_at: finalizedAt,
            waiting_state: null,
            next_required_action: 'Architect can begin detailing the anomaly child task.',
            anomaly_context: anomalyContext ? {
              ...anomalyContext,
              finalized_by_pm: true,
              finalized_by: context.actorId,
              finalized_at: finalizedAt,
            } : null,
          },
          source: 'http',
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'pm_business_context_complete' });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            completedAt: result.event.occurred_at,
            completedBy: context.actorId,
            nextAction: 'Architect can begin detailing the anomaly child task.',
          },
        }, requestId);
      }
      if (resource === 'close-review:cancellation-recommendation' && req.method === 'POST') {
        assertCloseCancellationEnabled(runtimeOptions);
        if (!canRecordCloseReviewRecommendation(context)) throw createHttpError(403, 'forbidden', 'Only PM, Architect, or admin may record cancellation recommendations.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validateCloseCancellationRecommendationBody(await parseJson(req));
        const state = await loadTaskStateForMutation(store, taskId, context.tenantId);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.PM_CLOSE_REVIEW) {
          throw createHttpError(409, 'invalid_stage', 'Cancellation recommendations can only be recorded during PM close review.', { current_stage: state.current_stage });
        }
        const actorRole = inferCloseDecisionActorRole(context, ['pm', 'architect']);
        if (!actorRole) throw createHttpError(403, 'forbidden', 'The current actor is not allowed to submit a cancellation recommendation.');
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.decision_recorded',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `close-review:cancellation:${taskId}:${actorRole}:${state.last_event_id || 'initial'}`,
          payload: {
            decision_type: 'cancellation_recommendation',
            actor_role: actorRole,
            outcome: 'recommend_cancel',
            summary: body.summary,
            rationale: body.rationale,
            artifact: body.artifact,
            waiting_state: 'awaiting_human_close_review',
            next_required_action: actorRole === 'pm'
              ? 'Architect recommendation is still required before human cancellation review can proceed.'
              : 'PM recommendation is still required before human cancellation review can proceed.',
          },
          source: 'http',
        });
        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            actorRole,
            summary: body.summary,
            recordedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'close-review:exceptional-dispute' && req.method === 'POST') {
        assertCloseCancellationEnabled(runtimeOptions);
        if (!canRecordCloseReviewRecommendation(context)) throw createHttpError(403, 'forbidden', 'Only PM, Architect, or admin may raise an exceptional dispute.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validateExceptionalDisputeBody(await parseJson(req));
        const state = await loadTaskStateForMutation(store, taskId, context.tenantId);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.PM_CLOSE_REVIEW) {
          throw createHttpError(409, 'invalid_stage', 'Exceptional disputes can only be raised during PM close review.', { current_stage: state.current_stage });
        }
        const actorRole = inferCloseDecisionActorRole(context, ['pm', 'architect']);
        if (!actorRole) throw createHttpError(403, 'forbidden', 'The current actor is not allowed to raise an exceptional dispute.');
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.escalated',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `close-review:exceptional-dispute:${taskId}:${actorRole}:${state.last_event_id || 'initial'}`,
          payload: {
            severity: body.severity,
            reason: 'exceptional_dispute',
            summary: body.summary,
            rationale: body.rationale,
            recommendation_summary: body.recommendation,
            artifact: body.artifact,
            raised_by_role: actorRole,
            waiting_state: 'awaiting_human_stakeholder_escalation',
            next_required_action: 'Human stakeholder escalation required for exceptional dispute.',
          },
          source: 'http',
        });
        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            actorRole,
            summary: body.summary,
            recordedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'close-review:human-decision' && req.method === 'POST') {
        assertCloseCancellationEnabled(runtimeOptions);
        if (!canRecordHumanCloseDecision(context)) throw createHttpError(403, 'forbidden', 'Only stakeholder/admin may record the human close decision.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validateHumanCloseDecisionBody(await parseJson(req));
        const [state, history] = await Promise.all([
          loadTaskStateForMutation(store, taskId, context.tenantId),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.PM_CLOSE_REVIEW && state.waiting_state !== 'awaiting_human_stakeholder_escalation') {
          throw createHttpError(409, 'invalid_stage', 'Human close decisions require an active close review or human stakeholder escalation.', { current_stage: state.current_stage, waiting_state: state.waiting_state });
        }
        const governance = deriveCloseGovernanceDecisionContext(state, history);
        if (!governance.humanDecisionReady) {
          throw createHttpError(409, 'human_close_decision_not_ready', 'Human close decisions require either both PM and Architect cancellation recommendations or an active human escalation.', {
            current_stage: state.current_stage,
            waiting_state: state.waiting_state,
          });
        }
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.decision_recorded',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `close-review:human-decision:${taskId}:${body.outcome}:${state.last_event_id || 'initial'}`,
          payload: {
            decision_type: 'human_close_decision',
            actor_role: 'human',
            outcome: body.outcome,
            summary: body.summary,
            rationale: body.rationale,
            confirmation_required: body.confirmationRequired,
            waiting_state: body.outcome === 'request_more_context' ? 'awaiting_close_context_response' : null,
            next_required_action: body.outcome === 'approve'
              ? 'Close review approved. Complete the governed closure or final cancellation path.'
              : body.outcome === 'reject'
                ? 'Human decision rejected the current close path. Rework the close gate or backtrack to implementation.'
                : 'Provide the requested context before asking for another human close decision.',
          },
          source: 'http',
        });
        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            outcome: body.outcome,
            recordedAt: result.event.occurred_at,
          },
        }, requestId);
      }
      if (resource === 'close-review:backtrack' && req.method === 'POST') {
        assertCloseCancellationEnabled(runtimeOptions);
        if (!canRequestCloseReviewBacktrack(context)) throw createHttpError(403, 'forbidden', 'Only PM, Architect, or admin may backtrack close review to implementation.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = validateCloseBacktrackBody(await parseJson(req));
        const [state, history] = await Promise.all([
          loadTaskStateForMutation(store, taskId, context.tenantId),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.PM_CLOSE_REVIEW) {
          throw createHttpError(409, 'invalid_stage', 'Close-review backtrack is only available during PM close review.', { current_stage: state.current_stage });
        }
        const actorRole = inferCloseDecisionActorRole(context, ['pm', 'architect']);
        if (!actorRole) throw createHttpError(403, 'forbidden', 'The current actor is not allowed to request a close-review backtrack.');
        const counterpartRole = actorRole === 'pm' ? 'architect' : 'pm';
        const governance = deriveCloseGovernanceDecisionContext(state, history);
        const matchingRecommendations = governance.backtrackRecommendations.filter((event) => String(event.artifact?.agreement_artifact || '').trim() === body.agreementArtifact);
        const duplicateRecommendation = matchingRecommendations.find((event) => event.actorRole === actorRole);
        if (duplicateRecommendation) {
          throw createHttpError(409, 'close_backtrack_recommendation_already_recorded', 'This role already recorded a backtrack recommendation for the provided agreement artifact.', {
            actor_role: actorRole,
            agreement_artifact: body.agreementArtifact,
          });
        }
        const decision = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.decision_recorded',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `close-review:backtrack-decision:${taskId}:${state.last_event_id || 'initial'}`,
          payload: {
            decision_type: 'close_backtrack',
            actor_role: actorRole,
            outcome: body.reasonCode,
            summary: body.summary || 'Close review backtracked to implementation.',
            rationale: body.rationale,
            artifact: { agreement_artifact: body.agreementArtifact },
          },
          source: 'http',
        });
        const counterpartRecommendation = matchingRecommendations.find((event) => event.actorRole === counterpartRole);
        if (!counterpartRecommendation) {
          return sendJson(res, 202, {
            success: true,
            data: {
              taskId,
              actorRole,
              awaitingRole: counterpartRole,
              agreementArtifact: body.agreementArtifact,
              recommendationRecordedAt: decision.event.occurred_at,
              message: `Backtrack recommendation recorded. ${counterpartRole === 'pm' ? 'PM' : 'Architect'} approval is still required before implementation can resume.`,
            },
          }, requestId);
        }
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.stage_changed',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `close-review:backtrack-stage:${taskId}:${decision.event.event_id}`,
          payload: {
            from_stage: STAGES.PM_CLOSE_REVIEW,
            to_stage: STAGES.IMPLEMENTATION,
            agreement_artifact: body.agreementArtifact,
            rationale: body.rationale,
            next_required_action: 'Address the close-review gap in implementation and resubmit through QA and monitoring.',
          },
          source: 'http',
        });
        return sendJson(res, 201, {
          success: true,
          data: {
            taskId,
            actorRole,
            routedToStage: STAGES.IMPLEMENTATION,
            reasonCode: body.reasonCode,
            recordedAt: decision.event.occurred_at,
          },
        }, requestId);
      }

      if (resource === 'review-questions' && req.method === 'GET') {
        requirePermission(context, 'history:read');
        const { questions } = await loadReviewQuestionContext(store, taskId, context.tenantId);
        return sendJson(res, 200, questions, requestId);
      }
      if (resource === 'review-questions' && req.method === 'POST') {
        requirePermission(context, 'events:write');
        if (!canAskReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only architect/admin may create review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        if (!String(body.prompt || '').trim()) {
          throw createHttpError(400, 'missing_prompt', 'Review question prompt is required.');
        }
        const { state, history } = await loadReviewQuestionContext(store, taskId, context.tenantId);
        if (state.current_stage !== STAGES.ARCHITECT_REVIEW) {
          throw createHttpError(409, 'invalid_stage', 'Review questions can only be created during Architect Review.');
        }
        const questionIdValue = createReviewQuestionId();
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_asked',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question:${taskId}:${questionIdValue}`,
          payload: reviewQuestionWorkflowPayload(deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_asked', sequence_number: (history[0]?.sequence_number || 0) + 1, payload: { question_id: questionIdValue, prompt: String(body.prompt).trim(), blocking: body.blocking !== false } }])), {
            question_id: questionIdValue,
            prompt: String(body.prompt).trim(),
            body: String(body.prompt).trim(),
            blocking: body.blocking !== false,
            state: REVIEW_QUESTION_STATES.OPEN,
          }),
          source: body.source || 'http',
        });
        return sendJson(res, 201, { questionId: questionIdValue, eventId: result.event.event_id, occurredAt: result.event.occurred_at }, requestId);
      }
      if (resource === 'review-question-answers' && req.method === 'POST') {
        requirePermission(context, 'events:write');
        if (!canAnswerReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may answer review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        if (!String(body.body || '').trim()) {
          throw createHttpError(400, 'missing_body', 'Review question answer body is required.');
        }
        const { question, history } = await loadReviewQuestionContext(store, taskId, context.tenantId, questionId);
        if (!question) throw createHttpError(404, 'review_question_not_found', 'Review question not found', { question_id: questionId });
        if (question.state === REVIEW_QUESTION_STATES.RESOLVED) {
          throw createHttpError(409, 'review_question_resolved', 'Resolved questions must be reopened before adding follow-up.');
        }
        const nextQuestions = deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_answered', sequence_number: (history[0]?.sequence_number || 0) + 1, actor_id: context.actorId, payload: { question_id: questionId, body: String(body.body).trim(), state: REVIEW_QUESTION_STATES.ANSWERED, blocking: question.blocking } }]));
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_answered',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question-answer:${taskId}:${questionId}:${history[0]?.event_id || 'initial'}`,
          payload: reviewQuestionWorkflowPayload(nextQuestions, { question_id: questionId, body: String(body.body).trim(), state: REVIEW_QUESTION_STATES.ANSWERED, blocking: question.blocking }),
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'review-question-resolve' && req.method === 'POST') {
        if (!canResolveReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may resolve review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const resolutionText = String(body.resolution || body.body || 'resolved').trim();
        const { question, history } = await loadReviewQuestionContext(store, taskId, context.tenantId, questionId);
        if (!question) throw createHttpError(404, 'review_question_not_found', 'Review question not found', { question_id: questionId });
        if (question.state === REVIEW_QUESTION_STATES.RESOLVED) {
          throw createHttpError(409, 'review_question_already_resolved', 'Review question is already resolved.', { question_id: questionId });
        }
        const nextQuestions = deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_resolved', sequence_number: (history[0]?.sequence_number || 0) + 1, actor_id: context.actorId, payload: { question_id: questionId, resolution: resolutionText, blocking: question.blocking } }]));
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_resolved',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question-resolve:${taskId}:${questionId}:${history[0]?.event_id || 'initial'}`,
          payload: reviewQuestionWorkflowPayload(nextQuestions, { question_id: questionId, resolution: resolutionText, body: resolutionText, state: REVIEW_QUESTION_STATES.RESOLVED, blocking: question.blocking }),
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'review-question-reopen' && req.method === 'POST') {
        if (!canReopenReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only architect, PM, or admin may reopen review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const reopenText = String(body.body || body.reason || 'reopened').trim();
        const { question, history } = await loadReviewQuestionContext(store, taskId, context.tenantId, questionId);
        if (!question) throw createHttpError(404, 'review_question_not_found', 'Review question not found', { question_id: questionId });
        if (question.state !== REVIEW_QUESTION_STATES.RESOLVED) {
          throw createHttpError(409, 'review_question_not_resolved', 'Only resolved review questions may be reopened.', { question_id: questionId });
        }
        const nextQuestions = deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_reopened', sequence_number: (history[0]?.sequence_number || 0) + 1, actor_id: context.actorId, payload: { question_id: questionId, body: reopenText, blocking: question.blocking } }]));
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_reopened',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question-reopen:${taskId}:${questionId}:${history[0]?.event_id || 'initial'}`,
          payload: reviewQuestionWorkflowPayload(nextQuestions, { question_id: questionId, body: reopenText, state: REVIEW_QUESTION_STATES.OPEN, blocking: question.blocking }),
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'architect-handoff' && req.method === 'PUT') {
        assertArchitectSpecTieringEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        if (!canManageArchitectHandoff(context)) throw createHttpError(403, 'forbidden', 'Only architect/admin may submit the engineering handoff.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (![STAGES.ARCHITECT_REVIEW, STAGES.TECHNICAL_SPEC].includes(state.current_stage)) {
          throw createHttpError(409, 'invalid_stage', 'Architect handoff can only be submitted during Architect Review or Technical Spec.', { current_stage: state.current_stage });
        }

        const normalized = validateArchitectHandoffBody(body);
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const priorHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
        const version = (priorHandoff?.version || 0) + 1;
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.architect_handoff_recorded',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `architect-handoff:${taskId}:v${version}`,
          payload: {
            ...normalized,
            version,
            next_required_action: 'Engineering handoff is complete. Implementation may begin.',
          },
          source: body.source || 'http',
        });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            version,
            engineerTier: normalized.engineer_tier,
            readyForEngineering: true,
            updatedAt: result.event.occurred_at,
            duplicate: result.duplicate,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'engineer-submission' && req.method === 'PUT') {
        assertEngineerSubmissionEnabled(runtimeOptions);
        requirePermission(context, 'events:write');
        if (!canManageEngineerSubmission(context)) throw createHttpError(403, 'forbidden', 'Only engineer/admin may submit implementation metadata.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const body = await parseJson(req);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        assertCurrentActorMatchesTaskAssignee(context, state, ['engineer']);
        if (![STAGES.IMPLEMENTATION, STAGES.IN_PROGRESS].includes(state.current_stage)) {
          throw createHttpError(409, 'invalid_stage', 'Engineer submission can only be submitted during Implementation.', { current_stage: state.current_stage });
        }

        const normalized = validateEngineerSubmissionBody(body);
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const priorSubmission = engineerSubmissionFromEvent(findLatestEngineerSubmission(history));
        const version = (priorSubmission?.version || 0) + 1;
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.engineer_submission_recorded',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `engineer-submission:${taskId}:v${version}`,
          payload: {
            ...normalized,
            version,
            assignee: state.assignee || null,
            next_required_action: 'Implementation metadata recorded. Task is ready for QA handoff.',
          },
          source: body.source || 'http',
        });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            version,
            commitSha: normalized.commit_sha,
            prUrl: normalized.pr_url,
            primaryReference: normalized.primary_reference,
            updatedAt: result.event.occurred_at,
            duplicate: result.duplicate,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'summary' && req.method === 'GET') {
        requirePermission(context, 'state:read');
        const [state, initialHistory, relationships, telemetry] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 25 }),
          typeof store.getTaskRelationships === 'function' ? store.getTaskRelationships(taskId, { tenantId: context.tenantId }) : Promise.resolve({}),
          typeof store.getTaskObservabilitySummary === 'function' ? store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId }) : Promise.resolve(null),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const result = summarizeTaskForDetail(taskId, state, initialHistory);
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'task_summary', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }
      if (resource === 'detail' && req.method === 'GET') {
        if (!isTaskDetailPageEnabled()) {
          throw createHttpError(503, 'feature_disabled', 'Task detail page is disabled by feature flag', { feature: 'ff_task_detail_page' });
        }
        requirePermission(context, 'state:read');
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 25;
        const cursor = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : undefined;
        const eventTypes = url.searchParams.getAll('eventType').filter(Boolean);
        const historyFilters = {
          tenantId: context.tenantId,
          eventType: eventTypes.length === 1 ? eventTypes[0] : undefined,
          eventTypes: eventTypes.length ? eventTypes : undefined,
          actorId: url.searchParams.get('actorId') || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined,
          dateFrom: url.searchParams.get('dateFrom') || undefined,
          dateTo: url.searchParams.get('dateTo') || undefined,
          limit,
          cursor,
        };
        const [state, initialHistory, timelineHistory, relationships, telemetry, taskSummaries] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          authorize(context, 'history:read') ? store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 200 }) : Promise.resolve([]),
          authorize(context, 'history:read') ? store.getTaskHistory(taskId, historyFilters) : Promise.resolve([]),
          store.getTaskRelationships(taskId, { tenantId: context.tenantId }),
          authorize(context, 'observability:read') ? store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId }) : Promise.resolve(null),
          authorize(context, 'relationships:read') ? store.listTaskSummaries({ tenantId: context.tenantId }) : Promise.resolve([]),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const summary = summarizeTaskForDetail(taskId, state, initialHistory);
        const childTaskIds = Array.isArray(relationships?.child_task_ids) ? relationships.child_task_ids : [];
        const taskSummaryById = new Map((taskSummaries || []).map((item) => [item.task_id, item]));
        const createdEvent = initialHistory.find((event) => event.event_type === 'task.created');
        const parentTaskId = createdEvent?.payload?.parent_task_id || null;
        const childTaskSummaries = childTaskIds.map((childTaskId) => taskSummaryById.get(childTaskId) || {
          task_id: childTaskId,
          title: childTaskId,
          current_stage: null,
          current_owner: null,
          blocked: false,
          closed: false,
        });
        const parentTaskSummary = parentTaskId ? (taskSummaryById.get(parentTaskId) || {
          task_id: parentTaskId,
          title: parentTaskId,
          current_stage: null,
          current_owner: null,
          blocked: false,
          closed: false,
        }) : null;
        const result = buildTaskDetailViewModel({
          taskId,
          summary,
          relationships: relationships || { child_task_ids: [], escalations: [], decisions: [] },
          history: initialHistory.map(normalizeHistoryItem),
          timelineHistory: timelineHistory.map(normalizeHistoryItem),
          timelinePageInfo: buildPaginatedHistoryResponse(timelineHistory, limit).page_info,
          telemetry: telemetry ? toTelemetryResponse(telemetry, context) : null,
          childTaskSummaries,
          parentTaskSummary,
          context,
          options: runtimeOptions,
        });
        if (result.meta?.permissions?.canViewOrchestration && result.orchestration) {
          await Promise.all([
            recordDependencyPlannerMetric(store, {
              requests: 1,
              readyWork: result.orchestration.planner.summary.readyCount,
              invalidGraphs: result.orchestration.planner.summary.invalidCount,
              durationMs: Date.now() - startedAt,
            }),
            recordOrchestrationVisibilityMetric(store, {
              requests: 1,
              views: 1,
              durationMs: Date.now() - startedAt,
            }),
          ]);
        }
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'task_detail', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }

      if (resource === 'orchestration' && req.method === 'GET') {
        assertDependencyPlannerEnabled(runtimeOptions);
        requirePermission(context, 'relationships:read');
        const [state, relationships, taskSummaries] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskRelationships(taskId, { tenantId: context.tenantId }),
          store.listTaskSummaries({ tenantId: context.tenantId }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const childTaskIds = Array.isArray(relationships?.child_task_ids) ? relationships.child_task_ids : [];
        const taskSummaryById = new Map((taskSummaries || []).map((item) => [item.task_id, item]));
        const childTaskSummaries = childTaskIds.map((childTaskId) => taskSummaryById.get(childTaskId) || {
          task_id: childTaskId,
          title: childTaskId,
          task_type: null,
          current_stage: null,
          current_owner: null,
          blocked: false,
          closed: false,
        });
        const result = buildOrchestrationView({
          relationships: relationships || { child_task_ids: [], child_dependencies: {}, orchestration_state: null },
          childTaskSummaries,
        });
        await Promise.all([
          recordDependencyPlannerMetric(store, {
            requests: 1,
            readyWork: result.planner.summary.readyCount,
            invalidGraphs: result.planner.summary.invalidCount,
            durationMs: Date.now() - startedAt,
          }),
          recordOrchestrationVisibilityMetric(store, {
            requests: 1,
            views: 1,
            durationMs: Date.now() - startedAt,
          }),
        ]);
        logger.info({ feature: 'ff_orchestration_visibility', action: 'orchestration_read', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'orchestration', ready_count: result.planner.summary.readyCount, invalid_count: result.planner.summary.invalidCount, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }

      if (resource === 'orchestration' && req.method === 'POST') {
        assertDependencyPlannerEnabled(runtimeOptions);
        assertOrchestrationSchedulerEnabled(runtimeOptions);
        requirePermission(context, 'relationships:read');
        requireOrchestrationPermission(context);
        const body = await parseJson(req);
        const [state, relationships, taskSummaries] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskRelationships(taskId, { tenantId: context.tenantId }),
          store.listTaskSummaries({ tenantId: context.tenantId }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const childTaskIds = Array.isArray(relationships?.child_task_ids) ? relationships.child_task_ids : [];
        const taskSummaryById = new Map((taskSummaries || []).map((item) => [item.task_id, item]));
        const childTaskSummaries = childTaskIds.map((childTaskId) => taskSummaryById.get(childTaskId) || {
          task_id: childTaskId,
          title: childTaskId,
          task_type: null,
          current_stage: null,
          current_owner: null,
          blocked: false,
          closed: false,
        });
        const run = await evaluateOrchestrationStart({
          taskId,
          relationships: relationships || { child_task_ids: [], child_dependencies: {}, orchestration_state: null },
          childTaskSummaries,
          coordinatorAgent: context.actorId,
          concurrencyLimit: Number.isFinite(body.concurrencyLimit) ? body.concurrencyLimit : undefined,
          dispatchOptions: {
            ...runtimeOptions,
            coordinatorAgent: context.actorId,
          },
          dispatchWork: runtimeOptions.dispatchWork,
        });
        const previousRunItemsById = new Map(((relationships && relationships.orchestration_state && relationships.orchestration_state.items) || []).map((item) => [item.id, item]));
        const dispatches = run.items.filter((item) => item.lastDispatchAt && item.lastDispatchAt === run.updatedAt).length;
        const fallbacks = run.items.filter((item) => item.state === 'failed' && item.lastDispatchAt && item.lastDispatchAt === run.updatedAt).length;
        const duplicateSkips = run.items.filter((item) => {
          const previous = previousRunItemsById.get(item.id);
          return previous?.state === 'running' && item.state === 'running' && Number(item.dispatchAttempts || 0) === Number(previous.dispatchAttempts || 0);
        }).length;
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.orchestration_evaluated',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `orchestration:${taskId}:${run.runId}:${run.updatedAt}`,
          payload: {
            run_id: run.runId,
            run,
          },
          source: body.source || 'http',
        });
        const result = buildOrchestrationView({
          relationships: {
            ...(relationships || {}),
            orchestration_state: run,
          },
          childTaskSummaries,
        });
        await recordOrchestrationSchedulerMetric(store, {
          requests: 1,
          dispatches,
          fallbacks,
          duplicateSkips,
          durationMs: Date.now() - startedAt,
        });
        logger.info({ feature: 'ff_orchestration_scheduler', action: 'orchestration_start', outcome: 'accepted', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, run_id: run.runId, dispatch_count: dispatches, fallback_count: fallbacks, duplicate_skip_count: duplicateSkips, ready_count: result.planner.summary.readyCount, invalid_count: result.planner.summary.invalidCount, duration_ms: Date.now() - startedAt });
        return sendJson(res, 202, result, requestId);
      }

      if (resource === 'events' && req.method === 'POST') {
        requirePermission(context, 'events:write');
        const body = await parseJson(req);
        assertNoRestrictedAnomalyWorkflowEventWrite(context, body.eventType);
        assertNoRestrictedExecutionContractEventWrite(body.eventType);
        if (!isTaskLockEventType(body.eventType) && body.eventType !== 'task.created') {
          await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, eventType: body.eventType, payload: body.payload, requestBody: body, options: runtimeOptions });
        }
        try {
          const result = await store.appendEvent({
            taskId,
            tenantId: context.tenantId,
            eventType: body.eventType,
            actorId: body.actorId || context.actorId,
            actorType: body.actorType,
            idempotencyKey: body.idempotencyKey,
            payload: body.payload,
            occurredAt: body.occurredAt,
            correlationId: body.correlationId,
            causationId: body.causationId,
            traceId: body.traceId,
            source: body.source || 'http',
          });
          if (body.eventType === 'task.created') {
            try {
              taskPlatform.syncTaskFromProjection({
              tenantId: context.tenantId,
              taskId,
              title: body.payload?.title || taskId,
              description: body.payload?.business_context || '',
              status: body.payload?.initial_stage || 'BACKLOG',
              priority: body.payload?.priority || null,
              ownerAgentId: body.payload?.assignee || null,
              sourceSystem: 'audit_projection_sync',
              });
            } catch (error) {
              logger.error({
                feature: 'task_platform_sync',
                action: 'compatibility_sync',
                outcome: 'error',
                tenant_id: context.tenantId,
                task_id: taskId,
                event_type: body.eventType,
                error_code: error.code || 'internal_error',
                error_message: error.message,
              });
            }
          } else if ([
            'task.stage_changed',
            'task.assigned',
            'task.reassigned',
            'task.unassigned',
            'task.priority_changed',
            'task.pm_business_context_completed',
            'task.execution_contract_version_recorded',
            'task.execution_contract_validated',
            'task.execution_contract_markdown_generated',
            'task.execution_contract_approved',
            'task.execution_contract_verification_report_generated',
            'task.execution_contract_artifact_bundle_generated',
            'task.execution_contract_artifact_bundle_approved',
          ].includes(body.eventType)) {
            await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { event_type: body.eventType });
          }
          if (body.eventType === 'task.stage_changed') {
            await releaseActiveLockAfterTransition({
              store,
              taskId,
              tenantId: context.tenantId,
              actorId: body.actorId || context.actorId,
              actorType: body.actorType || 'user',
              source: body.source || 'http',
              idempotencyKey: `lock-release:${taskId}:${result.event.event_id}:stage-transition`,
            });
            await maybeReleaseParentAnomalyBlock({
              store,
              taskPlatform,
              tenantId: context.tenantId,
              childTaskId: taskId,
              actorId: body.actorId || context.actorId,
              actorType: body.actorType || 'user',
              logger,
              source: body.source || 'http',
            });
          }
          if (body.eventType === 'task.closed') {
            await maybeReleaseParentAnomalyBlock({
              store,
              taskPlatform,
              tenantId: context.tenantId,
              childTaskId: taskId,
              actorId: body.actorId || context.actorId,
              actorType: body.actorType || 'user',
              logger,
              source: body.source || 'http',
            });
          }
          logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'events', duration_ms: Date.now() - startedAt });
          return sendJson(res, 202, result, requestId);
        } catch (error) {
          if (error instanceof WorkflowError) {
            return sendJson(res, error.statusCode || 400, createErrorResponse(error, requestId), requestId);
          }
          throw error;
        }
      }
      if (resource === 'assignment' && req.method === 'PATCH') {
        const assignmentStartedAt = Date.now();
        requirePermission(context, 'assignment:write');
        assertTaskAssignmentEnabled(runtimeOptions);
        assertTaskAssignmentNotKilled(runtimeOptions);
        const body = validateAssignmentRequest(await parseJson(req));
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createAssignmentError(404, 'task_not_found', 'Task not found', { task_id: taskId });

        const requestedAgentId = typeof body.agentId === 'string' ? body.agentId.trim() : body.agentId;
        const wantsUnassign = requestedAgentId == null || requestedAgentId === '';
        const agent = wantsUnassign ? null : findAgentById(agentRegistry, requestedAgentId);
        if (!wantsUnassign && !agent) {
          throw createAssignmentError(400, 'invalid_agent', 'Unknown AI agent id', { agent_id: requestedAgentId });
        }
        if (agent && !agent.active) {
          throw createAssignmentError(400, 'inactive_agent', 'AI agent is inactive', { agent_id: requestedAgentId });
        }

        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: wantsUnassign ? 'task.unassigned' : 'task.assigned',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || createAssignmentIdempotencyKey(req, taskId, state, agent?.id || null),
          payload: wantsUnassign
            ? { previous_assignee: state.assignee }
            : { previous_assignee: state.assignee, assignee: agent.id },
          occurredAt: body.occurredAt,
          correlationId: body.correlationId,
          causationId: body.causationId,
          traceId: body.traceId,
          source: body.source || 'http',
        });
        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'assignment' });
        const assignmentDurationMs = Date.now() - assignmentStartedAt;
        await recordAssignmentMetric(store, {
          requests: 1,
          businessSuccess: 1,
          durationMs: assignmentDurationMs,
        });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'assignment', assignee: agent?.id || null, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            owner: formatAssignmentOwner(agent),
            updatedAt: result.event.occurred_at,
            duplicate: result.duplicate,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'skill-escalation' && req.method === 'POST') {
        assertReassignmentGhostingEnabled(runtimeOptions);
        if (!canRequestSkillEscalation(context)) throw createHttpError(403, 'forbidden', 'Only engineer/admin may request an above-skill escalation.');
        const body = validateSkillEscalationBody(await parseJson(req));
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        assertCurrentActorMatchesTaskAssignee(context, state, ['engineer']);
        const currentTier = getEffectiveEngineerTier(state, history);
        if (currentTier !== 'Jr') {
          throw createHttpError(409, 'invalid_engineer_tier', 'Above-skill escalation is reserved for Jr-tier engineering assignments.', { current_engineer_tier: currentTier });
        }
        if (['IMPLEMENTATION', 'IN_PROGRESS'].includes(state.current_stage) || state.wip_started_at || findLatestEngineerSubmission(history)) {
          throw createHttpError(409, 'work_already_started', 'Above-skill escalation must be raised before implementation has started.', { current_stage: state.current_stage });
        }
        const requestedTier = body.requested_tier || getNextEngineerTier(currentTier);
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.skill_escalation_requested',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `skill-escalation:${taskId}:${state.last_event_id || 'initial'}`,
          occurredAt: new Date().toISOString(),
          payload: {
            current_engineer_tier: currentTier,
            requested_tier: requestedTier,
            reason: body.reason,
            before_start: true,
            waiting_state: 'awaiting_architect_decision',
            next_required_action: 'Architect should review the responsible escalation and decide whether to re-tier or reassign.',
          },
          source: 'http',
        });
        const thread = await appendWorkflowThreadNotification({
          store,
          taskId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          actorType: 'user',
          commentType: 'escalation',
          title: 'Responsible escalation: higher-tier support requested',
          body: body.reason,
          blocking: true,
          linkedEventId: result.event.event_id,
          notificationTargets: ['architect'],
          idempotencyKey: `skill-escalation-thread:${taskId}:${result.event.event_id}`,
          occurredAt: result.event.occurred_at,
        });
        return sendJson(res, 202, {
          success: true,
          data: {
            taskId,
            currentEngineerTier: currentTier,
            requestedTier,
            updatedAt: result.event.occurred_at,
            eventId: result.event.event_id,
            workflowThreadId: thread.threadId,
          },
        }, requestId);
      }
      if (resource === 'check-ins' && req.method === 'POST') {
        assertReassignmentGhostingEnabled(runtimeOptions);
        if (!canManageEngineerSubmission(context)) throw createHttpError(403, 'forbidden', 'Only engineer/admin may record check-ins.');
        const body = validateCheckInBody(await parseJson(req));
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        assertCurrentActorMatchesTaskAssignee(context, state, ['engineer']);
        const occurredAt = new Date().toISOString();
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.check_in_recorded',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `check-in:${taskId}:${state.last_event_id || 'initial'}`,
          occurredAt,
          payload: {
            summary: body.summary,
            evidence: body.evidence,
            assignee: state.assignee || null,
            check_in_interval_minutes: ENGINEER_CHECK_IN_INTERVAL_MINUTES,
            waiting_state: null,
            next_required_action: 'Continue implementation and record the next substantive check-in before the monitoring window expires.',
          },
          source: 'http',
        });
        return sendJson(res, 202, {
          success: true,
          data: {
            taskId,
            occurredAt,
            intervalMinutes: ENGINEER_CHECK_IN_INTERVAL_MINUTES,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'retier' && req.method === 'POST') {
        assertReassignmentGhostingEnabled(runtimeOptions);
        if (!canManageReassignmentGhosting(context)) throw createHttpError(403, 'forbidden', 'Only architect/admin may re-tier engineering work.');
        const body = validateRetierBody(await parseJson(req));
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const previousTier = getEffectiveEngineerTier(state, history);
        if (previousTier === body.engineer_tier) {
          throw createHttpError(409, 'tier_unchanged', 'Re-tiering requires a different target engineer tier.', { engineer_tier: previousTier });
        }
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.retiered',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `retier:${taskId}:${state.last_event_id || 'initial'}:${body.engineer_tier}`,
          occurredAt: new Date().toISOString(),
          payload: {
            previous_engineer_tier: previousTier,
            engineer_tier: body.engineer_tier,
            tier_rationale: body.tier_rationale,
            reason: body.reason || 'architect_retier',
            waiting_state: null,
            next_required_action: 'Confirm active ownership at the updated engineer tier.',
          },
          source: 'http',
        });
        return sendJson(res, 202, {
          success: true,
          data: {
            taskId,
            previousEngineerTier: previousTier,
            engineerTier: body.engineer_tier,
            updatedAt: result.event.occurred_at,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'reassignment' && req.method === 'POST') {
        assertReassignmentGhostingEnabled(runtimeOptions);
        if (!canManageReassignmentGhosting(context)) throw createHttpError(403, 'forbidden', 'Only architect/admin may reassign work.');
        const body = validateReassignmentBody(await parseJson(req));
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options: runtimeOptions });
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });

        const summary = summarizeTaskForDetail(taskId, state, history);
        const previousTier = getEffectiveEngineerTier(state, history);
        const occurredAt = new Date().toISOString();
        const latestActivity = findLatestActivitySignal(history, state.assignee || null);
        const missedCheckIns = computeMissedCheckIns(latestActivity?.occurredAt, occurredAt);
        if (body.mode === 'inactivity' && missedCheckIns < MISSED_CHECK_IN_THRESHOLD) {
          throw createHttpError(409, 'reassignment_threshold_not_reached', `Reassignment requires ${MISSED_CHECK_IN_THRESHOLD} missed ${ENGINEER_CHECK_IN_INTERVAL_MINUTES}-minute check-ins.`, {
            missed_check_ins: missedCheckIns,
            threshold: MISSED_CHECK_IN_THRESHOLD,
            interval_minutes: ENGINEER_CHECK_IN_INTERVAL_MINUTES,
            last_activity_at: latestActivity?.occurredAt || null,
          });
        }

        const targetTier = body.engineer_tier || (body.mode === 'inactivity' || body.mode === 'above_skill' ? getNextEngineerTier(previousTier) : previousTier);
        if ((body.mode === 'inactivity' || body.mode === 'above_skill') && !targetTier) {
          throw createHttpError(409, 'no_senior_tier_available', 'No higher engineer tier is available for reassignment.', { current_engineer_tier: previousTier });
        }
        const fallbackAssignee = body.mode === 'inactivity'
          ? (buildTierAssigneeId(targetTier) || state.assignee || 'engineer')
          : body.mode === 'above_skill'
            ? (buildTierAssigneeId(targetTier) || state.assignee || 'engineer')
            : (state.assignee || 'engineer');
        const assignee = body.assignee || fallbackAssignee;
        if (body.mode === 'inactivity' && assignee === state.assignee) {
          throw createHttpError(409, 'reassignment_owner_unchanged', 'Inactivity reassignment must move ownership to a different assignee.', {
            assignee,
            previous_assignee: state.assignee || null,
            suggested_assignee: buildTierAssigneeId(targetTier) || null,
          });
        }
        const transferSummary = buildTransferredContextSummary({
          taskId,
          summary,
          state,
          history,
          assignee,
          engineerTier: targetTier,
          reason: body.reason,
          mode: body.mode,
          occurredAt,
        });

        let retierEventId = null;
        if (targetTier && targetTier !== previousTier) {
          const retierResult = await store.appendEvent({
            taskId,
            tenantId: context.tenantId,
            eventType: 'task.retiered',
            actorId: context.actorId,
            actorType: 'user',
            idempotencyKey: `retier:${taskId}:${state.last_event_id || 'initial'}:${targetTier}:reassignment`,
            occurredAt,
            payload: {
              previous_engineer_tier: previousTier,
              engineer_tier: targetTier,
              tier_rationale: body.reason,
              reason: body.mode,
              waiting_state: null,
              next_required_action: 'Ownership moved to a higher tier due to reassignment.',
            },
            source: 'http',
          });
          retierEventId = retierResult.event.event_id;
        }

        const reassignmentResult = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.reassigned',
          actorId: context.actorId,
          actorType: 'user',
          idempotencyKey: `reassignment:${taskId}:${state.last_event_id || 'initial'}:${assignee}:${body.mode}`,
          occurredAt,
          payload: {
            previous_assignee: state.assignee,
            assignee,
            reason: body.reason,
            mode: body.mode,
            previous_engineer_tier: previousTier,
            engineer_tier: targetTier,
            missed_check_ins: body.mode === 'inactivity' ? missedCheckIns : 0,
            transfer_summary: transferSummary,
            waiting_state: body.mode === 'inactivity' ? 'ghosting_review_open' : null,
            next_required_action: 'Review the transferred context and resume work with the updated owner/tier.',
          },
          source: 'http',
        });

        let ghostingReview = null;
        if (body.mode === 'inactivity') {
          const reviewTaskId = `GHOST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          const reviewTitle = `Inactivity review for ${taskId}`;
          await store.appendEvent({
            taskId: reviewTaskId,
            tenantId: context.tenantId,
            eventType: 'task.created',
            actorId: context.actorId,
            actorType: 'user',
            idempotencyKey: `ghost-review:create:${reviewTaskId}`,
            occurredAt,
            payload: {
              title: reviewTitle,
              business_context: `Operational review for inactivity-based reassignment on ${taskId}.`,
              acceptance_criteria: [
                'Document the missed check-in window.',
                'Confirm reassignment provenance and transferred context.',
                'Capture any follow-up governance actions.',
              ],
              definition_of_done: [
                'Ghosting review outcome is recorded.',
                'Ownership decisions are auditable.',
              ],
              priority: summary.priority || 'P2',
              task_type: 'governance_review',
              initial_stage: 'BACKLOG',
              assignee: 'architect',
            },
            source: 'http',
          });
          await trySyncCanonicalTask(taskPlatform, store, context.tenantId, reviewTaskId, logger, { route: 'ghosting_review' });
          await store.appendEvent({
            taskId,
            tenantId: context.tenantId,
            eventType: 'task.child_link_added',
            actorId: context.actorId,
            actorType: 'user',
            idempotencyKey: `ghost-review:link:${taskId}:${reviewTaskId}`,
            occurredAt,
            payload: { child_task_id: reviewTaskId },
            source: 'http',
          });
          const ghostEvent = await store.appendEvent({
            taskId,
            tenantId: context.tenantId,
            eventType: 'task.ghosting_review_created',
            actorId: context.actorId,
            actorType: 'user',
            idempotencyKey: `ghost-review:event:${taskId}:${reviewTaskId}`,
            occurredAt,
            payload: {
              parent_task_id: taskId,
              review_task_id: reviewTaskId,
              title: reviewTitle,
              reason: body.reason,
              missed_check_ins: missedCheckIns,
              waiting_state: 'ghosting_review_open',
              next_required_action: 'Architect should complete the linked ghosting review task and confirm the reassignment outcome.',
            },
            source: 'http',
          });
          ghostingReview = {
            reviewTaskId,
            eventId: ghostEvent.event.event_id,
            title: reviewTitle,
          };
        }

        await trySyncCanonicalTask(taskPlatform, store, context.tenantId, taskId, logger, { route: 'reassignment' });
        return sendJson(res, 202, {
          success: true,
          data: {
            taskId,
            previousAssignee: state.assignee,
            assignee,
            previousEngineerTier: previousTier,
            engineerTier: targetTier,
            mode: body.mode,
            missedCheckIns: body.mode === 'inactivity' ? missedCheckIns : 0,
            transferSummary,
            retierEventId,
            reassignmentEventId: reassignmentResult.event.event_id,
            ghostingReview,
          },
        }, requestId);
      }
      if (resource === 'history' && req.method === 'GET') {
        requirePermission(context, 'history:read');
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 25;
        const cursor = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : undefined;
        const eventTypes = url.searchParams.getAll('eventType').filter(Boolean);
        const history = await store.getTaskHistory(taskId, {
          tenantId: context.tenantId,
          eventType: eventTypes.length === 1 ? eventTypes[0] : undefined,
          eventTypes: eventTypes.length ? eventTypes : undefined,
          actorId: url.searchParams.get('actorId') || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined,
          dateFrom: url.searchParams.get('dateFrom') || undefined,
          dateTo: url.searchParams.get('dateTo') || undefined,
          limit,
          cursor,
        });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'history', limit: limit || null, cursor: Number.isFinite(cursor) ? cursor : null, result_count: history.length, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, buildPaginatedHistoryResponse(history, limit), requestId);
      }
      if (resource === 'state' && req.method === 'GET') {
        requirePermission(context, 'state:read');
        const result = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!result) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'state', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }
      if (resource === 'relationships' && req.method === 'GET') {
        requirePermission(context, 'relationships:read');
        const result = await store.getTaskRelationships(taskId, { tenantId: context.tenantId });
        if (!result) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'relationships', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }
      if (resource === 'observability-summary' && req.method === 'GET') {
        requirePermission(context, 'observability:read');
        const result = await store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId });
        if (!result) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'observability_summary', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, toTelemetryResponse(result, context), requestId);
      }

      throw createHttpError(405, 'method_not_allowed', 'Method not allowed', { method: req.method, resource });
    } catch (error) {
      const normalized = normalizeError(error);
      if (error instanceof NotFoundError) {
        normalized.statusCode = error.statusCode;
        normalized.code = error.code;
      }
      if (error instanceof ValidationError) {
        normalized.statusCode = error.statusCode;
        normalized.code = error.code;
      }
      if (error instanceof ConflictError) {
        normalized.statusCode = error.statusCode;
        normalized.code = error.code;
      }
      logger.error({
        feature: 'ff_audit_foundation',
        action: 'http_request',
        outcome: 'error',
        request_id: requestId,
        method: req.method,
        path: url.pathname,
        status_code: normalized.statusCode,
        error_code: normalized.code,
        error_id: normalized.errorId || null,
        error_message: normalized.message,
        duration_ms: Date.now() - startedAt,
      });
      if (url.pathname.includes('/assignment')) {
        await recordAssignmentMetric(store, {
          requests: normalized.statusCode >= 400 ? 1 : 0,
          errors: normalized.statusCode >= 400 ? 1 : 0,
          durationMs: Date.now() - startedAt,
        });
      }
      return sendJson(res, normalized.statusCode, createErrorResponse(normalized, requestId), requestId);
    }
  });
  return { server, store, authService: runtimeOptions.authService };
}

module.exports = { createAuditApiServer, getRequestContext };
