'use strict';

const { Annotation } = require('@langchain/langgraph');
const { GRAPH_VERSION, STATE_SCHEMA_VERSION } = require('./constants');
const { LangGraphRuntimeError } = require('./errors');
const { assertFactoryRunId, assertTenantId, assertThreadId, deriveThreadId } = require('./identity');

const NODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(^|_)(authorization|cookie|password|passwd|secret|token|api_?key|private_?key|credential)s?($|_)/i;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
];
const SECRET_QUERY_KEY_PATTERN = /(^|[-_])(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|credential|access[-_]?key|signature|sig)s?($|[-_])/i;
const FACTORY_STATE_KEYS = Object.freeze([
  'schemaVersion', 'graphVersion', 'tenantId', 'factoryRunId', 'threadId', 'lifecycleNode',
  'completedNodes', 'artifacts', 'decisions', 'attempt', 'updatedAt', 'lifecycleStatus',
  'qaOutcome', 'qaAttempts', 'terminalReason', 'nodeAttempts', 'childRuns',
]);
const LIFECYCLE_STATUSES = new Set([
  'running', 'retrying', 'waiting', 'succeeded', 'failed', 'dead_letter', 'cancelled',
]);
const CHILD_STATUSES = new Set(['blocked', 'ready', 'running', 'succeeded', 'failed', 'cancelled']);

function invalid(reason, field) {
  return new LangGraphRuntimeError('langgraph_state_invalid', {
    safeDetails: { reason, ...(field ? { field } : {}) },
  });
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function scanForSecrets(value, path = '$', seen = new Set()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) throw invalid('secret_value', path);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) throw invalid('cyclic_state', path);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) throw invalid('secret_key', `${path}.${key}`);
    scanForSecrets(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function jsonBytes(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw invalid('not_json_serializable'); }
  if (serialized === undefined) throw invalid('not_json_serializable');
  return Buffer.byteLength(serialized, 'utf8');
}

function assertExactKeys(object, allowed) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) throw invalid('unknown_field', key);
}

function validateArtifact(value, index) {
  if (!plainObject(value)) throw invalid('artifact_shape', `artifacts.${index}`);
  assertExactKeys(value, new Set(['kind', 'reference', 'checksum']));
  if (!CODE_PATTERN.test(value.kind || '')) throw invalid('artifact_kind', `artifacts.${index}.kind`);
  if (typeof value.reference !== 'string' || value.reference.length < 1 || value.reference.length > 512) {
    throw invalid('artifact_reference', `artifacts.${index}.reference`);
  }
  assertArtifactReferenceSafe(value.reference, `artifacts.${index}.reference`);
  if (!CHECKSUM_PATTERN.test(value.checksum || '')) throw invalid('artifact_checksum', `artifacts.${index}.checksum`);
  return Object.freeze({ kind: value.kind, reference: value.reference, checksum: value.checksum });
}

function assertArtifactReferenceSafe(reference, field) {
  if (/[\u0000-\u001f\u007f]/.test(reference)) throw invalid('artifact_reference', field);
  let parsed;
  try { parsed = new URL(reference, 'https://artifact.invalid'); } catch { throw invalid('artifact_reference', field); }
  if (parsed.username || parsed.password) throw invalid('secret_value', field);
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_KEY_PATTERN.test(key)) throw invalid('secret_value', field);
  }
  const fragmentKey = parsed.hash.slice(1).split('=', 1)[0];
  let decodedFragmentKey = fragmentKey;
  try { decodedFragmentKey = decodeURIComponent(fragmentKey); } catch { throw invalid('artifact_reference', field); }
  if (decodedFragmentKey && SECRET_QUERY_KEY_PATTERN.test(decodedFragmentKey)) throw invalid('secret_value', field);
}

function validateDecision(value, index) {
  if (!plainObject(value)) throw invalid('decision_shape', `decisions.${index}`);
  assertExactKeys(value, new Set(['code', 'outcome']));
  if (!CODE_PATTERN.test(value.code || '')) throw invalid('decision_code', `decisions.${index}.code`);
  if (!['approved', 'rejected', 'deferred'].includes(value.outcome)) throw invalid('decision_outcome', `decisions.${index}.outcome`);
  return Object.freeze({ code: value.code, outcome: value.outcome });
}

function validateStringArray(value, field) {
  if (!Array.isArray(value) || value.length > 128) throw invalid('array_shape', field);
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !NODE_PATTERN.test(entry)) throw invalid('node_name', field);
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) throw invalid('duplicate_node', field);
  return Object.freeze(normalized);
}

function validateNodeAttempts(value) {
  if (!plainObject(value) || Object.keys(value).length > 128) throw invalid('node_attempts');
  const output = {};
  for (const [node, attempts] of Object.entries(value)) {
    if (!NODE_PATTERN.test(node) || !Number.isInteger(attempts) || attempts < 0 || attempts > 1_000) {
      throw invalid('node_attempts', node);
    }
    output[node] = attempts;
  }
  return Object.freeze(output);
}

function validateChildRun(value, index) {
  if (!plainObject(value)) throw invalid('child_run_shape', `childRuns.${index}`);
  assertExactKeys(value, new Set(['id', 'status', 'dependencies', 'attempt', 'namespace']));
  if (!NODE_PATTERN.test(value.id || '')) throw invalid('child_run_id', `childRuns.${index}.id`);
  if (!CHILD_STATUSES.has(value.status)) throw invalid('child_run_status', `childRuns.${index}.status`);
  if (!Number.isInteger(value.attempt) || value.attempt < 0 || value.attempt > 1_000) {
    throw invalid('child_run_attempt', `childRuns.${index}.attempt`);
  }
  const dependencies = validateStringArray(value.dependencies, `childRuns.${index}.dependencies`);
  if (dependencies.includes(value.id)) throw invalid('child_run_dependency', `childRuns.${index}.dependencies`);
  if (typeof value.namespace !== 'string' || !/^child:[a-z][a-z0-9_]{1,63}$/.test(value.namespace)) {
    throw invalid('child_run_namespace', `childRuns.${index}.namespace`);
  }
  return Object.freeze({
    id: value.id,
    status: value.status,
    dependencies,
    attempt: value.attempt,
    namespace: value.namespace,
  });
}

function validateChildRuns(value) {
  if (!Array.isArray(value) || value.length > 128) throw invalid('child_runs');
  const normalized = value.map(validateChildRun);
  const ids = new Set(normalized.map((child) => child.id));
  if (ids.size !== normalized.length) throw invalid('duplicate_child_run');
  for (const child of normalized) {
    for (const dependency of child.dependencies) {
      if (!ids.has(dependency)) throw invalid('child_run_dependency', child.id);
    }
  }
  return Object.freeze(normalized);
}

function mergeNodeAttempts(left = {}, right = {}) {
  const output = { ...(left || {}) };
  for (const [node, attempts] of Object.entries(right || {})) {
    output[node] = Math.max(output[node] || 0, attempts);
  }
  return output;
}

function validateFactoryState(value, options = {}) {
  if (!plainObject(value)) throw invalid('state_shape');
  scanForSecrets(value);
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const sizeBytes = jsonBytes(value);
  if (sizeBytes > maxBytes) throw invalid('state_too_large');
  assertExactKeys(value, new Set(FACTORY_STATE_KEYS));
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new LangGraphRuntimeError('langgraph_version_unsupported', { safeDetails: { kind: 'state' } });
  }
  if (value.graphVersion !== GRAPH_VERSION) {
    throw new LangGraphRuntimeError('langgraph_version_unsupported', { safeDetails: { kind: 'graph' } });
  }
  assertTenantId(value.tenantId);
  assertFactoryRunId(value.factoryRunId);
  assertThreadId(value.threadId);
  if (value.threadId !== deriveThreadId({ tenantId: value.tenantId, factoryRunId: value.factoryRunId })) {
    throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
  }
  if (value.lifecycleNode !== null && !NODE_PATTERN.test(value.lifecycleNode || '')) throw invalid('lifecycle_node');
  if (!Number.isInteger(value.attempt) || value.attempt < 0 || value.attempt > 1_000) throw invalid('attempt');
  if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw invalid('updated_at');
  const lifecycleStatus = value.lifecycleStatus ?? 'running';
  if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) throw invalid('lifecycle_status');
  const qaOutcome = value.qaOutcome ?? null;
  if (qaOutcome !== null && !['pass', 'fail'].includes(qaOutcome)) throw invalid('qa_outcome');
  const qaAttempts = value.qaAttempts ?? 0;
  if (!Number.isInteger(qaAttempts) || qaAttempts < 0 || qaAttempts > 1_000) throw invalid('qa_attempts');
  const terminalReason = value.terminalReason ?? null;
  if (terminalReason !== null && !CODE_PATTERN.test(terminalReason)) throw invalid('terminal_reason');
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    graphVersion: value.graphVersion,
    tenantId: value.tenantId,
    factoryRunId: value.factoryRunId,
    threadId: value.threadId,
    lifecycleNode: value.lifecycleNode,
    completedNodes: validateStringArray(value.completedNodes, 'completedNodes'),
    artifacts: Object.freeze((Array.isArray(value.artifacts) ? value.artifacts : (() => { throw invalid('artifacts'); })()).map(validateArtifact)),
    decisions: Object.freeze((Array.isArray(value.decisions) ? value.decisions : (() => { throw invalid('decisions'); })()).map(validateDecision)),
    attempt: value.attempt,
    updatedAt: new Date(value.updatedAt).toISOString(),
    lifecycleStatus,
    qaOutcome,
    qaAttempts,
    terminalReason,
    nodeAttempts: validateNodeAttempts(value.nodeAttempts ?? {}),
    childRuns: validateChildRuns(value.childRuns ?? []),
  });
}

function projectFactoryState(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(FACTORY_STATE_KEYS
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, value[key]]));
}

function uniqueSortedReducer(left = [], right = []) {
  return [...new Set([...(left || []), ...(right || [])])].sort();
}

function appendObjectsReducer(left = [], right = []) {
  const keyed = new Map();
  for (const entry of [...(left || []), ...(right || [])]) keyed.set(JSON.stringify(entry), entry);
  return [...keyed.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const FactoryStateAnnotation = Annotation.Root({
  schemaVersion: Annotation({ reducer: (_left, right) => right, default: () => STATE_SCHEMA_VERSION }),
  graphVersion: Annotation({ reducer: (_left, right) => right, default: () => GRAPH_VERSION }),
  tenantId: Annotation({ reducer: (_left, right) => right, default: () => '' }),
  factoryRunId: Annotation({ reducer: (_left, right) => right, default: () => '' }),
  threadId: Annotation({ reducer: (_left, right) => right, default: () => '' }),
  lifecycleNode: Annotation({ reducer: (_left, right) => right, default: () => null }),
  completedNodes: Annotation({ reducer: uniqueSortedReducer, default: () => [] }),
  artifacts: Annotation({ reducer: appendObjectsReducer, default: () => [] }),
  decisions: Annotation({ reducer: appendObjectsReducer, default: () => [] }),
  attempt: Annotation({ reducer: (left, right) => Math.max(left ?? 0, right ?? 0), default: () => 0 }),
  updatedAt: Annotation({ reducer: (_left, right) => right, default: () => new Date(0).toISOString() }),
  lifecycleStatus: Annotation({ reducer: (_left, right) => right, default: () => 'running' }),
  qaOutcome: Annotation({ reducer: (_left, right) => right, default: () => null }),
  qaAttempts: Annotation({ reducer: (left, right) => Math.max(left ?? 0, right ?? 0), default: () => 0 }),
  terminalReason: Annotation({ reducer: (_left, right) => right, default: () => null }),
  nodeAttempts: Annotation({ reducer: mergeNodeAttempts, default: () => ({}) }),
  childRuns: Annotation({ reducer: (_left, right) => right, default: () => [] }),
});

module.exports = {
  FactoryStateAnnotation,
  FACTORY_STATE_KEYS,
  appendObjectsReducer,
  jsonBytes,
  mergeNodeAttempts,
  projectFactoryState,
  scanForSecrets,
  uniqueSortedReducer,
  validateFactoryState,
};
