'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const playwrightRunner = path.join(__dirname, 'run-playwright.js');

function runPlaywright(args) {
  const result = spawnSync(process.execPath, [playwrightRunner, ...args], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function browserGateInvocations(env = process.env, forwardedArgs = []) {
  const invocations = [];
  if (env.PERFORMANCE_EVIDENCE_COMPLETE !== '1') {
    invocations.push(['tests/browser/browser-quality-performance.browser.spec.ts']);
  }
  invocations.push([
    '--grep-invert=browser Core Web Vitals budget gate',
    ...forwardedArgs,
  ]);
  return invocations;
}

if (require.main === module) {
  for (const invocation of browserGateInvocations(process.env, process.argv.slice(2))) {
    runPlaywright(invocation);
  }
}

module.exports = { browserGateInvocations };
