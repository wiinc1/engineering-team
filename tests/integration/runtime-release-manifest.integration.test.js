'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRuntimeEvidence, sealRuntimeManifest,
} = require('../../lib/release-gates/runtime-evidence');
const { collectArtifact } = require('../../lib/release-gates/evidence-collector');
const { buildStagingDeployComponent } = require('../../lib/release-gates/staging-deployment');
const { createCutoverPlan, cutoverPlanDigest } = require('../../lib/runtime-cutover');

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
    healthUrl: 'https://factory-staging.example.com/health', hostedHealth: true, localHealth: true,
    profile: 'staging', releaseDirectory: '/var/lib/releases/revision', revision, runtime: 'langgraph',
  });
  const transported = JSON.parse(JSON.stringify(component));
  const artifact = collectArtifact(transported, { runtime: 'langgraph', revision });
  assert.equal(artifact.kind, 'staging_deploy');
  assert.equal(artifact.summary.hostedHealth, true);
});
