const CODE_CHANGE_KINDS = new Set(['feature', 'bugfix', 'refactor', 'security-fix', 'migration']);
const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);
const TEST_CHECK_PATTERN = /\b(test|unit|integration|e2e|browser|playwright|vitest|coverage)\b/i;
const CODE_FILE_PATTERN = /\.(?:js|jsx|ts|tsx|mjs|cjs|py|sql)$/i;
const CODE_ROOT_PATTERN = /^(?:api|lib|src|scripts|db\/migrations)\//;
const NON_IMPLEMENTATION_ROOT_PATTERN = /^(?:docs|observability|tests?|__tests__|test-results|coverage)\//;

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

function normalizeChangedFiles(value) {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (!entry || typeof entry !== 'object') return [];
    return [entry.filename, entry.file, entry.path, entry.name].filter(Boolean).slice(0, 1);
  }).map((entry) => String(entry).trim()).filter(Boolean);
}

function collectChangedFiles(...values) {
  return [...new Set(values.flatMap(normalizeChangedFiles))];
}

function isImplementationCodeFile(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || NON_IMPLEMENTATION_ROOT_PATTERN.test(normalized)) return false;
  return CODE_ROOT_PATTERN.test(normalized) && CODE_FILE_PATTERN.test(normalized);
}

function checkLabel(check = {}) {
  return [
    check.name, check.checkName, check.check_name, check.id, check.title,
    check.script, check.command, check.workflow, check.workflowFile,
  ].filter(Boolean).join(' ');
}

function hasSuccessfulTestEvidence(checks = []) {
  return normalizeChecks(checks).some((check) => checkPassed(check) && TEST_CHECK_PATTERN.test(checkLabel(check)));
}

function collectRealChangeScopeEvidence(evidence = {}, options = {}) {
  const env = options.env || {};
  const changedFiles = collectChangedFiles(
    options.changedFiles, options.changed_files, evidence.github?.changedFiles,
    evidence.github?.changed_files, evidence.pr?.changedFiles, evidence.pr?.files,
    evidence.change?.changedFiles, evidence.change?.files,
  );
  return {
    changeKind: String(evidenceValue(
      options.changeKind, env.CHANGE_KIND, evidence.change?.kind, evidence.changeKind,
      evidence.engineeringTeam?.changeKind, evidence.phase1?.contract?.changeKind,
      evidence.phase1?.changeKind, process.env.CHANGE_KIND,
    ) || '').trim().toLowerCase(),
    templateTier: String(evidenceValue(
      options.templateTier, options.factoryTemplateTier, evidence.engineeringTeam?.templateTier,
      evidence.phase1?.contract?.factoryTemplateTier, evidence.phase1?.contract?.templateTier,
      evidence.phase1?.contract?.template_tier,
    ) || '').trim() || null,
    changedFiles,
    implementationFiles: changedFiles.filter(isImplementationCodeFile),
  };
}

function realChangeScopeFailures(scope, proof, releaseEvidence) {
  const failures = [];
  if (!scope.changeKind) failures.push('explicit code-bearing change kind is required');
  else if (!CODE_CHANGE_KINDS.has(scope.changeKind)) failures.push(`code-bearing change kind is required; got ${scope.changeKind}`);
  if (!scope.templateTier) failures.push('explicit factory template tier is required');
  if (scope.implementationFiles.length === 0) failures.push('at least one implementation code file change is required');
  if (!hasSuccessfulTestEvidence(proof.checks)) failures.push('at least one successful test check is required');
  if (!HOSTED_RELEASE_ENVIRONMENTS.has(releaseEvidence.environment)) {
    failures.push(`hosted staging/prod release evidence is required; got ${releaseEvidence.environment || 'none'}`);
  }
  return failures;
}

module.exports = {
  collectRealChangeScopeEvidence,
  hasSuccessfulTestEvidence,
  isImplementationCodeFile,
  realChangeScopeFailures,
};
