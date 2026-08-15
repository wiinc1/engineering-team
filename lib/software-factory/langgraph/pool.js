'use strict';

const { LangGraphRuntimeError } = require('./errors');

function validatePoolBudget(pool, limit) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('A pg-compatible shared pool is required.');
  }
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('Pool budget must be a positive integer.');
}

function reportBudget(state) {
  state.metrics?.gauge('langgraph_pool_active_connections', state.active);
  state.metrics?.gauge('langgraph_pool_waiting_requests', state.waiters.length);
}

function releaseBudget(state) {
  state.active -= 1;
  const next = state.waiters.shift();
  reportBudget(state);
  if (next) next();
}

function grantBudget(state, resolve) {
  state.active += 1;
  reportBudget(state);
  resolve(() => releaseBudget(state));
}

function acquireBudget(state) {
  return new Promise((resolve) => {
    if (state.active < state.limit) grantBudget(state, resolve);
    else {
      state.waiters.push(() => grantBudget(state, resolve));
      state.metrics?.increment('langgraph_pool_saturation_total');
      reportBudget(state);
    }
  });
}

function proxyClient(client, release) {
  let released = false;
  return new Proxy(client, {
    get(target, property) {
      if (property === 'release') return (...args) => {
        if (released) return undefined;
        released = true;
        try { return target.release(...args); } finally { release(); }
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function connectWithBudget(state) {
  const release = await acquireBudget(state);
  try {
    return proxyClient(await state.pool.connect(), release);
  } catch (error) {
    release();
    throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { cause: error });
  }
}

async function queryWithBudget(state, args) {
  const client = await connectWithBudget(state);
  try { return await client.query(...args); } finally { client.release(); }
}

function createPoolBudget(pool, limit, metrics) {
  validatePoolBudget(pool, limit);
  const state = { active: 0, limit, metrics, pool, waiters: [] };
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') return () => connectWithBudget(state);
      if (property === 'query') return (...args) => queryWithBudget(state, args);
      if (property === 'langGraphBudget') return Object.freeze({
        limit, active: () => state.active, waiting: () => state.waiters.length,
      });
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = { createPoolBudget };
