#!/usr/bin/env node
const path = require('node:path');
const {
  DEFAULT_RELEASE_ARTIFACT_DIR,
  buildReleaseArtifacts,
} = require('../lib/task-platform/release-artifact-evidence');

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function commandArgs(argv = process.argv) {
  return {
    build: readArg('--build-command', process.env.RELEASE_BUILD_COMMAND || '', argv),
    compatibility: readArg('--compatibility-command', process.env.RELEASE_COMPATIBILITY_COMMAND || '', argv),
    vulnerability: readArg('--vulnerability-command', process.env.RELEASE_VULNERABILITY_COMMAND || '', argv),
    secret: readArg('--secret-command', process.env.RELEASE_SECRET_COMMAND || '', argv),
  };
}

function buildOptions(argv = process.argv, env = process.env) {
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  return {
    repoRoot,
    releaseEnv: readArg('--release-env', env.RELEASE_ENV || '', argv),
    commitSha: readArg('--commit-sha', env.MERGE_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || '', argv),
    deploymentUrl: readArg('--deployment-url', env.DEPLOYMENT_URL || env.PRODUCTION_URL || '', argv),
    rollbackTarget: readArg('--rollback-target', env.ROLLBACK_TARGET || '', argv),
    repository: readArg('--repository', env.CI_REPOSITORY || env.GITHUB_REPOSITORY || '', argv),
    outDir: readArg('--out-dir', env.RELEASE_ARTIFACT_DIR || DEFAULT_RELEASE_ARTIFACT_DIR, argv),
    healthCheckPath: readArg('--health-check-path', env.RELEASE_HEALTH_CHECK_PATH || env.REAL_DELIVERY_HEALTH_CHECK_PATH || '', argv),
    requireHealthCommit: hasFlag('--require-health-commit', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(env.REQUIRE_HEALTH_COMMIT || '').toLowerCase()),
    timeoutMs: Number(readArg('--timeout-ms', env.RELEASE_ARTIFACT_COMMAND_TIMEOUT_MS || 120000, argv)),
    commands: commandArgs(argv),
  };
}

function printArtifacts(root, artifacts) {
  for (const [name, filePath] of Object.entries(artifacts)) {
    const display = path.isAbsolute(filePath) ? filePath : path.relative(root, path.resolve(root, filePath));
    process.stdout.write(`WROTE release-artifact:${name}: ${display}\n`);
  }
}

async function main() {
  const options = buildOptions();
  const result = await buildReleaseArtifacts(options);
  if (!result.ok) {
    for (const failure of result.failures) process.stderr.write(`FAIL  release-artifacts: ${failure}\n`);
    process.stderr.write(`release artifact build failed: ${result.failures.length} findings\n`);
    process.exitCode = 1;
    return;
  }
  printArtifacts(options.repoRoot, result.artifacts);
  process.stdout.write(`PASS  release-artifacts: ${options.outDir}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildOptions,
  commandArgs,
  hasFlag,
  main,
  readArg,
};
