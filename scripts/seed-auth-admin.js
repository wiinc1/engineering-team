#!/usr/bin/env node
const crypto = require('node:crypto');
const { createPgPoolFromEnv } = require('../lib/audit');
const {
  createMagicLinkAuthService,
  normalizeEmail,
  normalizeRoles,
} = require('../lib/auth/magic-link');

const DEFAULT_ADMIN_TENANT_ID = 'tenant-int';
const DEFAULT_ADMIN_ROLES = 'admin,pm';
const DEFAULT_ADMIN_STATUS = 'active';
const DEFAULT_OPERATOR_ACTOR_ID = 'production-auth-operator';
const REQUIRED_ENV = ['DATABASE_URL', 'AUTH_ADMIN_EMAIL', 'AUTH_ADMIN_ACTOR_ID'];

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: hasFlag(argv, '--apply'),
    help: hasFlag(argv, '--help') || hasFlag(argv, '-h'),
  };
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function normalizeStatus(value = DEFAULT_ADMIN_STATUS) {
  const status = String(value || DEFAULT_ADMIN_STATUS).trim().toLowerCase();
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('AUTH_ADMIN_STATUS must be active or disabled.');
  }
  return status;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readAdminRoles(env = process.env) {
  const errors = [];
  let roles = [];
  try {
    roles = normalizeRoles(env.AUTH_ADMIN_ROLES || DEFAULT_ADMIN_ROLES);
  } catch (error) {
    errors.push(error.message);
  }
  if (roles.length && !roles.includes('admin')) {
    errors.push('AUTH_ADMIN_ROLES must include admin for the first production magic-link administrator.');
  }
  return { roles, errors };
}

function readAdminStatus(env = process.env) {
  try {
    return { status: normalizeStatus(env.AUTH_ADMIN_STATUS || DEFAULT_ADMIN_STATUS), errors: [] };
  } catch (error) {
    return { status: DEFAULT_ADMIN_STATUS, errors: [error.message] };
  }
}

function readAdminSeedInput(env = process.env) {
  const missing = REQUIRED_ENV.filter(name => !String(env[name] || '').trim());
  const errors = [];
  if (missing.length) {
    errors.push(`Missing required variables: ${missing.join(', ')}`);
  }

  const email = normalizeEmail(env.AUTH_ADMIN_EMAIL);
  if (email && !isValidEmail(email)) {
    errors.push('AUTH_ADMIN_EMAIL must be a valid email address.');
  }

  const { roles, errors: roleErrors } = readAdminRoles(env);
  const { status, errors: statusErrors } = readAdminStatus(env);
  errors.push(...roleErrors, ...statusErrors);

  const tenantId = String(env.AUTH_ADMIN_TENANT_ID || DEFAULT_ADMIN_TENANT_ID).trim();
  const actorId = String(env.AUTH_ADMIN_ACTOR_ID || '').trim();
  if (!tenantId) errors.push('AUTH_ADMIN_TENANT_ID must not be empty.');
  if (!actorId && !missing.includes('AUTH_ADMIN_ACTOR_ID')) {
    errors.push('AUTH_ADMIN_ACTOR_ID must not be empty.');
  }

  const operatorTenantId = String(env.AUTH_SEED_OPERATOR_TENANT_ID || tenantId).trim();
  const operatorActorId = String(env.AUTH_SEED_OPERATOR_ACTOR_ID || DEFAULT_OPERATOR_ACTOR_ID).trim();

  return {
    ok: errors.length === 0,
    missing,
    errors,
    databaseUrl: env.DATABASE_URL || '',
    user: {
      email,
      tenantId,
      actorId,
      roles,
      status,
      userId: String(env.AUTH_ADMIN_USER_ID || '').trim() || undefined,
    },
    operator: {
      tenantId: operatorTenantId,
      actorId: operatorActorId,
    },
  };
}

function redactedSeedPlan(input, options = {}) {
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    writesDatabase: Boolean(options.apply),
    databaseConfigured: Boolean(input.databaseUrl),
    user: {
      userId: input.user.userId || null,
      emailHash: input.user.email ? `sha256:${stableHash(input.user.email)}` : null,
      tenantId: input.user.tenantId,
      actorId: input.user.actorId,
      roles: input.user.roles,
      status: input.user.status,
    },
    operator: {
      tenantId: input.operator.tenantId,
      actorId: input.operator.actorId,
    },
  };
}

function buildAdminSeedPlan(env = process.env, argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const input = readAdminSeedInput(env);
  return {
    ok: input.ok,
    missing: input.missing,
    errors: input.errors,
    options,
    input,
    redactedPlan: redactedSeedPlan(input, options),
  };
}

async function applyAdminSeed(input, dependencies = {}) {
  const poolFactory = dependencies.poolFactory || createPgPoolFromEnv;
  const serviceFactory = dependencies.serviceFactory || createMagicLinkAuthService;
  const pool = poolFactory(input.databaseUrl);
  try {
    const service = serviceFactory({ pool });
    const user = await service.upsertUser(input.user, input.operator);
    return {
      user,
      redactedResult: {
        userId: user.userId,
        emailHash: `sha256:${stableHash(user.email)}`,
        tenantId: user.tenantId,
        actorId: user.actorId,
        roles: user.roles,
        status: user.status,
        updatedAt: user.updatedAt,
      },
    };
  } finally {
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  }
}

function printHelp(stdout = process.stdout) {
  stdout.write(`Usage: npm run auth:admin:seed -- [--apply]

Seeds or updates the first production magic-link admin user.

Required env:
  DATABASE_URL
  AUTH_ADMIN_EMAIL
  AUTH_ADMIN_ACTOR_ID

Optional env:
  AUTH_ADMIN_TENANT_ID        default: ${DEFAULT_ADMIN_TENANT_ID}
  AUTH_ADMIN_ROLES            default: ${DEFAULT_ADMIN_ROLES}
  AUTH_ADMIN_STATUS           default: ${DEFAULT_ADMIN_STATUS}
  AUTH_ADMIN_USER_ID          optional stable user_id
  AUTH_SEED_OPERATOR_ACTOR_ID default: ${DEFAULT_OPERATOR_ACTOR_ID}
  AUTH_SEED_OPERATOR_TENANT_ID default: AUTH_ADMIN_TENANT_ID

Default mode is dry-run. Add --apply to write to auth_users.
`);
}

async function runCli(dependencies = {}) {
  const env = dependencies.env || process.env;
  const argv = dependencies.argv || process.argv.slice(2);
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const plan = buildAdminSeedPlan(env, argv);

  if (plan.options.help) {
    printHelp(stdout);
    return 0;
  }

  if (!plan.ok) {
    stderr.write('Auth admin seed validation failed.\n');
    for (const error of plan.errors) {
      stderr.write(`${error}\n`);
    }
    return 1;
  }

  stdout.write(`${JSON.stringify(plan.redactedPlan, null, 2)}\n`);
  if (!plan.options.apply) {
    stdout.write('Dry-run only. Re-run with --apply to write this admin user.\n');
    return 0;
  }

  const result = await applyAdminSeed(plan.input, dependencies);
  stdout.write(`${JSON.stringify({ applied: true, user: result.redactedResult }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  runCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write(`Failed to seed auth admin user: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ADMIN_ROLES,
  DEFAULT_ADMIN_STATUS,
  DEFAULT_ADMIN_TENANT_ID,
  REQUIRED_ENV,
  applyAdminSeed,
  buildAdminSeedPlan,
  isValidEmail,
  normalizeStatus,
  parseArgs,
  readAdminRoles,
  readAdminSeedInput,
  readAdminStatus,
  redactedSeedPlan,
  runCli,
  stableHash,
};
