const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
  buildPhasePersonaSnapshot,
  buildEngineerPersonaRouting,
} = require('../../lib/task-platform/factory-persona-progression');

function buildSyntheticFactoryEvidence(templateTier = 'Standard') {
  const routing = buildEngineerPersonaRouting(templateTier);
  return {
    status: 'phase6_complete',
    engineeringTeam: {
      taskId: 'TSK-SYNTHETIC',
      templateTier,
    },
    phase0: { mode: 'factory_intake', actorId: 'factory-orchestrator' },
    phase1: {
      api: {
        pmRefinementMode: 'refinement_start',
        architectHandoffMode: 'embedded_in_execution_contract',
      },
      architectSpec: { engineerTier: routing.assignedTier },
      contract: { templateTier },
    },
    phase2: {
      personaRouting: routing,
      personas: buildPhasePersonaSnapshot(2, { engineeringTeam: { templateTier } }, { personaRouting: routing }),
    },
    phase3: {
      personas: { qa: 'qa', qaOutcome: 'fail_intentional', engineer: routing.assignedOwner },
    },
    phase4: {
      personas: { qa: 'qa', qaOutcome: 'pass', engineer: 'engineer-sr' },
      api: { qaPass: { ok: true } },
    },
    phase5: {
      personas: { sre: 'sre', pm: 'pm', architect: 'architect', qa: 'qa', qaVerification: 'pass' },
      api: {
        sreMonitoring: { start: { ok: true }, approve: { ok: true } },
        pmCloseReview: { ok: true },
        architectCloseReview: { ok: true },
      },
    },
    phase6: {
      personas: { sre: 'sre', human: 'admin' },
      api: { humanClose: { ok: true }, taskClosed: { ok: true } },
    },
  };
}

test('buildEngineerPersonaRouting maps Standard tier to engineer-sr and seeds all granular personas', () => {
  const routing = buildEngineerPersonaRouting('Standard');
  assert.equal(routing.assignedTier, 'Sr');
  assert.equal(routing.assignedOwner, 'engineer-sr');
  assert.deepEqual(routing.engineerPersonas, {
    jr: 'engineer-jr',
    sr: 'engineer-sr',
    principal: 'engineer-principal',
  });
});

test('summarizeFactoryPersonaProgression extracts all personas from synthetic evidence', () => {
  const evidence = buildSyntheticFactoryEvidence('Standard');
  const summary = summarizeFactoryPersonaProgression(evidence);

  assert.equal(summary.taskId, 'TSK-SYNTHETIC');
  assert.equal(summary.phase1.engineerTier, 'Sr');
  assert.equal(summary.personas.engineer, 'engineer-sr');
  assert.equal(summary.engineerPersonas.jr, 'engineer-jr');
  assert.equal(summary.engineerPersonas.sr, 'engineer-sr');
  assert.equal(summary.engineerPersonas.principal, 'engineer-principal');
  assert.equal(summary.phase3.qaOutcome, 'fail_intentional');
  assert.equal(summary.phase4.qaOutcome, 'pass');
});

test('assertRequiredFactoryPersonas passes when pm/architect/qa/sre and jr/sr/principal are present', () => {
  const summary = summarizeFactoryPersonaProgression(buildSyntheticFactoryEvidence('Standard'));
  const check = assertRequiredFactoryPersonas(summary);
  assert.equal(check.ok, true);
  assert.deepEqual(check.missing, []);
});

test('buildPhasePersonaSnapshot escalates engineer to sr on phase4 fix loop after jr assignment', () => {
  const evidence = { engineeringTeam: { templateTier: 'Simple' }, phase1: { architectSpec: { engineerTier: 'Jr' } } };
  const routing = buildEngineerPersonaRouting('Simple');
  const phase4 = buildPhasePersonaSnapshot(4, evidence, { qaPass: { ok: true } });
  assert.equal(phase4.engineer, 'engineer-sr');
  assert.equal(phase4.qaOutcome, 'pass');
});