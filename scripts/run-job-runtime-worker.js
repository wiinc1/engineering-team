#!/usr/bin/env node
'use strict';

const { createJobRuntimeInfrastructure } = require('../lib/job-runtime');
const { sanitizedError } = require('../lib/job-runtime/errors');
const { createJobRuntimeLogger } = require('../lib/job-runtime/observability');

async function main(options = {}) {
  const logger = options.logger || createJobRuntimeLogger({ baseDir: options.baseDir || process.cwd() });
  try {
    const infrastructure = options.infrastructure || createJobRuntimeInfrastructure({ logger });
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
  main,
};
