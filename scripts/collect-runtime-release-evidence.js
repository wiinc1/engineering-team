#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { collectRuntimeEvidence } = require('../lib/release-gates/evidence-collector');

function values(name) {
  const output = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) output.push(process.argv[index + 1]);
  }
  return output;
}

function value(name) {
  return values(name).at(-1) || null;
}

function currentRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function writeJson(file, valueToWrite) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(valueToWrite, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function main() {
  const runtime = value('runtime');
  const deploymentId = value('deployment');
  const output = value('output');
  const files = values('artifact');
  if (!runtime || !deploymentId || !output || files.length === 0) {
    throw new Error('Usage: collect-runtime-release-evidence --runtime <graphile|langgraph> --deployment <id> --artifact <component.json>... --output <manifest.json> [--revision <sha>] [--allow-incomplete]');
  }
  const revision = value('revision') || currentRevision();
  const components = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  const result = collectRuntimeEvidence({ runtime, revision, deploymentId, components }, {
    allowIncomplete: process.argv.includes('--allow-incomplete'),
  });
  writeJson(output, result.manifest);
  process.stdout.write(`${JSON.stringify({ output, ...result.decision })}\n`);
  if (!result.decision.allowed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'runtime_evidence_collection_failed', message: error.message, reasons: error.reasons || [] })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, writeJson };
