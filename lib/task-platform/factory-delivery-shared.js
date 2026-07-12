const path = require('node:path');
const crypto = require('node:crypto');
const { signHmacJwt } = require('../auth/jwt');
const {
  assertActiveFactoryQueueFile,
  isMigratedFactoryQueueMarker,
  loadFactoryQueue,
  saveFactoryQueue,
} = require('./factory-delivery-file-queue');

const DEFAULT_QUEUE_PATH = 'observability/factory-delivery-queue.json', DEFAULT_DELIVERY_DIR = 'observability/factory-delivery';
const REAL_DELIVERY_INTENT_FIELDS = new Set([
  'branch', 'branchName', 'autoMerge', 'candidateProofPath', 'checks', 'ciRepository', 'evidenceSource',
  'commitSha', 'deploymentUrl', 'healthCheckPath', 'implementationCommitSha', 'finalEvidencePath', 'realAutonomousDeliveryEvidencePath', 'realDeliveryFinalEvidencePath',
  'githubEvidenceSource', 'branchProtection', 'mergeReadiness', 'prNumber', 'prUrl', 'productionSafe', 'productionUrl',
  'requiredChecks', 'realDeliveryCandidateProofPath', 'releaseEnv', 'repository',
  'releaseArtifactCommands', 'releaseArtifactDir', 'requireHealthCommit',
  'riskLevel', 'productionSafetyEvidence', 'productionSafetyEvidencePath', 'rollbackPlan', 'rollbackTarget', 'rollbackEvidence',
  'rollbackEvidencePath', 'rollbackVerified', 'testCommands', 'useExistingReleaseArtifacts',
]);

function parseBooleanEnv(value, fallback = false) { return value == null || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase()); }

function parseCommandList(value) {
  if (Array.isArray(value)) return value.map(entry => String(entry || '').trim()).filter(Boolean);
  if (!value) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text).map(entry => String(entry || '').trim()).filter(Boolean);
  return text.split(/\n+/).map(entry => entry.trim()).filter(Boolean);
}

function realDeliveryMetadata(requirement = {}) {
  const existing = requirement.metadata?.realDelivery || {};
  const prNumber = Number(requirement.prNumber || requirement.pullRequestNumber || existing.prNumber || existing.pullRequestNumber);
  const metadata = {
    ...existing,
    ciRepository: requirement.ciRepository || requirement.repository || existing.ciRepository || existing.repository || null,
    branchName: requirement.branchName || requirement.branch || existing.branchName || existing.branch || null,
    implementationCommitSha: requirement.implementationCommitSha || requirement.commitSha || existing.implementationCommitSha || existing.commitSha || null,
    commitSha: requirement.commitSha || existing.commitSha || null,
    prUrl: requirement.prUrl || requirement.pullRequestUrl || existing.prUrl || existing.pullRequestUrl || null,
    prNumber: Number.isInteger(prNumber) && prNumber > 0 ? prNumber : null,
    checks: Array.isArray(requirement.checks) ? requirement.checks : existing.checks, requiredChecks: Array.isArray(requirement.requiredChecks) ? requirement.requiredChecks : existing.requiredChecks,
    branchProtection: requirement.branchProtection || requirement.branch_protection || existing.branchProtection || existing.branch_protection, mergeReadiness: requirement.mergeReadiness || requirement.merge_readiness || existing.mergeReadiness || existing.merge_readiness,
    githubEvidenceSource: requirement.githubEvidenceSource || requirement.evidenceSource || existing.githubEvidenceSource || existing.evidenceSource,
    testCommands: parseCommandList(requirement.testCommands || existing.testCommands),
    riskLevel: requirement.riskLevel || existing.riskLevel || null,
    productionSafe: requirement.productionSafe === true || existing.productionSafe === true,
    productionSafetyEvidence: requirement.productionSafetyEvidence || requirement.productionSafetyEvidencePath || existing.productionSafetyEvidence || existing.productionSafetyEvidencePath || null,
    autoMerge: requirement.autoMerge === true || existing.autoMerge === true,
    rollbackTarget: requirement.rollbackTarget || existing.rollbackTarget || null,
    rollbackPlan: requirement.rollbackPlan || existing.rollbackPlan || null,
    rollbackEvidence: requirement.rollbackEvidence || requirement.rollbackEvidencePath || existing.rollbackEvidence || existing.rollbackEvidencePath || null,
    rollbackVerified: requirement.rollbackVerified === true || existing.rollbackVerified === true,
    deploymentUrl: requirement.deploymentUrl || existing.deploymentUrl || null,
    productionUrl: requirement.productionUrl || existing.productionUrl || null,
    releaseEnv: requirement.releaseEnv || existing.releaseEnv || null,
    healthCheckPath: requirement.healthCheckPath || existing.healthCheckPath || null,
    requireHealthCommit: requirement.requireHealthCommit === true || existing.requireHealthCommit === true,
    releaseArtifactCommands: requirement.releaseArtifactCommands || existing.releaseArtifactCommands || null,
    releaseArtifactDir: requirement.releaseArtifactDir || existing.releaseArtifactDir || null,
    useExistingReleaseArtifacts: requirement.useExistingReleaseArtifacts === true || existing.useExistingReleaseArtifacts === true,
    candidateProofPath: requirement.candidateProofPath || requirement.realDeliveryCandidateProofPath || existing.candidateProofPath || existing.realDeliveryCandidateProofPath || null,
    finalEvidencePath: requirement.finalEvidencePath || requirement.realAutonomousDeliveryEvidencePath || requirement.realDeliveryFinalEvidencePath || existing.finalEvidencePath || existing.realAutonomousDeliveryEvidencePath || existing.realDeliveryFinalEvidencePath || null,
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => (
    value !== undefined && value !== null && value !== false && !(Array.isArray(value) && value.length === 0)
  )));
}

function itemRealDelivery(item = {}) { return item.realDelivery || item.metadata?.realDelivery || {}; }

function hasMeaningfulRealDeliveryValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '';
}

function hasFactoryItemRealDeliveryIntent(item = {}) {
  if (hasMeaningfulRealDeliveryValue(item.realDeliveryCandidateProofPath)) return true;
  const realDelivery = itemRealDelivery(item);
  return Object.entries(realDelivery).some(([key, value]) => (
    REAL_DELIVERY_INTENT_FIELDS.has(key) && hasMeaningfulRealDeliveryValue(value)
  ));
}

function configuredValue(options, optionName, envName, fallback) {
  if (Object.prototype.hasOwnProperty.call(options, optionName) && options[optionName] !== '') {
    return { value: options[optionName], source: optionName };
  }
  if (process.env[envName] != null && process.env[envName] !== '') {
    return { value: process.env[envName], source: envName };
  }
  return { value: fallback, source: 'default' };
}

function positiveIntegerConfig(options, optionName, envName, fallback) {
  const { value, source } = configuredValue(options, optionName, envName, fallback);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${source} must be a positive integer; got ${value}`);
  }
  return parsed;
}

function buildUrl(baseUrl, route) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
}

function makeBearerToken({ jwtSecret, tenantId, actorId, roles }) {
  const now = Math.floor(Date.now() / 1000);
  return signHmacJwt({
    sub: actorId,
    tenant_id: tenantId,
    roles,
    iat: now,
    exp: now + 300,
  }, jwtSecret);
}

function makeQueueId() {
  return `factory-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function makeForgeTaskId(queueId) {
  const suffix = String(queueId).replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()
    || crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TSK-GOLDEN${suffix}`;
}

function resolveFactoryQueueConfig(options = {}) {
  const queueBackend = String(options.queueBackend || process.env.FACTORY_QUEUE_BACKEND || 'postgres').trim().toLowerCase();
  if (!['postgres', 'file'].includes(queueBackend)) {
    throw new Error(`Unsupported FACTORY_QUEUE_BACKEND "${queueBackend}". Use "postgres" or "file".`);
  }
  const allowFileQueue = options.allowFileQueue === true
    || parseBooleanEnv(process.env.FACTORY_ALLOW_FILE_QUEUE, false);
  if (queueBackend === 'file' && !allowFileQueue) {
    throw new Error('FACTORY_QUEUE_BACKEND=file requires FACTORY_ALLOW_FILE_QUEUE=true or --allow-file-queue for local smoke fixtures');
  }
  return {
    queueBackend,
    allowFileQueue,
    pool: options.pool || null,
    factoryQueueDatabaseUrl: options.factoryQueueDatabaseUrl
      || options.databaseUrl
      || process.env.FACTORY_QUEUE_DATABASE_URL
      || process.env.DATABASE_URL,
    workerId: options.workerId || process.env.FACTORY_WORKER_ID || `factory-${process.pid}`,
    factoryQueueLeaseSeconds: positiveIntegerConfig(
      options, 'factoryQueueLeaseSeconds', 'FACTORY_QUEUE_LEASE_SECONDS', 900,
    ),
    factoryQueueRetryBaseSeconds: positiveIntegerConfig(
      options, 'factoryQueueRetryBaseSeconds', 'FACTORY_QUEUE_RETRY_BASE_SECONDS', 30,
    ),
    factoryQueueMaxAttempts: positiveIntegerConfig(
      options, 'factoryQueueMaxAttempts', 'FACTORY_QUEUE_MAX_ATTEMPTS', 5,
    ),
  };
}

function resolveFactoryReleaseArtifactConfig(options = {}) {
  return {
    releaseArtifactDir: options.releaseArtifactDir || process.env.RELEASE_ARTIFACT_DIR || null,
    useExistingReleaseArtifacts: options.useExistingReleaseArtifacts === true || parseBooleanEnv(process.env.USE_EXISTING_RELEASE_ARTIFACTS, false),
    releaseArtifactCommands: options.releaseArtifactCommands || {
      build: options.releaseBuildCommand || process.env.RELEASE_BUILD_COMMAND || '',
      compatibility: options.releaseCompatibilityCommand || process.env.RELEASE_COMPATIBILITY_COMMAND || '',
      vulnerability: options.releaseVulnerabilityCommand || process.env.RELEASE_VULNERABILITY_COMMAND || '',
      secret: options.releaseSecretCommand || process.env.RELEASE_SECRET_COMMAND || '',
    },
    releaseArtifactCommandTimeoutMs: options.releaseArtifactCommandTimeoutMs
      || process.env.RELEASE_ARTIFACT_COMMAND_TIMEOUT_MS
      || null,
    requireHealthyDeployment: options.requireHealthyDeployment !== false,
    requireHealthCommit: options.requireHealthCommit === true
      || parseBooleanEnv(process.env.REQUIRE_HEALTH_COMMIT, false),
  };
}

function resolveFactoryRealEvidenceConfig(options = {}) {
  const agentDrivenPhases = options.agentDrivenPhases === true
    || parseBooleanEnv(process.env.FF_FACTORY_AGENT_DRIVEN_PHASES, false);
  const proofProfile = String(options.proofProfile || process.env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  const factoryProofActive = proofProfile === 'live' || proofProfile === 'fixture';
  // Factory live/fixture proof uses agentDrivenPhases for OpenClaw specialists without
  // implying hosted PR/release real-evidence collection.
  const collectRealEvidence = options.collectRealEvidence === true
    || parseBooleanEnv(process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false)
    || (!factoryProofActive && agentDrivenPhases);
  const requireRealEvidence = options.requireRealEvidence === true
    || parseBooleanEnv(process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || (!factoryProofActive && agentDrivenPhases)
    || collectRealEvidence;
  const prNumber = Number(options.prNumber || process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || 0) || undefined;
  return {
    collectRealEvidence,
    requireRealEvidence,
    ciRepository: options.ciRepository || options.repository || process.env.CI_REPOSITORY || process.env.GITHUB_REPOSITORY || null,
    branchName: options.branchName || options.branch || process.env.BRANCH_NAME || process.env.GITHUB_HEAD_REF || null,
    implementationCommitSha: options.implementationCommitSha
      || options.commitSha
      || process.env.IMPLEMENTATION_COMMIT_SHA
      || process.env.COMMIT_SHA
      || process.env.GITHUB_SHA
      || null,
    commitSha: options.commitSha || process.env.COMMIT_SHA || process.env.GITHUB_SHA || null,
    prUrl: options.prUrl || process.env.PR_URL || process.env.GITHUB_PR_URL || null,
    prNumber,
    fixBranchName: options.fixBranchName || process.env.FIX_BRANCH_NAME || null,
    fixCommitSha: options.fixCommitSha || process.env.FIX_COMMIT_SHA || null,
    fixPrUrl: options.fixPrUrl || process.env.FIX_PR_URL || null,
    mergeCommitSha: options.mergeCommitSha || process.env.MERGE_COMMIT_SHA || null,
    autoMerge: options.autoMerge === true || parseBooleanEnv(process.env.FF_FACTORY_AUTO_MERGE, false),
    githubToken: options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null,
    githubApiBaseUrl: options.githubApiBaseUrl || process.env.GITHUB_API_BASE_URL || null,
    deploymentUrl: options.deploymentUrl || process.env.DEPLOYMENT_URL || null,
    productionUrl: options.productionUrl || process.env.PRODUCTION_URL || null,
    rollbackTarget: options.rollbackTarget || process.env.ROLLBACK_TARGET || null,
    rollbackPlan: options.rollbackPlan || process.env.ROLLBACK_PLAN || null,
    rollbackVerified: options.rollbackVerified === true || parseBooleanEnv(process.env.ROLLBACK_VERIFIED, false),
    ...resolveFactoryReleaseArtifactConfig(options),
    ...resolveFactoryCandidateConfig(options),
  };
}

function assertDurableQueueForRealEvidence(queueConfig = {}, realEvidenceConfig = {}) {
  if (queueConfig.queueBackend !== 'file' || realEvidenceConfig.requireRealEvidence !== true) return;
  throw new Error('Factory real-evidence runs require FACTORY_QUEUE_BACKEND=postgres; file queues are local smoke fixtures only');
}

function resolveFactoryBaseUrl(options = {}) {
  return String(options.baseUrl
    || process.env.FACTORY_STAGING_BASE_URL
    || process.env.STAGING_BASE_URL
    || process.env.FACTORY_BASE_URL
    || process.env.GOLDEN_PATH_BASE_URL
    || process.env.ENGINEERING_TEAM_BASE_URL
    || 'http://127.0.0.1:13000').trim();
}

function resolveFactoryCandidateConfig(options = {}) {
  const rollbackEvidence = options.realDeliveryRollbackEvidence
    || options.rollbackEvidence
    || process.env.REAL_DELIVERY_ROLLBACK_EVIDENCE
    || process.env.ROLLBACK_EVIDENCE
    || process.env.ROLLBACK_EVIDENCE_PATH
    || null;
  const productionSafetyEvidence = options.realDeliveryProductionSafetyEvidence
    || options.productionSafetyEvidence
    || process.env.REAL_DELIVERY_PRODUCTION_SAFETY_EVIDENCE
    || process.env.PRODUCTION_SAFETY_EVIDENCE
    || process.env.PRODUCTION_SAFETY_EVIDENCE_PATH
    || null;
  return {
    realDeliveryRiskLevel: options.realDeliveryRiskLevel || options.riskLevel || process.env.REAL_DELIVERY_RISK_LEVEL || null,
    realDeliveryProductionSafe: options.realDeliveryProductionSafe === true
      || options.productionSafe === true
      || parseBooleanEnv(process.env.REAL_DELIVERY_PRODUCTION_SAFE, false),
    realDeliveryProductionSafetyEvidence: productionSafetyEvidence,
    productionSafetyEvidence,
    realDeliveryTestCommands: parseCommandList(
      options.realDeliveryTestCommands || options.testCommands || process.env.REAL_DELIVERY_TEST_COMMANDS,
    ),
    realDeliveryCandidateProofPath: options.realDeliveryCandidateProofPath
      || options.candidateProofPath
      || process.env.REAL_DELIVERY_CANDIDATE_PROOF_PATH
      || null,
    realDeliveryHealthCheckPath: options.realDeliveryHealthCheckPath
      || options.healthCheckPath
      || process.env.REAL_DELIVERY_HEALTH_CHECK_PATH
      || null,
    realDeliveryMaxChangedFiles: options.realDeliveryMaxChangedFiles || options.maxChangedFiles || process.env.MAX_REAL_DELIVERY_CHANGED_FILES || null,
    realDeliveryRollbackEvidence: rollbackEvidence,
    rollbackEvidence,
    realDeliveryCandidateGitState: options.realDeliveryCandidateGitState || null,
    realDeliveryFetchImpl: options.realDeliveryFetchImpl || null,
    realDeliveryGithubFetchImpl: options.realDeliveryGithubFetchImpl || null,
    githubFetchImpl: options.githubFetchImpl || null,
    allowMockGitHubEvidence: options.allowMockGitHubEvidence === true,
    allowTestGitHubEvidenceInjection: options.allowTestGitHubEvidenceInjection === true,
    realDeliverySourceIntegrity: options.realDeliverySourceIntegrity || null,
    realAutonomousDeliveryVerifier: options.realAutonomousDeliveryVerifier || null,
    realAutonomousDeliveryBuilder: options.realAutonomousDeliveryBuilder || null,
    realAutonomousDeliveryEvidencePath: options.realAutonomousDeliveryEvidencePath || options.realDeliveryFinalEvidencePath || options.finalEvidencePath || process.env.REAL_AUTONOMOUS_DELIVERY_EVIDENCE || null,
  };
}

function resolveFactoryConfig(options = {}) {
  const baseUrl = resolveFactoryBaseUrl(options);
  const queueConfig = resolveFactoryQueueConfig(options);
  const realEvidenceConfig = resolveFactoryRealEvidenceConfig(options);
  assertDurableQueueForRealEvidence(queueConfig, realEvidenceConfig);
  const queuePath = options.queuePath || process.env.FACTORY_QUEUE_PATH || DEFAULT_QUEUE_PATH;
  if (queueConfig.queueBackend === 'file' && path.resolve(process.cwd(), queuePath) === path.resolve(process.cwd(), DEFAULT_QUEUE_PATH) && options.allowDefaultFileQueuePath !== true && !parseBooleanEnv(process.env.FACTORY_ALLOW_DEFAULT_FILE_QUEUE_PATH, false)) throw new Error('FACTORY_QUEUE_BACKEND=file requires a non-default FACTORY_QUEUE_PATH; observability/factory-delivery-queue.json is reserved for migrated Postgres marker files');

  return {
    env: options.env, fetchImpl: options.fetchImpl || globalThis.fetch,
    baseUrl,
    ...queueConfig,
    tenantId: String(options.tenantId || process.env.TENANT_ID || 'engineering-team').trim(),
    actorId: String(options.actorId || process.env.FACTORY_ACTOR_ID || 'factory-orchestrator').trim(),
    jwtSecret: options.jwtSecret || process.env.AUTH_JWT_SECRET || process.env.GOLDEN_PATH_JWT_SECRET,
    queuePath,
    deliveryDir: options.deliveryDir || process.env.FACTORY_DELIVERY_DIR || DEFAULT_DELIVERY_DIR,
    forgeAdapterUrl: String(options.forgeAdapterUrl || process.env.FORGEADAPTER_BASE_URL || 'http://127.0.0.1:14010').trim(),
    openclawUrl: String(options.openclawUrl || process.env.OPENCLAW_BASE_URL || '').trim(),
    hermesUrl: String(options.hermesUrl || process.env.HERMES_BASE_URL || '').trim(),
    operatorUrl: String(options.operatorUrl || process.env.FACTORY_OPERATOR_URL || 'http://127.0.0.1:15173').trim(),
    requireDelegationSmoke: options.skipDelegationSmoke === true
      ? false
      : parseBooleanEnv(
        options.requireDelegationSmoke
          ?? process.env.FF_FACTORY_REQUIRE_DELEGATION_SMOKE
          ?? process.env.FF_REAL_SPECIALIST_DELEGATION,
        true,
      ),
    skipValidation: options.skipValidation === true,
    forgeServiceToken: options.forgeServiceToken || process.env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token',
    forgeAdapterToken: options.forgeAdapterToken || process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token',
    runPhasesFn: options.runPhasesFn || null,
    skipForgeSeed: options.skipForgeSeed === true,
    allowForgeSkip: options.allowForgeSkip === true
      || parseBooleanEnv(process.env.FACTORY_ALLOW_FORGE_SKIP, false),
    releaseEnv: options.releaseEnv || process.env.RELEASE_ENV || null, changeKind: options.changeKind || process.env.CHANGE_KIND || null,
    changeReversibility: options.changeReversibility || process.env.CHANGE_REVERSIBILITY || null,
    changedFiles: options.changedFiles || null, checks: options.checks || null, requiredChecks: options.requiredChecks || null, branchProtection: options.branchProtection || null, mergeReadiness: options.mergeReadiness || null,
    githubEvidenceSource: options.githubEvidenceSource || options.evidenceSource || null,
    ...realEvidenceConfig,
    agentDrivenPhase1: options.agentDrivenPhase1 === true || parseBooleanEnv(process.env.FF_FACTORY_AGENT_DRIVEN_PHASE1, false),
    agentDrivenPhases: options.agentDrivenPhases === true
      || parseBooleanEnv(process.env.FF_FACTORY_AGENT_DRIVEN_PHASES, false),
    factoryRequirements: options.factoryRequirements || options.requirements || null,
    skipPilotAgentsSeed: options.skipPilotAgentsSeed === true,
    useVersionedTaskApi: typeof options.useVersionedTaskApi === 'boolean'
      ? options.useVersionedTaskApi
      : !baseUrl.includes('127.0.0.1:13000') && !baseUrl.includes('localhost:13000'),
  };
}

function evidencePathForItem(item, deliveryDir = DEFAULT_DELIVERY_DIR) {
  return path.join(deliveryDir, `${item.id}.json`);
}

function persistDirForItem(item, deliveryDir = DEFAULT_DELIVERY_DIR) {
  const taskId = item.taskId || item.id;
  return path.join(deliveryDir, 'stack', taskId);
}

function normalizeRequirement(requirement = {}, index = 0) {
  const title = String(requirement.title || requirement.summary || `Factory requirement ${index + 1}`).trim();
  const body = String(
    requirement.requirements
    || requirement.description
    || requirement.body
    || requirement.text
    || '',
  ).trim();
  if (!body) {
    throw new Error(`Requirement "${title}" is missing requirements text`);
  }
  return {
    id: normalizeOptionalText(requirement.id) || makeQueueId(),
    title,
    requirements: body,
    templateTier: requirement.templateTier || requirement.tier || 'Simple',
    changeKind: requirement.changeKind || requirement.kind || null,
    changedFiles: Array.isArray(requirement.changedFiles) ? requirement.changedFiles : null,
    githubIssueUrl: requirement.githubIssueUrl || requirement.issueUrl || null,
    metadata: { ...(requirement.metadata || {}), realDelivery: realDeliveryMetadata(requirement) },
  };
}

async function apiSend(ctx, route, method, roles, body) {
  const response = await ctx.fetchImpl(buildUrl(ctx.baseUrl, route), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${makeBearerToken({ ...ctx, roles })}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    ok: response.ok,
    body: await response.json().catch(() => ({})),
  };
}
function data(result) { return result?.body?.data; }

function normalizeOptionalText(value) { const text = String(value || '').trim(); return text || null; }

module.exports = {
  DEFAULT_QUEUE_PATH, DEFAULT_DELIVERY_DIR,
  parseBooleanEnv, parseCommandList, buildUrl, makeQueueId, makeForgeTaskId,
  realDeliveryMetadata, hasFactoryItemRealDeliveryIntent, itemRealDelivery,
  resolveFactoryQueueConfig, resolveFactoryRealEvidenceConfig, resolveFactoryConfig,
  assertActiveFactoryQueueFile, isMigratedFactoryQueueMarker, loadFactoryQueue, saveFactoryQueue,
  evidencePathForItem, persistDirForItem,
  normalizeRequirement, apiSend, data,
};
