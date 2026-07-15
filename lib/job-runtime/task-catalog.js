'use strict';

const { JOB_RUNTIME_CATALOG_VERSION } = require('./constants');
const { JobRuntimeError } = require('./errors');

const SYNTHETIC_TASK_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['probeId'],
  properties: {
    probeId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' },
    expectedOutcome: { type: 'string', enum: ['acknowledge', 'retry_once'] },
  },
});

const TASK_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'job_runtime.synthetic',
    version: 1,
    identifier: 'job_runtime.synthetic.v1',
    schema: SYNTHETIC_TASK_SCHEMA,
    queue: 'job-runtime-synthetic',
    retry: Object.freeze({ maxAttempts: 3, priority: 0 }),
    concurrency: Object.freeze({ serialByNamedQueue: true }),
    canonicalResourceTypes: Object.freeze(['synthetic']),
  }),
]);

function createTaskCatalog(definitions = TASK_DEFINITIONS) {
  const byName = new Map();
  const byIdentifier = new Map();
  for (const definition of definitions) {
    const nameVersions = byName.get(definition.name) || new Map();
    if (nameVersions.has(definition.version) || byIdentifier.has(definition.identifier)) {
      throw new Error('Duplicate job task catalog entry');
    }
    nameVersions.set(definition.version, Object.freeze({ ...definition }));
    byName.set(definition.name, nameVersions);
    byIdentifier.set(definition.identifier, definition);
  }

  function resolve(name, version) {
    const versions = byName.get(name);
    if (!versions) throw new JobRuntimeError('job_task_unknown');
    const definition = versions.get(version);
    if (!definition) throw new JobRuntimeError('job_version_unsupported');
    return definition;
  }

  function resolveIdentifier(identifier) {
    const definition = byIdentifier.get(identifier);
    if (!definition) throw new JobRuntimeError('job_task_unknown');
    return definition;
  }

  return Object.freeze({
    catalogVersion: JOB_RUNTIME_CATALOG_VERSION,
    identifiers: Object.freeze([...byIdentifier.keys()]),
    resolve,
    resolveIdentifier,
  });
}

module.exports = {
  SYNTHETIC_TASK_SCHEMA,
  TASK_DEFINITIONS,
  createTaskCatalog,
};
