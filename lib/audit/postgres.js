const { AsyncLocalStorage } = require('node:async_hooks');
const postgresBase = require('./postgres-base');

const appendContext = new AsyncLocalStorage();

function bindMethod(target, value) {
  return typeof value === 'function' ? value.bind(target) : value;
}

function sequenceLockingClient(client) {
  return new Proxy(client, {
    get(target, property) {
      if (property !== 'query') return bindMethod(target, Reflect.get(target, property));
      return async (statement, parameters) => {
        const result = await target.query(statement, parameters);
        const sql = typeof statement === 'string' ? statement.trim().toUpperCase() : '';
        const context = appendContext.getStore();
        if (sql === 'BEGIN' && context) {
          await target.query(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            [context.tenantId, context.taskId],
          );
        }
        return result;
      };
    },
  });
}

function sequenceLockingPool(pool) {
  return new Proxy(pool, {
    get(target, property) {
      if (property !== 'connect') return bindMethod(target, Reflect.get(target, property));
      return async () => sequenceLockingClient(await target.connect());
    },
  });
}

function createPostgresAuditStore(options = {}) {
  const pool = options.pool || postgresBase.createPgPoolFromEnv(options.connectionString);
  const store = postgresBase.createPostgresAuditStore({
    ...options,
    pool: sequenceLockingPool(pool),
  });
  const appendEvent = store.appendEvent;
  return {
    ...store,
    appendEvent(input) {
      return appendContext.run({
        tenantId: input.tenantId || 'engineering-team',
        taskId: input.taskId,
      }, () => appendEvent(input));
    },
  };
}

module.exports = {
  ...postgresBase,
  createPostgresAuditStore,
};
