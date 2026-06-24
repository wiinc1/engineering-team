const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const { createSpecialistCoordinator } = require('../software-factory/delegation');
const {
  normalizeTemplateTier,
  REQUIRED_SECTIONS_BY_TIER,
} = require('../audit/execution-contracts');
function goldenPathPhase1() {
  return require('./golden-path-phase1');
}

const DEFAULT_DELEGATION_RUNNER = `node ${path.resolve(process.cwd(), 'scripts/openclaw-specialist-runner.js')}`;
const FIXTURE_DELEGATION_RUNNER = `node ${path.resolve(process.cwd(), 'tests/fixtures/specialist-runtime-runner.js')}`;

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveAgentDelegationRunner(options = {}) {
  if (options.delegationRunner) return options.delegationRunner;
  if (process.env.SPECIALIST_DELEGATION_RUNNER) return process.env.SPECIALIST_DELEGATION_RUNNER;
  if (parseBooleanEnv(process.env.FACTORY_USE_FIXTURE_DELEGATION, false)) {
    return FIXTURE_DELEGATION_RUNNER;
  }
  if (parseBooleanEnv(process.env.FF_REAL_SPECIALIST_DELEGATION, false)) {
    return DEFAULT_DELEGATION_RUNNER;
  }
  return FIXTURE_DELEGATION_RUNNER;
}

function resolveAgentDelegationEnv(options = {}) {
  const runner = resolveAgentDelegationRunner(options);
  return {
    ...process.env,
    SPECIALIST_DELEGATION_RUNNER: runner,
    FF_REAL_SPECIALIST_DELEGATION: 'true',
    ...(options.openclawUrl ? { OPENCLAW_BASE_URL: options.openclawUrl } : {}),
    ...(options.hermesUrl ? { HERMES_BASE_URL: options.hermesUrl } : {}),
  };
}

function applyForgeLifecycleEnv(forgeTaskId) {
  if (!forgeTaskId) return;
  process.env.ET_FORGE_LIFECYCLE_TASK_ID = String(forgeTaskId);
}

function buildFactoryContractSections(requirements = '', templateTier = 'Simple') {
  const tier = normalizeTemplateTier(templateTier, 'Simple');
  const required = REQUIRED_SECTIONS_BY_TIER[tier] || REQUIRED_SECTIONS_BY_TIER.Simple;
  const pilotSections = goldenPathPhase1().buildGoldenPathSimpleSections();
  const acceptanceLines = String(requirements || '').trim().split(/\n+/).filter(Boolean);
  const sections = Object.fromEntries(required.map((sectionId) => {
    if (sectionId === '1') {
      return [sectionId, {
        id: sectionId,
        body: acceptanceLines[0] || 'Factory delivery requirement from operator intake.',
      }];
    }
    if (sectionId === '2') {
      return [sectionId, {
        id: sectionId,
        body: acceptanceLines.length
          ? acceptanceLines.map((line, index) => `- [ ] ${line}`).join('\n')
          : '- [ ] Factory delivery acceptance criteria recorded from intake.',
      }];
    }
    if (sectionId === '4') {
      return [sectionId, {
        id: sectionId,
        body: 'Run npm run test:unit, standards:check, and factory validation scripts.',
      }];
    }
    return [sectionId, pilotSections[sectionId] || {
      id: sectionId,
      body: `Completed section ${sectionId} for factory ${tier} delivery.`,
    }];
  }));
  return sections;
}

function buildFactoryExecutionContractBody({ requirements, templateTier = 'Simple' } = {}) {
  const factoryTier = normalizeTemplateTier(templateTier, 'Simple');
  const architectHandoff = goldenPathPhase1().buildGoldenPathArchitectHandoff(factoryTier);
  const acceptanceLines = String(requirements || '').trim().split(/\n+/).filter(Boolean);
  return {
    templateTier: 'Simple',
    sections: buildFactoryContractSections(requirements, factoryTier),
    forgeDispatch: goldenPathPhase1().buildGoldenPathForgeDispatch(),
    dispatchSignals: {
      proposedEngineerTier: architectHandoff.engineerTier,
      factoryTemplateTier: factoryTier,
      workCategory: 'docs',
      clearTestPlan: true,
      testPlanSummary: 'Run unit tests, standards:check, and factory orchestrator validation.',
    },
    scopeBoundaries: {
      committedRequirements: acceptanceLines.slice(0, 5).map((text, index) => ({
        id: `FAC-AC-${index + 1}`,
        text,
        sourceSectionId: '2',
      })),
      outOfScope: ['Unattended operation', 'Redis factory platform'],
    },
    autoApprovalSignals: {
      unresolvedDependencies: [],
      productionSensitivePaths: [],
    },
  };
}

function createFactoryAgentCoordinator(options = {}) {
  const runner = resolveAgentDelegationRunner(options);
  return createSpecialistCoordinator({
    baseDir: process.cwd(),
    delegationRunnerCommand: runner,
    delegateWork: options.delegateWork,
  });
}

async function delegateFactorySpecialist(specialist, request, options = {}) {
  const coordinator = createFactoryAgentCoordinator(options);
  const result = await coordinator.handleRequest(request, {
    coordinatorAgent: options.actorId || 'factory-orchestrator',
    targetSpecialist: specialist,
    taskId: options.taskId || null,
    engineerTier: options.engineerTier || null,
    ownerAgentId: options.ownerAgentId || null,
  });
  return {
    ...result,
    sessionId: result.metadata?.sessionId || result.sessionId || null,
    agentId: result.agentId || result.metadata?.agentId || result.attribution?.handledBy || null,
    message: result.message || result.output || null,
    delegated: result.attribution?.delegated === true,
    specialist,
  };
}

function buildArchitectHandoffFromDelegation(templateTier = 'Simple', delegation = {}) {
  const base = goldenPathPhase1().buildGoldenPathArchitectHandoff(templateTier);
  const output = String(delegation.message || delegation.output || '').trim();
  return {
    readyForEngineering: true,
    engineerTier: base.engineerTier,
    tierRationale: output || base.tierRationale,
    technicalSpec: {
      ...base.technicalSpec,
      summary: output ? output.slice(0, 500) : base.technicalSpec.summary,
    },
    monitoringSpec: base.monitoringSpec,
    agentDelegation: {
      delegated: delegation.delegated === true,
      sessionId: delegation.sessionId || null,
      agentId: delegation.agentId || null,
      specialist: 'architect',
    },
  };
}

async function runArchitectAgentHandoff(ctx, taskId, {
  templateTier = 'Simple',
  requirements = '',
  intakeDraft = false,
  currentStage = 'DRAFT',
  agentDriven = false,
  openclawUrl,
} = {}) {
  if (!agentDriven || intakeDraft || currentStage === 'DRAFT') {
    return {
      mode: 'embedded_in_execution_contract',
      skippedDedicatedHandoff: true,
      delegated: false,
      sessionId: null,
      engineerTier: goldenPathPhase1().buildGoldenPathArchitectHandoff(templateTier).engineerTier,
    };
  }

  const delegation = await delegateFactorySpecialist('architect', [
    `You are the Architect agent for task ${taskId}.`,
    'Produce a concise technical spec and monitoring plan for factory delivery.',
    `Template tier: ${templateTier}`,
    'Requirements:',
    requirements || '(none provided)',
  ].join('\n'), {
    taskId,
    actorId: ctx.actorId,
    openclawUrl,
    baseDir: ctx.stackPersistDir || process.cwd(),
  });

  return {
    mode: delegation.delegated ? 'architect_agent_delegation' : 'architect_handoff_fallback',
    skippedDedicatedHandoff: false,
    delegated: delegation.delegated,
    sessionId: delegation.sessionId,
    agentId: delegation.agentId,
    handoff: buildArchitectHandoffFromDelegation(templateTier, delegation),
    engineerTier: buildGoldenPathArchitectHandoff(templateTier).engineerTier,
  };
}

async function seedPilotAgentsOnIntake(baseUrl) {
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', 'pilot:agents:seed'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_PUBLIC_APP_URL: baseUrl,
        PROJECTS_PROD_BASE_URL: baseUrl,
      },
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: error.code,
    };
  }
}

function pmRefinementDelegated(pmRefinementResponse = {}) {
  const body = pmRefinementResponse.body || {};
  const data = body.data || body;
  const delegation = data.delegation || body.delegation || null;
  return delegation?.delegated === true
    || data.status === 'completed'
    || body.status === 'completed';
}

function extractPmRefinementContractVersion(pmRefinementResponse = {}) {
  const body = pmRefinementResponse.body || {};
  const data = body.data || body;
  return data.contract?.version
    || data.contractVersion
    || body.contractVersion
    || null;
}

module.exports = {
  DEFAULT_DELEGATION_RUNNER,
  FIXTURE_DELEGATION_RUNNER,
  parseBooleanEnv,
  resolveAgentDelegationRunner,
  resolveAgentDelegationEnv,
  applyForgeLifecycleEnv,
  buildFactoryContractSections,
  buildFactoryExecutionContractBody,
  createFactoryAgentCoordinator,
  delegateFactorySpecialist,
  buildArchitectHandoffFromDelegation,
  runArchitectAgentHandoff,
  seedPilotAgentsOnIntake,
  pmRefinementDelegated,
  extractPmRefinementContractVersion,
};