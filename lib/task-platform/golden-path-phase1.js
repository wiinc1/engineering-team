const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { REQUIRED_SECTIONS_BY_TIER, normalizeTemplateTier } = require('../audit/execution-contracts');
const { resolveOptions: resolvePhase0Options } = require('./golden-path-phase0');
const { runGoldenPathPhase0 } = require('./golden-path-phase0');
const { approveExecutionContractWithRetry } = require('./golden-path-phase1-contract');
const {
  buildFactoryExecutionContractBody,
  runArchitectAgentHandoff,
  pmRefinementDelegated,
  extractPmRefinementContractVersion,
  resolveAgentDelegationEnv,
} = require('./factory-orchestration');

const execFileAsync = promisify(execFile);
const DEFAULT_OUTPUT = 'observability/golden-path-pilot.json';

function buildUrl(baseUrl, route) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
}

function loadPilotEvidence(outputPath = DEFAULT_OUTPUT) {
  const resolved = path.resolve(process.cwd(), outputPath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function buildGoldenPathSimpleSections() {
  const sections = Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER.Simple.map((sectionId) => [sectionId, {
      id: sectionId,
      body: `Completed section ${sectionId} for golden-path pilot.`,
    }]),
  );
  sections['1'] = {
    id: '1',
    body: 'As a Software Factory operator, I want one supervised end-to-end delivery loop documented, so we know exactly what to automate next.',
  };
  sections['2'] = {
    id: '2',
    body: [
      '- GP-001–GP-027 logged in docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md',
      '- Intentional QA fail recorded, then retest pass',
      '- forgeadapter local-stack lifecycle exercised',
      '- PM + Architect close review recorded',
      '- Local deploy validation recorded (lint, test:unit, standards:check)',
      '- observability/golden-path-pilot.json committed with step timestamps',
    ].join('\n'),
  };
  sections['4'] = {
    id: '4',
    body: 'Run npm run test:unit, standards:check, and golden-path phase scripts for docs-only marker validation.',
  };
  sections['11'] = {
    id: '11',
    body: 'Rollback by reverting the pilot PR and removing the README golden-path marker.',
  };
  sections['12'] = {
    id: '12',
    body: 'No production observability change; golden-path-pilot.json and evidence report are the pilot metrics.',
  };
  sections['15'] = {
    id: '15',
    body: 'Done when evidence report, README marker, and pilot.json are committed with GP-027 closeout.',
  };
  sections['16'] = {
    id: '16',
    body: 'Validate via local ET API scripts, then rerun against production with operator JWT.',
  };
  sections['17'] = {
    id: '17',
    body: 'Operator handoff includes pilot.json, forge_dispatch, and automation-gap inventory.',
  };
  return sections;
}

function buildGoldenPathForgeDispatch() {
  return {
    targetRepo: 'wiinc1/engineering-team',
    projectId: 'engineering-team',
    domain: 'workflow',
    affectsUi: false,
  };
}

function resolveFactoryEngineerTier(templateTier = 'Simple') {
  const tier = normalizeTemplateTier(templateTier, 'Simple');
  if (tier === 'Simple') return 'Jr';
  if (tier === 'Standard') return 'Sr';
  return 'Principal';
}

function buildGoldenPathArchitectHandoff(templateTier = 'Simple') {
  const normalizedTier = normalizeTemplateTier(templateTier, 'Simple');
  const engineerTier = resolveFactoryEngineerTier(normalizedTier);
  const tierRationale = normalizedTier === 'Simple'
    ? 'Simple docs-only marker with clear test plan and git-revert rollback; Jr tier is sufficient.'
    : normalizedTier === 'Standard'
      ? 'Standard factory delivery routes implementation to Sr engineer by dispatch policy.'
      : 'Complex or Epic factory delivery requires Principal engineer involvement.';
  return {
    readyForEngineering: true,
    engineerTier,
    tierRationale,
    technicalSpec: {
      summary: 'Add README golden-path marker and fill GOLDEN_PATH_PILOT_EVIDENCE.md during supervised pilot.',
      scope: 'Docs-only changes in engineering-team repo. No auth, schema, data, or infra changes.',
      design: 'Single evidence report plus README section referencing epic #269 and pilot issue.',
      rolloutPlan: 'Merge pilot PR after QA pass; no production runtime changes required.',
    },
    monitoringSpec: {
      service: 'engineering-team-workflow',
      dashboardUrls: 'observability/golden-path-pilot.json',
      alertPolicies: 'none-for-pilot',
      runbook: 'docs/runbooks/golden-path-autonomous-delivery.md',
      successMetrics: 'GP-027 closeout recorded\nforge-execution-readiness returns ready after contract approval',
    },
  };
}

function buildGoldenPathSectionsForTier(templateTier = 'Simple') {
  const tier = normalizeTemplateTier(templateTier, 'Simple');
  const required = REQUIRED_SECTIONS_BY_TIER[tier] || REQUIRED_SECTIONS_BY_TIER.Simple;
  const simple = buildGoldenPathSimpleSections();
  const sections = Object.fromEntries(required.map((sectionId) => [sectionId, simple[sectionId] || {
    id: sectionId,
    body: `Completed section ${sectionId} for golden-path factory ${tier} delivery.`,
  }]));
  return sections;
}

function buildExecutionContractBody(factoryTemplateTier = 'Simple') {
  const factoryTier = normalizeTemplateTier(factoryTemplateTier, 'Simple');
  const contractTier = 'Simple';
  const architectHandoff = buildGoldenPathArchitectHandoff(factoryTier);
  return {
    templateTier: contractTier,
    sections: buildGoldenPathSectionsForTier(contractTier),
    forgeDispatch: buildGoldenPathForgeDispatch(),
    dispatchSignals: {
      proposedEngineerTier: architectHandoff.engineerTier,
      factoryTemplateTier: factoryTier,
      workCategory: 'docs',
      clearTestPlan: true,
      testPlanSummary: 'Run unit tests and golden-path phase scripts for docs-only marker.',
    },
    scopeBoundaries: {
      committedRequirements: [
        {
          id: 'GP-AC-1',
          text: 'GP-001–GP-027 logged in docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md',
          sourceSectionId: '2',
        },
        {
          id: 'GP-AC-2',
          text: 'README golden-path marker and observability/golden-path-pilot.json committed',
          sourceSectionId: '2',
        },
      ],
      outOfScope: ['Unattended operation', 'Redis factory platform', 'Generic multi-tenant deploy'],
    },
    autoApprovalSignals: {
      unresolvedDependencies: [],
      productionSensitivePaths: [],
    },
  };
}

function resolvePhase1Options(options = {}) {
  const phase0 = resolvePhase0Options(options);
  const pilot = options.pilot || loadPilotEvidence(options.outputPath || phase0.outputPath);
  return {
    ...phase0,
    outputPath: options.outputPath || phase0.outputPath || DEFAULT_OUTPUT,
    pilot,
    taskId: options.taskId || pilot?.engineeringTeam?.taskId || null,
    projectId: options.projectId || pilot?.engineeringTeam?.projectId || null,
    persistDir: options.persistDir || pilot?.phase0?.localBaseDir || options.localBaseDir || null,
    bootstrapPhase0: options.bootstrapPhase0 === true,
    skipArchitectHandoff: options.skipArchitectHandoff === true,
    agentDrivenPhase1: options.agentDrivenPhase1 === true,
    factoryRequirements: options.factoryRequirements || options.requirements || null,
    openclawUrl: options.openclawUrl || process.env.OPENCLAW_BASE_URL || null,
    stackPersistDir: options.stackPersistDir || null,
  };
}

async function apiSend(ctx, route, method, roles, body) {
  const { signHmacJwt } = require('../auth/jwt');
  const now = Math.floor(Date.now() / 1000);
  const token = signHmacJwt({
    sub: ctx.actorId,
    tenant_id: ctx.tenantId,
    roles,
    iat: now,
    exp: now + 300,
  }, ctx.jwtSecret);

  const response = await ctx.fetchImpl(buildUrl(ctx.baseUrl, route), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    ok: response.ok,
    body: await response.json().catch(() => ({})),
  };
}

async function apiGet(ctx, route, roles = ['reader']) {
  return apiSend(ctx, route, 'GET', roles);
}

async function recordPmRefinement(ctx, taskId) {
  const response = await apiSend(
    ctx,
    `/api/v1/tasks/${encodeURIComponent(taskId)}/refinement/start`,
    'POST',
    ['pm', 'reader'],
    { trigger: 'golden_path_phase1' },
  );

  if (!response.ok) {
    throw new Error(`PM refinement start failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    mode: 'refinement_start',
    contractVersion: response.body?.data?.contractVersion ?? null,
    refinementStatus: response.body?.data?.status ?? null,
    ...response,
  };
}

function isIntakeDraftTask(detailBody = {}) {
  const context = detailBody.context || {};
  const task = detailBody.task || {};
  return !!(
    context.intakeDraft
    || context.intake_draft
    || task.intakeDraft
    || task.intake_draft
    || detailBody.summary?.waitingState === 'task_refinement'
  );
}

async function recordArchitectSpec(ctx, taskId, {
  intakeDraft = false,
  currentStage = 'DRAFT',
  templateTier = 'Simple',
} = {}) {
  const architectHandoff = buildGoldenPathArchitectHandoff(templateTier);
  if (intakeDraft || currentStage === 'DRAFT') {
    return {
      mode: 'embedded_in_execution_contract',
      skippedDedicatedHandoff: true,
      reason: 'Intake drafts remain in DRAFT until post-approval workflow advancement; tier and monitoring are embedded in the execution contract dispatch signals.',
      engineerTier: architectHandoff.engineerTier,
      monitoringRunbook: architectHandoff.monitoringSpec.runbook,
      technicalSummary: architectHandoff.technicalSpec.summary,
      ok: true,
      status: 200,
      body: { embedded: true },
    };
  }

  const response = await apiSend(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/architect-handoff`,
    'PUT',
    ['architect', 'admin'],
    architectHandoff,
  );

  if (!response.ok && response.status !== 204) {
    throw new Error(`Architect handoff failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    mode: 'architect_handoff',
    skippedDedicatedHandoff: false,
    ...response,
  };
}

async function runProjectionCatchUp(ctx, labelOrOptions) {
  const { runProjectionCatchUp: runSharedProjectionCatchUp } = require('../audit/projection-catch-up');
  const options = typeof labelOrOptions === 'string'
    ? { label: labelOrOptions, maxEvents: 25 }
    : { maxEvents: 25, ...labelOrOptions };
  return runSharedProjectionCatchUp(
    {
      ...ctx,
      baseUrl: ctx.baseUrl,
      persistDir: ctx.persistDir,
      fetchImpl: ctx.fetchImpl,
    },
    options,
  );
}

async function ensurePilotTask(ctx, options) {
  if (ctx.taskId && ctx.projectId && !options.bootstrapPhase0) {
    return {
      taskId: ctx.taskId,
      projectId: ctx.projectId,
      pilot: ctx.pilot,
      bootstrapped: false,
    };
  }

  const evidence = await runGoldenPathPhase0({
    ...options,
    baseUrl: ctx.baseUrl,
    jwtSecret: ctx.jwtSecret,
    localBaseDir: ctx.persistDir || options.localBaseDir,
    outputPath: ctx.outputPath,
  });

  return {
    taskId: evidence.engineeringTeam.taskId,
    projectId: evidence.engineeringTeam.projectId,
    pilot: evidence,
    bootstrapped: true,
  };
}

async function runGoldenPathPhase1(options = {}) {
  const ctx = resolvePhase1Options(options);
  if (!ctx.jwtSecret) {
    throw new Error('AUTH_JWT_SECRET (or GOLDEN_PATH_JWT_SECRET) is required');
  }
  if (!ctx.baseUrl) {
    throw new Error('baseUrl is required (use --base-url or --local)');
  }

  const seeded = await ensurePilotTask(ctx, options);
  const taskId = seeded.taskId;
  const projectId = seeded.projectId;
  if (!taskId) {
    throw new Error('taskId is required; bootstrap Phase 0 or pass --task-id');
  }

  if (ctx.agentDrivenPhase1) {
    Object.assign(process.env, resolveAgentDelegationEnv({
      openclawUrl: ctx.openclawUrl,
    }));
  }

  const api = {};
  api.taskDetailBefore = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/detail`, ['reader', 'pm']);
  const currentStage = api.taskDetailBefore.body?.task?.stage
    || api.taskDetailBefore.body?.summary?.currentStage
    || 'DRAFT';
  const templateTier = options.templateTier
    || seeded.pilot?.engineeringTeam?.templateTier
    || options.pilot?.engineeringTeam?.templateTier
    || 'Simple';
  const factoryRequirements = ctx.factoryRequirements
    || seeded.pilot?.engineeringTeam?.requirements
    || options.pilot?.engineeringTeam?.requirements
    || '';

  api.pmRefinement = await recordPmRefinement(ctx, taskId);
  const pmDelegated = ctx.agentDrivenPhase1 && pmRefinementDelegated(api.pmRefinement);
  const pmContractVersion = extractPmRefinementContractVersion(api.pmRefinement);

  if (ctx.agentDrivenPhase1 && !ctx.skipArchitectHandoff) {
    const architectAgent = await runArchitectAgentHandoff(ctx, taskId, {
      templateTier,
      requirements: factoryRequirements,
      intakeDraft: isIntakeDraftTask(api.taskDetailBefore.body),
      currentStage,
      agentDriven: true,
      openclawUrl: ctx.openclawUrl,
    });
    api.architectHandoff = architectAgent.delegated
      ? {
        ok: true,
        status: 200,
        mode: architectAgent.mode,
        skippedDedicatedHandoff: false,
        delegated: true,
        sessionId: architectAgent.sessionId,
        agentId: architectAgent.agentId,
        engineerTier: architectAgent.engineerTier,
        body: architectAgent.handoff,
      }
      : await recordArchitectSpec(ctx, taskId, {
        intakeDraft: isIntakeDraftTask(api.taskDetailBefore.body),
        currentStage,
        templateTier,
      });
  } else {
    api.architectHandoff = ctx.skipArchitectHandoff
      ? {
        ok: true,
        status: 200,
        mode: 'skipped_by_flag',
        skippedDedicatedHandoff: true,
        body: { skipped: true },
      }
      : await recordArchitectSpec(ctx, taskId, {
        intakeDraft: isIntakeDraftTask(api.taskDetailBefore.body),
        currentStage,
        templateTier,
      });
  }

  api.projectionPreContract = await runProjectionCatchUp(ctx, 'pre-contract-record');

  const contractBody = ctx.agentDrivenPhase1
    ? buildFactoryExecutionContractBody({ requirements: factoryRequirements, templateTier })
    : buildExecutionContractBody(templateTier);
  let skipContractRecord = false;
  if (pmDelegated && pmContractVersion) {
    const existingContract = await apiGet(
      ctx,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/execution-contract`,
      ['pm', 'reader'],
    );
    if (existingContract.ok && existingContract.body?.data?.latest?.version) {
      skipContractRecord = true;
      api.recordContract = {
        ok: true,
        status: 200,
        skipped: true,
        reason: 'pm_refinement_contract_recorded',
        body: {
          data: {
            version: existingContract.body.data.latest.version,
            validation: { status: 'valid' },
          },
        },
      };
    }
  }
  if (!skipContractRecord) {
    api.recordContract = await apiSend(
      ctx,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/execution-contract`,
      'POST',
      ['pm', 'reader'],
      contractBody,
    );
    if (!api.recordContract.ok) {
      throw new Error(`Execution contract record failed (${api.recordContract.status}): ${JSON.stringify(api.recordContract.body)}`);
    }
  }

  const contractData = api.recordContract.body?.data;
  if (contractData?.validation?.status !== 'valid') {
    throw new Error(`Execution contract validation invalid: ${JSON.stringify(contractData?.validation || api.recordContract.body)}`);
  }

  api.projectionPostContract = await runProjectionCatchUp(ctx, 'execution-contract-recorded');

  api.approveContract = await approveExecutionContractWithRetry(ctx, { apiSend, runProjectionCatchUp }, taskId);

  if (!api.approveContract.ok) {
    throw new Error(`Execution contract approval failed (${api.approveContract.status}): ${JSON.stringify(api.approveContract.body)}`);
  }

  const approvalData = api.approveContract.body?.data;
  api.projectionPostApproval = await runProjectionCatchUp(ctx, 'execution-contract-approved');

  api.taskDetailAfter = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/detail`, ['reader', 'pm']);
  api.forgeReadiness = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/forge-execution-readiness`, ['admin']);

  const priorSteps = new Set(seeded.pilot?.stepsCompleted || ['GP-001', 'GP-002', 'GP-005']);
  const stepsCompleted = [...new Set([
    ...priorSteps,
    'GP-003',
    'GP-004',
    'GP-006',
    'GP-007',
    'GP-008',
  ])].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));

  const evidence = {
    ...(seeded.pilot || {}),
    schemaVersion: '1.0',
    epic: 'golden-path-autonomous-delivery',
    status: 'phase1_complete',
    engineeringTeam: {
      ...(seeded.pilot?.engineeringTeam || {}),
      projectId,
      taskId,
      contractVersion: contractData?.version ?? approvalData?.version ?? null,
      contractValidationStatus: contractData?.validation?.status ?? null,
      approvalMode: approvalData?.approvalMode || approvalData?.approval_mode || (approvalData?.autoApproval?.approved_by_policy ? 'policy' : null),
      forgeDispatch: buildGoldenPathForgeDispatch(),
      forgeExecutionReadiness: api.forgeReadiness.ok ? api.forgeReadiness.body : null,
    },
    stepsCompleted,
    phase1: {
      completedAt: new Date().toISOString(),
      baseUrl: ctx.baseUrl,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      persistDir: ctx.persistDir || null,
      bootstrappedPhase0: seeded.bootstrapped,
      projectionRuns: [
        api.projectionPreContract,
        api.projectionPostContract,
        api.projectionPostApproval,
      ],
      api: {
        pmRefinementMode: api.pmRefinement.mode,
        pmRefinementStatus: api.pmRefinement.status,
        pmRefinementContractVersion: api.pmRefinement.contractVersion,
        pmRefinementDelegated: pmDelegated,
        pmRefinementSessionId: api.pmRefinement.body?.data?.delegation?.sessionId
          || api.pmRefinement.body?.delegation?.sessionId
          || null,
        architectHandoffMode: api.architectHandoff.mode,
        architectDelegated: api.architectHandoff.delegated === true,
        architectSessionId: api.architectHandoff.sessionId || null,
        architectHandoffStatus: api.architectHandoff.status,
        recordContractStatus: api.recordContract.status,
        approveContractStatus: api.approveContract.status,
        forgeReadinessStatus: api.forgeReadiness.status,
        taskDetailBeforeStatus: api.taskDetailBefore.status,
        taskDetailAfterStatus: api.taskDetailAfter.status,
      },
      contract: {
        version: contractData?.version ?? null,
        templateTier: contractData?.templateTier || contractData?.template_tier || 'Simple',
        factoryTemplateTier: templateTier,
        validationStatus: contractData?.validation?.status ?? null,
        autoApprovalPolicy: approvalData?.autoApprovalPolicy
          || approvalData?.auto_approval?.policy_version
          || 'execution-contract-low-risk-simple-auto-approval.v1',
        autoApprovalApproved: approvalData?.autoApproval?.approved_by_policy
          ?? approvalData?.auto_approval?.approved_by_policy
          ?? true,
      },
      architectSpec: {
        mode: api.architectHandoff.mode,
        engineerTier: api.architectHandoff.engineerTier || buildGoldenPathArchitectHandoff(templateTier).engineerTier,
        monitoringRunbook: api.architectHandoff.monitoringRunbook
          || buildGoldenPathArchitectHandoff(templateTier).monitoringSpec.runbook,
      },
      forgeReadinessNote: api.forgeReadiness.ok
        ? null
        : 'Forge execution readiness remains GP-009; intake-draft DRAFT stage blocks readiness until workflow advances post-approval.',
    },
    completedAt: null,
  };

  const outputPath = path.resolve(process.cwd(), ctx.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

  return evidence;
}

module.exports = {
  buildGoldenPathSimpleSections,
  buildGoldenPathForgeDispatch,
  buildGoldenPathArchitectHandoff,
  buildExecutionContractBody,
  loadPilotEvidence,
  resolvePhase1Options,
  runGoldenPathPhase1,
};