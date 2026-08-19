#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createPgPoolFromEnv } = require('../lib/audit/postgres');
const {
  createCutoverPlan, cutoverApprovalDigest, executeJointRuntimeCutover,
} = require('../lib/runtime-cutover');
const { evaluateRuntimeEvidence } = require('../lib/release-gates/runtime-evidence');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(name) {
  const file = arg(name);
  if (!file) throw new Error(`--${name} is required.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildPlan(inventory, manifest, runtime) {
  const releaseDecision = evaluateRuntimeEvidence(manifest, {
    runtime,
    revision: inventory.revision,
  });
  return createCutoverPlan({ ...inventory, mode: 'apply', releaseDecision });
}

function loadInputs() {
  if (!process.argv.includes('--apply')) throw new Error('Explicit --apply is required; use preflight commands for dry runs.');
  const jobsInventory = readJson('jobs-inventory');
  const factoryInventory = readJson('factory-inventory');
  const graphileManifest = readJson('graphile-evidence');
  const langgraphManifest = readJson('langgraph-evidence');
  const approval = readJson('approval');
  const confirmationDigest = arg('confirm');
  if (!confirmationDigest) throw new Error('--confirm <approval-digest> is required.');
  return {
    approval,
    confirmationDigest,
    factoryPlan: buildPlan(factoryInventory, langgraphManifest, 'langgraph'),
    jobsPlan: buildPlan(jobsInventory, graphileManifest, 'graphile'),
  };
}

async function main() {
  const databaseUrl = process.env.RUNTIME_CUTOVER_DATABASE_URL;
  if (!databaseUrl) throw new Error('RUNTIME_CUTOVER_DATABASE_URL is required.');
  const input = loadInputs();
  if (input.confirmationDigest !== cutoverApprovalDigest(input.approval)) {
    throw new Error('The supplied confirmation does not match the exact approval document.');
  }
  const pool = createPgPoolFromEnv(databaseUrl);
  try {
    const result = await executeJointRuntimeCutover(pool, input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      applied: false, code: error.code || 'runtime_cutover_apply_failed',
      message: error.message, reasons: error.reasons || [],
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildPlan, loadInputs, main };
