const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { signHmacJwt } = require('../auth/jwt');

const DEFAULT_QUEUE_PATH = 'observability/factory-delivery-queue.json';
const DEFAULT_DELIVERY_DIR = 'observability/factory-delivery';

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
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

function resolveFactoryConfig(options = {}) {
  const baseUrl = String(
    options.baseUrl
    || process.env.FACTORY_BASE_URL
    || process.env.GOLDEN_PATH_BASE_URL
    || process.env.ENGINEERING_TEAM_BASE_URL
    || 'http://127.0.0.1:13000',
  ).trim();

  return {
    fetchImpl: options.fetchImpl || fetch,
    baseUrl,
    tenantId: String(options.tenantId || process.env.TENANT_ID || 'engineering-team').trim(),
    actorId: String(options.actorId || process.env.FACTORY_ACTOR_ID || 'factory-orchestrator').trim(),
    jwtSecret: options.jwtSecret || process.env.AUTH_JWT_SECRET || process.env.GOLDEN_PATH_JWT_SECRET,
    queuePath: options.queuePath || process.env.FACTORY_QUEUE_PATH || DEFAULT_QUEUE_PATH,
    deliveryDir: options.deliveryDir || process.env.FACTORY_DELIVERY_DIR || DEFAULT_DELIVERY_DIR,
    forgeAdapterUrl: String(options.forgeAdapterUrl || process.env.FORGEADAPTER_BASE_URL || 'http://127.0.0.1:14010').trim(),
    openclawUrl: String(options.openclawUrl || process.env.OPENCLAW_BASE_URL || '').trim(),
    hermesUrl: String(options.hermesUrl || process.env.HERMES_BASE_URL || '').trim(),
    operatorUrl: String(options.operatorUrl || process.env.FACTORY_OPERATOR_URL || 'http://127.0.0.1:15173').trim(),
    requireDelegationSmoke: parseBooleanEnv(
      options.requireDelegationSmoke ?? process.env.FF_REAL_SPECIALIST_DELEGATION,
      false,
    ),
    forgeServiceToken: options.forgeServiceToken || process.env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token',
    forgeAdapterToken: options.forgeAdapterToken || process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token',
    runPhasesFn: options.runPhasesFn || null,
    skipForgeSeed: options.skipForgeSeed === true,
  };
}

function loadFactoryQueue(queuePath = DEFAULT_QUEUE_PATH) {
  const resolved = path.resolve(process.cwd(), queuePath);
  if (!fs.existsSync(resolved)) {
    return { schemaVersion: '1.0', kind: 'factory-delivery-queue', items: [] };
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function saveFactoryQueue(queue, queuePath = DEFAULT_QUEUE_PATH) {
  const resolved = path.resolve(process.cwd(), queuePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(queue, null, 2)}\n`);
  return resolved;
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
    id: requirement.id || makeQueueId(),
    title,
    requirements: body,
    templateTier: requirement.templateTier || requirement.tier || 'Simple',
    githubIssueUrl: requirement.githubIssueUrl || requirement.issueUrl || null,
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

function data(result) {
  return result?.body?.data;
}

module.exports = {
  DEFAULT_QUEUE_PATH,
  DEFAULT_DELIVERY_DIR,
  parseBooleanEnv,
  buildUrl,
  makeQueueId,
  makeForgeTaskId,
  resolveFactoryConfig,
  loadFactoryQueue,
  saveFactoryQueue,
  evidencePathForItem,
  persistDirForItem,
  normalizeRequirement,
  apiSend,
  data,
};