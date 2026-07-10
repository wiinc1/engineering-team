const { execFileSync } = require('node:child_process');
const {
  collectRealChangeScopeEvidence,
  hasSuccessfulTestEvidence,
  isImplementationCodeFile,
  realChangeScopeFailures,
} = require('./golden-path-real-scope');
const { branchProtectionFailures } = require('./final-github-proof');
const { MERGE_READINESS_CHECK_NAME } = require('./merge-readiness-github-check');
const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { realBranchEvidenceFailure } = require('./real-branch');
const DEFAULT_PILOT_PR_NUMBER = 271;
const DEFAULT_PILOT_PR_URL = 'https://github.com/wiinc1/engineering-team/pull/271';
function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function isFactoryProofProfileActive(options = {}, env = process.env) {
  const profile = String(options.proofProfile || env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  return profile === 'live' || profile === 'fixture';
}

function isRealEvidenceRequired(options = {}) {
  // Factory proof profiles (live OpenClaw / explicit fixture smoke) gate sessions via
  // factory-proof-profile. agentDrivenPhases alone must not force hosted PR/release proof.
  if (isFactoryProofProfileActive(options)) {
    return options.requireRealEvidence === true
      || options.collectRealEvidence === true
      || parseBooleanEnv(process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
      || parseBooleanEnv(process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false);
  }
  return options.requireRealEvidence === true
    || options.collectRealEvidence === true
    || options.agentDrivenPhases === true
    || parseBooleanEnv(process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false);
}

function normalizeReleaseEvidenceEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'production') return 'prod';
  if (normalized === 'development') return 'dev';
  return normalized;
}

function resolveReleaseEvidenceEnvironment(options = {}) {
  const env = options.env || process.env;
  return normalizeReleaseEvidenceEnvironment(
    options.releaseEnv
      || options.releaseEnvironment
      || env.RELEASE_ENV
      || (isRealEvidenceRequired(options) ? 'prod' : ''),
  );
}

function outputText(value) {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function releaseEvidenceEnv(options = {}) {
  return {
    ...process.env,
    ...(options.env || {}),
    CHANGE_KIND: options.changeKind || options.env?.CHANGE_KIND || process.env.CHANGE_KIND || 'bugfix',
    CHANGE_REVERSIBILITY: options.changeReversibility
      || options.env?.CHANGE_REVERSIBILITY
      || process.env.CHANGE_REVERSIBILITY
      || 'reversible',
  };
}

function runReleaseEvidenceValidation(options = {}) {
  const environment = resolveReleaseEvidenceEnvironment(options);
  if (!environment) return { skipped: true, reason: 'release_environment_not_requested' };
  const cwd = options.cwd || process.cwd();
  const env = releaseEvidenceEnv(options);
  if (typeof options.releaseEvidenceValidator === 'function') {
    try {
      const result = options.releaseEvidenceValidator({ environment, cwd, env });
      return { skipped: false, environment, ok: result?.ok !== false, ...(result || {}) };
    } catch (error) {
      return { skipped: false, environment, ok: false, stdout: outputText(error.stdout), stderr: outputText(error.stderr || error.message) };
    }
  }
  try {
    const stdout = execFileSync('python3', ['dev-standards/tooling/validate_release_evidence.py', '--repo-root', cwd, '--environment', environment], { cwd, env, encoding: 'utf8' });
    return { skipped: false, environment, ok: true, stdout, stderr: '' };
  } catch (error) {
    return { skipped: false, environment, ok: false, stdout: outputText(error.stdout), stderr: outputText(error.stderr || error.message), status: error.status || error.code || 1 };
  }
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function normalizePrNumber(value, prUrl) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) return direct;
  return prNumberFromUrl(prUrl);
}

function evidenceValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeChecks(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.requiredChecks)) return value.requiredChecks;
  if (Array.isArray(value?.required_checks)) return value.required_checks;
  if (Array.isArray(value?.checks)) return value.checks;
  return [];
}

function checkPassed(check = {}) {
  const conclusion = String(check.conclusion || check.result || '').toLowerCase();
  const status = String(check.status || check.state || '').toLowerCase();
  return conclusion === 'success'
    || conclusion === 'passed'
    || status === 'success'
    || status === 'passed'
    || (status === 'completed' && conclusion === 'success');
}

function checkName(check = {}) {
  if (check == null) return '';
  if (typeof check === 'string') return check.trim();
  return String(check.name || check.context || check.checkName || check.check_name || '').trim();
}

function isGitHubCheckEvidence(check = {}) {
  return ['github_check_run', 'github_status'].includes(String(check.source || '').toLowerCase());
}

function checkPassedFromGitHub(check = {}) {
  return isGitHubCheckEvidence(check) && checkPassed(check);
}

function mergeReadinessPassed(value = {}) {
  if (!value || typeof value !== 'object') return false;
  const status = String(
    value.reviewStatus
      || value.review_status
      || value.status
      || value.conclusion
      || value.checkConclusion
      || value.check_conclusion
      || '',
  ).toLowerCase();
  const checkName = String(value.name || value.checkName || value.check_name || '').toLowerCase();
  return status === 'passed'
    || status === 'success'
    || status === 'succeeded'
    || (checkName === 'merge readiness' && status === 'completed');
}

function mergeReadinessNameMatches(value = {}) {
  return checkName(value).toLowerCase() === MERGE_READINESS_CHECK_NAME.toLowerCase();
}

function mergeReadinessPassedFromGitHub(value = {}) {
  return isGitHubCheckEvidence(value) && mergeReadinessNameMatches(value) && mergeReadinessPassed(value);
}

function normalizeRequiredCheckNames(value) {
  const checks = Array.isArray(value)
    ? value
    : Array.isArray(value?.requiredChecks) ? value.requiredChecks
      : Array.isArray(value?.required_checks) ? value.required_checks
        : Array.isArray(value?.checks) ? value.checks
          : [];
  return [...new Set(checks.map(checkName).filter(Boolean))];
}

function requiredCheckFailures(requiredChecks, checks) {
  const required = normalizeRequiredCheckNames(requiredChecks);
  if (!required.length) return ['branch-protection required check inventory is required'];
  const passed = new Set(checks.filter(checkPassedFromGitHub).map((check) => checkName(check).toLowerCase()));
  const missing = required.filter((name) => !passed.has(name.toLowerCase()));
  const failures = [];
  if (missing.length) failures.push(`branch-protection required checks must pass from GitHub: ${missing.join(', ')}`);
  if (!required.some((name) => name.toLowerCase() === 'merge readiness')) {
    failures.push('branch protection must require Merge readiness');
  }
  return failures;
}

function collectProofChecks(evidence = {}, options = {}, overrides = {}) {
  const github = evidence.github || {};
  const validation = evidence.deploy?.validation || evidence.phase6?.api?.validation || null;
  const ciValidation = evidence.deploy?.ciValidation || evidence.phase6?.api?.ciValidation || null;
  return normalizeChecks(evidenceValue(
    overrides.checks,
    options.checks,
    github.checks,
    validation?.checks,
    ciValidation?.checks,
  ));
}

function collectProofRequiredChecks(evidence = {}, options = {}, overrides = {}) {
  const github = evidence.github || {};
  return normalizeRequiredCheckNames(evidenceValue(
    overrides.requiredChecks,
    options.requiredChecks,
    options.requiredCheckInventory,
    overrides.branchProtection,
    options.branchProtection,
    options.branch_protection,
    github.requiredChecks,
    github.requiredCheckInventory,
    github.branchProtection?.requiredChecks,
    evidence.branchProtection?.requiredChecks,
  ));
}

function collectProofBranchProtection(evidence = {}, options = {}, overrides = {}) {
  const github = evidence.github || {};
  return evidenceValue(overrides.branchProtection, options.branchProtection, options.branch_protection, github.branchProtection, github.branch_protection, evidence.branchProtection, evidence.branch_protection);
}

function collectStrictProofEvidence(evidence = {}, options = {}, overrides = {}) {
  const github = evidence.github || {};
  const prUrl = evidenceValue(overrides.prUrl, options.prUrl, github.prUrl);
  const prNumber = normalizePrNumber(
    evidenceValue(overrides.prNumber, options.prNumber, github.prNumber),
    prUrl,
  );
  return {
    branchName: evidenceValue(
      overrides.branchName,
      options.branchName,
      options.branch,
      github.branchName,
      github.branch,
    ),
    commitSha: evidenceValue(
      overrides.commitSha,
      options.commitSha,
      options.implementationCommitSha,
      options.mergeCommitSha,
      github.commitSha,
      github.mergeCommitSha,
    ),
    prUrl,
    prNumber,
    checks: collectProofChecks(evidence, options, overrides),
    requiredChecks: collectProofRequiredChecks(evidence, options, overrides),
    branchProtection: collectProofBranchProtection(evidence, options, overrides),
    mergeReadiness: evidenceValue(
      overrides.mergeReadiness,
      options.mergeReadiness,
      github.mergeReadiness,
      evidence.mergeReadiness,
      evidence.phase6?.api?.mergeReadiness,
    ),
  };
}

function assertRealImplementationEvidence(evidence = {}, options = {}, implementation = {}) {
  if (!isRealEvidenceRequired(options)) return collectStrictProofEvidence(evidence, options, implementation);
  const proof = collectStrictProofEvidence(evidence, options, implementation);
  const failures = [];
  const prNumberInUrl = prNumberFromUrl(proof.prUrl);
  const branchFailure = realBranchEvidenceFailure(proof.branchName, 'actual branch name');
  const commitShaFailure = commitShaEvidenceFailure(proof.commitSha);
  if (branchFailure) failures.push(branchFailure);
  if (commitShaFailure) failures.push(commitShaFailure);
  if (!proof.prUrl) failures.push('actual pull request URL is required');
  if (proof.prUrl && !prNumberInUrl) failures.push('pull request URL must be a github.com pull request URL');
  if (!proof.prNumber) failures.push('actual pull request number is required');
  if (proof.prNumber && prNumberInUrl && proof.prNumber !== prNumberInUrl) {
    failures.push('pull request number must match pull request URL');
  }
  if (proof.prNumber === DEFAULT_PILOT_PR_NUMBER || prNumberInUrl === DEFAULT_PILOT_PR_NUMBER) {
    failures.push('default pilot PR #271 is not valid autonomous evidence');
  }
  if (failures.length) {
    throw new Error(`Autonomous golden-path implementation proof is incomplete: ${failures.join('; ')}`);
  }
  return proof;
}

function assertRealPhase6Evidence(evidence = {}, options = {}, overrides = {}) {
  const releaseEvidence = runReleaseEvidenceValidation(options);
  if (!isRealEvidenceRequired(options)) {
    if (!releaseEvidence.ok && !releaseEvidence.skipped) {
      throw new Error(`Golden-path release evidence validation failed: ${releaseEvidence.stdout || releaseEvidence.stderr}`);
    }
    return collectStrictProofEvidence(evidence, options, overrides);
  }
  const proof = assertRealImplementationEvidence(evidence, options, overrides);
  const failures = [];
  if (options.skipValidation === true) failures.push('deploy validation cannot be skipped');
  if (options.allowSreWaiver === true) failures.push('SRE waiver is not valid autonomous evidence');
  if (options.requireHealthyDeployment === false) failures.push('post-deploy health validation cannot be disabled');
  failures.push(...requiredCheckFailures(proof.requiredChecks, proof.checks));
  failures.push(...branchProtectionFailures({ branchProtection: proof.branchProtection }, proof.requiredChecks));
  if (!mergeReadinessPassedFromGitHub(proof.mergeReadiness)) failures.push('passed GitHub Merge readiness evidence is required');
  failures.push(...realChangeScopeFailures(collectRealChangeScopeEvidence(evidence, options), proof, releaseEvidence));
  if (!releaseEvidence.ok) {
    failures.push(`release evidence validation failed for ${releaseEvidence.environment}: ${releaseEvidence.stdout || releaseEvidence.stderr}`);
  }
  if (failures.length) {
    throw new Error(`Autonomous golden-path release proof is incomplete: ${failures.join('; ')}`);
  }
  return proof;
}

function fallbackValue(value, fallback) {
  if (value) return value;
  return typeof fallback === 'function' ? fallback() : fallback;
}

function resolveGitHeadSha(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function resolvePhase2ImplementationEvidence(evidence, options, agentImplementer, fallbackCommitSha) {
  const proof = assertRealImplementationEvidence(evidence, options, {
    branchName: agentImplementer?.branchName || options.branchName || options.branch,
    commitSha: agentImplementer?.commitSha || options.implementationCommitSha || options.commitSha,
    prUrl: agentImplementer?.prUrl || options.prUrl,
    prNumber: options.prNumber,
  });
  const prUrl = proof.prUrl || agentImplementer?.prUrl || options.prUrl || null;
  return {
    branchName: proof.branchName || agentImplementer?.branchName || options.branchName || options.branch || null,
    commitSha: fallbackValue(proof.commitSha || options.implementationCommitSha || options.commitSha, fallbackCommitSha),
    prUrl,
    prNumber: proof.prNumber || normalizePrNumber(options.prNumber, prUrl) || null,
  };
}

function resolvePhase4FixEvidence(evidence, options, implementation, fixAgent, fallbackCommitSha) {
  const fixProvidedCommitSha = fixAgent?.commitSha || options.fixCommitSha;
  if (isRealEvidenceRequired(options) && !fixProvidedCommitSha) {
    throw new Error('Autonomous golden-path fix proof is incomplete: actual fix commit SHA is required');
  }
  const proof = assertRealImplementationEvidence(evidence, options, {
    branchName: fixAgent?.branchName || options.fixBranchName || options.branchName || options.branch,
    commitSha: fixProvidedCommitSha,
    prUrl: fixAgent?.prUrl || options.fixPrUrl || implementation.prUrl,
    prNumber: options.prNumber || implementation.prNumber,
  });
  return {
    branchName: proof.branchName || null,
    commitSha: fallbackValue(proof.commitSha, fallbackCommitSha),
    prUrl: proof.prUrl || implementation.prUrl,
  };
}

function resolvePhase5ImplementationEvidence(evidence, options) {
  const proof = assertRealImplementationEvidence(evidence, options, {
    branchName: options.branchName || options.branch || evidence.github?.branchName,
    commitSha: options.mergeCommitSha || evidence.github?.mergeCommitSha,
    prUrl: options.prUrl || evidence.github?.prUrl,
    prNumber: options.prNumber || evidence.github?.prNumber,
  });
  return {
    mergeCommitSha: proof.commitSha
      || options.mergeCommitSha
      || evidence.github?.mergeCommitSha
      || resolveGitHeadSha(options.cwd || process.cwd()),
    prUrl: proof.prUrl || options.prUrl || evidence.github?.prUrl || null,
    prNumber: proof.prNumber || Number(options.prNumber || evidence.github?.prNumber) || null,
  };
}

function resolvePhase6ReleaseEvidence(evidence, options) {
  const proof = assertRealPhase6Evidence(evidence, options, {
    branchName: options.branchName || options.branch || evidence.github?.branchName,
    commitSha: options.mergeCommitSha || evidence.github?.mergeCommitSha,
    prUrl: options.prUrl || evidence.github?.prUrl,
    prNumber: options.prNumber || evidence.github?.prNumber,
    checks: options.checks,
    mergeReadiness: options.mergeReadiness,
  });
  return {
    mergeCommitSha: proof.commitSha
      || options.mergeCommitSha
      || evidence.github?.mergeCommitSha
      || resolveGitHeadSha(options.cwd || process.cwd()),
    prUrl: proof.prUrl || options.prUrl || evidence.github?.prUrl || null,
    prNumber: proof.prNumber || Number(options.prNumber || evidence.github?.prNumber) || null,
  };
}

module.exports = {
  DEFAULT_PILOT_PR_NUMBER,
  DEFAULT_PILOT_PR_URL,
  assertRealImplementationEvidence,
  assertRealPhase6Evidence,
  isRealEvidenceRequired,
  normalizePrNumber,
  collectRealChangeScopeEvidence,
  hasSuccessfulTestEvidence,
  isImplementationCodeFile,
  resolveReleaseEvidenceEnvironment,
  runReleaseEvidenceValidation,
  resolvePhase2ImplementationEvidence,
  resolvePhase4FixEvidence,
  resolvePhase5ImplementationEvidence,
  resolvePhase6ReleaseEvidence,
};
