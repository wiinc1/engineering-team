#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateAuthConfig } = require('../lib/auth/config-check');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function printResult(result) {
  if (result.ok) {
    console.log(`Auth config check passed for ${result.target}.`);
  } else {
    console.error(`Auth config check failed for ${result.target}.`);
  }
  if (result.missing.length) {
    console.error(`Missing required variables: ${result.missing.join(', ')}`);
  }
  for (const error of result.errors) {
    console.error(error);
  }
}

try {
  if (hasFlag('--vercel')) {
    console.error('Vercel auth-config checks were removed. The factory stack is operator-hosted.');
    console.error('Use: node scripts/check-auth-config.js --target production');
    process.exitCode = 1;
  } else {
    const target = readArg('--target', process.env.AUTH_CONFIG_TARGET || process.env.NODE_ENV || 'production');
    const artifactPath = readArg('--artifact', 'observability/auth-config-diagnostics.json');
    const result = validateAuthConfig({ env: process.env, target });

    if (hasFlag('--write-artifact')) {
      writeJson(artifactPath, {
        target: result.target,
        ok: result.ok,
        missing: result.missing,
        errors: result.errors,
        diagnostics: result.diagnostics,
      });
      console.log(`Wrote non-secret auth diagnostics artifact: ${artifactPath}`);
    }

    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
