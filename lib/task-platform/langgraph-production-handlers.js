'use strict';

const crypto = require('node:crypto');

const { delegateFactorySpecialist } = require('./factory-orchestration');
const { assertRealImplementerArtifacts, parseDelegationJsonOutput } = require('./factory-agent-phases');
const { collectGitHubPullRequestEvidence } = require('./golden-path-real-evidence-collector');
const { githubCheckFailures, githubIdentityFailures } = require('./final-github-proof');
const { assertStore, createQueueRepository } = require('./langgraph-production-store');

const DOMAIN_EVENT = 'task.langgraph_domain_operation_completed';
const ACTOR_ID = 'system:langgraph-runtime';
const CHILD_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function artifact(kind, reference, digestSource = reference) {
  return Object.freeze({ kind, reference, checksum: `sha256:${sha256(digestSource)}` });
}

function lifecycleMetadata(item) {
  return item.metadata?.langgraph || item.metadata?.lifecycle || {};
}
function realDeliveryMetadata(item) {
  return item.metadata?.realDelivery || item.metadata?.real_delivery || {};
}

function normalizeHandledBy(value, fallback) {
  const normalized = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return CHILD_PATTERN.test(normalized) ? normalized : fallback;
}
function delegationEvidence(result, fallback) {
  return Object.freeze({
    delegated: result?.delegated === true,
    handledBy: normalizeHandledBy(result?.agentId || result?.specialist, fallback),
  });
}
function buildSpecialistPrompt(role, item, request) {
  const evidenceShape = role === 'qa'
    ? 'Required JSON: {"outcome":"pass"|"fail","findings":[]}.'
    : ['jr-engineer', 'sr-engineer'].includes(role)
      ? 'Required JSON: {"branchName":"...","commitSha":"40-char real SHA","prUrl":"https://github.com/owner/repo/pull/number"}.'
      : role === 'sre'
        ? 'Required JSON: {"approved":true|false,"reason":"...","evidence":[]}.'
        : 'Required JSON: {"approved":true|false,"summary":"..."}.';
  return [
    `You are the ${role} specialist for canonical task ${request.run.taskId}.`,
    `Lifecycle node: ${request.lifecycle.node}; attempt: ${request.lifecycle.attempt}.`,
    'Perform the requested domain operation and return concise JSON evidence only.',
    evidenceShape,
    `Title: ${item.title}`,
    `Requirements: ${String(item.requirements || '').slice(0, 4000)}`,
  ].join('\n');
}
function createDefaultDependencies({ baseDir, env, store }) {
  const fetchImpl = globalThis.fetch;
  return Object.freeze({
    async delegate(role, item, request) {
      return delegateFactorySpecialist(role, buildSpecialistPrompt(role, item, request), {
        taskId: request.run.taskId,
        actorId: ACTOR_ID,
        openclawUrl: env.OPENCLAW_BASE_URL,
        baseDir,
      });
    },
    async collectGitHub(options, evidence) {
      return collectGitHubPullRequestEvidence({
        ...options,
        githubToken: env.GITHUB_TOKEN || env.GH_TOKEN,
        githubApiBaseUrl: env.GITHUB_API_BASE_URL,
        fetchImpl,
      }, evidence);
    },
    fetch: fetchImpl,
    queue: createQueueRepository(store),
  });
}
async function recordDomainEvent(store, request, operation, details = {}) {
  return store.appendEvent({
    tenantId: request.run.tenantId,
    taskId: request.run.taskId,
    eventType: DOMAIN_EVENT,
    actorId: ACTOR_ID,
    actorType: 'system',
    idempotencyKey: `${request.lifecycle.idempotencyKey}:domain`,
    correlationId: request.lifecycle.threadId,
    source: 'langgraph-runtime',
    payload: {
      factory_run_id: request.run.factoryRunId,
      operation,
      attempt: request.lifecycle.attempt,
      ...details,
    },
  });
}
async function recordTaskEvent(store, request, eventType, payload) {
  return store.appendEvent({
    tenantId: request.run.tenantId,
    taskId: request.run.taskId,
    eventType,
    actorId: ACTOR_ID,
    actorType: 'system',
    idempotencyKey: `${request.lifecycle.idempotencyKey}:${eventType.replace(/[^a-z0-9]+/gi, '-')}`,
    correlationId: request.lifecycle.threadId,
    source: 'langgraph-runtime',
    payload,
  });
}
async function qaEvidence(context, request, parsed) {
  const outcome = String(parsed?.outcome || '').toLowerCase();
  if (!['pass', 'fail'].includes(outcome)) {
    throw Object.assign(new Error('QA specialist must return a pass or fail outcome.'), { code: 'qa_evidence_invalid' });
  }
  await recordTaskEvent(context.store, request, 'task.qa_result_recorded', {
    outcome, run_kind: request.lifecycle.attempt > 1 ? 'retest' : 'initial',
    findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 50) : [],
    summary: `LangGraph QA ${outcome}.`, implementation_version: request.lifecycle.attempt,
  });
  return { qaOutcome: outcome };
}

async function implementationEvidence(context, request, parsed, delegation) {
  assertRealImplementerArtifacts(parsed || {});
  await recordTaskEvent(context.store, request, 'task.engineer_submission_recorded', {
    version: request.lifecycle.attempt, commit_sha: parsed.commitSha, pr_url: parsed.prUrl,
    primary_reference: { kind: 'commit', label: parsed.commitSha, url: parsed.prUrl },
    assignee: delegation.handledBy,
  });
  return { artifacts: [artifact('pull_request', parsed.prUrl, parsed.commitSha)] };
}

async function sreEvidence(context, request, parsed) {
  if (parsed?.approved !== true) {
    throw Object.assign(new Error(parsed?.reason || 'SRE specialist did not approve the deployment evidence.'), { code: 'sre_approval_failed' });
  }
  await recordTaskEvent(context.store, request, 'task.sre_approval_recorded', {
    reason: String(parsed.reason || 'SRE approved the deployed revision.').slice(0, 1000),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 50) : [],
  });
  return {};
}

async function specialistEvidence(context, request, item, parsed, delegation, options) {
  if (options.qa) return qaEvidence(context, request, parsed);
  if (options.implementation) return implementationEvidence(context, request, parsed, delegation);
  if (options.sre) return sreEvidence(context, request, parsed);
  if (options.eventType) {
    await recordTaskEvent(context.store, request, options.eventType, options.eventPayload({ delegation, item, parsed: parsed || {}, request }));
  }
  return {};
}

function specialistHandler(role, context, options = {}) {
  return async (request) => {
    const item = await context.queue.get(request.run);
    const result = await context.dependencies.delegate(role, item, request);
    const delegation = delegationEvidence(result, normalizeHandledBy(role, 'specialist'));
    const evidence = await specialistEvidence(context, request, item, parseDelegationJsonOutput(result), delegation, options);
    await recordDomainEvent(context.store, request, request.lifecycle.node, {
      delegated: delegation.delegated,
      handled_by: delegation.handledBy,
      ...(evidence.qaOutcome ? { qa_outcome: evidence.qaOutcome } : {}),
    });
    return { outcome: 'success', delegation, ...evidence };
  };
}

function normalizeChildren(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 128) throw new Error('Lifecycle child plan must be an array of at most 128 entries.');
  return value.map((child) => {
    const id = String(child?.id || '');
    const dependencies = Array.isArray(child?.dependencies) ? child.dependencies.map(String) : [];
    if (!CHILD_PATTERN.test(id) || dependencies.some((entry) => !CHILD_PATTERN.test(entry))) {
      throw new Error('Lifecycle child plan contains an invalid id or dependency.');
    }
    return Object.freeze({ id, dependencies: Object.freeze(dependencies) });
  });
}

function mergeReadinessHandler(context) {
  return async (request) => {
    const item = await context.queue.get(request.run);
    const metadata = realDeliveryMetadata(item);
    const proof = await context.dependencies.collectGitHub({
      prUrl: metadata.prUrl,
      prNumber: metadata.prNumber,
      repository: metadata.repository || metadata.ciRepository,
      branchName: metadata.branchName,
      implementationCommitSha: metadata.implementationCommitSha || metadata.commitSha,
      githubEvidenceSource: 'github',
    }, { github: metadata });
    if (!proof) throw new Error('Live Git provider evidence is required for merge readiness.');
    const failures = [...githubIdentityFailures({ github: proof }), ...githubCheckFailures({ github: proof })];
    if (failures.length) throw Object.assign(new Error(`Merge readiness failed: ${failures.join('; ')}`), { code: 'merge_readiness_failed' });
    await recordTaskEvent(context.store, request, 'task.github_pr_synced', {
      pr_number: proof.prNumber,
      pr_url: proof.prUrl,
      pr_repository: proof.repository,
      pr_state: proof.merged ? 'merged' : 'open',
      pr_merged: proof.merged === true,
      merge_commit_sha: proof.mergeCommitSha || null,
      linked_prs: [{
        number: proof.prNumber, url: proof.prUrl, repository: proof.repository,
        state: proof.merged ? 'merged' : 'open', merged: proof.merged === true,
      }],
    });
    await recordDomainEvent(context.store, request, 'merge_readiness', {
      repository: proof.repository,
      pull_request_number: proof.prNumber,
      commit_sha: proof.commitSha,
    });
    return {
      outcome: 'success',
      decisions: [{ code: 'merge_readiness', outcome: 'approved' }],
      artifacts: [artifact('pull_request', proof.prUrl, proof.commitSha)],
    };
  };
}

function deploymentHandler(context) {
  return async (request) => {
    const item = await context.queue.get(request.run);
    const metadata = realDeliveryMetadata(item);
    const deploymentUrl = String(metadata.deploymentUrl || metadata.productionUrl || '').replace(/\/+$/, '');
    const commitSha = metadata.mergeCommitSha || metadata.commitSha || metadata.implementationCommitSha;
    if (!deploymentUrl || !/^[0-9a-f]{40}$/i.test(String(commitSha || ''))) {
      throw new Error('Deployment requires a hosted URL and exact 40-character commit SHA.');
    }
    if (typeof context.dependencies.fetch !== 'function') throw new Error('Deployment health fetch implementation is required.');
    const healthPath = metadata.healthCheckPath || '/health';
    const response = await context.dependencies.fetch(`${deploymentUrl}${healthPath}`, {
      headers: { 'x-expected-commit-sha': commitSha },
    });
    const body = await response.json().catch(() => ({}));
    const checkedSha = body.commitSha || body.commit_sha || body.version || body.revision;
    if (!response.ok || checkedSha !== commitSha) {
      throw Object.assign(new Error('Deployed health response did not prove the exact commit SHA.'), { code: 'deployment_health_failed', retryable: true });
    }
    await recordTaskEvent(context.store, request, 'task.sre_monitoring_started', {
      deployment_environment: metadata.releaseEnv || 'staging',
      deployment_url: deploymentUrl,
      deployment_version: commitSha,
      deployment_status: 'success',
      evidence: [`Exact revision health verified at ${deploymentUrl}${healthPath}.`],
    });
    await recordDomainEvent(context.store, request, 'deployment', {
      deployment_url: deploymentUrl,
      commit_sha: commitSha,
      health_path: healthPath,
    });
    return { outcome: 'success', artifacts: [artifact('deployment', deploymentUrl, commitSha)] };
  };
}

function intakeHandlers(context) {
  return {
    async create(request) {
      const item = await context.queue.createIntake(request);
      const eventRequest = { ...request, run: { ...request.run, taskId: item.taskId } };
      await recordDomainEvent(context.store, eventRequest, 'intake', { project_id: item.projectId });
      return { outcome: 'success', artifacts: [artifact('canonical_task', `task:${item.taskId}`)] };
    },
  };
}

function refinementHandlers(context) {
  return {
    refine: specialistHandler('pm', context, {
      eventType: 'task.refinement_completed',
      eventPayload: ({ delegation }) => ({
        agent_id: delegation.handledBy,
        delegated: delegation.delegated,
        waiting_state: 'execution_contract_review',
        next_required_action: 'Review and approve the execution contract.',
      }),
    }),
  };
}

function contractHandlers(context) {
  return {
    async createAndApprove(request) {
      const item = await context.queue.get(request.run);
      const decision = request.lifecycle.decision?.action;
      if (!['accept', 'edit'].includes(decision)) {
        throw new Error('Execution contract requires an accepted human decision.');
      }
      const digest = sha256(`${item.requirements}\n${JSON.stringify(request.lifecycle.decision?.edits || {})}`);
      await recordTaskEvent(context.store, request, 'task.execution_contract_approved', {
        version: 1,
        validation: { status: 'valid' },
        contract_digest: digest,
        waiting_state: 'execution_contract_approved',
        next_required_action: 'Architect handoff approval is required.',
      });
      await recordDomainEvent(context.store, request, 'execution_contract', { contract_digest: digest, decision });
      return {
        outcome: 'success',
        decisions: [{ code: 'execution_contract', outcome: 'approved' }],
        artifacts: [artifact('execution_contract', `contract:${request.run.taskId}`, digest)],
      };
    },
  };
}

function architectureHandlers(context) {
  return {
    handoff: specialistHandler('architect', context, {
      eventType: 'task.architect_handoff_recorded',
      eventPayload: ({ item, parsed }) => ({
        version: 1,
        ready_for_engineering: parsed.approved !== false,
        engineer_tier: item.templateTier === 'Simple' ? 'Jr' : item.templateTier === 'Complex' ? 'Principal' : 'Sr',
        tier_rationale: String(parsed.summary || 'Architecture handoff approved by the delegated specialist.').slice(0, 1000),
        next_required_action: 'Implementation may begin.',
      }),
    }),
  };
}

function childHandlers(context) {
  return {
    async plan(request) {
      const item = await context.queue.get(request.run);
      return normalizeChildren(lifecycleMetadata(item).children);
    },
    async execute(request) {
      const item = await context.queue.get(request.run);
      const result = await context.dependencies.delegate(request.child.id, item, request);
      const delegation = delegationEvidence(result, request.child.id);
      await recordDomainEvent(context.store, request, `child_${request.child.id}`, {
        delegated: delegation.delegated, handled_by: delegation.handledBy,
      });
      return { outcome: 'success', delegation };
    },
  };
}

function closeoutHandlers(context) {
  return {
    async complete(request) {
      if (!['accept', 'edit'].includes(request.lifecycle.decision?.action)) {
        throw new Error('Closeout requires an accepted human decision.');
      }
      await context.store.appendEvent({
        tenantId: request.run.tenantId,
        taskId: request.run.taskId,
        eventType: 'task.closed',
        actorId: ACTOR_ID,
        actorType: 'system',
        idempotencyKey: `${request.lifecycle.threadId}:closeout:task-closed`,
        correlationId: request.lifecycle.threadId,
        source: 'langgraph-runtime',
        payload: { reason: 'LangGraph lifecycle completed.', factory_run_id: request.run.factoryRunId },
      });
      await context.queue.close(request);
      await recordDomainEvent(context.store, request, 'closeout', { decision: request.lifecycle.decision.action });
      return { outcome: 'success', decisions: [{ code: 'closeout', outcome: 'approved' }] };
    },
  };
}

function composeLifecycleHandlers(context) {
  return Object.freeze({
    intake: intakeHandlers(context),
    refinement: refinementHandlers(context),
    contracts: contractHandlers(context),
    architecture: architectureHandlers(context),
    children: childHandlers(context),
    implementation: { execute: specialistHandler('jr-engineer', context, { implementation: true }) },
    quality: {
      verify: specialistHandler('qa', context, { qa: true }),
      fix: specialistHandler('sr-engineer', context, { implementation: true }),
    },
    review: { approve: specialistHandler('review-panel', context) },
    mergeReadiness: { verify: mergeReadinessHandler(context) },
    deployment: { deploy: deploymentHandler(context) },
    sre: { monitor: specialistHandler('sre', context, { sre: true }) },
    closeout: closeoutHandlers(context),
  });
}

function createProductionLifecycleHandlers(input = {}) {
  const store = assertStore(input.store);
  const env = input.env || process.env;
  const defaults = createDefaultDependencies({ baseDir: input.baseDir || process.cwd(), env, store });
  const dependencies = Object.freeze({ ...defaults, ...(input.dependencies || {}) });
  const queue = dependencies.queue || defaults.queue;
  return composeLifecycleHandlers(Object.freeze({ dependencies, env, queue, store }));
}

module.exports = {
  DOMAIN_EVENT,
  artifact,
  createProductionLifecycleHandlers,
  createQueueRepository,
  normalizeChildren,
};
