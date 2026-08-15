'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

function isQaResultsRequest(request) {
  const pathname = new URL(request.url || '/', 'http://audit.local').pathname;
  return request.method === 'POST' && /^\/tasks\/[^/]+\/qa-results$/.test(pathname);
}

function createProjectionConsistentStore(store, requestContext, batchSize = 25) {
  let drainPromise = null;

  async function drainProjectionQueue() {
    if (!drainPromise) {
      drainPromise = Promise.resolve(store.processProjectionQueue(batchSize))
        .finally(() => { drainPromise = null; });
    }
    return drainPromise;
  }

  function requiresConsistency() {
    return requestContext.getStore()?.requiresProjectionConsistency === true;
  }

  return {
    ...store,
    async appendEvent(input) {
      const result = await store.appendEvent(input);
      if (requiresConsistency() && input?.eventType === 'task.stage_changed') {
        await drainProjectionQueue();
      }
      return result;
    },
    async getTaskCurrentState(...args) {
      if (requiresConsistency()) await drainProjectionQueue();
      return store.getTaskCurrentState(...args);
    },
    async getTaskHistory(...args) {
      if (requiresConsistency()) await drainProjectionQueue();
      return store.getTaskHistory(...args);
    },
  };
}

function bindRequestContext(server, requestContext) {
  for (const listener of server.listeners('request')) {
    server.removeListener('request', listener);
    server.on('request', (request, response) => requestContext.run({
      requiresProjectionConsistency: isQaResultsRequest(request),
    }, () => listener.call(server, request, response)));
  }
  return server;
}

function preparePostgresHttpConsistency(options = {}) {
  const store = options.store;
  if (store?.kind !== 'postgres' || typeof store.processProjectionQueue !== 'function') {
    return { options, bind: (result) => result };
  }
  const requestContext = new AsyncLocalStorage();
  return {
    options: {
      ...options,
      store: createProjectionConsistentStore(store, requestContext),
    },
    bind(result) {
      bindRequestContext(result.server, requestContext);
      return result;
    },
  };
}

module.exports = {
  bindRequestContext,
  createProjectionConsistentStore,
  isQaResultsRequest,
  preparePostgresHttpConsistency,
};
