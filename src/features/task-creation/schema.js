const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_TASK_TYPES = ['Feature', 'Bug', 'Refactor', 'Debt', 'Docs'];
const VALID_STAGES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];

function validateTaskCreatePayload(data) {
  const errors = [];

  if (data === null || typeof data !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
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
};
