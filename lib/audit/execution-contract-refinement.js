function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

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

const ROLE_ALIASES = Object.freeze({
  architect: 'architect',
  architecture: 'architect',
  ux: 'ux',
  ux_designer: 'ux',
  designer: 'ux',
  qa: 'qa',
  quality_assurance: 'qa',
  sre: 'sre',
  principal: 'principalEngineer',
  principal_engineer: 'principalEngineer',
  principalengineer: 'principalEngineer',
  pm: 'pm',
  product_manager: 'pm',
});

const REVIEW_ROLE_ORDER = Object.freeze([
  'architect',
  'ux',
  'qa',
  'sre',
  'principalEngineer',
  'pm',
]);

function resolveExecutionContractReviewerRole({ body = {}, actorRoles = [] } = {}) {
  const requestedRole = body.reviewerRole || body.reviewer_role || body.role;
  const canonicalRequested = ROLE_ALIASES[normalizeKey(requestedRole)];
  if (canonicalRequested) return canonicalRequested;

  for (const role of REVIEW_ROLE_ORDER) {
    if (actorRoles.includes(role)) return role;
    if (role === 'principalEngineer' && actorRoles.includes('principal')) return role;
  }

  throw createHttpError(
    400,
    'invalid_execution_contract_reviewer_role',
    'A valid reviewer role is required for Execution Contract section review.',
    { allowed_roles: REVIEW_ROLE_ORDER }
  );
}

function reviewRoleAllowedForActor(actorRoles = [], reviewRole) {
  if (actorRoles.includes('admin') || actorRoles.includes('pm')) return true;
  if (actorRoles.includes(reviewRole)) return true;
  return reviewRole === 'principalEngineer' && actorRoles.includes('principal');
}

function normalizeReviewStatus(body = {}) {
  if (body.approved === true) return 'approved';
  return normalizeKey(body.status || body.approvalStatus || body.approval_status || 'commented');
}

function scopeItems(items = []) {
  return items.map((item) => item?.text || item).filter(Boolean);
}

function getContractSection(contract, sectionId) {
  if (!contract) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists.');
  }

  const section = contract.sections?.[sectionId];
  if (!section) {
    throw createHttpError(404, 'execution_contract_section_not_found', 'Execution Contract section not found.', {
      section_id: sectionId,
    });
  }

  return section;
}

function isApprovedStatus(status) {
  return ['approved', 'accepted', 'complete', 'completed', 'signed_off'].includes(status);
}

function buildFeedbackItem({ body, sectionId, role, approved }) {
  const comment = compactText(body.comment || body.summary || body.rationale || body.feedback);
  const feedbackId = compactText(body.reviewId || body.review_id || `section-${sectionId}-${role}`);
  return comment
    ? {
        id: feedbackId,
        body: comment,
        state: approved ? 'resolved' : 'open',
        blocking: normalizeReviewStatus(body) === 'changes_requested' || body.blocking === true,
        source: 'execution_contract_section_review',
      }
    : null;
}

function resolveSectionText(section = {}) {
  const direct = compactText(section.body ?? section.content ?? section.value);
  if (direct) return direct;
  const payload = section.payload_json || section.payloadJson || section.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return compactText(payload.body ?? payload.content ?? payload.value);
  }
  return '';
}

function buildNextSection({ section, body, actorId, approved }) {
  const sectionPatch = body.sectionPatch || body.section_patch || body.section || {};
  const nextSection = {
    ...section,
    ...sectionPatch,
    contributor: compactText(sectionPatch.contributor || body.contributor || actorId) || section.contributor,
    approver: approved ? actorId : section.approver,
    approvalStatus: approved ? 'approved' : section.approvalStatus || section.approval_status,
    provenanceReferences: [
      ...(section.provenance_references || []),
      compactText(body.provenanceReference || body.provenance_reference),
    ].filter(Boolean),
  };
  const resolvedBody = compactText(nextSection.body ?? nextSection.content ?? nextSection.value)
    || resolveSectionText(nextSection);
  if (resolvedBody) nextSection.body = resolvedBody;
  return nextSection;
}

function buildNextReviewers({ contract, role, status, actorId, approved }) {
  const reviewerStatus = approved ? 'approved' : status;
  return {
    ...(contract.reviewers || {}),
    [role]: {
      ...(contract.reviewers?.[role] || {}),
      status: reviewerStatus,
      actorId,
      approvedBy: approved ? actorId : null,
      approvalStatus: reviewerStatus,
    },
  };
}

function buildNextReviewFeedback({ contract, feedbackItem }) {
  const existingReviewFeedback = contract.review_feedback || {};
  const questions = [...(existingReviewFeedback.questions || [])];
  const comments = [...(existingReviewFeedback.comments || [])];
  if (feedbackItem?.blocking) questions.push(feedbackItem);
  else if (feedbackItem) comments.push(feedbackItem);
  return { questions, comments };
}

function buildDraftBody({ contract, sectionId, nextSection, nextReviewers, reviewFeedback, body, role }) {
  return {
    templateTier: contract.template_tier,
    sections: {
      ...(contract.sections || {}),
      [sectionId]: nextSection,
    },
    riskFlags: contract.risk_flags || [],
    reviewers: nextReviewers,
    reviewFeedback,
    dispatchSignals: contract.dispatch_signals || {},
    autoApprovalSignals: contract.auto_approval_signals || {},
    contextProvenance: contract.context_provenance || {},
    committedRequirements: scopeItems(contract.committed_scope?.committed_requirements || []),
    outOfScope: scopeItems(contract.committed_scope?.out_of_scope || []),
    deferredConsiderations: scopeItems(contract.committed_scope?.deferred_considerations || []),
    followUpTasks: scopeItems(contract.committed_scope?.follow_up_tasks || []),
    materialChangeReason:
      compactText(body.materialChangeReason || body.material_change_reason) ||
      `Section ${sectionId} review recorded by ${role}.`,
  };
}

function buildExecutionContractSectionReviewDraftBody({
  contract,
  sectionId,
  body = {},
  actorId,
  actorRoles = [],
} = {}) {
  const section = getContractSection(contract, sectionId);
  const role = resolveExecutionContractReviewerRole({ body, actorRoles });
  const status = normalizeReviewStatus(body);
  const approved = isApprovedStatus(status);
  const comment = compactText(body.comment || body.summary || body.rationale || body.feedback);
  const feedbackItem = buildFeedbackItem({ body, sectionId, role, approved });
  const nextSection = buildNextSection({ section, body, actorId, approved });
  const nextReviewers = buildNextReviewers({ contract, role, status, actorId, approved });
  const reviewFeedback = buildNextReviewFeedback({ contract, feedbackItem });

  return {
    review: {
      role,
      sectionId,
      status,
      actorId,
      comment: comment || null,
      blocking: feedbackItem?.blocking === true,
    },
    draftBody: buildDraftBody({ contract, sectionId, nextSection, nextReviewers, reviewFeedback, body, role }),
  };
}

module.exports = {
  buildExecutionContractSectionReviewDraftBody,
  resolveExecutionContractReviewerRole,
  reviewRoleAllowedForActor,
};
