'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { Logger, makeWorkerUtils, parseCronItems, run } = require('graphile-worker');
const { JobRuntimeError } = require('./errors');
const { ensurePoolErrorHandler } = require('./pool');

function graphileLogger(jobLogger, LoggerClass = Logger) {
  return new LoggerClass((scope) => (level) => {
    const fields = {
      level,
      scope: scope.label || 'graphile_worker',
      worker_id: scope.workerId,
      task_identifier: scope.taskIdentifier,
      graphile_job_id: scope.jobId,
    };
    if (level === 'error' || level === 'warning') jobLogger.error('graphile_library_event', fields);
    else jobLogger.info('graphile_library_event', fields);
  });
}

function fairWorkerPlans(taskList, concurrency, cronItems) {
  const identifiers = Object.keys(taskList);
  if (!identifiers.length) return [];
  return [Object.freeze({
    name: 'shared-fair-queues',
    concurrency,
    taskList,
    cronItems,
    classConcurrency: Object.freeze({ factory: 1, projection: 1, outbox: 1, maintenance: 1 }),
  })];
}

class GraphileAdapter {
  constructor(options) {
    if (!options.pool) throw new JobRuntimeError('job_runtime_unavailable');
    ensurePoolErrorHandler(options.pool, options.logger, options.metrics || { increment() {} });
    this.workerApi = options.workerApi || { makeWorkerUtils, parseCronItems, run };
    this.shared = Object.freeze({
      pgPool: options.pool,
      schema: options.schema,
      logger: graphileLogger(options.logger, options.workerApi?.Logger || Logger),
    });
    this.utilsPromise = null;
  }

  utilities() {
    if (!this.utilsPromise) this.utilsPromise = this.workerApi.makeWorkerUtils(this.shared);
    return this.utilsPromise;
  }

  async migrate() {
    const utils = await this.utilities();
    await utils.migrate();
  }

  async addJob(definition, envelope, schedule, semanticKey) {
    const utils = await this.utilities();
    return utils.addJob(definition.identifier, envelope, {
      ...schedule,
      jobKey: semanticKey,
      jobKeyMode: 'unsafe_dedupe',
    });
  }

  async compensate(jobId) {
    const utils = await this.utilities();
    await utils.completeJobs([String(jobId)]);
  }

  async retry(jobId, { runAt = new Date() } = {}) {
    const utils = await this.utilities();
    const jobs = await utils.rescheduleJobs([String(jobId)], { runAt, attempts: 0 });
    if (jobs.length !== 1) throw new JobRuntimeError('job_action_conflict');
    return jobs[0];
  }

  async cancel(jobId) {
    const utils = await this.utilities();
    const jobs = await utils.completeJobs([String(jobId)]);
    if (jobs.length !== 1) throw new JobRuntimeError('job_action_conflict');
    return jobs[0];
  }

  async schemaFingerprint() {
    const result = await this.shared.pgPool.query(`SELECT c.relkind, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 ORDER BY c.relkind, c.relname`, [this.shared.schema]);
    return crypto.createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
  }

  async start(taskList, config, eventEmitter = new EventEmitter(), cronItems = []) {
    if (!config.claimsEnabled) return null;
    const plans = fairWorkerPlans(taskList, config.concurrency, cronItems);
    if (!plans.length) throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'task_list_empty' } });
    const runners = await Promise.all(plans.map((plan) => this.workerApi.run({
      ...this.shared,
      taskList: plan.taskList,
      events: eventEmitter,
      concurrency: plan.concurrency,
      pollInterval: config.pollIntervalMs,
      gracefulShutdownAbortTimeout: Math.min(5_000, config.shutdownDeadlineMs - 100),
      noHandleSignals: true,
      parsedCronItems: (this.workerApi.parseCronItems || ((items) => items))(plan.cronItems),
    })));
    return Object.freeze({
      events: eventEmitter,
      promise: Promise.all(runners.map((runner) => runner.promise)),
      stop: (reason) => Promise.all(runners.map((runner) => runner.stop(reason))),
      kill: (reason) => Promise.all(runners.map((runner) => runner.kill(reason))),
    });
  }

  async close() {
    if (!this.utilsPromise) return;
    const utils = await this.utilsPromise;
    await utils.release();
  }
}

function createGraphileAdapter(options) {
  return new GraphileAdapter(options);
}

module.exports = {
  createGraphileAdapter,
  GraphileAdapter,
  fairWorkerPlans,
  graphileLogger,
};
