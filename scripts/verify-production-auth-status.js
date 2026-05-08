#!/usr/bin/env node
const {
  validateProductionAuthStatus,
} = require('../lib/auth/production-status');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const selectedStrategy = readArg('--strategy', process.env.AUTH_PROD_AUTH_STRATEGY || 'magic-link');
const evidencePath = readArg('--evidence', process.env.AUTH_PROD_EVIDENCE_OUT || '');
const requireComplete = hasFlag('--require-complete');
const options = {
  selectedStrategy,
  requireComplete,
};
if (evidencePath) options.evidencePath = evidencePath;
const result = validateProductionAuthStatus(options);

const response = {
  ok: result.ok,
  requireComplete,
  selectedStrategy: result.selectedStrategy,
  docsOk: result.docs.ok,
  evidenceOk: result.evidence.ok,
  docFailures: result.docs.failures,
  evidenceFailures: result.evidence.failures,
};

process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);

if (!result.ok) {
  process.exitCode = 1;
}
