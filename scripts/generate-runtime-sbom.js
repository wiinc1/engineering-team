#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evidenceDigest } = require('../lib/release-gates/evidence-collector');

function gitRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function generateSbom() {
  const raw = execFileSync('npm', ['sbom', '--omit=dev', '--sbom-format', 'cyclonedx', '--package-lock-only'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function validateSbom(sbom) {
  if (sbom?.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) {
    throw new Error('npm did not produce a valid CycloneDX SBOM.');
  }
  return sbom;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function buildSbomEvidence(sbom, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const revision = options.revision || gitRevision();
  const serialized = JSON.stringify(sbom);
  const bomDigest = `sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}`;
  const evidence = Object.freeze({
    bomDigest,
    componentCount: sbom.components.length,
    format: 'CycloneDX',
    specVersion: sbom.specVersion,
  });
  return Object.freeze({
    schemaVersion: 1,
    runtime: options.runtime,
    kind: 'sbom',
    status: 'passed',
    revision,
    redacted: true,
    digest: evidenceDigest(evidence),
    generatedAt,
    expiresAt: options.expiresAt || new Date(Date.parse(generatedAt) + 7 * 86_400_000).toISOString(),
    provenance: {
      automation: options.automation || process.env.CI_JOB_URL || 'local:npm-sbom',
      environment: options.environment || process.env.CI_ENVIRONMENT_NAME || 'build',
    },
    summary: { components: sbom.components.length, format: 'CycloneDX', specVersion: sbom.specVersion },
    evidence,
  });
}

function main() {
  const outputDirectory = process.env.RUNTIME_SBOM_OUTPUT_DIR || path.join(process.cwd(), '.artifacts', 'security');
  const sbom = validateSbom(generateSbom());
  const revision = gitRevision();
  writeJson(path.join(outputDirectory, 'runtime-sbom.cdx.json'), sbom);
  for (const runtime of ['graphile', 'langgraph']) {
    writeJson(path.join(outputDirectory, `${runtime}-sbom-evidence.json`), buildSbomEvidence(sbom, { runtime, revision }));
  }
  process.stdout.write(`${JSON.stringify({ passed: true, format: 'CycloneDX', components: sbom.components.length, outputDirectory })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ passed: false, code: 'sbom_generation_failed', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildSbomEvidence, generateSbom, main, validateSbom };
