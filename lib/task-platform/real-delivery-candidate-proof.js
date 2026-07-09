const fs = require('node:fs');
const path = require('node:path');
const {
  productionSafetyEvidenceFailures,
  rollbackEvidenceFailures,
  verifyRealDeliveryCandidate,
} = require('./real-delivery-candidate');
const { finalGithubProofFailures } = require('./real-delivery-candidate-github-proof');
const { hostedUrlFailure } = require('./hosted-url-evidence');

const REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION = 'real-delivery-candidate-proof.v1';

function writeJsonFile(root, filePath, payload) {
  const resolved = path.resolve(root, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function deploymentHealthUrl(deploymentUrl, healthCheckPath) {
  if (!healthCheckPath) return deploymentUrl;
  try {
    return new URL(healthCheckPath, deploymentUrl).toString();
  } catch {
    return deploymentUrl;
  }
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function sameDeploymentOrigin(deploymentUrl, healthUrl) {
  const deployment = parseHttpUrl(deploymentUrl);
  const health = parseHttpUrl(healthUrl);
  return Boolean(deployment && health && deployment.origin === health.origin);
}

function repositoryFromPrUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+(?:[/?#].*)?$/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function deploymentHealthUrlFailures(result = {}) {
  const health = result.deploymentHealth;
  if (!health) return [];
  if (!health.url) return ['deployment health URL is required'];
  return sameDeploymentOrigin(result.deploymentUrl, health.url)
    ? []
    : ['deployment health URL must match deployment URL origin'];
}

function localGitProofEvidence(result = {}) {
  const evidence = result.localGit || result;
  return {
    branch: evidence.branch || null,
    commitSha: evidence.commitSha || null,
    workingTreeClean: typeof evidence.workingTreeClean === 'boolean' ? evidence.workingTreeClean : null,
    dirtyFileCount: Number.isInteger(evidence.dirtyFileCount) ? evidence.dirtyFileCount : null,
    dirtyFiles: Array.isArray(evidence.dirtyFiles) ? evidence.dirtyFiles : [],
  };
}

async function checkDeploymentHealth(options = {}) {
  const url = deploymentHealthUrl(options.deploymentUrl, options.healthCheckPath);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!url || typeof fetchImpl !== 'function') {
    return { ok: false, url: url || null, status: null, error: 'fetch implementation and deployment URL are required' };
  }
  try {
    const response = await fetchImpl(url, { headers: { accept: 'text/html,application/json,*/*' } });
    const body = options.requireHealthCommit === true && typeof response.text === 'function'
      ? await response.text().catch(() => '')
      : '';
    const commitVerified = options.requireHealthCommit === true
      ? body.includes(options.commitSha)
      : null;
    return {
      ok: response.ok === true && (options.requireHealthCommit !== true || commitVerified === true),
      url,
      status: response.status || null,
      commitVerified,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false, url, status: null, error: error?.message || String(error), checkedAt: new Date().toISOString() };
  }
}

async function verifyRealDeliveryCandidateReleaseProof(options = {}) {
  const result = verifyRealDeliveryCandidate(options);
  if (options.verifyDeploymentHealth === true) {
    result.deploymentHealth = await checkDeploymentHealth({
      deploymentUrl: result.deploymentUrl,
      healthCheckPath: result.healthCheckPath,
      commitSha: result.commitSha,
      requireHealthCommit: result.requireHealthCommit,
      fetchImpl: options.fetchImpl,
    });
    if (result.deploymentHealth.ok !== true) {
      result.failures.push(`deployment health check failed for ${result.deploymentHealth.url || result.deploymentUrl || '(missing URL)'}`);
      result.ok = false;
    }
  }
  return result;
}

function compactSourceIntegrity(sourceIntegrity) {
  if (!sourceIntegrity) return null;
  return {
    checkedFiles: sourceIntegrity.checkedFiles || 0,
    nodeCheckedFiles: sourceIntegrity.nodeCheckedFiles || 0,
    failureCount: sourceIntegrity.failures?.length || 0,
    failures: sourceIntegrity.failures || [],
  };
}

function pushUniqueFailures(failures, additions = []) {
  for (const failure of additions) {
    if (failure && !failures.includes(failure)) failures.push(failure);
  }
}

function normalizeCommandArray(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(entries.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function testCommandArtifactFailures(result = {}) {
  const failures = [];
  const testCommands = normalizeCommandArray(result.testCommands);
  const testResults = Array.isArray(result.testCommandResults) ? result.testCommandResults : [];
  const expectedCommands = new Set(testCommands);
  const executedCommands = new Set();
  if (testCommands.length === 0) failures.push('candidate proof artifact must list executable test commands');
  if (testResults.length === 0) failures.push('candidate proof artifact must include executed test command results');
  for (const testResult of testResults) {
    const command = String(testResult?.command || '').trim();
    if (!command) {
      failures.push('candidate proof artifact test command result must include command');
      continue;
    }
    executedCommands.add(command);
    if (!expectedCommands.has(command)) {
      failures.push(`candidate proof artifact test command result must match a listed command: ${command}`);
    }
    if (testResult.ok !== true) {
      failures.push(`candidate proof artifact test command must pass: ${command}`);
    }
    if (testResult.exitCode !== 0) {
      failures.push(`candidate proof artifact test command exitCode must be 0: ${command}`);
    }
  }
  for (const command of testCommands.filter((entry) => !executedCommands.has(entry))) {
    failures.push(`candidate proof artifact must include executed result for listed test command: ${command}`);
  }
  return failures;
}

function proofArtifactFailures(result = {}) {
  const failures = Array.isArray(result.failures) ? [...result.failures] : [];
  if (result.requireFinalReleaseProof !== true || result.verifyDeploymentHealth !== true) return failures;
  pushUniqueFailures(failures, testCommandArtifactFailures(result));
  pushUniqueFailures(failures, rollbackEvidenceFailures({
    required: result.requireFinalReleaseProof === true,
    releaseEnv: result.releaseEnv,
    commitSha: result.commitSha,
    rollbackTarget: result.rollbackTarget,
    rollbackEvidence: result.rollbackEvidence,
  }));
  pushUniqueFailures(failures, productionSafetyEvidenceFailures({
    required: result.requireFinalReleaseProof === true,
    releaseEnv: result.releaseEnv,
    deploymentUrl: result.deploymentUrl,
    commitSha: result.commitSha,
    productionSafetyEvidence: result.productionSafetyEvidence,
  }));
  pushUniqueFailures(failures, finalGithubProofFailures(result));
  const health = result.deploymentHealth;
  const failure = !health
    ? 'deployment health check result is required for final real delivery candidate proof'
    : health.ok === true ? '' : 'passing deployment health check is required for final real delivery candidate proof';
  if (failure && !failures.includes(failure)) failures.push(failure);
  pushUniqueFailures(failures, [
    hostedUrlFailure('deploymentUrl', result.deploymentUrl),
    health?.url ? hostedUrlFailure('deployment health URL', health.url) : '',
  ]);
  pushUniqueFailures(failures, deploymentHealthUrlFailures(result));
  if (result.requireHealthCommit === true && health?.commitVerified !== true) {
    pushUniqueFailures(failures, ['deployment health check must prove the candidate commit SHA']);
  }
  const prRepository = repositoryFromPrUrl(result.prUrl);
  const repository = result.repository || result.ciRepository || prRepository;
  if (!repository) {
    pushUniqueFailures(failures, ['actual GitHub repository evidence is required for final real delivery candidate proof']);
  } else if (prRepository && repository !== prRepository) {
    pushUniqueFailures(failures, ['candidate repository must match pull request URL']);
  }
  const localGit = localGitProofEvidence(result);
  if (localGit.workingTreeClean !== true) {
    const failure = localGit.workingTreeClean === false
      ? `local git worktree must be clean before final real delivery candidate proof (${localGit.dirtyFileCount ?? 'unknown'} dirty files)`
      : 'final real delivery candidate proof requires local git worktree clean evidence';
    pushUniqueFailures(failures, [failure]);
  }
  return failures;
}

function buildRealDeliveryCandidateProof(result = {}) {
  const failures = proofArtifactFailures(result);
  const repository = result.repository || result.ciRepository || repositoryFromPrUrl(result.prUrl) || null;
  return {
    schemaVersion: REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: result.ok === true && failures.length === 0,
    repository,
    branch: result.branch || null,
    commitSha: result.commitSha || null,
    prUrl: result.prUrl || null,
    prNumber: result.prNumber || null,
    checks: result.checks || [],
    requiredChecks: result.requiredChecks || [],
    branchProtection: result.branchProtection || null,
    mergeReadiness: result.mergeReadiness || null,
    githubEvidenceSource: result.githubEvidenceSource || null,
    releaseEnv: result.releaseEnv || null,
    deploymentUrl: result.deploymentUrl || null,
    deploymentHealth: result.deploymentHealth || null,
    requireHealthCommit: result.requireHealthCommit === true,
    rollbackTarget: result.rollbackTarget || null,
    rollbackPlan: result.rollbackPlan || null,
    rollbackVerified: result.rollbackVerified === true,
    rollbackEvidence: result.rollbackEvidence || null,
    requireFinalReleaseProof: result.requireFinalReleaseProof === true,
    verifyDeploymentHealth: result.verifyDeploymentHealth === true,
    riskLevel: result.riskLevel || null,
    productionSafe: result.productionSafe === true,
    productionSafetyEvidence: result.productionSafetyEvidence || null,
    changedFiles: result.changedFiles || [],
    implementationFiles: result.implementationFiles || [],
    testFiles: result.testFiles || [],
    testCommands: result.testCommands || [],
    testCommandResults: result.testCommandResults || [],
    localGit: localGitProofEvidence(result),
    sourceIntegrity: compactSourceIntegrity(result.sourceIntegrity),
    failures,
  };
}

function writeRealDeliveryCandidateProof(root, outPath, result) {
  if (!outPath) return null;
  return writeJsonFile(root || process.cwd(), outPath, buildRealDeliveryCandidateProof(result));
}

module.exports = {
  REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
  buildRealDeliveryCandidateProof,
  checkDeploymentHealth,
  deploymentHealthUrl,
  deploymentHealthUrlFailures,
  verifyRealDeliveryCandidateReleaseProof,
  writeRealDeliveryCandidateProof,
};
