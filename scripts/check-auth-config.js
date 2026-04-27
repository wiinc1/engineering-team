#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  extractVercelEnvNames,
  validateAuthConfig,
  validateVercelEnvNames,
} = require('../lib/auth/config-check');

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

function readVercelEnvOutput() {
  const args = ['env', 'ls', 'production', '--format', 'json'];
  const direct = spawnSync('vercel', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!direct.error || direct.error.code !== 'ENOENT') return direct;
  return spawnSync('npx', ['vercel', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runLocalCheck() {
  const target = readArg('--target', process.env.AUTH_CONFIG_TARGET || process.env.VERCEL_ENV || 'production');
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

function runVercelCheck() {
  const fixturePath = readArg('--vercel-json', '');
  const json = fixturePath
    ? fs.readFileSync(fixturePath, 'utf8')
    : readVercelEnvOutput();

  if (typeof json !== 'string' && json.status !== 0) {
    console.error('Vercel production env-name validation failed to read name-only env output.');
    if (json.stderr) console.error(json.stderr.trim());
    process.exitCode = 1;
    return;
  }

  const names = extractVercelEnvNames(typeof json === 'string' ? json : json.stdout);
  const result = validateVercelEnvNames(names);
  if (result.ok) {
    console.log('Vercel production env-name validation passed.');
  } else {
    console.error('Vercel production env-name validation failed.');
    console.error(`Missing OIDC env names: ${result.oidcMissing.join(', ')}`);
    console.error(`Missing internal-bootstrap env names: ${result.internalBootstrapMissing.join(', ')}`);
    console.error(`Missing magic-link env names: ${result.magicLinkMissing.join(', ')}`);
  }
  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(JSON.stringify({
    ok: result.ok,
    oidcPresent: result.present,
    internalBootstrapPresent: result.internalBootstrapPresent,
    internalBootstrapVarsDeclared: result.internalBootstrapVarsDeclared,
    magicLinkPresent: result.magicLinkPresent,
    browserMagicLinkStrategyPresent: result.browserMagicLinkStrategyPresent,
  }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

try {
  if (hasFlag('--vercel')) {
    runVercelCheck();
  } else {
    runLocalCheck();
  }
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
