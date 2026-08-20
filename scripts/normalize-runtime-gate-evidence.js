#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildExecutableComponent } = require('../lib/release-gates/executable-evidence');
const { stagingEndpointUrl } = require('../lib/release-gates/staging-deployment');

const ENDPOINT_MODES = new Set(['hosted', 'host-local']);

const COMMANDS = Object.freeze({
  graphile: Object.freeze({
    contract: 'node-test:job-runtime-contract.v1',
    security: 'npm-audit-and-node-test:job-runtime-security.v1',
    performance_2x_10m: 'node:job-runtime-load-2x-10m.v1',
    chaos: 'node-test:job-runtime-chaos.v1',
    dr_restore: 'docker:composed-backup-restore.v1',
    synthetic_lifecycle: 'https:factory-lifecycle-three-pass.v1',
    alerts: 'node-test:job-runtime-alert-routing.v1',
    kill_switch: 'node-test:job-runtime-kill-switch.v1',
    rollback: 'node-test:exclusive-runtime-rollback.v1',
    composed_runtime: 'node-test:graphile-composed-runtime.v1',
  }),
  langgraph: Object.freeze({
    contract: 'node-test:langgraph-contract.v1',
    security: 'npm-audit-and-node-test:langgraph-security.v1',
    performance_2x_10m: 'node:langgraph-load-2x-10m.v1',
    chaos: 'node-test:langgraph-chaos.v1',
    dr_restore: 'docker:composed-backup-restore.v1',
    synthetic_lifecycle: 'https:factory-lifecycle-three-pass.v1',
    alerts: 'node-test:langgraph-alert-routing.v1',
    kill_switch: 'node-test:langgraph-kill-switch.v1',
    rollback: 'node-test:exclusive-runtime-rollback.v1',
    checkpoint_retention: 'postgres:langgraph-checkpoint-retention.v1',
    browser: 'playwright:hosted-staging.v1',
  }),
});

const COMMAND_LINES = Object.freeze({
  contract: 'node --test <runtime-contract-suite>',
  security: 'npm audit --omit=dev --json && node --test <runtime-security-suite>',
  performance_2x_10m: 'DATABASE_URL=<protected> node <runtime-load-runner> --duration=600s --load=2x',
  chaos: 'node --test <runtime-chaos-suite>',
  dr_restore: 'LANGGRAPH_INTEGRATION_SCOPE=focused bash scripts/run-postgres-integration-docker.sh',
  synthetic_lifecycle: 'node scripts/verify-factory-staging-smoke.js --base-url <protected-https> (three runs)',
  alerts: 'node --test <runtime-alert-routing-suite>',
  kill_switch: 'node --test <runtime-kill-switch-suite>',
  rollback: 'node --test tests/unit/runtime-cutover*.test.js',
  composed_runtime: 'node --test <graphile-composed-runtime-suite>',
  checkpoint_retention: 'node --test <langgraph-checkpoint-retention-suite>',
  browser: 'RUNTIME_BROWSER_BASE_URL=<protected-https> node scripts/run-browser-gates.js',
});

const THRESHOLDS = Object.freeze({
  contract: { failures: 0 }, security: { high: 0, critical: 0 },
  performance_2x_10m: { durationSeconds: 600, loadFactor: 2 },
  chaos: { duplicateEffects: 0, recovered: true },
  dr_restore: { rtoSecondsMax: 900, rpo: 'last-committed-boundary' },
  synthetic_lifecycle: { passesMin: 3, failures: 0 },
  alerts: { deliveryVerified: true, rulesTested: true },
  kill_switch: { stopSecondsMax: 120, legacyInvoked: false },
  rollback: { exclusiveOwnership: true, duplicateEffects: 0 },
  composed_runtime: { failures: 0 }, checkpoint_retention: { failures: 0 },
  browser: { failures: 0, flaky: 0 },
});

function values(argv, name) {
  const found = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}` && argv[index + 1]) found.push(argv[index + 1]);
  }
  return found;
}

function value(argv, name) {
  return values(argv, name).at(-1) || null;
}

function exactRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function deployedStagingUrl(valueToParse, name, endpointMode) {
  if (!ENDPOINT_MODES.has(endpointMode)) throw new Error('STAGING_ENDPOINT_MODE must be hosted or host-local.');
  const parsed = stagingEndpointUrl(String(valueToParse || ''), endpointMode);
  if (!parsed) {
    throw new Error(endpointMode === 'host-local'
      ? `${name} must be a credential-free HTTP(S) loopback endpoint in host-local mode.`
      : `${name} must be a credential-free, non-local HTTPS endpoint in hosted mode.`);
  }
  return parsed;
}

function configuration(argv = process.argv.slice(2), env = process.env) {
  const runtime = value(argv, 'runtime');
  const kind = value(argv, 'kind');
  const revision = String(env.STAGING_REVISION || '').trim();
  const endpointMode = String(env.STAGING_ENDPOINT_MODE || 'hosted').trim().toLowerCase();
  deployedStagingUrl(env.STAGING_BASE_URL, 'STAGING_BASE_URL', endpointMode);
  if (kind === 'browser') deployedStagingUrl(env.STAGING_BROWSER_BASE_URL, 'STAGING_BROWSER_BASE_URL', endpointMode);
  if (revision !== exactRevision()) throw new Error('STAGING_REVISION must equal the exact checked-out revision.');
  if (!COMMANDS[runtime]?.[kind]) throw new Error(`Unsupported executable gate: ${runtime || 'missing'}:${kind || 'missing'}.`);
  const automation = String(env.CI_JOB_URL || '').trim();
  if (!/^https?:\/\//.test(automation)) throw new Error('CI_JOB_URL is required for hosted evidence provenance.');
  return Object.freeze({
    runtime, kind, revision, automation, endpointMode,
    deploymentId: String(env.STAGING_DEPLOYMENT_ID || '').trim(),
    environment: 'staging',
    commandId: COMMANDS[runtime][kind],
    command: COMMAND_LINES[kind],
    thresholds: THRESHOLDS[kind],
    sourceFiles: values(argv, 'source').map((file) => path.resolve(file)),
    output: path.resolve(value(argv, 'output') || path.join('.artifacts', 'runtime-release', `${runtime}-${kind}.json`)),
  });
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function main() {
  const input = configuration();
  const component = buildExecutableComponent(input);
  writeJson(input.output, component);
  process.stdout.write(`${JSON.stringify({ output: input.output, runtime: input.runtime, kind: input.kind, digest: component.digest })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: 'runtime_gate_normalization_failed', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { COMMAND_LINES, COMMANDS, THRESHOLDS, configuration, deployedStagingUrl, main, value, values, writeJson };
