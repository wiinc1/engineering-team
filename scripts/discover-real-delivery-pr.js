#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { discoverGitHubPullRequestTarget } = require('../lib/task-platform/github-pr-target-discovery');
const {
  localGitProofDefaults,
  localGitWorktreeFailure,
} = require('../lib/task-platform/local-git-proof-inputs');

const REPORT_SCHEMA_VERSION = 'real-delivery-pr-target-discovery.v1';

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function shouldPrintHelp(argv = process.argv) {
  return hasFlag('--help', argv) || hasFlag('-h', argv);
}

function usageText() {
  return `${[
    'Usage: node scripts/discover-real-delivery-pr.js [options]',
    'Discovers the open GitHub PR target for the local repo/branch using GitHub API evidence.',
    'Required unless derived locally: --repository <owner/repo> --branch <name> --implementation-commit-sha <sha>.',
    'Required secret: --github-token <token>, GITHUB_TOKEN, or GH_TOKEN.',
    'Output: --json --report <path>. Use --no-git-defaults to disable local git defaults.',
  ].join('\n')}\n`;
}

function optionsFromArgv(argv = process.argv, env = process.env) {
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  const localGitDefaultsUsed = !hasFlag('--no-git-defaults', argv);
  const git = localGitDefaultsUsed ? localGitProofDefaults(repoRoot) : {};
  return {
    repoRoot,
    localGitDefaultsUsed,
    repository: readArg('--repository', env.CI_REPOSITORY || env.GITHUB_REPOSITORY || git.repository || '', argv),
    branchName: readArg('--branch', '', argv) || readArg('--branch-name', env.BRANCH_NAME || env.GITHUB_HEAD_REF || git.branchName || '', argv),
    implementationCommitSha: readArg('--implementation-commit-sha', '', argv)
      || readArg('--commit-sha', env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || git.implementationCommitSha || '', argv),
    githubToken: readArg('--github-token', env.GITHUB_TOKEN || env.GH_TOKEN || '', argv),
    githubApiBaseUrl: readArg('--github-api-base-url', env.GITHUB_API_BASE_URL || '', argv),
    headOwner: readArg('--head-owner', env.GITHUB_HEAD_OWNER || '', argv),
    reportPath: readArg('--report', readArg('--report-path', '', argv), argv),
    fetchImpl: globalThis.fetch,
    workingTreeClean: localGitDefaultsUsed ? git.workingTreeClean : null,
    dirtyFileCount: localGitDefaultsUsed ? git.dirtyFileCount : null,
    dirtyFiles: localGitDefaultsUsed ? git.dirtyFiles || [] : [],
  };
}

function redactedInputs(options = {}) {
  return {
    repository: options.repository || null,
    branchName: options.branchName || null,
    implementationCommitSha: options.implementationCommitSha || null,
    githubApiBaseUrl: options.githubApiBaseUrl || null,
    headOwner: options.headOwner || null,
    hasGithubToken: Boolean(options.githubToken),
    localGitDefaultsUsed: options.localGitDefaultsUsed === true,
    workingTreeClean: typeof options.workingTreeClean === 'boolean' ? options.workingTreeClean : null,
    dirtyFileCount: Number.isInteger(options.dirtyFileCount) ? options.dirtyFileCount : null,
  };
}

function discoveryInputFailures(options = {}) {
  return [localGitWorktreeFailure(options)].filter(Boolean);
}

function buildReport({ ok, options, target = null, failures = [] } = {}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    ok: ok === true && failures.length === 0,
    failureCount: failures.length,
    failures,
    inputs: redactedInputs(options),
    target,
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

async function main(argv = process.argv, env = process.env) {
  if (shouldPrintHelp(argv)) {
    process.stdout.write(usageText());
    return { ok: true, help: true };
  }
  const options = optionsFromArgv(argv, env);
  const inputFailures = discoveryInputFailures(options);
  if (inputFailures.length) {
    const report = buildReport({ ok: false, options, failures: inputFailures });
    writeJsonReport(options.reportPath, report);
    if (hasFlag('--json', argv)) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stderr.write(`FAIL  real-delivery-pr-target: ${report.failures[0]}\n`);
    process.exitCode = 1;
    return { ok: false, options, report };
  }
  try {
    const target = await discoverGitHubPullRequestTarget(options, env);
    const report = buildReport({ ok: true, options, target });
    writeJsonReport(options.reportPath, report);
    if (hasFlag('--json', argv)) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`PASS  real-delivery-pr-target: ${target.prUrl}\n`);
    return { ok: true, options, report };
  } catch (error) {
    const report = buildReport({ ok: false, options, failures: [error?.message || String(error)] });
    writeJsonReport(options.reportPath, report);
    if (hasFlag('--json', argv)) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stderr.write(`FAIL  real-delivery-pr-target: ${report.failures[0]}\n`);
    process.exitCode = 1;
    return { ok: false, options, report };
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  buildReport,
  discoveryInputFailures,
  hasFlag,
  main,
  optionsFromArgv,
  readArg,
  redactedInputs,
  shouldPrintHelp,
  usageText,
  writeJsonReport,
};
