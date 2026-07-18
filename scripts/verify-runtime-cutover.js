#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createCutoverPlan } = require('../lib/runtime-cutover');
const { evaluateRuntimeEvidence } = require('../lib/release-gates/runtime-evidence');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const inputPath = arg('inventory');
  const evidencePath = arg('evidence');
  if (!inputPath || !evidencePath) throw new Error('Usage: verify-runtime-cutover --inventory <json> --evidence <json>');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const runtime = input.scope === 'jobs' ? 'graphile' : 'langgraph';
  const releaseDecision = evaluateRuntimeEvidence(evidence, { runtime, revision: input.revision });
  const plan = createCutoverPlan({ ...input, releaseDecision });
  process.stdout.write(`${JSON.stringify(plan)}\n`);
  if (!plan.allowed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ allowed: false, code: 'cutover_preflight_failed', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
