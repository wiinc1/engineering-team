const MERGE_READINESS_ENFORCEMENT_FLAG = 'ff_merge_readiness_enforcement';
const DEFAULT_ENFORCEMENT_TARGET = 'autonomous';
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);

function readAny(input, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) return input[key];
  }
  return undefined;
}

function toArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [value];
}

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function cloneObject(value, fallback = {}) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function isMergeReadinessEnforcementEnabled(options = {}) {
  if (typeof options.mergeReadinessEnforcementEnabled === 'boolean') {
    return options.mergeReadinessEnforcementEnabled;
  }
  const configured = options.ffMergeReadinessEnforcement
    ?? options.ff_merge_readiness_enforcement
    ?? process.env.FF_MERGE_READINESS_ENFORCEMENT;
  return configured == null || configured === ''
    ? true
    : !DISABLED_VALUES.has(String(configured).trim().toLowerCase());
}

function mergeReadinessEnforcementTarget(options = {}) {
  return normalized(
    options.mergeReadinessEnforcementTarget
      ?? options.merge_readiness_enforcement_target
      ?? process.env.MERGE_READINESS_ENFORCEMENT_TARGET
      ?? DEFAULT_ENFORCEMENT_TARGET
  );
}

function truthy(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'on', 'enabled', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function labelNames(input = {}) {
  return toArray(readAny(input, 'labels', 'labelNames', 'label_names')).map(label => {
    if (label && typeof label === 'object') return readAny(label, 'name', 'label') || '';
    return label;
  }).map(normalized);
}

function isAutonomousWorkflowPullRequest(input = {}) {
  const metadata = readAny(input, 'metadata') || {};
  const explicit = [
    readAny(input, 'autonomousWorkflowPr', 'autonomousWorkflowPR', 'autonomous_workflow_pr'),
    readAny(input, 'autonomousWorkflow', 'autonomous_workflow'),
    readAny(metadata, 'autonomousWorkflowPr', 'autonomousWorkflowPR', 'autonomous_workflow_pr'),
    readAny(metadata, 'autonomousWorkflow', 'autonomous_workflow'),
  ];
  if (explicit.some(truthy)) return true;
  const workflow = normalized(
    readAny(input, 'workflow', 'workflowType', 'workflow_type')
      ?? readAny(metadata, 'workflow', 'workflowType', 'workflow_type')
  );
  return workflow.includes('autonomous') || labelNames(input).some(label => label.includes('autonomous'));
}

function shouldEnforceMergeReadiness(input = {}, options = {}) {
  if (!isMergeReadinessEnforcementEnabled(options)) return false;
  if (truthy(readAny(input, 'enforceMergeReadiness', 'enforce_merge_readiness'))) return true;
  const target = mergeReadinessEnforcementTarget(options);
  if (target === 'all' || target === 'all_prs') return true;
  return isAutonomousWorkflowPullRequest(input);
}

function applyMergeReadinessEnforcementInput(input = {}, options = {}) {
  if (!shouldEnforceMergeReadiness(input, options)) return input;
  const metadata = cloneObject(readAny(input, 'metadata'), {});
  metadata.merge_readiness_enforcement = {
    flag: MERGE_READINESS_ENFORCEMENT_FLAG,
    enabled: true,
    target: mergeReadinessEnforcementTarget(options),
    scope: isAutonomousWorkflowPullRequest(input) ? 'autonomous_workflow_pr' : 'all_prs',
  };
  return {
    ...input,
    verifyBranchProtection: readAny(input, 'verifyBranchProtection', 'verify_branch_protection') ?? true,
    metadata,
  };
}

module.exports = {
  MERGE_READINESS_ENFORCEMENT_FLAG,
  applyMergeReadinessEnforcementInput,
  isAutonomousWorkflowPullRequest,
  isMergeReadinessEnforcementEnabled,
  mergeReadinessEnforcementTarget,
  shouldEnforceMergeReadiness,
};
