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

function findingStatus(finding = {}) {
  return normalizedRole(readAny(finding, 'status', 'state', 'resolution'));
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

function deferralProposed(finding = {}) {
  return readAny(finding, 'deferred', 'deferralRequested', 'deferral_requested') === true
    || ['deferred', 'approved_deferred', 'waived', 'risk_accepted'].includes(findingStatus(finding))
    || readAny(finding, 'deferralAllowed', 'deferral_allowed', 'deferralPolicy', 'deferral_policy') != null;
}

function compactFinding(finding = {}) {
  return {
    id: findingId(finding),
    severity: findingSeverity(finding),
    owner: findingOwner(finding) || null,
    summary: text(readAny(finding, 'summary', 'title', 'reason', 'reasonCode', 'reason_code')) || null,
  };
}

function evaluateMergeReadinessDeferralPolicy(review = {}) {
  const findings = toArray(readAny(review, 'findings')).filter(finding => finding && typeof finding === 'object');
  const blockingFindings = findings.filter(isBlockingMergeReadinessFinding);
  const deferralResults = blockingFindings
    .filter(deferralProposed)
    .map(finding => evaluateBlockingFindingDeferral(finding, review));
  const invalidDeferralIds = new Set(deferralResults.filter(result => !result.valid).map(result => result.findingId));
  const unresolvedBlockingFindings = blockingFindings.filter(finding => deferralProposed(finding)
    && invalidDeferralIds.has(findingId(finding)));
  return {
    policyVersion: MERGE_READINESS_GATE_VERSION,
    active: deferralResults.length > 0,
    status: unresolvedBlockingFindings.length ? 'blocked' : 'satisfied',
    blockingFindings: blockingFindings.map(compactFinding),
    unresolvedBlockingFindings: unresolvedBlockingFindings.map(compactFinding),
    deferrals: deferralResults,
    invalidDeferrals: deferralResults.filter(result => !result.valid),
  };
}

function mergeObject(base, additions) {
  return base && typeof base === 'object' && !Array.isArray(base) ? { ...base, ...additions } : additions;
}

function applyMergeReadinessFindingPolicy(review = {}) {
  const policy = evaluateMergeReadinessDeferralPolicy(review);
  if (!policy.active) return review;
  review.classification = mergeObject(review.classification, {
    finding_deferral_policy: {
      version: policy.policyVersion,
      status: policy.status,
      unresolved_blocking_finding_ids: policy.unresolvedBlockingFindings.map(finding => finding.id).filter(Boolean),
      invalid_deferrals: policy.invalidDeferrals.map(result => ({
        finding_id: result.findingId,
        missing_requirements: result.missingRequirements,
      })),
    },
  });
  review.metadata = mergeObject(review.metadata, {
    merge_readiness_finding_policy: {
      policy_version: policy.policyVersion,
      status: policy.status,
      blocking_finding_count: policy.blockingFindings.length,
      invalid_deferral_count: policy.invalidDeferrals.length,
    },
  });
  if (policy.status === 'blocked' && readAny(review, 'review_status', 'reviewStatus') !== 'error') {
    review.review_status = 'blocked';
  }
  return review;
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
  applyMergeReadinessFindingPolicy,
  classifyMergeReadinessFinding,
  evaluateBlockingFindingDeferral,
  evaluateMergeReadinessDeferralPolicy,
  evaluateMergeReadinessFindingPolicy,
  evaluateMergeReadinessGate,
  isBlockingMergeReadinessFinding,
};
