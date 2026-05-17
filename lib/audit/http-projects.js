const { createAuditApiServer: createBaseAuditApiServer, getRequestContext } = require('./http');
const { createAutonomousDeliveryMetricsRouteWrapper } = require('./autonomous-delivery-http');
const { createLiveTaskUpdatesRouteWrapper } = require('./live-task-updates-http');
const { createProjectRouteWrapper } = require('./projects-http');

function createAuditApiServer(options = {}) {
  return createAutonomousDeliveryMetricsRouteWrapper(
    createLiveTaskUpdatesRouteWrapper(
      createProjectRouteWrapper(createBaseAuditApiServer(options), options, { getRequestContext }),
      options,
      { getRequestContext },
    ),
    options,
    { getRequestContext }
  );
}

module.exports = {
  createAuditApiServer,
  getRequestContext,
};
