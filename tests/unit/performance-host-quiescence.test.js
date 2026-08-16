'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  cpuUtilizationPercent,
  performanceHostConfig,
  waitForPerformanceHost,
} = require('../../scripts/wait-for-performance-host');

test('CPU utilization excludes idle time across every logical core', () => {
  const before = [
    { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 },
    { user: 20, nice: 0, sys: 10, idle: 70, irq: 0 },
  ];
  const after = [
    { user: 20, nice: 0, sys: 20, idle: 160, irq: 0 },
    { user: 30, nice: 0, sys: 20, idle: 150, irq: 0 },
  ];

  assert.equal(cpuUtilizationPercent(before, after), 20);
});

test('performance host gate requires consecutive stable samples', async () => {
  const samples = [10, 30, 20, 15, 12];
  const reports = [];
  await waitForPerformanceHost({
    maxCpuPercent: 25,
    stableSamples: 3,
    timeoutMs: 5_000,
    sampleIntervalMs: 1_000,
  }, {
    readUtilization: async () => samples.shift(),
    report: (sample) => reports.push(sample),
  });

  assert.equal(reports.length, 5);
  assert.equal(reports.at(-1).consecutiveStable, 3);
});

test('performance host gate fails closed when the runner stays busy', async () => {
  await assert.rejects(
    waitForPerformanceHost({
      maxCpuPercent: 25,
      stableSamples: 2,
      timeoutMs: 3_000,
      sampleIntervalMs: 1_000,
    }, {
      readUtilization: async () => 75,
      report: () => undefined,
    }),
    /did not remain below 25% CPU/,
  );
});

test('performance host defaults are explicit and configurable', () => {
  assert.deepEqual(performanceHostConfig({}), {
    maxCpuPercent: 25,
    stableSamples: 5,
    timeoutMs: 600_000,
    sampleIntervalMs: 1_000,
  });
  assert.equal(performanceHostConfig({ PERFORMANCE_HOST_MAX_CPU_PERCENT: '15' }).maxCpuPercent, 15);
});
