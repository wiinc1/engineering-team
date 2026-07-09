#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { rollbackEvidenceFailures } = require('../lib/task-platform/rollback-evidence');

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function buildRollbackEvidence(options = {}) {
  const payload = {
    environment: options.releaseEnv,
    rollback_target: options.rollbackTarget,
    verification_status: options.verificationStatus,
    verified_at: options.verifiedAt || new Date().toISOString(),
  };
  if (options.commitSha) payload.commit_sha = options.commitSha;
  return payload;
}

function optionsFromArgv(argv = process.argv, env = process.env) {
  return {
    releaseEnv: readArg('--release-env', env.RELEASE_ENV || '', argv),
    commitSha: readArg('--commit-sha', env.MERGE_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || '', argv),
    rollbackTarget: readArg('--rollback-target', env.ROLLBACK_TARGET || '', argv),
    verificationStatus: readArg('--verification-status', env.ROLLBACK_VERIFICATION_STATUS || 'verified', argv),
    verifiedAt: readArg('--verified-at', env.ROLLBACK_VERIFIED_AT || '', argv),
    out: readArg('--out', env.ROLLBACK_EVIDENCE || env.ROLLBACK_EVIDENCE_PATH || 'observability/release/rollback-verification.json', argv),
  };
}

function writeRollbackEvidence(repoRoot, outputPath, payload) {
  const resolved = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
  return resolved;
}

function main(argv = process.argv, env = process.env) {
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  const options = optionsFromArgv(argv, env);
  const payload = buildRollbackEvidence(options);
  const failures = rollbackEvidenceFailures({
    releaseEnv: options.releaseEnv,
    commitSha: options.commitSha,
    rollbackTarget: options.rollbackTarget,
    rollbackEvidence: payload,
  });
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`FAIL  rollback-evidence: ${failure}\n`);
    process.exitCode = 1;
    return null;
  }
  const written = writeRollbackEvidence(repoRoot, options.out, payload);
  process.stdout.write(`PASS  rollback-evidence: ${written}\n`);
  return { payload, written };
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildRollbackEvidence,
  main,
  optionsFromArgv,
  readArg,
  writeRollbackEvidence,
};
