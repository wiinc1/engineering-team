const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_TASK_TYPES = ['Feature', 'Bug', 'Refactor', 'Debt', 'Docs'];
const VALID_STAGES = ['DRAFT', 'BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
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
  UNTITLED_INTAKE_DRAFT_TITLE,
  INTAKE_DRAFT_TITLE_MAX_LENGTH,
};
