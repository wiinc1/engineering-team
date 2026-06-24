#!/usr/bin/env node
const { resolveRuntimeAgent } = require('../../scripts/openclaw-specialist-runner');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  if (process.env.FIXTURE_RUNTIME_MODE === 'fail') {
    console.error('specialist offline');
    process.exit(2);
    return;
  }
  if (process.env.FIXTURE_RUNTIME_MODE === 'invalid-json') {
    process.stdout.write('not-json');
    return;
  }
  if (process.env.FIXTURE_RUNTIME_MODE === 'missing-evidence') {
    process.stdout.write(JSON.stringify({
      output: 'runtime responded without ownership evidence',
    }));
    return;
  }
  const runtimeAgentId = process.env.FIXTURE_RUNTIME_AGENT_ID || resolveRuntimeAgent(payload.specialist);
  const sessionId = process.env.FIXTURE_RUNTIME_SESSION_ID || `runtime-session-${payload.delegationId}`;
  process.stdout.write(JSON.stringify({
    agentId: runtimeAgentId,
    sessionId,
    output: `runtime handled by ${runtimeAgentId}`,
    ownership: {
      specialistId: payload.specialist,
      runtimeAgentId,
      sessionId,
      runtime: 'fixture-openclaw',
    },
  }));
});
