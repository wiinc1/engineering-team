const { spawn } = require('child_process');

function resolveRunnerTimeoutMs(options = {}, env = process.env) {
  const raw = options.delegationRunnerTimeoutMs
    ?? options.runnerTimeoutMs
    ?? env.SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS
    ?? env.SPECIALIST_DELEGATION_RUNNER_TIMEOUT_MS;
  if (raw === undefined || raw === null || raw === '') return 20000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

function parseJson(input, label) {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw Object.assign(new Error(`Runtime ${label} was not valid JSON`), {
      code: 'SPECIALIST_RUNTIME_INVALID_JSON',
      cause: error,
    });
  }
}

function normalizeRuntimeEvidence(result = {}) {
  const evidence = result && typeof result === 'object' ? result : {};
  const agentId = typeof evidence.agentId === 'string' ? evidence.agentId.trim() : '';
  const sessionId = typeof evidence.sessionId === 'string' ? evidence.sessionId.trim() : '';
  if (!agentId || !sessionId) {
    throw Object.assign(new Error('Runtime delegation evidence must include agentId and sessionId'), {
      code: 'SPECIALIST_RUNTIME_MISSING_EVIDENCE',
    });
  }
  return {
    agentId,
    sessionId,
    output: typeof evidence.output === 'string' ? evidence.output : '',
    ownership: evidence.ownership && typeof evidence.ownership === 'object' ? evidence.ownership : { agentId, sessionId },
    raw: evidence,
  };
}

function createRuntimeDelegateWork(options = {}) {
  if (typeof options.runner === 'function') {
    return async (payload) => normalizeRuntimeEvidence(await options.runner(payload));
  }

  const command = options.delegationRunnerCommand || process.env.SPECIALIST_DELEGATION_RUNNER;
  if (!command) {
    return async () => {
      throw Object.assign(new Error('Specialist runtime delegation is not configured'), {
        code: 'SPECIALIST_RUNTIME_NOT_CONFIGURED',
      });
    };
  }

  return async (payload) => {
    const env = { ...process.env, ...options.runnerEnv };
    const timeoutMs = resolveRunnerTimeoutMs(options, env);
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(command, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: options.baseDir || process.cwd(),
      });
      let settled = false;
      let out = '';
      let err = '';
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(Object.assign(new Error(`Specialist runtime timed out after ${timeoutMs}ms`), {
          code: 'SPECIALIST_RUNTIME_TIMEOUT',
        }));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        err += chunk.toString();
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(Object.assign(new Error(`Failed to start specialist runtime: ${error.message}`), {
          code: 'SPECIALIST_RUNTIME_EXEC_FAILED',
        }));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(Object.assign(new Error(err.trim() || `Specialist runtime exited with code ${code}`), {
            code: 'SPECIALIST_RUNTIME_EXEC_FAILED',
          }));
          return;
        }
        resolve(out);
      });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      child.stdin.end();
    });

    return normalizeRuntimeEvidence(parseJson(stdout, 'response'));
  };
}

module.exports = {
  createRuntimeDelegateWork,
  normalizeRuntimeEvidence,
  resolveRunnerTimeoutMs,
};
