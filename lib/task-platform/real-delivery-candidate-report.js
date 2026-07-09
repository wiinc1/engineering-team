const fs = require('node:fs');
const path = require('node:path');
const { buildRealDeliveryCandidateProof } = require('./real-delivery-candidate-proof');

const CANDIDATE_REPORT_SCHEMA_VERSION = 'real-delivery-candidate-verification-report.v1';

function evidenceReference(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return '[embedded]';
  return String(value);
}

function redactedCandidateInputs(options = {}, outPath = '') {
  return {
    releaseEnv: options.releaseEnv || null,
    repository: options.repository || options.ciRepository || null,
    branch: options.branch || null,
    implementationCommitSha: options.implementationCommitSha || options.commitSha || null,
    prUrl: options.prUrl || null,
    prNumber: options.prNumber || null,
    deploymentUrl: options.deploymentUrl || null,
    manifestPath: options.manifestPath || null,
    candidateProofPath: outPath || null,
    collectGithubEvidence: options.collectGithubEvidence === true,
    hasGithubToken: Boolean(options.githubToken),
    githubApiBaseUrl: options.githubApiBaseUrl || null,
    runTestCommands: options.runTestCommands === true,
    requireFinalReleaseProof: options.requireFinalReleaseProof === true,
    verifyDeploymentHealth: options.verifyDeploymentHealth === true,
    requireHealthCommit: options.requireHealthCommit === true,
    rollbackTarget: options.rollbackTarget || null,
    rollbackEvidence: evidenceReference(options.rollbackEvidence),
    rollbackVerified: options.rollbackVerified === true,
    riskLevel: options.riskLevel || null,
    productionSafe: options.productionSafe === true,
    productionSafetyEvidence: evidenceReference(options.productionSafetyEvidence),
    changedFiles: Array.isArray(options.changedFiles) ? options.changedFiles : [],
    testCommands: Array.isArray(options.testCommands) ? options.testCommands : [],
  };
}

function buildCandidateReport(result = null, options = {}, outPath = '', explicitFailures = []) {
  const proof = result ? buildRealDeliveryCandidateProof(result) : null;
  const failures = explicitFailures.length ? explicitFailures : proof?.failures || result?.failures || [];
  return {
    schemaVersion: CANDIDATE_REPORT_SCHEMA_VERSION,
    ok: result?.ok === true && failures.length === 0,
    releaseEnv: result?.releaseEnv || options.releaseEnv || null,
    repository: result?.repository || options.repository || options.ciRepository || null,
    branch: result?.branch || options.branch || null,
    commitSha: result?.commitSha || options.implementationCommitSha || options.commitSha || null,
    prUrl: result?.prUrl || options.prUrl || null,
    prNumber: result?.prNumber || options.prNumber || null,
    deploymentUrl: result?.deploymentUrl || options.deploymentUrl || null,
    failureCount: failures.length,
    failures,
    inputs: redactedCandidateInputs(options, outPath),
    proof,
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

module.exports = {
  CANDIDATE_REPORT_SCHEMA_VERSION,
  buildCandidateReport,
  redactedCandidateInputs,
  writeJsonReport,
};
