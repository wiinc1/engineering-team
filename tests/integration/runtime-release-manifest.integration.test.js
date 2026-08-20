'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRuntimeEvidence, sealRuntimeManifest,
} = require('../../lib/release-gates/runtime-evidence');
const { collectArtifact } = require('../../lib/release-gates/evidence-collector');
const { buildStagingDeployComponent } = require('../../lib/release-gates/staging-deployment');
const { createCutoverPlan, cutoverPlanDigest } = require('../../lib/runtime-cutover');
const { createMetricSink } = require('../../lib/software-factory/langgraph');
const { evaluateArtifact } = require('../../scripts/run-langgraph-load');
const { configuration: executableGateConfiguration } = require('../../scripts/normalize-runtime-gate-evidence');

it('preserves an immutable manifest seal through JSON artifact transport', () => {
  const revision = 'a'.repeat(40);
  const manifest = sealRuntimeManifest({
    schemaVersion: 1, runtime: 'graphile', revision, deploymentId: 'staging-1', artifacts: [],
  });
  const transported = JSON.parse(JSON.stringify(manifest));
  const decision = evaluateRuntimeEvidence(transported, {
    runtime: 'graphile', revision, now: Date.parse('2026-08-19T18:00:00.000Z'),
  });
  assert.equal(decision.manifestDigest, manifest.manifestDigest);
  assert.equal(decision.reasons.includes('manifest:digest'), false);
});

it('preserves an apply-plan digest through the operator approval transport boundary', () => {
  const revision = 'c'.repeat(40);
  const plan = createCutoverPlan({
    scope: 'factory', targetEngine: 'langgraph', epoch: '6b852ce3-b3ef-40a7-a118-770d7215fdcb',
    revision, actorRole: 'platform_owner', freezeConfirmed: true, mode: 'apply',
    releaseDecision: {
      allowed: true, revision, deploymentId: 'staging-42', manifestDigest: `sha256:${'d'.repeat(64)}`,
    },
    items: [{
      tenantId: 'tenant-a', semanticId: 'factory-1', sourceState: 'paused',
      activeExecutions: 0, executingEngines: [],
      reconciliation: { verified: true, digest: `sha256:${'e'.repeat(64)}` },
    }],
  });
  const transported = JSON.parse(JSON.stringify(plan));
  assert.equal(transported.allowed, true);
  assert.equal(cutoverPlanDigest(transported), transported.digest);
});

it('preserves exact staging deployment evidence through the component collector boundary', () => {
  const revision = 'b'.repeat(40);
  const component = buildStagingDeployComponent({
    automation: 'pipeline-42', deploymentId: 'staging-42', generatedAt: '2026-08-19T18:00:00.000Z',
    endpointMode: 'host-local',
    healthUrl: 'https://factory-staging.example.com/health', hostedHealth: true, localHealth: true,
    profile: 'staging', releaseDirectory: '/var/lib/releases/revision', revision, runtime: 'langgraph',
  });
  const transported = JSON.parse(JSON.stringify(component));
  const artifact = collectArtifact(transported, { runtime: 'langgraph', revision });
  assert.equal(artifact.kind, 'staging_deploy');
  assert.equal(artifact.summary.hostedHealth, true);
  assert.equal(artifact.summary.hostLocalEndpoint, true);
  assert.equal(transported.evidence.endpointMode, 'host-local');
});

it('binds host-local executable gates to the same explicit endpoint scope as deployment', () => {
  const revision = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const configuration = executableGateConfiguration(
    ['--runtime', 'graphile', '--kind', 'contract', '--source', 'contract.tap'],
    {
      STAGING_REVISION: revision,
      STAGING_ENDPOINT_MODE: 'host-local',
      STAGING_BASE_URL: 'http://127.0.0.1:23000',
      STAGING_DEPLOYMENT_ID: 'staging-host-local',
      RUNTIME_EVIDENCE_AUTOMATION: 'local:runtime-hosted-evidence',
    },
  );
  assert.equal(configuration.endpointMode, 'host-local');
  assert.equal(configuration.deploymentId, 'staging-host-local');
  assert.equal(configuration.automation, 'local:runtime-hosted-evidence');
});

it('admits LangGraph load evidence only with exact side effects and zero residual state', () => {
  const artifact = {
    failures: 0, checkpointWrites: { p95Ms: 20 }, checkpointReads: { p95Ms: 25 },
    status: { p95Ms: 4 }, resume: { p95Ms: 13 }, graphOverheadPercent: 0.85,
    duplicateSideEffects: 0, sideEffectCountMatchesCompleted: true,
    poolPeak: 2, poolBudget: 2, endingPoolActive: 0, endingPoolWaiters: 0,
    cleanupPassed: true, localBudgets: { checkpointWriteP95Ms: 100, checkpointReadP95Ms: 150 },
  };
  assert.equal(evaluateArtifact(artifact), true);
  assert.equal(evaluateArtifact({ ...artifact, duplicateSideEffects: 1 }), false);
  assert.equal(evaluateArtifact({ ...artifact, cleanupPassed: false }), false);
});

it('transports a stable LangGraph metric snapshot into load evidence aggregation', () => {
  const metrics = createMetricSink();
  for (const latency of [12, 18, 25]) metrics.observe('langgraph_checkpoint_write_latency_ms', latency);
  const transported = JSON.parse(JSON.stringify(metrics.snapshot()));
  metrics.observe('langgraph_checkpoint_write_latency_ms', 500);
  assert.deepEqual(Object.values(transported.histograms)[0], [12, 18, 25]);
  assert.deepEqual(Object.values(metrics.snapshot().histograms)[0], [12, 18, 25, 500]);
});
