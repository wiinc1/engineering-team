'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractLiveSessions,
  buildSimpleTrustedCohort,
  buildSimpleTrustedCohortFromRepo,
  DEFAULT_BAR,
} = require('../../lib/task-platform/simple-trusted-cohort');

describe('simple-trusted-cohort (#276)', () => {
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
});
