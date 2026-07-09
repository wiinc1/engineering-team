const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateProofOptions } = require('../../scripts/run-golden-path-phases');
const {
  assertGoldenPathRealEvidencePreflight,
  collectGoldenPathRealEvidenceCliArgs,
  readGoldenPathRealEvidenceCliOptions,
} = require('../../lib/task-platform/golden-path-real-evidence-preflight');

const REAL_PROOF = Object.freeze({
  branchName: 'feat/autonomous-real-proof',
  commitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
});

const COMPLETE_RELEASE_PROOF = Object.freeze({
  rollbackVerified: true,
  rollbackEvidence: 'observability/release/rollback-verification.json',
  candidateProofPath: 'observability/real-delivery-candidate-proof.json',
  healthCheckPath: '/version',
  requireHealthCommit: true,
  releaseArtifactCommands: {
    build: 'npm run build',
    compatibility: 'npm run test:unit',
    vulnerability: 'npm audit --audit-level=high',
    secret: 'npm run secrets:scan',
  },
});

test('real-evidence CLI helper forwards generated candidate proof args', () => {
  const argv = [
    'node',
    'scripts/replay-golden-path-postgres.js',
    '--generate-candidate-proof',
    '--production-safe',
    '--candidate-proof',
    'observability/real-delivery-candidate-proof.json',
    '--candidate-test-command',
    'npm run test:unit',
    '--candidate-test-command',
    'npm run standards:check',
    '--production-safety-evidence',
    'observability/release/production-safety.json',
    '--risk-level',
    'low',
  ];

  assert.deepEqual(collectGoldenPathRealEvidenceCliArgs(argv), [
    '--generate-candidate-proof',
    '--production-safe',
    '--candidate-proof',
    'observability/real-delivery-candidate-proof.json',
    '--candidate-test-command',
    'npm run test:unit',
    '--production-safety-evidence',
    'observability/release/production-safety.json',
    '--risk-level',
    'low',
    '--candidate-test-command',
    'npm run standards:check',
  ]);
  const options = readGoldenPathRealEvidenceCliOptions(argv, {});
  assert.equal(options.generateCandidateProof, true);
  assert.deepEqual(options.candidateTestCommands, ['npm run test:unit', 'npm run standards:check']);
  assert.equal(options.productionSafe, true);
  assert.equal(options.riskLevel, 'low');
});

test('real-evidence preflight allows missing candidate proof only when generation is fully specified', () => {
  const generatedProofOptions = {
    collectRealEvidence: true,
    generateCandidateProof: true,
    githubToken: 'gh-token',
    branchName: REAL_PROOF.branchName,
    implementationCommitSha: REAL_PROOF.commitSha,
    prUrl: REAL_PROOF.prUrl,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    rollbackTarget: 'release-previous',
    ...COMPLETE_RELEASE_PROOF,
    candidateProofPath: 'observability/generated-candidate-proof.json',
    candidateTestCommands: ['npm run test:unit'],
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: 'observability/release/production-safety.json',
    allowTestEnvInjection: true,
    env: { GITHUB_TOKEN: '', GH_TOKEN: '' },
  };

  assert.equal(assertGoldenPathRealEvidencePreflight(generatedProofOptions).required, true);
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      ...generatedProofOptions,
      githubToken: '',
      candidateTestCommands: [],
      riskLevel: '',
      productionSafe: false,
      productionSafetyEvidence: '',
    }),
    /candidate proof generation requires GITHUB_TOKEN or GH_TOKEN.*--candidate-test-command.*--risk-level low.*--production-safe.*--production-safety-evidence/s,
  );
});

test('golden-path phase runner maps hosted settings into generated candidate proof options', () => {
  const proofOptions = candidateProofOptions({
    ciRepository: 'wiinc1/engineering-team',
    githubToken: 'gh-token',
    branch: REAL_PROOF.branchName,
    implementationCommitSha: REAL_PROOF.commitSha,
    prUrl: REAL_PROOF.prUrl,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    rollbackTarget: 'release-previous',
    rollbackEvidence: 'observability/release/rollback-verification.json',
    rollbackVerified: true,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    productionSafetyEvidence: 'observability/release/production-safety.json',
    riskLevel: 'low',
    productionSafe: true,
    candidateTestCommands: ['npm run test:unit'],
  });

  assert.equal(proofOptions.collectGithubEvidence, true);
  assert.equal(proofOptions.repository, 'wiinc1/engineering-team');
  assert.equal(proofOptions.requireFinalReleaseProof, true);
  assert.equal(proofOptions.verifyDeploymentHealth, true);
  assert.equal(proofOptions.runTestCommands, true);
  assert.deepEqual(proofOptions.testCommands, ['npm run test:unit']);
  assert.equal(proofOptions.productionSafetyEvidence, 'observability/release/production-safety.json');
});
