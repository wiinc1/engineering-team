const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hostedUrlFailure } = require('./hosted-url-evidence');
const {
  gitOutput,
  localGitWorktreeFailure,
  localGitWorktreeState,
} = require('./local-git-proof-inputs');
const { commitShaEvidenceFailure } = require('./real-commit-sha');

const RELEASE_ARTIFACT_SCHEMA_VERSION = '1.0';
const DEFAULT_RELEASE_ARTIFACT_DIR = 'observability/release/artifacts';
const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);
const COMMAND_ARTIFACTS = Object.freeze([
  ['build', 'build'],
  ['compatibility', 'compatibility-report'],
  ['vulnerability', 'vulnerability-scan'],
  ['secret', 'secret-scan'],
]);

function nowIso() {
  return new Date().toISOString();
}

function artifactPaths(outDir = DEFAULT_RELEASE_ARTIFACT_DIR) {
  return {
    build: path.join(outDir, 'build.json'),
    compatibility: path.join(outDir, 'compatibility-report.json'),
    vulnerability: path.join(outDir, 'vulnerability-scan.json'),
    secret: path.join(outDir, 'secret-scan.json'),
    immutable: path.join(outDir, 'immutable-artifact.json'),
    deploy: path.join(outDir, 'deploy-record.json'),
    health: path.join(outDir, 'post-deploy-health.json'),
    rollback: path.join(outDir, 'rollback-verification.json'),
  };
}

function releaseArtifactCommands(options = {}) {
  const commands = options.releaseArtifactCommands || {
    build: options.releaseBuildCommand,
    compatibility: options.releaseCompatibilityCommand,
    vulnerability: options.releaseVulnerabilityCommand,
    secret: options.releaseSecretCommand,
  };
  return Object.values(commands).some(Boolean) ? commands : null;
}

function releaseArtifactBase(options, artifactName, sourceSystem) {
  return {
    schema_version: RELEASE_ARTIFACT_SCHEMA_VERSION,
    generated_by: 'release-artifact-evidence-builder',
    generated_at: options.generatedAt || nowIso(),
    commit_sha: options.commitSha,
    environment: options.releaseEnv,
    source_system: sourceSystem,
    artifact_name: artifactName,
  };
}

function tailText(value, maxLength = 2000) {
  const text = String(value || '');
  return text.length > maxLength ? text.slice(text.length - maxLength) : text;
}

function runEvidenceCommand(root, command, timeoutMs) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });
  return {
    command,
    ok: result.status === 0,
    exit_code: result.status,
    signal: result.signal || null,
    duration_ms: Date.now() - startedAt,
    stdout_tail: tailText(result.stdout),
    stderr_tail: tailText(result.stderr || result.error?.message),
  };
}

function commandArtifact(options, artifactKey, artifactName, commandResult) {
  return {
    ...releaseArtifactBase(options, artifactName, 'command'),
    command: commandResult.command,
    exit_code: commandResult.exit_code,
    signal: commandResult.signal,
    duration_ms: commandResult.duration_ms,
    stdout_tail: commandResult.stdout_tail,
    stderr_tail: commandResult.stderr_tail,
    status: commandResult.ok ? 'passed' : 'failed',
    check_name: `${artifactKey} command`,
  };
}

function immutableArtifact(options) {
  const repository = options.repository;
  return {
    ...releaseArtifactBase(options, 'immutable-artifact', 'git'),
    repository,
    artifact_id: `${repository}@${options.commitSha}`,
    digest_algorithm: 'sha256',
    digest: crypto.createHash('sha256').update(`${repository}:${options.commitSha}`).digest('hex'),
  };
}

function deployRecord(options) {
  return {
    ...releaseArtifactBase(options, 'deploy-record', 'deployment-provider'),
    deployed_sha: options.commitSha,
    deployment_url: options.deploymentUrl,
    rollback_target: options.rollbackTarget,
    status: 'deployed',
  };
}

function deploymentHealthUrl(deploymentUrl, healthCheckPath) {
  if (!healthCheckPath) return deploymentUrl;
  try {
    return new URL(healthCheckPath, deploymentUrl).toString();
  } catch {
    return deploymentUrl;
  }
}

async function responseText(response) {
  if (!response || typeof response.text !== 'function') return '';
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function postDeployHealth(options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required for deployment health');
  const url = deploymentHealthUrl(options.deploymentUrl, options.healthCheckPath);
  const response = await fetchImpl(url, { headers: { accept: 'text/html,application/json,*/*' } });
  const text = options.requireHealthCommit === true ? await responseText(response) : '';
  const commitVerified = options.requireHealthCommit === true ? text.includes(options.commitSha) : null;
  const healthy = response.ok === true && (options.requireHealthCommit !== true || commitVerified === true);
  return {
    ...releaseArtifactBase(options, 'post-deploy-health', 'http-health-check'),
    checked_sha: options.commitSha,
    deployment_url: options.deploymentUrl,
    health_check_url: url,
    status: healthy ? 'healthy' : 'unhealthy',
    http_status: response.status || null,
    commit_verified: commitVerified,
  };
}

function localCheckoutFailures(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  if (gitOutput(repoRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return ['release artifact repo root must be a git worktree'];
  }
  const failures = [];
  const headSha = gitOutput(repoRoot, ['rev-parse', 'HEAD']);
  if (!headSha) failures.push('release artifact local HEAD commit is required');
  else if (options.commitSha && headSha !== options.commitSha) {
    failures.push(`release artifact commit SHA ${options.commitSha} must match local HEAD ${headSha}`);
  }
  const worktreeFailure = localGitWorktreeFailure(localGitWorktreeState(repoRoot), 'release artifact generation');
  if (worktreeFailure) failures.push(worktreeFailure);
  return failures;
}

function planFailures(options = {}) {
  const failures = [];
  const releaseEnv = String(options.releaseEnv || '').toLowerCase();
  const repository = String(options.repository || '').trim();
  if (!HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv)) {
    failures.push(`release environment must be staging or prod; got ${options.releaseEnv || 'none'}`);
  }
  if (!repository) failures.push('release artifact repository is required');
  else if (!/^([^/\s]+)\/([^/\s]+)$/.test(repository)) failures.push('release artifact repository must be owner/repo');
  const commitFailure = commitShaEvidenceFailure(options.commitSha);
  if (commitFailure) failures.push(`release artifact ${commitFailure}`);
  const urlFailure = hostedUrlFailure('deployment_url', options.deploymentUrl);
  if (urlFailure) failures.push(urlFailure);
  if (!options.rollbackTarget) failures.push('rollback target is required');
  if (HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv)) {
    if (!options.healthCheckPath) failures.push('health check path is required for hosted release artifacts');
    if (options.requireHealthCommit !== true) {
      failures.push('hosted release artifacts must require deployed commit SHA health proof');
    }
  }
  for (const [key] of COMMAND_ARTIFACTS) {
    if (!options.commands?.[key]) failures.push(`${key} command is required`);
  }
  failures.push(...localCheckoutFailures(options));
  return failures;
}

function writeJson(root, filePath, payload) {
  const resolved = path.resolve(root, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function existingJsonArtifact(repoRoot, artifactPath) {
  const resolved = path.resolve(repoRoot, artifactPath);
  if (!fs.existsSync(resolved)) return null;
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? artifactPath : null;
}

function materializeReleaseArtifact(repoRoot, artifactPath, payload, options = {}) {
  if (payload) return writeJson(repoRoot, artifactPath, payload);
  return options.useExistingReleaseArtifacts === true
    ? existingJsonArtifact(repoRoot, artifactPath)
    : null;
}

async function buildReleaseArtifacts(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const normalized = {
    ...options,
    repoRoot,
    releaseEnv: String(options.releaseEnv || '').toLowerCase(),
    repository: String(options.repository || '').trim(),
  };
  const failures = planFailures(normalized);
  if (failures.length) return { ok: false, failures, artifacts: {} };
  const timeoutMs = Number(options.timeoutMs || 120000);
  const payloads = {};
  for (const [key, name] of COMMAND_ARTIFACTS) {
    const result = runEvidenceCommand(repoRoot, normalized.commands[key], timeoutMs);
    payloads[key] = commandArtifact(normalized, key, name, result);
    if (!result.ok) failures.push(`${key} command failed: ${normalized.commands[key]}`);
  }
  payloads.immutable = immutableArtifact(normalized);
  payloads.deploy = deployRecord(normalized);
  try {
    payloads.health = await postDeployHealth(normalized);
    if (payloads.health.status !== 'healthy') {
      failures.push(normalized.requireHealthCommit === true && payloads.health.commit_verified !== true
        ? 'deployment health check did not prove deployed commit SHA'
        : `deployment health check failed: HTTP ${payloads.health.http_status || 'unknown'}`);
    }
  } catch (error) {
    failures.push(`deployment health check failed: ${error.message}`);
  }
  if (failures.length) return { ok: false, failures, artifacts: {}, payloads };
  const paths = artifactPaths(options.outDir || DEFAULT_RELEASE_ARTIFACT_DIR);
  const artifacts = Object.fromEntries(Object.entries(payloads).map(([key, payload]) => [key, writeJson(repoRoot, paths[key], payload)]));
  return { ok: true, failures: [], artifacts, payloads };
}

async function buildReleaseArtifactsForProof(options = {}, proof = {}, context = {}) {
  const commands = releaseArtifactCommands(options);
  if (!commands) return null;
  const result = await buildReleaseArtifacts({
    repoRoot: options.cwd || process.cwd(),
    releaseEnv: context.environment,
    commitSha: context.commitSha,
    deploymentUrl: context.deploymentUrl,
    rollbackTarget: context.rollbackTarget,
    repository: proof.repository,
    outDir: context.outDir,
    fetchImpl: context.fetchImpl || options.fetchImpl || globalThis.fetch,
    healthCheckPath: options.healthCheckPath || options.realDeliveryHealthCheckPath || context.healthCheckPath,
    requireHealthCommit: options.requireHealthCommit === true || context.requireHealthCommit === true,
    timeoutMs: options.releaseArtifactCommandTimeoutMs,
    commands,
  });
  if (!result.ok) throw new Error(`Release artifact command evidence failed: ${result.failures.join('; ')}`);
  return result;
}

module.exports = {
  COMMAND_ARTIFACTS,
  DEFAULT_RELEASE_ARTIFACT_DIR,
  RELEASE_ARTIFACT_SCHEMA_VERSION,
  artifactPaths,
  buildReleaseArtifacts,
  buildReleaseArtifactsForProof,
  deploymentHealthUrl,
  localCheckoutFailures,
  materializeReleaseArtifact,
  planFailures,
  postDeployHealth,
  releaseArtifactCommands,
};
