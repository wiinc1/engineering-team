'use strict';

const { EventEmitter } = require('node:events');
const { JOB_RUNTIME_CATALOG_VERSION } = require('./constants');
const { JobRuntimeError, sanitizedError } = require('./errors');

function poolSummary(pool) {
  return Object.freeze({
    max: Number(pool.options?.max || 0),
    total: Number(pool.totalCount || 0),
    idle: Number(pool.idleCount || 0),
    waiting: Number(pool.waitingCount || 0),
  });
}

function attachWorkerEvents(events, options) {
  events.on('pool:listen:error', () => {
    options.metrics.increment('job_runtime_network_error_total');
    options.logger.error('worker_listen_error');
  });
  events.on('pool:fatalError', () => {
    options.metrics.increment('job_runtime_worker_fatal_total');
    options.logger.error('worker_fatal_error');
  });
  events.on('pool:gracefulShutdown', () => {
    options.metrics.increment('job_runtime_shutdown_total', { mode: 'graceful' });
  });
  events.on('pool:forcefulShutdown', () => {
    options.metrics.increment('job_runtime_shutdown_total', { mode: 'forceful' });
  });
}

class JobRuntime {
  constructor(options) {
    this.options = { ...options, clock: options.clock || { now: Date.now } };
    this.state = 'new';
    this.runner = null;
    this.signalHandlers = null;
    this.events = options.events || new EventEmitter();
    attachWorkerEvents(this.events, options);
  }

  async start() {
    if (this.state === 'ready' || this.state === 'standby') return this.health();
    if (this.state !== 'new' && this.state !== 'stopped') throw new JobRuntimeError('job_runtime_unavailable');
    this.state = 'starting';
    try {
      await this.options.adapter.migrate();
      await this.options.registry.verifySchema();
      await this.options.verifyPrivileges();
      this.runner = await this.options.adapter.start(
        this.options.taskList, this.options.config, this.events, this.options.cronItems || [],
      );
      this.state = this.runner ? 'ready' : 'standby';
      if (this.runner) this.runner.promise.catch((error) => this.failRuntime(error));
      this.options.logger.info('job_runtime_started', { state: this.state, claims_enabled: this.options.config.claimsEnabled });
      return this.health();
    } catch (error) {
      this.state = 'failed';
      this.options.logger.error('job_runtime_start_failed', { error: sanitizedError(error) });
      throw new JobRuntimeError('job_runtime_unavailable', { cause: error });
    }
  }

  failRuntime(error) {
    if (this.state === 'draining' || this.state === 'stopped') return;
    this.state = 'failed';
    this.options.metrics.increment('job_runtime_worker_fatal_total');
    this.options.logger.error('job_runtime_stopped_unexpectedly', { error: sanitizedError(error) });
  }

  async databaseReady() {
    try {
      await this.options.pool.query('SELECT 1');
      await this.options.registry.verifySchema();
      return true;
    } catch {
      return false;
    }
  }

  async recordOperationalMetrics() {
    const pool = poolSummary(this.options.pool);
    this.options.metrics.gauge?.('job_runtime_pool_total_connections', pool.total);
    this.options.metrics.gauge?.('job_runtime_pool_idle_connections', pool.idle);
    this.options.metrics.gauge?.('job_runtime_pool_waiting_requests', pool.waiting);
    this.options.metrics.gauge?.('job_runtime_claims_enabled', this.options.config.claimsEnabled ? 1 : 0);
    this.options.metrics.gauge?.('job_runtime_accepting_claims', this.state === 'ready' ? 1 : 0);
    const queue = await this.options.registry.operationalMetrics();
    this.options.metrics.gauge?.('job_runtime_queue_depth', queue.queueDepth);
    this.options.metrics.gauge?.('job_runtime_queue_oldest_age_seconds', queue.oldestAgeSeconds);
    for (const item of queue.queues || []) {
      const labels = { queue: item.queue };
      this.options.metrics.gauge?.('job_runtime_named_queue_depth', item.queueDepth, labels);
      this.options.metrics.gauge?.('job_runtime_queue_starvation_seconds', item.oldestAgeSeconds, labels);
    }
  }

  async health() {
    const database = await this.databaseReady();
    if (database) await this.recordOperationalMetrics().catch(() => {});
    const acceptingClaims = this.state === 'ready' && this.options.config.claimsEnabled;
    return Object.freeze({
      status: database && !['failed', 'new'].includes(this.state) ? 'ok' : 'degraded',
      state: this.state,
      database,
      claimsEnabled: this.options.config.claimsEnabled,
      acceptingClaims,
      catalogVersion: JOB_RUNTIME_CATALOG_VERSION,
      pool: poolSummary(this.options.pool),
    });
  }

  async readiness() {
    const current = await this.health();
    return Object.freeze({
      ready: current.database && ['ready', 'standby'].includes(this.state),
      draining: this.state === 'draining',
      state: this.state,
      claimsEnabled: current.claimsEnabled,
      acceptingClaims: current.acceptingClaims,
    });
  }

  async drain(reason = 'shutdown') {
    if (this.state === 'stopped') return this.readiness();
    this.state = 'draining';
    this.options.logger.info('job_runtime_draining', { reason });
    const stopPromise = this.runner ? this.runner.stop(reason) : Promise.resolve();
    let timeoutId;
    let drainError;
    const deadline = new Promise((resolve) => {
      timeoutId = this.options.timers.setTimeout(() => resolve('deadline'), this.options.config.shutdownDeadlineMs);
    });
    let outcome;
    try {
      outcome = await Promise.race([stopPromise.then(() => 'stopped'), deadline]);
    } catch (error) {
      outcome = 'stop_failed';
      drainError = error;
    }
    this.options.timers.clearTimeout?.(timeoutId);
    if (outcome === 'deadline') this.options.metrics.increment('job_runtime_shutdown_deadline_total');
    if (outcome !== 'stopped' && this.runner) {
      try { await this.runner.kill('shutdown did not complete'); } catch (error) { drainError ||= error; }
      try {
        await this.options.registry.markRunningForRedelivery('job_runtime_unavailable');
      } catch (error) {
        drainError ||= error;
      }
    }
    try { await this.options.adapter.close(); } catch (error) { drainError ||= error; }
    this.removeSignalHandlers();
    this.state = drainError ? 'failed' : 'stopped';
    if (drainError) {
      this.options.logger.error('job_runtime_shutdown_failed', { outcome, error: sanitizedError(drainError) });
      throw new JobRuntimeError('job_runtime_unavailable', { cause: drainError });
    }
    this.options.logger.info('job_runtime_stopped', { outcome });
    return this.readiness();
  }

  installSignalHandlers(processTarget = process) {
    if (this.signalHandlers) return;
    this.signalHandlers = Object.fromEntries(['SIGTERM', 'SIGINT'].map((signal) => {
      const handler = () => { this.drain(signal).catch((error) => this.failRuntime(error)); };
      processTarget.once(signal, handler);
      return [signal, { handler, processTarget }];
    }));
  }

  removeSignalHandlers() {
    if (!this.signalHandlers) return;
    for (const [signal, binding] of Object.entries(this.signalHandlers)) {
      binding.processTarget.removeListener(signal, binding.handler);
    }
    this.signalHandlers = null;
  }
}

function createJobRuntime(options) {
  return new JobRuntime(options);
}

module.exports = {
  attachWorkerEvents,
  createJobRuntime,
  JobRuntime,
  poolSummary,
};
