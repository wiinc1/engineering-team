const { createAuditApiServer: createBaseAuditApiServer, getRequestContext } = require('./http');
const { createProjectRouteWrapper } = require('./projects-http');

function createAuditApiServer(options = {}) {
  return createProjectRouteWrapper(createBaseAuditApiServer(options), options, { getRequestContext });
}

module.exports = {
  createAuditApiServer,
  getRequestContext,
};
