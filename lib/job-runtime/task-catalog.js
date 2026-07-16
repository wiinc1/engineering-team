'use strict';

const { JOB_RUNTIME_CATALOG_VERSION } = require('./constants');
const { JobRuntimeError } = require('./errors');

const IDENTIFIER = Object.freeze({ type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const POSITIVE_BATCH = Object.freeze({ type: 'integer', minimum: 1, maximum: 1000 });

function objectSchema(required, properties) {
  return Object.freeze({ type: 'object', additionalProperties: false, required, properties });
}

const TASK_SCHEMAS = Object.freeze({
  synthetic: objectSchema(['probeId'], {
    probeId: { ...IDENTIFIER, maxLength: 64 },
    expectedOutcome: { type: 'string', enum: ['acknowledge', 'retry_once'] },
  }),
  factoryStart: objectSchema(['runId', 'taskId', 'threadId', 'workflowVersion'], {
    runId: IDENTIFIER,
    taskId: IDENTIFIER,
    threadId: IDENTIFIER,
    workflowVersion: { type: 'integer', minimum: 1, maximum: 999 },
  }),
  factoryResume: objectSchema(['runId', 'taskId', 'threadId', 'workflowVersion', 'checkpointVersion'], {
    runId: IDENTIFIER,
    taskId: IDENTIFIER,
    threadId: IDENTIFIER,
    workflowVersion: { type: 'integer', minimum: 1, maximum: 999 },
    checkpointVersion: { type: 'integer', minimum: 1, maximum: 2147483647 },
  }),
  auditBatch: objectSchema(['occurrenceId', 'batchSize'], {
    occurrenceId: IDENTIFIER,
    batchSize: POSITIVE_BATCH,
  }),
  maintenance: objectSchema(['occurrenceId'], { occurrenceId: IDENTIFIER }),
});

function definition(input) {
  return Object.freeze({
    handlerVersion: 1,
    concurrency: Object.freeze({ lanes: 1, ordering: 'canonical_resource' }),
    timeoutMs: 30_000,
    cancellation: 'retry_if_effect_unconfirmed',
    gracefulShutdown: 'finish_until_deadline_then_reconcile',
    ...input,
    retry: Object.freeze({ backoff: 'graphile_exponential', ...input.retry }),
    canonicalResourceTypes: Object.freeze(input.canonicalResourceTypes),
  });
}

const TASK_DEFINITIONS = Object.freeze([
  definition({
    name: 'job_runtime.synthetic', version: 1, identifier: 'job_runtime.synthetic.v1',
    schema: TASK_SCHEMAS.synthetic, queue: 'job-runtime-synthetic',
    retry: { maxAttempts: 3, priority: 0, classifier: 'runtime' },
    canonicalResourceTypes: ['synthetic'],
  }),
  definition({
    name: 'factory.langgraph.start', version: 1, identifier: 'factory.langgraph.start.v1',
    schema: TASK_SCHEMAS.factoryStart, queue: 'factory-workflow',
    concurrency: Object.freeze({ lanes: 1, ordering: 'factory_run' }),
    timeoutMs: 30 * 60_000, retry: { maxAttempts: 5, priority: -2, classifier: 'external_effect' },
    canonicalResourceTypes: ['factory_run'],
  }),
  definition({
    name: 'factory.langgraph.resume', version: 1, identifier: 'factory.langgraph.resume.v1',
    schema: TASK_SCHEMAS.factoryResume, queue: 'factory-workflow',
    concurrency: Object.freeze({ lanes: 1, ordering: 'factory_run' }),
    timeoutMs: 30 * 60_000, retry: { maxAttempts: 5, priority: -2, classifier: 'external_effect' },
    canonicalResourceTypes: ['factory_run'],
  }),
  definition({
    name: 'audit.projection.catch_up', version: 1, identifier: 'audit.projection.catch_up.v1',
    schema: TASK_SCHEMAS.auditBatch, queue: 'audit-projection', timeoutMs: 60_000,
    retry: { maxAttempts: 8, priority: -5, classifier: 'database' },
    canonicalResourceTypes: ['audit_runtime'],
  }),
  definition({
    name: 'audit.outbox.deliver', version: 1, identifier: 'audit.outbox.deliver.v1',
    schema: TASK_SCHEMAS.auditBatch, queue: 'audit-outbox', timeoutMs: 120_000,
    retry: { maxAttempts: 10, priority: -4, classifier: 'external_effect' },
    canonicalResourceTypes: ['audit_runtime'],
  }),
  definition({
    name: 'maintenance.sre_monitoring.expire', version: 1, identifier: 'maintenance.sre_monitoring.expire.v1',
    schema: TASK_SCHEMAS.auditBatch, queue: 'maintenance-runtime', timeoutMs: 60_000,
    retry: { maxAttempts: 5, priority: 1, classifier: 'database' },
    canonicalResourceTypes: ['audit_runtime'],
  }),
  definition({
    name: 'maintenance.factory.reconcile', version: 1, identifier: 'maintenance.factory.reconcile.v1',
    schema: TASK_SCHEMAS.maintenance, queue: 'maintenance-runtime', timeoutMs: 60_000,
    retry: { maxAttempts: 5, priority: 1, classifier: 'database' },
    canonicalResourceTypes: ['factory_tenant'],
  }),
  definition({
    name: 'maintenance.job_runtime.prune', version: 1, identifier: 'maintenance.job_runtime.prune.v1',
    schema: TASK_SCHEMAS.maintenance, queue: 'maintenance-runtime', timeoutMs: 60_000,
    retry: { maxAttempts: 3, priority: 2, classifier: 'database' },
    canonicalResourceTypes: ['job_runtime'],
  }),
]);

function validateDefinition(entry) {
  if (!entry.name || !entry.identifier || !entry.schema || !entry.retry || !entry.concurrency) {
    throw new Error('Incomplete job task catalog entry');
  }
  if (!Number.isInteger(entry.handlerVersion) || !Number.isInteger(entry.timeoutMs)
    || !entry.cancellation || !entry.gracefulShutdown || !entry.retry.backoff) {
    throw new Error('Invalid job task handler policy');
  }
}

function createTaskCatalog(definitions = TASK_DEFINITIONS) {
  const byName = new Map();
  const byIdentifier = new Map();
  for (const entry of definitions) {
    validateDefinition(entry);
    const nameVersions = byName.get(entry.name) || new Map();
    if (nameVersions.has(entry.version) || byIdentifier.has(entry.identifier)) {
      throw new Error('Duplicate job task catalog entry');
    }
    const frozen = Object.freeze({ ...entry });
    nameVersions.set(entry.version, frozen);
    byName.set(entry.name, nameVersions);
    byIdentifier.set(entry.identifier, frozen);
  }

  function resolve(name, version) {
    const versions = byName.get(name);
    if (!versions) throw new JobRuntimeError('job_task_unknown');
    const entry = versions.get(version);
    if (!entry) throw new JobRuntimeError('job_version_unsupported');
    return entry;
  }

  function resolveIdentifier(identifier) {
    const entry = byIdentifier.get(identifier);
    if (!entry) throw new JobRuntimeError('job_task_unknown');
    return entry;
  }

  return Object.freeze({
    catalogVersion: JOB_RUNTIME_CATALOG_VERSION,
    identifiers: Object.freeze([...byIdentifier.keys()]),
    resolve,
    resolveIdentifier,
  });
}

module.exports = {
  SYNTHETIC_TASK_SCHEMA: TASK_SCHEMAS.synthetic,
  TASK_DEFINITIONS,
  TASK_SCHEMAS,
  createTaskCatalog,
};
