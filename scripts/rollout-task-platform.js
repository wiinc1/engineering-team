#!/usr/bin/env node
const { spawn } = require('child_process');

function runStep(name, command, args, env) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`[task-platform-rollout] starting ${name}\n`);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        process.stdout.write(`[task-platform-rollout] completed ${name}\n`);
        resolve();
        return;
      }
      reject(new Error(`${name} failed with exit code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const env = {
    ...process.env,
  };

  await runStep('migrate', process.execPath, ['scripts/migrate-audit-postgres.js'], env);
  await runStep('backfill', process.execPath, ['scripts/backfill-task-platform.js'], env);
  await runStep('verify', process.execPath, ['scripts/verify-task-platform-rollout.js'], env);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
