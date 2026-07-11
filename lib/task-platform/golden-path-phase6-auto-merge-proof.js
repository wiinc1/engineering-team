const { commitShaEvidenceFailure } = require('./real-commit-sha');

function assertRealPhase6AutoMerge(autoMerge = {}) {
  if (autoMerge.simulated === true) {
    throw new Error(`GP-022 real-evidence auto-merge cannot be simulated: ${autoMerge.reason}`);
  }
  const failures = [];
  if (autoMerge.skipped === true) failures.push(`auto-merge cannot be skipped${autoMerge.reason ? `: ${autoMerge.reason}` : ''}`);
  if (autoMerge.merged !== true) failures.push('GitHub merged confirmation is required');
  if (!autoMerge.mergeCommitSha) failures.push('mergeCommitSha is required');
  else {
    const commitFailure = commitShaEvidenceFailure(autoMerge.mergeCommitSha);
    if (commitFailure) failures.push(commitFailure);
  }
  if (!autoMerge.mergedAt || Number.isNaN(Date.parse(autoMerge.mergedAt))) {
    failures.push('mergedAt timestamp is required');
  }
  // GitLab #274: ineligible Simple auto-merge reasons must not count as trusted close.
  const reason = String(autoMerge.reason || '').toLowerCase();
  if (reason.includes('missing_github_token') || reason.includes('auto_merge_disabled')) {
    failures.push(`auto-merge not eligible for trusted Simple close (${autoMerge.reason})`);
  }
  if (failures.length) {
    throw new Error(`GP-022 real-evidence auto-merge proof is incomplete: ${failures.join('; ')}`);
  }
}

module.exports = {
  assertRealPhase6AutoMerge,
};
