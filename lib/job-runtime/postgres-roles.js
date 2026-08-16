'use strict';

const { GRAPHILE_WORKER_SCHEMA, JOB_RUNTIME_SCHEMA } = require('./constants');
const { JobRuntimeError } = require('./errors');

const DEFAULT_ROLES = Object.freeze({
  migrator: 'job_runtime_migrator',
  producer: 'job_runtime_producer',
  worker: 'job_runtime_worker',
});

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(identifier || '')) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'invalid_role_name' } });
  }
  return `"${identifier}"`;
}

async function requireRoles(pool, roles) {
  const names = Object.values(roles);
  const result = await pool.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [names]);
  if (new Set(result.rows.map((row) => row.rolname)).size !== names.length) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'roles_missing' } });
  }
}

function grantStatements(roles) {
  const migrator = quoteIdentifier(roles.migrator);
  const producer = quoteIdentifier(roles.producer);
  const worker = quoteIdentifier(roles.worker);
  return [
    `REVOKE ALL ON SCHEMA ${GRAPHILE_WORKER_SCHEMA} FROM PUBLIC`,
    `GRANT USAGE, CREATE ON SCHEMA ${GRAPHILE_WORKER_SCHEMA}, ${JOB_RUNTIME_SCHEMA}, runtime_control TO ${migrator}`,
    `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${GRAPHILE_WORKER_SCHEMA}, ${JOB_RUNTIME_SCHEMA} TO ${migrator}`,
    `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${GRAPHILE_WORKER_SCHEMA}, ${JOB_RUNTIME_SCHEMA} TO ${migrator}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${GRAPHILE_WORKER_SCHEMA} TO ${migrator}`,
    `GRANT USAGE ON SCHEMA ${GRAPHILE_WORKER_SCHEMA}, ${JOB_RUNTIME_SCHEMA}, runtime_control TO ${producer}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${GRAPHILE_WORKER_SCHEMA} TO ${producer}`,
    `GRANT SELECT, INSERT, UPDATE ON ${JOB_RUNTIME_SCHEMA}.job_delivery_registry TO ${producer}`,
    `GRANT SELECT, INSERT, UPDATE ON ${JOB_RUNTIME_SCHEMA}.job_operator_actions TO ${producer}`,
    `GRANT SELECT ON runtime_control.ownership_epochs TO ${producer}`,
    `GRANT USAGE ON SCHEMA ${GRAPHILE_WORKER_SCHEMA}, ${JOB_RUNTIME_SCHEMA}, runtime_control TO ${worker}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${GRAPHILE_WORKER_SCHEMA} TO ${worker}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${GRAPHILE_WORKER_SCHEMA} TO ${worker}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${GRAPHILE_WORKER_SCHEMA} TO ${worker}`,
    `GRANT SELECT, UPDATE, DELETE ON ${JOB_RUNTIME_SCHEMA}.job_delivery_registry TO ${worker}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${JOB_RUNTIME_SCHEMA}.job_effect_ledger TO ${worker}`,
    `GRANT SELECT, INSERT, UPDATE ON ${JOB_RUNTIME_SCHEMA}.job_operator_actions TO ${worker}`,
    `GRANT SELECT ON runtime_control.ownership_epochs TO ${worker}`,
  ];
}

async function applyLeastPrivilegeGrants(pool, roles = DEFAULT_ROLES) {
  await requireRoles(pool, roles);
  for (const statement of grantStatements(roles)) await pool.query(statement);
}

async function verifyJobRuntimePrivileges(pool) {
  const result = await pool.query(`SELECT
    has_schema_privilege(current_user, $1, 'USAGE') AS graphile_usage,
    has_schema_privilege(current_user, $2, 'USAGE') AS registry_usage,
    has_table_privilege(current_user, $3, 'SELECT,UPDATE,DELETE') AS registry_access,
    has_table_privilege(current_user, $4, 'SELECT,INSERT,UPDATE,DELETE') AS effect_access,
    has_table_privilege(current_user, $5, 'SELECT,INSERT,UPDATE') AS operator_action_access,
    has_table_privilege(current_user, $6, 'SELECT') AS ownership_epoch_access`, [
    GRAPHILE_WORKER_SCHEMA,
    JOB_RUNTIME_SCHEMA,
    `${JOB_RUNTIME_SCHEMA}.job_delivery_registry`,
    `${JOB_RUNTIME_SCHEMA}.job_effect_ledger`,
    `${JOB_RUNTIME_SCHEMA}.job_operator_actions`,
    'runtime_control.ownership_epochs',
  ]);
  const privileges = result.rows[0];
  if (!privileges?.graphile_usage || !privileges?.registry_usage || !privileges?.registry_access || !privileges?.effect_access || !privileges?.operator_action_access || !privileges?.ownership_epoch_access) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'insufficient_database_privilege' } });
  }
  return true;
}

module.exports = {
  DEFAULT_ROLES,
  applyLeastPrivilegeGrants,
  grantStatements,
  quoteIdentifier,
  requireRoles,
  verifyJobRuntimePrivileges,
};
