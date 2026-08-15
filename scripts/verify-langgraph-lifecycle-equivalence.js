#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyLifecycleEquivalence } = require('../lib/software-factory/langgraph/equivalence');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
}

function main() {
  const contractPath = process.env.LANGGRAPH_EQUIVALENCE_CONTRACT
    || 'config/langgraph-lifecycle-equivalence.v1.json';
  const inventoryPath = process.env.GOLDEN_PATH_INVENTORY
    || 'observability/golden-path-manual-steps.json';
  const evidencePath = process.env.GOLDEN_PATH_LEGACY_EVIDENCE
    || 'observability/golden-path-postgres-pilot.json';
  const report = verifyLifecycleEquivalence({
    contract: readJson(contractPath),
    manualInventory: readJson(inventoryPath),
    legacyEvidence: readJson(evidencePath),
  });
  const outputPath = path.resolve(process.cwd(), '.artifacts/langgraph-02-equivalence.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({
    schemaVersion: 'langgraph-lifecycle-equivalence-report.v1',
    ...report,
    contractPath,
    inventoryPath,
    evidencePath,
    revision: process.env.CI_COMMIT_SHA || process.env.GIT_COMMIT || null,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) main();

module.exports = { main, readJson };
