'use strict';

let AGENT_ACTOR_TYPES;
let APPROVED_STATUSES;
let HUMAN_ACTOR_TYPES;
let PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION;
let asObject;
let compactText;
let evaluatePmArchitectHumanReviewGate;
let humanReviews;
let looksLikeAgentActor;
let normalizeKey;

function createHumanReviewGateActions(dependencies) {
  ({
    AGENT_ACTOR_TYPES, APPROVED_STATUSES, HUMAN_ACTOR_TYPES, PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
    asObject, compactText, evaluatePmArchitectHumanReviewGate, humanReviews, looksLikeAgentActor, normalizeKey,
  } = dependencies);
  return {
    applyHumanPmArchitectReviewsToContract,
    buildHumanReviewRecord,
    mergeApprovalReadinessWithHumanReviewGate,
    mergeAutoApprovalWithHumanReviewGate,
    mergeDispatchReadinessWithHumanReviewGate,
    normalizeHumanReviewAcceptanceInput,
  };
}

  function humanReviewBlockingReason(gate) {
    return gate.disagreementActive
      ? 'pm_architect_agent_disagreement_requires_human_review'
      : 'pm_architect_agent_proposals_require_human_review';
  }

  function missingReviewReasons(gate) {
    return gate.missingHumanReviews.map((item) => ({
      source: 'pm_architect_human_review_gate',
      code: item.code,
      detail: item.message,
      role: item.role,
    }));
  }

  function mergeApprovalReadinessWithHumanReviewGate(base = {}, contract = {}) {
    const gate = evaluatePmArchitectHumanReviewGate(contract);
    const missingRequiredApprovals = [
      ...(Array.isArray(base.missingRequiredApprovals) ? base.missingRequiredApprovals : []),
      ...gate.missingHumanReviews.map((item) => ({
        role: item.role, code: item.code, reason: item.message, human_review_required: true,
      })),
    ];
    const canApprove = base.canApprove !== false && gate.canApprove;
    return {
      ...base,
      status: canApprove ? (base.status || 'ready')
        : (gate.required && !gate.satisfied ? 'blocked_human_review' : (base.status || 'blocked')),
      canApprove,
      missingRequiredApprovals,
      pmArchitectHumanReviewGate: gate,
      next_required_action: gate.satisfied ? (base.next_required_action || null) : gate.next_required_action,
    };
  }

  function mergeAutoApprovalWithHumanReviewGate(base = {}, contract = {}) {
    const gate = evaluatePmArchitectHumanReviewGate(contract);
    if (gate.canAutoApprove) return { ...base, pmArchitectHumanReviewGate: gate };
    const code = humanReviewBlockingReason(gate);
    const blockedReasons = [
      ...(Array.isArray(base.blocked_reasons) ? base.blocked_reasons : []),
      ...(Array.isArray(base.blockingReasons) ? base.blockingReasons : []),
      code,
      ...gate.missingHumanReviews.map((item) => item.code),
    ].filter(Boolean);
    return {
      ...base,
      status: 'blocked', canAutoApprove: false, operatorApprovalRequired: true,
      eligible: false, approved: false, approved_by_policy: false, blocked: true,
      blocked_reasons: blockedReasons,
      blockingReasons: [
        ...(Array.isArray(base.blockingReasons) ? base.blockingReasons : []),
        { source: 'pm_architect_human_review_gate', code, detail: gate.rationale },
        ...missingReviewReasons(gate),
      ],
      pmArchitectHumanReviewGate: gate,
      message: gate.rationale,
      rationale: gate.rationale,
    };
  }

  function mergeDispatchReadinessWithHumanReviewGate(base = {}, contract = {}) {
    const gate = evaluatePmArchitectHumanReviewGate(contract || {});
    if (!gate.required || gate.satisfied) return { ...base, pmArchitectHumanReviewGate: gate };
    const detail = gate.rationale
      || 'Human PM and Architect acceptance is required before implementation dispatch (Q6 / #275).';
    const reason = { source: 'pm_architect_human_review_gate', code: 'pm_architect_human_review_required', detail };
    const dispatchPolicy = {
      ...(base.dispatchPolicy || {}),
      canDispatch: false,
      status: 'blocked',
      blockingReasons: [
        ...((base.dispatchPolicy && base.dispatchPolicy.blockingReasons) || []),
        { ...reason, detail: gate.next_required_action || detail },
      ],
    };
    return {
      ...base,
      canDispatch: false,
      blockedReasons: [
        ...(Array.isArray(base.blockedReasons) ? base.blockedReasons : []), reason, ...missingReviewReasons(gate),
      ],
      dispatchPolicy,
      pmArchitectHumanReviewGate: gate,
      reason: gate.rationale || base.reason,
    };
  }

  function normalizeHumanReviewAcceptanceInput(input = {}, defaults = {}) {
    const status = normalizeKey(input.status || (input.approved === true ? 'approved' : '') || 'approved');
    const actorType = normalizeKey(input.actorType || input.actor_type || defaults.actorType || 'human') || 'human';
    const approved = input.approved === true || APPROVED_STATUSES.has(status);
    return {
      role: normalizeKey(input.role || defaults.role || ''),
      status: approved ? 'approved' : status,
      approved,
      actorId: compactText(input.actorId || input.actor_id || defaults.actorId || ''),
      actorType,
      reason: compactText(input.reason || input.comment || input.summary || defaults.reason || '')
        || 'Human acceptance of agent-authored proposal (Q6).',
      reviewedAt: compactText(input.reviewedAt || input.reviewed_at || input.at || '') || new Date().toISOString(),
    };
  }

  function assertHumanActorForAcceptance(entry) {
    if (!entry.actorId) {
      const error = new Error('Human PM/Architect acceptance requires an actorId.');
      error.code = 'missing_human_review_actor';
      error.statusCode = 400;
      throw error;
    }
    if (AGENT_ACTOR_TYPES.has(entry.actorType) || looksLikeAgentActor(entry)) {
      const error = new Error(
        'Agent actors cannot record human PM/Architect acceptance (Q6 / GitLab #275). '
        + 'Use a human/user/operator actorType.',
      );
      error.code = 'agent_cannot_record_human_review';
      error.statusCode = 403;
      throw error;
    }
    if (!HUMAN_ACTOR_TYPES.has(entry.actorType) && entry.human !== true) entry.actorType = 'human';
    return entry;
  }

  function buildHumanReviewRecord(input = {}, defaults = {}) {
    const normalized = assertHumanActorForAcceptance(normalizeHumanReviewAcceptanceInput(input, defaults));
    return {
      status: normalized.approved ? 'approved' : normalized.status,
      approved: normalized.approved === true,
      actorId: normalized.actorId,
      actorType: normalized.actorType,
      reason: normalized.reason,
      reviewedAt: normalized.reviewedAt,
      human: true,
      policy_version: PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
    };
  }

  function effectiveReviewRoles(reviewsInput, reviewMap, options) {
    if (Array.isArray(reviewsInput.roles) && reviewsInput.roles.length) return reviewsInput.roles.map(normalizeKey);
    if (reviewMap.pm || reviewMap.architect) return ['pm', 'architect'].filter((role) => reviewMap[role]);
    const requestedRole = normalizeKey(reviewsInput.role || options.role || '');
    if (requestedRole === 'pm' || requestedRole === 'architect') return [requestedRole];
    return ['pm', 'architect'];
  }

  function applyHumanPmArchitectReviewsToContract(contract = {}, reviewsInput = {}, options = {}) {
    const next = { ...humanReviews(contract) };
    const recorded = [];
    const reviewMap = asObject(reviewsInput.reviews || {});
    const roles = effectiveReviewRoles(reviewsInput, reviewMap, options);
    for (const role of roles) {
      if (role !== 'pm' && role !== 'architect') continue;
      const raw = reviewMap[role] || reviewsInput;
      const record = buildHumanReviewRecord(raw, {
        role,
        actorId: options.actorId || raw.actorId || raw.actor_id,
        actorType: options.actorType || raw.actorType || raw.actor_type || 'human',
        reason: options.reason || raw.reason,
        at: options.at || new Date().toISOString(),
      });
      next[role] = record;
      recorded.push({ role, ...record });
    }
    const nextContract = { ...contract, human_reviews: next, humanReviews: next };
    return {
      contract: nextContract,
      human_reviews: next,
      recorded,
      gate: evaluatePmArchitectHumanReviewGate(nextContract),
    };
  }

module.exports = { createHumanReviewGateActions };
