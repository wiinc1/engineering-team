#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createSpecialistCoordinator } = require('../lib/software-factory/delegation');

async function main() {
  const baseDir = path.join(__dirname, '..');
  const request = process.argv.slice(2).join(' ').trim() || 'Please implement this fix';
  const coordinator = createSpecialistCoordinator({
    baseDir,
  });

  const result = await coordinator.handleRequest(request, {
    coordinatorAgent: 'main',
    actorId: 'runtime-validator',
    validationMode: 'live-smoke',
  });

  const report = {
    validatedAt: new Date().toISOString(),
    request,
    mode: result.mode,
    specialist: result.specialist || null,
    attribution: result.attribution,
    metadata: result.metadata,
    message: result.message,
  };

  const outputDir = path.join(baseDir, 'observability');
  const outputPath = path.join(outputDir, 'specialist-delegation-smoke.json');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
