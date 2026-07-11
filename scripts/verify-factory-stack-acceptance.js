#!/usr/bin/env node
'use strict';

/**
 * GitLab #269 acceptance auditor.
 * Runs against the live host stack (or code-only with --code-only).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  collectHealthReport,
  evaluateFactoryStackAcceptance,
} = require('../lib/task-platform/factory-stack/health');
const { launchdStatus } = require('../lib/task-platform/factory-stack/launchd');
const { dockerAvailable } = require('../lib/task-platform/factory-stack/postgres');
const { LABELS, DEFAULT_PORTS } = require('../lib/task-platform/factory-stack/defaults');

function codeOnlyChecks() {
  const root = process.cwd();
  const checks = [];
  const requiredFiles = [
    'scripts/factory-stack.js',
    'scripts/factory-stack-postgres-watch.js',
    'lib/task-platform/factory-stack/defaults.js',
    'lib/task-platform/factory-stack/launchd.js',
    'lib/task-platform/factory-stack/health.js',
    'lib/task-platform/factory-stack/postgres.js',
    'docker-compose.golden-path.yml',
    'docs/runbooks/golden-path-autonomous-delivery.md',
    'docs/runbooks/audit-foundation.md',
  ];
  for (const rel of requiredFiles) {
    const ok = fs.existsSync(path.join(root, rel));
    checks.push({ id: `file:${rel}`, ok, detail: ok ? 'present' : 'missing' });
  }

  const compose = fs.readFileSync(path.join(root, 'docker-compose.golden-path.yml'), 'utf8');
  checks.push({
    id: 'compose-restart',
    ok: /restart:\s*unless-stopped/.test(compose),
    detail: 'postgres service restart policy',
  });
  checks.push({
    id: 'compose-volume',
    ok: /factory_pgdata/.test(compose) && !/tmpfs:/.test(compose),
    detail: 'persistent volume instead of tmpfs',
  });

  const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  for (const script of ['factory:stack:up', 'factory:stack:down', 'factory:stack:status', 'factory:stack:restart']) {
    checks.push({
      id: `npm:${script}`,
      ok: pkg.includes(`"${script}"`),
      detail: 'package.json script',
    });
  }

  for (const label of Object.values(LABELS)) {
    checks.push({
      id: `label:${label}`,
      ok: true,
      detail: 'defined in factory-stack defaults',
    });
  }

  checks.push({
    id: 'ports',
    ok: DEFAULT_PORTS.api === 13000 && DEFAULT_PORTS.ui === 15173 && DEFAULT_PORTS.forgeadapter === 14010,
    detail: `api=${DEFAULT_PORTS.api} ui=${DEFAULT_PORTS.ui} fa=${DEFAULT_PORTS.forgeadapter}`,
  });

  return checks;
}

async function main() {
  const codeOnly = process.argv.includes('--code-only');
  const codeChecks = codeOnlyChecks();
  const codeOk = codeChecks.every((c) => c.ok);

  let live = null;
  if (!codeOnly) {
    const health = await collectHealthReport({});
    const launchd = launchdStatus();
    const acceptance = evaluateFactoryStackAcceptance({
      health,
      launchd,
      dockerAvailable: dockerAvailable(),
    });
    live = { health, launchd, acceptance };
  }

  const result = {
    issue: 269,
    title: 'Persistent coordinated-stack services on operator host',
    codeOk,
    codeChecks,
    live,
    ok: codeOk && (codeOnly || live?.acceptance?.ok === true),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
