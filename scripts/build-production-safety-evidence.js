#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  buildValidationArtifactsEvidence,
  productionSafetyEvidenceFailures,
} = require('../lib/task-platform/production-safety-evidence');

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function parseBoolean(value) {
  if (value === true) return true;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function buildProductionSafetyEvidence(options = {}) {
  const payload = {
    environment: options.releaseEnv,
    deployment_url: options.deploymentUrl,
    commit_sha: options.commitSha,
    validation_status: options.validationStatus,
    production_safe: options.productionSafe === true,
    risk_level: options.riskLevel,
    validated_at: options.validatedAt || new Date().toISOString(),
  };
  if (options.validationArtifacts) payload.validation_artifacts = options.validationArtifacts;
  return payload;
}

function optionsFromArgv(argv = process.argv, env = process.env) {
  return {
    releaseEnv: readArg('--release-env', env.RELEASE_ENV || '', argv),
    deploymentUrl: readArg('--deployment-url', env.DEPLOYMENT_URL || env.PRODUCTION_URL || '', argv),
    commitSha: readArg('--commit-sha', env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || '', argv),
    validationStatus: readArg('--validation-status', env.PRODUCTION_SAFETY_VALIDATION_STATUS || '', argv),
    riskLevel: readArg('--risk-level', env.REAL_DELIVERY_RISK_LEVEL || 'low', argv),
    productionSafe: hasFlag('--production-safe', argv) || parseBoolean(env.PRODUCTION_SAFE || env.REAL_DELIVERY_PRODUCTION_SAFE),
    validatedAt: readArg('--validated-at', env.PRODUCTION_SAFETY_VALIDATED_AT || '', argv),
    releaseArtifactDir: readArg('--release-artifact-dir', env.RELEASE_ARTIFACT_DIR || '', argv),
    out: readArg('--out', env.PRODUCTION_SAFETY_EVIDENCE || 'observability/release/production-safety.json', argv),
  };
}

function writeProductionSafetyEvidence(repoRoot, outputPath, payload) {
  const resolved = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
  return resolved;
}

function main(argv = process.argv, env = process.env) {
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  const options = optionsFromArgv(argv, env);
  const validation = buildValidationArtifactsEvidence(repoRoot, options.releaseArtifactDir, {
    commitSha: options.commitSha,
    deploymentUrl: options.deploymentUrl,
  });
  options.validationArtifacts = validation.evidence;
  const payload = buildProductionSafetyEvidence(options);
  const failures = productionSafetyEvidenceFailures({
    releaseEnv: options.releaseEnv,
    deploymentUrl: options.deploymentUrl,
    commitSha: options.commitSha,
    productionSafetyEvidence: payload,
  });
  failures.push(...validation.failures);
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`FAIL  production-safety-evidence: ${failure}\n`);
    process.exitCode = 1;
    return null;
  }
  const written = writeProductionSafetyEvidence(repoRoot, options.out, payload);
  process.stdout.write(`PASS  production-safety-evidence: ${written}\n`);
  return { payload, written };
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildProductionSafetyEvidence,
  main,
  optionsFromArgv,
  readArg,
  writeProductionSafetyEvidence,
};
