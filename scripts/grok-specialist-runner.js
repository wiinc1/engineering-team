#!/usr/bin/env node

'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const {
  DEFAULT_SPECIALIST_MAP,
  resolveRuntimeAgent,
} = require('../lib/software-factory/specialist-runtime-provider');
const {
  assertPayloadVersion,
  buildBridgeResponse,
  createRuntimeError,
  parseJsonFromStdout,
} = require('../lib/software-factory/specialist-runtime-bridge');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_SESSION_PREFIX = 'specialist-delegation-';

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
    const payload = JSON.parse(input || '{}');
    assertPayloadVersion(payload);
    return payload;
  } catch (error) {
    if (error.code) throw error;
    throw createRuntimeError('SPECIALIST_RUNTIME_INVALID_JSON', 'Delegation payload was not valid JSON', error);
  }
}

function stripLiveSessionPrefix(value) {
  const sessionId = String(value || '').trim();
  return sessionId.startsWith(LIVE_SESSION_PREFIX)
    ? sessionId.slice(LIVE_SESSION_PREFIX.length)
    : sessionId;
}

function toLiveEvidenceSessionId(value) {
  const sessionId = String(value || '').trim();
  if (!sessionId) return '';
  return sessionId.startsWith(LIVE_SESSION_PREFIX)
    ? sessionId
    : `${LIVE_SESSION_PREFIX}${sessionId}`;
}

function resolveSessionId(payload = {}) {
  const requested = stripLiveSessionPrefix(payload.sessionId || payload.session_id || '');
  if (UUID_RE.test(requested)) return requested;
  return crypto.randomUUID();
}

function resolveGrokBin(env = process.env) {
  return String(env.GROK_BIN || 'grok').trim() || 'grok';
}

function buildGrokArgs({ payload, runtimeAgent, sessionId, env = process.env }) {
  const args = [];
  if (runtimeAgent) {
    args.push('--agent', runtimeAgent);
  }
  args.push(
    '--output-format', 'json',
    '--session-id', sessionId,
    '--always-approve',
    '-p', payload.request || '',
  );
  const timeout = env.GROK_DELEGATION_TIMEOUT_SEC;
  if (timeout) {
    args.push('--max-turns', String(env.GROK_DELEGATION_MAX_TURNS || '8'));
  }
  return args;
}

function runGrok(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGrokBin(env), args, {
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
      reject(createRuntimeError('SPECIALIST_RUNTIME_EXEC_FAILED', `Failed to start Grok: ${error.message}`, error));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(createRuntimeError(
          'SPECIALIST_RUNTIME_EXEC_FAILED',
          stderr.trim() || `Grok exited with code ${code}`,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseGrokResponse(stdout, stderr) {
  const raw = String(stdout || '').trim() || String(stderr || '').trim();
  if (!raw) {
    throw createRuntimeError('SPECIALIST_RUNTIME_INVALID_JSON', 'Grok returned no output');
  }
  try {
    return parseJsonFromStdout(raw);
  } catch (error) {
    return { output: raw, message: raw };
  }
}

async function main() {
  const payload = parsePayload(await readStdin());
  const runtimeAgent = resolveRuntimeAgent(payload.specialist, process.env, 'GROK_SPECIALIST_MAP');
  const sessionId = resolveSessionId(payload);
  const args = buildGrokArgs({ payload, runtimeAgent, sessionId });
  const { stdout, stderr } = await runGrok(args);
  const response = parseGrokResponse(stdout, stderr);
  const bridge = buildBridgeResponse({
    payload,
    runtimeAgent,
    response,
    sessionIdFallback: sessionId,
    runtimeProvider: 'grok',
  });
  const evidenceSessionId = toLiveEvidenceSessionId(bridge.sessionId);
  bridge.sessionId = evidenceSessionId;
  if (bridge.ownership) bridge.ownership.sessionId = evidenceSessionId;
  process.stdout.write(`${JSON.stringify(bridge)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SPECIALIST_MAP,
  LIVE_SESSION_PREFIX,
  buildGrokArgs,
  parseGrokResponse,
  parsePayload,
  resolveGrokBin,
  resolveRuntimeAgent,
  resolveSessionId,
  stripLiveSessionPrefix,
  toLiveEvidenceSessionId,
};
