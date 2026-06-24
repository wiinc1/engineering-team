const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TASK_ID_PREFIX = 'TSK';
const TASK_ID_SEQUENCE_MIN = 1;
const TASK_ID_SEQUENCE_MAX = 99999;
const SEQUENTIAL_TASK_ID_PATTERN = /^TSK-\d{3,5}$/;

function generateSequentialTaskId(sequence) {
  if (
    !Number.isInteger(sequence)
    || sequence < TASK_ID_SEQUENCE_MIN
    || sequence > TASK_ID_SEQUENCE_MAX
  ) {
    throw new RangeError(
      `Task sequence must be between ${TASK_ID_SEQUENCE_MIN} and ${TASK_ID_SEQUENCE_MAX}, got ${sequence}`,
    );
  }
  const padded = String(sequence).padStart(3, '0');
  return `${TASK_ID_PREFIX}-${padded}`;
}

function parseSequentialTaskSequence(taskId) {
  if (typeof taskId !== 'string' || !SEQUENTIAL_TASK_ID_PATTERN.test(taskId)) {
    return null;
  }
  const sequence = parseInt(taskId.slice(TASK_ID_PREFIX.length + 1), 10);
  return Number.isInteger(sequence)
    && sequence >= TASK_ID_SEQUENCE_MIN
    && sequence <= TASK_ID_SEQUENCE_MAX
    ? sequence
    : null;
}

function isSequentialTaskId(taskId) {
  return parseSequentialTaskSequence(taskId) !== null;
}

function makeOpaqueTaskId() {
  return `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function maxSequentialFromTaskIds(taskIds = []) {
  let max = 0;
  for (const taskId of taskIds) {
    const sequence = parseSequentialTaskSequence(taskId);
    if (sequence != null && sequence > max) {
      max = sequence;
    }
  }
  return max;
}

function resolveTaskIdForCreate(providedTaskId = null, { preferSequential = true } = {}) {
  const explicit = String(providedTaskId || '').trim();
  if (explicit) {
    return explicit;
  }
  if (!preferSequential) {
    return makeOpaqueTaskId();
  }
  return null;
}

function readSequenceCounter(store = {}, tenantId) {
  const sequences = store.task_id_sequences || {};
  const raw = sequences[tenantId];
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= TASK_ID_SEQUENCE_MIN ? parsed : null;
}

function writeSequenceCounter(store, tenantId, nextSequence) {
  if (!store.task_id_sequences) {
    store.task_id_sequences = {};
  }
  store.task_id_sequences[tenantId] = nextSequence;
}

function allocateSequentialTaskIdFromStore(store = {}, tenantId, { existingTaskIds = [] } = {}) {
  const fromCounter = readSequenceCounter(store, tenantId);
  const fromTasks = maxSequentialFromTaskIds(existingTaskIds);
  const base = Math.max(fromCounter || 0, fromTasks);
  const next = base + 1;
  if (next > TASK_ID_SEQUENCE_MAX) {
    return makeOpaqueTaskId();
  }
  writeSequenceCounter(store, tenantId, next);
  return generateSequentialTaskId(next);
}

function allocateSequentialTaskIdForFileStore(store, tenantId) {
  const existingTaskIds = Object.keys(store.tasks || {})
    .filter((key) => key.startsWith(`${tenantId}::`))
    .map((key) => key.split('::')[1]);
  return allocateSequentialTaskIdFromStore(store, tenantId, { existingTaskIds });
}

function makeTaskId(options = {}) {
  if (options.sequence != null) {
    return generateSequentialTaskId(options.sequence);
  }
  if (options.store && options.tenantId) {
    return allocateSequentialTaskIdForFileStore(options.store, options.tenantId);
  }
  if (options.preferSequential === false) {
    return makeOpaqueTaskId();
  }
  return makeOpaqueTaskId();
}

module.exports = {
  TASK_ID_PREFIX,
  TASK_ID_SEQUENCE_MIN,
  TASK_ID_SEQUENCE_MAX,
  SEQUENTIAL_TASK_ID_PATTERN,
  generateSequentialTaskId,
  parseSequentialTaskSequence,
  isSequentialTaskId,
  makeOpaqueTaskId,
  maxSequentialFromTaskIds,
  resolveTaskIdForCreate,
  allocateSequentialTaskIdFromStore,
  allocateSequentialTaskIdForFileStore,
  makeTaskId,
};