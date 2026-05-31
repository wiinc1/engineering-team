const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildOrchestrationView, evaluateOrchestrationStart } = require('../../lib/audit/orchestration');
const { createTaskPlatformService } = require('../../lib/task-platform');
const { ensurePilotAgents } = require('../../lib/task-platform/pilot-agents');
const {
  EXPECTED_OPENCLAW_RUNNER,
  assertRuntimeConfig,
  runPilotDelegationReadiness,
} = require('../../scripts/verify-pilot-delegation-readiness');

const repoRoot = path.join(__dirname, '..', '..');
const fixtureRunner = `node ${path.join(repoRoot, 'tests', 'fixtures', 'specialist-runtime-runner.js')}`;

test('ensurePilotAgents creates active assignable supported-role pilot agents', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-agent-seed-'));
  const taskPlatform = createTaskPlatformService({ baseDir, agentRegistry: [] });

  const result = await ensurePilotAgents({ taskPlatform, tenantId: 'tenant-pilot', actorId: 'pm-pilot' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.created.sort(), ['architect', 'engineer', 'pm', 'qa', 'sre']);
  assert.deepEqual(result.missingRoles, []);

  const agents = taskPlatform.listAiAgents({ tenantId: 'tenant-pilot' });
  assert.deepEqual(agents.map(agent => agent.role).sort(), ['architect', 'engineer', 'pm', 'qa', 'sre']);
  assert.ok(agents.every(agent => agent.active && agent.assignable));
  assert.ok(agents.every(agent => agent.metadata.requiredBy === 'issue-247'));
});

test('ensurePilotAgents updates inactive or non-assignable existing pilot agents', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-agent-update-'));
  const taskPlatform = createTaskPlatformService({ baseDir, agentRegistry: [] });
  taskPlatform.createAiAgent({
    tenantId: 'tenant-pilot',
    actorId: 'setup',
    agent: {
      agentId: 'engineer',
      displayName: 'Old Engineer',
      role: 'engineer',
      active: false,
      assignable: true,
    },
  });

  const result = await ensurePilotAgents({ taskPlatform, tenantId: 'tenant-pilot', actorId: 'pm-pilot' });
  const engineer = result.agents.find(agent => agent.agentId === 'engineer');

  assert.equal(engineer.action, 'updated');
  assert.equal(engineer.active, true);
  assert.equal(engineer.assignable, true);
  assert.equal(engineer.displayName, 'Pilot Engineer');
});

test('orchestration dispatch persists runtime ownership evidence for app workflow proof', async () => {
  const run = await evaluateOrchestrationStart({
    taskId: 'PILOT-PARENT',
    relationships: {
      child_task_ids: ['TSK-PILOT-1'],
      child_dependencies: {},
    },
    childTaskSummaries: [
      {
        task_id: 'TSK-PILOT-1',
        title: 'Implement app-dispatched proof',
        task_type: 'engineer',
        current_stage: 'TODO',
        closed: false,
        blocked: false,
        waiting_state: null,
      },
    ],
    dispatchWork: async () => ({
      mode: 'delegated',
      agentId: 'engineer',
      specialist: 'engineer',
      message: 'runtime handled by engineer',
      attribution: { handledBy: 'engineer', delegated: true, coordinator: 'pm' },
      metadata: {
        sessionId: 'session-app-1',
        artifactPath: '/tmp/specialist-delegation.jsonl',
      },
    }),
  });

  const item = run.items[0];
  assert.equal(item.actualAgent, 'engineer');
  assert.equal(item.sessionId, 'session-app-1');
  assert.equal(item.delegationArtifactPath, '/tmp/specialist-delegation.jsonl');
  assert.equal(item.runtimeAttribution.delegated, true);

  const view = buildOrchestrationView({
    relationships: {
      child_task_ids: ['TSK-PILOT-1'],
      child_dependencies: {},
      orchestration_state: run,
    },
    childTaskSummaries: [
      {
        task_id: 'TSK-PILOT-1',
        title: 'Implement app-dispatched proof',
        task_type: 'engineer',
        current_stage: 'TODO',
        closed: false,
        blocked: false,
        waiting_state: null,
      },
    ],
  });

  assert.equal(view.run.items[0].sessionId, 'session-app-1');
  assert.equal(view.run.items[0].delegationArtifactPath, '/tmp/specialist-delegation.jsonl');
});

test('runtime config gate requires the exact target OpenClaw runner by default', () => {
  assert.doesNotThrow(() => assertRuntimeConfig({
    enabled: true,
    runnerConfigured: true,
    usesExpectedOpenClawRunner: true,
    specialistDelegationRunner: EXPECTED_OPENCLAW_RUNNER,
  }));
  assert.throws(() => assertRuntimeConfig({
    enabled: true,
    runnerConfigured: true,
    usesExpectedOpenClawRunner: false,
    specialistDelegationRunner: fixtureRunner,
  }), /SPECIALIST_DELEGATION_RUNNER/);
  assert.doesNotThrow(() => assertRuntimeConfig({
    enabled: true,
    runnerConfigured: true,
    usesExpectedOpenClawRunner: false,
    specialistDelegationRunner: fixtureRunner,
  }, { allowAlternateRunner: true }));
});

test('runPilotDelegationReadiness writes app-dispatched evidence with fixture runtime', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-delegation-readiness-'));
  const { evidence, outputPath } = await runPilotDelegationReadiness({
    baseDir,
    tenantId: 'tenant-pilot',
    actorId: 'pm-pilot',
    runnerCommand: fixtureRunner,
    ffRealSpecialistDelegation: 'true',
    allowAlternateRunner: true,
    env: {
      FF_REAL_SPECIALIST_DELEGATION: 'true',
      SPECIALIST_DELEGATION_RUNNER: fixtureRunner,
    },
  });

  assert.equal(evidence.pilotAgents.ok, true);
  assert.equal(evidence.appWorkflowDispatch.delegated, true);
  assert.equal(evidence.appWorkflowDispatch.agentId, 'engineer');
  assert.match(evidence.appWorkflowDispatch.sessionId, /^runtime-session-/);
  assert.ok(evidence.appWorkflowDispatch.delegationArtifactPath.endsWith('specialist-delegation.jsonl'));
  assert.equal(evidence.appWorkflowDispatch.runtimeAttribution.delegated, true);
  assert.equal(evidence.supervisedPilot.requiredCloseoutEvidenceTarget, '#242');
  assert.equal(fs.existsSync(outputPath), true);
});
