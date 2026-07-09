#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyRealAutonomousDeliveryEvidence } = require('../lib/task-platform/real-autonomous-delivery-evidence');
const { assertHydratedPrDiscoveryReportOptions } = require('../lib/task-platform/real-delivery-pr-discovery-report');

const VERIFICATION_REPORT_SCHEMA_VERSION = 'real-autonomous-delivery-verification-report.v1';

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function shouldPrintHelp(argv = process.argv) {
  return hasFlag('--help', argv) || hasFlag('-h', argv);
}

function usageText() {
  return `${[
    'Usage: node scripts/verify-real-autonomous-delivery.js --evidence <path> [options]',
    '',
    'Verifies final hosted autonomous delivery evidence. This gate rejects local URLs, fake/default PR evidence, skipped validation, SRE waivers, missing GitHub checks, missing Merge readiness, missing release artifacts, and missing candidate continuity proof.',
    '',
    'Required proof inputs:',
    '  --evidence <path> | --evidence-path <path>     Final factory delivery evidence JSON',
    '  --candidate-proof <path>                       Real-delivery candidate proof JSON',
    '  --release-env <staging|prod>                   Hosted release environment',
    '',
    'Optional expected identity checks:',
    '  --branch <name>                                Expected final branch name',
    '  --implementation-commit-sha <sha>               Expected implementation commit SHA',
    '  --commit-sha <sha>                             Alias for implementation commit SHA',
    '  --merge-commit-sha <sha>                       Expected final merge commit SHA',
    '  --pr-url <url>                                 Expected pull request URL',
    '  --pr-number <n>                                Expected pull request number',
    '  --use-pr-discovery-report                       Load expected PR identity from --pr-discovery-report',
    '  --pr-discovery-report <path>                    Report from npm run autonomy:discover-real-delivery-pr',
    '  --deployment-url <url>                         Expected hosted deployment URL',
    '  --repo-root <path>                             Repository root for artifact paths',
    '  --json                                        Print a machine-readable verification report',
    '  --report <path>                               Write the machine-readable verification report',
    '',
    'Example:',
    '  node scripts/verify-real-autonomous-delivery.js \\',
    '    --evidence observability/milestone-hosted-staging/factory-delivery/<queue-id>.json \\',
    '    --candidate-proof observability/real-delivery-candidate-proof.json \\',
    '    --release-env staging --branch <branch-name> --implementation-commit-sha <sha> \\',
    '    --merge-commit-sha <merge-sha> --pr-url https://github.com/wiinc1/engineering-team/pull/<n> \\',
    '    --deployment-url https://<hosted-app>',
  ].join('\n')}\n`;
}

function printUsage(stream = process.stdout) {
  stream.write(usageText());
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readArtifactReference(reference, repoRoot) {
  if (!reference || typeof reference !== 'string') return reference || null;
  try {
    return JSON.parse(fs.readFileSync(path.resolve(repoRoot || process.cwd(), reference), 'utf8'));
  } catch {
    return null;
  }
}

function finalDeploymentUrl(evidence = {}, repoRoot = process.cwd()) {
  const artifacts = evidence.releaseEvidence?.artifacts || {};
  const deploy = readArtifactReference(artifacts.deploy || artifacts['deploy-record'], repoRoot);
  return deploy?.deployment_url || evidence.deploy?.deploymentUrl || evidence.deploymentUrl || null;
}

function finalMergeCommitSha(evidence = {}, repoRoot = process.cwd()) {
  const artifacts = evidence.releaseEvidence?.artifacts || {};
  const deploy = readArtifactReference(artifacts.deploy || artifacts['deploy-record'], repoRoot);
  return evidence.github?.mergeCommitSha || evidence.phase6?.api?.autoMerge?.mergeCommitSha || deploy?.deployed_sha || null;
}

function expectedFinalEvidenceFailures(evidence = {}, expected = {}) {
  const github = evidence.github || {};
  const failures = [];
  const expectedPrNumber = Number(expected.prNumber) || prNumberFromUrl(expected.prUrl);
  const actualPrNumber = Number(github.prNumber) || prNumberFromUrl(github.prUrl);
  if (expected.branch && !github.branchName) failures.push('expected branch requires final GitHub branch evidence');
  if (expected.branch && github.branchName && expected.branch !== github.branchName) failures.push('expected branch must match final GitHub branch');
  if (expected.commitSha && !github.commitSha) failures.push('expected commit SHA requires final GitHub commitSha evidence');
  if (expected.commitSha && github.commitSha && expected.commitSha !== github.commitSha) failures.push('expected commit SHA must match final GitHub commitSha');
  const mergeCommitSha = finalMergeCommitSha(evidence, expected.repoRoot);
  if (expected.mergeCommitSha && !mergeCommitSha) failures.push('expected merge commit SHA requires final merge commit evidence');
  if (expected.mergeCommitSha && mergeCommitSha && expected.mergeCommitSha !== mergeCommitSha) failures.push('expected merge commit SHA must match final GitHub mergeCommitSha');
  if (expected.prUrl && !github.prUrl) failures.push('expected pull request URL requires final GitHub prUrl evidence');
  if (expected.prUrl && github.prUrl && expected.prUrl !== github.prUrl) failures.push('expected pull request URL must match final GitHub prUrl');
  if (expectedPrNumber && !actualPrNumber) failures.push('expected pull request number requires final GitHub prNumber evidence');
  if (expectedPrNumber && actualPrNumber && expectedPrNumber !== actualPrNumber) failures.push('expected pull request number must match final GitHub prNumber');
  const deployUrl = finalDeploymentUrl(evidence, expected.repoRoot);
  if (expected.deploymentUrl && !deployUrl) failures.push('expected deployment URL requires final deploy evidence');
  if (expected.deploymentUrl && deployUrl && normalizeUrl(expected.deploymentUrl) !== normalizeUrl(deployUrl)) failures.push('expected deployment URL must match final deploy evidence');
  return failures;
}

function expectedIdentitySummary(expected = {}) {
  return {
    branch: expected.branch || null,
    commitSha: expected.commitSha || null,
    mergeCommitSha: expected.mergeCommitSha || null,
    prUrl: expected.prUrl || null,
    prNumber: expected.prNumber || null,
    deploymentUrl: expected.deploymentUrl || null,
  };
}

function fileDigest(repoRoot, filePath) {
  if (!filePath) return null;
  try {
    const text = fs.readFileSync(path.resolve(repoRoot || process.cwd(), filePath));
    return { algorithm: 'sha256', value: crypto.createHash('sha256').update(text).digest('hex'), path: filePath };
  } catch {
    return null;
  }
}

function artifactDigestsFor(result = {}, repoRoot = process.cwd()) {
  return {
    evidence: fileDigest(repoRoot, result.evidencePath),
    candidateProof: fileDigest(repoRoot, result.candidateProofPath),
  };
}

function buildVerificationReport(result = {}, expected = {}) {
  const failures = Array.isArray(result.failures) ? result.failures : [];
  return {
    schemaVersion: VERIFICATION_REPORT_SCHEMA_VERSION,
    ok: failures.length === 0,
    releaseEnv: result.releaseEnv || null,
    evidencePath: result.evidencePath || null,
    candidateProofPath: result.candidateProofPath || null,
    artifactDigests: result.artifactDigests || null,
    failureCount: failures.length,
    failures,
    expected: expectedIdentitySummary(expected),
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

function requiredEvidencePath() {
  const evidencePath = readArg('--evidence') || readArg('--evidence-path') || process.env.REAL_AUTONOMOUS_DELIVERY_EVIDENCE;
  if (!evidencePath) {
    throw new Error('real autonomous delivery evidence path is required via --evidence');
  }
  return evidencePath;
}

function readExpectedIdentity(repoRoot) {
  const commitSha = readArg('--implementation-commit-sha', '')
    || readArg('--commit-sha', process.env.IMPLEMENTATION_COMMIT_SHA || process.env.COMMIT_SHA || process.env.GITHUB_SHA || '');
  return assertHydratedPrDiscoveryReportOptions({
    branch: readArg('--branch', '') || readArg('--branch-name', process.env.BRANCH_NAME || process.env.GITHUB_HEAD_REF || ''),
    commitSha,
    implementationCommitSha: commitSha,
    mergeCommitSha: readArg('--merge-commit-sha', process.env.MERGE_COMMIT_SHA || ''),
    prUrl: readArg('--pr-url', process.env.PR_URL || process.env.GITHUB_PR_URL || ''),
    prNumber: readArg('--pr-number', process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || ''),
    usePrDiscoveryReport: hasFlag('--use-pr-discovery-report'),
    prDiscoveryReportPath: readArg('--pr-discovery-report', process.env.REAL_DELIVERY_PR_DISCOVERY_REPORT || ''),
    deploymentUrl: readArg('--deployment-url', process.env.DEPLOYMENT_URL || process.env.PRODUCTION_URL || ''),
    repoRoot,
  }, repoRoot);
}

function verifyEvidence(evidence, evidencePath, repoRoot) {
  return verifyRealAutonomousDeliveryEvidence({
    evidence,
    evidencePath,
    candidateProofPath: readArg('--candidate-proof', process.env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || ''),
    repoRoot,
    releaseEnv: readArg('--release-env', process.env.RELEASE_ENV || ''),
  });
}

function main() {
  if (shouldPrintHelp()) {
    printUsage();
    return;
  }

  const repoRoot = readArg('--repo-root', process.cwd());
  const evidencePath = requiredEvidencePath();
  const evidence = JSON.parse(fs.readFileSync(path.resolve(repoRoot, evidencePath), 'utf8'));
  const result = verifyEvidence(evidence, evidencePath, repoRoot);
  const expected = readExpectedIdentity(repoRoot);
  result.failures.push(...expectedFinalEvidenceFailures(evidence, expected));
  result.ok = result.failures.length === 0;
  result.artifactDigests = artifactDigestsFor(result, repoRoot);
  const report = buildVerificationReport(result, expected);
  const reportPath = readArg('--report') || readArg('--report-path');
  writeJsonReport(reportPath, report, repoRoot);
  if (hasFlag('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  if (!result.ok) {
    if (!hasFlag('--json')) {
      for (const failure of result.failures) process.stderr.write(`FAIL  real-autonomous-delivery: ${failure}\n`);
      process.stderr.write(`real autonomous delivery evidence failed: ${result.failures.length} findings\n`);
    }
    process.exitCode = 1;
    return report;
  }
  if (!hasFlag('--json')) {
    process.stdout.write(`PASS  real-autonomous-delivery: ${evidencePath} (${result.releaseEnv})\n`);
  }
  return report;
}

if (require.main === module) try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
}

module.exports = {
  VERIFICATION_REPORT_SCHEMA_VERSION,
  buildVerificationReport,
  artifactDigestsFor,
  expectedFinalEvidenceFailures,
  expectedIdentitySummary,
  finalDeploymentUrl,
  finalMergeCommitSha,
  hasFlag,
  main,
  printUsage,
  readArg,
  shouldPrintHelp,
  usageText,
  writeJsonReport,
};
