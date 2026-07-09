#!/usr/bin/env node

const { apiSend, apiGet } = require('../lib/task-platform/golden-path-shared');
const { runProjectionCatchUp } = require('../lib/audit/projection-catch-up');

const TASK_ID = process.env.TSK_ADVANCE_TASK_ID || 'TSK-001';
const COMMIT_SHA = process.env.TSK_UX_COMMIT_SHA || 'd4dee277afa765f184a812b102849dfae9f8cea7';
const PR_NUMBER = Number(process.env.TSK_CLOSEOUT_PR_NUMBER || 280);
const PR_URL = process.env.TSK_CLOSEOUT_PR_URL || `https://github.com/wiinc1/engineering-team/pull/${PR_NUMBER}`;
const BASE_URL = (process.env.ENGINEERING_TEAM_BASE_URL || 'http://127.0.0.1:13000').replace(/\/+$/, '');
const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret';

const ctx = {
  baseUrl: BASE_URL,
  jwtSecret: JWT_SECRET,
  tenantId: 'engineering-team',
  actorId: 'golden-path-operator',
  fetchImpl: globalThis.fetch,
};

async function catchUp() {
  await runProjectionCatchUp({ ...ctx, persistDir: process.cwd() }, { maxEvents: 50 }).catch(() => null);
}

async function readState() {
  const state = await apiGet(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/state`, ['reader', 'admin']);
  if (!state.ok) {
    throw new Error(`Failed to read state (${state.status}): ${JSON.stringify(state.body)}`);
  }
  return state.body;
}

async function readSreDetail() {
  const detail = await apiGet(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/detail`, ['reader', 'admin']);
  const body = detail.body?.data || detail.body || {};
  return body?.context?.sreMonitoring || body?.sre_monitoring || {};
}

async function recordStage(from, to) {
  const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/events`, 'POST', ['admin', 'pm'], {
    eventType: 'task.stage_changed',
    actorType: 'agent',
    idempotencyKey: `tsk-closeout:${TASK_ID}:${from}:${to}:${Date.now()}`,
    payload: { from_stage: from, to_stage: to },
  });
  if (!response.ok) {
    throw new Error(`Stage transition ${from} -> ${to} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  await catchUp();
}

async function waitForMergedLinkedPr() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await catchUp();
    const linkedPrs = (await readSreDetail()).linkedPrs || [];
    if (linkedPrs.some((pr) => pr.merged)) return linkedPrs;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Merged linked PR did not project for ${TASK_ID}`);
}

async function waitForSreMonitoringStarted() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await catchUp();
    const sreDetail = await readSreDetail();
    if (sreDetail.windowStartedAt) return sreDetail;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SRE monitoring start did not project for ${TASK_ID}`);
}

async function waitForStage(expectedStage) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await catchUp();
    const state = await readState();
    if (state.current_stage === expectedStage) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const state = await readState();
  throw new Error(`Expected stage ${expectedStage}; found ${state.current_stage}`);
}

async function readCloseGovernance() {
  const detail = await apiGet(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/detail`, ['reader', 'admin']);
  const body = detail.body?.data || detail.body || {};
  return body?.context?.closeGovernance || body?.close_governance || {};
}

async function waitForHumanCloseDecisionReady() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await catchUp();
    const closeGovernance = await readCloseGovernance();
    const recommendations = closeGovernance?.cancellation?.recommendations || {};
    if (recommendations.pm?.occurredAt && recommendations.architect?.occurredAt) {
      return closeGovernance;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`PM and Architect close recommendations did not project for ${TASK_ID}`);
}

async function step(name, fn) {
  const result = await fn();
  console.log(`[${name}]`, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  console.log('[initial]', await readState());
  const initialSre = await readSreDetail();

  if (!initialSre.windowStartedAt) {
    const prSyncedAt = new Date().toISOString();
    await step('prSync', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/events`, 'POST', ['admin'], {
        eventType: 'task.github_pr_synced',
        actorType: 'agent',
        idempotencyKey: `tsk-001-closeout:pr-merged:${COMMIT_SHA.slice(0, 12)}`,
        payload: {
          pr_number: PR_NUMBER,
          pr_title: 'TSK-001 Command Center UX delivery',
          state: 'closed',
          pr_state: 'merged',
          pr_merged: true,
          pr_repository: 'wiinc1/engineering-team',
          merge_commit_sha: COMMIT_SHA,
          pr_url: PR_URL,
          pr_updated_at: prSyncedAt,
          linked_prs: [{
            number: PR_NUMBER,
            url: PR_URL,
            title: 'TSK-001 Command Center UX delivery',
            repository: 'wiinc1/engineering-team',
            state: 'merged',
            merged: true,
            updated_at: prSyncedAt,
          }],
        },
      });
      if (!response.ok) {
        throw new Error(`prSync failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      return { status: response.status, linkedPrs: (await readSreDetail()).linkedPrs };
    });

    await step('waitMergedPr', async () => waitForMergedLinkedPr());

    await step('sreStart', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/sre-monitoring/start`, 'POST', ['sre', 'admin'], {
        deploymentEnvironment: 'local',
        deploymentUrl: 'http://127.0.0.1:15173',
        deploymentVersion: COMMIT_SHA,
        deploymentStatus: 'success',
        evidence: ['TSK-001 golden-path local closeout.', `PR ${PR_URL} merged.`],
      });
      if (!response.ok) {
        throw new Error(`sreStart failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      return { status: response.status, sre: await readSreDetail() };
    });

    await step('waitSreStarted', async () => waitForSreMonitoringStarted());
  } else {
    console.log('[sreStart] skipped — window already started');
  }

  const sreBeforeApprove = await readSreDetail();
  if (sreBeforeApprove.state !== 'approved' && !sreBeforeApprove.approval?.approvedAt) {
    await step('sreApprove', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/sre-monitoring/approve`, 'POST', ['sre', 'admin'], {
        reason: 'TSK-001 local golden-path closeout: no telemetry regressions observed.',
        evidence: ['QA retest pass.', 'Product delivery verified.', 'Local stack healthy.'],
      });
      if (!response.ok) {
        throw new Error(`sreApprove failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      return { status: response.status, sre: await readSreDetail() };
    });
  } else {
    console.log('[sreApprove] skipped — already approved');
  }

  let stage = (await readState()).current_stage;
  if (stage === 'SRE_MONITORING') {
    await step('advancePmClose', async () => {
      await recordStage('SRE_MONITORING', 'PM_CLOSE_REVIEW');
      return { currentStage: 'PM_CLOSE_REVIEW', state: await waitForStage('PM_CLOSE_REVIEW') };
    });
    stage = 'PM_CLOSE_REVIEW';
  }

  const afterAdvance = await readState();
  if ((afterAdvance.current_stage === 'PM_CLOSE_REVIEW' || stage === 'PM_CLOSE_REVIEW') && !afterAdvance.closed) {
    await step('pmClose', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/close-review/cancellation-recommendation`, 'POST', ['pm', 'admin'], {
        summary: 'TSK-001 ready for close.',
        rationale: 'UX delivery verified; QA pass; SRE monitoring approved.',
        recommendation: 'close',
      });
      if (!response.ok) {
        throw new Error(`pmClose failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      return { status: response.status };
    });

    await step('architectClose', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/close-review/cancellation-recommendation`, 'POST', ['architect', 'admin'], {
        summary: 'Architect confirms TSK-001 technical scope complete.',
        rationale: 'Command Center UX behavior-only delivery meets contract.',
        recommendation: 'close',
      });
      if (!response.ok) {
        throw new Error(`architectClose failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      return { status: response.status };
    });

    await step('waitCloseRecommendations', async () => waitForHumanCloseDecisionReady());

    await step('humanClose', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/close-review/human-decision`, 'POST', ['admin'], {
        outcome: 'approve',
        summary: 'TSK-001 human closeout approved.',
        rationale: 'Golden-path local proof: product delivery verified end-to-end.',
        confirmationRequired: false,
      });
      if (!response.ok) {
        throw new Error(`humanClose failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      return { status: response.status, state: await readState() };
    });
  }

  let finalState = await readState();
  if (!finalState.closed && finalState.current_stage !== 'DONE') {
    await step('taskClosed', async () => {
      const response = await apiSend(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/events`, 'POST', ['admin'], {
        eventType: 'task.closed',
        actorType: 'agent',
        idempotencyKey: 'tsk-001-closeout:closed',
        payload: {
          reason: 'TSK-001 golden-path local closeout complete.',
        },
      });
      if (!response.ok) {
        throw new Error(`taskClosed failed (${response.status}): ${JSON.stringify(response.body)}`);
      }
      await catchUp();
      finalState = await waitForStage('DONE').catch(async () => readState());
      return { status: response.status, state: finalState };
    });
    finalState = await readState();
  }

  console.log('[done]', JSON.stringify({
    taskId: TASK_ID,
    stage: finalState.current_stage,
    closed: finalState.closed,
    waitingState: finalState.waiting_state,
    nextRequiredAction: finalState.next_required_action,
    qaOutcome: finalState.latest_qa_outcome,
    submissionVersion: finalState.implementation_submission_version,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});