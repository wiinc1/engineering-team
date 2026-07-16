const {
  createAuditApiServer: createBaseAuditApiServer,
  getRequestContext,
  createIntakeDraftFromWebhook,
} = require('./http');
const { createAutonomousDeliveryMetricsRouteWrapper } = require('./autonomous-delivery-http');
const { createFactoryQueueRouteWrapper } = require('./factory-queue-http');
const { createForgeExecutionReadinessRouteWrapper } = require('./forge-execution-http');
const { createLiveTaskUpdatesRouteWrapper } = require('./live-task-updates-http');
const { createProjectRouteWrapper } = require('./projects-http');
const { createReleaseHealthRouteWrapper } = require('./release-health-http');
const { createGitHubWebhookRouteWrapper } = require('./github-webhook-http');
const { createGitLabWebhookRouteWrapper } = require('./gitlab-webhook-http');
const { preparePostgresHttpConsistency } = require('./postgres-http-consistency');
const { createLangGraphRouteWrapper } = require('../software-factory/langgraph/http-wrapper');

function createAuditApiServer(options = {}) {
  const consistency = preparePostgresHttpConsistency(options);
  const result = createLangGraphRouteWrapper(createReleaseHealthRouteWrapper(
    createGitLabWebhookRouteWrapper(
      createGitHubWebhookRouteWrapper(
        createAutonomousDeliveryMetricsRouteWrapper(
          createFactoryQueueRouteWrapper(
            createLiveTaskUpdatesRouteWrapper(
              createForgeExecutionReadinessRouteWrapper(
                createProjectRouteWrapper(createBaseAuditApiServer(consistency.options), options, { getRequestContext }),
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
          { getRequestContext },
        ),
        options,
        { getRequestContext, createIntakeDraftFromWebhook },
      ),
      options,
      { getRequestContext, createIntakeDraftFromWebhook },
    ),
    options,
    { getRequestContext, createIntakeDraftFromWebhook },
  ), options, { getRequestContext });
  return consistency.bind(result);
}

module.exports = {
  createAuditApiServer,
  getRequestContext,
  createIntakeDraftFromWebhook,
};
