#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { evaluateRuntimeEvidence } = require('../lib/release-gates/runtime-evidence');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function currentRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function main() {
  const runtime = arg('runtime');
  const evidencePath = arg('evidence');
  if (!['graphile', 'langgraph'].includes(runtime) || !evidencePath) {
    throw new Error('Usage: verify-runtime-release-evidence --runtime <graphile|langgraph> --evidence <manifest.json> [--revision <sha>]');
  }
  const manifest = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const decision = evaluateRuntimeEvidence(manifest, { runtime, revision: arg('revision') || currentRevision() });
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (!decision.allowed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ allowed: false, code: 'runtime_release_evidence_failed', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
