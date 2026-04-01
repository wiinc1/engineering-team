const { pushMetrics } = require('../monitoring/pushgateway');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createProjectionWorker(store, options = {}) {
  const batchSize = options.batchSize || 100;
  return {
    async runOnce() {
      if (!store.processProjectionQueue) throw new Error('store does not support async projection queue processing');
      return store.processProjectionQueue(batchSize);
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
        if (pushgateway) {
          await pushMetrics({ endpoint: pushgateway.endpoint, job: pushgateway.job || name, instance: pushgateway.instance || process.pid, metrics: { [`${name}_last_processed`]: result.processed || 0 } });
        }
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
};
