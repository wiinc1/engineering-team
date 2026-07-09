#!/usr/bin/env node
const fs = require('node:fs');
const { runSourceIntegrity } = require('./check-source-integrity');
const {
  verifyRealDeliveryCandidateReleaseProof,
  writeRealDeliveryCandidateProof,
} = require('../lib/task-platform/real-delivery-candidate-proof');
const {
  CANDIDATE_REPORT_SCHEMA_VERSION,
  buildCandidateReport,
  redactedCandidateInputs,
  writeJsonReport,
} = require('../lib/task-platform/real-delivery-candidate-report');
const { collectGitHubPullRequestEvidence } = require('../lib/task-platform/golden-path-real-evidence-collector');
const { assertHydratedPrDiscoveryReportOptions } = require('../lib/task-platform/real-delivery-pr-discovery-report');

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
    'Usage: node scripts/verify-real-delivery-candidate.js [options]',
    '',
    'Validates a low-risk real-delivery candidate and can write the candidate proof artifact used by hosted Phase 6.',
    '',
    'Core proof inputs:',
    '  --out <path>                         Write real-delivery candidate proof JSON',
    '  --collect-github-evidence            Collect branch, commit, changed files, checks, and Merge readiness from GitHub',
    '  --github-token <token>                GitHub token, or use GITHUB_TOKEN/GH_TOKEN',
    '  --repository <owner/repo>             GitHub repository, required with --pr-number when no --pr-url is provided',
    '  --pr-url <url> | --pr-number <n>      Pull request target',
    '  --use-pr-discovery-report             Load PR target from --pr-discovery-report',
    '  --pr-discovery-report <path>           Report from npm run autonomy:discover-real-delivery-pr',
    '  --branch <name>                      Candidate branch when not collected from GitHub',
    '  --implementation-commit-sha <sha>     Candidate implementation commit SHA',
    '  --changed-file <path>                 Candidate changed file; repeat for each file',
    '  --test-command <command>              Candidate test command; repeat for each command',
    '  --run-test-commands                   Execute listed test commands',
    '  --json                                Print a machine-readable verification report',
    '  --report <path>                       Write the machine-readable verification report',
    '',
    'Final release proof inputs:',
    '  --release-env <staging|prod>          Release environment',
    '  --deployment-url <url>                Hosted deployment URL',
    '  --health-check-path <path>            Deployment health path',
    '  --require-health-commit               Require health response to include the candidate commit SHA',
    '  --production-safety-evidence <path>   Production-safety artifact for this candidate',
    '  --rollback-target <target>            Rollback target for this release',
    '  --rollback-evidence <path>            Rollback verification artifact',
    '  --rollback-verified                   Assert rollback verification is complete',
    '  --risk-level low                      Required for final real-delivery proof',
    '  --production-safe                     Required for final real-delivery proof',
    '  --require-final-release-proof         Require rollback, production safety, GitHub, and health proof',
    '  --verify-deployment-health            Check the hosted deployment URL',
    'Diagnostic GitHub proof inputs, only when final release proof is not required:',
    '  --checks-json <json> | --checks-file <path>',
    '  --required-checks-json <json> | --required-checks-file <path>',
    '  --branch-protection-json <json> | --branch-protection-file <path>',
    '  --merge-readiness-json <json> | --merge-readiness-file <path>',
    '  --github-evidence-source-json <json> | --github-evidence-source-file <path>',
    'Example:',
    '  node scripts/verify-real-delivery-candidate.js \\',
    '    --collect-github-evidence --pr-url https://github.com/wiinc1/engineering-team/pull/<n> \\',
    '    --release-env staging --deployment-url https://<hosted-app> --health-check-path /version \\',
    '    --rollback-verified --production-safety-evidence observability/release/production-safety.json \\',
    '    --risk-level low --production-safe --test-command "npm run test:unit" --run-test-commands \\',
    '    --require-final-release-proof --verify-deployment-health --out observability/real-delivery-candidate-proof.json',
  ].join('\n')}\n`;
}

function printUsage(stream = process.stdout) {
  stream.write(usageText());
}

function readArgs(name, argv = process.argv) {
  const values = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1]);
  }
  return values.filter(Boolean);
}

function readJsonArg(argv, name) {
  const raw = readArg(name, '', argv);
  if (!raw) return undefined;
  const content = raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw;
  return JSON.parse(content);
}

function readJsonFileArg(argv, name) {
  const filePath = readArg(name, '', argv);
  return filePath ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : undefined;
}

function parseBooleanEnv(value) {
  if (value == null || value === '') return undefined;
  return ['1', 'true', 'yes', 'on', 'verified'].includes(String(value).trim().toLowerCase());
}

function rollbackVerifiedOption(argv = process.argv, env = process.env) {
  if (hasFlag('--rollback-verified', argv)) return true;
  return parseBooleanEnv(env.ROLLBACK_VERIFIED);
}

function collectGithubEvidenceOption(argv = process.argv, env = process.env) {
  return hasFlag('--collect-github-evidence', argv)
    || parseBooleanEnv(env.COLLECT_GITHUB_EVIDENCE) === true
    || parseBooleanEnv(env.REAL_DELIVERY_COLLECT_GITHUB_EVIDENCE) === true;
}

function printTestCommandResults(result) {
  for (const entry of result.testCommandResults || []) {
    const status = entry.ok ? 'PASS' : 'FAIL';
    const exit = entry.signal || `exit ${entry.exitCode}`;
    const line = `${status}  real-delivery-test-command: ${entry.command} (${exit}, ${entry.durationMs}ms)\n`;
    if (entry.ok) process.stdout.write(line);
    else process.stderr.write(line);
  }
}

function printDeploymentHealth(result) {
  if (!result.deploymentHealth) return;
  const entry = result.deploymentHealth;
  const status = entry.ok ? 'PASS' : 'FAIL';
  const detail = entry.status ? `HTTP ${entry.status}` : entry.error || 'no status';
  const line = `${status}  real-delivery-deployment-health: ${entry.url || '(missing URL)'} (${detail})\n`;
  if (entry.ok) process.stdout.write(line);
  else process.stderr.write(line);
}

function writeProofArtifact(root, outPath, result, { verbose = true } = {}) {
  if (!outPath) return;
  const writtenPath = writeRealDeliveryCandidateProof(root, outPath, result);
  if (verbose) process.stdout.write(`WROTE real-delivery-candidate-proof: ${writtenPath}\n`);
}

function assertFinalProofCliOptions(argv = process.argv, collectGithubEvidence = false) {
  if (!hasFlag('--require-final-release-proof', argv)) return;
  if (hasFlag('--skip-source-integrity', argv)) {
    throw new Error('final real delivery candidate proof cannot skip source integrity');
  }
  if (collectGithubEvidence !== true) {
    throw new Error('final real delivery candidate proof must collect GitHub evidence with --collect-github-evidence');
  }
}

function baseCandidateOptions(root, changedFiles, testCommands, argv = process.argv, env = process.env) {
  const riskLevel = readArg('--risk-level', '', argv);
  const productionSafe = hasFlag('--production-safe', argv);
  const rollbackVerified = rollbackVerifiedOption(argv, env);
  const options = {
    root,
    manifestPath: readArg('--manifest', '', argv),
    repository: readArg('--repository', env.CI_REPOSITORY || env.GITHUB_REPOSITORY || '', argv),
    branch: readArg('--branch', '', argv) || readArg('--branch-name', env.BRANCH_NAME || env.GITHUB_HEAD_REF || '', argv),
    implementationCommitSha: readArg('--implementation-commit-sha', '', argv) || readArg('--commit-sha', env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || '', argv),
    prUrl: readArg('--pr-url', env.PR_URL || env.GITHUB_PR_URL || '', argv),
    prNumber: Number(readArg('--pr-number', env.PR_NUMBER || env.GITHUB_PR_NUMBER || '', argv)) || undefined,
    usePrDiscoveryReport: hasFlag('--use-pr-discovery-report', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(env.USE_REAL_DELIVERY_PR_DISCOVERY_REPORT || '').toLowerCase()),
    prDiscoveryReportPath: readArg('--pr-discovery-report', env.REAL_DELIVERY_PR_DISCOVERY_REPORT || '', argv),
    collectGithubEvidence: collectGithubEvidenceOption(argv, env),
    githubApiBaseUrl: readArg('--github-api-base-url', env.GITHUB_API_BASE_URL || '', argv) || undefined,
    githubToken: readArg('--github-token', env.GITHUB_TOKEN || env.GH_TOKEN || '', argv) || undefined,
    releaseEnv: readArg('--release-env', env.RELEASE_ENV || '', argv),
    deploymentUrl: readArg('--deployment-url', env.DEPLOYMENT_URL || env.PRODUCTION_URL || '', argv),
    productionSafetyEvidence: readArg('--production-safety-evidence', env.PRODUCTION_SAFETY_EVIDENCE || env.PRODUCTION_SAFETY_EVIDENCE_PATH || '', argv),
    rollbackTarget: readArg('--rollback-target', env.ROLLBACK_TARGET || '', argv),
    rollbackPlan: readArg('--rollback-plan', env.ROLLBACK_PLAN || '', argv),
    rollbackEvidence: readArg('--rollback-evidence', env.ROLLBACK_EVIDENCE || env.ROLLBACK_EVIDENCE_PATH || '', argv),
    healthCheckPath: readArg('--health-check-path', '', argv),
    requireHealthCommit: hasFlag('--require-health-commit', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(env.REQUIRE_HEALTH_COMMIT || '').toLowerCase()),
    maxChangedFiles: readArg('--max-changed-files', env.MAX_REAL_DELIVERY_CHANGED_FILES || '', argv),
    changedFiles: changedFiles.length ? changedFiles : undefined,
    testCommands: testCommands.length ? testCommands : undefined,
    riskLevel: riskLevel || undefined,
    productionSafe: productionSafe ? true : undefined,
    runTestCommands: hasFlag('--run-test-commands', argv),
    requireFinalReleaseProof: hasFlag('--require-final-release-proof', argv),
    verifyDeploymentHealth: hasFlag('--verify-deployment-health', argv),
    sourceIntegrity: hasFlag('--skip-source-integrity', argv) ? null : (root) => runSourceIntegrity({ root }),
  };
  if (rollbackVerified !== undefined) options.rollbackVerified = rollbackVerified;
  return options;
}

function buildCandidateOptions(root, changedFiles, testCommands, argv = process.argv, env = process.env) {
  const options = assertHydratedPrDiscoveryReportOptions(
    baseCandidateOptions(root, changedFiles, testCommands, argv, env),
    root,
  );
  assertFinalProofCliOptions(argv, options.collectGithubEvidence);
  return {
    ...options,
    checks: readJsonArg(argv, '--checks-json') || readJsonFileArg(argv, '--checks-file'),
    requiredChecks: readJsonArg(argv, '--required-checks-json') || readJsonFileArg(argv, '--required-checks-file'),
    branchProtection: readJsonArg(argv, '--branch-protection-json') || readJsonFileArg(argv, '--branch-protection-file'),
    mergeReadiness: readJsonArg(argv, '--merge-readiness-json') || readJsonFileArg(argv, '--merge-readiness-file'),
    githubEvidenceSource: readJsonArg(argv, '--github-evidence-source-json')
      || readJsonFileArg(argv, '--github-evidence-source-file'),
  };
}

function mergeGithubEvidenceOptions(options = {}, github = {}) {
  return {
    ...options,
    repository: github.repository || options.repository,
    ciRepository: github.repository || options.ciRepository,
    branch: github.branchName || options.branch,
    implementationCommitSha: github.commitSha || options.implementationCommitSha,
    prUrl: github.prUrl || options.prUrl,
    prNumber: github.prNumber || options.prNumber,
    changedFiles: Array.isArray(github.changedFiles) && github.changedFiles.length
      ? github.changedFiles
      : options.changedFiles,
    checks: Array.isArray(github.checks) && github.checks.length ? github.checks : options.checks,
    requiredChecks: Array.isArray(github.requiredChecks) && github.requiredChecks.length
      ? github.requiredChecks
      : options.requiredChecks,
    branchProtection: github.branchProtection || options.branchProtection,
    mergeReadiness: github.mergeReadiness || options.mergeReadiness,
    githubEvidenceSource: github.evidenceSource || options.githubEvidenceSource,
  };
}

async function resolveCandidateOptions(options = {}) {
  if (options.collectGithubEvidence !== true) return options;
  const github = await collectGitHubPullRequestEvidence({ ...options, collectRealEvidence: true }, {});
  if (!github) throw new Error('real delivery candidate GitHub evidence collection requires a PR target');
  return mergeGithubEvidenceOptions(options, github);
}

function printSuccess(result) {
  process.stdout.write([
    `PASS  real-delivery-candidate: ${result.branch} (${result.releaseEnv})`,
    `commit: ${result.commitSha || 'missing'}`,
    `pull request: ${result.prUrl || result.prNumber || 'missing'}`,
    `implementation files: ${result.implementationFiles.length}`,
    `test files: ${result.testFiles.length}`,
    `test commands: ${result.testCommands.length}`,
    `test commands executed: ${result.testCommandResults?.length || 0}`,
    `deployment health checked: ${result.deploymentHealth ? 'yes' : 'no'}`,
    `changed files: ${result.changedFiles.length}`,
  ].join('\n'));
  process.stdout.write('\n');
}

function errorFailures(error) {
  return [error?.message || String(error)].filter(Boolean);
}

async function main(argv = process.argv, env = process.env) {
  if (shouldPrintHelp(argv)) {
    printUsage();
    return { ok: true, help: true };
  }

  const jsonOutput = hasFlag('--json', argv);
  const reportPath = readArg('--report', readArg('--report-path', '', argv), argv);
  const outPath = readArg('--out', '', argv);
  const changedFiles = readArgs('--changed-file', argv);
  const testCommands = readArgs('--test-command', argv);
  const root = readArg('--repo-root', process.cwd(), argv);
  let options = baseCandidateOptions(root, changedFiles, testCommands, argv, env);

  try {
    options = await resolveCandidateOptions(buildCandidateOptions(root, changedFiles, testCommands, argv, env));
  } catch (error) {
    const report = buildCandidateReport(null, options, outPath, errorFailures(error));
    writeJsonReport(reportPath, report, root);
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = 1;
      return { ok: false, failures: report.failures, report };
    }
    throw error;
  }

  const result = await verifyRealDeliveryCandidateReleaseProof(options);
  if (!jsonOutput) {
    printTestCommandResults(result);
    printDeploymentHealth(result);
  }
  writeProofArtifact(root, outPath, result, { verbose: !jsonOutput });
  const report = buildCandidateReport(result, options, outPath);
  writeJsonReport(reportPath, report, root);
  if (jsonOutput) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!result.ok) {
    if (!jsonOutput) {
      for (const failure of result.failures) process.stderr.write(`FAIL  real-delivery-candidate: ${failure}\n`);
      process.stderr.write(`real delivery candidate failed: ${result.failures.length} findings\n`);
    }
    process.exitCode = 1;
    return { ok: false, result, options, report };
  }

  if (!jsonOutput) printSuccess(result);
  return { ok: true, result, options, report };
}

if (require.main === module) try {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
}

module.exports = {
  CANDIDATE_REPORT_SCHEMA_VERSION,
  assertFinalProofCliOptions,
  buildCandidateReport,
  buildCandidateOptions,
  collectGithubEvidenceOption,
  errorFailures,
  mergeGithubEvidenceOptions,
  printUsage,
  parseBooleanEnv,
  readArg,
  readArgs,
  readJsonArg,
  readJsonFileArg,
  resolveCandidateOptions,
  rollbackVerifiedOption,
  redactedCandidateInputs,
  shouldPrintHelp,
  usageText,
  writeJsonReport,
};
