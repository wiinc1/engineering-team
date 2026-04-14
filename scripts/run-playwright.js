const { spawnSync } = require('node:child_process');
const path = require('node:path');

const env = { ...process.env };

// Playwright forces worker color output internally, so browser-test child
// processes must not inherit NO_COLOR or Node will warn about the conflict.
if (Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')) {
  delete env.NO_COLOR;
}

const result = spawnSync(
  process.execPath,
  [
    path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'),
    'test',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env,
  },
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
