const { engineerAssigneeForTier } = require('../audit/execution-contracts');

const REQUIRED_FACTORY_PERSONAS = Object.freeze([
  'pm',
  'architect',
  'engineer',
  'qa',
  'sre',
]);

function resolveEngineerTier(evidence = {}) {
  return evidence.phase1?.architectSpec?.engineerTier
    || evidence.phase1?.contract?.engineerTier
    || evidence.personaProgression?.phase1?.engineerTier
    || null;
}

function resolveEngineerOwner(evidence = {}) {
  const explicit = evidence.phase2?.personas?.engineer
    || evidence.personaProgression?.phase2?.engineer
    || null;
  if (explicit) return explicit;
  const tier = resolveEngineerTier(evidence);
  return engineerAssigneeForTier(tier) || (tier ? `engineer-${String(tier).toLowerCase()}` : null);
}

function extractQaOwner(evidence = {}) {
  const fromPhase = evidence.phase3?.personas?.qa
    || evidence.personaProgression?.phase3?.qa
    || null;
  if (fromPhase) return fromPhase;

  const qaGate = (evidence.phase5?.api?.reviewGates || []).find((gate) => gate.gate === 'qa');
  if (qaGate?.history?.length) {
    const rejected = qaGate.history.find((entry) => entry.returnRoute?.sourceOwner);
    if (rejected?.returnRoute?.sourceOwner) return rejected.returnRoute.sourceOwner;
  }
  if (qaGate) return 'qa';
  return null;
}

function extractSreOwner(evidence = {}) {
  const fromPhase = evidence.phase5?.personas?.sre
    || evidence.personaProgression?.phase5?.sre
    || null;
  if (fromPhase) return fromPhase;

  const sre = evidence.phase5?.api?.sreMonitoring || evidence.phase6?.api?.sreMonitoring;
  if (sre?.start?.ok || sre?.approve?.ok) return 'sre';
  if (sre?.skipped && String(sre.reason || '').includes('phase5')) return 'sre';
  return null;
}

function buildPhasePersonaSnapshot(phase, evidence = {}, api = {}) {
  const engineerOwner = resolveEngineerOwner({ ...evidence, phase1: evidence.phase1 });
  switch (phase) {
    case 2:
      return {
        engineer: engineerOwner,
        delegation: api.delegationSmoke?.ok
          ? 'delegated'
          : (api.delegationSmoke?.skipped ? 'skipped' : null),
        forge: 'main',
      };
    case 3:
      return {
        qa: 'qa',
        engineer: engineerOwner,
      };
    case 4:
      return {
        engineer: engineerOwner,
        qa: 'qa-reviewer',
      };
    case 5:
      return {
        sre: 'sre',
        pm: 'pm',
        architect: 'architect',
        qa: extractQaOwner({ ...evidence, phase5: { api } }),
      };
    case 6:
      return {
        sre: extractSreOwner(evidence) || 'sre',
        pm: 'pm',
        architect: 'architect',
        human: 'admin',
      };
    default:
      return null;
  }
}

function summarizeFactoryPersonaProgression(evidence = {}) {
  const engineerTier = resolveEngineerTier(evidence);
  const engineerOwner = resolveEngineerOwner(evidence);

  return {
    taskId: evidence.engineeringTeam?.taskId || null,
    status: evidence.status || null,
    intake: {
      owner: 'pm',
      mode: evidence.phase0?.mode || null,
      actorId: evidence.phase0?.actorId || null,
    },
    phase1: {
      pm: evidence.phase1?.api?.pmRefinementMode || null,
      architect: evidence.phase1?.api?.architectHandoffMode || null,
      engineerTier,
      engineerOwner,
    },
    phase2: evidence.phase2?.personas || evidence.personaProgression?.phase2 || null,
    phase3: evidence.phase3?.personas || evidence.personaProgression?.phase3 || null,
    phase4: evidence.phase4?.personas || evidence.personaProgression?.phase4 || null,
    phase5: evidence.phase5?.personas || evidence.personaProgression?.phase5 || {
      sre: extractSreOwner(evidence),
      pm: evidence.phase5?.api?.pmCloseReview?.ok ? 'pm' : null,
      architect: evidence.phase5?.api?.architectCloseReview?.ok ? 'architect' : null,
      qa: extractQaOwner(evidence),
    },
    phase6: evidence.phase6?.personas || evidence.personaProgression?.phase6 || (
      evidence.phase6?.completedAt
        ? {
          sre: extractSreOwner(evidence),
          human: evidence.phase6?.api?.humanClose?.ok ? 'admin' : null,
        }
        : null
    ),
    personas: {
      pm: evidence.phase1?.api?.pmRefinementMode ? 'pm' : (evidence.phase0?.mode ? 'pm' : null),
      architect: evidence.phase1?.api?.architectHandoffMode ? 'architect' : null,
      engineer: engineerOwner,
      qa: extractQaOwner(evidence),
      sre: extractSreOwner(evidence),
    },
  };
}

function assertRequiredFactoryPersonas(summary = {}) {
  const missing = [];
  const personas = summary.personas || {};

  if (!personas.pm) missing.push('pm');
  if (!personas.architect) missing.push('architect');
  if (!personas.engineer) missing.push('engineer');
  if (!personas.qa) missing.push('qa');
  if (!personas.sre) missing.push('sre');

  return {
    ok: missing.length === 0,
    missing,
    personas,
  };
}

module.exports = {
  REQUIRED_FACTORY_PERSONAS,
  resolveEngineerTier,
  resolveEngineerOwner,
  buildPhasePersonaSnapshot,
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
};