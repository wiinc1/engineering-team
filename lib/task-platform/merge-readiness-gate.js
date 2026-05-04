const { evaluateMergeReadinessBranchProtection } = require('./merge-readiness-branch-protection');
const { mapReviewToCheckRun } = require('./merge-readiness-github-check');
const { renderMergeReadinessPrSummary } = require('./merge-readiness-pr-summary');
const { evaluateMergeReadinessSourcePolicy } = require('./merge-readiness-source-policy');

const MERGE_READINESS_GATE_VERSION = 'merge-readiness-gate.v1';
const BLOCKING_SEVERITIES = new Set(['blocker', 'critical', 'error', 'high']);
const HIGH_RISK_SEVERITIES = new Set(['critical', 'high']);

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

function text(value) {
  return String(value || '').trim();
}

function normalizedRole(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function findingId(finding = {}) {
  return text(readAny(finding, 'id', 'findingId', 'finding_id', 'sourceId', 'source_id'));
}

function findingSeverity(finding = {}) {
  return normalizedRole(readAny(finding, 'severity', 'level'));
}

function findingOwner(finding = {}) {
  const owner = readAny(finding, 'owner', 'ownerRole', 'owner_role', 'technicalOwner', 'technical_owner');
  if (owner && typeof owner === 'object') {
    return text(readAny(owner, 'role', 'actorRole', 'actor_role', 'actorId', 'actor_id'));
  }
  return text(owner);
}

function findingRationale(finding = {}) {
  return text(readAny(finding, 'rationale', 'reason', 'reasonCode', 'reason_code'));
}

function isBlockingMergeReadinessFinding(finding = {}) {
  return readAny(finding, 'blocking') === true || BLOCKING_SEVERITIES.has(findingSeverity(finding));
}

function classifyMergeReadinessFinding(finding = {}) {
  const blocking = isBlockingMergeReadinessFinding(finding);
  const owner = findingOwner(finding);
  const rationale = findingRationale(finding);
  const missing = [];
  if (!owner) missing.push('owner');
  if (!blocking && !rationale) missing.push('non_blocking_rationale');
  return {
    id: findingId(finding),
    blocking,
    classification: blocking ? 'blocking' : 'non_blocking',
    owner,
    rationale,
    valid: missing.length === 0,
    missingRequirements: missing,
  };
}

function evaluateMergeReadinessFindingPolicy(review = {}) {
  const findings = toArray(readAny(review, 'findings')).map(classifyMergeReadinessFinding);
  return {
    policyVersion: MERGE_READINESS_GATE_VERSION,
    blockingFindings: findings.filter(finding => finding.blocking),
    nonBlockingFindings: findings.filter(finding => !finding.blocking),
    invalidFindings: findings.filter(finding => !finding.valid),
  };
}

function approvalRole(approval = {}) {
  return normalizedRole(readAny(approval, 'role', 'actorRole', 'actor_role', 'approverRole', 'approver_role'));
}

function approvalType(approval = {}) {
  return normalizedRole(readAny(approval, 'type', 'approvalType', 'approval_type', 'reason'));
}

function approvalMatchesRiskAcceptance(approval = {}) {
  return readAny(approval, 'riskAcceptance', 'risk_acceptance') === true
    || approvalType(approval).includes('risk_accept');
}

function approvalMatchesRole(approval, roles) {
  const role = approvalRole(approval);
  return roles.some(candidate => role === candidate || role.includes(candidate));
}

function followUpLinksForFinding(finding = {}, review = {}) {
  const local = toArray(readAny(finding, 'followUpLinks', 'follow_up_links', 'followUpLink', 'follow_up_link'));
  if (local.length) return local;
  const id = findingId(finding);
  return toArray(readAny(review, 'followUpLinks', 'follow_up_links')).filter(link => {
    const target = text(readAny(link, 'findingId', 'finding_id', 'sourceId', 'source_id'));
    return !target || !id || target === id;
  });
}

function deferralPolicyAllows(finding = {}) {
  const policy = readAny(finding, 'policy', 'deferralPolicy', 'deferral_policy') || {};
  return readAny(finding, 'deferralAllowed', 'deferral_allowed') === true
    || readAny(policy, 'deferralAllowed', 'deferral_allowed', 'allowDeferral', 'allow_deferral') === true;
}

function isHighRiskFinding(finding = {}) {
  const risk = normalizedRole(readAny(finding, 'riskLevel', 'risk_level', 'risk'));
  return HIGH_RISK_SEVERITIES.has(findingSeverity(finding)) || HIGH_RISK_SEVERITIES.has(risk);
}

function technicalOwnerRoles(finding = {}) {
  const owner = normalizedRole(findingOwner(finding));
  return ['technical_owner', 'tech_owner', 'principal_engineer', 'sre', owner].filter(Boolean);
}

function evaluateBlockingFindingDeferral(finding = {}, review = {}) {
  const approvals = toArray(readAny(finding, 'approvals')).concat(toArray(readAny(review, 'approvals')));
  const pm = approvals.some(approval => approvalMatchesRiskAcceptance(approval) && approvalMatchesRole(approval, ['pm', 'product_manager']));
  const technical = approvals.some(approval => approvalMatchesRiskAcceptance(approval) && approvalMatchesRole(approval, technicalOwnerRoles(finding)));
  const highRisk = !isHighRiskFinding(finding) || approvals.some(approval => approvalMatchesRole(approval, ['principal', 'sre']));
  const followUps = followUpLinksForFinding(finding, review);
  const missing = [];
  if (!isBlockingMergeReadinessFinding(finding)) missing.push('blocking_finding');
  if (!deferralPolicyAllows(finding)) missing.push('policy_permission');
  if (!followUps.length) missing.push('follow_up_link');
  if (!pm) missing.push('pm_risk_acceptance');
  if (!technical) missing.push('technical_owner_risk_acceptance');
  if (!highRisk) missing.push('principal_or_sre_high_risk_approval');
  return {
    policyVersion: MERGE_READINESS_GATE_VERSION,
    findingId: findingId(finding),
    valid: missing.length === 0,
    missingRequirements: missing,
    approvals: {
      pmRiskAcceptance: pm,
      technicalOwnerRiskAcceptance: technical,
      principalOrSreHighRiskApproval: highRisk,
    },
    followUpLinks: followUps,
    policyPermission: deferralPolicyAllows(finding),
  };
}

function evaluateMergeReadinessGate(review = {}, context = {}) {
  return {
    policyVersion: MERGE_READINESS_GATE_VERSION,
    reviewStatus: readAny(review, 'reviewStatus', 'review_status') || 'pending',
    checkRun: mapReviewToCheckRun(review, context),
    sourcePolicy: evaluateMergeReadinessSourcePolicy(context.sourcePolicyInput || context),
    branchProtection: evaluateMergeReadinessBranchProtection(context.branchProtectionInput || context),
    findingPolicy: evaluateMergeReadinessFindingPolicy(review),
    prSummary: context.includePrSummary === false ? null : renderMergeReadinessPrSummary(review, context),
  };
}

module.exports = {
  MERGE_READINESS_GATE_VERSION,
  classifyMergeReadinessFinding,
  evaluateBlockingFindingDeferral,
  evaluateMergeReadinessFindingPolicy,
  evaluateMergeReadinessGate,
  isBlockingMergeReadinessFinding,
};
