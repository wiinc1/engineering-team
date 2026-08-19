'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { compileFactoryGraph, validateFactoryState } = require('../../lib/software-factory/langgraph');
const { evaluateArtifact, maximum } = require('../../scripts/run-langgraph-load');
const { state } = require('../fixtures/langgraph/v1');

function percentile(samples, value) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

test('load artifact aggregation handles samples larger than the JavaScript argument stack', () => {
  const samples = Array.from({ length: 250_000 }, (_, index) => index % 10_000);
  assert.equal(maximum(samples), 9_999);
});

test('load evidence requires observing the configured pool budget under concurrency', () => {
  const artifact = {
    failures: 0, checkpointWrites: { p95Ms: 1 }, checkpointReads: { p95Ms: 1 },
    status: { p95Ms: 1 }, resume: { p95Ms: 1 }, graphOverheadPercent: 1,
    duplicateSideEffects: 0, poolBudget: 2, poolPeak: 0,
    sideEffectCountMatchesCompleted: true,
    endingPoolActive: 0, endingPoolWaiters: 0, cleanupPassed: true,
    localBudgets: { checkpointWriteP95Ms: 100, checkpointReadP95Ms: 150 },
  };
  assert.equal(evaluateArtifact(artifact), false);
  artifact.poolPeak = 2;
  assert.equal(evaluateArtifact(artifact), true);
});

test('state validation remains well below checkpoint read budget at maximum state size', () => {
  const value = state({ completedNodes: Array.from({ length: 128 }, (_, index) => `node_${index}`) });
  const samples = [];
  for (let index = 0; index < 2_000; index += 1) {
    const started = performance.now();
    validateFactoryState(value);
    samples.push(performance.now() - started);
  }
  assert.ok(percentile(samples, 0.95) < 10, `validation p95 ${percentile(samples, 0.95)}ms`);
});

test('local deterministic graph execution stays below checkpoint write latency budget', async () => {
  const graph = compileFactoryGraph({
    nodes: [{ name: 'performance_node', execute: () => ({ attempt: 1 }) }],
    maxStateBytes: 262144,
    clock: { now: Date.now },
  });
  const samples = [];
  for (let index = 0; index < 200; index += 1) {
    const input = state({ factoryRunId: `performance:${index}` });
    const started = performance.now();
    await graph.invoke(input);
    samples.push(performance.now() - started);
  }
  assert.ok(percentile(samples, 0.95) < 100, `graph p95 ${percentile(samples, 0.95)}ms`);
});
