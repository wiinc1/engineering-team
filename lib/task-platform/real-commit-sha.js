const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const FIXTURE_COMMIT_SHAS = new Set([
  '0123456789abcdef0123456789abcdef01234567',
  '89abcdef0123456789abcdef0123456789abcdef',
  'fedcba9876543210fedcba9876543210fedcba98',
]);

function normalizeCommitSha(value) {
  return String(value || '').trim().toLowerCase();
}

function isCommitShaShape(value) {
  return COMMIT_SHA_PATTERN.test(normalizeCommitSha(value));
}

function isLikelyFixtureCommitSha(value) {
  const sha = normalizeCommitSha(value);
  if (!isCommitShaShape(sha)) return false;
  if (FIXTURE_COMMIT_SHAS.has(sha)) return true;
  if (/^([0-9a-f])\1{39}$/.test(sha)) return true;
  return /^([0-9a-f]{8})\1{4}$/.test(sha);
}

function commitShaEvidenceFailure(value) {
  if (!isCommitShaShape(value)) return 'actual 40-character commit SHA is required';
  if (isLikelyFixtureCommitSha(value)) return 'actual non-fixture 40-character commit SHA is required';
  return null;
}

function isRealCommitSha(value) {
  return commitShaEvidenceFailure(value) === null;
}

module.exports = {
  commitShaEvidenceFailure,
  isCommitShaShape,
  isLikelyFixtureCommitSha,
  isRealCommitSha,
  normalizeCommitSha,
};
