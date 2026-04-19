#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createSpecialistCoordinator } = require('../lib/software-factory/delegation');

function resolveBaseDir(env = process.env) {
  return env.SPECIALIST_DELEGATION_BASE_DIR
    ? path.resolve(env.SPECIALIST_DELEGATION_BASE_DIR)
    : path.join(__dirname, '..');
}

function buildSmokeReport({ request, result }) {
  return {
    validatedAt: new Date().toISOString(),
    request,
    mode: result.mode,
    specialist: result.specialist || null,
    agentId: result.agentId || null,
    sessionId: result.metadata?.sessionId || null,
    attribution: result.attribution,
    metadata: result.metadata,
    message: result.message,
  };
}

function assertLiveDelegation(report) {
  if (report.mode !== 'delegated') {
    throw Object.assign(new Error(`Live runtime delegation was not confirmed: ${report.metadata?.errorCode || report.metadata?.fallbackReason || report.mode}`), {
      code: 'SPECIALIST_RUNTIME_SMOKE_NOT_DELEGATED',
      report,
    });
  }
  if (!report.agentId || !report.sessionId) {
    throw Object.assign(new Error('Live runtime delegation smoke requires runtime-owned agentId and sessionId'), {
      code: 'SPECIALIST_RUNTIME_SMOKE_MISSING_EVIDENCE',
      report,
    });
  }
}

function writeSmokeReport(baseDir, report) {
  const outputDir = path.join(baseDir, 'observability');
  const outputPath = path.join(outputDir, 'specialist-delegation-smoke.json');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

async function runValidation({ baseDir = resolveBaseDir(), request } = {}) {
  const resolvedRequest = request || 'Please implement this fix';
  const coordinator = createSpecialistCoordinator({
    baseDir,
  });

  const result = await coordinator.handleRequest(resolvedRequest, {
    coordinatorAgent: 'main',
    actorId: 'runtime-validator',
    validationMode: 'live-smoke',
  });

  const report = buildSmokeReport({ request: resolvedRequest, result });
  const outputPath = writeSmokeReport(baseDir, report);
  return { report, outputPath };
}

async function main() {
  const baseDir = resolveBaseDir();
  const request = process.argv.slice(2).join(' ').trim() || 'Please implement this fix';
  const { report } = await runValidation({ baseDir, request });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  assertLiveDelegation(report);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertLiveDelegation,
  buildSmokeReport,
  resolveBaseDir,
  runValidation,
  writeSmokeReport,
};
