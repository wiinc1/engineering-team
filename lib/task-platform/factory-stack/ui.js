'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT, buildUiEnv } = require('./defaults');

function prepareUiAssets(env, options = {}, dependencies = {}) {
  if (options.skipUi === true) return Object.freeze({ built: false, reason: 'skipped' });
  if (env.NODE_ENV !== 'production') return Object.freeze({ built: false, reason: 'development' });
  const execute = dependencies.execFileSync || execFileSync;
  execute(dependencies.npmCommand || 'npm', ['run', 'build:browser'], {
    cwd: ROOT,
    env: { ...process.env, ...buildUiEnv(env) },
    stdio: dependencies.stdio || 'inherit',
  });
  const indexFile = path.join(ROOT, 'dist', 'index.html');
  const exists = dependencies.existsSync || fs.existsSync;
  if (!exists(indexFile)) throw new Error('Production UI build did not create dist/index.html.');
  return Object.freeze({ built: true, indexFile });
}

module.exports = { prepareUiAssets };
