const {
  assertReleaseEvidenceBundlePassed,
  buildReleaseEvidenceBundle,
  releaseEvidenceSummary,
  writeReleaseEvidenceArtifacts,
} = require('./golden-path-real-evidence-collector');
const { isRealEvidenceRequired } = require('./golden-path-real-evidence');

function nowIso() {
  return new Date().toISOString();
}

function releaseProofForMerge(evidence = {}, options = {}, mergeCommitSha) {
  const github = evidence.github || {};
  return {
    repository: options.ciRepository || options.repository || github.repository,
    branchName: github.branchName || options.branchName || options.branch,
    commitSha: github.commitSha || options.implementationCommitSha || options.commitSha || mergeCommitSha,
    mergeCommitSha,
    merged: true,
    mergedAt: github.mergedAt || options.mergedAt || nowIso(),
    prUrl: github.prUrl || options.prUrl,
    prNumber: github.prNumber || options.prNumber,
    changedFiles: github.changedFiles || options.changedFiles || [],
    checks: Array.isArray(github.checks) && github.checks.length ? github.checks : options.checks || [],
    mergeReadiness: github.mergeReadiness || options.mergeReadiness,
  };
}

async function refreshPhase6ReleaseEvidenceAfterAutoMerge({ api = {}, ctx = {}, evidence = {}, options = {}, mergeCommitSha } = {}) {
  if (!isRealEvidenceRequired(options) || !api.autoMerge?.mergeCommitSha) return null;
  const mergedOptions = { ...options, fetchImpl: options.fetchImpl || ctx.fetchImpl, mergeCommitSha };
  const artifactResult = await writeReleaseEvidenceArtifacts(
    mergedOptions,
    releaseProofForMerge(evidence, mergedOptions, mergeCommitSha),
  );
  const validation = await buildReleaseEvidenceBundle(artifactResult, mergedOptions);
  assertReleaseEvidenceBundlePassed(validation, mergedOptions);
  api.releaseEvidence = releaseEvidenceSummary(artifactResult, validation);
  evidence.releaseEvidence = api.releaseEvidence;
  return api.releaseEvidence;
}

module.exports = { refreshPhase6ReleaseEvidenceAfterAutoMerge };
