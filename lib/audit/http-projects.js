const {
  createAuditApiServer: createBaseAuditApiServer,
  getRequestContext,
  createIntakeDraftFromWebhook,
} = require('./http');
const { createAutonomousDeliveryMetricsRouteWrapper } = require('./autonomous-delivery-http');
const { createForgeExecutionReadinessRouteWrapper } = require('./forge-execution-http');
const { createLiveTaskUpdatesRouteWrapper } = require('./live-task-updates-http');
const { createProjectRouteWrapper } = require('./projects-http');
const { createGitHubWebhookRouteWrapper } = require('./github-webhook-http');
const { createGitLabWebhookRouteWrapper } = require('./gitlab-webhook-http');

function createAuditApiServer(options = {}) {
  return createGitLabWebhookRouteWrapper(
    createGitHubWebhookRouteWrapper(
    createAutonomousDeliveryMetricsRouteWrapper(
      createLiveTaskUpdatesRouteWrapper(
        createForgeExecutionReadinessRouteWrapper(
          createProjectRouteWrapper(createBaseAuditApiServer(options), options, { getRequestContext }),
          options,
          { getRequestContext },
        ),
        options,
        { getRequestContext },
      ),
      options,
      { getRequestContext },
    ),
    options,
    { getRequestContext, createIntakeDraftFromWebhook },
    ),
    options,
    { getRequestContext, createIntakeDraftFromWebhook },
  );
}

module.exports = {
  createAuditApiServer,
  getRequestContext,
  createIntakeDraftFromWebhook,
};
