'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  extractLiveSessions,
  buildSimpleTrustedCohort,
  buildSimpleTrustedCohortFromRepo,
  DEFAULT_BAR,
  COHORT_POLICY_VERSION,
  calculateCohortResidual,
} = require('../../lib/task-platform/simple-trusted-cohort');
const { buildTrustedSimpleCloseEvidence } = require('../../lib/task-platform/trusted-simple-close-evidence');

function prospectiveProvenance() {
  return {
    humanReviewProvenance: {
      eventId: 'review-1', eventType: 'task.pm_architect_human_review_recorded',
      recordedAt: '2026-08-19T17:59:00.000Z', roles: {
        pm: { actorId: 'operator-1', actorType: 'human', reviewedAt: '2026-08-19T17:59:00.000Z', eventId: 'review-1' },
        architect: { actorId: 'operator-1', actorType: 'human', reviewedAt: '2026-08-19T17:59:00.000Z', eventId: 'review-1' },
      },
    },
    approvalProvenance: {
      eventId: 'approval-1', eventType: 'task.execution_contract_approved',
      approvedAt: '2026-08-19T18:00:00.000Z', approvalMode: 'policy',
    },
  };
}

  it('extracts live specialist-delegation session ids', () => {
    const sessions = extractLiveSessions({
      a: 'specialist-delegation-6eeeca15-04e1-46ff-bbb2-2e0137035f58',
      b: ['specialist-delegation-3d83f334-177e-4d16-a5e5-faf8730b7f6d'],
    });
    assert.equal(sessions.length, 2);
  });

  it('marks phase6 + live sessions + zero interventions as trusted', () => {
    const cohort = buildSimpleTrustedCohort({
      closeouts: [
        {
          filePath: '/tmp/TSK-020.json',
          taskId: 'TSK-020',
          deliveryStatus: 'phase6_complete',
          generatedAt: '2026-07-10T00:00:00.000Z',
          manualInterventions: [],
          liveSessions: [],
        },
        {
          filePath: '/tmp/TSK-007.json',
          taskId: 'TSK-007',
          deliveryStatus: 'phase6_complete',
          generatedAt: '2026-06-24T00:00:00.000Z',
          manualInterventions: [],
          liveSessions: [],
        },
      ],
      factoryEvidence: [
        {
          filePath: '/tmp/ev-020.json',
          taskId: 'TSK-020',
          status: 'phase6_complete',
          liveSessions: ['specialist-delegation-6eeeca15-04e1-46ff-bbb2-2e0137035f58'],
          liveSessionCount: 1,
        },
      ],
      bar: DEFAULT_BAR,
    });
    const t020 = cohort.rows.find((r) => r.taskId === 'TSK-020');
    const t007 = cohort.rows.find((r) => r.taskId === 'TSK-007');
    assert.equal(t020.trusted, true);
    assert.equal(t007.trusted, false);
    assert.ok(t007.trustedReason.includes('missing_live_session_evidence'));
    assert.equal(cohort.summary.trustedCloses, 1);
    assert.equal(cohort.summary.barMet, false);
  });

  it('evaluates real repo observability without throwing', () => {
    const cohort = buildSimpleTrustedCohortFromRepo(process.cwd());
    assert.equal(typeof cohort.summary.trustedCloses, 'number');
    assert.ok(Array.isArray(cohort.rows));
    assert.ok(cohort.metrics);
  });

  it('discovers factory cohort evidence and filters an explicit task cohort', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-selection-'));
    const closeoutDir = path.join(root, 'observability', 'factory-closeout');
    fs.mkdirSync(closeoutDir, { recursive: true });
    for (const taskId of ['TSK-401', 'TSK-402']) {
      fs.writeFileSync(path.join(closeoutDir, `${taskId}.json`), JSON.stringify({
        taskId, deliveryStatus: 'phase6_complete', generatedAt: '2026-07-01T00:00:00.000Z',
        manualInterventions: [],
      }));
      fs.writeFileSync(
        path.join(root, 'observability', `factory-cohort-selection-${taskId}.json`),
        JSON.stringify({ taskId, status: 'phase6_complete',
          session: `specialist-delegation-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${taskId.slice(-2)}` }),
      );
    }
    const cohort = buildSimpleTrustedCohortFromRepo(root, {
      closeoutDir, taskIds: ['TSK-402'], cohortId: 'selection-test',
      bar: { ...DEFAULT_BAR, minTrustedCloses: 1 },
    });
    assert.deepEqual(cohort.rows.map((row) => row.taskId), ['TSK-402']);
    assert.equal(cohort.summary.autonomous_delivery_rate, 1);
    assert.equal(cohort.selection.cohortId, 'selection-test');
  });

  it('barMet true only at ≥10 trusted and ≥0.8 rate', () => {
    const closeouts = [];
    const factoryEvidence = [];
    for (let i = 1; i <= 10; i += 1) {
      const taskId = `TSK-${String(100 + i).padStart(3, '0')}`;
      closeouts.push({
        filePath: `/tmp/${taskId}.json`,
        taskId,
        deliveryStatus: 'phase6_complete',
        generatedAt: '2026-07-13T00:00:00.000Z',
        manualInterventions: [],
        liveSessions: [],
      });
      factoryEvidence.push({
        filePath: `/tmp/ev-${taskId}.json`,
        taskId,
        status: 'phase6_complete',
        liveSessions: [`specialist-delegation-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(i).padStart(2, '0')}`],
        liveSessionCount: 1,
      });
    }
    const cohort = buildSimpleTrustedCohort({ closeouts, factoryEvidence, bar: DEFAULT_BAR });
    assert.equal(cohort.summary.trustedCloses, 10);
    assert.equal(cohort.summary.barMet, true);
    assert.ok(cohort.summary.autonomous_delivery_rate >= 0.8);
  });

  it('calculates additions needed for both the count and rate bars', () => {
    const residual = calculateCohortResidual({
      trustedCloses: 6, closedTasks: 9, bar: DEFAULT_BAR,
    });
    assert.equal(residual.trustedCloseShortfall, 4);
    assert.equal(residual.additionalTrustedClosesForRate, 6);
    assert.equal(residual.additionalTrustedClosesRequired, 6);
    assert.equal(residual.projectedTrustedCloses, 12);
    assert.equal(residual.projectedClosedTasks, 15);
    assert.equal(residual.projectedAutonomousDeliveryRate, 0.8);
  });

  it('reports an imperfect cohort cannot reach a 100 percent target by addition', () => {
    const residual = calculateCohortResidual({
      trustedCloses: 9, closedTasks: 10,
      bar: { minTrustedCloses: 10, minAutonomousRate: 1 },
    });
    assert.equal(residual.achievableWithAdditionalTrustedCloses, false);
    assert.equal(residual.additionalTrustedClosesRequired, null);
  });

  it('requires immutable real PR evidence only for prospective v2 closeouts', () => {
    const cohort = buildSimpleTrustedCohort({
      closeouts: [{
        filePath: '/repo/observability/factory-closeout/TSK-321.json',
        taskId: 'TSK-321', deliveryStatus: 'phase6_complete',
        generatedAt: '2026-08-19T18:00:00.000Z', manualInterventions: [], liveSessions: [],
        trustedEvidence: { provided: false, valid: false, reasons: ['missing_trusted_close_evidence_reference'] },
        ...prospectiveProvenance(),
      }],
      factoryEvidence: [{
        filePath: '/repo/observability/factory-milestone-c-321.json', taskId: 'TSK-321',
        status: 'phase6_complete',
        liveSessions: ['specialist-delegation-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee21'], liveSessionCount: 1,
      }],
    });
    assert.equal(cohort.rows[0].policyVersion, COHORT_POLICY_VERSION);
    assert.equal(cohort.rows[0].trusted, false);
    assert.ok(cohort.rows[0].trustedReason.includes('missing_trusted_close_evidence_reference'));
  });

  it('loads a task-bound evidence package by repository path and SHA-256', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-v2-'));
    const closeoutDir = path.join(root, 'observability', 'factory-closeout');
    const evidenceDir = path.join(root, 'observability', 'trusted-simple-close');
    fs.mkdirSync(closeoutDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = path.join(evidenceDir, 'TSK-321.json');
    const evidence = {
      ...buildTrustedSimpleCloseEvidence({
      taskId: 'TSK-321', templateTier: 'Simple', repository: 'wiinc1/engineering-team',
      branchName: 'agent/simple-cohort-v2-pr-evidence',
      commitSha: 'e9c769fe45eef8e1498ff018c1c939109e8047bd',
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/301', prNumber: 301,
      mergeCommitSha: '6f8ebd8ad9d48b27480dcc06845e8fc9a24f31f1',
      mergedAt: '2026-08-19T17:00:00.000Z', changedFiles: ['README.md'],
        includeGithubCheckProof: true, requiredChecks: ['unit tests', 'Merge readiness'],
      }),
      taskId: 'TSK-321',
    };
    const evidenceBody = `${JSON.stringify(evidence, null, 2)}\n`;
    fs.writeFileSync(evidencePath, evidenceBody);
    const digest = crypto.createHash('sha256').update(evidenceBody).digest('hex');
    fs.writeFileSync(path.join(closeoutDir, 'TSK-321.json'), `${JSON.stringify({
      taskId: 'TSK-321', deliveryStatus: 'phase6_complete', generatedAt: '2026-08-19T18:00:00.000Z',
      manualInterventions: [], trustedSimpleCloseEvidence: {
        path: 'observability/trusted-simple-close/TSK-321.json', sha256: digest,
      },
      ...prospectiveProvenance(),
    })}\n`);
    fs.writeFileSync(path.join(root, 'observability', 'factory-milestone-c-321.json'), JSON.stringify({
      taskId: 'TSK-321', status: 'phase6_complete',
      session: 'specialist-delegation-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee21',
    }));

    const cohort = buildSimpleTrustedCohortFromRepo(root, { closeoutDir });
    assert.equal(cohort.rows[0].trusted, true);
    assert.equal(cohort.rows[0].trustedEvidenceSha256, digest);
    assert.equal(cohort.rows[0].prUrl, 'https://github.com/wiinc1/engineering-team/pull/301');
  });

  it('rejects a prospective close with an intervention after contract approval', () => {
    const result = buildSimpleTrustedCohort({ closeouts: [{
      taskId: 'TSK-322', deliveryStatus: 'phase6_complete',
      generatedAt: '2026-08-19T19:00:00.000Z',
      manualInterventions: [{ recordedAt: '2026-08-19T18:01:00.000Z' }],
      trustedEvidence: { valid: true }, ...prospectiveProvenance(),
    }], factoryEvidence: [{
      taskId: 'TSK-322', status: 'phase6_complete', filePath: '/repo/evidence.json',
      liveSessions: ['specialist-delegation-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee22'], liveSessionCount: 1,
    }] });
    assert.equal(result.rows[0].trusted, false);
    assert.equal(result.rows[0].interventionCount, 1);
    assert.ok(result.rows[0].trustedReason.includes('has_post_approval_interventions'));
  });
