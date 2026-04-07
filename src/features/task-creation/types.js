const TASK_ID_PREFIX = 'TSK';
const TASK_ID_SEQUENCE_MIN = 1;
const TASK_ID_SEQUENCE_MAX = 99999;
const TASK_ID_PATTERN = /^TSK-\d{3,5}$/;

function generateTaskId(sequence) {
  if (
    !Number.isInteger(sequence) ||
    sequence < TASK_ID_SEQUENCE_MIN ||
    sequence > TASK_ID_SEQUENCE_MAX
  ) {
    throw new RangeError(
      `Task sequence must be between ${TASK_ID_SEQUENCE_MIN} and ${TASK_ID_SEQUENCE_MAX}, got ${sequence}`
    );
  }
  const padded = String(sequence).padStart(3, '0');
  return `${TASK_ID_PREFIX}-${padded}`;
}

function parseTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    return null;
  }
  const sequence = parseInt(taskId.slice(TASK_ID_PREFIX.length + 1), 10);
  return Number.isInteger(sequence) &&
    sequence >= TASK_ID_SEQUENCE_MIN &&
    sequence <= TASK_ID_SEQUENCE_MAX
    ? sequence
    : null;
}

function isValidTaskId(taskId) {
  return parseTaskId(taskId) !== null;
}

module.exports = {
  generateTaskId,
  parseTaskId,
  isValidTaskId,
  TASK_ID_PREFIX,
  TASK_ID_SEQUENCE_MIN,
  TASK_ID_SEQUENCE_MAX,
  TASK_ID_PATTERN,
};
