/**
 * PM/Architect human review gate (PRD 2026-07-08).
 *
 * Specialist agents may propose PM/Architect work. When PM and Architect
 * agents disagree, Operator Approval and policy auto-approval stay blocked
 * until a human PM and a human Architect each record an accepting review.
 */

const PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION = 'pm-architect-human-review-gate.v1';
const HUMAN_ACTOR_TYPES = new Set(['human', 'user', 'operator', 'person']);
const AGENT_ACTOR_TYPES = new Set(['agent', 'ai', 'ai_agent', 'specialist', 'bot']);
const CONFLICT_STATUSES = new Set([
  'changes_requested',
  'rejected',
  'blocked',
  'disputed',
  'disagreed',
  'needs_work',
]);
const APPROVED_STATUSES = new Set([
  'approved',
  'accepted',
  'complete',
  'completed',
  'signed_off',
]);

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function compactText(value) {
  return String(value || '').trim();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function reviewerEntry(contract, role) {
  const reviewers = asObject(contract.reviewers);
  const routing = asObject(asObject(contract.reviewer_routing).reviewers);
  return { ...asObject(routing[role]), ...asObject(reviewers[role]) };
}

function entryStatus(entry) {
  return normalizeKey(entry.status || entry.approvalStatus || entry.approval_status || '');
}

function entryActorType(entry) {
  return normalizeKey(
    entry.actorType
      || entry.actor_type
      || entry.reviewedByType
      || entry.reviewed_by_type
      || entry.attribution?.actorType
      || entry.attribution?.actor_type
      || ''
  );
}

function entryActorId(entry) {
  return compactText(
    entry.actorId
      || entry.actor_id
      || entry.approvedBy
      || entry.approved_by
      || entry.reviewedBy
      || entry.reviewed_by
      || ''
  );
}

function looksLikeAgentActor(entry) {
  const type = entryActorType(entry);
  if (HUMAN_ACTOR_TYPES.has(type)) return false;
  if (AGENT_ACTOR_TYPES.has(type)) return true;
  const id = entryActorId(entry).toLowerCase();
  if (!id) return false;
  return (
    id.includes('agent')
    || id.includes('openclaw')
    || id.includes('specialist')
    || id.startsWith('ai-')
    || id.startsWith('bot-')
    || /-agent$/.test(id)
    || id === 'pm-agent'
    || id === 'architect-agent'
  );
}

function isHumanReviewRecord(record) {
  const entry = asObject(record);
  if (!APPROVED_STATUSES.has(entryStatus(entry)) && entry.approved !== true) {
    return false;
  }
  const type = entryActorType(entry);
  if (AGENT_ACTOR_TYPES.has(type)) return false;
  if (HUMAN_ACTOR_TYPES.has(type)) return true;
  // Explicit human review channel without agent markers counts as human when approved.
  if (entry.human === true || entry.isHuman === true || entry.is_human === true) return true;
  if (looksLikeAgentActor(entry)) return false;
  return Boolean(entryActorId(entry));
}

function humanReviews(contract) {
  return asObject(
    contract.human_reviews
      || contract.humanReviews
      || contract.human_review
      || contract.humanReview
  );
}

function hasHumanRoleReview(contract, role) {
  const reviews = humanReviews(contract);
  if (isHumanReviewRecord(reviews[role])) return true;

  // Human review may also be recorded on the reviewer map with actorType human/user.
  const entry = reviewerEntry(contract, role);
  if (!APPROVED_STATUSES.has(entryStatus(entry)) && entry.approved !== true) return false;
  const type = entryActorType(entry);
  if (HUMAN_ACTOR_TYPES.has(type)) return true;
  if (entry.human === true || entry.isHuman === true || entry.is_human === true) return true;
  return false;
}

function collectExplicitDisagreements(contract) {
  const out = [];
  const root = contract.agent_disagreement || contract.agentDisagreement || null;
  if (root) {
    const obj = asObject(root);
    if (obj.active !== false && obj.resolved !== true) {
      out.push({
        source: 'agent_disagreement',
        summary: compactText(obj.summary || obj.rationale || obj.reason)
          || 'PM and Architect agents disagree on the Execution Contract.',
        roles: Array.isArray(obj.roles) ? obj.roles : ['pm', 'architect'],
      });
    }
  }

  const list = contract.role_disagreements || contract.roleDisagreements || [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const obj = asObject(item);
      if (obj.resolved === true || obj.active === false) continue;
      const roles = (Array.isArray(obj.roles) ? obj.roles : [obj.roleA, obj.roleB, obj.leftRole, obj.rightRole])
        .map(normalizeKey)
        .filter(Boolean);
      const involvesPmArch = roles.includes('pm') && (roles.includes('architect') || roles.includes('architecture'));
      if (roles.length === 0 || involvesPmArch || roles.includes('pm') || roles.includes('architect')) {
        if (roles.includes('pm') || roles.includes('architect') || roles.length === 0) {
          out.push({
            source: 'role_disagreements',
            summary: compactText(obj.summary || obj.rationale || obj.reason) || 'Recorded role disagreement.',
            roles: roles.length ? roles : ['pm', 'architect'],
          });
        }
      }
    }
  }

  return out;
}

function statusesConflict(left, right) {
  if (!left || !right) return false;
  const a = entryStatus(left);
  const b = entryStatus(right);
  if (!a || !b) return false;
  if (a === b) return false;
  const leftConflict = CONFLICT_STATUSES.has(a) || left.blocking === true;
  const rightConflict = CONFLICT_STATUSES.has(b) || right.blocking === true;
  const leftApproved = APPROVED_STATUSES.has(a) || left.approved === true;
  const rightApproved = APPROVED_STATUSES.has(b) || right.approved === true;
  return (leftConflict && rightApproved) || (rightConflict && leftApproved) || (leftConflict && rightConflict && a !== b);
}

function detectReviewerMapDisagreement(contract) {
  const pm = reviewerEntry(contract, 'pm');
  const architect = reviewerEntry(contract, 'architect');
  if (!statusesConflict(pm, architect)) return null;

  // Only treat as agent disagreement when at least one side looks agent-authored
  // or neither side is an explicit human review.
  const pmAgent = looksLikeAgentActor(pm) || entryActorType(pm) === '';
  const archAgent = looksLikeAgentActor(architect) || entryActorType(architect) === '';
  if (!pmAgent && !archAgent && HUMAN_ACTOR_TYPES.has(entryActorType(pm)) && HUMAN_ACTOR_TYPES.has(entryActorType(architect))) {
    // Humans already disagreeing is still a block until resolved, but human reviews
    // can clear via human_reviews override once positions converge.
  }

  return {
    source: 'reviewer_status_conflict',
    summary: `PM status "${entryStatus(pm) || 'unknown'}" conflicts with Architect status "${entryStatus(architect) || 'unknown'}".`,
    roles: ['pm', 'architect'],
    pm: { status: entryStatus(pm), actorId: entryActorId(pm), actorType: entryActorType(pm) || null },
    architect: {
      status: entryStatus(architect),
      actorId: entryActorId(architect),
      actorType: entryActorType(architect) || null,
    },
  };
}

function detectCrossRoleBlockingFeedback(contract) {
  const feedback = asObject(contract.review_feedback || contract.reviewFeedback);
  const questions = Array.isArray(feedback.questions) ? feedback.questions : [];
  const openBlocking = questions.filter((q) => {
    const item = asObject(q);
    const state = normalizeKey(item.state || 'open');
    return item.blocking !== false && state !== 'resolved' && state !== 'closed';
  });

  const roles = new Set();
  for (const q of openBlocking) {
    const role = normalizeKey(q.role || q.reviewerRole || q.reviewer_role || q.sourceRole || q.source_role);
    if (role === 'pm' || role === 'architect' || role === 'architecture') {
      roles.add(role === 'architecture' ? 'architect' : role);
    }
  }

  if (roles.has('pm') && roles.has('architect')) {
    return {
      source: 'cross_role_blocking_feedback',
      summary: 'Open blocking feedback exists from both PM and Architect.',
      roles: ['pm', 'architect'],
      questionIds: openBlocking.map((q) => q.id).filter(Boolean),
    };
  }
  return null;
}

function detectPmArchitectAgentDisagreement(contract = {}) {
  const disagreements = [
    ...collectExplicitDisagreements(contract),
  ];
  const reviewerConflict = detectReviewerMapDisagreement(contract);
  if (reviewerConflict) disagreements.push(reviewerConflict);
  const feedbackConflict = detectCrossRoleBlockingFeedback(contract);
  if (feedbackConflict) disagreements.push(feedbackConflict);

  return {
    active: disagreements.length > 0,
    disagreements,
  };
}

function evaluatePmArchitectHumanReviewGate(contract = {}) {
  const detection = detectPmArchitectAgentDisagreement(contract);
  const policy = {
    policy_name: 'pm-architect-human-review-on-agent-disagreement',
    policy_version: PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
  };

  if (!detection.active) {
    return {
      ...policy,
      required: false,
      satisfied: true,
      canApprove: true,
      canAutoApprove: true,
      disagreementActive: false,
      disagreements: [],
      missingHumanReviews: [],
      humanReviews: {
        pm: hasHumanRoleReview(contract, 'pm'),
        architect: hasHumanRoleReview(contract, 'architect'),
      },
      next_required_action: null,
      rationale: 'No PM/Architect agent disagreement detected; human disagreement gate is not required.',
    };
  }

  const pmOk = hasHumanRoleReview(contract, 'pm');
  const architectOk = hasHumanRoleReview(contract, 'architect');
  const missingHumanReviews = [];
  if (!pmOk) {
    missingHumanReviews.push({
      role: 'pm',
      code: 'missing_human_pm_review',
      message: 'Human Product Manager review is required after PM/Architect agent disagreement.',
    });
  }
  if (!architectOk) {
    missingHumanReviews.push({
      role: 'architect',
      code: 'missing_human_architect_review',
      message: 'Human Architect review is required after PM/Architect agent disagreement.',
    });
  }

  const satisfied = missingHumanReviews.length === 0;
  return {
    ...policy,
    required: true,
    satisfied,
    canApprove: satisfied,
    canAutoApprove: satisfied,
    disagreementActive: true,
    disagreements: detection.disagreements,
    missingHumanReviews,
    humanReviews: { pm: pmOk, architect: architectOk },
    next_required_action: satisfied
      ? null
      : 'Human Product Manager and human Architect must review and accept the contract after agent disagreement.',
    rationale: satisfied
      ? 'PM/Architect agent disagreement is resolved by recorded human PM and Architect reviews.'
      : 'PM/Architect agent disagreement blocks approval until human PM and human Architect reviews are recorded.',
  };
}

function mergeApprovalReadinessWithHumanReviewGate(baseReadiness = {}, contract = {}) {
  const gate = evaluatePmArchitectHumanReviewGate(contract);
  const missingRequiredApprovals = [
    ...(Array.isArray(baseReadiness.missingRequiredApprovals) ? baseReadiness.missingRequiredApprovals : []),
    ...gate.missingHumanReviews.map((item) => ({
      role: item.role,
      code: item.code,
      reason: item.message,
      human_review_required: true,
    })),
  ];

  const canApprove = baseReadiness.canApprove !== false && gate.canApprove;
  const status = canApprove
    ? (baseReadiness.status || 'ready')
    : (gate.required && !gate.satisfied ? 'blocked_human_review' : (baseReadiness.status || 'blocked'));

  return {
    ...baseReadiness,
    status,
    canApprove,
    missingRequiredApprovals,
    pmArchitectHumanReviewGate: gate,
    next_required_action: !gate.satisfied
      ? gate.next_required_action
      : (baseReadiness.next_required_action || null),
  };
}

function mergeAutoApprovalWithHumanReviewGate(baseAutoApproval = {}, contract = {}) {
  const gate = evaluatePmArchitectHumanReviewGate(contract);
  if (gate.canAutoApprove) {
    return {
      ...baseAutoApproval,
      pmArchitectHumanReviewGate: gate,
    };
  }

  return {
    ...baseAutoApproval,
    eligible: false,
    approved: false,
    approved_by_policy: false,
    blocked: true,
    blocked_reasons: [
      ...(Array.isArray(baseAutoApproval.blocked_reasons) ? baseAutoApproval.blocked_reasons : []),
      ...(Array.isArray(baseAutoApproval.reasons) ? [] : []),
      'pm_architect_agent_disagreement_requires_human_review',
      ...gate.missingHumanReviews.map((item) => item.code),
    ].filter(Boolean),
    pmArchitectHumanReviewGate: gate,
    message: gate.rationale,
  };
}

function applyPmArchitectHumanReviewGates(exportsObject) {
  if (!exportsObject || typeof exportsObject !== 'object') return exportsObject;

  const originalApproval = exportsObject.evaluateExecutionContractApprovalReadiness;
  if (typeof originalApproval === 'function' && !originalApproval.__pmArchitectHumanReviewWrapped) {
    const wrapped = function evaluateExecutionContractApprovalReadiness(contract, ...rest) {
      const base = originalApproval(contract, ...rest);
      return mergeApprovalReadinessWithHumanReviewGate(base, contract || {});
    };
    wrapped.__pmArchitectHumanReviewWrapped = true;
    exportsObject.evaluateExecutionContractApprovalReadiness = wrapped;
  }

  const originalAuto = exportsObject.evaluateExecutionContractAutoApprovalPolicy;
  if (typeof originalAuto === 'function' && !originalAuto.__pmArchitectHumanReviewWrapped) {
    const wrappedAuto = function evaluateExecutionContractAutoApprovalPolicy(input, ...rest) {
      const contract = input?.contract || input || {};
      const base = originalAuto(input, ...rest);
      return mergeAutoApprovalWithHumanReviewGate(base, contract);
    };
    wrappedAuto.__pmArchitectHumanReviewWrapped = true;
    exportsObject.evaluateExecutionContractAutoApprovalPolicy = wrappedAuto;
  }

  return exportsObject;
}

module.exports = {
  PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
  detectPmArchitectAgentDisagreement,
  evaluatePmArchitectHumanReviewGate,
  mergeApprovalReadinessWithHumanReviewGate,
  mergeAutoApprovalWithHumanReviewGate,
  applyPmArchitectHumanReviewGates,
  hasHumanRoleReview,
};
