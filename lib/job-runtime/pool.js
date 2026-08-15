'use strict';

const POOL_ERROR_HANDLER = Symbol.for('engineering-team.job-runtime.pool-error-handler');

function connectionGate(limit) {
  let active = 0;
  const waiting = [];
  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next(release);
    }
  }
  return Object.freeze({
    acquire() {
      if (active < limit) {
        active += 1;
        return Promise.resolve(release);
      }
      return new Promise((resolve) => waiting.push(resolve));
    },
    waitingCount: () => waiting.length,
  });
}

function budgetedClient(client, releaseBudget) {
  let released = false;
  const release = (...args) => {
    if (released) return;
    released = true;
    try { return client.release(...args); } finally { releaseBudget(); }
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === 'release') return release;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createConnectionBudgetPool(pool, limit) {
  if (!pool || typeof pool.connect !== 'function' || !Number.isInteger(limit) || limit < 1) {
    throw new TypeError('A pool and positive connection budget are required.');
  }
  const gate = connectionGate(limit);
  async function acquireClient() {
    const releaseBudget = await gate.acquire();
    try { return budgetedClient(await pool.connect(), releaseBudget); } catch (error) { releaseBudget(); throw error; }
  }
  function connect(callback) {
    const promise = acquireClient();
    if (typeof callback !== 'function') return promise;
    promise.then((client) => callback(null, client, client.release), (error) => callback(error));
    return undefined;
  }
  function query(...input) {
    const callback = typeof input.at(-1) === 'function' ? input.pop() : null;
    const promise = acquireClient().then(async (client) => {
      try { return await client.query(...input); } finally { client.release(); }
    });
    if (!callback) return promise;
    promise.then((result) => callback(null, result), (error) => callback(error));
    return undefined;
  }
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') return connect;
      if (property === 'query') return query;
      if (property === 'waitingCount') return Number(target.waitingCount || 0) + gate.waitingCount();
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

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
  createConnectionBudgetPool,
  ensurePoolErrorHandler,
};
