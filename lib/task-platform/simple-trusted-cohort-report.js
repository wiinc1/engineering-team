'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function candidatePaths(cohort) {
  return cohort.rows.flatMap((row) => [
    row.closeoutPath,
    row.factoryEvidencePath,
    row.trustedEvidencePath,
  ]).filter(Boolean);
}

function sourceFileRecords(cohort, root) {
  const resolvedRoot = path.resolve(root);
  const relativePaths = [...new Set(candidatePaths(cohort).map((candidate) => {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(resolvedRoot, candidate);
    return path.relative(resolvedRoot, absolute);
  }))].sort();
  return relativePaths.map((relativePath) => {
    const absolute = path.resolve(resolvedRoot, relativePath);
    const body = fs.readFileSync(absolute);
    return { path: relativePath, sha256: sha256(body), bytes: body.length };
  });
}

function buildReportProvenance(cohort, options = {}) {
  const inputs = sourceFileRecords(cohort, options.root || process.cwd());
  const sourceSetSha256 = sha256(JSON.stringify(inputs));
  return {
    schemaVersion: 'simple-trusted-cohort-report-provenance.v1',
    generator: 'scripts/build-simple-trusted-cohort-report.js',
    policyVersion: cohort.policy_version,
    revision: options.revision,
    generatedAt: options.generatedAt,
    sourceSetSha256,
    inputCount: inputs.length,
    inputs,
  };
}

module.exports = { buildReportProvenance, sourceFileRecords, sha256 };
