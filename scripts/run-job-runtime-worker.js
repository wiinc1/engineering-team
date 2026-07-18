#!/usr/bin/env node
'use strict';

const { createJobRuntimeInfrastructure } = require('../lib/job-runtime');
const { sanitizedError } = require('../lib/job-runtime/errors');
const { createJobRuntimeLogger } = require('../lib/job-runtime/observability');

function enabled(value) {
  return value === true || ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function assertRuntimeWiring(options = {}, env = process.env) {
  if (!enabled(options.ffLangGraphRuntime ?? env.FF_LANGGRAPH_RUNTIME)) return;
  const adapter = options.workloads?.langGraph;
  if (options.infrastructure || ['start', 'resume', 'lookupEffect'].every((name) => typeof adapter?.[name] === 'function')) return;
  throw Object.assign(new Error('Enabled LangGraph workers require the production lifecycle workload adapter.'), {
    code: 'langgraph_lifecycle_wiring_missing',
  });
}

async function main(options = {}) {
  const logger = options.logger || createJobRuntimeLogger({ baseDir: options.baseDir || process.cwd() });
  try {
    assertRuntimeWiring(options);
    const infrastructure = options.infrastructure || createJobRuntimeInfrastructure({ ...options, logger });
    infrastructure.runtime.installSignalHandlers();
    await infrastructure.runtime.start();
    return infrastructure;
  } catch (error) {
    logger.error('job_runtime_process_failed', { error: sanitizedError(error) });
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) main();

module.exports = {
  assertRuntimeWiring,
  enabled,
  main,
};
