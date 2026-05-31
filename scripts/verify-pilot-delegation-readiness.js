#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { buildOrchestrationView, evaluateOrchestrationStart } = require('../lib/audit/orchestration');
const { createTaskPlatformService } = require('../lib/task-platform');
const { ensurePilotAgents } = require('../lib/task-platform/pilot-agents');

const EXPECTED_OPENCLAW_RUNNER = 'node scripts/openclaw-specialist-runner.js';
const DEFAULT_PROOF_TASK_TITLE = 'Implement a no-op app-dispatched delegation proof by replying OK only. Do not inspect or edit files.';

function isEnabled(value) {
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(value ?? '').trim().toLowerCase());
}

function resolveBaseDir(options = {}, env = process.env) {
  return path.resolve(options.baseDir || env.PILOT_DELEGATION_BASE_DIR || process.cwd());
}

function resolveRuntimeConfig(options = {}, env = process.env) {
  const ffRealSpecialistDelegation = options.ffRealSpecialistDelegation ?? env.FF_REAL_SPECIALIST_DELEGATION;
  const runnerCommand = options.runnerCommand ?? env.SPECIALIST_DELEGATION_RUNNER;
  return {
    ffRealSpecialistDelegation,
    specialistDelegationRunner: runnerCommand || null,
    expectedRunner: EXPECTED_OPENCLAW_RUNNER,
    enabled: isEnabled(ffRealSpecialistDelegation),
    runnerConfigured: !!String(runnerCommand || '').trim(),
    usesExpectedOpenClawRunner: String(runnerCommand || '').trim() === EXPECTED_OPENCLAW_RUNNER,
  };
}

function assertRuntimeConfig(config, options = {}) {
  if (!config.enabled) {
    throw new Error('FF_REAL_SPECIALIST_DELEGATION must be enabled for pilot delegation readiness');
  }
  if (!config.runnerConfigured) {
    throw new Error('SPECIALIST_DELEGATION_RUNNER must be configured for pilot delegation readiness');
  }
  if (!options.allowAlternateRunner && !config.usesExpectedOpenClawRunner) {
    throw new Error(`SPECIALIST_DELEGATION_RUNNER must be '${EXPECTED_OPENCLAW_RUNNER}' for target pilot readiness`);
  }
}

function writeEvidence(baseDir, evidence, outputPath) {
  const resolved = outputPath
    ? path.resolve(outputPath)
    : path.join(baseDir, 'observability', 'pilot-delegation-readiness.json');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`);
  return resolved;
}

function appDispatchEvidenceFromRun(run) {
  const item = run.items.find(candidate => candidate.lastDispatchAt) || run.items[0] || {};
  return {
    workflow: 'orchestration_scheduler',
    taskId: item.id || null,
    specialist: item.specialist || null,
    agentId: item.actualAgent || null,
    sessionId: item.sessionId || null,
    delegationArtifactPath: item.delegationArtifactPath || null,
    runtimeAttribution: item.runtimeAttribution || null,
    delegated: item.delegated === true,
    fallbackReason: item.fallbackReason || null,
    userFacingReasonCategory: item.userFacingReasonCategory || null,
    lastMessage: item.lastMessage || null,
  };
}

function assertAppDispatchEvidence(evidence) {
  if (!evidence.delegated) {
    throw new Error(`App workflow delegation was not confirmed: ${evidence.fallbackReason || 'not_delegated'}`);
  }
  if (!evidence.agentId || !evidence.sessionId || !evidence.delegationArtifactPath) {
    throw new Error('App workflow delegation evidence must include agentId, sessionId, and delegationArtifactPath');
  }
  if (evidence.runtimeAttribution?.delegated !== true) {
    throw new Error('App workflow runtime attribution must be truthfully delegated');
  }
}

function createReadinessContext(options = {}) {
  const env = options.env || process.env;
  return {
    options,
    env,
    baseDir: resolveBaseDir(options, env),
    tenantId: options.tenantId || env.TENANT_ID || 'engineering-team',
    actorId: options.actorId || env.PILOT_AGENT_SEED_ACTOR_ID || 'system:pilot-readiness',
    runtimeConfig: resolveRuntimeConfig(options, env),
  };
}

function createReadinessTaskPlatform({ options, env, baseDir }) {
  return options.taskPlatform || createTaskPlatformService({
    baseDir,
    taskPlatformBackend: options.taskPlatformBackend || env.TASK_PLATFORM_BACKEND,
    connectionString: options.connectionString || env.DATABASE_URL,
    agentRegistry: [],
  });
}

async function seedAndAssertPilotAgents(context) {
  const taskPlatform = createReadinessTaskPlatform(context);
  const pilotAgents = await ensurePilotAgents({
    taskPlatform,
    tenantId: context.tenantId,
    actorId: context.actorId,
  });
  if (!pilotAgents.ok) {
    throw new Error(`Pilot AI-agent roster is incomplete: missing roles ${pilotAgents.missingRoles.join(', ')}`);
  }
  return pilotAgents;
}

function proofChildTask(taskId, title) {
  return {
    task_id: taskId,
    title,
    task_type: 'engineer',
    current_stage: 'TODO',
    closed: false,
    blocked: false,
    waiting_state: null,
  };
}

function proofRelationships(taskId, run = null) {
  return {
    child_task_ids: [taskId],
    child_dependencies: {},
    ...(run ? { orchestration_state: run } : {}),
  };
}

function readinessDispatchOptions(context) {
  return {
    baseDir: context.baseDir,
    coordinatorAgent: context.actorId,
    delegationRunnerCommand: context.runtimeConfig.specialistDelegationRunner,
    runnerEnv: context.options.runnerEnv || context.env,
  };
}

async function runReadinessDispatch(context) {
  const taskId = context.options.taskId || 'TSK-PILOT-DELEGATION-PROOF';
  const title = context.options.title || DEFAULT_PROOF_TASK_TITLE;
  const run = await evaluateOrchestrationStart({
    taskId: 'PILOT-ORCHESTRATION-PROOF',
    relationships: proofRelationships(taskId),
    childTaskSummaries: [proofChildTask(taskId, title)],
    coordinatorAgent: context.actorId,
    concurrencyLimit: 1,
    dispatchWork: context.options.dispatchWork || null,
    dispatchOptions: readinessDispatchOptions(context),
  });
  return { taskId, title, run };
}

function buildReadinessView({ taskId, title, run }) {
  return buildOrchestrationView({
    relationships: proofRelationships(taskId, run),
    childTaskSummaries: [proofChildTask(taskId, title)],
  });
}

function buildReadinessEvidence({ context, pilotAgents, appWorkflowDispatch, run, view }) {
  return {
    evidenceVersion: 'pilot-delegation-readiness.v1',
    validatedAt: new Date().toISOString(),
    targetEnvironment: context.options.targetEnvironment || context.env.PILOT_TARGET_ENVIRONMENT || context.env.VERCEL_ENV || 'local',
    tenantId: context.tenantId,
    runtimeConfig: context.runtimeConfig,
    pilotAgents,
    appWorkflowDispatch,
    orchestration: {
      run,
      view,
    },
    supervisedPilot: {
      status: 'ready_for_supervised_pilot',
      requiredCloseoutEvidenceTarget: '#242',
      manualActionClassificationRequired: true,
    },
  };
}

async function runPilotDelegationReadiness(options = {}) {
  const context = createReadinessContext(options);
  assertRuntimeConfig(context.runtimeConfig, options);
  const pilotAgents = await seedAndAssertPilotAgents(context);
  const { taskId, title, run } = await runReadinessDispatch(context);
  const view = buildReadinessView({ taskId, title, run });
  const appWorkflowDispatch = appDispatchEvidenceFromRun(run);
  assertAppDispatchEvidence(appWorkflowDispatch);
  const evidence = buildReadinessEvidence({ context, pilotAgents, appWorkflowDispatch, run, view });
  const outputPath = writeEvidence(context.baseDir, evidence, options.outputPath);
  return { evidence, outputPath };
}

async function main() {
  const { evidence, outputPath } = await runPilotDelegationReadiness();
  process.stdout.write(`${JSON.stringify({ outputPath, evidence }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_OPENCLAW_RUNNER,
  DEFAULT_PROOF_TASK_TITLE,
  appDispatchEvidenceFromRun,
  assertAppDispatchEvidence,
  assertRuntimeConfig,
  resolveRuntimeConfig,
  runPilotDelegationReadiness,
};
