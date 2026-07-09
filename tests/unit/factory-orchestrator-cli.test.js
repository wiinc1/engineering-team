const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrchestratorRuntime } = require('../../scripts/run-factory-orchestrator');
const { resolveFactoryConfig } = require('../../lib/task-platform/factory-delivery-shared');

test('factory orchestrator CLI carries candidate and final proof artifact paths', () => {
  const previousArgv = process.argv;
  try {
    process.argv = [
      'node',
      'scripts/run-factory-orchestrator.js',
      '--once',
      '--collect-real-evidence',
      '--candidate-proof',
      'observability/factory-delivery/candidate-proof.json',
      '--final-evidence',
      'observability/factory-delivery/final-real-delivery.json',
      '--release-artifact-dir',
      'observability/release',
      '--use-existing-release-artifacts',
    ];
    const runtime = buildOrchestratorRuntime();
    assert.equal(
      runtime.config.realDeliveryCandidateProofPath,
      'observability/factory-delivery/candidate-proof.json',
    );
    assert.equal(
      runtime.config.realAutonomousDeliveryEvidencePath,
      'observability/factory-delivery/final-real-delivery.json',
    );
    assert.equal(runtime.config.releaseArtifactDir, 'observability/release');
    assert.equal(runtime.config.useExistingReleaseArtifacts, true);
    assert.equal(resolveFactoryConfig(runtime.config).useExistingReleaseArtifacts, true);
  } finally {
    process.argv = previousArgv;
  }
});
