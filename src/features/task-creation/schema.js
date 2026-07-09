const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_TASK_TYPES = ['Feature', 'Bug', 'Refactor', 'Debt', 'Docs'];
// PRD GAP-01: 7-stage canonical lifecycle (Intake Draft through Closeout).
// Maps to workflow.js STAGES: DRAFT -> INTAKE_DRAFT, BACKLOG -> TASK_REFINEMENT,
// TODO -> OPERATOR_APPROVAL, IMPLEMENTATION -> IMPLEMENTATION, QA_TESTING -> QA_VERIFICATION,
// SRE_MONITORING -> SRE_VERIFICATION, DONE -> CLOSEOUT.
const LIFECYCLE_STAGES = Object.freeze([
  'INTAKE_DRAFT',
  'TASK_REFINEMENT',
  'OPERATOR_APPROVAL',
  'IMPLEMENTATION',
  'QA_VERIFICATION',
  'SRE_VERIFICATION',
  'CLOSEOUT',
]);

// PRD GAP-01: VALID_STAGES is now the canonical 7-stages lifecycle.
// Legacy values are preserved as VALID_STAGES._legacy for backward compatibility only.
const _legacyStages = Object.freeze(['DRAFT', 'BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
const VALID_STAGES = [...LIFECYCLE_STAGES];
Object.defineProperty(VALID_STAGES, '_legacy', {
  enumerable: false,
  value: _legacyStages,
});
Object.freeze(VALID_STAGES);
const VALID_LIFECYCLE_MAP = Object.freeze({
  INTAKE_DRAFT: 0,
  TASK_REFINEMENT: 1,
  OPERATOR_APPROVAL: 2,
  IMPLEMENTATION: 3,
  QA_VERIFICATION: 4,
  SRE_VERIFICATION: 5,
  CLOSEOUT: 6,
});
const UNTITLED_INTAKE_DRAFT_TITLE = 'Untitled intake draft';
const INTAKE_DRAFT_TITLE_MAX_LENGTH = 120;

function validateTaskCreatePayload(data) {
  const errors = [];

  if (data === null || typeof data !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const rawRequirements = data.raw_requirements ?? data.rawRequirements;
  if (rawRequirements !== undefined) {
    if (typeof rawRequirements !== 'string' || rawRequirements.trim().length === 0) {
      errors.push('raw_requirements is required and must be a non-empty string');
    }
    if (data.title !== undefined && data.title !== null && typeof data.title !== 'string') {
      errors.push('title must be a string when provided');
    }
    if (typeof data.title === 'string' && data.title.trim().length > INTAKE_DRAFT_TITLE_MAX_LENGTH) {
      errors.push(`title must be ${INTAKE_DRAFT_TITLE_MAX_LENGTH} characters or fewer`);
    }
    return { valid: errors.length === 0, errors };
  }

  if (typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('title is required and must be a non-empty string');
  }

  if (typeof data.business_context !== 'string' || data.business_context.trim().length === 0) {
    errors.push('business_context is required and must be a non-empty string');
  }

  if (typeof data.acceptance_criteria !== 'string' || data.acceptance_criteria.trim().length === 0) {
    errors.push('acceptance_criteria is required and must be a non-empty string');
  }

  if (typeof data.definition_of_done !== 'string' || data.definition_of_done.trim().length === 0) {
    errors.push('definition_of_done is required and must be a non-empty string');
  }

  if (!VALID_PRIORITIES.includes(data.priority)) {
    errors.push(
      `priority must be one of: ${VALID_PRIORITIES.join(', ')}, got: ${String(data.priority)}`
    );
  }

  if (!VALID_TASK_TYPES.includes(data.task_type)) {
    errors.push(
      `task_type must be one of: ${VALID_TASK_TYPES.join(', ')}, got: ${String(data.task_type)}`
    );
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateTaskCreatePayload,
  VALID_PRIORITIES,
  VALID_TASK_TYPES,
  VALID_STAGES,
  VALID_LIFECYCLE_MAP,
  UNTITLED_INTAKE_DRAFT_TITLE,
  INTAKE_DRAFT_TITLE_MAX_LENGTH,
};
