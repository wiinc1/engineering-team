const { pushMetrics } = require('../monitoring/pushgateway');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createProjectionWorker(store, options = {}) {
  const batchSize = options.batchSize || 100;
  return {
    async runOnce() {
      if (!store.processProjectionQueue) throw new Error('store does not support async projection queue processing');
      const result = await store.processProjectionQueue(batchSize);
      if (typeof store.processExpiredSreMonitoring === 'function') {
        const expiryResult = await store.processExpiredSreMonitoring(batchSize);
        return {
          processed: (result.processed || 0) + (expiryResult.processed || 0),
          failed: (result.failed || 0) + (expiryResult.failed || 0),
          expiredProcessed: expiryResult.processed || 0,
        };
      }
      return result;
    },
  };
}

function createOutboxWorker(store, publisher, options = {}) {
  const batchSize = options.batchSize || 100;
  return {
    async runOnce() {
      if (!store.processOutbox) throw new Error('store does not support outbox processing');
      return store.processOutbox(publisher, batchSize);
    },
  };
}

function workerPushMetrics(pushgateway, name, result, options = {}) {
  if (!pushgateway) return Promise.resolve({ skipped: true });
  const metrics = {
    [`${name}_last_processed`]: result.processed || 0,
    [`${name}_last_failed`]: result.failed || 0,
  };
  if (typeof options.metricsProvider === 'function') {
    const snapshot = options.metricsProvider() || {};
    if (typeof snapshot.workflow_projection_lag_seconds === 'number') {
      metrics.workflow_projection_lag_seconds = snapshot.workflow_projection_lag_seconds;
    }
    if (typeof snapshot.workflow_projection_events_processed_total === 'number') {
      metrics.workflow_projection_events_processed_total = snapshot.workflow_projection_events_processed_total;
    }
    if (typeof snapshot.workflow_outbox_events_published_total === 'number') {
      metrics.workflow_outbox_events_published_total = snapshot.workflow_outbox_events_published_total;
    }
    if (typeof snapshot.workflow_projection_failures_total === 'number') {
      metrics.workflow_projection_failures_total = snapshot.workflow_projection_failures_total;
    }
    if (typeof snapshot.workflow_outbox_publish_failures_total === 'number') {
      metrics.workflow_outbox_publish_failures_total = snapshot.workflow_outbox_publish_failures_total;
    }
  }
  return pushMetrics({
    endpoint: pushgateway.endpoint,
    job: pushgateway.job || name,
    instance: pushgateway.instance || process.pid,
    metrics,
  });
}

function createSupervisedWorker(name, runner, options = {}) {
  const intervalMs = Number(options.intervalMs || 5000);
  const idleSleepMs = Number(options.idleSleepMs || intervalMs);
  const failureSleepMs = Number(options.failureSleepMs || Math.max(1000, intervalMs));
  const pushgateway = options.pushgateway;
  let stopping = false;

  async function loop() {
    while (!stopping) {
      try {
        const result = await runner();
        await workerPushMetrics(pushgateway, name, result, options);
        await sleep((result.processed || 0) > 0 ? intervalMs : idleSleepMs);
      } catch (error) {
        if (options.onError) options.onError(error);
        await sleep(failureSleepMs);
      }
    }
  }

  return {
    async start() { await loop(); },
    stop() { stopping = true; },
  };
}

module.exports = {
  createProjectionWorker,
  createOutboxWorker,
  createSupervisedWorker,
  workerPushMetrics,
};
