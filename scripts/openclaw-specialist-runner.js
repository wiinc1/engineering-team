#!/usr/bin/env node

const { spawn } = require('child_process');

const DEFAULT_SPECIALIST_MAP = Object.freeze({
  architect: 'architect',
  engineer: 'sr-engineer',
  qa: 'qa-engineer',
  sre: 'sre',
});

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function parsePayload(input) {
  try {
    return JSON.parse(input || '{}');
  } catch (error) {
    throw Object.assign(new Error('Delegation payload was not valid JSON'), {
      code: 'SPECIALIST_RUNTIME_INVALID_JSON',
      cause: error,
    });
  }
}

function resolveSpecialistMap(env = process.env) {
  const raw = env.OPENCLAW_SPECIALIST_MAP;
  if (!raw) {
    return { ...DEFAULT_SPECIALIST_MAP };
  }

  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SPECIALIST_MAP, ...parsed };
  } catch (error) {
    throw Object.assign(new Error('OPENCLAW_SPECIALIST_MAP must be valid JSON'), {
      code: 'SPECIALIST_RUNTIME_EXEC_FAILED',
      cause: error,
    });
  }
}

function resolveRuntimeAgent(specialist, env = process.env) {
  const specialistMap = resolveSpecialistMap(env);
  const mapped = specialistMap[specialist];
  if (!mapped || typeof mapped !== 'string' || !mapped.trim()) {
    throw Object.assign(new Error(`No OpenClaw agent mapping configured for specialist ${specialist}`), {
      code: 'SPECIALIST_RUNTIME_EXEC_FAILED',
    });
  }
  return mapped.trim();
}

function buildOpenClawArgs({ payload, runtimeAgent, env = process.env }) {
  const args = ['agent', '--json', '--agent', runtimeAgent, '--message', payload.request || ''];
  const timeout = env.OPENCLAW_DELEGATION_TIMEOUT_SEC || '60';
  if (timeout) {
    args.push('--timeout', timeout);
  }
  if (env.OPENCLAW_DELEGATION_LOCAL !== 'false') {
    args.push('--local');
  }
  return args;
}

function parseJsonFromStdout(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('OpenClaw returned no JSON output'), {
      code: 'SPECIALIST_RUNTIME_INVALID_JSON',
    });
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw Object.assign(new Error('OpenClaw output was not valid JSON'), {
    code: 'SPECIALIST_RUNTIME_INVALID_JSON',
  });
}

function extractSessionId(response) {
  const candidates = [
    response?.sessionId,
    response?.session_id,
    response?.session?.id,
    response?.meta?.agentMeta?.sessionId,
    response?.meta?.sessionId,
    response?.result?.sessionId,
    response?.result?.session_id,
    response?.result?.session?.id,
    response?.conversation?.sessionId,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function extractOutput(response) {
  const candidates = [
    response?.output,
    response?.reply,
    response?.message,
    response?.payloads?.[0]?.text,
    response?.result?.output,
    response?.result?.reply,
    response?.result?.message,
  ];
  return candidates.find((value) => typeof value === 'string') || '';
}

function runOpenClaw(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(env.OPENCLAW_BIN || 'openclaw', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(Object.assign(new Error(`Failed to start OpenClaw: ${error.message}`), {
        code: 'SPECIALIST_RUNTIME_EXEC_FAILED',
      }));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(Object.assign(new Error(stderr.trim() || `OpenClaw exited with code ${code}`), {
          code: 'SPECIALIST_RUNTIME_EXEC_FAILED',
        }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function buildBridgeResponse({ payload, runtimeAgent, response }) {
  const sessionId = extractSessionId(response);
  if (!sessionId) {
    throw Object.assign(new Error('OpenClaw response did not include session evidence'), {
      code: 'SPECIALIST_RUNTIME_MISSING_EVIDENCE',
    });
  }

  return {
    agentId: runtimeAgent,
    sessionId,
    output: extractOutput(response),
    ownership: {
      specialistId: payload.specialist,
      runtimeAgentId: runtimeAgent,
      sessionId,
      response,
    },
  };
}

async function main() {
  const payload = parsePayload(await readStdin());
  const runtimeAgent = resolveRuntimeAgent(payload.specialist);
  const args = buildOpenClawArgs({ payload, runtimeAgent });
  const { stdout, stderr } = await runOpenClaw(args);
  const response = parseJsonFromStdout(stdout || stderr);
  process.stdout.write(`${JSON.stringify(buildBridgeResponse({ payload, runtimeAgent, response }))}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SPECIALIST_MAP,
  buildBridgeResponse,
  buildOpenClawArgs,
  extractOutput,
  extractSessionId,
  parseJsonFromStdout,
  parsePayload,
  resolveRuntimeAgent,
  resolveSpecialistMap,
};
