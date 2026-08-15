'use strict';

const os = require('node:os');

function cpuSnapshot() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function cpuUtilizationPercent(before, after) {
  let busy = 0;
  let total = 0;
  for (let index = 0; index < before.length; index += 1) {
    for (const key of Object.keys(before[index])) {
      const delta = after[index][key] - before[index][key];
      total += delta;
      if (key !== 'idle') busy += delta;
    }
  }
  return total > 0 ? (busy / total) * 100 : 100;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sampleCpuUtilization(sampleIntervalMs, options = {}) {
  const snapshot = options.snapshot || cpuSnapshot;
  const wait = options.delay || delay;
  const before = snapshot();
  await wait(sampleIntervalMs);
  return cpuUtilizationPercent(before, snapshot());
}

function positiveNumber(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function performanceHostConfig(env = process.env) {
  return {
    maxCpuPercent: positiveNumber(env.PERFORMANCE_HOST_MAX_CPU_PERCENT, 25, 'PERFORMANCE_HOST_MAX_CPU_PERCENT'),
    stableSamples: Math.ceil(positiveNumber(env.PERFORMANCE_HOST_STABLE_SAMPLES, 5, 'PERFORMANCE_HOST_STABLE_SAMPLES')),
    timeoutMs: positiveNumber(env.PERFORMANCE_HOST_WAIT_TIMEOUT_MS, 600_000, 'PERFORMANCE_HOST_WAIT_TIMEOUT_MS'),
    sampleIntervalMs: positiveNumber(env.PERFORMANCE_HOST_SAMPLE_INTERVAL_MS, 1_000, 'PERFORMANCE_HOST_SAMPLE_INTERVAL_MS'),
  };
}

async function waitForPerformanceHost(config = performanceHostConfig(), options = {}) {
  const readUtilization = options.readUtilization || (() => sampleCpuUtilization(config.sampleIntervalMs));
  const report = options.report || ((evidence) => process.stdout.write(`${JSON.stringify(evidence)}\n`));
  const maxSamples = Math.max(1, Math.ceil(config.timeoutMs / config.sampleIntervalMs));
  let consecutiveStable = 0;

  for (let sample = 1; sample <= maxSamples; sample += 1) {
    const cpuPercent = await readUtilization();
    consecutiveStable = cpuPercent <= config.maxCpuPercent ? consecutiveStable + 1 : 0;
    report({
      event: 'performance_host_sample',
      sample,
      cpuPercent: Number(cpuPercent.toFixed(2)),
      maxCpuPercent: config.maxCpuPercent,
      consecutiveStable,
      requiredStable: config.stableSamples,
    });
    if (consecutiveStable >= config.stableSamples) return;
  }

  throw new Error(
    `performance host did not remain below ${config.maxCpuPercent}% CPU for ${config.stableSamples} samples within ${config.timeoutMs}ms`,
  );
}

if (require.main === module) {
  waitForPerformanceHost().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  cpuUtilizationPercent,
  performanceHostConfig,
  sampleCpuUtilization,
  waitForPerformanceHost,
};
