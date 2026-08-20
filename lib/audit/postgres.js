const { AsyncLocalStorage } = require('node:async_hooks');
const postgresBase = require('./postgres-base');

const appendContext = new AsyncLocalStorage();

function taskSequenceLockParameters(input = {}) {
  const tenantId = String(input.tenantId || 'engineering-team').trim();
  const taskId = String(input.taskId || '').trim();
  if (!tenantId) throw new Error('tenantId is required for audit sequence allocation');
  if (!taskId) throw new Error('taskId is required for audit sequence allocation');
  return [tenantId, taskId];
}

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
      const [tenantId, taskId] = taskSequenceLockParameters(input);
      return appendContext.run({
        tenantId,
        taskId,
      }, () => appendEvent(input));
    },
  };
}

module.exports = {
  ...postgresBase,
  createPostgresAuditStore,
  taskSequenceLockParameters,
};
