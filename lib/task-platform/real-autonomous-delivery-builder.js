const fs = require('node:fs');
const path = require('node:path');
const {
  assertReleaseEvidenceBundlePassed,
  buildReleaseEvidenceBundle,
  collectGitHubPullRequestEvidence,
  releaseEvidenceSummary,
  writeReleaseEvidenceArtifacts,
} = require('./golden-path-real-evidence-collector');
const {
  assertGoldenPathRealEvidencePreflight,
} = require('./golden-path-real-evidence-preflight');
const {
  verifyRealAutonomousDeliveryEvidence,
} = require('./real-autonomous-delivery-evidence');
const { commitShaEvidenceFailure } = require('./real-commit-sha');

function nowIso() {
  return new Date().toISOString();
}

function deploymentUrlFrom(options = {}) {
  return options.deploymentUrl || options.productionUrl || options.operatorUrl || options.baseUrl || null;
}

function runtimeBaseUrlFrom(options = {}) {
  return options.baseUrl || options.apiBaseUrl || deploymentUrlFrom(options);
}

function readJsonFile(root, filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(root || process.cwd(), filePath), 'utf8'));
}

function sourceEvidenceReference(options = {}) {
  return options.sourceEvidencePath || options.evidencePath || null;
}

function assertMergedGitHubProof(github) {
  if (!github) throw new Error('final autonomous delivery evidence requires GitHub PR proof');
  if (github.merged !== true) {
    throw new Error('final autonomous delivery evidence requires merged GitHub PR proof');
  }
  if (!github.mergeCommitSha) {
    throw new Error('final autonomous delivery evidence requires GitHub mergeCommitSha proof');
  }
  if (!github.mergedAt) {
    throw new Error('final autonomous delivery evidence requires GitHub mergedAt proof');
  }
}

function finalSourceEvidence(options = {}, failures = null) {
  if (options.evidence) return options.evidence;
  if (options.sourceEvidence) return options.sourceEvidence;
  const evidencePath = sourceEvidenceReference(options);
  if (!evidencePath) return null;
  try {
    return readJsonFile(options.cwd || options.repoRoot || process.cwd(), evidencePath);
  } catch (error) {
    if (!failures) throw error;
    failures.push(`source phase 6 evidence cannot be read: ${error.message}`);
    return null;
  }
}

function sourcePhase6AutoMergeEvidence(options = {}, failures = null) {
  return finalSourceEvidence(options, failures)?.phase6?.api?.autoMerge || options.phase6AutoMerge || null;
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

function sourceAutoMergeFailures(autoMerge, github = null) {
  const failures = [];
  if (!autoMerge) return ['source phase 6 auto-merge proof is required'];
  if (autoMerge.ok !== true) failures.push('source phase 6 auto-merge proof must pass');
  if (autoMerge.simulated === true) failures.push('source phase 6 auto-merge proof cannot be simulated');
  if (autoMerge.skipped === true) failures.push('source phase 6 auto-merge proof cannot be skipped');
  if (autoMerge.reason && autoMerge.reason !== 'merged') failures.push('source phase 6 auto-merge reason must be merged');
  if (autoMerge.merged !== true) failures.push('source phase 6 auto-merge proof must confirm GitHub merged the PR');
  if (!autoMerge.mergeCommitSha) failures.push('source phase 6 auto-merge mergeCommitSha is required');
  else {
    const commitFailure = commitShaEvidenceFailure(autoMerge.mergeCommitSha);
    if (commitFailure) failures.push(`source phase 6 auto-merge mergeCommitSha: ${commitFailure}`);
  }
  if (!autoMerge.mergedAt || Number.isNaN(Date.parse(autoMerge.mergedAt))) {
    failures.push('source phase 6 auto-merge mergedAt timestamp is required');
  }
  if (!autoMerge.prUrl && !normalizePrNumber(autoMerge.prNumber, autoMerge.prUrl)) {
    failures.push('source phase 6 auto-merge pull request evidence is required');
  }
  if (autoMerge.prUrl && !prNumberFromUrl(autoMerge.prUrl)) {
    failures.push('source phase 6 auto-merge prUrl must be a github.com pull request URL');
  }
  if (github?.mergeCommitSha && autoMerge.mergeCommitSha && github.mergeCommitSha !== autoMerge.mergeCommitSha) {
    failures.push('source phase 6 auto-merge mergeCommitSha must match GitHub mergeCommitSha');
  }
  if (github?.prUrl && autoMerge.prUrl && github.prUrl !== autoMerge.prUrl) {
    failures.push('source phase 6 auto-merge prUrl must match GitHub prUrl');
  }
  const sourcePrNumber = normalizePrNumber(autoMerge.prNumber, autoMerge.prUrl);
  const githubPrNumber = normalizePrNumber(github?.prNumber, github?.prUrl);
  if (sourcePrNumber && githubPrNumber && sourcePrNumber !== githubPrNumber) {
    failures.push('source phase 6 auto-merge prNumber must match GitHub prNumber');
  }
  return failures;
}

function assertSourcePhase6AutoMergeProof(options = {}, github = null) {
  const failures = sourceAutoMergeFailures(sourcePhase6AutoMergeEvidence(options), github);
  if (failures.length) {
    throw new Error(`final autonomous delivery evidence requires source phase 6 auto-merge proof: ${failures.join('; ')}`);
  }
}

function finalGithubOptions(options = {}) {
  return {
    ...options,
    collectRealEvidence: true,
    requireRealEvidence: true,
    cwd: options.cwd || options.repoRoot || process.cwd(),
  };
}

function finalEvidencePreflightOptions(options = {}) {
  const cwd = options.cwd || options.repoRoot || process.cwd();
  const sourceFailures = [];
  const autoMerge = sourcePhase6AutoMergeEvidence({ ...options, cwd }, sourceFailures);
  return {
    ...options,
    cwd,
    repoRoot: cwd,
    mergeCommitSha: options.mergeCommitSha || autoMerge?.mergeCommitSha || null,
    collectRealEvidence: true,
    requireRealEvidence: true,
    resumePhase6Only: true,
    // The final proof builder runs after phase 6; it verifies the source
    // auto-merge proof instead of issuing the merge request itself.
    autoMerge: true,
    operatorUrl: options.operatorUrl || options.baseUrl || options.deploymentUrl || options.productionUrl,
    baseUrl: options.baseUrl || options.operatorUrl || options.deploymentUrl || options.productionUrl,
    requireHealthyDeployment: options.requireHealthyDeployment !== false,
    requireReadableCandidateProof: Boolean(options.candidateProofPath),
  };
}

function assertRealAutonomousDeliveryBuildPreflight(options = {}) {
  const preflightOptions = finalEvidencePreflightOptions(options);
  let result = null;
  let preflightError = null;
  try {
    result = assertGoldenPathRealEvidencePreflight(preflightOptions, {
      context: 'Real autonomous delivery final evidence build',
    });
  } catch (error) {
    preflightError = error;
  }
  const sourceFailures = [];
  const autoMerge = sourcePhase6AutoMergeEvidence(preflightOptions, sourceFailures);
  sourceFailures.push(...sourceAutoMergeFailures(autoMerge));
  if (preflightError || sourceFailures.length) {
    const details = [
      preflightError?.message,
      sourceFailures.length && `final autonomous delivery evidence requires source phase 6 auto-merge proof: ${sourceFailures.join('; ')}`,
    ].filter(Boolean);
    throw new Error(details.join('; '));
  }
  return result;
}

async function collectFinalGithubEvidence(options = {}) {
  const github = await collectGitHubPullRequestEvidence(finalGithubOptions(options), options.evidence || {});
  assertMergedGitHubProof(github);
  return github;
}

function buildRealAutonomousDeliveryEvidenceDocument({
  options = {},
  github,
  releaseSummary,
} = {}) {
  const deploymentUrl = deploymentUrlFrom(options);
  const autoMerge = sourcePhase6AutoMergeEvidence(options);
  assertSourcePhase6AutoMergeProof(options, github);
  return {
    schemaVersion: 'real-autonomous-delivery-evidence.v1',
    generatedAt: nowIso(),
    status: 'phase6_complete',
    baseUrl: runtimeBaseUrlFrom(options),
    operatorUrl: options.operatorUrl || deploymentUrl,
    github,
    change: {
      kind: options.changeKind || options.evidence?.change?.kind || null,
      changedFiles: github.changedFiles || [],
    },
    engineeringTeam: {
      templateTier: options.templateTier || options.evidence?.engineeringTeam?.templateTier || null,
    },
    realDelivery: {
      candidateProofPath: options.candidateProofPath || null,
    },
    phase6: {
      api: {
        validation: {
          ok: true,
          skipped: false,
          source: 'real-autonomous-delivery-builder',
        },
        autoMerge,
        deploy: {
          operatorUrl: options.operatorUrl || deploymentUrl,
          deploymentUrl,
        },
        releaseEvidence: releaseSummary,
      },
    },
    releaseEvidence: releaseSummary,
  };
}

async function buildReleaseSummary(options, github) {
  const artifactResult = await writeReleaseEvidenceArtifacts(finalGithubOptions(options), github);
  const releaseEvidence = await buildReleaseEvidenceBundle(artifactResult, finalGithubOptions(options));
  assertReleaseEvidenceBundlePassed(releaseEvidence, finalGithubOptions(options));
  return {
    artifactResult,
    releaseEvidence,
    releaseSummary: releaseEvidenceSummary(artifactResult, releaseEvidence),
  };
}

function verifyFinalEvidence(evidence, options = {}) {
  const verification = verifyRealAutonomousDeliveryEvidence({
    evidence,
    candidateProof: options.candidateProof,
    candidateProofPath: options.candidateProofPath,
    repoRoot: options.cwd || options.repoRoot || process.cwd(),
    releaseEnv: options.releaseEnv,
  });
  if (!verification.ok) {
    throw new Error(`real autonomous delivery evidence failed: ${verification.failures.join('; ')}`);
  }
  return verification;
}

async function buildRealAutonomousDeliveryEvidence(options = {}) {
  const cwd = options.cwd || options.repoRoot || process.cwd();
  const normalized = { ...options, cwd };
  assertRealAutonomousDeliveryBuildPreflight(normalized);
  const sourceEvidence = finalSourceEvidence(normalized);
  const withSourceEvidence = { ...normalized, evidence: sourceEvidence };
  const github = await collectFinalGithubEvidence(withSourceEvidence);
  const release = await buildReleaseSummary(withSourceEvidence, github);
  const evidence = buildRealAutonomousDeliveryEvidenceDocument({
    options: withSourceEvidence,
    github,
    releaseSummary: release.releaseSummary,
  });
  const verification = verifyFinalEvidence(evidence, withSourceEvidence);
  return {
    evidence,
    github,
    releaseArtifacts: release.artifactResult.artifacts,
    releaseEvidence: release.releaseEvidence,
    verification,
  };
}

function writeRealAutonomousDeliveryEvidence(root, outPath, evidence) {
  if (!outPath) return null;
  const resolved = path.resolve(root || process.cwd(), outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`);
  return resolved;
}

module.exports = {
  assertSourcePhase6AutoMergeProof,
  assertRealAutonomousDeliveryBuildPreflight,
  buildRealAutonomousDeliveryEvidence,
  buildRealAutonomousDeliveryEvidenceDocument,
  collectFinalGithubEvidence,
  finalSourceEvidence,
  finalEvidencePreflightOptions,
  sourceEvidenceReference,
  sourcePhase6AutoMergeEvidence,
  writeRealAutonomousDeliveryEvidence,
};
