const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MERGE_READINESS_CHECK_NAME } = require('./merge-readiness-github-check');
const { assertRealPhase6Evidence, isRealEvidenceRequired, resolveReleaseEvidenceEnvironment } = require('./golden-path-real-evidence');
const { DEFAULT_GITHUB_API_BASE_URL, fetchGitHubJson, fetchGitHubPages } = require('./github-evidence-client');
const { assertTrustedGitHubEvidenceSource } = require('./github-evidence-source-policy');
const { collectGitHubBranchProtectionEvidence } = require('./github-branch-protection-evidence');
const { hostedReleaseArtifactInputFailures, releaseEvidenceBuilderInjectionFailure } = require('./hosted-release-artifact-inputs');
const { hostedUrlFailure } = require('./hosted-url-evidence');
const { assertRollbackEvidence, loadRollbackEvidenceReference } = require('./rollback-evidence');
const { artifactPaths: releaseArtifactPaths, buildReleaseArtifactsForProof, materializeReleaseArtifact, postDeployHealth: buildPostDeployHealthArtifact } = require('./release-artifact-evidence');

const DEFAULT_ARTIFACT_DIR = '.artifacts';
const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}
function shouldCollectGoldenPathRealEvidence(options = {}) {
  return options.collectRealEvidence === true || options.requireRealEvidence === true || options.agentDrivenPhases === true
    || parseBooleanEnv(process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false);
}

function parseGitHubPullRequestUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    repository: `${match[1]}/${match[2]}`,
    prNumber: Number(match[3]),
    prUrl: `https://github.com/${match[1]}/${match[2]}/pull/${Number(match[3])}`,
  };
}

function repositoryParts(repository) {
  const [owner, repo] = String(repository || '').split('/').filter(Boolean);
  return owner && repo ? { owner, repo, repository: `${owner}/${repo}` } : null;
}

function resolvePullRequestTarget(options = {}, evidence = {}) {
  const prUrl = options.prUrl || evidence.github?.prUrl || evidence.pr?.url;
  const parsed = parseGitHubPullRequestUrl(prUrl);
  if (parsed) return parsed;
  const parts = repositoryParts(options.ciRepository || options.repository || evidence.github?.repository);
  const prNumber = Number(options.prNumber || evidence.github?.prNumber || evidence.pr?.number);
  if (!parts || !Number.isInteger(prNumber) || prNumber <= 0) return null;
  return { ...parts, prNumber, prUrl: `https://github.com/${parts.repository}/pull/${prNumber}` };
}

function normalizeCheckRun(check = {}) {
  return {
    id: check.id || null, name: check.name || check.app?.name || 'check-run',
    status: check.status || null, conclusion: check.conclusion || null,
    url: check.html_url || check.details_url || null, source: 'github_check_run',
  };
}

function normalizeStatusCheck(status = {}) {
  return {
    id: status.id || null, name: status.context || 'status',
    status: status.state || null, conclusion: status.state || null,
    url: status.target_url || null, source: 'github_status',
  };
}

function checkPassed(check = {}) {
  const status = String(check.status || '').toLowerCase();
  const conclusion = String(check.conclusion || '').toLowerCase();
  return ['success', 'passed'].includes(status)
    || ['success', 'passed'].includes(conclusion)
    || (status === 'completed' && conclusion === 'success');
}

function findCheck(checks, pattern) {
  return checks.find((check) => pattern.test(String(check.name || check.checkName || check.context || '')));
}

function mergeReadinessFromChecks(checks = []) {
  const check = findCheck(checks, new RegExp(`^${MERGE_READINESS_CHECK_NAME}$`, 'i'))
    || findCheck(checks, /merge readiness/i);
  if (!check) return null;
  return {
    name: MERGE_READINESS_CHECK_NAME,
    reviewStatus: checkPassed(check) ? 'passed' : 'blocked',
    status: check.status || null,
    conclusion: check.conclusion || null,
    url: check.url || null,
    source: check.source || null,
  };
}

function explicitPrNumber(options = {}, evidence = {}) {
  const value = options.prNumber || evidence.github?.prNumber || evidence.pr?.number;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function explicitHeadSha(options = {}) { return options.implementationCommitSha || options.commitSha || null; }

function explicitBranchName(options = {}, evidence = {}) { return options.branchName || options.branch || evidence.github?.branchName || evidence.github?.branch || null; }

function assertCollectedPullRequestMatches(target, pull, options, evidence) {
  const actualPrNumber = Number(pull.number || target.prNumber);
  const requestedPrNumber = explicitPrNumber(options, evidence);
  if (requestedPrNumber && requestedPrNumber !== actualPrNumber) throw new Error(`collected PR #${actualPrNumber} does not match requested PR #${requestedPrNumber}`);
  if (!pull.head?.sha) throw new Error(`collected PR #${actualPrNumber} is missing a head SHA`);
  const requestedBranchName = explicitBranchName(options, evidence);
  if (requestedBranchName && requestedBranchName !== pull.head?.ref) throw new Error(`collected PR head branch ${pull.head?.ref || '(missing)'} does not match requested branch ${requestedBranchName}`);
  const requestedHeadSha = explicitHeadSha(options);
  if (requestedHeadSha && requestedHeadSha !== pull.head.sha) throw new Error(`collected PR head SHA ${pull.head.sha} does not match requested implementation commit ${requestedHeadSha}`);
}

async function collectGitHubPullRequestEvidence(options = {}, evidence = {}) {
  assertTrustedGitHubEvidenceSource(options);
  const target = resolvePullRequestTarget(options, evidence);
  if (!target) return null;
  const apiBaseUrl = options.githubApiBaseUrl || DEFAULT_GITHUB_API_BASE_URL;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required for GitHub evidence collection');
  const token = options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  const base = `/repos/${target.owner}/${target.repo}`;
  const pull = await fetchGitHubJson({ apiBaseUrl, fetchImpl, token, route: `${base}/pulls/${target.prNumber}` });
  assertCollectedPullRequestMatches(target, pull, options, evidence);
  const sha = pull.head.sha;
  const baseBranch = pull.base?.ref || options.baseBranch || options.defaultBranch || 'main';
  const branchProtection = await collectGitHubBranchProtectionEvidence({ apiBaseUrl, fetchImpl, token, repositoryBaseRoute: base, branch: baseBranch });
  const files = await fetchGitHubPages({ apiBaseUrl, fetchImpl, token, route: `${base}/pulls/${target.prNumber}/files` });
  const checkRuns = await fetchGitHubPages({
    apiBaseUrl, fetchImpl, token, route: `${base}/commits/${sha}/check-runs`, entries: (body) => body.check_runs || [],
  });
  const statuses = await fetchGitHubJson({ apiBaseUrl, fetchImpl, token, route: `${base}/commits/${sha}/status` });
  const checks = [...checkRuns.map(normalizeCheckRun), ...(statuses.statuses || []).map(normalizeStatusCheck)];
  return {
    repository: target.repository, branchName: pull.head?.ref || null, baseBranch, commitSha: sha, merged: pull.merged === true,
    mergeCommitSha: pull.merged === true ? pull.merge_commit_sha || null : null, mergedAt: pull.merged === true ? pull.merged_at || null : null,
    prUrl: pull.html_url || target.prUrl, prNumber: Number(pull.number || target.prNumber),
    changedFiles: (Array.isArray(files) ? files : []).map((file) => file.filename).filter(Boolean),
    checks, requiredChecks: branchProtection.requiredChecks,
    branchProtection,
    mergeReadiness: mergeReadinessFromChecks(checks),
    evidenceSource: { provider: 'github', apiBaseUrl: apiBaseUrl.replace(/\/$/, ''), collectedAt: nowIso() },
  };
}

function nowIso() { return new Date().toISOString(); }

function releaseArtifactBase(commitSha, environment, source) {
  return {
    schema_version: '1.0',
    generated_by: 'golden-path-real-evidence-collector',
    generated_at: nowIso(),
    commit_sha: commitSha,
    environment,
    source_system: source,
  };
}

function checkArtifact(name, check, commitSha, environment) {
  if (!check || !checkPassed(check)) return null;
  return {
    ...releaseArtifactBase(commitSha, environment, check.source || 'github-checks'),
    check_name: check.name,
    check_conclusion: check.conclusion || check.status,
    check_url: check.url || null,
    status: 'passed',
    artifact_name: name,
  };
}

function immutableArtifact(commitSha, repository, environment) {
  return {
    ...releaseArtifactBase(commitSha, environment, 'git'), artifact_name: 'immutable-artifact',
    repository, artifact_id: `${repository}@${commitSha}`, digest_algorithm: 'sha256',
    digest: crypto.createHash('sha256').update(`${repository}:${commitSha}`).digest('hex'),
  };
}

function deployRecord({ commitSha, environment, deploymentUrl, rollbackTarget }) {
  if (!deploymentUrl || !rollbackTarget) return null;
  return {
    ...releaseArtifactBase(commitSha, environment, 'deployment-provider'),
    artifact_name: 'deploy-record',
    deployed_sha: commitSha,
    deployment_url: deploymentUrl,
    rollback_target: rollbackTarget,
    status: 'deployed',
  };
}

function resolveDeploymentUrl(options, environment) {
  const explicitUrl = options.deploymentUrl || options.productionUrl;
  if (explicitUrl) {
    if (HOSTED_RELEASE_ENVIRONMENTS.has(environment)) {
      const failure = hostedUrlFailure(`hosted ${environment} deployment URL`, explicitUrl);
      if (failure) throw new Error(failure);
    }
    return explicitUrl;
  }
  return HOSTED_RELEASE_ENVIRONMENTS.has(environment) ? null : options.operatorUrl;
}

function rollbackVerification({ commitSha, environment, rollbackTarget, rollbackVerified, rollbackEvidence, repoRoot }) {
  if (!rollbackTarget || rollbackVerified !== true) return null;
  const failures = [];
  const payload = loadRollbackEvidenceReference(repoRoot || process.cwd(), rollbackEvidence, failures);
  if (failures.length) throw new Error(failures[0]);
  assertRollbackEvidence({ releaseEnv: environment, rollbackTarget, rollbackEvidence: payload });
  return {
    ...payload,
    ...releaseArtifactBase(commitSha, environment, 'deployment-provider'),
    artifact_name: 'rollback-verification',
    commit_sha: commitSha,
    environment,
    rollback_target: rollbackTarget,
    verification_status: 'verified',
  };
}

async function collectPostDeployHealth({ fetchImpl, deploymentUrl, commitSha, environment, requireHealthy, healthCheckPath, requireHealthCommit }) {
  if (!deploymentUrl) return null;
  try {
    const payload = await buildPostDeployHealthArtifact({
      fetchImpl, deploymentUrl, commitSha, releaseEnv: environment, healthCheckPath, requireHealthCommit,
    });
    if (requireHealthy && payload.status !== 'healthy') {
      const reason = requireHealthCommit && payload.commit_verified !== true
        ? 'did not prove deployed commit SHA'
        : `HTTP ${payload.http_status || 'unknown'}`;
      throw new Error(`post-deploy health check failed for ${payload.health_check_url || deploymentUrl}: ${reason}`);
    }
    return payload;
  } catch (error) {
    if (requireHealthy) {
      if (String(error.message || '').startsWith('post-deploy health check failed')) throw error;
      throw new Error(`post-deploy health check failed for ${deploymentUrl}: ${error.message}`);
    }
  }
  return null;
}

function releaseCommitSha(proof = {}) {
  if (proof.merged === true && !proof.mergeCommitSha) {
    throw new Error('merged PR release evidence requires mergeCommitSha');
  }
  return proof.mergeCommitSha || proof.commitSha;
}

async function writeReleaseEvidenceArtifacts(options, proof) {
  const repoRoot = options.cwd || process.cwd();
  const environment = resolveReleaseEvidenceEnvironment(options);
  if (!environment) return { artifacts: {}, environment: null };
  const inputFailures = hostedReleaseArtifactInputFailures(options, environment);
  if (inputFailures.length) throw new Error(`Hosted release artifact evidence is incomplete: ${inputFailures.join('; ')}`);
  const paths = releaseArtifactPaths(options.releaseArtifactDir || DEFAULT_ARTIFACT_DIR);
  const deploymentUrl = resolveDeploymentUrl(options, environment);
  const rollbackTarget = options.rollbackTarget || process.env.ROLLBACK_TARGET || null;
  const commitSha = releaseCommitSha(proof), repository = String(proof.repository || '').trim(), checks = proof.checks || [];
  if (!repository) throw new Error('release evidence repository is required');
  if (!/^([^/\s]+)\/([^/\s]+)$/.test(repository)) throw new Error('release evidence repository must be owner/repo');
  const commandArtifacts = await buildReleaseArtifactsForProof(options, proof, {
    commitSha,
    environment,
    deploymentUrl,
    rollbackTarget,
    outDir: options.releaseArtifactDir || DEFAULT_ARTIFACT_DIR,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    healthCheckPath: options.healthCheckPath || options.realDeliveryHealthCheckPath,
    requireHealthCommit: options.requireHealthCommit === true,
  });
  const materializeOptions = {
    ...options,
    useExistingReleaseArtifacts: options.useExistingReleaseArtifacts === true || Boolean(commandArtifacts),
  };
  const payloads = {
    build: checkArtifact('build', findCheck(checks, /\b(build|vite)\b/i), commitSha, environment),
    compatibility: checkArtifact('compatibility-report', findCheck(checks, /\b(test|browser|playwright|compat)/i), commitSha, environment),
    vulnerability: checkArtifact('vulnerability-scan', findCheck(checks, /\b(vulnerab|dependency|npm audit|security)\b/i), commitSha, environment),
    secret: checkArtifact('secret-scan', findCheck(checks, /\b(secret|gitleaks|trufflehog)\b/i), commitSha, environment),
    immutable: immutableArtifact(commitSha, repository, environment),
    deploy: deployRecord({ commitSha, environment, deploymentUrl, rollbackTarget }),
    health: await collectPostDeployHealth({
      fetchImpl: options.fetchImpl || globalThis.fetch,
      deploymentUrl,
      commitSha,
      environment,
      requireHealthy: options.requireHealthyDeployment !== false,
      healthCheckPath: options.healthCheckPath || options.realDeliveryHealthCheckPath,
      requireHealthCommit: options.requireHealthCommit === true,
    }),
    rollback: rollbackVerification({ commitSha, environment, rollbackTarget, rollbackVerified: options.rollbackVerified === true, rollbackEvidence: options.rollbackEvidence || options.realDeliveryRollbackEvidence, repoRoot }),
  };
  const artifacts = Object.fromEntries(Object.entries(payloads)
    .map(([name, payload]) => [name, materializeReleaseArtifact(repoRoot, paths[name], payload, materializeOptions)])
    .filter(([, artifactPath]) => artifactPath));
  return { environment, artifacts };
}

function buildReleaseEvidenceArgs(artifactResult) {
  const artifacts = artifactResult.artifacts || {};
  const args = ['dev-standards/tooling/build_release_evidence.py', '--environment', artifactResult.environment];
  for (const [name, evidenceName] of [['build', 'build'], ['compatibility', 'compatibility-report'], ['vulnerability', 'vulnerability-scan'], ['secret', 'secret-scan']]) {
    if (artifacts[name]) args.push('--evidence', `${evidenceName}=${artifacts[name]}`);
  }
  if (artifacts.deploy) args.push('--deploy-record', artifacts.deploy);
  if (artifacts.health) args.push('--post-deploy-health', artifacts.health);
  if (artifacts.rollback) args.push('--rollback-verification', artifacts.rollback);
  if (artifacts.immutable) args.push('--immutable-artifact', artifacts.immutable);
  return args;
}

function buildReleaseEvidenceBundle(artifactResult, options = {}) {
  if (!artifactResult.environment) return { skipped: true, reason: 'release_environment_not_requested' };
  const injectionFailure = releaseEvidenceBuilderInjectionFailure(options);
  if (injectionFailure) throw new Error(injectionFailure);
  if (typeof options.releaseEvidenceBuilder === 'function') {
    return { environment: artifactResult.environment, ...options.releaseEvidenceBuilder(artifactResult) };
  }
  const cwd = options.cwd || process.cwd();
  const stdout = execFileSync('python3', buildReleaseEvidenceArgs(artifactResult), {
    cwd,
    env: { ...process.env, CHANGE_KIND: options.changeKind || process.env.CHANGE_KIND || 'bugfix', CHANGE_REVERSIBILITY: options.changeReversibility || process.env.CHANGE_REVERSIBILITY || 'reversible' },
    encoding: 'utf8',
  });
  return { environment: artifactResult.environment, ok: true, stdout };
}
function assertReleaseEvidenceBundlePassed(releaseEvidence = {}, options = {}) {
  if (!isRealEvidenceRequired(options)) return;
  if (releaseEvidence.ok === true && releaseEvidence.skipped !== true) return;
  const detail = releaseEvidence.stdout || releaseEvidence.stderr || releaseEvidence.reason || 'release evidence validation did not pass';
  throw new Error(`Golden-path real release evidence validation failed: ${detail}`);
}
function releaseEvidenceSummary(artifactResult = {}, releaseEvidence = {}) {
  return { environment: artifactResult.environment || null, artifacts: artifactResult.artifacts || {}, validation: { ok: releaseEvidence.ok === true && releaseEvidence.skipped !== true, skipped: releaseEvidence.skipped === true, reason: releaseEvidence.reason || null } };
}
function mergeCollectedEvidence(evidence, proof, artifactResult, releaseEvidence) {
  return {
    ...evidence,
    github: {
      ...(evidence.github || {}),
      repository: proof.repository, branchName: proof.branchName, commitSha: proof.commitSha, merged: proof.merged === true,
      mergeCommitSha: proof.mergeCommitSha || undefined, mergedAt: proof.mergedAt || undefined,
      prUrl: proof.prUrl, prNumber: proof.prNumber,
      changedFiles: proof.changedFiles,
      checks: proof.checks,
      requiredChecks: proof.requiredChecks,
      branchProtection: proof.branchProtection,
      mergeReadiness: proof.mergeReadiness,
      evidenceSource: proof.evidenceSource,
    },
    change: {
      ...(evidence.change || {}),
      changedFiles: proof.changedFiles,
    },
    releaseEvidence: releaseEvidenceSummary(artifactResult, releaseEvidence),
  };
}

function assertCollectedRealPhase6Proof(evidence, options, proof, releaseEvidence) {
  if (!isRealEvidenceRequired(options)) return;
  assertRealPhase6Evidence(evidence, { ...options, releaseEvidenceValidator: () => releaseEvidence }, {
    branchName: proof.branchName, commitSha: proof.commitSha, prUrl: proof.prUrl,
    prNumber: proof.prNumber, checks: proof.checks, requiredChecks: proof.requiredChecks, branchProtection: proof.branchProtection,
    mergeReadiness: proof.mergeReadiness,
  });
}

async function prepareGoldenPathRealEvidence({ evidence = {}, options = {} } = {}) {
  if (!shouldCollectGoldenPathRealEvidence(options)) return { evidence, options, collected: false };
  const github = await collectGitHubPullRequestEvidence(options, evidence);
  if (!github) { if (isRealEvidenceRequired(options)) throw new Error('Strict golden-path real evidence collection requires an actual pull request target'); return { evidence, options, collected: false, reason: 'missing_pull_request_target' }; }
  const mergedOptions = {
    ...options,
    branchName: github.branchName,
    implementationCommitSha: github.commitSha,
    mergeCommitSha: options.mergeCommitSha || github.mergeCommitSha || '',
    prUrl: github.prUrl,
    prNumber: github.prNumber,
    checks: github.checks,
    requiredChecks: github.requiredChecks,
    mergeReadiness: github.mergeReadiness,
    changedFiles: github.changedFiles,
    requireRealEvidence: options.requireRealEvidence || isRealEvidenceRequired(options),
  };
  const proof = { ...github, checks: github.checks, requiredChecks: github.requiredChecks, mergeReadiness: github.mergeReadiness };
  const artifactResult = await writeReleaseEvidenceArtifacts(mergedOptions, proof);
  const releaseEvidence = await buildReleaseEvidenceBundle(artifactResult, mergedOptions);
  assertReleaseEvidenceBundlePassed(releaseEvidence, mergedOptions);
  const collectedEvidence = mergeCollectedEvidence(evidence, proof, artifactResult, releaseEvidence);
  assertCollectedRealPhase6Proof(collectedEvidence, mergedOptions, proof, releaseEvidence);
  return { evidence: collectedEvidence, options: mergedOptions, collected: true, releaseEvidence, releaseArtifacts: artifactResult.artifacts };
}

module.exports = { assertReleaseEvidenceBundlePassed, buildReleaseEvidenceArgs, buildReleaseEvidenceBundle, collectGitHubPullRequestEvidence, mergeReadinessFromChecks, parseGitHubPullRequestUrl, prepareGoldenPathRealEvidence, releaseEvidenceSummary, shouldCollectGoldenPathRealEvidence, writeReleaseEvidenceArtifacts };
