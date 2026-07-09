function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function hasPullRequestTarget(options = {}) {
  return Boolean(prNumberFromUrl(options.prUrl))
    || (Boolean(options.repository) && Number(options.prNumber) > 0);
}

function addArg(args, name, value) {
  if (value == null || value === '') return args;
  args.push(name, String(value));
  return args;
}

function addFlag(args, name, enabled = true) {
  if (enabled) args.push(name);
  return args;
}

function quoteArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+$-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function commandLine(argv = []) {
  return argv.map(quoteArg).join(' ');
}

function command(id, description, argv, requires = []) {
  return { id, description, argv, command: commandLine(argv), requires };
}

function discoverPrTargetArgs(options = {}) {
  const args = ['npm', 'run', 'autonomy:discover-real-delivery-pr', '--'];
  addArg(args, '--repository', options.repository);
  addArg(args, '--branch', options.branchName);
  addArg(args, '--implementation-commit-sha', options.implementationCommitSha);
  addArg(args, '--head-owner', options.headOwner);
  addArg(args, '--github-api-base-url', options.githubApiBaseUrl);
  addArg(args, '--report', options.prDiscoveryReportPath);
  addFlag(args, '--json');
  return args;
}

function addPrTargetArgs(args, options = {}) {
  if (hasPullRequestTarget(options)) {
    addArg(args, '--repository', options.repository);
    addArg(args, '--pr-url', options.prUrl);
    addArg(args, '--pr-number', options.prNumber);
    return args;
  }
  addFlag(args, '--use-pr-discovery-report', Boolean(options.prDiscoveryReportPath));
  addArg(args, '--pr-discovery-report', options.prDiscoveryReportPath);
  return args;
}

function buildReleaseArtifactArgs(options = {}, commitSha = options.implementationCommitSha) {
  const args = ['npm', 'run', 'autonomy:build-release-artifacts', '--'];
  addArg(args, '--release-env', options.releaseEnv);
  addArg(args, '--commit-sha', commitSha);
  addArg(args, '--deployment-url', options.deploymentUrl);
  addArg(args, '--health-check-path', options.healthCheckPath);
  addFlag(args, '--require-health-commit', options.requireHealthCommit);
  addArg(args, '--rollback-target', options.rollbackTarget);
  addArg(args, '--repository', options.repository);
  addArg(args, '--out-dir', options.releaseArtifactDir);
  addArg(args, '--build-command', options.releaseArtifactCommands?.build);
  addArg(args, '--compatibility-command', options.releaseArtifactCommands?.compatibility);
  addArg(args, '--vulnerability-command', options.releaseArtifactCommands?.vulnerability);
  addArg(args, '--secret-command', options.releaseArtifactCommands?.secret);
  return args;
}

function candidateProofArgs(options = {}) {
  const args = ['npm', 'run', 'autonomy:verify-real-delivery-candidate', '--'];
  addFlag(args, '--collect-github-evidence');
  addArg(args, '--out', options.candidateProofPath);
  addFlag(args, '--run-test-commands');
  addArg(args, '--branch', options.branchName);
  addArg(args, '--implementation-commit-sha', options.implementationCommitSha);
  addPrTargetArgs(args, options);
  addArg(args, '--release-env', options.releaseEnv);
  addArg(args, '--deployment-url', options.deploymentUrl);
  addArg(args, '--health-check-path', options.healthCheckPath);
  addFlag(args, '--require-health-commit', options.requireHealthCommit);
  addArg(args, '--production-safety-evidence', options.productionSafetyEvidence);
  addArg(args, '--rollback-target', options.rollbackTarget);
  addArg(args, '--rollback-evidence', options.rollbackEvidence);
  addFlag(args, '--require-final-release-proof');
  addFlag(args, '--verify-deployment-health');
  addFlag(args, '--rollback-verified');
  addArg(args, '--risk-level', 'low');
  addFlag(args, '--production-safe');
  for (const testCommand of options.candidateTestCommands || []) addArg(args, '--test-command', testCommand);
  return args;
}

function addReleaseArtifactPreflightArgs(args, options = {}) {
  addArg(args, '--release-artifact-dir', options.releaseArtifactDir);
  if (options.useExistingReleaseArtifacts) {
    addFlag(args, '--use-existing-release-artifacts');
    return args;
  }
  addArg(args, '--release-build-command', options.releaseArtifactCommands?.build);
  addArg(args, '--release-compatibility-command', options.releaseArtifactCommands?.compatibility);
  addArg(args, '--release-vulnerability-command', options.releaseArtifactCommands?.vulnerability);
  addArg(args, '--release-secret-command', options.releaseArtifactCommands?.secret);
  return args;
}

function hostedPreflightArgs(options = {}) {
  const args = ['npm', 'run', 'autonomy:preflight-real-delivery', '--'];
  addArg(args, '--release-env', options.releaseEnv);
  addArg(args, '--base-url', options.baseUrl);
  addArg(args, '--operator-url', options.operatorUrl || options.deploymentUrl);
  addArg(args, '--repository', options.repository);
  addArg(args, '--branch', options.branchName);
  addArg(args, '--implementation-commit-sha', options.implementationCommitSha);
  addPrTargetArgs(args, options);
  addFlag(args, '--auto-merge');
  addArg(args, '--deployment-url', options.deploymentUrl);
  addArg(args, '--rollback-target', options.rollbackTarget);
  addFlag(args, '--rollback-verified');
  addArg(args, '--rollback-evidence', options.rollbackEvidence);
  addArg(args, '--candidate-proof', options.candidateProofPath);
  addFlag(args, '--require-health-commit', options.requireHealthCommit);
  addArg(args, '--health-check-path', options.healthCheckPath);
  addReleaseArtifactPreflightArgs(args, options);
  return args;
}

function phase6ReplayArgs(options = {}) {
  const args = ['node', 'scripts/run-golden-path-phases.js', '--from', '6', '--to', '6'];
  addFlag(args, '--collect-real-evidence');
  addFlag(args, '--require-real-evidence');
  addFlag(args, '--agent-driven-phases');
  addFlag(args, '--auto-merge');
  addArg(args, '--base-url', options.baseUrl);
  addArg(args, '--operator-url', options.operatorUrl || options.deploymentUrl);
  addArg(args, '--out', options.sourceEvidencePath);
  addArg(args, '--repository', options.repository);
  addArg(args, '--branch', options.branchName);
  addArg(args, '--implementation-commit-sha', options.implementationCommitSha);
  addPrTargetArgs(args, options);
  addArg(args, '--release-env', options.releaseEnv);
  addArg(args, '--deployment-url', options.deploymentUrl);
  addArg(args, '--rollback-target', options.rollbackTarget);
  addFlag(args, '--rollback-verified');
  addArg(args, '--rollback-evidence', options.rollbackEvidence);
  addArg(args, '--candidate-proof', options.candidateProofPath);
  addArg(args, '--production-safety-evidence', options.productionSafetyEvidence);
  addArg(args, '--health-check-path', options.healthCheckPath);
  addFlag(args, '--require-health-commit', options.requireHealthCommit);
  addReleaseArtifactPreflightArgs(args, options);
  return args;
}

function buildPreMergeCommands(options = {}) {
  const commands = [];
  if (!hasPullRequestTarget(options)) {
    commands.push(command('discover-pr-target', 'Discover the real GitHub PR target for the branch and commit.', discoverPrTargetArgs(options), ['GITHUB_TOKEN']));
  }
  commands.push(command('rollback-evidence', 'Write verified rollback evidence.', rollbackEvidenceArgs(options)));
  if (!options.useExistingReleaseArtifacts) {
    commands.push(command('release-artifacts', 'Run release evidence commands and hosted health proof.', buildReleaseArtifactArgs(options)));
  }
  commands.push(command('production-safety', 'Write production-safety evidence from release artifact validation.', productionSafetyArgs(options)));
  commands.push(command('candidate-proof', 'Collect GitHub evidence and write the low-risk candidate proof.', candidateProofArgs(options), ['GITHUB_TOKEN']));
  commands.push(command('hosted-preflight', 'Verify all hosted phase 6 inputs before replay.', hostedPreflightArgs(options), ['GITHUB_TOKEN']));
  commands.push(command('phase6-replay', 'Run hosted phase 6 with live auto-merge enabled.', phase6ReplayArgs(options), ['GITHUB_TOKEN']));
  return commands;
}

function rollbackEvidenceArgs(options = {}) {
  const args = ['npm', 'run', 'autonomy:build-rollback-evidence', '--'];
  addArg(args, '--release-env', options.releaseEnv);
  addArg(args, '--commit-sha', options.implementationCommitSha);
  addArg(args, '--rollback-target', options.rollbackTarget);
  addArg(args, '--verification-status', 'verified');
  addArg(args, '--out', options.rollbackEvidence);
  return args;
}

function productionSafetyArgs(options = {}) {
  const args = ['npm', 'run', 'autonomy:build-production-safety', '--'];
  addArg(args, '--release-env', options.releaseEnv);
  addArg(args, '--deployment-url', options.deploymentUrl);
  addArg(args, '--commit-sha', options.implementationCommitSha);
  addArg(args, '--validation-status', 'passed');
  addArg(args, '--risk-level', 'low');
  addFlag(args, '--production-safe');
  addArg(args, '--release-artifact-dir', options.releaseArtifactDir);
  addArg(args, '--out', options.productionSafetyEvidence);
  return args;
}

function buildPostMergeCommands(options = {}) {
  const mergeCommit = '$MERGE_COMMIT_SHA';
  const verifyArgs = ['npm', 'run', 'autonomy:verify-real-delivery', '--'];
  addArg(verifyArgs, '--evidence', options.sourceEvidencePath);
  addArg(verifyArgs, '--candidate-proof', options.candidateProofPath);
  addArg(verifyArgs, '--branch', options.branchName);
  addArg(verifyArgs, '--implementation-commit-sha', options.implementationCommitSha);
  addArg(verifyArgs, '--merge-commit-sha', mergeCommit);
  addPrTargetArgs(verifyArgs, options);
  addArg(verifyArgs, '--release-env', options.releaseEnv);
  addArg(verifyArgs, '--deployment-url', options.deploymentUrl);
  addArg(verifyArgs, '--report', options.finalVerificationReportPath);
  return [
    command('final-release-artifacts', 'Regenerate release artifacts keyed to the GitHub merge commit.', buildReleaseArtifactArgs(options, mergeCommit), ['MERGE_COMMIT_SHA']),
    command('final-verification', 'Verify final autonomous delivery evidence against candidate proof continuity.', verifyArgs, ['MERGE_COMMIT_SHA']),
  ];
}

module.exports = {
  buildPostMergeCommands,
  buildPreMergeCommands,
  commandLine,
  discoverPrTargetArgs,
};
