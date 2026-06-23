const fs = require('node:fs');
const path = require('node:path');
const { signHmacJwt } = require('../auth/jwt');

const DEFAULT_OUTPUT = 'observability/golden-path-pilot.json';
const DEFAULT_FORGE_TASK_ID = 'TSK-GOLDEN001';
const DEFAULT_FORGE_SERVICE_TOKEN = 'local-forge-smoke-token';
const DEFAULT_FORGE_ADAPTER_TOKEN = 'local-forgeadapter-token';

function buildUrl(baseUrl, route) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
}

function loadPilotEvidence(outputPath = DEFAULT_OUTPUT) {
  const resolved = path.resolve(process.cwd(), outputPath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function savePilotEvidence(evidence, outputPath = DEFAULT_OUTPUT) {
  const resolved = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`);
  return resolved;
}

function mergeStepsCompleted(existing = [], added = []) {
  const order = (id) => Number(String(id).replace(/^GP-/, ''));
  return [...new Set([...existing, ...added])].sort((a, b) => order(a) - order(b));
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

async function apiGet(ctx, route, roles = ['reader']) {
  return apiSend(ctx, route, 'GET', roles);
}

async function apiSendServiceToken(baseUrl, route, method, token, body) {
  const response = await fetch(buildUrl(baseUrl, route), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    ok: response.ok,
    body: await response.json().catch(() => ({})),
  };
}

function resolveForgeadapterDir() {
  const candidates = [
    process.env.FORGEADAPTER_DIR,
    path.resolve(process.cwd(), '../forgeadapter'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return path.resolve(candidate);
    }
  }
  return null;
}

function requireForgeHarness() {
  const forgeDir = resolveForgeadapterDir();
  if (!forgeDir) {
    throw new Error('forgeadapter checkout is required (set FORGEADAPTER_DIR or use ../forgeadapter)');
  }
  const harnessPath = path.join(forgeDir, 'tests/helpers/local-stack-harness.js');
  const servicePath = path.join(forgeDir, 'tests/helpers/service-harness.js');
  const packetPath = path.join(forgeDir, 'tests/unit/runtime/packet-fixtures.js');
  return {
    forgeDir,
    harness: require(harnessPath),
    service: require(servicePath),
    packets: require(packetPath),
  };
}

async function pollForgeExecutionReadiness(baseUrl, forgeTaskId, forgeServiceToken, options = {}) {
  const deadline = Date.now() + Number(options.timeoutMs || 15000);
  let readiness = null;
  while (Date.now() < deadline) {
    readiness = await apiSendServiceToken(
      baseUrl,
      `/tasks/${encodeURIComponent(forgeTaskId)}/forge-execution-readiness`,
      'GET',
      forgeServiceToken,
    );
    if (readiness.ok) return readiness;
    await new Promise((resolve) => setTimeout(resolve, Number(options.intervalMs || 300)));
  }
  return readiness || { ok: false, status: 0, body: {} };
}

module.exports = {
  DEFAULT_OUTPUT,
  DEFAULT_FORGE_TASK_ID,
  DEFAULT_FORGE_SERVICE_TOKEN,
  DEFAULT_FORGE_ADAPTER_TOKEN,
  buildUrl,
  loadPilotEvidence,
  savePilotEvidence,
  mergeStepsCompleted,
  makeBearerToken,
  apiSend,
  apiGet,
  apiSendServiceToken,
  pollForgeExecutionReadiness,
  resolveForgeadapterDir,
  requireForgeHarness,
};