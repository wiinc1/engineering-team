const fs = require('node:fs');
const path = require('node:path');
const { createAuditApiServer } = require('../audit/http-projects');

const DEFAULT_PERSIST_DIR = 'observability/golden-path-local-stack/audit-data';
const DEFAULT_JWT_SECRET = 'golden-path-local-secret';

function resolvePersistDir(options = {}) {
  const raw = options.persistDir
    || process.env.GOLDEN_PATH_PERSIST_DIR
    || DEFAULT_PERSIST_DIR;
  return path.resolve(process.cwd(), raw);
}

function configureLocalEnv({ persistDir, jwtSecret = DEFAULT_JWT_SECRET, forgeServiceToken } = {}) {
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  process.env.FF_WORKFLOW_ENGINE = 'true';
  process.env.FORGE_SERVICE_TOKEN = forgeServiceToken
    || process.env.FORGE_SERVICE_TOKEN
    || 'local-forge-smoke-token';
  fs.mkdirSync(persistDir, { recursive: true });
  return jwtSecret;
}

async function startLocalAuditApi(options = {}) {
  const persistDir = resolvePersistDir(options);
  const jwtSecret = options.jwtSecret || process.env.AUTH_JWT_SECRET || DEFAULT_JWT_SECRET;
  configureLocalEnv({ persistDir, jwtSecret });

  const { server } = createAuditApiServer({
    baseDir: persistDir,
    jwtSecret,
    pmRefinementDelegateWork: options.pmRefinementDelegateWork,
    specialistDelegationEnabled: options.specialistDelegationEnabled,
  });

  const host = options.host || '127.0.0.1';
  const requestedPort = Number(options.port) || 0;
  await new Promise((resolve, reject) => {
    server.listen(requestedPort, host, (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  return {
    server,
    baseUrl: `http://${host}:${port}`,
    jwtSecret,
    persistDir,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function withLocalAuditApi(run, options = {}) {
  const stack = await startLocalAuditApi(options);
  try {
    return await run({
      baseUrl: stack.baseUrl,
      jwtSecret: stack.jwtSecret,
      localBaseDir: stack.persistDir,
      persistDir: stack.persistDir,
    });
  } finally {
    await stack.close();
  }
}

module.exports = {
  DEFAULT_PERSIST_DIR,
  DEFAULT_JWT_SECRET,
  resolvePersistDir,
  configureLocalEnv,
  startLocalAuditApi,
  withLocalAuditApi,
};