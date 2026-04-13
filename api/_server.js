const { createAuditApiServer } = require('../lib/audit/http');
const { assertAuditBackendConfiguration } = require('../lib/audit/config');

let cachedServer = null;

function createVercelLogger() {
  function write(level, payload) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      ...payload,
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  }

  return {
    info(payload) {
      write('info', payload);
    },
    error(payload) {
      write('error', payload);
    },
    logPath: 'stderr/stdout',
  };
}

function getServer() {
  if (cachedServer) return cachedServer;

  const { backend, connectionString } = assertAuditBackendConfiguration({
    runtimeEnv: 'production',
  });

  const { server } = createAuditApiServer({
    baseDir: process.cwd(),
    backend,
    connectionString,
    allowLegacyHeaders: process.env.ALLOW_LEGACY_HEADERS === 'true',
    jwtSecret: process.env.AUTH_JWT_SECRET,
    jwtIssuer: process.env.AUTH_JWT_ISSUER,
    jwtAudience: process.env.AUTH_JWT_AUDIENCE,
    browserAuthCodeSecret: process.env.AUTH_BROWSER_AUTH_CODE_SECRET,
    browserAuthCodeIssuer: process.env.AUTH_BROWSER_AUTH_CODE_ISSUER,
    browserAuthCodeAudience: process.env.AUTH_BROWSER_AUTH_CODE_AUDIENCE,
    logger: createVercelLogger(),
  });

  cachedServer = server;
  return cachedServer;
}

function handleRequest(req, res) {
  const server = getServer();
  server.emit('request', req, res);
}

module.exports = {
  handleRequest,
};
