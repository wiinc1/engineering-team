const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  advanceFactoryItem,
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
} = require('../../lib/task-platform/factory-delivery');
const { savePilotEvidence } = require('../../lib/task-platform/golden-path-shared');
const { createGithubEvidenceFetchMock } = require('../helpers/github-evidence-mock');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

function writePhase1FactoryEvidence(evidencePath) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    status: 'phase1_complete',
    engineeringTeam: { taskId: 'TSK-STUB1', projectId: 'PRJ-STUB1' },
    phase0: { mode: 'factory_intake', actorId: 'factory-orchestrator' },
    phase1: {
      api: {
        pmRefinementMode: 'refinement_start',
        architectHandoffMode: 'embedded_in_execution_contract',
      },
      architectSpec: { engineerTier: 'Jr' },
    },
  }, evidencePath);
}

function buildPhase6RunPhasesFn() {
  const { buildEngineerPersonaRouting } = require('../../lib/task-platform/factory-persona-progression');
  const routing = buildEngineerPersonaRouting('Standard');
  return async (options) => {
    const evidence = options.pilot;
    evidence.status = 'phase6_complete';
    evidence.engineeringTeam = { ...evidence.engineeringTeam, templateTier: 'Standard' };
    evidence.phase2 = {
      personaRouting: routing,
      personas: { engineer: 'engineer-sr', engineerPersonas: routing.engineerPersonas, forge: 'main' },
    };
    evidence.phase3 = { personas: { qa: 'qa', qaOutcome: 'fail_intentional', engineer: 'engineer-sr' } };
    evidence.phase4 = {
      personas: { engineer: 'engineer-sr', qa: 'qa', qaOutcome: 'pass' },
      api: { qaPass: { ok: true } },
    };
    evidence.phase5 = {
      personas: { sre: 'sre', pm: 'pm', architect: 'architect', qa: 'qa' },
      api: { sreMonitoring: { start: { ok: true }, approve: { ok: true } } },
    };
    evidence.phase6 = {
      personas: { sre: 'sre', human: 'admin' },
      api: { humanClose: { ok: true }, taskClosed: { ok: true } },
    };
    savePilotEvidence(evidence, options.outputPath);
    return { evidence };
  };
}

const STRICT_FACTORY_PR_EVIDENCE = {
  ciRepository: 'wiinc1/engineering-team',
  branchName: 'factory/strict-evidence',
  implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/312',
  prNumber: 312,
  checks: [
    { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
    { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
  ],
  requiredChecks: ['Unit tests', 'Merge readiness'],
  branchProtection: {
    branch: 'main',
    requiredChecks: ['Unit tests', 'Merge readiness'],
    source: 'github_branch_protection',
  },
  mergeReadiness: { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
  githubEvidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' },
  fixCommitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
  mergeCommitSha: '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901',
};

function assertStrictFactoryPrEvidence(options) {
  assert.equal(options.ciRepository, STRICT_FACTORY_PR_EVIDENCE.ciRepository);
  assert.equal(options.branchName, STRICT_FACTORY_PR_EVIDENCE.branchName);
  assert.equal(options.implementationCommitSha, STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha);
  assert.equal(options.prUrl, STRICT_FACTORY_PR_EVIDENCE.prUrl);
  assert.equal(options.prNumber, STRICT_FACTORY_PR_EVIDENCE.prNumber);
  assert.deepEqual(options.requiredChecks, STRICT_FACTORY_PR_EVIDENCE.requiredChecks);
  assert.equal(options.branchProtection.source, 'github_branch_protection');
  assert.equal(options.mergeReadiness.name, 'Merge readiness');
  assert.equal(options.fixCommitSha, STRICT_FACTORY_PR_EVIDENCE.fixCommitSha);
  assert.equal(options.mergeCommitSha, STRICT_FACTORY_PR_EVIDENCE.mergeCommitSha);
}

function strictFactoryCandidateConfig(tmp, changedFiles) {
  return {
    branchName: STRICT_FACTORY_PR_EVIDENCE.branchName,
    implementationCommitSha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha,
    prUrl: STRICT_FACTORY_PR_EVIDENCE.prUrl,
    prNumber: STRICT_FACTORY_PR_EVIDENCE.prNumber,
    checks: STRICT_FACTORY_PR_EVIDENCE.checks,
    requiredChecks: STRICT_FACTORY_PR_EVIDENCE.requiredChecks,
    branchProtection: STRICT_FACTORY_PR_EVIDENCE.branchProtection,
    mergeReadiness: STRICT_FACTORY_PR_EVIDENCE.mergeReadiness,
    githubEvidenceSource: STRICT_FACTORY_PR_EVIDENCE.githubEvidenceSource,
    autoMerge: true,
    githubToken: 'test-github-token',
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.engineering-team.io',
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: { environment: 'staging', commit_sha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' },
    realDeliveryRollbackEvidence: { environment: 'staging', commit_sha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' },
    healthCheckPath: '/version',
    realDeliveryHealthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactCommands: { build: 'npm run build', compatibility: 'npm run test:unit', vulnerability: 'npm audit --audit-level=high', secret: 'npm run secrets:scan' },
    realDeliveryRiskLevel: 'low',
    realDeliveryProductionSafe: true,
    realDeliveryProductionSafetyEvidence: productionSafetyEvidence({
      deploymentUrl: 'https://factory-staging.engineering-team.io',
      commitSha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha,
    }),
    realDeliveryTestCommands: ['node -e "process.exit(0)"'],
    realDeliveryCandidateProofPath: path.join(tmp, 'candidate-proof.json'),
    realDeliveryCandidateGitState: { branch: STRICT_FACTORY_PR_EVIDENCE.branchName, commitSha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha, changedFiles, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    realDeliveryGithubFetchImpl: createGithubEvidenceFetchMock({
      prNumber: STRICT_FACTORY_PR_EVIDENCE.prNumber,
      prUrl: STRICT_FACTORY_PR_EVIDENCE.prUrl,
      branchName: STRICT_FACTORY_PR_EVIDENCE.branchName,
      commitSha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha,
      changedFiles,
      requiredChecks: STRICT_FACTORY_PR_EVIDENCE.requiredChecks,
      checks: STRICT_FACTORY_PR_EVIDENCE.checks,
    }),
    realDeliveryFetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ commitSha: STRICT_FACTORY_PR_EVIDENCE.implementationCommitSha }) }),
    realDeliverySourceIntegrity: () => ({ checkedFiles: 2, nodeCheckedFiles: 1, failures: [] }),
  };
}

function factoryPhaseItem(evidencePath, changedFiles) {
  return {
    id: 'factory-phase-stub',
    title: 'Stub phases',
    requirements: 'Exercise persona routing.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles,
    stage: 'phase1_complete',
    taskId: 'TSK-STUB1',
    projectId: 'PRJ-STUB1',
    evidencePath,
    forgeTaskId: 'TSK-GOLDENSTUB1',
    createdAt: new Date().toISOString(),
  };
}

test(
  'advanceFactoryItem advances phase1_complete to phase6_complete via injected runPhasesFn',
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-phases-'));
    const deliveryDir = path.join(tmp, 'delivery');
    const evidencePath = path.join(deliveryDir, 'factory-phase-stub.json');
    const changedFiles = ['lib/task-platform/factory-delivery.js', 'tests/unit/factory-delivery.test.js'];
    writePhase1FactoryEvidence(evidencePath);
    const phase6Runner = buildPhase6RunPhasesFn();
    let capturedOptions = null;

    const outcome = await advanceFactoryItem(factoryPhaseItem(evidencePath, changedFiles), {
      jwtSecret: 'factory-test-secret',
      baseUrl: 'https://api.factory.openclaw.app',
      operatorUrl: 'https://operator.factory.openclaw.app',
      forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
      deliveryDir,
      collectRealEvidence: true,
      ...strictFactoryCandidateConfig(tmp, changedFiles),
      ...STRICT_FACTORY_PR_EVIDENCE,
      runPhasesFn: async (options) => {
        capturedOptions = options;
        return phase6Runner(options);
      },
      skipForgeSeed: true,
    });

    assert.equal(outcome.action, 'phases_2_6');
    assert.equal(outcome.item.stage, 'phase6_complete');
    assert.equal(outcome.item.completedAt, null);
    assert.equal(capturedOptions.collectRealEvidence, true);
    assert.equal(capturedOptions.requireRealEvidence, true);
    assert.equal(capturedOptions.riskLevel, 'low');
    assert.equal(capturedOptions.productionSafe, true);
    assert.deepEqual(capturedOptions.candidateTestCommands, ['node -e "process.exit(0)"']);
    assert.equal(capturedOptions.candidateProofPath, path.join(tmp, 'candidate-proof.json'));
    assertStrictFactoryPrEvidence(capturedOptions);
    const progression = summarizeFactoryPersonaProgression(JSON.parse(fs.readFileSync(evidencePath, 'utf8')));
    const personaCheck = assertRequiredFactoryPersonas(progression);
    assert.equal(personaCheck.ok, true);
    assert.equal(progression.personas.engineer, 'engineer-sr');
    assert.equal(progression.engineerPersonas.principal, 'engineer-principal');
  },
);
