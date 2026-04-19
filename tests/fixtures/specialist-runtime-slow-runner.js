#!/usr/bin/env node

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

async function main() {
  const payload = JSON.parse(await readStdin() || '{}');
  const delayMs = Number(process.env.FIXTURE_RUNTIME_DELAY_MS || 100);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  process.stdout.write(`${JSON.stringify({
    agentId: payload.specialist || 'engineer',
    sessionId: `runtime-session-${payload.delegationId || 'slow'}`,
    output: 'slow runtime response',
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
