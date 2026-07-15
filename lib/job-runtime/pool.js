'use strict';

const POOL_ERROR_HANDLER = Symbol.for('engineering-team.job-runtime.pool-error-handler');

function ensurePoolErrorHandler(pool, logger, metrics) {
  if (!pool || typeof pool.on !== 'function') return false;
  if (pool[POOL_ERROR_HANDLER]) return true;
  const handler = () => {
    metrics.increment('job_runtime_pool_error_total');
    logger.error('job_runtime_pool_error');
  };
  const connectHandler = (client) => {
    if (typeof client?.on === 'function' && client.listeners('error').length === 0) {
      client.on('error', handler);
    }
  };
  Object.defineProperty(pool, POOL_ERROR_HANDLER, {
    value: Object.freeze({ handler, connectHandler }),
    enumerable: false,
  });
  pool.on('error', handler);
  pool.on('connect', connectHandler);
  return true;
}

module.exports = {
  POOL_ERROR_HANDLER,
  ensurePoolErrorHandler,
};
