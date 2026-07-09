const { DEFAULT_GITHUB_API_BASE_URL } = require('./github-evidence-client');
const { githubCheckFailures } = require('./final-github-proof');

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function candidateGithubProofOptions(options = {}) {
  return {
    checks: normalizeArray(options.checks),
    requiredChecks: normalizeArray(options.requiredChecks),
    branchProtection: options.branchProtection || options.branch_protection || null,
    mergeReadiness: options.mergeReadiness || null,
    githubEvidenceSource: options.githubEvidenceSource || options.evidenceSource || null,
  };
}

function githubEvidenceSourceFailures(source = {}) {
  const failures = [];
  if (source.provider !== 'github') failures.push('GitHub candidate proof must be collected from GitHub API');
  if (String(source.apiBaseUrl || '').replace(/\/+$/, '') !== DEFAULT_GITHUB_API_BASE_URL) {
    failures.push(`GitHub candidate proof API base must be ${DEFAULT_GITHUB_API_BASE_URL}`);
  }
  if (!source.collectedAt || Number.isNaN(Date.parse(source.collectedAt))) {
    failures.push('GitHub candidate proof collectedAt timestamp is required');
  }
  return failures;
}

function finalGithubProofFailures(facts = {}) {
  if (facts.requireFinalReleaseProof !== true) return [];
  return [
    ...githubCheckFailures({
      github: {
        checks: facts.checks,
        requiredChecks: facts.requiredChecks,
        branchProtection: facts.branchProtection,
        mergeReadiness: facts.mergeReadiness,
      },
    }),
    ...githubEvidenceSourceFailures(facts.githubEvidenceSource || {}),
  ];
}

module.exports = {
  candidateGithubProofOptions,
  finalGithubProofFailures,
  githubEvidenceSourceFailures,
};
