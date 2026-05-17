const { createAuditApiServer: createBaseAuditApiServer, getRequestContext } = require('./http');
const { createAutonomousDeliveryMetricsRouteWrapper } = require('./autonomous-delivery-http');
const { createProjectRouteWrapper } = require('./projects-http');

function createAuditApiServer(options = {}) {
  return createAutonomousDeliveryMetricsRouteWrapper(
    createProjectRouteWrapper(createBaseAuditApiServer(options), options, { getRequestContext }),
    options,
    { getRequestContext }
  );
}

module.exports = {
  createAuditApiServer,
  getRequestContext,
};
