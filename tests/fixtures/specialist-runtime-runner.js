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
  const specialist = String(payload.specialist || '').trim().toLowerCase();
  let output = `runtime handled by ${runtimeAgentId}`;
  if (['jr-engineer', 'sr-engineer', 'engineer-jr', 'engineer-sr', 'principal', 'engineer-principal'].includes(specialist)) {
    output = JSON.stringify({
      commitSha: 'a'.repeat(40),
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
    });
  } else if (specialist === 'qa') {
    output = JSON.stringify({ outcome: 'pass', findings: [] });
  }
  process.stdout.write(JSON.stringify({
    agentId: runtimeAgentId,
    sessionId,
    output,
    ownership: {
      specialistId: payload.specialist,
      runtimeAgentId,
      sessionId,
      runtime: 'fixture-openclaw',
    },
  }));
});
