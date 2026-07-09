const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_GITHUB_API_BASE_URL } = require('./github-evidence-client');

const PR_DISCOVERY_REPORT_SCHEMA_VERSION = 'real-delivery-pr-target-discovery.v1';
const DEFAULT_PILOT_PR_NUMBER = 271;

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function hasPullRequestTarget(options = {}) {
  return Boolean(prNumberFromUrl(options.prUrl))
    || Number(options.prNumber) > 0;
}

function expectedRepository(options = {}) {
  return options.repository || options.ciRepository || null;
}

function expectedBranch(options = {}) {
  return options.branchName || options.branch || null;
}

function expectedCommitSha(options = {}) {
  return options.implementationCommitSha || options.commitSha || null;
}

function readPrDiscoveryReport(reportPath, repoRoot = process.cwd()) {
  if (!reportPath) throw new Error('PR discovery report path is required');
  return JSON.parse(fs.readFileSync(path.resolve(repoRoot, reportPath), 'utf8'));
}

function validatePrDiscoveryReport(report = {}, expected = {}) {
  const failures = [];
  const target = report.target || {};
  if (report.schemaVersion !== PR_DISCOVERY_REPORT_SCHEMA_VERSION) {
    failures.push(`PR discovery report schemaVersion must be ${PR_DISCOVERY_REPORT_SCHEMA_VERSION}`);
  }
  if (report.ok !== true || Number(report.failureCount || 0) !== 0) {
    failures.push('PR discovery report must pass');
  }
  if (!target.repository) failures.push('PR discovery report target.repository is required');
  if (!target.branchName) failures.push('PR discovery report target.branchName is required');
  if (!target.implementationCommitSha) failures.push('PR discovery report target.implementationCommitSha is required');
  if (!target.prUrl) failures.push('PR discovery report target.prUrl is required');
  if (!Number.isInteger(Number(target.prNumber)) || Number(target.prNumber) <= 0) {
    failures.push('PR discovery report target.prNumber is required');
  }
  if (Number(target.prNumber) === DEFAULT_PILOT_PR_NUMBER || prNumberFromUrl(target.prUrl) === DEFAULT_PILOT_PR_NUMBER) {
    failures.push('default pilot PR #271 is not valid real evidence');
  }
  if (target.prUrl && !prNumberFromUrl(target.prUrl)) {
    failures.push('PR discovery report target.prUrl must include /pull/<number>');
  }
  if (target.prUrl && target.prNumber && prNumberFromUrl(target.prUrl) !== Number(target.prNumber)) {
    failures.push('PR discovery report target.prNumber must match target.prUrl');
  }
  if (target.source?.provider !== 'github') {
    failures.push('PR discovery report target.source.provider must be github');
  }
  if (target.source?.apiBaseUrl !== DEFAULT_GITHUB_API_BASE_URL) {
    failures.push(`PR discovery report target.source.apiBaseUrl must be ${DEFAULT_GITHUB_API_BASE_URL}`);
  }
  if (!target.source?.collectedAt) {
    failures.push('PR discovery report target.source.collectedAt is required');
  }
  const repository = expectedRepository(expected);
  const branch = expectedBranch(expected);
  const commitSha = expectedCommitSha(expected);
  if (repository && target.repository && target.repository !== repository) {
    failures.push(`PR discovery report repository ${target.repository} does not match expected ${repository}`);
  }
  if (branch && target.branchName && target.branchName !== branch) {
    failures.push(`PR discovery report branch ${target.branchName} does not match expected ${branch}`);
  }
  if (commitSha && target.implementationCommitSha && target.implementationCommitSha !== commitSha) {
    failures.push(`PR discovery report commit ${target.implementationCommitSha} does not match expected ${commitSha}`);
  }
  return failures;
}

function applyPrDiscoveryTarget(options = {}, target = {}) {
  return {
    ...options,
    repository: target.repository || options.repository,
    ciRepository: target.repository || options.ciRepository,
    branchName: target.branchName || options.branchName,
    branch: target.branchName || options.branch,
    implementationCommitSha: target.implementationCommitSha || options.implementationCommitSha,
    commitSha: options.commitSha || target.implementationCommitSha || '',
    prUrl: target.prUrl || options.prUrl,
    prNumber: target.prNumber || options.prNumber,
    prDiscovery: {
      requested: options.discoverPrTarget === true || options.usePrDiscoveryReport === true,
      ok: true,
      source: target.source || null,
      reportPath: options.prDiscoveryReportPath || null,
    },
  };
}

function hydratePrDiscoveryReportOptions(options = {}, repoRoot = options.repoRoot || options.root || process.cwd()) {
  if (options.usePrDiscoveryReport !== true || hasPullRequestTarget(options)) {
    return options;
  }
  try {
    const report = readPrDiscoveryReport(options.prDiscoveryReportPath, repoRoot);
    const failures = validatePrDiscoveryReport(report, options);
    if (failures.length) {
      return {
        ...options,
        prDiscoveryFailure: failures.join('; '),
        prDiscovery: { requested: true, ok: false, source: null, reportPath: options.prDiscoveryReportPath || null },
      };
    }
    return applyPrDiscoveryTarget(options, report.target);
  } catch (error) {
    return {
      ...options,
      prDiscoveryFailure: error?.message || String(error),
      prDiscovery: { requested: true, ok: false, source: null, reportPath: options.prDiscoveryReportPath || null },
    };
  }
}

function assertHydratedPrDiscoveryReportOptions(options = {}, repoRoot) {
  const hydrated = hydratePrDiscoveryReportOptions(options, repoRoot);
  if (hydrated.prDiscoveryFailure) {
    throw new Error(`PR target discovery report failed: ${hydrated.prDiscoveryFailure}`);
  }
  return hydrated;
}

module.exports = {
  PR_DISCOVERY_REPORT_SCHEMA_VERSION,
  applyPrDiscoveryTarget,
  assertHydratedPrDiscoveryReportOptions,
  hasPullRequestTarget,
  hydratePrDiscoveryReportOptions,
  prNumberFromUrl,
  readPrDiscoveryReport,
  validatePrDiscoveryReport,
};
