const { engineerAssigneeForTier } = require('../audit/execution-contracts');
const { resolveRuntimeAgent } = require('../../scripts/openclaw-specialist-runner');

const REQUIRED_FACTORY_PERSONAS = Object.freeze([
  'pm',
  'architect',
  'engineer',
  'qa',
  'sre',
  'ux',
]);

const ENGINEER_PERSONA_KEYS = Object.freeze(['jr', 'sr', 'principal']);

function resolveEngineerTier(evidence = {}) {
  return evidence.phase1?.architectSpec?.engineerTier
    || evidence.phase1?.contract?.engineerTier
    || evidence.personaProgression?.phase1?.engineerTier
    || null;
}

function buildEngineerPersonaRouting(templateTier = 'Simple') {
  const assignedTier = templateTier === 'Simple'
    ? 'Jr'
    : (['Complex', 'Epic'].includes(templateTier) ? 'Principal' : 'Sr');
  const assignees = Object.fromEntries(
    ['Jr', 'Sr', 'Principal'].map((tier) => [tier, engineerAssigneeForTier(tier)]),
  );
  return {
    seededAgents: ['engineer-jr', 'engineer-sr', 'engineer-principal'],
    runtimeAgents: {
      'jr-engineer': resolveRuntimeAgent('jr-engineer'),
      'sr-engineer': resolveRuntimeAgent('sr-engineer'),
      principal: resolveRuntimeAgent('principal'),
      ux: resolveRuntimeAgent('ux'),
    },
    assignees,
    assignedTier,
    assignedOwner: engineerAssigneeForTier(assignedTier),
    engineerPersonas: {
      jr: assignees.Jr,
      sr: assignees.Sr,
      principal: assignees.Principal,
    },
  };
}

function resolveEngineerOwner(evidence = {}) {
  const routing = evidence.phase2?.personaRouting || evidence.phase2?.api?.personaRouting;
  if (routing?.assignedOwner) return routing.assignedOwner;

  const explicit = evidence.phase2?.personas?.engineer
    || evidence.personaProgression?.phase2?.engineer
    || null;
  if (explicit) return explicit;

  const tier = resolveEngineerTier(evidence);
  return engineerAssigneeForTier(tier) || (tier ? `engineer-${String(tier).toLowerCase()}` : null);
}

function resolvePhase4EngineerOwner(evidence = {}) {
  const fromPhase = evidence.phase4?.personas?.engineer || null;
  if (fromPhase) return fromPhase;
  const primary = resolveEngineerOwner(evidence);
  if (primary === 'engineer-jr') return 'engineer-sr';
  return primary;
}

function extractEngineerPersonas(evidence = {}) {
  const routing = evidence.phase2?.personaRouting
    || evidence.phase2?.api?.personaRouting
    || null;
  if (routing?.engineerPersonas) return routing.engineerPersonas;
  if (evidence.phase2?.personas?.engineerPersonas) return evidence.phase2.personas.engineerPersonas;
  return {};
}

function extractQaOwner(evidence = {}) {
  if (evidence.phase4?.api?.qaPass?.ok || evidence.phase4?.personas?.qaOutcome === 'pass') {
    return 'qa';
  }
  const fromPhase = evidence.phase3?.personas?.qa
    || evidence.phase4?.personas?.qa
    || evidence.personaProgression?.phase3?.qa
    || null;
  if (fromPhase) return fromPhase;
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
  const factoryTemplateTier = evidence.engineeringTeam?.templateTier
    || evidence.phase1?.contract?.factoryTemplateTier
    || 'Simple';
  const routing = api.personaRouting || buildEngineerPersonaRouting(factoryTemplateTier);
  const engineerOwner = routing.assignedOwner || resolveEngineerOwner({ ...evidence, phase1: evidence.phase1 });

  switch (phase) {
    case 2:
      return {
        engineer: engineerOwner,
        engineerPersonas: routing.engineerPersonas,
        personaRouting: routing,
        ux: api.uxReview?.owner || 'ux',
        delegation: api.delegationSmoke?.ok
          ? 'delegated'
          : (api.delegationSmoke?.skipped ? 'skipped' : null),
        forge: 'main',
      };
    case 3:
      return {
        qa: 'qa',
        qaOutcome: api.qaFail?.ok ? 'fail_intentional' : null,
        engineer: engineerOwner,
      };
    case 4:
      return {
        engineer: resolvePhase4EngineerOwner({ ...evidence, phase2: { personas: { engineer: engineerOwner } } }),
        qa: 'qa',
        qaOutcome: api.qaPass?.ok ? 'pass' : null,
      };
    case 5:
      return {
        sre: 'sre',
        pm: 'pm',
        architect: 'architect',
        qa: 'qa',
        qaVerification: evidence.phase4?.personas?.qaOutcome === 'pass' ? 'pass' : null,
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
  const engineerPersonas = extractEngineerPersonas(evidence);

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
    engineerPersonas,
    personas: {
      pm: evidence.phase1?.api?.pmRefinementMode ? 'pm' : (evidence.phase0?.mode ? 'pm' : null),
      architect: evidence.phase1?.api?.architectHandoffMode ? 'architect' : null,
      engineer: engineerOwner,
      qa: extractQaOwner(evidence),
      sre: extractSreOwner(evidence),
      ux: evidence.phase2?.personas?.ux
        || evidence.phase1?.api?.uxReview?.owner
        || evidence.personaProgression?.phase2?.ux
        || 'ux',
    },
  };
}

function assertRequiredFactoryPersonas(summary = {}) {
  const missing = [];
  const personas = summary.personas || {};
  const engineerPersonas = summary.engineerPersonas || {};

  if (!personas.pm) missing.push('pm');
  if (!personas.architect) missing.push('architect');
  if (!personas.engineer) missing.push('engineer');
  if (!personas.qa) missing.push('qa');
  if (!personas.sre) missing.push('sre');
  if (!personas.ux) missing.push('ux');

  for (const key of ENGINEER_PERSONA_KEYS) {
    if (!engineerPersonas[key]) missing.push(`engineer-${key}`);
  }

  return {
    ok: missing.length === 0,
    missing,
    personas,
    engineerPersonas,
  };
}

module.exports = {
  REQUIRED_FACTORY_PERSONAS,
  ENGINEER_PERSONA_KEYS,
  resolveEngineerTier,
  resolveEngineerOwner,
  buildEngineerPersonaRouting,
  buildPhasePersonaSnapshot,
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
};