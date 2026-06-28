const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { handleForgeUxDelegationCompletion } = require('../../lib/task-platform/forge-ux-review-automation');

function createJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function shouldRunRealDelegation(env = process.env) {
  return parseBooleanEnv(env.FF_REAL_SPECIALIST_DELEGATION, false);
}

function resolveDelegationBaseDir(env = process.env) {
  return env.SPECIALIST_DELEGATION_BASE_DIR
    || env.SPECIALIST_DELEGATION_ARTIFACT_DIR
    || path.resolve(__dirname, '../..');
}

function buildDelegationRequest({ targetAgent, reason, packet, binding }) {
  const taskId = packet?.taskId || packet?.context?.taskId || 'local';
  const summary = packet?.execution?.summary || reason || `Implement forge task ${taskId}`;
  const acceptanceCriteria = Array.isArray(packet?.execution?.acceptanceCriteria)
    ? packet.execution.acceptanceCriteria
    : [];
  const criteriaText = acceptanceCriteria.length
    ? acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '';
  const worktreePath = binding?.worktreePath || binding?.repoPath || null;
  return [
    `You are the ${targetAgent} specialist delegated for forge task ${taskId}.`,
    reason || '',
    summary,
    criteriaText ? `Acceptance criteria:\n${criteriaText}` : '',
    worktreePath ? `Worktree: ${worktreePath}` : '',
    'Complete the assigned specialist work in the bound repository context.',
  ].filter(Boolean).join('\n\n');
}

function spawnSpecialistDelegation({ targetAgent, reason, packet, binding }, env = process.env) {
  const runner = env.SPECIALIST_DELEGATION_RUNNER;
  if (!runner || !shouldRunRealDelegation(env)) {
    return null;
  }

  const delegationId = crypto.randomUUID();
  const payload = {
    specialist: targetAgent,
    request: buildDelegationRequest({ targetAgent, reason, packet, binding }),
    delegationId,
    context: {
      taskId: packet?.taskId || packet?.context?.taskId || null,
      targetAgent,
      binding: binding || null,
      source: 'openclaw-mock',
    },
  };

  const configuredTimeout = Number(
    env.SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS
    || env.SPECIALIST_DELEGATION_RUNNER_TIMEOUT_MS
    || 0,
  );
  const openclawTimeoutMs = Number(env.OPENCLAW_DELEGATION_TIMEOUT_SEC || 0) * 1000;
  const timeoutMs = configuredTimeout > 0
    ? configuredTimeout
    : Math.max(openclawTimeoutMs + 30_000, 600_000);
  const child = spawn(runner, {
    env: {
      ...env,
      OPENCLAW_DELEGATION_SESSION_ID: env.OPENCLAW_DELEGATION_SESSION_ID
        || `forge-delegation-${delegationId}`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    cwd: resolveDelegationBaseDir(env),
  });

  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  child.stdin.end();

  child.on('close', (code) => {
    clearTimeout(timer);
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      source: 'openclaw-mock',
      event: code === 0 ? 'forge.delegation.succeeded' : 'forge.delegation.failed',
      targetAgent,
      taskId: payload.context.taskId,
      delegationId,
      exitCode: code,
      stdout: stdout.slice(0, 4000),
      stderr: stderr.slice(0, 4000),
    });
    process.stdout.write(`${line}\n`);

    handleForgeUxDelegationCompletion({
      taskId: payload.context.taskId,
      targetAgent,
      exitCode: code,
      delegationId,
      stdout,
      stderr,
      env,
    }).then((result) => {
      process.stdout.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        source: 'openclaw-mock',
        event: 'forge.ux_review_automation',
        taskId: payload.context.taskId,
        targetAgent,
        ...result,
      })}\n`);
    }).catch((error) => {
      process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        source: 'openclaw-mock',
        event: 'forge.ux_review_automation_failed',
        taskId: payload.context.taskId,
        targetAgent,
        error: error?.message || String(error),
      })}\n`);
    });
  });

  return { delegationId, targetAgent };
}

async function startMockServer(name, port, handler) {
  const server = http.createServer(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      createJsonResponse(response, 500, { error: error.message });
    }
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    name,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function startOpenClawMock(port, options = {}) {
  const env = { ...process.env, ...options.env };
  return startMockServer('openclaw-mock', port, async (request, response) => {
    const url = request.url || '';
    if (request.method === 'GET' && url === '/health') {
      createJsonResponse(response, 200, {
        status: 'ok',
        service: 'openclaw-mock',
        realDelegation: shouldRunRealDelegation(env),
      });
      return;
    }
    if (request.method === 'POST' && url === '/sessions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      createJsonResponse(response, 200, {
        sessionId: `sess_${payload.packet?.taskId || payload.taskId || 'local'}_${payload.owner || 'main'}`,
      });
      return;
    }
    if (request.method === 'POST' && /^\/sessions\/[^/]+\/children$/.test(url)) {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      const targetAgent = String(payload.targetAgent || 'specialist').replace(/[^a-z0-9_-]/gi, '_');
      const taskId = payload.packet?.taskId || payload.packet?.context?.taskId || 'local';
      const fallbackSessionId = `child_${taskId}_${targetAgent}_1`;

      const delegation = spawnSpecialistDelegation({
        targetAgent: payload.targetAgent || targetAgent,
        reason: payload.reason,
        packet: payload.packet,
        binding: payload.binding,
      }, env);

      createJsonResponse(response, 200, {
        sessionId: fallbackSessionId,
        delegated: delegation != null,
        delegationId: delegation?.delegationId || null,
      });
      return;
    }
    if (request.method === 'POST' && /^\/sessions\/[^/]+\/notifications$/.test(url)) {
      createJsonResponse(response, 200, { accepted: true });
      return;
    }
    createJsonResponse(response, 404, { error: 'not_found' });
  });
}

async function startHermesMock(port) {
  return startMockServer('hermes-mock', port, async (request, response) => {
    const url = request.url || '';
    if (request.method === 'GET' && url === '/health') {
      createJsonResponse(response, 200, { status: 'ok', service: 'hermes-mock' });
      return;
    }
    if (request.method === 'POST' && /^\/tasks\/[^/]+\/memory$/.test(url)) {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      createJsonResponse(response, 200, {
        summary: payload.summary,
        phase: payload.phase,
        createdAt: payload.createdAt || new Date().toISOString(),
      });
      return;
    }
    if (request.method === 'GET' && /^\/tasks\/[^/]+\/memory\/latest$/.test(url)) {
      createJsonResponse(response, 404, { error: 'not_found' });
      return;
    }
    createJsonResponse(response, 404, { error: 'not_found' });
  });
}

module.exports = {
  buildDelegationRequest,
  parseBooleanEnv,
  shouldRunRealDelegation,
  spawnSpecialistDelegation,
  startOpenClawMock,
  startHermesMock,
};